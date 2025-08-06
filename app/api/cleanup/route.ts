import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'fs/promises'

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
    console.log('Running cleanup for abandoned conversion jobs')

    if (!global.conversionProgress) {
      return NextResponse.json({ message: 'No jobs to clean up' })
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

    console.log(`Cleanup completed. Removed ${cleanedCount} jobs, freed ${freedSpaceMB.toFixed(2)}MB`)

    return NextResponse.json({
      message: `Cleaned up ${cleanedCount} jobs`,
      remainingJobs: Object.keys(global.conversionProgress || {}).length,
      freedSpaceMB: Math.round(freedSpaceMB)
    })
  } catch (error) {
    console.error('Cleanup error:', error)
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}