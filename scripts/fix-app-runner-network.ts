#!/usr/bin/env tsx

/**
 * Fix App Runner network connectivity to ElastiCache
 */

import { EC2Client, DescribeVpcsCommand, DescribeSecurityGroupsCommand, AuthorizeSecurityGroupIngressCommand } from '@aws-sdk/client-ec2'
import { ElastiCacheClient, DescribeCacheClustersCommand, DescribeReplicationGroupsCommand } from '@aws-sdk/client-elasticache'

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const ec2Client = new EC2Client({ region: AWS_REGION })
const elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })

async function checkNetworkSetup() {
  console.log('🔍 Checking network setup for App Runner → ElastiCache connectivity...')
  
  try {
    // Get default VPC (where App Runner runs by default)
    const vpcs = await ec2Client.send(new DescribeVpcsCommand({
      Filters: [{ Name: 'is-default', Values: ['true'] }]
    }))
    
    if (!vpcs.Vpcs || vpcs.Vpcs.length === 0) {
      console.log('❌ No default VPC found')
      return
    }
    
    const defaultVpc = vpcs.Vpcs[0]
    console.log(`✅ Default VPC: ${defaultVpc.VpcId}`)
    
    // Get ElastiCache cluster details
    const replicationGroups = await elasticacheClient.send(new DescribeReplicationGroupsCommand({}))
    
    if (!replicationGroups.ReplicationGroups || replicationGroups.ReplicationGroups.length === 0) {
      console.log('❌ No Redis replication groups found')
      return
    }
    
    const redisCluster = replicationGroups.ReplicationGroups.find(rg => 
      rg.ReplicationGroupId?.includes('audio-conversion')
    )
    
    if (!redisCluster) {
      console.log('❌ Audio conversion Redis cluster not found')
      return
    }
    
    console.log(`✅ Found Redis cluster: ${redisCluster.ReplicationGroupId}`)
    console.log(`   Status: ${redisCluster.Status}`)
    
    // Check security groups
    const securityGroups = await ec2Client.send(new DescribeSecurityGroupsCommand({
      Filters: [
        { Name: 'vpc-id', Values: [defaultVpc.VpcId!] },
        { Name: 'group-name', Values: ['default'] }
      ]
    }))
    
    if (securityGroups.SecurityGroups && securityGroups.SecurityGroups.length > 0) {
      const defaultSG = securityGroups.SecurityGroups[0]
      console.log(`✅ Default security group: ${defaultSG.GroupId}`)
      
      // Check if Redis port is open
      const hasRedisRule = defaultSG.IpPermissions?.some(rule => 
        rule.FromPort === 6379 && rule.ToPort === 6379
      )
      
      if (!hasRedisRule) {
        console.log('⚠️ Redis port 6379 not open in default security group')
        console.log('   This might be why App Runner can\'t connect to ElastiCache')
        
        // Offer to fix it
        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        })
        
        const answer = await new Promise<string>((resolve) => {
          readline.question('Add Redis port 6379 to default security group? (y/n): ', resolve)
        })
        
        readline.close()
        
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          await addRedisSecurityGroupRule(defaultSG.GroupId!)
        }
      } else {
        console.log('✅ Redis port 6379 is already open in security group')
      }
    }
    
  } catch (error: any) {
    console.error(`❌ Network check failed: ${error.message}`)
  }
}

async function addRedisSecurityGroupRule(securityGroupId: string) {
  try {
    await ec2Client.send(new AuthorizeSecurityGroupIngressCommand({
      GroupId: securityGroupId,
      IpPermissions: [{
        IpProtocol: 'tcp',
        FromPort: 6379,
        ToPort: 6379,
        IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'Redis access for App Runner' }]
      }]
    }))
    
    console.log('✅ Added Redis port 6379 to security group')
    console.log('   App Runner should now be able to connect to ElastiCache')
    
  } catch (error: any) {
    if (error.name === 'InvalidPermission.Duplicate') {
      console.log('✅ Redis port rule already exists')
    } else {
      console.error(`❌ Failed to add security group rule: ${error.message}`)
    }
  }
}

async function provideSolutions() {
  console.log('\n💡 Solutions for App Runner → ElastiCache connectivity:')
  console.log('')
  console.log('1. **Security Groups**: Ensure default security group allows port 6379')
  console.log('2. **VPC Configuration**: Both services should be in the same VPC')
  console.log('3. **Subnet Groups**: ElastiCache should use subnets in the default VPC')
  console.log('4. **TLS Configuration**: ElastiCache requires TLS in production')
  console.log('')
  console.log('Current Redis endpoint from your screenshot:')
  console.log('   master.audio-conversion-redis.u6km1j.use1.cache.amazonaws.com:6379')
  console.log('')
  console.log('Make sure your App Runner environment variables are:')
  console.log('   REDIS_ENDPOINT=master.audio-conversion-redis.u6km1j.use1.cache.amazonaws.com')
  console.log('   REDIS_PORT=6379')
  console.log('   REDIS_TLS=true')
}

async function main() {
  console.log('🔧 App Runner Network Connectivity Fix')
  console.log('=====================================')
  
  await checkNetworkSetup()
  await provideSolutions()
}

if (require.main === module) {
  main()
}