import { NextRequest, NextResponse } from 'next/server'
import { progressService } from '../../../lib/progress-service'

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const jobId = request.nextUrl.searchParams.get('jobId')
    
    if (!jobId) {
      console.log('[FFmpeg Logs API] Request missing jobId parameter')
      return NextResponse.json({ error: 'No job ID provided' }, { status: 400 })
    }
    
    console.log(`[FFmpeg Logs API] Request for jobId: ${jobId}`)
    
    // Get FFmpeg logs
    const logs = await progressService.getFFmpegLogs(jobId)
    
    const responseTime = Date.now() - startTime
    console.log(`[FFmpeg Logs API] Returning ${logs.length} log lines for jobId ${jobId} - Response time: ${responseTime}ms`)
    
    // Add proper cache headers to prevent caching of log responses
    return NextResponse.json({ 
      jobId,
      logs,
      logCount: logs.length,
      retrievedAt: new Date().toISOString()
    }, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Response-Time': `${responseTime}ms`
      }
    })
  } catch (error) {
    const responseTime = Date.now() - startTime
    console.error(`[FFmpeg Logs API] Error after ${responseTime}ms:`, error)
    return NextResponse.json(
      { error: 'Failed to get FFmpeg logs' }, 
      { 
        status: 500,
        headers: {
          'X-Response-Time': `${responseTime}ms`
        }
      }
    )
  }
}