#!/usr/bin/env tsx

/**
 * Set up App Runner VPC access to ElastiCache
 * This creates a VPC connector and configures security groups
 */

import {
    AppRunnerClient,
    CreateVpcConnectorCommand,
    DescribeVpcConnectorCommand,
    ListVpcConnectorsCommand
} from '@aws-sdk/client-apprunner'
import {
    EC2Client,
    DescribeVpcsCommand,
    DescribeSubnetsCommand,
    DescribeSecurityGroupsCommand,
    CreateSecurityGroupCommand,
    AuthorizeSecurityGroupIngressCommand
} from '@aws-sdk/client-ec2'

const AWS_REGION = 'us-east-1'
const VPC_ID = 'vpc-0cb8cd9caa773138d' // From your ElastiCache details
const VPC_CONNECTOR_NAME = 'audio-conversion-vpc-connector'
const APPRUNNER_SG_NAME = 'apprunner-redis-access'

const appRunnerClient = new AppRunnerClient({ region: AWS_REGION })
const ec2Client = new EC2Client({ region: AWS_REGION })

async function getSubnetsForVPC() {
    console.log(`🔍 Finding subnets in VPC ${VPC_ID}...`)
    
    const result = await ec2Client.send(new DescribeSubnetsCommand({
        Filters: [
            { Name: 'vpc-id', Values: [VPC_ID] },
            { Name: 'state', Values: ['available'] }
        ]
    }))
    
    if (!result.Subnets || result.Subnets.length < 2) {
        throw new Error('Need at least 2 subnets for VPC connector')
    }
    
    // Use first 2 subnets (App Runner requires at least 2)
    const subnets = result.Subnets.slice(0, 2)
    console.log(`✅ Found ${subnets.length} subnets:`)
    subnets.forEach(subnet => {
        console.log(`   - ${subnet.SubnetId} (${subnet.AvailabilityZone})`)
    })
    
    return subnets
}

async function createAppRunnerSecurityGroup() {
    console.log('🔧 Creating security group for App Runner...')
    
    // Check if security group already exists
    try {
        const existing = await ec2Client.send(new DescribeSecurityGroupsCommand({
            Filters: [
                { Name: 'group-name', Values: [APPRUNNER_SG_NAME] },
                { Name: 'vpc-id', Values: [VPC_ID] }
            ]
        }))
        
        if (existing.SecurityGroups && existing.SecurityGroups.length > 0) {
            const sg = existing.SecurityGroups[0]
            console.log(`✅ Security group already exists: ${sg.GroupId}`)
            return sg
        }
    } catch (error) {
        // Security group doesn't exist, create it
    }
    
    // Create new security group
    const createResult = await ec2Client.send(new CreateSecurityGroupCommand({
        GroupName: APPRUNNER_SG_NAME,
        Description: 'Allow App Runner to access ElastiCache Redis',
        VpcId: VPC_ID
    }))
    
    const sgId = createResult.GroupId!
    console.log(`✅ Created security group: ${sgId}`)
    
    // Add outbound rule for Redis (port 6379)
    console.log('🔧 Adding Redis access rule...')
    await ec2Client.send(new AuthorizeSecurityGroupIngressCommand({
        GroupId: sgId,
        IpPermissions: [{
            IpProtocol: 'tcp',
            FromPort: 6379,
            ToPort: 6379,
            IpRanges: [{ CidrIp: '10.0.0.0/8', Description: 'Redis access within VPC' }]
        }]
    }))
    
    return { GroupId: sgId }
}

async function updateElastiCacheSecurityGroup() {
    console.log('🔧 Updating ElastiCache security group...')
    
    // Find the ElastiCache security group
    const sgResult = await ec2Client.send(new DescribeSecurityGroupsCommand({
        Filters: [
            { Name: 'group-name', Values: ['audio-conversion-redis-SG'] },
            { Name: 'vpc-id', Values: [VPC_ID] }
        ]
    }))
    
    if (!sgResult.SecurityGroups || sgResult.SecurityGroups.length === 0) {
        console.log('⚠️ ElastiCache security group not found by name, trying by ID...')
        
        // Try to find by description or other means
        const allSGs = await ec2Client.send(new DescribeSecurityGroupsCommand({
            Filters: [{ Name: 'vpc-id', Values: [VPC_ID] }]
        }))
        
        const redisSG = allSGs.SecurityGroups?.find(sg => 
            sg.GroupName?.includes('redis') || 
            sg.Description?.toLowerCase().includes('redis') ||
            sg.Description?.toLowerCase().includes('elasticache')
        )
        
        if (redisSG) {
            console.log(`✅ Found ElastiCache security group: ${redisSG.GroupId}`)
            
            // Check if it already allows Redis access
            const hasRedisRule = redisSG.IpPermissions?.some(rule => 
                rule.FromPort === 6379 && rule.ToPort === 6379
            )
            
            if (!hasRedisRule) {
                console.log('🔧 Adding Redis access rule to ElastiCache security group...')
                try {
                    await ec2Client.send(new AuthorizeSecurityGroupIngressCommand({
                        GroupId: redisSG.GroupId,
                        IpPermissions: [{
                            IpProtocol: 'tcp',
                            FromPort: 6379,
                            ToPort: 6379,
                            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'Redis access for App Runner' }]
                        }]
                    }))
                    console.log('✅ Added Redis access rule')
                } catch (error: any) {
                    if (error.name === 'InvalidPermission.Duplicate') {
                        console.log('✅ Rule already exists')
                    } else {
                        console.error(`❌ Failed to add rule: ${error.message}`)
                    }
                }
            } else {
                console.log('✅ ElastiCache security group already allows Redis access')
            }
        } else {
            console.log('⚠️ Could not find ElastiCache security group automatically')
            console.log('💡 You may need to manually add inbound rule: Port 6379 from 0.0.0.0/0')
        }
    }
}

async function createVpcConnector() {
    console.log('🔧 Creating VPC Connector...')
    
    // Check if VPC connector already exists
    try {
        const existing = await appRunnerClient.send(new ListVpcConnectorsCommand({}))
        const connector = existing.VpcConnectors?.find(c => c.VpcConnectorName === VPC_CONNECTOR_NAME)
        
        if (connector) {
            console.log(`✅ VPC Connector already exists: ${connector.VpcConnectorArn}`)
            const details = await appRunnerClient.send(new DescribeVpcConnectorCommand({
                VpcConnectorArn: connector.VpcConnectorArn
            }))
            return details.VpcConnector
        }
    } catch (error) {
        // VPC connector doesn't exist, create it
    }
    
    const subnets = await getSubnetsForVPC()
    const securityGroup = await createAppRunnerSecurityGroup()
    
    const result = await appRunnerClient.send(new CreateVpcConnectorCommand({
        VpcConnectorName: VPC_CONNECTOR_NAME,
        Subnets: subnets.map(s => s.SubnetId!),
        SecurityGroups: [securityGroup.GroupId!]
    }))
    
    console.log(`✅ VPC Connector created: ${result.VpcConnector?.VpcConnectorArn}`)
    console.log(`   Status: ${result.VpcConnector?.Status}`)
    
    return result.VpcConnector
}

async function main() {
    console.log('🚀 Setting up App Runner VPC access to ElastiCache')
    console.log('=' .repeat(50))
    console.log(`Target VPC: ${VPC_ID}`)
    console.log(`Region: ${AWS_REGION}`)
    
    try {
        // Step 1: Create VPC Connector
        const connector = await createVpcConnector()
        
        // Step 2: Update ElastiCache security group
        await updateElastiCacheSecurityGroup()
        
        console.log('\n🎉 VPC setup complete!')
        console.log('\n📋 Next Steps:')
        console.log('1. Wait for VPC Connector to become ACTIVE (5-10 minutes)')
        console.log('   Check status: aws apprunner describe-vpc-connector --vpc-connector-arn <arn>')
        console.log('')
        console.log('2. Update your App Runner service to use the VPC Connector:')
        console.log('   - Go to AWS Console > App Runner > Your Service')
        console.log('   - Configuration > Networking')
        console.log('   - Add VPC Connector:')
        console.log(`   - VPC Connector ARN: ${connector?.VpcConnectorArn}`)
        console.log('')
        console.log('3. Redeploy your App Runner service')
        console.log('')
        console.log('4. Test audio conversion with Redis enabled')
        
        console.log('\n💡 Alternative Quick Fix:')
        console.log('   If you need immediate functionality, temporarily remove these')
        console.log('   environment variables from App Runner:')
        console.log('   - REDIS_ENDPOINT')
        console.log('   - REDIS_PORT')
        console.log('   - REDIS_TLS')
        console.log('   This will use DynamoDB fallback for progress tracking.')
        
    } catch (error: any) {
        console.error(`❌ Setup failed: ${error.message}`)
        
        console.log('\n🔧 Troubleshooting:')
        console.log('1. Ensure you have the required AWS permissions:')
        console.log('   - apprunner:CreateVpcConnector')
        console.log('   - ec2:CreateSecurityGroup')
        console.log('   - ec2:AuthorizeSecurityGroupIngress')
        console.log('   - ec2:DescribeVpcs, DescribeSubnets, DescribeSecurityGroups')
        console.log('')
        console.log('2. Quick workaround: Disable Redis temporarily')
        console.log('   Remove Redis environment variables from App Runner')
        
        process.exit(1)
    }
}

if (require.main === module) {
    main()
}