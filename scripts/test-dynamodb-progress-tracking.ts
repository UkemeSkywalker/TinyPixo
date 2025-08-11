#!/usr/bin/env tsx

/**
 * Test script to verify DynamoDB-based progress tracking for audio conversion
 * This script tests the complete progress tracking workflow with throttling
 */

import { dynamodbProgressService } from '../lib/progress-service-dynamodb'
import { progressService } from '../lib/progress-service'
import { initializeProgressTables } from '../lib/aws-services'

interface TestResult {
  testName: string
  success: boolean
  error?: string
  duration?: number
}

async function runTest(testName: string, testFn: () => Promise<void>): Promise<TestResult> {
  const startTime = Date.now()
  
  try {
    console.log(`\n🧪 Running test: ${testName}`)
    await testFn()
    const duration = Date.now() - startTime
    console.log(`✅ Test passed: ${testName} (${duration}ms)`)
    return { testName, success: true, duration }
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`❌ Test failed: ${testName} (${duration}ms)`, error)
    return { 
      testName, 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      duration 
    }
  }
}

async function testProgressInitialization(): Promise<void> {
  const testJobId = `test-init-${Date.now()}`
  
  // Initialize progress
  await progressService.initializeProgress(testJobId)
  
  // Verify progress was created
  const progress = await progressService.getProgress(testJobId)
  if (!progress) {
    throw new Error('Progress not found after initialization')
  }
  
  if (progress.progress !== 0) {
    throw new Error(`Expected progress 0, got ${progress.progress}`)
  }
  
  if (progress.stage !== 'initialized') {
    throw new Error(`Expected stage 'initialized', got '${progress.stage}'`)
  }
  
  console.log(`   Progress initialized: ${progress.progress}% (${progress.stage})`)
}

async function testProgressUpdates(): Promise<void> {
  const testJobId = `test-updates-${Date.now()}`
  
  // Initialize progress
  await progressService.initializeProgress(testJobId)
  
  // Update progress multiple times
  const updates = [
    { progress: 25, stage: 'processing' },
    { progress: 50, stage: 'converting' },
    { progress: 75, stage: 'uploading' },
    { progress: 100, stage: 'completed' }
  ]
  
  for (const update of updates) {
    await progressService.setProgress(testJobId, {
      jobId: testJobId,
      progress: update.progress,
      stage: update.stage
    })
    
    // Verify update
    const progress = await progressService.getProgress(testJobId)
    if (!progress) {
      throw new Error(`Progress not found after update to ${update.progress}%`)
    }
    
    if (progress.progress !== update.progress) {
      throw new Error(`Expected progress ${update.progress}, got ${progress.progress}`)
    }
    
    console.log(`   Progress updated: ${progress.progress}% (${progress.stage})`)
  }
}

async function testProgressCompletion(): Promise<void> {
  const testJobId = `test-completion-${Date.now()}`
  
  // Initialize progress
  await progressService.initializeProgress(testJobId)
  
  // Mark as complete
  await progressService.markComplete(testJobId)
  
  // Verify completion
  const progress = await progressService.getProgress(testJobId)
  if (!progress) {
    throw new Error('Progress not found after completion')
  }
  
  if (progress.progress !== 100) {
    throw new Error(`Expected progress 100, got ${progress.progress}`)
  }
  
  if (progress.stage !== 'completed') {
    throw new Error(`Expected stage 'completed', got '${progress.stage}'`)
  }
  
  console.log(`   Progress completed: ${progress.progress}% (${progress.stage})`)
}

async function testProgressFailure(): Promise<void> {
  const testJobId = `test-failure-${Date.now()}`
  const errorMessage = 'Test conversion failure'
  
  // Initialize progress
  await progressService.initializeProgress(testJobId)
  
  // Mark as failed
  await progressService.markFailed(testJobId, errorMessage)
  
  // Verify failure
  const progress = await progressService.getProgress(testJobId)
  if (!progress) {
    throw new Error('Progress not found after failure')
  }
  
  if (progress.progress !== -1) {
    throw new Error(`Expected progress -1, got ${progress.progress}`)
  }
  
  if (progress.stage !== 'failed') {
    throw new Error(`Expected stage 'failed', got '${progress.stage}'`)
  }
  
  if (progress.error !== errorMessage) {
    throw new Error(`Expected error '${errorMessage}', got '${progress.error}'`)
  }
  
  console.log(`   Progress failed: ${progress.progress}% (${progress.stage}) - ${progress.error}`)
}

async function testFFmpegProgressThrottling(): Promise<void> {
  const testJobId = `test-throttling-${Date.now()}`
  
  // Initialize progress
  await progressService.initializeProgress(testJobId)
  
  // Create mock FFmpeg process info
  const processInfo = dynamodbProgressService.createFFmpegProcessInfo(
    12345,
    'mp3',
    'wav',
    true
  )
  
  // Simulate rapid FFmpeg stderr updates (should be throttled)
  const stderrLines = [
    'Duration: 00:03:45.67, start: 0.000000, bitrate: 320 kb/s',
    'frame=  100 fps=0.0 q=-0.0 size=    800kB time=00:00:02.27 bitrate=2822.4kbits/s speed=20.1x',
    'frame=  150 fps=0.0 q=-0.0 size=   1200kB time=00:00:03.41 bitrate=2822.4kbits/s speed=20.1x',
    'frame=  200 fps=0.0 q=-0.0 size=   1600kB time=00:00:04.55 bitrate=2822.4kbits/s speed=20.1x',
    'frame=  250 fps=0.0 q=-0.0 size=   2000kB time=00:00:05.69 bitrate=2822.4kbits/s speed=20.1x'
  ]
  
  let updateCount = 0
  const originalSetProgress = progressService.setProgress.bind(progressService)
  
  // Mock setProgress to count calls
  progressService.setProgress = async (jobId: string, progressData: any) => {
    updateCount++
    return originalSetProgress(jobId, progressData)
  }
  
  // Process all stderr lines rapidly
  for (const line of stderrLines) {
    await progressService.processFFmpegStderr(testJobId, line, processInfo)
    // Small delay to simulate real FFmpeg output timing
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  
  // Restore original method
  progressService.setProgress = originalSetProgress
  
  // Verify throttling worked (should have fewer updates than lines)
  console.log(`   Processed ${stderrLines.length} stderr lines, made ${updateCount} progress updates`)
  
  if (updateCount >= stderrLines.length) {
    throw new Error(`Throttling failed: expected fewer than ${stderrLines.length} updates, got ${updateCount}`)
  }
  
  // Verify final progress
  const progress = await progressService.getProgress(testJobId)
  if (!progress) {
    throw new Error('Progress not found after FFmpeg processing')
  }
  
  console.log(`   Final progress: ${progress.progress}% (${progress.stage})`)
}

async function testResponseTime(): Promise<void> {
  const testJobId = `test-response-time-${Date.now()}`
  
  // Initialize progress
  await progressService.initializeProgress(testJobId)
  
  // Test response time for progress retrieval
  const iterations = 10
  const responseTimes: number[] = []
  
  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now()
    const progress = await progressService.getProgress(testJobId)
    const responseTime = Date.now() - startTime
    responseTimes.push(responseTime)
    
    if (!progress) {
      throw new Error(`Progress not found on iteration ${i + 1}`)
    }
  }
  
  const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
  const maxResponseTime = Math.max(...responseTimes)
  
  console.log(`   Average response time: ${avgResponseTime.toFixed(1)}ms`)
  console.log(`   Maximum response time: ${maxResponseTime}ms`)
  
  // Verify response times are reasonable (under 500ms for DynamoDB)
  if (avgResponseTime > 500) {
    throw new Error(`Average response time too high: ${avgResponseTime.toFixed(1)}ms`)
  }
  
  if (maxResponseTime > 1000) {
    throw new Error(`Maximum response time too high: ${maxResponseTime}ms`)
  }
}

async function main(): Promise<void> {
  console.log('🚀 Starting DynamoDB Progress Tracking Tests')
  console.log('=' .repeat(60))
  
  try {
    // Initialize tables first
    console.log('📋 Initializing DynamoDB progress tables...')
    await initializeProgressTables()
    console.log('✅ Tables initialized successfully')
    
    // Run all tests
    const tests = [
      () => testProgressInitialization(),
      () => testProgressUpdates(),
      () => testProgressCompletion(),
      () => testProgressFailure(),
      () => testFFmpegProgressThrottling(),
      () => testResponseTime()
    ]
    
    const results: TestResult[] = []
    
    for (const test of tests) {
      const result = await runTest(test.name, test)
      results.push(result)
    }
    
    // Summary
    console.log('\n' + '=' .repeat(60))
    console.log('📊 Test Results Summary')
    console.log('=' .repeat(60))
    
    const passed = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length
    const totalTime = results.reduce((sum, r) => sum + (r.duration || 0), 0)
    
    console.log(`✅ Passed: ${passed}`)
    console.log(`❌ Failed: ${failed}`)
    console.log(`⏱️  Total time: ${totalTime}ms`)
    
    if (failed > 0) {
      console.log('\n❌ Failed tests:')
      results.filter(r => !r.success).forEach(r => {
        console.log(`   - ${r.testName}: ${r.error}`)
      })
      process.exit(1)
    } else {
      console.log('\n🎉 All tests passed! DynamoDB progress tracking is working correctly.')
      console.log('\n✨ Key features verified:')
      console.log('   - Progress initialization and updates')
      console.log('   - Completion and failure handling')
      console.log('   - FFmpeg stderr processing with throttling')
      console.log('   - Response time performance (< 500ms average)')
    }
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error)
    process.exit(1)
  }
}

// Run the tests
main().catch(error => {
  console.error('💥 Unexpected error:', error)
  process.exit(1)
})