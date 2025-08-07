#!/usr/bin/env tsx

import { config } from 'dotenv'
config({ path: '.env.local' })

import {
    S3Client,
    HeadBucketCommand,
    ListBucketsCommand
} from '@aws-sdk/client-s3'
import {
    DynamoDBClient,
    DescribeTableCommand
} from '@aws-sdk/client-dynamodb'
import {
    ElastiCacheClient,
    DescribeReplicationGroupsCommand
} from '@aws-sdk/client-elasticache'

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'audio-conversion-app-bucket'
const TABLE_NAME = 'audio-conversion-jobs'
const REDIS_CLUSTER_ID = 'audio-conversion-redis'

const s3Client = new S3Client({ region: AWS_REGION })
const dynamodbClient = new DynamoDBClient({ region: AWS_REGION })
const elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })

async function checkS3(): Promise<void> {
    console.log('\n🪣 Checking S3 bucket...')
    try {
        await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }))
        console.log(`✅ S3 bucket '${BUCKET_NAME}' exists`)
    } catch (error: any) {
        if (error.name === 'NotFound') {
            console.log(`❌ S3 bucket '${BUCKET_NAME}' does not exist`)
        } else {
            console.log(`❌ Error checking S3 bucket: ${error.message}`)
        }
    }
}

async function checkDynamoDB(): Promise<void> {
    console.log('\n🗄️ Checking DynamoDB table...')
    try {
        const result = await dynamodbClient.send(new DescribeTableCommand({
            TableName: TABLE_NAME
        }))
        console.log(`✅ DynamoDB table '${TABLE_NAME}' exists (status: ${result.Table?.TableStatus})`)
    } catch (error: any) {
        if (error.name === 'ResourceNotFoundException') {
            console.log(`❌ DynamoDB table '${TABLE_NAME}' does not exist`)
        } else {
            console.log(`❌ Error checking DynamoDB table: ${error.message}`)
        }
    }
}

async function checkRedis(): Promise<void> {
    console.log('\n🔴 Checking Redis cluster...')
    try {
        const result = await elasticacheClient.send(new DescribeReplicationGroupsCommand({
            ReplicationGroupId: REDIS_CLUSTER_ID
        }))

        if (result.ReplicationGroups && result.ReplicationGroups.length > 0) {
            const cluster = result.ReplicationGroups[0]
            console.log(`✅ Redis cluster '${REDIS_CLUSTER_ID}' exists`)
            console.log(`   Status: ${cluster.Status}`)
            console.log(`   Node Type: ${cluster.CacheNodeType}`)

            if (cluster.Status === 'available') {
                if (cluster.ConfigurationEndpoint?.Address) {
                    console.log(`   📍 Configuration Endpoint: ${cluster.ConfigurationEndpoint.Address}:${cluster.ConfigurationEndpoint.Port}`)
                    console.log(`   💡 Set REDIS_ENDPOINT=${cluster.ConfigurationEndpoint.Address}`)
                } else if (cluster.NodeGroups && cluster.NodeGroups[0]?.PrimaryEndpoint) {
                    console.log(`   📍 Primary Endpoint: ${cluster.NodeGroups[0].PrimaryEndpoint.Address}:${cluster.NodeGroups[0].PrimaryEndpoint.Port}`)
                    console.log(`   💡 Set REDIS_ENDPOINT=${cluster.NodeGroups[0].PrimaryEndpoint.Address}`)
                }
            } else {
                console.log(`   ⏳ Cluster is still ${cluster.Status}. Wait for it to become 'available'`)
            }
        }
    } catch (error: any) {
        if (error.name === 'ReplicationGroupNotFoundFault') {
            console.log(`❌ Redis cluster '${REDIS_CLUSTER_ID}' does not exist`)
        } else {
            console.log(`❌ Error checking Redis cluster: ${error.message}`)
        }
    }
}

async function main(): Promise<void> {
    console.log('🔍 Checking AWS resources status...')
    console.log(`Region: ${AWS_REGION}`)

    try {
        await checkS3()
        await checkDynamoDB()
        await checkRedis()

        console.log('\n📋 Summary:')
        console.log('To create missing resources, run: npm run setup:aws-resources')
        console.log('To test connectivity, run: npm run test:aws-connectivity')

    } catch (error: any) {
        console.error('\n💥 Error checking resources:', error.message)
        process.exit(1)
    }
}

if (require.main === module) {
    main()
}