#!/usr/bin/env tsx

import { progressService } from '../lib/progress-service'
import { jobService } from '../lib/job-service'
import { streamingConversionServiceFixed } from '../lib/streaming-conversion-service-fixed'

const STUCK_JOB_ID = '1755036398339'

async function forceCleanupStuckJob() {
  console.log(`🧹 Force cleaning up stuck job: ${STUCK_JOB_ID}`)
  console.log('=' .repeat(60))

  try {
    // 1. Check and terminate any active processes
    console.log('\n🔄 Checking active processes...')
    const activeProcesses = streamingConversionServiceFixed.getActiveProcesses()
    
    if (activeProcesses.has(STUCK_JOB_ID)) {
      console.log(`⚠️  Found active process for job ${STUCK_JOB_ID} - terminating...`)
      const process = activeProcesses.get(STUCK_JOB_ID)!
      
      try {
        if (process.pid && !process.killed) {
          process.kill('SIGTERM')
          console.log(`📤 Sent SIGTERM to process ${process.pid}`)
          
          // Wait a bit, then force kill if needed
          setTimeout(() => {
            if (!process.killed) {
              process.kill('SIGKILL')
              console.log(`💀 Force killed process ${process.pid}`)
            }
          }, 5000)
        }
      } catch (error) {
        console.error(`❌ Error terminating process:`, error)
      }
    } else {
      console.log(`✅ No active process found for job ${STUCK_JOB_ID}`)
    }

    // 2. Mark the job as failed in progress service
    console.log('\n📊 Updating progress status...')
    await progressService.markFailed(STUCK_JOB_ID, 'Job manually terminated due to timeout/hang')
    console.log(`✅ Job ${STUCK_JOB_ID} marked as failed in progress service`)

    // 3. Update job status
    console.log('\n📋 Updating job status...')
    const job = await jobService.getJob(STUCK_JOB_ID)
    if (job) {
      // Update job status to failed
      const updatedJob = {
        ...job,
        status: 'failed' as const,
        error: 'Job manually terminated due to timeout/hang',
        updatedAt: Date.now()
      }
      
      await jobService.updateJob(updatedJob)
      console.log(`✅ Job ${STUCK_JOB_ID} status updated to failed`)
    } else {
      console.log(`❌ Job ${STUCK_JOB_ID} not found in job service`)
    }

    // 4. Cleanup any resources
    console.log('\n🧹 Cleaning up resources...')
    await streamingConversionServiceFixed.cleanup()
    console.log(`✅ Cleanup completed`)

    // 5. Verify final state
    console.log('\n🔍 Verifying final state...')
    const finalProgress = await progressService.getProgress(STUCK_JOB_ID)
    const finalJob = await jobService.getJob(STUCK_JOB_ID)
    
    console.log(`Progress: ${finalProgress?.progress}% (${finalProgress?.stage})`)
    console.log(`Job Status: ${finalJob?.status}`)
    console.log(`Job Error: ${finalJob?.error || 'None'}`)

  } catch (error) {
    console.error('❌ Error during cleanup:', error)
  }
}

forceCleanupStuckJob().catch(console.error)