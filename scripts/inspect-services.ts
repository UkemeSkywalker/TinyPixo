#!/usr/bin/env tsx

import { s3Client, dynamodbClient, getRedisClient } from '../lib/aws-services'
import { ListBucketsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { ListTablesCommand, ScanCommand } from '@aws-sdk/client-dynamodb'

async function inspectServices() {
  console.log('🔍 Inspecting Local Services...\n')

  try {
    // S3 Inspection
    console.log('📦 S3 Buckets:')
    const buckets = await s3Client.send(new ListBucketsCommand({}))
    buckets.Buckets?.forEach(bucket => {
      console.log(`  - ${bucket.Name} (created: ${bucket.CreationDate})`)
    })

    console.log('\n📁 S3 Objects in audio-conversion-bucket:')
    const objects = await s3Client.send(new ListObjectsV2Command({
      Bucket: 'audio-conversion-bucket'
    }))
    if (objects.Contents?.length) {
      objects.Contents.forEach(obj => {
        console.log(`  - ${obj.Key} (${obj.Size} bytes, modified: ${obj.LastModified})`)
      })
    } else {
      console.log('  (no objects found)')
    }

    // DynamoDB Inspection
    console.log('\n🗄️  DynamoDB Tables:')
    const tables = await dynamodbClient.send(new ListTablesCommand({}))
    tables.TableNames?.forEach(table => {
      console.log(`  - ${table}`)
    })

    console.log('\n📋 Items in audio-conversion-jobs table:')
    const items = await dynamodbClient.send(new ScanCommand({
      TableName: 'audio-conversion-jobs'
    }))
    if (items.Items?.length) {
      items.Items.forEach(item => {
        console.log(`  - Job ID: ${item.jobId?.S}, Status: ${item.status?.S}`)
      })
    } else {
      console.log('  (no items found)')
    }

    // Redis Inspection
    console.log('\n🔴 Redis Keys:')
    const redis = await getRedisClient()
    const keys = await redis.keys('*')
    if (keys.length) {
      for (const key of keys) {
        const value = await redis.get(key)
        console.log(`  - ${key}: ${value}`)
      }
    } else {
      console.log('  (no keys found)')
    }

    await redis.quit()
    console.log('\n✅ Service inspection complete!')

  } catch (error) {
    console.error('❌ Error inspecting services:', error)
  }
}

if (require.main === module) {
  inspectServices()
}