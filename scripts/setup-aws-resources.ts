#!/usr/bin/env tsx

/**
 * AWS Resources Setup Script for Audio Conversion App
 * 
 * Redis Instance Sizing Recommendations:
 * 
 * cache.t3.micro (1 vCPU, 0.5GB RAM) - NOT RECOMMENDED
 * - Too small for real-time progress tracking with sub-second updates
 * - May cause connection timeouts under load
 * - Limited memory for concurrent job progress data
 * 
 * cache.t3.small (1 vCPU, 1.37GB RAM) - RECOMMENDED for development/testing
 * - Good for 10-20 concurrent audio conversions
 * - Sufficient memory for progress tracking data
 * - Cost-effective for development environments
 * 
 * cache.t3.medium (2 vCPU, 3.09GB RAM) - RECOMMENDED for production
 * - Handles 50+ concurrent conversions
 * - Better performance for high-frequency progress updates
 * - More resilient under load
 * 
 * cache.r6g.large (2 vCPU, 12.32GB RAM) - For high-volume production
 * - Memory-optimized for thousands of concurrent jobs
 * - Best performance for real-time progress tracking
 * 
 * Set REDIS_NODE_TYPE environment variable to override default (cache.t3.small)
 */

import {
    S3Client,
    CreateBucketCommand,
    HeadBucketCommand,
    PutBucketCorsCommand,
    PutObjectCommand
} from '@aws-sdk/client-s3'
import {
    DynamoDBClient,
    CreateTableCommand,
    DescribeTableCommand,
    UpdateTimeToLiveCommand,
    waitUntilTableExists
} from '@aws-sdk/client-dynamodb'
import {
    ElastiCacheClient,
    CreateReplicationGroupCommand,
    DescribeReplicationGroupsCommand
} from '@aws-sdk/client-elasticache'
import {
    IAMClient,
    CreateRoleCommand,
    AttachRolePolicyCommand,
    CreatePolicyCommand,
    GetRoleCommand,
    GetPolicyCommand
} from '@aws-sdk/client-iam'

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'audio-conversion-app-bucket'
const TABLE_NAME = 'audio-conversion-jobs'
const REDIS_CLUSTER_ID = 'audio-conversion-redis'
const REDIS_NODE_TYPE = process.env.REDIS_NODE_TYPE || 'cache.t3.small' // Configurable instance size
const IAM_ROLE_NAME = 'AudioConversionAppRunnerRole'

// Initialize AWS clients for real AWS (no endpoints)
const s3Client = new S3Client({ region: AWS_REGION })
const dynamodbClient = new DynamoDBClient({ region: AWS_REGION })
const elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })
const iamClient = new IAMClient({ region: AWS_REGION })

async function setupS3Bucket(): Promise<void> {
    console.log('\n🪣 Setting up S3 bucket...')

    try {
        // Check if bucket exists
        await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }))
        console.log(`✅ S3 bucket '${BUCKET_NAME}' already exists`)
    } catch (error: any) {
        if (error.name === 'NotFound') {
            // Create bucket
            console.log(`Creating S3 bucket '${BUCKET_NAME}'...`)
            await s3Client.send(new CreateBucketCommand({
                Bucket: BUCKET_NAME,
                CreateBucketConfiguration: AWS_REGION !== 'us-east-1' ? {
                    LocationConstraint: AWS_REGION as any
                } : undefined
            }))
            console.log(`✅ S3 bucket '${BUCKET_NAME}' created`)
        } else {
            throw error
        }
    }

    // Set up CORS policy
    console.log('Setting up CORS policy...')
    await s3Client.send(new PutBucketCorsCommand({
        Bucket: BUCKET_NAME,
        CORSConfiguration: {
            CORSRules: [
                {
                    AllowedHeaders: ['*'],
                    AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                    AllowedOrigins: ['*'], // In production, restrict to your domain
                    ExposeHeaders: ['ETag'],
                    MaxAgeSeconds: 3000
                }
            ]
        }
    }))
    console.log('✅ CORS policy configured')

    // Create folder structure by uploading placeholder files
    console.log('Creating folder structure...')
    await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: 'uploads/.gitkeep',
        Body: 'This folder stores uploaded audio files'
    }))

    await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: 'conversions/.gitkeep',
        Body: 'This folder stores converted audio files'
    }))
    console.log('✅ Folder structure created (uploads/, conversions/)')
}

async function setupDynamoDBTable(): Promise<void> {
    console.log('\n🗄️ Setting up DynamoDB table...')

    try {
        // Check if table exists
        const result = await dynamodbClient.send(new DescribeTableCommand({
            TableName: TABLE_NAME
        }))
        console.log(`✅ DynamoDB table '${TABLE_NAME}' already exists (status: ${result.Table?.TableStatus})`)
    } catch (error: any) {
        if (error.name === 'ResourceNotFoundException') {
            // Create table
            console.log(`Creating DynamoDB table '${TABLE_NAME}'...`)
            await dynamodbClient.send(new CreateTableCommand({
                TableName: TABLE_NAME,
                KeySchema: [
                    { AttributeName: 'jobId', KeyType: 'HASH' }
                ],
                AttributeDefinitions: [
                    { AttributeName: 'jobId', AttributeType: 'S' }
                ],
                BillingMode: 'PAY_PER_REQUEST'
            }))

            // Wait for table to be active
            console.log('Waiting for table to be active...')
            await waitUntilTableExists(
                { client: dynamodbClient, maxWaitTime: 300 },
                { TableName: TABLE_NAME }
            )
            console.log(`✅ DynamoDB table '${TABLE_NAME}' created`)

            // Configure TTL
            console.log('Configuring TTL...')
            await dynamodbClient.send(new UpdateTimeToLiveCommand({
                TableName: TABLE_NAME,
                TimeToLiveSpecification: {
                    AttributeName: 'ttl',
                    Enabled: true
                }
            }))
            console.log('✅ TTL configuration applied')
        } else {
            throw error
        }
    }
}

async function setupElastiCacheRedis(): Promise<void> {
    console.log('\n🔴 Setting up ElastiCache Redis cluster...')

    try {
        // Check if cluster exists
        const result = await elasticacheClient.send(new DescribeReplicationGroupsCommand({
            ReplicationGroupId: REDIS_CLUSTER_ID
        }))

        if (result.ReplicationGroups && result.ReplicationGroups.length > 0) {
            const cluster = result.ReplicationGroups[0]
            console.log(`✅ Redis cluster '${REDIS_CLUSTER_ID}' already exists (status: ${cluster.Status})`)

            if (cluster.ConfigurationEndpoint?.Address) {
                console.log(`   Configuration endpoint: ${cluster.ConfigurationEndpoint.Address}:${cluster.ConfigurationEndpoint.Port}`)
            } else if (cluster.NodeGroups && cluster.NodeGroups[0]?.PrimaryEndpoint) {
                console.log(`   Primary endpoint: ${cluster.NodeGroups[0].PrimaryEndpoint.Address}:${cluster.NodeGroups[0].PrimaryEndpoint.Port}`)
            }
        }
    } catch (error: any) {
        if (error.name === 'ReplicationGroupNotFoundFault') {
            // Try to create Redis cluster
            console.log(`Creating Redis cluster '${REDIS_CLUSTER_ID}'...`)
            try {
                await elasticacheClient.send(new CreateReplicationGroupCommand({
                    ReplicationGroupId: REDIS_CLUSTER_ID,
                    ReplicationGroupDescription: 'Redis cluster for audio conversion progress tracking',
                    NodeType: REDIS_NODE_TYPE,
                    NumCacheClusters: 1,
                    Engine: 'redis',
                    EngineVersion: '7.0',
                    Port: 6379,
                    // Use default VPC and security group for simplicity
                    AtRestEncryptionEnabled: true,
                    TransitEncryptionEnabled: true
                }))
                
                console.log(`✅ Redis cluster '${REDIS_CLUSTER_ID}' creation initiated`)
                console.log('⏳ Note: Cluster creation takes 10-15 minutes. Check AWS Console for status.')
                console.log('   Once available, get the endpoint from AWS Console and set REDIS_ENDPOINT')
            } catch (createError: any) {
                console.error(`❌ Failed to create Redis cluster: ${createError.message}`)
                console.log('')
                console.log('💡 Manual Redis setup required:')
                console.log('   1. Go to AWS ElastiCache Console')
                console.log('   2. Create a Redis cluster with these settings:')
                console.log(`      - Cluster ID: ${REDIS_CLUSTER_ID}`)
                console.log(`      - Node type: ${REDIS_NODE_TYPE}`)
                console.log('      - Engine version: 7.0')
                console.log('      - Configure VPC, subnet group, and security groups as needed')
                console.log('   3. Set REDIS_ENDPOINT environment variable to the cluster endpoint')
                console.log('')
                console.log('   Alternative: Use Redis locally for development')
            }
        } else {
            console.error(`Redis setup error: ${error.message}`)
            console.log('⏭️ Continuing with other resources...')
        }
    }
}

async function setupIAMRole(): Promise<void> {
    console.log('\n🔐 Setting up IAM role and policies...')

    const trustPolicy = {
        Version: '2012-10-17',
        Statement: [
            {
                Effect: 'Allow',
                Principal: {
                    Service: 'tasks.apprunner.amazonaws.com'
                },
                Action: 'sts:AssumeRole'
            }
        ]
    }

    const appPolicy = {
        Version: '2012-10-17',
        Statement: [
            {
                Effect: 'Allow',
                Action: [
                    's3:GetObject',
                    's3:PutObject',
                    's3:DeleteObject',
                    's3:ListBucket'
                ],
                Resource: [
                    `arn:aws:s3:::${BUCKET_NAME}`,
                    `arn:aws:s3:::${BUCKET_NAME}/*`
                ]
            },
            {
                Effect: 'Allow',
                Action: [
                    'dynamodb:GetItem',
                    'dynamodb:PutItem',
                    'dynamodb:UpdateItem',
                    'dynamodb:DeleteItem',
                    'dynamodb:Query',
                    'dynamodb:Scan'
                ],
                Resource: `arn:aws:dynamodb:${AWS_REGION}:*:table/${TABLE_NAME}`
            },
            {
                Effect: 'Allow',
                Action: [
                    'elasticache:*'
                ],
                Resource: '*'
            }
        ]
    }

    try {
        // Check if role exists
        await iamClient.send(new GetRoleCommand({ RoleName: IAM_ROLE_NAME }))
        console.log(`✅ IAM role '${IAM_ROLE_NAME}' already exists`)
    } catch (error: any) {
          if (error.name === 'NoSuchEntityException') {
            // Create role
            console.log(`Creating IAM role '${IAM_ROLE_NAME}'...`)
            await iamClient.send(new CreateRoleCommand({
                RoleName: IAM_ROLE_NAME,
                AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
                Description: 'Role for Audio Conversion App Runner service'
            }))
            console.log(`✅ IAM role '${IAM_ROLE_NAME}' created`)
        } else {
            throw error
        }
    }

                 // Get account ID for policy ARN
    const accountId = await getAccountId()
    
    // Create and attach policy
    const policyName = 'AudioConversionAppPolicy'
    const policyArn = `arn:aws:iam::${accountId}:policy/${policyName}`

    try {
        await iamClient.send(new GetPolicyCommand({ PolicyArn: policyArn }))
        console.log(`✅ IAM policy '${policyName}' already exists`)
    } catch (error: any) {
        if (error.name === 'NoSuchEntityException') {
            console.log(`Creating IAM policy '${policyName}'...`)
            await iamClient.send(new CreatePolicyCommand({
                PolicyName: policyName,
                PolicyDocument: JSON.stringify(appPolicy),
                Description: 'Policy for Audio Conversion App Runner service'
            }))
            console.log(`✅ IAM policy '${policyName}' created`)
        } else {
            throw error
        }
    }

    // Attach policy to role
    try {
        await iamClient.send(new AttachRolePolicyCommand({
            RoleName: IAM_ROLE_NAME,
            PolicyArn: policyArn
        }))
        console.log(`✅ Policy attached to role`)
    } catch (error) {
        // Policy might already be attached
        console.log(`ℹ️ Policy attachment: ${error}`)
    }
}

async function getAccountId(): Promise<string> {
    // Simple way to get account ID from STS
    const { STSClient, GetCallerIdentityCommand } = await import('@aws-sdk/client-sts')
    const stsClient = new STSClient({ region: AWS_REGION })
    const result = await stsClient.send(new GetCallerIdentityCommand({}))
    return result.Account!
}

async function main(): Promise<void> {
    console.log('🚀 Setting up AWS resources for audio conversion app...')
    console.log(`Region: ${AWS_REGION}`)
    console.log(`S3 Bucket: ${BUCKET_NAME}`)
    console.log(`DynamoDB Table: ${TABLE_NAME}`)
    console.log(`Redis Cluster: ${REDIS_CLUSTER_ID} (${REDIS_NODE_TYPE})`)

    try {
        await setupS3Bucket()
        await setupDynamoDBTable()
        await setupElastiCacheRedis()
        await setupIAMRole()

        console.log('\n🎉 AWS resources setup completed!')
        console.log('\n📋 Next steps:')
        console.log('1. Wait for Redis cluster to be available (10-15 minutes)')
        console.log('2. Update your environment variables:')
        console.log(`   - AWS_REGION=${AWS_REGION}`)
        console.log(`   - S3_BUCKET_NAME=${BUCKET_NAME}`)
        console.log(`   - REDIS_ENDPOINT=<cluster-endpoint-from-console>`)
        console.log('3. Run connectivity tests: npm run test:aws-connectivity')

    } catch (error) {
        console.error('\n💥 Failed to setup AWS resources:', error)
        process.exit(1)
    }
}

if (require.main === module) {
    main()
}