import { NextRequest, NextResponse } from 'next/server'
import { progressService, ProgressData } from '../../../lib/progress-service'

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const jobId = request.nextUrl.searchParams.get('jobId')
    
    if (!jobId) {
      console.log('[Progress API] Request missing jobId parameter')
      return NextResponse.json({ error: 'No job ID provided' }, { status: 400 })
    }
    
    console.log(`[Progress API] Request for jobId: ${jobId}`)
    
    // Get progress data using DynamoDB-only strategy (with job service fallback)
    const progressData = await progressService.getProgress(jobId)
    
    if (!progressData) {
      console.log(`[Progress API] Job ${jobId} not found`)
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    
    const responseTime = Date.now() - startTime
    console.log(`[Progress API] Returning progress for jobId ${jobId}: ${progressData.progress}% (${progressData.stage}) - Response time: ${responseTime}ms`)
    
    // Add proper cache headers to prevent caching of progress responses
    return NextResponse.json(progressData, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Response-Time': `${responseTime}ms`
      }
    })
  } catch (error) {
    const responseTime = Date.now() - startTime
    console.error(`[Progress API] Error after ${responseTime}ms:`, error)
    return NextResponse.json(
      { error: 'Failed to get progress' }, 
      { 
        status: 500,
        headers: {
          'X-Response-Time': `${responseTime}ms`
        }
      }
    )
  }
}