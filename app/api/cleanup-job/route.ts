import { NextRequest, NextResponse } from 'next/server'
import { progressService } from '../../../lib/progress-service'
import { streamingConversionServiceFixed } from '../../../lib/streaming-conversion-service-fixed'

export async function POST(request: NextRequest) {
  try {
    const { jobId, reason } = await request.json()
    
    if (!jobId) {
      return NextResponse.json({ error: 'No job ID provided' }, { status: 400 })
    }
    
    console.log(`[Cleanup API] Cleaning up job: ${jobId}, reason: ${reason || 'Manual cleanup'}`)
    
    // 1. Check and terminate any active processes
    const activeProcesses = streamingConversionServiceFixed.getActiveProcesses()
    
    if (activeProcesses.has(jobId)) {
      console.log(`[Cleanup API] Found active process for job ${jobId} - terminating...`)
      const process = activeProcesses.get(jobId)!
      
      try {
        if (process.pid && !process.killed) {
          process.kill('SIGTERM')
          console.log(`[Cleanup API] Sent SIGTERM to process ${process.pid}`)
          
          // Force kill after 5 seconds if needed
          setTimeout(() => {
            if (!process.killed) {
              process.kill('SIGKILL')
              console.log(`[Cleanup API] Force killed process ${process.pid}`)
            }
          }, 5000)
        }
      } catch (error) {
        console.error(`[Cleanup API] Error terminating process:`, error)
      }
    }

    // 2. Mark the job as failed in progress service
    await progressService.markFailed(jobId, reason || 'Job manually terminated')
    console.log(`[Cleanup API] Job ${jobId} marked as failed`)

    return NextResponse.json({ 
      success: true, 
      message: `Job ${jobId} cleaned up successfully` 
    })

  } catch (error) {
    console.error('[Cleanup API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to cleanup job' }, 
      { status: 500 }
    )
  }
}