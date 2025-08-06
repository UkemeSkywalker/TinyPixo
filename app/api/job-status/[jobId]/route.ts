import { NextRequest, NextResponse } from 'next/server'

// Simple inline job service for this endpoint to avoid import issues
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'

const dynamodbClient = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:8000',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test'
  }
})

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params

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