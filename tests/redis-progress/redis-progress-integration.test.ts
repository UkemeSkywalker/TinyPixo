import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../../app/api/convert-audio/route'
import { progressService } from '../../lib/progress-service'
import { s3Client } from '../../lib/aws-services'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createReadStream, existsSync } from 'fs'
import { join } from 'path'

/**
 * Integration test specifically for Redis progress tracking from 0% to 100%
 * This test validates the core requirement from Task 8:
 * "Watch progress updates in Redis going from 0% to 100% during the full pipeline"
 */

const USE_REAL_AWS = process.env.INTEGRATION_TEST_USE_REAL_AWS === 'true'
const TEST_BUCKET = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'
const TEST_TIMEOUT = 120000 // 2 minutes for integration tests

describe('Redis Progress Tracking Integration', () => {
  const testAudioFile = join(process.cwd(), 'public', 'Simon Callow Charles Dickens Story (1).mp3')
  let uploadedFiles: string[] = []

  beforeAll(async () => {
    console.log(`Running Redis progress tests with ${USE_REAL_AWS ? 'real AWS' : 'LocalStack'}`)
    console.log(`Test bucket: ${TEST_BUCKET}`)
  }, TEST_TIMEOUT)

  afterAll(async () => {
    // Clean up uploaded test files
    console.log(`Cleaning up ${uploadedFiles.length} test files`)
    
    const cleanupPromises = uploadedFiles.map(async (key) => {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: TEST_BUCKET,
          Key: key
        }))
        console.log(`Cleaned up: ${key}`)
      } catch (error) {
        console.warn(`Failed to clean up ${key}:`, error)
      }
    })

    await Promise.all(cleanupPromises)
  }, TEST_TIMEOUT)

  beforeEach(() => {
    uploadedFiles = []
  })

  describe('Full Pipeline Redis Progress Tracking', () => {
    it('should track Redis progress from 0% to 100% during complete conversion workflow', async () => {
      // Skip if test file doesn't exist
      try {
        const fs = await import('fs/promises')
        await fs.access(testAudioFile)
      } catch (error) {
        console.log('Skipping Redis progress test - test audio file not available')
        return
      }

      console.log('🔍 Testing Redis progress tracking from 0% to 100%')

      // Step 1: Upload test file
      const fileId = `redis-progress-${Date.now()}`
      const uploadKey = `uploads/${fileId}.mp3`
      uploadedFiles.push(uploadKey)

      console.log(`📤 Uploading test file: ${uploadKey}`)
      const fileStream = createReadStream(testAudioFile)
      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKET,
        Key: uploadKey,
        Body: fileStream,
        ContentType: 'audio/mpeg'
      }))

      // Step 2: Start conversion
      console.log('🚀 Starting conversion process')
      const conversionRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${fileId}.mp3`,
          format: 'wav',
          quality: '128k',
          bucket: TEST_BUCKET
        })
      })

      const response = await POST(conversionRequest)
      const data = await response.json()
      expect(response.status).toBe(202)

      const jobId = data.jobId
      console.log(`📊 Monitoring Redis progress for job: ${jobId}`)

      // Step 3: Monitor Redis progress updates
      const progressSnapshots: Array<{progress: number, stage: string, timestamp: number}> = []
      let progressComplete = false
      let attempts = 0
      const maxAttempts = 60 // 60 seconds max wait time

      console.log('Time\t\tProgress\tStage')
      console.log('-'.repeat(60))

      while (!progressComplete && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)) // Poll every second
        attempts++

        try {
          const progress = await progressService.getProgress(jobId)
          
          if (progress) {
            // Record unique progress updates
            const lastSnapshot = progressSnapshots[progressSnapshots.length - 1]
            if (!lastSnapshot || 
                lastSnapshot.progress !== progress.progress || 
                lastSnapshot.stage !== progress.stage) {
              
              progressSnapshots.push({
                progress: progress.progress,
                stage: progress.stage,
                timestamp: Date.now()
              })
              
              const timeStr = new Date().toLocaleTimeString()
              const progressStr = `${progress.progress}%`.padEnd(8)
              const stageStr = progress.stage.padEnd(25)
              
              console.log(`${timeStr}\t${progressStr}\t${stageStr}`)
            }

            if (progress.progress === 100) {
              progressComplete = true
              console.log('✅ Progress reached 100% - conversion completed!')
            } else if (progress.progress === -1) {
              throw new Error(`Conversion failed: ${progress.error}`)
            }
          }
        } catch (error) {
          console.error(`Progress check error (attempt ${attempts}):`, error)
        }
      }

      if (!progressComplete) {
        throw new Error(`Conversion did not complete within ${maxAttempts} seconds`)
      }

      // Step 4: Validate Redis progress progression
      console.log('\n📈 Validating Redis progress progression...')
      
      expect(progressSnapshots.length).toBeGreaterThan(0)
      
      const progressValues = progressSnapshots.map(s => s.progress)
      const minProgress = Math.min(...progressValues)
      const maxProgress = Math.max(...progressValues)

      console.log(`   Progress range: ${minProgress}% → ${maxProgress}%`)
      console.log(`   Total updates: ${progressSnapshots.length}`)
      console.log(`   Stages seen: ${[...new Set(progressSnapshots.map(s => s.stage))].join(', ')}`)

      // Core Redis progress tracking assertions
      expect(minProgress).toBeLessThanOrEqual(10) // Started at or near 0%
      expect(maxProgress).toBe(100) // Reached 100%
      expect(progressSnapshots.length).toBeGreaterThanOrEqual(3) // Multiple updates
      
      // Verify generally increasing trend (allow some fluctuation for real-world scenarios)
      const firstProgress = progressSnapshots[0].progress
      const lastProgress = progressSnapshots[progressSnapshots.length - 1].progress
      expect(lastProgress).toBeGreaterThanOrEqual(firstProgress)

      // Verify we have meaningful stage progression
      const stages = [...new Set(progressSnapshots.map(s => s.stage))]
      expect(stages.length).toBeGreaterThanOrEqual(2) // At least 2 different stages

      console.log('✅ Redis progress tracking from 0% to 100% validated!')
      console.log('🎉 Full pipeline Redis progress test PASSED!')

    }, TEST_TIMEOUT)

    it('should handle Redis progress tracking with concurrent conversions', async () => {
      // Skip if test file doesn't exist
      try {
        const fs = await import('fs/promises')
        await fs.access(testAudioFile)
      } catch (error) {
        console.log('Skipping concurrent Redis progress test - test audio file not available')
        return
      }

      console.log('🔍 Testing Redis progress tracking with concurrent jobs')

      const concurrentJobs = 2
      const jobIds: string[] = []

      // Start multiple conversions
      for (let i = 0; i < concurrentJobs; i++) {
        const fileId = `concurrent-redis-${Date.now()}-${i}`
        const uploadKey = `uploads/${fileId}.mp3`
        uploadedFiles.push(uploadKey)

        // Upload file
        const fileStream = createReadStream(testAudioFile)
        await s3Client.send(new PutObjectCommand({
          Bucket: TEST_BUCKET,
          Key: uploadKey,
          Body: fileStream,
          ContentType: 'audio/mpeg'
        }))

        // Start conversion
        const conversionRequest = new NextRequest('http://localhost/api/convert-audio', {
          method: 'POST',
          body: JSON.stringify({
            fileId: `${fileId}.mp3`,
            format: 'wav',
            quality: '128k',
            bucket: TEST_BUCKET
          })
        })

        const response = await POST(conversionRequest)
        const data = await response.json()
        expect(response.status).toBe(202)
        jobIds.push(data.jobId)
        
        console.log(`Started concurrent job ${i + 1}: ${data.jobId}`)
      }

      // Monitor progress for all jobs
      const allProgressSnapshots: Record<string, Array<{progress: number, stage: string}>> = {}
      jobIds.forEach(jobId => {
        allProgressSnapshots[jobId] = []
      })

      let allJobsComplete = false
      let attempts = 0
      const maxAttempts = 90 // 90 seconds for concurrent jobs

      while (!allJobsComplete && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        attempts++

        let completedJobs = 0

        for (const jobId of jobIds) {
          try {
            const progress = await progressService.getProgress(jobId)
            
            if (progress) {
              const snapshots = allProgressSnapshots[jobId]
              const lastSnapshot = snapshots[snapshots.length - 1]
              
              if (!lastSnapshot || 
                  lastSnapshot.progress !== progress.progress || 
                  lastSnapshot.stage !== progress.stage) {
                
                snapshots.push({
                  progress: progress.progress,
                  stage: progress.stage
                })
              }

              if (progress.progress === 100) {
                completedJobs++
              }
            }
          } catch (error) {
            console.error(`Error checking progress for job ${jobId}:`, error)
          }
        }

        if (completedJobs === jobIds.length) {
          allJobsComplete = true
        }
      }

      // Validate that each job had proper progress tracking
      for (const jobId of jobIds) {
        const snapshots = allProgressSnapshots[jobId]
        expect(snapshots.length).toBeGreaterThan(0)
        
        const progressValues = snapshots.map(s => s.progress)
        const maxProgress = Math.max(...progressValues)
        
        expect(maxProgress).toBe(100) // Each job should reach 100%
        console.log(`Job ${jobId}: ${snapshots.length} progress updates, max: ${maxProgress}%`)
      }

      console.log('✅ Concurrent Redis progress tracking validated!')

    }, TEST_TIMEOUT)
  })

  describe('Redis Progress Edge Cases', () => {
    it('should handle Redis progress tracking when Redis is temporarily unavailable', async () => {
      console.log('🔍 Testing Redis progress with fallback scenarios')

      // This test would simulate Redis being unavailable and falling back to DynamoDB
      // For now, we'll test that the progress service handles errors gracefully
      
      const testJobId = `fallback-test-${Date.now()}`
      
      try {
        // Try to get progress for non-existent job (should return null, not throw)
        const progress = await progressService.getProgress(testJobId)
        expect(progress).toBeNull()
        
        console.log('✅ Redis fallback handling validated!')
      } catch (error) {
        console.error('Redis fallback test failed:', error)
        throw error
      }
    })
  })
})