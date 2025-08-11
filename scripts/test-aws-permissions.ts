#!/usr/bin/env tsx

import { S3Client, ListBucketsCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import { getEnvironmentConfig } from '../lib/environment'

async function testAWSPermissions() {
  console.log('🧪 Testing AWS permissions...')
  
  const config = getEnvironmentConfig()
  console.log(`Environment: ${config.environment}`)
  console.log(`Region: ${config.s3.region}`)
  
  // Test S3 permissions
  console.log('\n📦 Testing S3 permissions...')
  const s3Client = new S3Client(config.s3)
  
  try {
    // List all buckets
    const bucketsResult = await s3Client.send(new ListBucketsCommand({}))
    console.log('✅ S3 ListBuckets permission: OK')
    console.log('Available buckets:')
    bucketsResult.Buckets?.forEach(bucket => {
      console.log(`  - ${bucket.Name}`)
    })
    
    // Test specific bucket access
    const bucketName = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'
    console.log(`\nTesting access to bucket: ${bucketName}`)
    
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }))
      console.log(`✅ Access to bucket '${bucketName}': OK`)
    } catch (bucketError: any) {
      console.log(`❌ Access to bucket '${bucketName}': ${bucketError.message}`)
      console.log(`Error code: ${bucketError.name}`)
    }
    
  } catch (s3Error: any) {
    console.log(`❌ S3 permissions error: ${s3Error.message}`)
  }
  
  // Test DynamoDB permissions
  console.log('\n🗄️ Testing DynamoDB permissions...')
  const dynamoClient = new DynamoDBClient(config.dynamodb)
  
  try {
    const tablesResult = await dynamoClient.send(new ListTablesCommand({}))
    console.log('✅ DynamoDB ListTables permission: OK')
    console.log('Available tables:')
    tablesResult.TableNames?.forEach(table => {
      console.log(`  - ${table}`)
    })
  } catch (dynamoError: any) {
    console.log(`❌ DynamoDB permissions error: ${dynamoError.message}`)
  }
  
  console.log('\n🔍 AWS Credentials Info:')
  console.log(`AWS_REGION: ${process.env.AWS_REGION}`)
  console.log(`AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID ? 'Set' : 'Not set'}`)
  console.log(`AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET_ACCESS_KEY ? 'Set' : 'Not set'}`)
  console.log(`AWS_PROFILE: ${process.env.AWS_PROFILE || 'Not set'}`)
}

testAWSPermissions().catch(console.error)