#!/usr/bin/env tsx

import { progressService } from '../lib/progress-service'
import { jobService } from '../lib/job-service'
import { streamingConversionServiceFixed } from '../lib/streaming-conversion-service-fixed'

const CURRENT_JOB_ID = '1755039156770'

async function debugCurrentJob() {
  console.log(`🔍 Debugging current job: ${CURRENT_JOB_ID}`)
  console.log('=' .repeat(60))

  try {
    // Check progress data
    console.log('\n📊 Progress Data:')
    const progressData = await progressService.getProgress(CURRENT_JOB_ID)
    if (progressData) {
      console.log(`  Job ID: ${progressData.jobId}`)
      console.log(`  Progress: ${progressData.progress}%`)
      console.log(`  Stage: ${progressData.stage}`)
      console.log(`  Current Time: ${progressData.currentTime}`)
      console.log(`  Total Duration: ${progressData.totalDuration}`)
      console.log(`  FFmpeg Logs Count: ${progressData.ffmpegLogs?.length || 0}`)
      console.log(`  Last Log Update: ${progressData.lastLogUpdate ? new Date(progressData.lastLogUpdate).toISOString() : 'Never'}`)
      console.log(`  Updated At: ${new Date(progressData.updatedAt).toISOString()}`)
    } else {
      console.log('  ❌ No progress data found')
    }

    // Check job data
    console.log('\n📋 Job Data:')
    const job = await jobService.getJob(CURRENT_JOB_ID)
    if (job) {
      console.log(`  Job ID: ${job.jobId}`)
      console.log(`  Status: ${job.status}`)
      console.log(`  Input: ${job.inputS3Location.bucket}/${job.inputS3Location.key}`)
      console.log(`  Input Size: ${job.inputS3Location.size} bytes (${(job.inputS3Location.size / 1024 / 1024).toFixed(2)} MB)`)
      console.log(`  Created At: ${new Date(job.createdAt).toISOString()}`)
    } else {
      console.log('  ❌ No job data found')
    }

    // Check active processes
    console.log('\n🔄 Active Processes:')
    const activeProcesses = streamingConversionServiceFixed.getActiveProcesses()
    console.log(`  Active processes count: ${activeProcesses.size}`)
    
    if (activeProcesses.has(CURRENT_JOB_ID)) {
      const process = activeProcesses.get(CURRENT_JOB_ID)!
      console.log(`  ✅ Job ${CURRENT_JOB_ID} has active process:`)
      console.log(`    PID: ${process.pid}`)
      console.log(`    Killed: ${process.killed}`)
      console.log(`    Exit code: ${process.exitCode}`)
      console.log(`    Signal code: ${process.signalCode}`)
    } else {
      console.log(`  ❌ No active process found for job ${CURRENT_JOB_ID}`)
      console.log('  This suggests the job might be using fallback conversion or has completed')
    }

    // Check FFmpeg logs
    console.log('\n📝 FFmpeg Logs:')
    const logs = await progressService.getFFmpegLogs(CURRENT_JOB_ID)
    console.log(`  Log count: ${logs.length}`)
    
    if (logs.length > 0) {
      console.log('  Recent logs:')
      logs.slice(-5).forEach((log, index) => {
        console.log(`    ${logs.length - 5 + index + 1}: ${log}`)
      })
    } else {
      console.log('  ❌ No FFmpeg logs found')
      console.log('  This indicates either:')
      console.log('    - Job is using fallback conversion (no streaming)')
      console.log('    - Log capture is not working')
      console.log('    - Job hasn\'t started FFmpeg processing yet')
    }

  } catch (error) {
    console.error('❌ Error debugging job:', error)
  }
}

debugCurrentJob().catch(console.error)