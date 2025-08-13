#!/usr/bin/env tsx

import { progressService } from '../lib/progress-service'
import { jobService } from '../lib/job-service'
import { streamingConversionServiceFixed } from '../lib/streaming-conversion-service-fixed'

const STUCK_JOB_ID = '1755036398339'

async function debugStuckJob() {
  console.log(`🔍 Debugging stuck job: ${STUCK_JOB_ID}`)
  console.log('=' .repeat(60))

  try {
    // Check progress data
    console.log('\n📊 Progress Data:')
    const progressData = await progressService.getProgress(STUCK_JOB_ID)
    if (progressData) {
      console.log(`  Job ID: ${progressData.jobId}`)
      console.log(`  Progress: ${progressData.progress}%`)
      console.log(`  Stage: ${progressData.stage}`)
      console.log(`  Current Time: ${progressData.currentTime}`)
      console.log(`  Total Duration: ${progressData.totalDuration}`)
      console.log(`  Updated At: ${new Date(progressData.updatedAt).toISOString()}`)
      console.log(`  Error: ${progressData.error || 'None'}`)
      
      // Calculate how long it's been stuck
      const timeSinceUpdate = Date.now() - progressData.updatedAt
      console.log(`  Time since last update: ${Math.floor(timeSinceUpdate / 1000)}s`)
    } else {
      console.log('  ❌ No progress data found')
    }

    // Check job data
    console.log('\n📋 Job Data:')
    const job = await jobService.getJob(STUCK_JOB_ID)
    if (job) {
      console.log(`  Job ID: ${job.jobId}`)
      console.log(`  Status: ${job.status}`)
      console.log(`  Input: ${job.inputS3Location.bucket}/${job.inputS3Location.key}`)
      console.log(`  Input Size: ${job.inputS3Location.size} bytes (${(job.inputS3Location.size / 1024 / 1024).toFixed(2)} MB)`)
      console.log(`  Created At: ${new Date(job.createdAt).toISOString()}`)
      console.log(`  Error: ${job.error || 'None'}`)
    } else {
      console.log('  ❌ No job data found')
    }

    // Check active processes
    console.log('\n🔄 Active Processes:')
    const activeProcesses = streamingConversionServiceFixed.getActiveProcesses()
    console.log(`  Active processes count: ${activeProcesses.size}`)
    
    for (const [jobId, process] of activeProcesses) {
      console.log(`  Job ${jobId}: PID ${process.pid}, killed: ${process.killed}`)
    }

    // Check if process is still running
    if (activeProcesses.has(STUCK_JOB_ID)) {
      const process = activeProcesses.get(STUCK_JOB_ID)!
      console.log(`\n⚠️  Process for job ${STUCK_JOB_ID} is still active!`)
      console.log(`  PID: ${process.pid}`)
      console.log(`  Killed: ${process.killed}`)
      console.log(`  Exit code: ${process.exitCode}`)
      console.log(`  Signal code: ${process.signalCode}`)
    }

  } catch (error) {
    console.error('❌ Error debugging job:', error)
  }
}

debugStuckJob().catch(console.error)