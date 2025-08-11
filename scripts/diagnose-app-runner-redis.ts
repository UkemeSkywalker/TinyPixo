#!/usr/bin/env tsx

/**
 * Diagnose App Runner Redis connectivity issues
 * This script helps identify and fix Redis connection problems in App Runner
 */

import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm'
import { ElastiCacheClient, DescribeCacheClustersCommand, DescribeReplicationGroupsCommand } from '@aws-sdk/client-elasticache'
import { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2'

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'

const ssmClient = new SSMClient({ region: AWS_REGION })
const elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })
const ec2Client = new EC2Client({ region: AWS_REGION })

async function checkParameterStore() {
  console.log('\n🔍 Checking Parameter Store values...')
  
  const parameters = [
    '/audio-converter/redis-endpoint',
    '/audio-converter/redis-port', 
    '/audio-converter/redis-tls',
    '/audio-converter/s3-bucket-name'
  ]
  
  for (const paramName of parameters) {
    try {
      const response = await ssmClient.send(new GetParameterCommand({
        Name: paramName,
        WithDecryption: true
      }))
      
      console.log(`✅ ${paramName}: ${response.Parameter?.Value}`)
    } catch (error: any) {
      if (error.name === 'ParameterNotFound') {
        console.log(`❌ ${paramName}: NOT FOUND`)
      } else {
        console.log(`❌ ${paramName}: ERROR - ${error.message}`)
      }
    }
  }
}

async function findRedisCluster() {
  console.log('\n🔍 Looking for Redis clusters...')
  
  try {
    // Check for replication groups (Redis clusters)
    const replicationGroups = await elasticacheClient.send(new DescribeReplicationGroupsCommand({}))
    
    if (replicationGroups.ReplicationGroups && replicationGroups.ReplicationGroups.length > 0) {
      console.log('\n📍 Found Redis replication groups:')
      
      for (const group of replicationGroups.ReplicationGroups) {
        console.log(`\n   Group ID: ${group.ReplicationGroupId}`)
        console.log(`   Status: ${group.Status}`)
        console.log(`   Engine: ${group.Engine} ${group.EngineVersion}`)
        
        if (group.ConfigurationEndpoint) {
          console.log(`   Configuration Endpoint: ${group.ConfigurationEndpoint.Address}:${group.ConfigurationEndpoint.Port}`)
          console.log(`   💡 Use this for REDIS_ENDPOINT: ${group.ConfigurationEndpoint.Address}`)
        } else if (group.NodeGroups && group.NodeGroups[0]?.PrimaryEndpoint) {
          console.log(`   Primary Endpoint: ${group.NodeGroups[0].PrimaryEndpoint.Address}:${group.NodeGroups[0].PrimaryEndpoint.Port}`)
          console.log(`   💡 Use this for REDIS_ENDPOINT: ${group.NodeGroups[0].PrimaryEndpoint.Address}`)
        }
        
        if (group.Status !== 'available') {
          console.log(`   ⚠️ Cluster is not available yet (Status: ${group.Status})`)
        }
      }
      
      return replicationGroups.ReplicationGroups
    }
    
    // Check for individual cache clusters
    const clusters = await elasticacheClient.send(new DescribeCacheClustersCommand({}))
    
    if (clusters.CacheClusters && clusters.CacheClusters.length > 0) {
      console.log('\n📍 Found Redis cache clusters:')
      
      for (const cluster of clusters.CacheClusters) {
        if (cluster.Engine === 'redis') {
          console.log(`\n   Cluster ID: ${cluster.CacheClusterId}`)
          console.log(`   Status: ${cluster.CacheClusterStatus}`)
          console.log(`   Engine: ${cluster.Engine} ${cluster.EngineVersion}`)
          
          if (cluster.RedisConfiguration?.PrimaryEndpoint) {
            console.log(`   Endpoint: ${cluster.RedisConfiguration.PrimaryEndpoint.Address}:${cluster.RedisConfiguration.PrimaryEndpoint.Port}`)
            console.log(`   💡 Use this for REDIS_ENDPOINT: ${cluster.RedisConfiguration.PrimaryEndpoint.Address}`)
          }
          
          if (cluster.CacheClusterStatus !== 'available') {
            console.log(`   ⚠️ Cluster is not available yet (Status: ${cluster.CacheClusterStatus})`)
          }
        }
      }
      
      return clusters.CacheClusters.filter(c => c.Engine === 'redis')
    }
    
    console.log('❌ No Redis clusters found')
    return []
    
  } catch (error: any) {
    console.error(`❌ Error checking Redis clusters: ${error.message}`)
    return []
  }
}

async function updateParameterStore(endpoint: string) {
  console.log('\n🔧 Updating Parameter Store with Redis endpoint...')
  
  const parameters = [
    { name: '/audio-converter/redis-endpoint', value: endpoint },
    { name: '/audio-converter/redis-port', value: '6379' },
    { name: '/audio-converter/redis-tls', value: 'true' }
  ]
  
  for (const param of parameters) {
    try {
      await ssmClient.send(new PutParameterCommand({
        Name: param.name,
        Value: param.value,
        Type: 'String',
        Overwrite: true
      }))
      
      console.log(`✅ Updated ${param.name}: ${param.value}`)
    } catch (error: any) {
      console.error(`❌ Failed to update ${param.name}: ${error.message}`)
    }
  }
}

async function checkNetworkConfiguration() {
  console.log('\n🌐 Checking network configuration...')
  
  try {
    // Get default VPC
    const vpcs = await ec2Client.send(new DescribeVpcsCommand({
      Filters: [{ Name: 'is-default', Values: ['true'] }]
    }))
    
    if (vpcs.Vpcs && vpcs.Vpcs.length > 0) {
      const defaultVpc = vpcs.Vpcs[0]
      console.log(`✅ Default VPC: ${defaultVpc.VpcId}`)
      
      // Get subnets in default VPC
      const subnets = await ec2Client.send(new DescribeSubnetsCommand({
        Filters: [{ Name: 'vpc-id', Values: [defaultVpc.VpcId!] }]
      }))
      
      if (subnets.Subnets) {
        console.log(`✅ Found ${subnets.Subnets.length} subnets in default VPC`)
        for (const subnet of subnets.Subnets) {
          console.log(`   - ${subnet.SubnetId} (${subnet.AvailabilityZone})`)
        }
      }
    } else {
      console.log('❌ No default VPC found')
    }
    
  } catch (error: any) {
    console.error(`❌ Error checking network: ${error.message}`)
  }
}

async function provideSolutions() {
  console.log('\n💡 Common solutions for Redis connection timeouts in App Runner:')
  console.log('')
  console.log('1. **Parameter Store Issues:**')
  console.log('   - Ensure all parameters are set in Parameter Store')
  console.log('   - App Runner service role needs SSM permissions')
  console.log('')
  console.log('2. **Network Connectivity:**')
  console.log('   - Redis cluster must be in same VPC as App Runner')
  console.log('   - App Runner uses default VPC by default')
  console.log('   - Check security groups allow port 6379 from App Runner')
  console.log('')
  console.log('3. **Redis Cluster Status:**')
  console.log('   - Cluster must be in "available" status')
  console.log('   - Wait 10-15 minutes after creation')
  console.log('')
  console.log('4. **TLS Configuration:**')
  console.log('   - ElastiCache Redis requires TLS in production')
  console.log('   - Ensure REDIS_TLS=true in Parameter Store')
  console.log('')
  console.log('5. **App Runner Service Role:**')
  console.log('   - Must have permissions for SSM Parameter Store')
  console.log('   - Must have network access to ElastiCache')
}

async function main() {
  console.log('🔍 App Runner Redis Connectivity Diagnostics')
  console.log('============================================')
  
  try {
    await checkParameterStore()
    const clusters = await findRedisCluster()
    await checkNetworkConfiguration()
    
    // If we found a cluster and parameters are missing, offer to update them
    if (clusters.length > 0) {
      const cluster = clusters[0]
      let endpoint = ''
      
      if ('ConfigurationEndpoint' in cluster && cluster.ConfigurationEndpoint) {
        endpoint = cluster.ConfigurationEndpoint.Address!
      } else if ('RedisConfiguration' in cluster && cluster.RedisConfiguration?.PrimaryEndpoint) {
        endpoint = cluster.RedisConfiguration.PrimaryEndpoint.Address!
      } else if ('NodeGroups' in cluster && cluster.NodeGroups?.[0]?.PrimaryEndpoint) {
        endpoint = cluster.NodeGroups[0].PrimaryEndpoint.Address!
      }
      
      if (endpoint) {
        console.log(`\n🎯 Recommended Redis endpoint: ${endpoint}`)
        
        // Ask if user wants to update Parameter Store
        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        })
        
        const answer = await new Promise<string>((resolve) => {
          readline.question('\nUpdate Parameter Store with this endpoint? (y/n): ', resolve)
        })
        
        readline.close()
        
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          await updateParameterStore(endpoint)
          console.log('\n✅ Parameter Store updated!')
          console.log('   Redeploy your App Runner service to pick up the new values')
        }
      }
    }
    
    await provideSolutions()
    
  } catch (error: any) {
    console.error(`❌ Diagnostic failed: ${error.message}`)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}