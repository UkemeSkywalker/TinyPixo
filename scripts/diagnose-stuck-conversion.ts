#!/usr/bin/env tsx

/**
 * Diagnostic script for stuck conversions
 */

import { progressService } from '../lib/progress-service'
import { jobService } from '../lib/job-service'

async function diagnoseStuckConversion(jobId: string) {
  console.log(`🔍 Diagnosing stuck conversion for job ${jobId}`)

  try {
    // Get progress data
    const progress = await progressService.getProgress(jobId)
    if (!progress) {
      console.log(`❌ No progress data found for job ${jobId}`)
      return
    }

    console.log(`📊 Progress Data:`)
    console.log(`  Job ID: ${progress.jobId}`)
    console.log(`  Progress: ${progress.progress}%`)
    console.log(`  Stage: ${progress.stage}`)
    console.log(`  Phase: ${progress.phase}`)
    console.log(`  Updated: ${new Date(progress.updatedAt).toISOString()}`)
    console.log(`  Time since last update: ${Math.round((Date.now() - progress.updatedAt) / 1000)}s`)

    // Get job data
    const job = await jobService.getJob(jobId)
    if (!job) {
      console.log(`❌ No job data found for job ${jobId}`)
      return
    }

    console.log(`\n📋 Job Data:`)
    console.log(`  Status: ${job.status}`)
    console.log(`  Input: ${job.inputS3Location.key}`)
    console.log(`  Size: ${(job.inputS3Location.size / 1024 / 1024).toFixed(1)} MB`)
    console.log(`  Created: ${job.createdAt ? new Date(job.createdAt).toISOString() : 'Unknown'}`)
    console.log(`  Updated: ${job.updatedAt ? new Date(job.updatedAt).toISOString() : 'Unknown'}`)
    console.log(`  Processing time: ${job.createdAt ? Math.round((Date.now() - job.createdAt) / 1000) : 'Unknown'}s`)

    // Get FFmpeg logs
    const logs = await progressService.getFFmpegLogs(jobId)
    console.log(`\n📝 FFmpeg Logs (${logs.length} lines):`)
    if (logs.length === 0) {
      console.log(`  ⚠️  No FFmpeg logs found - this indicates FFmpeg hasn't started or crashed`)
    } else {
      logs.slice(-10).forEach(log => console.log(`  ${log}`))
    }

    // Analyze the issue
    console.log(`\n🔍 Analysis:`)
    const timeSinceUpdate = Date.now() - progress.updatedAt
    const timeSinceCreated = job.createdAt ? Date.now() - job.createdAt : 0

    if (timeSinceUpdate > 300000) { // 5 minutes
      console.log(`  🚨 STUCK: No progress updates for ${Math.round(timeSinceUpdate / 1000)}s`)
    }

    if (logs.length === 0) {
      console.log(`  🚨 ISSUE: No FFmpeg logs - process likely crashed or never started`)
    }

    if (job.inputS3Location.size > 100 * 1024 * 1024) { // 100MB
      console.log(`  ⚠️  LARGE FILE: ${(job.inputS3Location.size / 1024 / 1024).toFixed(1)}MB file may take longer`)
    }

    if (timeSinceCreated > 600000) { // 10 minutes
      console.log(`  🚨 TIMEOUT: Job has been running for ${Math.round(timeSinceCreated / 1000)}s`)
    }

    // Recommendations
    console.log(`\n💡 Recommendations:`)
    if (timeSinceUpdate > 300000) {
      console.log(`  1. Mark job as failed: npm run cleanup:stale`)
      console.log(`  2. Check server logs for FFmpeg errors`)
      console.log(`  3. Try with a smaller file first`)
    }

    if (logs.length === 0) {
      console.log(`  1. FFmpeg process likely crashed - check server memory`)
      console.log(`  2. File might be corrupted or unsupported format`)
      console.log(`  3. Check if FFmpeg is properly installed`)
    }

    if (job.inputS3Location.size > 200 * 1024 * 1024) {
      console.log(`  1. Consider implementing file size limits`)
      console.log(`  2. Use chunked processing for very large files`)
      console.log(`  3. Increase timeout settings`)
    }

  } catch (error) {
    console.error('❌ Diagnostic failed:', error)
    throw error
  }
}

// Run the diagnostic
async function main() {
  const jobId = process.argv[2]
  
  if (!jobId) {
    console.log('Usage: npm run diagnose:stuck <jobId>')
    console.log('Example: npm run diagnose:stuck 1755194010224')
    process.exit(1)
  }

  console.log('🚀 Starting Stuck Conversion Diagnostic\n')
  
  try {
    await diagnoseStuckConversion(jobId)
    
    console.log('\n✅ Diagnostic completed!')
    
  } catch (error) {
    console.error('\n❌ Diagnostic failed:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}