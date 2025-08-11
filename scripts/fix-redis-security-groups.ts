#!/usr/bin/env tsx

/**
 * Fix Redis security group to allow App Runner connections
 */

import { 
    ElastiCacheClient, 
    DescribeReplicationGroupsCommand 
} from '@aws-sdk/client-elasticache'
import { 
    EC2Client, 
    DescribeSecurityGroupsCommand,
    AuthorizeSecurityGroupIngressCommand,
    RevokeSecurityGroupIngressCommand
} from '@aws-sdk/client-ec2'

const AWS_REGION = 'us-east-1'
const REDIS_CLUSTER_ID = 'audio-conversion-redis'

const elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })
const ec2Client = new EC2Client({ region: AWS_REGION })

async function fixRedisSecurityGroup() {
    console.log('🔧 Fixing Redis security group for App Runner access...')
    
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
        
        console.log(`✅ Found Redis cluster: ${cluster.ReplicationGroupId} (${cluster.Status})`)
        
        // Get security groups
        const securityGroupIds = cluster.SecurityGroups?.map(sg => sg.SecurityGroupId).filter(Boolean) as string[]
        
        if (!securityGroupIds || securityGroupIds.length === 0) {
            console.error('❌ No security groups found on Redis cluster')
            return
        }
        
        console.log(`🔍 Checking security groups: ${securityGroupIds.join(', ')}`)
        
        const sgResult = await ec2Client.send(new DescribeSecurityGroupsCommand({
            GroupIds: securityGroupIds
        }))
        
        for (const sg of sgResult.SecurityGroups || []) {
            console.log(`\n🔒 Security Group: ${sg.GroupId} (${sg.GroupName})`)
            
            // Check existing rules
            let hasRedisRule = false
            let hasOpenRule = false
            
            for (const rule of sg.IpPermissions || []) {
                if (rule.FromPort === 6379 && rule.ToPort === 6379) {
                    hasRedisRule = true
                    const sources = [
                        ...(rule.IpRanges?.map(ip => `${ip.CidrIp} (${ip.Description || 'no description'})`) || []),
                        ...(rule.UserIdGroupPairs?.map(pair => `${pair.GroupId} (${pair.Description || 'security group'})`) || [])
                    ]
                    console.log(`   ✅ Existing Redis rule: ${sources.join(', ')}`)
                    
                    // Check if it's open to all
                    if (rule.IpRanges?.some(ip => ip.CidrIp === '0.0.0.0/0')) {
                        hasOpenRule = true
                    }
                }
            }
            
            if (!hasRedisRule) {
                console.log('   ❌ No Redis port 6379 rule found')
                console.log('   🔧 Adding rule to allow Redis access from anywhere...')
                
                try {
                    await ec2Client.send(new AuthorizeSecurityGroupIngressCommand({
                        GroupId: sg.GroupId,
                        IpPermissions: [{
                            IpProtocol: 'tcp',
                            FromPort: 6379,
                            ToPort: 6379,
                            IpRanges: [{
                                CidrIp: '0.0.0.0/0',
                                Description: 'Redis access for App Runner'
                            }]
                        }]
                    }))
                    
                    console.log('   ✅ Added Redis access rule (0.0.0.0/0:6379)')
                } catch (error: any) {
                    if (error.name === 'InvalidPermission.Duplicate') {
                        console.log('   ✅ Rule already exists')
                    } else {
                        console.error(`   ❌ Failed to add rule: ${error.message}`)
                    }
                }
            } else if (!hasOpenRule) {
                console.log('   ⚠️ Redis rule exists but may be too restrictive for App Runner')
                console.log('   💡 App Runner uses dynamic IPs, consider allowing 0.0.0.0/0 for port 6379')
                
                const readline = require('readline').createInterface({
                    input: process.stdin,
                    output: process.stdout
                })
                
                const answer = await new Promise<string>((resolve) => {
                    readline.question('   Add open rule for App Runner? (y/n): ', resolve)
                })
                
                readline.close()
                
                if (answer.toLowerCase() === 'y') {
                    try {
                        await ec2Client.send(new AuthorizeSecurityGroupIngressCommand({
                            GroupId: sg.GroupId,
                            IpPermissions: [{
                                IpProtocol: 'tcp',
                                FromPort: 6379,
                                ToPort: 6379,
                                IpRanges: [{
                                    CidrIp: '0.0.0.0/0',
                                    Description: 'Redis access for App Runner'
                                }]
                            }]
                        }))
                        
                        console.log('   ✅ Added open Redis access rule')
                    } catch (error: any) {
                        if (error.name === 'InvalidPermission.Duplicate') {
                            console.log('   ✅ Rule already exists')
                        } else {
                            console.error(`   ❌ Failed to add rule: ${error.message}`)
                        }
                    }
                }
            } else {
                console.log('   ✅ Redis access rule looks good')
            }
        }
        
        console.log('\n🎉 Security group check complete!')
        console.log('💡 If Redis still doesn\'t work, the issue might be:')
        console.log('   1. App Runner VPC connectivity (needs VPC connector)')
        console.log('   2. Redis cluster subnet group configuration')
        console.log('   3. App Runner service role permissions')
        
    } catch (error: any) {
        console.error(`❌ Error fixing security groups: ${error.message}`)
    }
}

if (require.main === module) {
    fixRedisSecurityGroup()
}