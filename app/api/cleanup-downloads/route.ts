import { NextRequest, NextResponse } from 'next/server'
import { downloadCleanupService } from '../../../lib/download-cleanup-service'

/**
 * Cleanup endpoint for managing downloaded files
 * This can be called periodically by a cron job or monitoring system
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'cleanup'
    const olderThanHours = parseInt(searchParams.get('olderThanHours') || '24')

    console.log(`[CleanupDownloads] Starting ${action} operation`)

    let result: any = {}

    switch (action) {
      case 'cleanup':
        await downloadCleanupService.cleanupCompletedDownloads({
          maxAgeHours: olderThanHours,
          batchSize: 100,
          dryRun: false
        })
        result = { message: `Cleanup completed for files older than ${olderThanHours} hours` }
        break

      case 'orphaned':
        await downloadCleanupService.cleanupOrphanedFiles()
        result = { message: 'Orphaned file cleanup completed' }
        break

      case 'stats':
        const stats = await downloadCleanupService.getCleanupStats()
        result = {
          message: 'Storage statistics retrieved',
          stats: {
            ...stats,
            estimatedCleanupSizeMB: Math.round(stats.estimatedCleanupSize / (1024 * 1024) * 100) / 100
          }
        }
        break

      case 'full':
        // Run both cleanup operations
        await downloadCleanupService.cleanupCompletedDownloads({
          maxAgeHours: olderThanHours,
          batchSize: 100,
          dryRun: false
        })
        await downloadCleanupService.cleanupOrphanedFiles()
        const finalStats = await downloadCleanupService.getCleanupStats()
        result = {
          message: 'Full cleanup completed',
          stats: {
            ...finalStats,
            estimatedCleanupSizeMB: Math.round(finalStats.estimatedCleanupSize / (1024 * 1024) * 100) / 100
          }
        }
        break

      default:
        return NextResponse.json({
          error: 'Invalid action. Use: cleanup, orphaned, stats, or full'
        }, { status: 400 })
    }

    const duration = Date.now() - startTime
    console.log(`[CleanupDownloads] ${action} operation completed in ${duration}ms`)

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      ...result
    })

  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[CleanupDownloads] Error after ${duration}ms:`, error)
    
    return NextResponse.json({
      success: false,
      error: 'Cleanup operation failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      duration: `${duration}ms`
    }, { status: 500 })
  }
}

/**
 * GET endpoint for checking cleanup status and statistics
 */
export async function GET(request: NextRequest) {
  try {
    console.log('[CleanupDownloads] Getting storage statistics')
    
    const stats = await downloadCleanupService.getCleanupStats()
    
    return NextResponse.json({
      success: true,
      stats: {
        ...stats,
        estimatedCleanupSizeMB: Math.round(stats.estimatedCleanupSize / (1024 * 1024) * 100) / 100
      }
    })

  } catch (error) {
    console.error('[CleanupDownloads] Failed to get statistics:', error)
    
    return NextResponse.json({
      success: false,
      error: 'Failed to get cleanup statistics',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}