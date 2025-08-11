#!/usr/bin/env tsx

/**
 * Check Redis network configuration in detail
 */

import { 
    ElastiCacheClient, 
    DescribeReplicationGroupsCommand,
    DescribeCacheSubnetGroupsCommand
} from '@aws-sdk/client-elasticache'
import { 
    EC2Client, 
    DescribeSecurityGroupsCommand,
    DescribeVpcsCommand,
    DescribeSubnetsCommand
} from '@aws-sdk/client-ec2'

const AWS_REGION = 'us-east-1'
const REDIS_CLUSTER_ID = 'audio-conversion-redis'

const elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })
const ec2Client = new EC2Client({ region: AWS_REGION })

async function checkRedisNetworkConfig() {
    console.log('🔍 Detailed Redis Network Configuration Check')
    console.log('=' .repeat(50))
    
    try {
        // Get Redis cluster details
        const clusterResult = await elasticacheClient.send(new DescribeReplicationGroupsCommand({
            ReplicationGroupId: REDIS_CLUSTER_ID
        }))
        
        const cluster = clusterResult.ReplicationGroups?.[0]
        if (!cluster) {
            console.error('❌ Redis cluster not found')
            return
        }
        
        console.log(`\n📍 Redis Cluster: ${cluster.ReplicationGroupId}`)
        console.log(`   Status: ${cluster.Status}`)
        console.log(`   Multi-AZ: ${cluster.MultiAZ}`)
        console.log(`   At Rest Encryption: ${cluster.AtRestEncryptionEnabled}`)
        console.log(`   Transit Encryption: ${cluster.TransitEncryptionEnabled}`)
        
        // Check subnet group
        if (cluster.CacheSubnetGroupName) {
            console.log(`\n🌐 Subnet Group: ${cluster.CacheSubnetGroupName}`)
            
            try {
                const subnetGroupResult = await elasticacheClient.send(new DescribeCacheSubnetGroupsCommand({
                    CacheSubnetGroupName: cluster.CacheSubnetGroupName
                }))
                
                const subnetGroup = subnetGroupResult.CacheSubnetGroups?.[0]
                if (subnetGroup) {
                    console.log(`   VPC ID: ${subnetGroup.VpcId}`)
                    console.log(`   Subnets: ${subnetGroup.Subnets?.length || 0}`)
                    
                    // Check if it's in the default VPC
                    const vpcs = await ec2Client.send(new DescribeVpcsCommand({
                        VpcIds: [subnetGroup.VpcId!]
                    }))
                    
                    const vpc = vpcs.Vpcs?.[0]
                    if (vpc) {
                        console.log(`   VPC: ${vpc.VpcId} (Default: ${vpc.IsDefault})`)
                        
                        if (!vpc.IsDefault) {
                            console.log('   ⚠️ Redis is NOT in default VPC!')
                            console.log('   💡 App Runner uses default VPC by default')
                            console.log('   🔧 Solution: Create VPC connector or move Redis to default VPC')
                        } else {
                            console.log('   ✅ Redis is in default VPC (good for App Runner)')
                        }
                    }
                    
                    // List subnets
                    if (subnetGroup.Subnets) {
                        console.log('\n   📍 Subnets:')
                        for (const subnet of subnetGroup.Subnets) {
                            console.log(`      - ${subnet.SubnetIdentifier} (${subnet.SubnetAvailabilityZone?.Name})`)
                        }
                    }
                }
            } catch (error: any) {
                console.error(`   ❌ Error checking subnet group: ${error.message}`)
            }
        } else {
            console.log('\n⚠️ No subnet group specified (using default)')
        }
        
        // Check security groups
        console.log('\n🔒 Security Groups:')
        if (cluster.SecurityGroups && cluster.SecurityGroups.length > 0) {
            for (const sg of cluster.SecurityGroups) {
                console.log(`   - ${sg.SecurityGroupId} (${sg.Status})`)
            }
            
            // Get detailed security group info
            const sgIds = cluster.SecurityGroups.map(sg => sg.SecurityGroupId!).filter(Boolean)
            const sgResult = await ec2Client.send(new DescribeSecurityGroupsCommand({
                GroupIds: sgIds
            }))
            
            for (const sg of sgResult.SecurityGroups || []) {
                console.log(`\n   🔒 ${sg.GroupId} (${sg.GroupName})`)
                console.log(`      Description: ${sg.Description}`)
                console.log(`      VPC: ${sg.VpcId}`)
                
                console.log('      Inbound Rules:')
                if (sg.IpPermissions && sg.IpPermissions.length > 0) {
                    for (const rule of sg.IpPermissions) {
                        const protocol = rule.IpProtocol === '-1' ? 'All' : rule.IpProtocol
                        const ports = rule.FromPort === rule.ToPort ? rule.FromPort : `${rule.FromPort}-${rule.ToPort}`
                        
                        const sources = [
                            ...(rule.IpRanges?.map(ip => ip.CidrIp) || []),
                            ...(rule.UserIdGroupPairs?.map(pair => pair.GroupId) || [])
                        ]
                        
                        console.log(`         ${protocol}:${ports} from ${sources.join(', ')}`)
                        
                        if (rule.FromPort === 6379) {
                            console.log('         ✅ Redis port 6379 rule found')
                        }
                    }
                } else {
                    console.log('         (No inbound rules)')
                }
            }
        } else {
            console.log('   ⚠️ No explicit security groups (using default)')
            
            // Try to find default security group
            try {
                const defaultSGs = await ec2Client.send(new DescribeSecurityGroupsCommand({
                    Filters: [
                        { Name: 'group-name', Values: ['default'] }
                    ]
                }))
                
                console.log('\n   🔍 Checking default security groups:')
                for (const sg of defaultSGs.SecurityGroups || []) {
                    console.log(`      ${sg.GroupId} (VPC: ${sg.VpcId})`)
                    
                    let hasRedisRule = false
                    for (const rule of sg.IpPermissions || []) {
                        if (rule.FromPort === 6379) {
                            hasRedisRule = true
                            const sources = [
                                ...(rule.IpRanges?.map(ip => ip.CidrIp) || []),
                                ...(rule.UserIdGroupPairs?.map(pair => pair.GroupId) || [])
                            ]
                            console.log(`         ✅ Redis rule: ${sources.join(', ')}`)
                        }
                    }
                    
                    if (!hasRedisRule) {
                        console.log('         ❌ No Redis port 6379 rule in default SG')
                        console.log('         🔧 Need to add rule to default security group')
                    }
                }
            } catch (error: any) {
                console.error(`   ❌ Error checking default security groups: ${error.message}`)
            }
        }
        
        // Provide recommendations
        console.log('\n💡 Recommendations:')
        
        // Check if Redis is accessible
        const hasSecurityGroups = cluster.SecurityGroups && cluster.SecurityGroups.length > 0
        if (!hasSecurityGroups) {
            console.log('   1. Redis is using default security group')
            console.log('   2. Add inbound rule to default security group: Port 6379 from 0.0.0.0/0')
            console.log('   3. Command: aws ec2 authorize-security-group-ingress --group-id <default-sg-id> --protocol tcp --port 6379 --cidr 0.0.0.0/0')
        }
        
        console.log('   4. Test connection: npm run test:redis-connection')
        console.log('   5. If still failing, App Runner may need VPC connector')
        
    } catch (error: any) {
        console.error(`❌ Error checking Redis network config: ${error.message}`)
    }
}

if (require.main === module) {
    checkRedisNetworkConfig()
}