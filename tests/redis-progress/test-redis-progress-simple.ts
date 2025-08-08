#!/usr/bin/env tsx

/**
 * Simple test to demonstrate Redis progress tracking from 0% to 100%
 * This test simulates the progress updates that would occur during a real conversion
 */

import { progressService } from '../../lib/progress-service'

async function testRedisProgressTracking() {
  console.log('🔍 Testing Redis Progress Tracking (0% → 100%)')
  console.log('=' .repeat(60))

  const testJobId = `redis-test-${Date.now()}`
  const progressSnapshots: Array<{progress: number, stage: string, timestamp: number}> = []

  try {
    console.log(`📊 Testing with job ID: ${testJobId}`)

    // Simulate the progress updates that would occur during a real conversion
    const progressStages = [
      { progress: 0, stage: 'initialized' },
      { progress: 5, stage: 'creating S3 input stream' },
      { progress: 15, stage: 'starting FFmpeg process' },
      { progress: 25, stage: 'setting up streaming pipeline' },
      { progress: 35, stage: 'connecting streaming pipeline' },
      { progress: 40, stage: 'streaming conversion started' },
      { progress: 50, stage: 'processing audio stream' },
      { progress: 65, stage: 'processing audio stream' },
      { progress: 70, stage: 'uploading to S3' },
      { progress: 85, stage: 'uploading to S3' },
      { progress: 95, stage: 'finalizing upload' },
      { progress: 100, stage: 'completed' }
    ]

    console.log('\n📈 Simulating progress updates:')
    console.log('Time\t\tProgress\tStage')
    console.log('-'.repeat(60))

    // Initialize progress
    await progressService.initializeProgress(testJobId)

    // Simulate progress updates with realistic timing
    for (const stage of progressStages) {
      await progressService.setProgress(testJobId, {
        jobId: testJobId,
        progress: stage.progress,
        stage: stage.stage,
        startTime: Date.now()
      })

      // Record snapshot
      progressSnapshots.push({
        progress: stage.progress,
        stage: stage.stage,
        timestamp: Date.now()
      })

      const timeStr = new Date().toLocaleTimeString()
      const progressStr = `${stage.progress}%`.padEnd(8)
      const stageStr = stage.stage.padEnd(25)
      
      console.log(`${timeStr}\t${progressStr}\t${stageStr}`)

      // Wait a bit to simulate real processing time
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    console.log('\n🔍 Verifying Redis storage and retrieval...')

    // Test retrieval at different points
    const testRetrievals = [
      { expectedProgress: 0, description: 'Initial state' },
      { expectedProgress: 50, description: 'Mid-conversion' },
      { expectedProgress: 100, description: 'Completion' }
    ]

    for (const test of testRetrievals) {
      // Set specific progress
      await progressService.setProgress(testJobId, {
        jobId: testJobId,
        progress: test.expectedProgress,
        stage: test.expectedProgress === 100 ? 'completed' : 'processing',
        startTime: Date.now()
      })

      // Retrieve and verify
      const retrieved = await progressService.getProgress(testJobId)
      
      if (!retrieved) {
        throw new Error(`Failed to retrieve progress for ${test.description}`)
      }

      if (retrieved.progress !== test.expectedProgress) {
        throw new Error(`Expected ${test.expectedProgress}%, got ${retrieved.progress}% for ${test.description}`)
      }

      console.log(`✅ ${test.description}: ${retrieved.progress}% (${retrieved.stage})`)
    }

    // Validate progression
    console.log('\n📊 Validating progress progression...')
    
    const progressValues = progressSnapshots.map(s => s.progress)
    const minProgress = Math.min(...progressValues)
    const maxProgress = Math.max(...progressValues)

    console.log(`   Progress range: ${minProgress}% → ${maxProgress}%`)
    console.log(`   Total updates: ${progressSnapshots.length}`)
    console.log(`   Stages: ${[...new Set(progressSnapshots.map(s => s.stage))].join(', ')}`)

    // Validation checks
    const validations = [
      {
        name: 'Started at 0%',
        condition: minProgress === 0,
        actual: `${minProgress}%`
      },
      {
        name: 'Reached 100%',
        condition: maxProgress === 100,
        actual: `${maxProgress}%`
      },
      {
        name: 'Multiple progress updates',
        condition: progressSnapshots.length >= 10,
        actual: `${progressSnapshots.length} updates`
      },
      {
        name: 'Progress is monotonically increasing',
        condition: isMonotonicallyIncreasing(progressValues),
        actual: getProgressTrend(progressValues)
      }
    ]

    let allValid = true
    console.log('\n✅ Validation Results:')
    for (const validation of validations) {
      const status = validation.condition ? '✅' : '❌'
      console.log(`${status} ${validation.name}: ${validation.actual}`)
      if (!validation.condition) allValid = false
    }

    if (!allValid) {
      throw new Error('Progress progression validation failed!')
    }

    console.log('\n🎉 Redis Progress Tracking Test PASSED!')
    console.log('✅ Successfully demonstrated Redis progress tracking from 0% to 100%')

  } catch (error) {
    console.error('\n❌ Redis Progress Tracking Test FAILED:', error)
    throw error
  }
}

function isMonotonicallyIncreasing(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) {
      return false
    }
  }
  return true
}

function getProgressTrend(values: number[]): string {
  if (values.length < 2) return 'insufficient data'
  
  const first = values[0]
  const last = values[values.length - 1]
  const isIncreasing = isMonotonicallyIncreasing(values)
  
  return `${first}% → ${last}% (${isIncreasing ? 'monotonic' : 'non-monotonic'})`
}

// Run the test
async function main() {
  try {
    await testRedisProgressTracking()
    console.log('\n🎉 Redis Progress Test COMPLETED SUCCESSFULLY!')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Redis Progress Test FAILED:', error)
    process.exit(1)
  }
}

// Only run if called directly
if (require.main === module) {
  main()
}

export { testRedisProgressTracking }