import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'fs/promises'
import { jobService } from '../../../lib/job-service'
import { downloadCleanupService } from '../../../lib/download-cleanup-service'

type ConversionProgress = {
  jobId: string
  progress: number
  status?: string
  startTime?: number
  estimatedTimeRemaining?: number | null
  outputBuffer?: Buffer
  outputPath?: string
  format?: string
  isLargeFile?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const dryRun = searchParams.get('dryRun') === 'true'
    const maxAgeHours = parseInt(searchParams.get('maxAgeHours') || '24')
    const batchSize = parseInt(searchParams.get('batchSize') || '100')
    const cleanupType = searchParams.get('type') || 'all' // 'memory', 's3', or 'all'
    
    console.log(`[Cleanup] Starting cleanup process (type: ${cleanupType}, dryRun: ${dryRun}, maxAge: ${maxAgeHours}h)`)

    let memoryCleanupResult = { cleanedCount: 0, freedSpaceMB: 0 }
    let s3CleanupResult = null

    // Clean up in-memory conversion progress (existing functionality)
    if (cleanupType === 'memory' || cleanupType === 'all') {
      memoryCleanupResult = await cleanupMemoryJobs()
    }

    // Clean up S3 files and DynamoDB jobs (new functionality)
    if (cleanupType === 's3' || cleanupType === 'all') {
      // Run cleanup for expired jobs in DynamoDB
      await jobService.cleanupExpiredJobs()
      
      // Run download file cleanup in S3
      s3CleanupResult = await downloadCleanupService.cleanupCompletedDownloads({
        maxAgeHours,
        batchSize,
        dryRun
      })
    }

    console.log('[Cleanup] Cleanup completed successfully')

    return NextResponse.json({
      success: true,
      message: 'Cleanup completed successfully',
      memoryCleanup: memoryCleanupResult,
      s3Cleanup: s3CleanupResult
    })

  } catch (error) {
    console.error('[Cleanup] Error:', error)
    return NextResponse.json({
      error: 'Failed to run cleanup',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

/**
 * Get cleanup statistics
 */
export async function GET(request: NextRequest) {
  try {
    console.log('[Cleanup] Getting cleanup statistics...')
    
    // Get memory stats
    const memoryJobs = Object.keys(global.conversionProgress || {}).length
    
    // Get S3 stats
    const s3Stats = await downloadCleanupService.getCleanupStats()
    
    return NextResponse.json({
      success: true,
      stats: {
        memoryJobs,
        s3Files: s3Stats
      }
    })
    
  } catch (error) {
    console.error('[Cleanup] Error getting stats:', error)
    return NextResponse.json({
      error: 'Failed to get cleanup statistics',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

/**
 * Clean up in-memory conversion jobs (existing functionality)
 */
async function cleanupMemoryJobs(): Promise<{ cleanedCount: number, freedSpaceMB: number }> {
  console.log('Running cleanup for abandoned conversion jobs in memory')

  if (!global.conversionProgress) {
    return { cleanedCount: 0, freedSpaceMB: 0 }
  }

  const now = Date.now()
  const maxAge = 30 * 60 * 1000 // 30 minutes
  let cleanedCount = 0
  let freedSpaceMB = 0

  for (const [jobId, progressData] of Object.entries(global.conversionProgress) as [string, ConversionProgress][]) {
    const jobAge = now - (progressData.startTime || 0)

    // Clean up jobs older than 30 minutes, failed jobs, or if disk space is low
    const shouldCleanup = jobAge > maxAge ||
      progressData.progress === -1 ||
      (progressData.isLargeFile && jobAge > 10 * 60 * 1000) // Large files after 10 min

    if (shouldCleanup) {
      console.log(`Cleaning up job ${jobId} (age: ${Math.round(jobAge / 1000)}s, progress: ${progressData.progress})`)

      // Clean up output file if it exists
      if (progressData.outputPath) {
        try {
          const stats = await import('fs/promises').then(fs =>
            fs.stat(progressData.outputPath).catch(() => ({ size: 0 }))
          )
          const fileSizeMB = stats.size / (1024 * 1024)

          await unlink(progressData.outputPath)
          freedSpaceMB += fileSizeMB
          console.log(`Deleted output file: ${progressData.outputPath} (${fileSizeMB.toFixed(2)}MB)`)
        } catch (error) {
          console.log(`Output file already cleaned up: ${progressData.outputPath}`)
        }
      }

      // Remove from memory
      delete global.conversionProgress[jobId]
      cleanedCount++
    }
  }

  console.log(`Memory cleanup completed. Removed ${cleanedCount} jobs, freed ${freedSpaceMB.toFixed(2)}MB`)

  return {
    cleanedCount,
    freedSpaceMB: Math.round(freedSpaceMB)
  }
}