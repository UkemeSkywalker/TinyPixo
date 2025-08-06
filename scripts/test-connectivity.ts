#!/usr/bin/env tsx

import { s3Client, dynamodbClient, getRedisClient, initializeAllServices } from '../lib/aws-services'
import { getEnvironmentConfig } from '../lib/environment'
import { 
  ListBucketsCommand, 
  PutObjectCommand, 
  GetObjectCommand, 
  DeleteObjectCommand 
} from '@aws-sdk/client-s3'
import { 
  ListTablesCommand, 
  PutItemCommand, 
  GetItemCommand, 
  DeleteItemCommand 
} from '@aws-sdk/client-dynamodb'

async function testS3Connectivity(): Promise<void> {
  console.log('\n🧪 Testing S3 connectivity...')
  
  try {
    // List buckets
    const listResult = await s3Client.send(new ListBucketsCommand({}))
    console.log('✅ S3 connection successful')
    console.log(`   Found ${listResult.Buckets?.length || 0} buckets`)
    
    // Test upload
    const testKey = `test-${Date.now()}.txt`
    await s3Client.send(new PutObjectCommand({
      Bucket: 'audio-conversion-bucket',
      Key: testKey,
      Body: 'Test connectivity'
    }))
    console.log('✅ S3 upload test successful')
    
    // Test download
    const getResult = await s3Client.send(new GetObjectCommand({
      Bucket: 'audio-conversion-bucket',
      Key: testKey
    }))
    console.log('✅ S3 download test successful')
    
    // Cleanup
    await s3Client.send(new DeleteObjectCommand({
      Bucket: 'audio-conversion-bucket',
      Key: testKey
    }))
    console.log('✅ S3 cleanup successful')
    
  } catch (error) {
    console.error('❌ S3 connectivity test failed:', error)
    throw error
  }
}

async function testDynamoDBConnectivity(): Promise<void> {
  console.log('\n🧪 Testing DynamoDB connectivity...')
  
  try {
    // List tables
    const listResult = await dynamodbClient.send(new ListTablesCommand({}))
    console.log('✅ DynamoDB connection successful')
    console.log(`   Found ${listResult.TableNames?.length || 0} tables`)
    
    // Test put item
    const testJobId = `test-job-${Date.now()}`
    await dynamodbClient.send(new PutItemCommand({
      TableName: 'audio-conversion-jobs',
      Item: {
        jobId: { S: testJobId },
        status: { S: 'test' },
        createdAt: { S: new Date().toISOString() },
        ttl: { N: Math.floor(Date.now() / 1000 + 3600).toString() }
      }
    }))
    console.log('✅ DynamoDB put item test successful')
    
    // Test get item
    const getResult = await dynamodbClient.send(new GetItemCommand({
      TableName: 'audio-conversion-jobs',
      Key: {
        jobId: { S: testJobId }
      }
    }))
    
    if (getResult.Item) {
      console.log('✅ DynamoDB get item test successful')
    } else {
      throw new Error('Item not found after put')
    }
    
    // Cleanup
    await dynamodbClient.send(new DeleteItemCommand({
      TableName: 'audio-conversion-jobs',
      Key: {
        jobId: { S: testJobId }
      }
    }))
    console.log('✅ DynamoDB cleanup successful')
    
  } catch (error) {
    console.error('❌ DynamoDB connectivity test failed:', error)
    throw error
  }
}

async function testRedisConnectivity(): Promise<void> {
  console.log('\n🧪 Testing Redis connectivity...')
  
  try {
    const redis = await getRedisClient()
    
    // Test set/get
    const testKey = `test-key-${Date.now()}`
    const testValue = 'test-value'
    
    await redis.set(testKey, testValue)
    console.log('✅ Redis set operation successful')
    
    const retrievedValue = await redis.get(testKey)
    if (retrievedValue === testValue) {
      console.log('✅ Redis get operation successful')
    } else {
      throw new Error(`Expected '${testValue}', got '${retrievedValue}'`)
    }
    
    // Test expiration
    await redis.setEx(`${testKey}-ttl`, 1, 'expires-soon')
    console.log('✅ Redis TTL set operation successful')
    
    // Cleanup
    await redis.del(testKey)
    console.log('✅ Redis cleanup successful')
    
  } catch (error) {
    console.error('❌ Redis connectivity test failed:', error)
    throw error
  }
}

async function main(): Promise<void> {
  console.log('🚀 Starting connectivity tests...')
  
  const config = getEnvironmentConfig()
  console.log(`Environment: ${config.environment}`)
  console.log(`S3 endpoint: ${config.s3.endpoint || 'AWS managed'}`)
  console.log(`DynamoDB endpoint: ${config.dynamodb.endpoint || 'AWS managed'}`)
  console.log(`Redis host: ${config.redis.host}:${config.redis.port}`)
  
  try {
    // Initialize services first
    await initializeAllServices()
    
    // Run connectivity tests
    await testS3Connectivity()
    await testDynamoDBConnectivity()
    await testRedisConnectivity()
    
    console.log('\n🎉 All connectivity tests passed!')
    
  } catch (error) {
    console.error('\n💥 Connectivity tests failed:', error)
    process.exit(1)
  } finally {
    // Close Redis connection
    try {
      const redis = await getRedisClient()
      await redis.quit()
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

if (require.main === module) {
  main()
}