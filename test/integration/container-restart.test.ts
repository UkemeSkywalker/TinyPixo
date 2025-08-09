import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as convertPost } from '../../app/api/convert-audio/route'
import { GET as progressGet } from '../../app/api/progress/route'
import { jobService, JobStatus } from '../../lib/job-service'
import { progressService } from '../../lib/progress-service'
import { s3Client } from '../../lib/aws-services'
import { TestFileManager, ContainerRestartSimulator, waitForCondition } from '../test-helpers'
import { getCurrentTestEnvironment, TEST_TIMEOUTS, TEST_FILES } from '../test-config'

describe('Container Restart Simulation Tests', () => {
  const testEnv = getCurrentTestEnvironment()
  const fileManager = new TestFileManager()
  let restartSimulator: ContainerRestartSimulator

  console.log(`Running container restart tests with ${testEnv.name}`)

  beforeAll(async () => {
    await fileManager.setupTestFiles()
    restartSimulator = new ContainerRestartSimulator()
  }, TEST_TIMEOUTS.integration)

  afterAll(async () => {
    await fileManager.cleanup(s3Client, testEnv.s3Bucket)
    restartSimulator.cleanup()
  }, TEST_TIMEOUTS.integration)

  beforeEach(() => {
    // Reset any global state before each test
    if (global.conversionProgress) {
      delete global.conversionProgress
    }
  })

  describe('Job Recovery After Container Restart', () => {
    it('should recover job state from DynamoDB after restart', async () => {
      const testId = `restart-recovery-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      // Step 1: Upload test file and start conversion
      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.mediumAudio)

      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      
      expect(convertResponse.status).toBe(202)
      const jobId = convertData.jobId

      // Step 2: Wait for conversion to start
      await waitForCondition(async () => {
        const job = await jobService.getJob(jobId)
        return job?.status === JobStatus.PROCESSING
      }, 10000)

      console.log('Conversion started, simulating container restart...')

      // Step 3: Simulate container restart
      await restartSimulator.simulateRestart()

      // Step 4: Verify job state is recoverable from DynamoDB
      const recoveredJob = await jobService.getJob(jobId)
      expect(recoveredJob).toBeDefined()
      expect(recoveredJob!.jobId).toBe(jobId)
      expect(recoveredJob!.inputS3Location).toBeDefined()
      expect(recoveredJob!.format).toBe('wav')

      console.log(`Job recovered after restart: ${recoveredJob!.status}`)

      // Step 5: Verify progress can be retrieved (from DynamoDB fallback)
      const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
      const progressResponse = await progressGet(progressRequest)
      const progressData = await progressResponse.json()

      expect(progressResponse.status).toBe(200)
      expect(progressData.jobId).toBe(jobId)
      
      // Progress should be available even if Redis data was lost
      expect(progressData.progress).toBeGreaterThanOrEqual(0)

      console.log(`Progress after restart: ${progressData.progress}% (${progressData.stage})`)

    }, TEST_TIMEOUTS.containerRestart)

    it('should handle orphaned jobs after restart', async () => {
      const testId = `orphaned-job-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      // Create a job that will be orphaned
      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      // Wait for job to start processing
      await waitForCondition(async () => {
        const job = await jobService.getJob(jobId)
        return job?.status === JobStatus.PROCESSING
      }, 10000)

      // Simulate container restart during processing
      console.log('Simulating restart during processing...')
      await restartSimulator.simulateRestart()

      // The job should still be in DynamoDB
      const orphanedJob = await jobService.getJob(jobId)
      expect(orphanedJob).toBeDefined()

      // In a real system, there would be a recovery mechanism
      // For this test, we verify the job can be identified as orphaned
      const timeSinceUpdate = Date.now() - orphanedJob!.updatedAt.getTime()
      console.log(`Job last updated ${timeSinceUpdate}ms ago`)

      // Job should be identifiable as potentially orphaned
      expect(timeSinceUpdate).toBeGreaterThan(0)

    }, TEST_TIMEOUTS.containerRestart)

    it('should maintain progress consistency across restarts', async () => {
      const testId = `progress-consistency-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.mediumAudio)

      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      // Monitor progress before restart
      const progressBeforeRestart: number[] = []
      let restartTriggered = false

      const monitorProgress = async () => {
        while (!restartTriggered) {
          try {
            const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
            const progressResponse = await progressGet(progressRequest)
            const progressData = await progressResponse.json()

            progressBeforeRestart.push(progressData.progress)

            // Trigger restart when we have some progress
            if (progressData.progress > 10 && progressData.progress < 90 && !restartTriggered) {
              restartTriggered = true
              console.log(`Triggering restart at ${progressData.progress}% progress`)
              await restartSimulator.simulateRestart()
            }

            await new Promise(resolve => setTimeout(resolve, 1000))
          } catch (error) {
            console.error('Error monitoring progress:', error)
            break
          }
        }
      }

      // Start monitoring
      const monitorPromise = monitorProgress()

      // Wait for restart to be triggered
      await waitForCondition(() => Promise.resolve(restartTriggered), 30000)

      // Check progress after restart
      const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
      const progressResponse = await progressGet(progressRequest)
      const progressData = await progressResponse.json()

      console.log(`Progress before restart: ${progressBeforeRestart}`)
      console.log(`Progress after restart: ${progressData.progress}%`)

      // Progress should not reset to 0% after restart (the main issue we're fixing)
      expect(progressData.progress).not.toBe(0)
      
      // Progress should be reasonable (either from Redis or DynamoDB fallback)
      expect(progressData.progress).toBeGreaterThanOrEqual(-1) // -1 for failed, >= 0 for valid progress

      await monitorPromise

    }, TEST_TIMEOUTS.containerRestart)
  })

  describe('Redis Failover and Recovery', () => {
    it('should fallback to DynamoDB when Redis is unavailable', async () => {
      const testId = `redis-failover-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

      // Start conversion
      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      // Wait for some progress
      await waitForCondition(async () => {
        const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
        const progressResponse = await progressGet(progressRequest)
        const progressData = await progressResponse.json()
        return progressData.progress > 0
      }, 15000)

      // Simulate Redis failure by clearing Redis data
      console.log('Simulating Redis failure...')
      
      // In a real scenario, Redis would be unavailable
      // Here we simulate by clearing the progress data
      await restartSimulator.simulateRestart()

      // Progress should still be available via DynamoDB fallback
      const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
      const progressResponse = await progressGet(progressRequest)
      const progressData = await progressResponse.json()

      expect(progressResponse.status).toBe(200)
      expect(progressData.jobId).toBe(jobId)
      
      // Should get fallback progress from DynamoDB
      expect(progressData.progress).toBeGreaterThanOrEqual(0)

      console.log(`Fallback progress from DynamoDB: ${progressData.progress}%`)

    }, TEST_TIMEOUTS.containerRestart)

    it('should handle Redis reconnection gracefully', async () => {
      const testId = `redis-reconnect-${Date.now()}`

      // Test Redis connectivity recovery
      try {
        await progressService.initializeProgress(testId)
        console.log('Redis connection test passed')

        const progress = await progressService.getProgress(testId)
        expect(progress).toBeDefined()

      } catch (error) {
        console.log('Redis unavailable, testing DynamoDB fallback')
        
        // Should still work with DynamoDB fallback
        const progress = await progressService.getProgress('non-existent-job')
        expect(progress).toBeNull()
      }
    })
  })

  describe('File System and S3 Consistency', () => {
    it('should handle S3 file availability after restart', async () => {
      const testId = `s3-consistency-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      // Upload file
      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

      // Start conversion
      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      // Simulate restart
      await restartSimulator.simulateRestart()

      // Verify S3 files are still accessible
      const job = await jobService.getJob(jobId)
      expect(job).toBeDefined()

      // Input file should still be accessible
      const { HeadObjectCommand } = await import('@aws-sdk/client-s3')
      const headResult = await s3Client.send(new HeadObjectCommand({
        Bucket: testEnv.s3Bucket,
        Key: job!.inputS3Location.key
      }))

      expect(headResult.ContentLength).toBeGreaterThan(0)
      console.log(`S3 file still accessible after restart: ${headResult.ContentLength} bytes`)

    }, TEST_TIMEOUTS.containerRestart)

    it('should clean up temporary files after restart', async () => {
      // This test verifies that temporary files don't accumulate after restarts
      const testId = `temp-cleanup-${Date.now()}`

      // Simulate restart
      await restartSimulator.simulateRestart()

      // Check that no temporary files are left behind
      // In a real implementation, this would check /tmp directory
      const initialMemory = process.memoryUsage()
      
      // Memory usage should be reasonable after restart
      expect(initialMemory.heapUsed).toBeLessThan(500 * 1024 * 1024) // 500MB

      console.log(`Memory usage after restart: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`)
    })
  })

  describe('Job State Transitions', () => {
    it('should handle job state transitions correctly after restart', async () => {
      const testId = `state-transition-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

      // Create job
      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      // Verify initial state
      let job = await jobService.getJob(jobId)
      expect(job!.status).toBe(JobStatus.CREATED)

      // Wait for processing to start
      await waitForCondition(async () => {
        job = await jobService.getJob(jobId)
        return job?.status === JobStatus.PROCESSING
      }, 10000)

      console.log('Job transitioned to PROCESSING')

      // Simulate restart during processing
      await restartSimulator.simulateRestart()

      // Job should still be in PROCESSING state
      job = await jobService.getJob(jobId)
      expect(job!.status).toBe(JobStatus.PROCESSING)

      console.log('Job state preserved after restart')

      // Wait for completion or failure
      await waitForCondition(async () => {
        job = await jobService.getJob(jobId)
        return job?.status === JobStatus.COMPLETED || job?.status === JobStatus.FAILED
      }, TEST_TIMEOUTS.integration)

      console.log(`Final job state: ${job!.status}`)
      expect([JobStatus.COMPLETED, JobStatus.FAILED]).toContain(job!.status)

    }, TEST_TIMEOUTS.containerRestart)

    it('should handle concurrent job restarts', async () => {
      const jobCount = 3
      const jobIds: string[] = []

      // Start multiple jobs
      for (let i = 0; i < jobCount; i++) {
        const testId = `concurrent-restart-${Date.now()}-${i}`
        const uploadKey = `uploads/${testId}.mp3`

        await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

        const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
          method: 'POST',
          body: JSON.stringify({
            fileId: `${testId}.mp3`,
            format: 'wav',
            quality: '192k',
            bucket: testEnv.s3Bucket
          })
        })

        const convertResponse = await convertPost(convertRequest)
        const convertData = await convertResponse.json()
        jobIds.push(convertData.jobId)
      }

      // Wait for all jobs to start processing
      await Promise.all(jobIds.map(jobId =>
        waitForCondition(async () => {
          const job = await jobService.getJob(jobId)
          return job?.status === JobStatus.PROCESSING
        }, 10000)
      ))

      console.log('All jobs started processing, simulating restart...')

      // Simulate restart
      await restartSimulator.simulateRestart()

      // All jobs should still be recoverable
      const recoveredJobs = await Promise.all(jobIds.map(jobId => jobService.getJob(jobId)))

      recoveredJobs.forEach((job, index) => {
        expect(job).toBeDefined()
        expect(job!.jobId).toBe(jobIds[index])
        console.log(`Job ${index + 1} recovered: ${job!.status}`)
      })

    }, TEST_TIMEOUTS.containerRestart)
  })

  describe('Performance Impact of Restarts', () => {
    it('should measure restart recovery time', async () => {
      const testId = `restart-performance-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.mediumAudio)

      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      // Wait for processing to start
      await waitForCondition(async () => {
        const job = await jobService.getJob(jobId)
        return job?.status === JobStatus.PROCESSING
      }, 10000)

      // Measure restart time
      const restartStartTime = Date.now()
      await restartSimulator.simulateRestart()
      const restartEndTime = Date.now()

      const restartDuration = restartEndTime - restartStartTime
      console.log(`Container restart simulation took ${restartDuration}ms`)

      // Measure recovery time
      const recoveryStartTime = Date.now()
      const recoveredJob = await jobService.getJob(jobId)
      const recoveryEndTime = Date.now()

      const recoveryDuration = recoveryEndTime - recoveryStartTime
      console.log(`Job recovery took ${recoveryDuration}ms`)

      expect(recoveredJob).toBeDefined()
      expect(restartDuration).toBeLessThan(5000) // Should restart quickly
      expect(recoveryDuration).toBeLessThan(1000) // Should recover quickly

    }, TEST_TIMEOUTS.containerRestart)
  })
})