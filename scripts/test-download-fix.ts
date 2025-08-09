#!/usr/bin/env tsx

/**
 * Test script to validate the download race condition fix
 */

import { jobService, JobStatus } from '../lib/job-service'
import { progressService } from '../lib/progress-service'

async function testDownloadRaceCondition() {
  console.log('Testing download race condition fix...')
  
  const testJobId = `test-${Date.now()}`
  
  try {
    // Simulate the conversion completion flow
    console.log('1. Creating test job...')
    await jobService.createJob({
      jobId: testJobId,
      inputS3Location: {
        bucket: 'test-bucket',
        key: 'test-input.mp3',
        size: 1000
      },
      format: 'wav',
      quality: 'high'
    })
    
    // Simulate job completion
    console.log('2. Updating job status to COMPLETED...')
    await jobService.updateJobStatus(testJobId, JobStatus.COMPLETED, {
      bucket: 'test-bucket',
      key: 'test-output.wav',
      size: 2000
    })
    
    // Small delay to simulate DynamoDB consistency delay
    await new Promise(resolve => setTimeout(resolve, 100))
    
    console.log('3. Marking progress as complete...')
    await progressService.markComplete(testJobId)
    
    // Test progress retrieval
    console.log('4. Checking progress data...')
    const progressData = await progressService.getProgress(testJobId)
    console.log('Progress data:', progressData)
    
    // Test job retrieval
    console.log('5. Checking job status...')
    const job = await jobService.getJob(testJobId)
    console.log('Job status:', job?.status)
    
    // Validate the fix conditions
    if (progressData?.progress === 100 && progressData?.stage === 'completed' && job?.status === JobStatus.COMPLETED) {
      console.log('✅ Race condition fix validated - both progress and job status are correct')
    } else {
      console.log('❌ Race condition still exists:')
      console.log(`  Progress: ${progressData?.progress}%, Stage: ${progressData?.stage}`)
      console.log(`  Job Status: ${job?.status}`)
    }
    
    // Cleanup
    console.log('6. Cleaning up test job...')
    await jobService.deleteJob(testJobId)
    
  } catch (error) {
    console.error('Test failed:', error)
  }
}

// Run the test
testDownloadRaceCondition().catch(console.error)