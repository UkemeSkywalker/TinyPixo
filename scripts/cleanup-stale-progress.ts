#!/usr/bin/env tsx

/**
 * Cleanup script for stale progress data
 */

import { progressService } from '../lib/progress-service'

async function cleanupStaleProgress() {
  console.log('🧹 Cleaning up stale progress data...')

  try {
    // Clean up expired progress data
    await progressService.cleanupExpiredProgress()
    console.log('✅ Stale progress data cleaned up successfully')

    // You can also manually clean specific job IDs if needed
    const staleJobIds = [
      '1755185236317', // The stuck job from your logs
      // Add other stuck job IDs here if needed
    ]

    for (const jobId of staleJobIds) {
      try {
        console.log(`🗑️  Checking job ${jobId}...`)
        const progress = await progressService.getProgress(jobId)
        if (progress && progress.progress < 100 && progress.phase !== 'completed') {
          console.log(`  Found stale job ${jobId} at ${progress.progress}% (${progress.stage})`)
          // Mark it as failed to stop polling
          await progressService.markFailed(jobId, 'Cleaned up stale progress data')
          console.log(`  ✅ Marked job ${jobId} as failed to stop polling`)
        } else if (progress) {
          console.log(`  Job ${jobId} is already completed (${progress.progress}%)`)
        } else {
          console.log(`  Job ${jobId} not found`)
        }
      } catch (error) {
        console.error(`  ❌ Failed to clean job ${jobId}:`, error)
      }
    }

    console.log('🎉 Cleanup completed!')

  } catch (error) {
    console.error('❌ Cleanup failed:', error)
    throw error
  }
}

// Run the cleanup
async function main() {
  console.log('🚀 Starting Stale Progress Cleanup\n')
  
  try {
    await cleanupStaleProgress()
    
    console.log('\n✅ All cleanup tasks completed!')
    console.log('📝 Next steps:')
    console.log('  1. Refresh your browser to stop polling old job IDs')
    console.log('  2. Test with a new file conversion')
    console.log('  3. The 3-phase progress system should work perfectly')
    
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}