#!/usr/bin/env tsx

import { 
  ElastiCacheClient, 
  CreateReplicationGroupCommand, 
  DescribeReplicationGroupsCommand 
} from '@aws-sdk/client-elasticache'

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const REDIS_CLUSTER_ID = 'audio-conversion-redis'
const REDIS_NODE_TYPE = process.env.REDIS_NODE_TYPE || 'cache.t3.small'

const elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })

async function createRedisCluster(): Promise<void> {
  console.log('🔴 Creating Redis cluster...')
  console.log(`   Cluster ID: ${REDIS_CLUSTER_ID}`)
  console.log(`   Node Type: ${REDIS_NODE_TYPE}`)
  console.log(`   Region: ${AWS_REGION}`)
  
  try {
    // Check if cluster already exists
    const existingResult = await elasticacheClient.send(new DescribeReplicationGroupsCommand({
      ReplicationGroupId: REDIS_CLUSTER_ID
    }))
    
    if (existingResult.ReplicationGroups && existingResult.ReplicationGroups.length > 0) {
      const cluster = existingResult.ReplicationGroups[0]
      console.log(`✅ Redis cluster already exists (status: ${cluster.Status})`)
      return
    }
  } catch (error: any) {
    if (error.name !== 'ReplicationGroupNotFoundFault') {
      throw error
    }
    // Cluster doesn't exist, continue with creation
  }
  
  try {
    console.log('Creating Redis cluster...')
    await elasticacheClient.send(new CreateReplicationGroupCommand({
      ReplicationGroupId: REDIS_CLUSTER_ID,
      ReplicationGroupDescription: 'Redis cluster for audio conversion progress tracking',
      NodeType: REDIS_NODE_TYPE,
      NumCacheClusters: 1,
      Engine: 'redis',
      EngineVersion: '7.0',
      Port: 6379,
      AtRestEncryptionEnabled: true,
      TransitEncryptionEnabled: true
    }))
    
    console.log(`✅ Redis cluster '${REDIS_CLUSTER_ID}' creation initiated`)
    console.log('⏳ Cluster creation takes 10-15 minutes')
    console.log('   Check status with: npm run check:aws-resources')
    console.log('   Once available, set REDIS_ENDPOINT environment variable')
    
  } catch (createError: any) {
    console.error(`❌ Failed to create Redis cluster: ${createError.message}`)
    
    if (createError.message.includes('subnet')) {
      console.log('\n💡 Subnet group issue detected. Creating with default settings...')
      console.log('   You may need to create a subnet group manually in the AWS Console')
    }
    
    if (createError.message.includes('security')) {
      console.log('\n💡 Security group issue detected.')
      console.log('   You may need to configure security groups manually in the AWS Console')
    }
    
    console.log('\n🔧 Manual creation steps:')
    console.log('1. Go to AWS ElastiCache Console')
    console.log('2. Click "Create cache"')
    console.log('3. Choose Redis OSS')
    console.log(`4. Set cluster name: ${REDIS_CLUSTER_ID}`)
    console.log(`5. Set node type: ${REDIS_NODE_TYPE}`)
    console.log('6. Configure network settings (VPC, subnet group, security groups)')
    console.log('7. Enable encryption in transit and at rest')
    console.log('8. Create the cluster')
    
    throw createError
  }
}

async function main(): Promise<void> {
  try {
    await createRedisCluster()
  } catch (error: any) {
    console.error('\n💥 Redis cluster creation failed:', error.message)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}