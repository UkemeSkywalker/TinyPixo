#!/usr/bin/env tsx

/**
 * Simple investigation without date parsing issues
 */

import { progressService } from '../lib/progress-service'
import { jobService } from '../lib/job-service'

async function simpleInvestigation(jobId: string) {
  console.log(`🔍 SIMPLE INVESTIGATION: ${jobId}`)
  console.log(`${'='.repeat(50)}`)

  try {
    // Progress data
    const progress = await progressService.getProgress(jobId)
    console.log(`\n📊 PROGRESS:`)
    console.log(`   ${progress?.progress}% - "${progress?.stage}" (${progress?.phase})`)
    console.log(`   Last update: ${Math.round((Date.now() - (progress?.updatedAt || 0)) / 1000)}s ago`)

    // Job data
    const job = await jobService.getJob(jobId)
    console.log(`\n📋 JOB:`)
    console.log(`   Status: ${job?.status}`)
    console.log(`   File: ${job?.inputS3Location.key}`)
    console.log(`   Size: ${job ? (job.inputS3Location.size / 1024 / 1024).toFixed(1) : 'Unknown'}MB`)

    // FFmpeg logs
    const logs = await progressService.getFFmpegLogs(jobId)
    console.log(`\n📝 FFMPEG LOGS: ${logs.length} lines`)
    if (logs.length === 0) {
      console.log(`   🚨 NO LOGS = FFmpeg never started or crashed`)
    } else {
      console.log(`   Last 3 logs:`)
      logs.slice(-3).forEach(log => console.log(`     ${log}`))
    }

    // Analysis
    console.log(`\n🔍 ANALYSIS:`)
    const timeSinceUpdate = progress ? Date.now() - progress.updatedAt : 0
    const fileSize = job ? job.inputS3Location.size / 1024 / 1024 : 0

    if (logs.length === 0) {
      console.log(`   🎯 ROOT CAUSE: FFmpeg Process Never Started`)
      console.log(`      Reasons:`)
      console.log(`      1. Memory exhaustion (${fileSize.toFixed(1)}MB file)`)
      console.log(`      2. File download from S3 failed`)
      console.log(`      3. FFmpeg binary issues`)
      console.log(`      4. System resource limits`)
    }

    if (timeSinceUpdate > 300000) {
      console.log(`   🚨 STUCK: ${Math.round(timeSinceUpdate / 1000)}s without updates`)
    }

    if (fileSize > 50) {
      console.log(`   ⚠️  LARGE FILE: ${fileSize.toFixed(1)}MB exceeds reliable threshold`)
    }

    console.log(`\n💡 HYPOTHESIS:`)
    console.log(`   Large files (>50MB) cause FFmpeg to crash during startup`)
    console.log(`   - Memory pressure from loading large audio files`)
    console.log(`   - S3 download timeout for large files`)
    console.log(`   - System limits exceeded`)

  } catch (error) {
    console.error('Investigation error:', error)
  }
}

// Run
async function main() {
  const jobId = process.argv[2] || '1755195194561'
  await simpleInvestigation(jobId)
}

if (require.main === module) {
  main()
}