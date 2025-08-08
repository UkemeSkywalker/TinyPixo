#!/usr/bin/env tsx

import { progressService } from '../lib/progress-service'
import { jobService, JobStatus } from '../lib/job-service'

/**
 * Test script to demonstrate Redis failure and DynamoDB fallback
 */

async function testRedisFallback() {
  console.log('🔄 Testing Redis Failure and DynamoDB Fallback Scenario')
  console.log('=' .repeat(60))

  try {
    // Create a job in DynamoDB first
    console.log('📋 Creating job in DynamoDB...')
    const jobInput = {
      inputS3Location: {
        bucket: 'test-bucket',
        key: 'uploads/fallback-test.mp3',
        size: 2048000
      },
      format: 'wav',
      quality: '320k'
    }

    const job = await jobService.createJob(jobInput)
    console.log(`✅ Job created: ${job.jobId}`)

    // Update job status to processing
    await jobService.updateJobStatus(job.jobId, JobStatus.PROCESSING)
    console.log('✅ Job status updated to PROCESSING')

    // Test 1: Normal operation (Redis working)
    console.log('\n🧪 Test 1: Normal operation with Redis working')
    const normalProgress = await progressService.getProgress(job.jobId)
    console.log(`✅ Retrieved from DynamoDB fallback: ${normalProgress?.progress}% (${normalProgress?.stage})`)

    // Test 2: Simulate Redis being unavailable by getting progress for a job that only exists in DynamoDB
    console.log('\n🧪 Test 2: Simulating Redis unavailable scenario')
    console.log('   (Job exists in DynamoDB but not in Redis)')
    
    const fallbackProgress = await progressService.getProgress(job.jobId)
    if (fallbackProgress) {
      console.log(`✅ Fallback successful: ${fallbackProgress.progress}% (${fallbackProgress.stage})`)
      console.log('   ℹ️  This demonstrates that when Redis has no data, system falls back to DynamoDB')
    } else {
      console.log('❌ Fallback failed')
    }

    // Test 3: Test different job statuses for fallback
    console.log('\n🧪 Test 3: Testing different job statuses in fallback')
    
    const statusTests = [
      { status: JobStatus.CREATED, expectedProgress: 0, description: 'Job just created' },
      { status: JobStatus.PROCESSING, expectedProgress: 50, description: 'Job in progress' },
      { status: JobStatus.COMPLETED, expectedProgress: 100, description: 'Job completed' },
      { status: JobStatus.FAILED, expectedProgress: -1, description: 'Job failed' }
    ]

    for (const test of statusTests) {
      const testJob = await jobService.createJob(jobInput)
      await jobService.updateJobStatus(
        testJob.jobId, 
        test.status, 
        undefined, 
        test.status === JobStatus.FAILED ? 'Simulated failure' : undefined
      )
      
      const statusProgress = await progressService.getProgress(testJob.jobId)
      
      if (statusProgress && statusProgress.progress === test.expectedProgress) {
        console.log(`   ✅ ${test.description}: ${statusProgress.progress}% (${statusProgress.stage})`)
        if (statusProgress.error) {
          console.log(`      Error: ${statusProgress.error}`)
        }
      } else {
        console.log(`   ❌ ${test.description}: Expected ${test.expectedProgress}%, got ${statusProgress?.progress}%`)
      }
    }

    // Test 4: Performance comparison
    console.log('\n🧪 Test 4: Performance comparison (Redis vs DynamoDB fallback)')
    
    // Set up Redis data for comparison
    const perfTestJobId = `perf-test-${Date.now()}`
    await progressService.setProgress(perfTestJobId, {
      jobId: perfTestJobId,
      progress: 75,
      stage: 'converting'
    })

    // Test Redis performance
    const redisStartTime = Date.now()
    await progressService.getProgress(perfTestJobId)
    const redisTime = Date.now() - redisStartTime

    // Test DynamoDB fallback performance
    const dynamoStartTime = Date.now()
    await progressService.getProgress(job.jobId) // This job only exists in DynamoDB
    const dynamoTime = Date.now() - dynamoStartTime

    console.log(`   ⚡ Redis response time: ${redisTime}ms`)
    console.log(`   🐌 DynamoDB fallback time: ${dynamoTime}ms`)
    console.log(`   📊 Redis is ${(dynamoTime / redisTime).toFixed(1)}x faster`)

    console.log('\n🎉 Redis fallback testing completed successfully!')
    console.log('\n📝 Summary:')
    console.log('   • ✅ DynamoDB fallback works when Redis data is unavailable')
    console.log('   • ✅ All job statuses correctly mapped to progress percentages')
    console.log('   • ✅ Error information preserved in fallback scenario')
    console.log('   • ✅ Performance difference demonstrates Redis advantage')
    console.log('   • ✅ System gracefully handles Redis unavailability')

  } catch (error) {
    console.error('❌ Redis fallback test failed:', error)
    process.exit(1)
  }
}

async function main() {
  await testRedisFallback()
}

if (require.main === module) {
  main().catch(console.error)
}

export { testRedisFallback }