#!/usr/bin/env tsx

import { progressService, ProgressData } from '../lib/progress-service'
import { jobService, JobStatus } from '../lib/job-service'
import { initializeAllServices } from '../lib/aws-services'

async function testProgressService() {
  console.log('🚀 Starting ProgressService tests...')
  
  try {
    // Initialize services
    console.log('📋 Initializing services...')
    await initializeAllServices()
    console.log('✅ Services initialized successfully')

    // Test 1: Initialize progress for a new job
    console.log('\n🧪 Test 1: Initialize progress for a new job')
    const testJobId = `test-job-${Date.now()}`
    await progressService.initializeProgress(testJobId)
    console.log(`✅ Progress initialized for job ${testJobId}`)

    // Test 2: Set progress data
    console.log('\n🧪 Test 2: Set progress data')
    const progressData: ProgressData = {
      jobId: testJobId,
      progress: 45,
      stage: 'converting',
      estimatedTimeRemaining: 120,
      startTime: Date.now()
    }
    await progressService.setProgress(testJobId, progressData)
    console.log(`✅ Progress set for job ${testJobId}: ${progressData.progress}% (${progressData.stage})`)

    // Test 3: Get progress data (should come from Redis)
    console.log('\n🧪 Test 3: Get progress data from Redis')
    const retrievedProgress = await progressService.getProgress(testJobId)
    if (retrievedProgress) {
      console.log(`✅ Progress retrieved from Redis: ${retrievedProgress.progress}% (${retrievedProgress.stage})`)
      console.log(`   Job ID: ${retrievedProgress.jobId}`)
      console.log(`   Estimated time remaining: ${retrievedProgress.estimatedTimeRemaining}s`)
    } else {
      console.log('❌ Failed to retrieve progress from Redis')
    }

    // Test 4: Test DynamoDB fallback by creating a job in DynamoDB
    console.log('\n🧪 Test 4: Test DynamoDB fallback')
    const fallbackJobId = `fallback-job-${Date.now()}`
    
    // Create a job in DynamoDB
    const jobInput = {
      inputS3Location: {
        bucket: 'test-bucket',
        key: 'uploads/test.mp3',
        size: 1024000
      },
      format: 'wav',
      quality: '192k'
    }
    
    const job = await jobService.createJob(jobInput)
    console.log(`✅ Job created in DynamoDB: ${job.jobId}`)
    
    // Update job status to processing
    await jobService.updateJobStatus(job.jobId, JobStatus.PROCESSING)
    console.log(`✅ Job status updated to PROCESSING`)
    
    // Get progress (should fallback to DynamoDB since no Redis data exists)
    const fallbackProgress = await progressService.getProgress(job.jobId)
    if (fallbackProgress) {
      console.log(`✅ Progress retrieved from DynamoDB fallback: ${fallbackProgress.progress}% (${fallbackProgress.stage})`)
    } else {
      console.log('❌ Failed to retrieve progress from DynamoDB fallback')
    }

    // Test 5: Mark job as complete
    console.log('\n🧪 Test 5: Mark job as complete')
    await progressService.markComplete(testJobId)
    const completedProgress = await progressService.getProgress(testJobId)
    if (completedProgress && completedProgress.progress === 100) {
      console.log(`✅ Job marked as complete: ${completedProgress.progress}% (${completedProgress.stage})`)
    } else {
      console.log('❌ Failed to mark job as complete')
    }

    // Test 6: Mark job as failed
    console.log('\n🧪 Test 6: Mark job as failed')
    const failedJobId = `failed-job-${Date.now()}`
    const errorMessage = 'FFmpeg process crashed'
    await progressService.markFailed(failedJobId, errorMessage)
    const failedProgress = await progressService.getProgress(failedJobId)
    if (failedProgress && failedProgress.progress === -1) {
      console.log(`✅ Job marked as failed: ${failedProgress.progress} (${failedProgress.stage})`)
      console.log(`   Error: ${failedProgress.error}`)
    } else {
      console.log('❌ Failed to mark job as failed')
    }

    // Test 7: Test rapid polling (simulate frontend polling)
    console.log('\n🧪 Test 7: Test rapid polling simulation')
    const pollingJobId = `polling-job-${Date.now()}`
    await progressService.initializeProgress(pollingJobId)
    
    // Simulate rapid polling
    const pollCount = 5
    const pollResults = []
    
    for (let i = 0; i < pollCount; i++) {
      const startTime = Date.now()
      const progress = await progressService.getProgress(pollingJobId)
      const responseTime = Date.now() - startTime
      pollResults.push(responseTime)
      
      if (progress) {
        console.log(`   Poll ${i + 1}: ${progress.progress}% (${responseTime}ms)`)
      }
      
      // Small delay between polls
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    const avgResponseTime = pollResults.reduce((a, b) => a + b, 0) / pollResults.length
    console.log(`✅ Rapid polling test completed. Average response time: ${avgResponseTime.toFixed(2)}ms`)

    // Test 8: Test progress cleanup
    console.log('\n🧪 Test 8: Test progress cleanup')
    await progressService.cleanupExpiredProgress()
    console.log('✅ Progress cleanup completed successfully')

    // Test 9: Test with different job statuses for DynamoDB fallback
    console.log('\n🧪 Test 9: Test different job statuses for DynamoDB fallback')
    const statusTests = [
      { status: JobStatus.CREATED, expectedProgress: 0 },
      { status: JobStatus.PROCESSING, expectedProgress: 50 },
      { status: JobStatus.COMPLETED, expectedProgress: 100 },
      { status: JobStatus.FAILED, expectedProgress: -1 }
    ]

    for (const test of statusTests) {
      const statusJob = await jobService.createJob(jobInput)
      await jobService.updateJobStatus(statusJob.jobId, test.status, undefined, test.status === JobStatus.FAILED ? 'Test error' : undefined)
      
      const statusProgress = await progressService.getProgress(statusJob.jobId)
      if (statusProgress && statusProgress.progress === test.expectedProgress) {
        console.log(`✅ Status ${test.status} mapped to progress ${test.expectedProgress}%`)
      } else {
        console.log(`❌ Status ${test.status} mapping failed. Expected: ${test.expectedProgress}%, Got: ${statusProgress?.progress}`)
      }
    }

    console.log('\n🎉 All ProgressService tests completed successfully!')
    
  } catch (error) {
    console.error('❌ ProgressService test failed:', error)
    process.exit(1)
  }
}

// Test the progress API endpoint
async function testProgressAPI() {
  console.log('\n🌐 Testing Progress API endpoint...')
  
  try {
    const testJobId = `api-test-job-${Date.now()}`
    
    // Set up some progress data
    await progressService.setProgress(testJobId, {
      jobId: testJobId,
      progress: 75,
      stage: 'converting',
      estimatedTimeRemaining: 30
    })

    // Test API endpoint using fetch
    const baseUrl = 'http://localhost:3000'
    
    // Test 1: Valid job ID
    console.log('🧪 Testing API with valid job ID...')
    const response1 = await fetch(`${baseUrl}/api/progress?jobId=${testJobId}`)
    if (response1.ok) {
      const data = await response1.json()
      console.log(`✅ API returned progress: ${data.progress}% (${data.stage})`)
      
      // Check cache headers
      const cacheControl = response1.headers.get('Cache-Control')
      const pragma = response1.headers.get('Pragma')
      const expires = response1.headers.get('Expires')
      const responseTime = response1.headers.get('X-Response-Time')
      
      console.log(`   Cache-Control: ${cacheControl}`)
      console.log(`   Pragma: ${pragma}`)
      console.log(`   Expires: ${expires}`)
      console.log(`   Response-Time: ${responseTime}`)
      
      if (cacheControl === 'no-cache, no-store, must-revalidate' && 
          pragma === 'no-cache' && 
          expires === '0') {
        console.log('✅ Proper no-cache headers set')
      } else {
        console.log('❌ Cache headers not set correctly')
      }
    } else {
      console.log(`❌ API request failed with status: ${response1.status}`)
    }

    // Test 2: Missing job ID
    console.log('🧪 Testing API with missing job ID...')
    const response2 = await fetch(`${baseUrl}/api/progress`)
    if (response2.status === 400) {
      const data = await response2.json()
      console.log(`✅ API correctly returned 400 error: ${data.error}`)
    } else {
      console.log(`❌ API should return 400 for missing job ID, got: ${response2.status}`)
    }

    // Test 3: Non-existent job ID
    console.log('🧪 Testing API with non-existent job ID...')
    const response3 = await fetch(`${baseUrl}/api/progress?jobId=non-existent-job`)
    if (response3.status === 404) {
      const data = await response3.json()
      console.log(`✅ API correctly returned 404 error: ${data.error}`)
    } else {
      console.log(`❌ API should return 404 for non-existent job, got: ${response3.status}`)
    }

    console.log('✅ Progress API tests completed successfully!')
    
  } catch (error) {
    console.error('❌ Progress API test failed:', error)
    // Don't exit here as the server might not be running
    console.log('ℹ️  Note: API tests require the Next.js server to be running (npm run dev)')
  }
}

async function main() {
  console.log('🔧 Testing ProgressService with LocalStack Redis...')
  await testProgressService()
  
  // Note: API tests require the server to be running
  console.log('\nℹ️  To test the API endpoint, run "npm run dev" in another terminal and then run this script again')
  
  console.log('\n✨ All tests completed!')
}

if (require.main === module) {
  main().catch(console.error)
}

export { testProgressService, testProgressAPI }