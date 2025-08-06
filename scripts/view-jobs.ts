#!/usr/bin/env tsx

/**
 * Script to view all jobs in DynamoDB LocalStack
 */

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'

const client = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:8000',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test'
  }
})

async function viewJobs() {
  try {
    console.log('📋 Scanning DynamoDB for all jobs...\n')
    
    const result = await client.send(new ScanCommand({
      TableName: 'audio-conversion-jobs'
    }))
    
    if (!result.Items || result.Items.length === 0) {
      console.log('No jobs found in the database.')
      return
    }
    
    console.log(`Found ${result.Items.length} job(s):\n`)
    
    result.Items.forEach((item, index) => {
      const job = unmarshall(item)
      console.log(`Job ${index + 1}:`)
      console.log(`  Job ID: ${job.jobId}`)
      console.log(`  Status: ${job.status}`)
      console.log(`  Format: ${job.format}`)
      console.log(`  Quality: ${job.quality}`)
      console.log(`  Created: ${new Date(job.createdAt).toLocaleString()}`)
      console.log(`  Updated: ${new Date(job.updatedAt).toLocaleString()}`)
      console.log(`  TTL: ${job.ttl} (expires: ${new Date(job.ttl * 1000).toLocaleString()})`)
      console.log(`  Input S3: ${job.inputS3Location.bucket}/${job.inputS3Location.key}`)
      
      if (job.outputS3Location) {
        console.log(`  Output S3: ${job.outputS3Location.bucket}/${job.outputS3Location.key}`)
      }
      
      if (job.error) {
        console.log(`  Error: ${job.error}`)
      }
      
      console.log('') // Empty line between jobs
    })
    
  } catch (error) {
    console.error('Error viewing jobs:', error)
  }
}

viewJobs()