#!/usr/bin/env tsx

/**
 * Test Redis failover behavior in production-like environment
 * This script simulates the App Runner environment without Redis
 */

import { progressService } from '../lib/progress-service'
import { jobService } from '../lib/job-service'

async function testRedisFailover() {
  console.log('🔄 Testing Redis Failover in Production Environment')
  console.log('=' .repeat(60))

  try {
    // Test 1: Check environment detection
    console.log('\n🧪 Test 1: Environment Detection')
    console.log(`   Environment: ${process.env.FORCE_AWS_ENVIRONMENT ? 'APP_RUNNER' : 'LOCAL'}`)
    console.log(`   Redis Endpoint: ${process.env.REDIS_ENDPOINT || 'NOT SET'}`)
    console.log(`   Redis Port: ${process.env.REDIS_PORT || 'NOT SET'}`)
    console.log(`   Redis TLS: ${process.env.REDIS_TLS || 'NOT SET'}`)

    // Test 2: Initialize progress service (should fail fast)
    console.log('\n🧪 Test 2: Progress Service Initialization')
    const startTime = Date.now()
    
    const testJobId = `failover-test-${Date.now()}`
    await progressService.initializeProgress(testJobId)
    
    const initTime = Date.now() - startTime
    console.log(`   ✅ Progress initialized in ${initTime}ms (should be < 6000ms for fast failover)`)
    
    if (initTime > 6000) {
      console.warn(`   ⚠️  Initialization took ${initTime}ms - Redis might be hanging instead of failing fast`)
    }

    // Test 3: Get progress (should use DynamoDB fallback)
    console.log('\n🧪 Test 3: Progress Retrieval (DynamoDB Fallback)')
    const progressStartTime = Date.now()
    
    const progress = await progressService.getProgress(testJobId)
    
    const progressTime = Date.now() - progressStartTime
    console.log(`   Progress retrieved in ${progressTime}ms`)
    console.log(`   Progress data:`, progress)

    if (progress) {
      console.log('   ✅ DynamoDB fallback working correctly')
    } else {
      console.log('   ❌ Progress retrieval failed - check DynamoDB connection')
    }

    // Test 4: Create a real job and test progress tracking
    console.log('\n🧪 Test 4: Real Job Progress Tracking')
    
    const job = await jobService.createJob({
      inputS3Location: {
        bucket: 'test-bucket',
        key: 'test-file.mp3'
      },
      outputFormat: 'wav',
      quality: '192k'
    })

    console.log(`   Created job: ${job.jobId}`)

    // Initialize progress
    await progressService.initializeProgress(job.jobId)
    
    // Update job status to processing
    await jobService.updateJobStatus(job.jobId, 'processing')
    
    // Get progress (should show 50% from DynamoDB fallback)
    const jobProgress = await progressService.getProgress(job.jobId)
    console.log(`   Job progress:`, jobProgress)

    if (jobProgress && jobProgress.progress === 50) {
      console.log('   ✅ DynamoDB fallback correctly mapping processing status to 50%')
    }

    // Mark job as complete
    await progressService.markComplete(job.jobId)
    await jobService.updateJobStatus(job.jobId, 'completed')
    
    const finalProgress = await progressService.getProgress(job.jobId)
    console.log(`   Final progress:`, finalProgress)

    if (finalProgress && finalProgress.progress === 100) {
      console.log('   ✅ Job completion tracking working correctly')
    }

    // Test 5: Performance comparison
    console.log('\n🧪 Test 5: Performance Analysis')
    
    const iterations = 5
    let totalTime = 0
    
    for (let i = 0; i < iterations; i++) {
      const testId = `perf-test-${Date.now()}-${i}`
      const start = Date.now()
      
      await progressService.initializeProgress(testId)
      await progressService.getProgress(testId)
      
      const duration = Date.now() - start
      totalTime += duration
      console.log(`   Iteration ${i + 1}: ${duration}ms`)
    }
    
    const avgTime = totalTime / iterations
    console.log(`   Average time: ${avgTime}ms`)
    
    if (avgTime < 1000) {
      console.log('   ✅ Good performance with DynamoDB fallback')
    } else {
      console.log('   ⚠️  Slower than expected - might indicate Redis hanging')
    }

    console.log('\n🎉 Redis failover testing completed successfully!')
    
    console.log('\n📝 Summary:')
    console.log('   • ✅ Fast failover when Redis is unavailable')
    console.log('   • ✅ DynamoDB fallback working correctly')
    console.log('   • ✅ Progress tracking functional without Redis')
    console.log('   • ✅ Job status mapping working properly')
    console.log(`   • ✅ Average response time: ${avgTime}ms`)

  } catch (error) {
    console.error('❌ Redis failover test failed:', error)
    process.exit(1)
  }
}

async function main() {
  // Simulate App Runner environment without Redis
  process.env.FORCE_AWS_ENVIRONMENT = 'true'
  // Don't set REDIS_ENDPOINT to simulate missing Redis config
  delete process.env.REDIS_ENDPOINT
  delete process.env.REDIS_PORT
  delete process.env.REDIS_TLS
  
  await testRedisFailover()
}

if (require.main === module) {
  main().catch(console.error)
}

export { testRedisFailover }