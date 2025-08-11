import { NextResponse } from 'next/server'

/**
 * Redis status endpoint - Redis has been replaced with DynamoDB
 * This endpoint now returns information about the migration to DynamoDB
 */
export async function GET() {
  const redisStatus = {
    status: 'migrated_to_dynamodb',
    timestamp: new Date().toISOString(),
    message: 'Redis has been replaced with DynamoDB for all caching and progress tracking',
    migration: {
      completed: true,
      date: '2025-08-09',
      reason: 'Improved reliability and AWS App Runner compatibility',
      replacement: 'DynamoDB with TTL for automatic cleanup'
    },
    services: {
      progress_tracking: 'DynamoDB (audio-conversion-progress table)',
      upload_progress: 'DynamoDB (audio-conversion-uploads table)',
      job_storage: 'DynamoDB (audio-conversion-jobs table)'
    }
  }
  
  return NextResponse.json(redisStatus, {
    status: 200,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  })
}