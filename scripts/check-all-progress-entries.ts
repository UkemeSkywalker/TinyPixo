#!/usr/bin/env tsx

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { getEnvironmentConfig } from '../lib/environment'

const STUCK_JOB_ID = '1755036398339'

async function checkAllProgressEntries() {
  console.log(`🔍 Checking ALL progress entries for job: ${STUCK_JOB_ID}`)
  console.log('=' .repeat(60))

  try {
    const config = getEnvironmentConfig()
    const client = new DynamoDBClient({
      region: config.dynamodb.region,
      endpoint: config.dynamodb.endpoint,
      credentials: config.dynamodb.credentials
    })

    // Scan the progress table for this job
    const scanCommand = new ScanCommand({
      TableName: 'audio-conversion-progress',
      FilterExpression: 'jobId = :jobId',
      ExpressionAttributeValues: {
        ':jobId': { S: STUCK_JOB_ID }
      }
    })

    const result = await client.send(scanCommand)
    
    if (result.Items && result.Items.length > 0) {
      console.log(`\n📊 Found ${result.Items.length} progress entries:`)
      
      result.Items.forEach((item, index) => {
        const progressData = unmarshall(item)
        console.log(`\n  Entry ${index + 1}:`)
        console.log(`    Job ID: ${progressData.jobId}`)
        console.log(`    Progress: ${progressData.progress}%`)
        console.log(`    Stage: ${progressData.stage}`)
        console.log(`    Current Time: ${progressData.currentTime || 'N/A'}`)
        console.log(`    Total Duration: ${progressData.totalDuration || 'N/A'}`)
        console.log(`    Updated At: ${new Date(progressData.updatedAt).toISOString()}`)
        console.log(`    TTL: ${progressData.ttl} (${new Date(progressData.ttl * 1000).toISOString()})`)
        console.log(`    Error: ${progressData.error || 'None'}`)
      })
    } else {
      console.log('  ❌ No progress entries found')
    }

    // Also check if there are any other jobs currently processing
    console.log('\n🔄 Checking for other active jobs:')
    const allActiveCommand = new ScanCommand({
      TableName: 'audio-conversion-progress',
      FilterExpression: 'stage <> :completed AND stage <> :failed',
      ExpressionAttributeValues: {
        ':completed': { S: 'completed' },
        ':failed': { S: 'failed' }
      }
    })

    const activeResult = await client.send(allActiveCommand)
    
    if (activeResult.Items && activeResult.Items.length > 0) {
      console.log(`  Found ${activeResult.Items.length} active jobs:`)
      
      activeResult.Items.forEach((item) => {
        const progressData = unmarshall(item)
        console.log(`    Job ${progressData.jobId}: ${progressData.progress}% (${progressData.stage})`)
      })
    } else {
      console.log('  No other active jobs found')
    }

  } catch (error) {
    console.error('❌ Error checking progress entries:', error)
  }
}

checkAllProgressEntries().catch(console.error)