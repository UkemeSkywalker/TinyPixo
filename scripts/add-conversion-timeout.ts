#!/usr/bin/env tsx

/**
 * Add timeout mechanism to prevent stuck conversions
 */

import { progressService } from '../lib/progress-service'
import { jobService, JobStatus } from '../lib/job-service'

async function checkAndTimeoutStuckJobs() {
  console.log('🔍 Checking for stuck conversion jobs...')

  try {
    // This would typically scan for jobs that have been processing too long
    // For now, we'll implement a basic version that can handle specific job IDs
    
    const stuckJobIds = [
      '1755194010224', // Your current stuck job
      // Add other stuck job IDs here
    ]

    for (const jobId of stuckJobIds) {
      try {
        console.log(`🔍 Checking job ${jobId}...`)
        
        const progress = await progressService.getProgress(jobId)
        const job = await jobService.getJob(jobId)
        
        if (!progress || !job) {
          console.log(`  ❌ Job ${jobId} not found`)
          continue
        }

        const timeSinceUpdate = Date.now() - progress.updatedAt
        const timeSinceCreated = job.createdAt ? Date.now() - job.createdAt : 0

        console.log(`  📊 Job ${jobId}: ${progress.progress}% (${progress.stage})`)
        console.log(`  ⏰ Time since update: ${Math.round(timeSinceUpdate / 1000)}s`)
        console.log(`  ⏰ Total processing time: ${Math.round(timeSinceCreated / 1000)}s`)

        // Timeout conditions
        const isStuck = timeSinceUpdate > 300000 // 5 minutes without update
        const isTooLong = timeSinceCreated > 900000 // 15 minutes total
        const isLargeFile = job.inputS3Location.size > 100 * 1024 * 1024 // > 100MB

        if (isStuck || isTooLong) {
          console.log(`  🚨 Job ${jobId} appears stuck - timing out`)
          
          // Mark job as failed
          await jobService.updateJobStatus(jobId, JobStatus.FAILED, undefined, 'Job timed out due to inactivity')
          await progressService.markFailed(jobId, 'Job timed out - no progress for over 5 minutes')
          
          console.log(`  ✅ Job ${jobId} marked as failed due to timeout`)
        } else if (isLargeFile && progress.progress === 0) {
          console.log(`  ⚠️  Large file (${(job.inputS3Location.size / 1024 / 1024).toFixed(1)}MB) with no progress`)
          console.log(`  💡 Consider using fallback conversion for files > 50MB`)
        } else {
          console.log(`  ✅ Job ${jobId} appears to be progressing normally`)
        }

      } catch (error) {
        console.error(`  ❌ Failed to check job ${jobId}:`, error)
      }
    }

    console.log('✅ Stuck job check completed')

  } catch (error) {
    console.error('❌ Stuck job check failed:', error)
    throw error
  }
}

// Run the timeout check
async function main() {
  console.log('🚀 Starting Stuck Job Timeout Check\n')
  
  try {
    await checkAndTimeoutStuckJobs()
    
    console.log('\n✅ Timeout check completed!')
    console.log('📝 Next steps:')
    console.log('  1. Refresh your browser to stop polling timed-out jobs')
    console.log('  2. Try with smaller files (< 50MB) for better reliability')
    console.log('  3. Large files (> 50MB) will now use fallback conversion')
    
  } catch (error) {
    console.error('\n❌ Timeout check failed:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}