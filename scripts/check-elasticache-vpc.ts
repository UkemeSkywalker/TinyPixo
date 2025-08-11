#!/usr/bin/env tsx

/**
 * Check ElastiCache VPC and subnet group configuration
 */

import { 
    ElastiCacheClient, 
    DescribeReplicationGroupsCommand,
    DescribeCacheSubnetGroupsCommand
} from '@aws-sdk/client-elasticache'
import { 
    EC2Client, 
    DescribeVpcsCommand,
    DescribeSubnetsCommand
} from '@aws-sdk/client-ec2'

const AWS_REGION = 'us-east-1'
const REDIS_CLUSTER_ID = 'audio-conversion-redis'
const TARGET_VPC = 'vpc-0cb8cd9caa773138d'

const elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })
const ec2Client = new EC2Client({ region: AWS_REGION })

async function checkElastiCacheVpcConfig() {
    console.log('🔍 Checking ElastiCache VPC Configuration')
    console.log('=' .repeat(50))
    
    try {
        // Get Redis cluster details
        const clusterResult = await elasticacheClient.send(new DescribeReplicationGroupsCommand({
            ReplicationGroupId: REDIS_CLUSTER_ID
        }))
        
        const cluster = clusterResult.ReplicationGroups?.[0]
        if (!cluster) {
            console.log('❌ Redis cluster not found')
            return
        }
        
        console.log(`📍 Redis Cluster: ${cluster.ReplicationGroupId}`)
        console.log(`   Status: ${cluster.Status}`)
        console.log(`   Subnet Group: ${cluster.CacheSubnetGroupName || 'None (using default)'}`)
        
        // Check subnet group if it exists
        if (cluster.CacheSubnetGroupName) {
            console.log('\n🌐 Checking Subnet Group...')
            
            const subnetGroupResult = await elasticacheClient.send(new DescribeCacheSubnetGroupsCommand({
                CacheSubnetGroupName: cluster.CacheSubnetGroupName
            }))
            
            const subnetGroup = subnetGroupResult.CacheSubnetGroups?.[0]
            if (subnetGroup) {
                console.log(`   Name: ${subnetGroup.CacheSubnetGroupName}`)
                console.log(`   VPC: ${subnetGroup.VpcId}`)
                console.log(`   Description: ${subnetGroup.CacheSubnetGroupDescription}`)
                
                // Check if it's in the correct VPC
                if (subnetGroup.VpcId === TARGET_VPC) {
                    console.log('   ✅ ElastiCache is in the correct VPC')
                } else {
                    console.log(`   ❌ ElastiCache is in wrong VPC!`)
                    console.log(`      Expected: ${TARGET_VPC}`)
                    console.log(`      Actual: ${subnetGroup.VpcId}`)
                    console.log('   🔧 This is likely the cause of connection timeouts')
                }
                
                // List subnets
                console.log('\n   📍 Subnets in subnet group:')
                for (const subnet of subnetGroup.Subnets || []) {
                    console.log(`      - ${subnet.SubnetIdentifier} (${subnet.SubnetAvailabilityZone?.Name})`)
                }
                
                // Check if subnets are in the same VPC as VPC Connector
                if (subnetGroup.Subnets && subnetGroup.Subnets.length > 0) {
                    const subnetIds = subnetGroup.Subnets.map(s => s.SubnetIdentifier!).filter(Boolean)
                    
                    const subnetDetails = await ec2Client.send(new DescribeSubnetsCommand({
                        SubnetIds: subnetIds
                    }))
                    
                    console.log('\n   🔍 Subnet details:')
                    for (const subnet of subnetDetails.Subnets || []) {
                        console.log(`      ${subnet.SubnetId}: VPC ${subnet.VpcId} (${subnet.AvailabilityZone})`)
                        
                        if (subnet.VpcId !== TARGET_VPC) {
                            console.log(`         ❌ Wrong VPC! Should be ${TARGET_VPC}`)
                        }
                    }
                }
            }
        } else {
            console.log('\n⚠️ No subnet group specified - using default')
            console.log('   This might cause VPC connectivity issues')
            
            // Check default VPC
            const vpcs = await ec2Client.send(new DescribeVpcsCommand({
                Filters: [{ Name: 'is-default', Values: ['true'] }]
            }))
            
            const defaultVpc = vpcs.Vpcs?.[0]
            if (defaultVpc) {
                console.log(`   Default VPC: ${defaultVpc.VpcId}`)
                
                if (defaultVpc.VpcId === TARGET_VPC) {
                    console.log('   ✅ Default VPC matches target VPC')
                } else {
                    console.log(`   ❌ Default VPC doesn't match target VPC (${TARGET_VPC})`)
                    console.log('   🔧 ElastiCache is likely in the wrong VPC')
                }
            }
        }
        
        // Check VPC Connector subnets for comparison
        console.log('\n🔗 VPC Connector subnets:')
        const vpcConnectorSubnets = ['subnet-06b1d3db268051b7b', 'subnet-0dc859d01a66f7faf']
        
        const connectorSubnetDetails = await ec2Client.send(new DescribeSubnetsCommand({
            SubnetIds: vpcConnectorSubnets
        }))
        
        for (const subnet of connectorSubnetDetails.Subnets || []) {
            console.log(`   ${subnet.SubnetId}: VPC ${subnet.VpcId} (${subnet.AvailabilityZone})`)
        }
        
        // Provide recommendations
        console.log('\n💡 RECOMMENDATIONS:')
        
        if (cluster.CacheSubnetGroupName) {
            const subnetGroupResult = await elasticacheClient.send(new DescribeCacheSubnetGroupsCommand({
                CacheSubnetGroupName: cluster.CacheSubnetGroupName
            }))
            
            const subnetGroup = subnetGroupResult.CacheSubnetGroups?.[0]
            if (subnetGroup?.VpcId !== TARGET_VPC) {
                console.log('\n❌ CRITICAL ISSUE: ElastiCache is in the wrong VPC')
                console.log('   Solutions:')
                console.log('   1. Create new ElastiCache cluster in correct VPC')
                console.log('   2. Or create VPC Connector for the ElastiCache VPC')
                console.log('   3. Or use DynamoDB fallback (remove Redis env vars)')
            } else {
                console.log('\n✅ ElastiCache VPC configuration looks correct')
                console.log('   If still getting timeouts, check:')
                console.log('   1. Security group rules (port 6379)')
                console.log('   2. Network ACLs')
                console.log('   3. Route tables')
            }
        } else {
            console.log('\n⚠️ ElastiCache using default subnet group')
            console.log('   This might cause connectivity issues if default VPC != target VPC')
        }
        
    } catch (error: any) {
        console.error(`❌ Error checking ElastiCache VPC config: ${error.message}`)
    }
}

if (require.main === module) {
    checkElastiCacheVpcConfig()
}