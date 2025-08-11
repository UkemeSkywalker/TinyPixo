#!/usr/bin/env tsx

/**
 * Comprehensive Redis connectivity diagnosis after VPC connector setup
 */

import { 
    ElastiCacheClient, 
    DescribeReplicationGroupsCommand 
} from '@aws-sdk/client-elasticache'
import { 
    EC2Client, 
    DescribeSecurityGroupsCommand,
    DescribeVpcsCommand,
    DescribeSubnetsCommand
} from '@aws-sdk/client-ec2'
import { 
    AppRunnerClient, 
    DescribeVpcConnectorCommand,
    ListServicesCommand,
    DescribeServiceCommand
} from '@aws-sdk/client-apprunner'

const AWS_REGION = 'us-east-1'
const REDIS_CLUSTER_ID = 'audio-conversion-redis'
const VPC_CONNECTOR_ARN = 'arn:aws:apprunner:us-east-1:910883278292:vpcconnector/audio-conversion-vpc-connector/1/be401efcb5254e449a59e0f2ba03fdc7'

const elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })
const ec2Client = new EC2Client({ region: AWS_REGION })
const appRunnerClient = new AppRunnerClient({ region: AWS_REGION })

async function checkRedisClusterDetails() {
    console.log('🔍 1. Checking Redis cluster configuration...')
    
    try {
        const result = await elasticacheClient.send(new DescribeReplicationGroupsCommand({
            ReplicationGroupId: REDIS_CLUSTER_ID
        }))
        
        const cluster = result.ReplicationGroups?.[0]
        if (!cluster) {
            console.log('❌ Redis cluster not found')
            return null
        }
        
        console.log(`✅ Redis Cluster: ${cluster.ReplicationGroupId}`)
        console.log(`   Status: ${cluster.Status}`)
        console.log(`   VPC: ${cluster.CacheSubnetGroupName ? 'Yes' : 'No'}`)
        console.log(`   Transit Encryption: ${cluster.TransitEncryptionEnabled}`)
        console.log(`   At Rest Encryption: ${cluster.AtRestEncryptionEnabled}`)
        
        // Get primary endpoint
        const endpoint = cluster.NodeGroups?.[0]?.PrimaryEndpoint?.Address
        console.log(`   Primary Endpoint: ${endpoint}:6379`)
        
        return cluster
    } catch (error: any) {
        console.log(`❌ Error checking Redis cluster: ${error.message}`)
        return null
    }
}

async function checkVpcConnectorStatus() {
    console.log('\n🔍 2. Checking VPC Connector status...')
    
    try {
        const result = await appRunnerClient.send(new DescribeVpcConnectorCommand({
            VpcConnectorArn: VPC_CONNECTOR_ARN
        }))
        
        const connector = result.VpcConnector
        if (!connector) {
            console.log('❌ VPC Connector not found')
            return null
        }
        
        console.log(`✅ VPC Connector: ${connector.VpcConnectorName}`)
        console.log(`   Status: ${connector.Status}`)
        console.log(`   Subnets: ${connector.Subnets?.join(', ')}`)
        console.log(`   Security Groups: ${connector.SecurityGroups?.join(', ')}`)
        
        return connector
    } catch (error: any) {
        console.log(`❌ Error checking VPC Connector: ${error.message}`)
        return null
    }
}

async function checkAppRunnerServiceConfig() {
    console.log('\n🔍 3. Checking App Runner service configuration...')
    
    try {
        const services = await appRunnerClient.send(new ListServicesCommand({}))
        
        for (const serviceSummary of services.ServiceSummaryList || []) {
            if (serviceSummary.ServiceName?.includes('tinypixoaudio-v2')) {
                console.log(`\n📱 Service: ${serviceSummary.ServiceName}`)
                console.log(`   Status: ${serviceSummary.Status}`)
                
                const serviceDetails = await appRunnerClient.send(new DescribeServiceCommand({
                    ServiceArn: serviceSummary.ServiceArn
                }))
                
                const networkConfig = serviceDetails.Service?.NetworkConfiguration
                console.log(`   Network Configuration:`)
                console.log(`     Egress Type: ${networkConfig?.EgressConfiguration?.EgressType}`)
                
                if (networkConfig?.EgressConfiguration?.VpcConnectorArn) {
                    console.log(`     VPC Connector: ${networkConfig.EgressConfiguration.VpcConnectorArn}`)
                    
                    if (networkConfig.EgressConfiguration.VpcConnectorArn === VPC_CONNECTOR_ARN) {
                        console.log(`     ✅ Correct VPC Connector configured`)
                    } else {
                        console.log(`     ❌ Wrong VPC Connector configured`)
                    }
                } else {
                    console.log(`     ❌ No VPC Connector configured`)
                    console.log(`     💡 You need to add the VPC Connector to your App Runner service`)
                }
                
                return serviceDetails.Service
            }
        }
        
        console.log('❌ tinypixoaudio-v2 service not found')
        return null
        
    } catch (error: any) {
        console.log(`❌ Error checking App Runner service: ${error.message}`)
        return null
    }
}

async function checkSecurityGroups() {
    console.log('\n🔍 4. Checking security group configurations...')
    
    try {
        // Check VPC Connector security group
        const vpcConnectorSG = 'sg-05aa60d2b1012cce7'
        console.log(`\n🔒 VPC Connector Security Group: ${vpcConnectorSG}`)
        
        const sgResult = await ec2Client.send(new DescribeSecurityGroupsCommand({
            GroupIds: [vpcConnectorSG]
        }))
        
        const sg = sgResult.SecurityGroups?.[0]
        if (sg) {
            console.log(`   Name: ${sg.GroupName}`)
            console.log(`   VPC: ${sg.VpcId}`)
            
            console.log('   Outbound Rules:')
            for (const rule of sg.IpPermissionsEgress || []) {
                const protocol = rule.IpProtocol === '-1' ? 'All' : rule.IpProtocol
                const ports = rule.FromPort === rule.ToPort ? rule.FromPort : `${rule.FromPort}-${rule.ToPort}`
                const destinations = [
                    ...(rule.IpRanges?.map(ip => ip.CidrIp) || []),
                    ...(rule.UserIdGroupPairs?.map(pair => pair.GroupId) || [])
                ]
                console.log(`     ${protocol}:${ports} to ${destinations.join(', ')}`)
            }
        }
        
        // Check ElastiCache security groups
        console.log(`\n🔒 ElastiCache Security Groups:`)
        
        // Find ElastiCache security groups
        const allSGs = await ec2Client.send(new DescribeSecurityGroupsCommand({
            Filters: [
                { Name: 'vpc-id', Values: ['vpc-0cb8cd9caa773138d'] }
            ]
        }))
        
        const elasticacheSGs = allSGs.SecurityGroups?.filter(sg => 
            sg.GroupName?.includes('redis') || 
            sg.Description?.toLowerCase().includes('redis') ||
            sg.Description?.toLowerCase().includes('elasticache')
        )
        
        for (const sg of elasticacheSGs || []) {
            console.log(`   ${sg.GroupId} (${sg.GroupName})`)
            console.log('   Inbound Rules:')
            
            let hasRedisRule = false
            for (const rule of sg.IpPermissions || []) {
                const protocol = rule.IpProtocol === '-1' ? 'All' : rule.IpProtocol
                const ports = rule.FromPort === rule.ToPort ? rule.FromPort : `${rule.FromPort}-${rule.ToPort}`
                const sources = [
                    ...(rule.IpRanges?.map(ip => ip.CidrIp) || []),
                    ...(rule.UserIdGroupPairs?.map(pair => pair.GroupId) || [])
                ]
                console.log(`     ${protocol}:${ports} from ${sources.join(', ')}`)
                
                if (rule.FromPort === 6379) {
                    hasRedisRule = true
                    // Check if it allows from VPC Connector SG
                    const allowsVpcConnector = rule.UserIdGroupPairs?.some(pair => 
                        pair.GroupId === vpcConnectorSG
                    ) || rule.IpRanges?.some(ip => 
                        ip.CidrIp === '0.0.0.0/0' || ip.CidrIp?.includes('10.')
                    )
                    
                    if (allowsVpcConnector) {
                        console.log(`     ✅ Redis rule allows VPC Connector access`)
                    } else {
                        console.log(`     ❌ Redis rule doesn't allow VPC Connector access`)
                    }
                }
            }
            
            if (!hasRedisRule) {
                console.log(`     ❌ No Redis port 6379 rule found`)
            }
        }
        
    } catch (error: any) {
        console.log(`❌ Error checking security groups: ${error.message}`)
    }
}

async function provideSolutions() {
    console.log('\n💡 SOLUTIONS BASED ON DIAGNOSIS:')
    
    console.log('\n1. **If App Runner service has no VPC Connector:**')
    console.log('   - Go to AWS Console > App Runner > tinypixoaudio-v2')
    console.log('   - Configuration > Networking > Edit')
    console.log('   - Outgoing network traffic > Custom VPC')
    console.log('   - Select: audio-conversion-vpc-connector')
    console.log('   - Save and wait for redeployment')
    
    console.log('\n2. **If security groups block access:**')
    console.log('   - Add inbound rule to ElastiCache security group:')
    console.log('   - Port: 6379, Source: sg-05aa60d2b1012cce7 (VPC Connector SG)')
    console.log('   - Or Source: 0.0.0.0/0 for testing')
    
    console.log('\n3. **If Redis cluster is in wrong VPC:**')
    console.log('   - ElastiCache must be in same VPC as VPC Connector')
    console.log('   - Check subnet group configuration')
    
    console.log('\n4. **Quick workaround (if needed immediately):**')
    console.log('   - Remove Redis environment variables from App Runner:')
    console.log('     * REDIS_ENDPOINT')
    console.log('     * REDIS_PORT')
    console.log('     * REDIS_TLS')
    console.log('   - This will use DynamoDB fallback for progress tracking')
    
    console.log('\n5. **Test commands:**')
    console.log('   - npm run test:redis-connection')
    console.log('   - npm run verify:vpc-connector')
}

async function main() {
    console.log('🚀 Redis Connectivity Diagnosis (Post VPC Connector)')
    console.log('=' .repeat(60))
    
    const cluster = await checkRedisClusterDetails()
    const connector = await checkVpcConnectorStatus()
    const service = await checkAppRunnerServiceConfig()
    await checkSecurityGroups()
    await provideSolutions()
    
    console.log('\n📊 SUMMARY:')
    console.log(`   Redis Cluster: ${cluster ? '✅' : '❌'}`)
    console.log(`   VPC Connector: ${connector ? '✅' : '❌'}`)
    console.log(`   App Runner Config: ${service ? '✅' : '❌'}`)
    console.log('\n   If all show ✅ but Redis still times out, it\'s likely a security group issue.')
}

if (require.main === module) {
    main()
}