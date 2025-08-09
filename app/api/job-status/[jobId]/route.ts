import { NextRequest, NextResponse } from 'next/server'

// Simple inline job service for this endpoint to avoid import issues
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { getEnvironmentConfig } from '../../../../lib/environment'

const config = getEnvironmentConfig()
const dynamodbClient = new DynamoDBClient({
  region: config.dynamodb.region,
  ...(config.dynamodb.endpoint && { endpoint: config.dynamodb.endpoint }),
  ...(config.dynamodb.credentials && { credentials: config.dynamodb.credentials })
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  console.log(`[API] GET /api/job-status/${jobId} - Retrieving job details`)

  if (!jobId) {
    console.log(`[API] GET /api/job-status/${jobId} - Missing jobId parameter`)
    return NextResponse.json(
      { error: 'Job ID is required' },
      { status: 400 }
    )
  }

  try {
    const result = await dynamodbClient.send(new GetItemCommand({
      TableName: 'audio-conversion-jobs',
      Key: {
        jobId: { S: jobId }
      }
    }))

    if (!result.Item) {
      console.log(`[API] GET /api/job-status/${jobId} - Job not found`)
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    const job = unmarshall(result.Item)
    // Convert date strings back to Date objects
    if (job.createdAt) job.createdAt = new Date(job.createdAt)
    if (job.updatedAt) job.updatedAt = new Date(job.updatedAt)

    console.log(`[API] GET /api/job-status/${jobId} - Job retrieved successfully with status: ${job.status}`)
    
    return NextResponse.json(job, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    })
  } catch (error) {
    console.error(`[API] GET /api/job-status/${jobId} - Error retrieving job:`, error)
    
    return NextResponse.json(
      { 
        error: 'Failed to retrieve job details',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}