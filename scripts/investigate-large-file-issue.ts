#!/usr/bin/env tsx

/**
 * Comprehensive investigation of large file conversion issues
 */

import { progressService } from '../lib/progress-service'
import { jobService } from '../lib/job-service'

async function investigateLargeFileIssue(jobId: string) {
  console.log(`🔍 INVESTIGATING LARGE FILE CONVERSION ISSUE`)
  console.log(`📋 Job ID: ${jobId}`)
  console.log(`⏰ Investigation Time: ${new Date().toISOString()}`)
  console.log(`${'='.repeat(60)}`)

  try {
    // 1. Get Progress Data
    console.log(`\n1️⃣ PROGRESS DATA ANALYSIS`)
    const progress = await progressService.getProgress(jobId)
    if (!progress) {
      console.log(`❌ No progress data found`)
      return
    }

    console.log(`   Progress: ${progress.progress}%`)
    console.log(`   Stage: "${progress.stage}"`)
    console.log(`   Phase: "${progress.phase}"`)
    console.log(`   Updated: ${new Date(progress.updatedAt).toISOString()}`)
    console.log(`   Time since update: ${Math.round((Date.now() - progress.updatedAt) / 1000)}s`)
    console.log(`   TTL: ${progress.ttl} (${new Date(progress.ttl * 1000).toISOString()})`)

    // 2. Get Job Data
    console.log(`\n2️⃣ JOB DATA ANALYSIS`)
    const job = await jobService.getJob(jobId)
    if (!job) {
      console.log(`❌ No job data found`)
      return
    }

    console.log(`   Status: "${job.status}"`)
    console.log(`   Input File: ${job.inputS3Location.key}`)
    console.log(`   File Size: ${(job.inputS3Location.size / 1024 / 1024).toFixed(2)} MB`)
    console.log(`   S3 Bucket: ${job.inputS3Location.bucket}`)
    console.log(`   Format: ${job.format || 'Unknown'}`)
    console.log(`   Quality: ${job.quality || 'Unknown'}`)
    
    // Safe date handling
    const createdAt = job.createdAt ? new Date(job.createdAt).toISOString() : 'Unknown'
    const updatedAt = job.updatedAt ? new Date(job.updatedAt).toISOString() : 'Unknown'
    const processingTime = job.createdAt ? Math.round((Date.now() - job.createdAt) / 1000) : 'Unknown'
    
    console.log(`   Created: ${createdAt}`)
    console.log(`   Updated: ${updatedAt}`)
    console.log(`   Processing Time: ${processingTime}s`)

    // 3. FFmpeg Logs Analysis
    console.log(`\n3️⃣ FFMPEG LOGS ANALYSIS`)
    const logs = await progressService.getFFmpegLogs(jobId)
    console.log(`   Total Log Lines: ${logs.length}`)
    
    if (logs.length === 0) {
      console.log(`   🚨 CRITICAL: No FFmpeg logs found!`)
      console.log(`   This indicates FFmpeg never started or crashed immediately`)
    } else {
      console.log(`   Recent Logs (last 5):`)
      logs.slice(-5).forEach((log, index) => {
        console.log(`     ${index + 1}. ${log}`)
      })
    }

    // 4. System Analysis
    console.log(`\n4️⃣ SYSTEM ANALYSIS`)
    const fileSizeMB = job.inputS3Location.size / (1024 * 1024)
    
    console.log(`   File Size Category: ${getFileSizeCategory(fileSizeMB)}`)
    console.log(`   Expected Processing Time: ${getExpectedProcessingTime(fileSizeMB)}`)
    console.log(`   Memory Requirements: ${getMemoryRequirements(fileSizeMB)}`)
    console.log(`   Recommended Strategy: ${getRecommendedStrategy(fileSizeMB)}`)

    // 5. Issue Analysis
    console.log(`\n5️⃣ ISSUE ANALYSIS`)
    const timeSinceUpdate = Date.now() - progress.updatedAt
    const timeSinceCreated = job.createdAt ? Date.now() - job.createdAt : 0

    const issues = []
    
    if (timeSinceUpdate > 300000) {
      issues.push(`🚨 STUCK: No progress for ${Math.round(timeSinceUpdate / 1000)}s`)
    }
    
    if (logs.length === 0) {
      issues.push(`🚨 FFMPEG: No logs - process never started or crashed`)
    }
    
    if (progress.progress === 0 && timeSinceCreated > 180000) {
      issues.push(`🚨 STARTUP: No progress after ${Math.round(timeSinceCreated / 1000)}s`)
    }
    
    if (fileSizeMB > 50) {
      issues.push(`⚠️  SIZE: Large file (${fileSizeMB.toFixed(1)}MB) may exceed system limits`)
    }

    if (issues.length === 0) {
      console.log(`   ✅ No obvious issues detected`)
    } else {
      issues.forEach(issue => console.log(`   ${issue}`))
    }

    // 6. Root Cause Analysis
    console.log(`\n6️⃣ ROOT CAUSE ANALYSIS`)
    
    if (logs.length === 0 && progress.progress === 0) {
      console.log(`   🎯 PRIMARY ISSUE: FFmpeg Process Failure`)
      console.log(`      - FFmpeg never started or crashed immediately`)
      console.log(`      - Possible causes:`)
      console.log(`        • Memory exhaustion (${fileSizeMB.toFixed(1)}MB file)`)
      console.log(`        • File format issues or corruption`)
      console.log(`        • FFmpeg binary not found or permissions`)
      console.log(`        • System resource limits exceeded`)
    }
    
    if (progress.stage === 'starting conversion' && timeSinceUpdate > 180000) {
      console.log(`   🎯 SECONDARY ISSUE: Conversion Startup Failure`)
      console.log(`      - Conversion phase started but FFmpeg never began`)
      console.log(`      - Possible causes:`)
      console.log(`        • S3 download timeout for large file`)
      console.log(`        • Insufficient disk space for temp files`)
      console.log(`        • Network issues downloading from S3`)
    }

    // 7. Technical Deep Dive
    console.log(`\n7️⃣ TECHNICAL DEEP DIVE`)
    console.log(`   Conversion Flow Analysis:`)
    console.log(`   ┌─ Phase 1: Upload ✅ (Complete)`)
    console.log(`   ├─ Phase 2: Conversion 🚨 (STUCK HERE)`)
    console.log(`   │  ├─ startConversionPhase() ✅`)
    console.log(`   │  ├─ S3 file download ❓ (Unknown status)`)
    console.log(`   │  ├─ FFmpeg process start ❌ (Failed)`)
    console.log(`   │  └─ Progress updates ❌ (None)`)
    console.log(`   └─ Phase 3: S3 Upload ⏸️  (Not reached)`)

    // 8. Comparison with Working Files
    console.log(`\n8️⃣ COMPARISON WITH WORKING FILES`)
    console.log(`   Working file sizes: < 50MB`)
    console.log(`   Failing file sizes: > 50MB`)
    console.log(`   Pattern: Size-based failure threshold`)
    console.log(`   Hypothesis: Memory or processing limits exceeded`)

    console.log(`\n${'='.repeat(60)}`)
    console.log(`📊 INVESTIGATION SUMMARY`)
    console.log(`${'='.repeat(60)}`)

  } catch (error) {
    console.error('❌ Investigation failed:', error)
    throw error
  }
}

function getFileSizeCategory(sizeMB: number): string {
  if (sizeMB < 10) return 'Small (< 10MB)'
  if (sizeMB < 50) return 'Medium (10-50MB)'
  if (sizeMB < 100) return 'Large (50-100MB)'
  if (sizeMB < 200) return 'Very Large (100-200MB)'
  return 'Huge (> 200MB)'
}

function getExpectedProcessingTime(sizeMB: number): string {
  const baseTime = sizeMB * 2 // 2 seconds per MB as rough estimate
  return `${Math.round(baseTime / 60)} minutes`
}

function getMemoryRequirements(sizeMB: number): string {
  const memoryMB = sizeMB * 3 // Rough estimate: 3x file size in memory
  return `~${Math.round(memoryMB)}MB RAM`
}

function getRecommendedStrategy(sizeMB: number): string {
  if (sizeMB < 50) return 'Streaming conversion'
  if (sizeMB < 100) return 'Fallback conversion with chunking'
  return 'File size limit or external processing'
}

// Run the investigation
async function main() {
  const jobId = process.argv[2]
  
  if (!jobId) {
    console.log('Usage: npm run investigate:large <jobId>')
    console.log('Example: npm run investigate:large 1755195194561')
    process.exit(1)
  }

  try {
    await investigateLargeFileIssue(jobId)
    
  } catch (error) {
    console.error('\n❌ Investigation failed:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}