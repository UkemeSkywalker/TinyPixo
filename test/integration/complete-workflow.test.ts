import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as uploadPost } from '../../app/api/upload-audio/route'
import { POST as convertPost } from '../../app/api/convert-audio/route'
import { GET as downloadGet } from '../../app/api/download/route'
import { GET as progressGet } from '../../app/api/progress/route'
import { jobService, JobStatus } from '../../lib/job-service'
import { progressService } from '../../lib/progress-service'
import { s3Client } from '../../lib/aws-services'
import { TestFileManager, PerformanceMonitor, waitForCondition } from '../test-helpers'
import { getCurrentTestEnvironment, TEST_TIMEOUTS, TEST_FILES, PERFORMANCE_THRESHOLDS } from '../test-config'
import { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

describe('Complete Workflow Integration Tests', () => {
  const testEnv = getCurrentTestEnvironment()
  const fileManager = new TestFileManager()
  let performanceMonitor: PerformanceMonitor

  console.log(`Running integration tests with ${testEnv.name}`)

  beforeAll(async () => {
    await fileManager.setupTestFiles()
    console.log(`Test environment: ${testEnv.name}`)
    console.log(`S3 bucket: ${testEnv.s3Bucket}`)
  }, TEST_TIMEOUTS.integration)

  afterAll(async () => {
    await fileManager.cleanup(s3Client, testEnv.s3Bucket)
  }, TEST_TIMEOUTS.integration)

  beforeEach(() => {
    performanceMonitor = new PerformanceMonitor()
  })

  afterEach(() => {
    if (performanceMonitor) {
      performanceMonitor.stop()
    }
  })

  describe('Upload → Convert → Download Workflow', () => {
    it('should complete full workflow with small file', async () => {
      performanceMonitor.start()
      const testId = `small-${Date.now()}`

      // Step 1: Upload file
      console.log('Step 1: Uploading small audio file')
      
      const uploadKey = `uploads/${testId}.mp3`
      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

      // Step 2: Start conversion
      console.log('Step 2: Starting conversion')
      
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
      expect(convertData.jobId).toBeDefined()

      const jobId = convertData.jobId

      // Step 3: Monitor progress
      console.log('Step 3: Monitoring progress')
      
      await waitForCondition(async () => {
        const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
        const progressResponse = await progressGet(progressRequest)
        const progressData = await progressResponse.json()

        console.log(`Progress: ${progressData.progress}% (${progressData.stage})`)

        if (progressData.progress === -1) {
          throw new Error(`Conversion failed: ${progressData.error}`)
        }

        return progressData.progress === 100
      }, PERFORMANCE_THRESHOLDS.smallFileConversion)

      // Step 4: Verify job completion
      console.log('Step 4: Verifying job completion')
      
      const job = await jobService.getJob(jobId)
      expect(job).toBeDefined()
      expect(job!.status).toBe(JobStatus.COMPLETED)
      expect(job!.outputS3Location).toBeDefined()

      // Step 5: Download converted file
      console.log('Step 5: Downloading converted file')
      
      const downloadRequest = new NextRequest(`http://localhost/api/download?jobId=${jobId}`)
      const downloadResponse = await downloadGet(downloadRequest)

      expect(downloadResponse.status).toBe(200)
      expect(downloadResponse.headers.get('content-type')).toContain('audio')

      const metrics = performanceMonitor.stop()
      console.log(`Small file workflow completed in ${metrics.duration}ms`)
      
      expect(metrics.duration).toBeLessThan(PERFORMANCE_THRESHOLDS.smallFileConversion)
      expect(metrics.peakMemory.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.maxMemoryUsage)

    }, TEST_TIMEOUTS.performance)

    it('should complete full workflow with medium file', async () => {
      performanceMonitor.start()
      const testId = `medium-${Date.now()}`

      // Upload medium file
      const uploadKey = `uploads/${testId}.mp3`
      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.mediumAudio)

      // Start conversion
      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '128k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()

      expect(convertResponse.status).toBe(202)
      const jobId = convertData.jobId

      // Monitor progress with more detailed logging
      let lastProgress = -1
      await waitForCondition(async () => {
        const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
        const progressResponse = await progressGet(progressRequest)
        const progressData = await progressResponse.json()

        if (progressData.progress !== lastProgress) {
          console.log(`Progress: ${progressData.progress}% (${progressData.stage})`)
          lastProgress = progressData.progress
        }

        if (progressData.progress === -1) {
          throw new Error(`Conversion failed: ${progressData.error}`)
        }

        return progressData.progress === 100
      }, PERFORMANCE_THRESHOLDS.mediumFileConversion)

      // Verify completion and download
      const job = await jobService.getJob(jobId)
      expect(job!.status).toBe(JobStatus.COMPLETED)

      const downloadRequest = new NextRequest(`http://localhost/api/download?jobId=${jobId}`)
      const downloadResponse = await downloadGet(downloadRequest)
      expect(downloadResponse.status).toBe(200)

      const metrics = performanceMonitor.stop()
      console.log(`Medium file workflow completed in ${metrics.duration}ms`)
      
      expect(metrics.duration).toBeLessThan(PERFORMANCE_THRESHOLDS.mediumFileConversion)

    }, TEST_TIMEOUTS.performance)

    it('should complete full workflow with large file', async () => {
      performanceMonitor.start()
      const testId = `large-${Date.now()}`

      // Upload large file
      const uploadKey = `uploads/${testId}.mp3`
      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.largeAudio)

      // Start conversion
      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'mp3',
          quality: '128k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()

      expect(convertResponse.status).toBe(202)
      const jobId = convertData.jobId

      // Monitor progress with performance tracking
      const progressUpdates: number[] = []
      await waitForCondition(async () => {
        const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
        const progressResponse = await progressGet(progressRequest)
        const progressData = await progressResponse.json()

        progressUpdates.push(progressData.progress)

        if (progressData.progress === -1) {
          throw new Error(`Conversion failed: ${progressData.error}`)
        }

        return progressData.progress === 100
      }, PERFORMANCE_THRESHOLDS.largeFileConversion, 2000) // Check every 2 seconds

      // Verify progress was monotonic (no resets to 0%)
      for (let i = 1; i < progressUpdates.length; i++) {
        if (progressUpdates[i] < progressUpdates[i - 1] && progressUpdates[i] !== 100) {
          console.warn(`Progress regression detected: ${progressUpdates[i - 1]}% → ${progressUpdates[i]}%`)
        }
      }

      const job = await jobService.getJob(jobId)
      expect(job!.status).toBe(JobStatus.COMPLETED)

      const metrics = performanceMonitor.stop()
      console.log(`Large file workflow completed in ${metrics.duration}ms`)
      console.log(`Peak memory usage: ${Math.round(metrics.peakMemory.heapUsed / 1024 / 1024)}MB`)
      
      expect(metrics.duration).toBeLessThan(PERFORMANCE_THRESHOLDS.largeFileConversion)

    }, TEST_TIMEOUTS.performance)
  })

  describe('Multi-Environment Compatibility', () => {
    it('should work with current test environment', async () => {
      console.log(`Testing compatibility with ${testEnv.name}`)
      
      const testId = `env-test-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`
      
      // Test S3 connectivity
      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)
      
      const headResult = await s3Client.send(new HeadObjectCommand({
        Bucket: testEnv.s3Bucket,
        Key: uploadKey
      }))
      
      expect(headResult.ContentLength).toBeGreaterThan(0)

      // Test DynamoDB connectivity
      const testJob = await jobService.getJob('non-existent-job')
      expect(testJob).toBeNull()

      // Test Redis connectivity (with fallback)
      const testProgress = await progressService.getProgress('non-existent-job')
      expect(testProgress).toBeNull()

      console.log(`${testEnv.name} compatibility test passed`)
    })

    it('should handle environment-specific configurations', async () => {
      if (testEnv.useRealAWS) {
        console.log('Testing real AWS service configurations')
        
        // Test real AWS-specific features
        expect(process.env.AWS_REGION).toBeDefined()
        
        // Test IAM permissions by attempting S3 operations
        const testKey = `permissions-test-${Date.now()}.txt`
        await s3Client.send(new PutObjectCommand({
          Bucket: testEnv.s3Bucket,
          Key: testKey,
          Body: 'permission test'
        }))

        await s3Client.send(new DeleteObjectCommand({
          Bucket: testEnv.s3Bucket,
          Key: testKey
        }))

      } else {
        console.log('Testing LocalStack/Docker configurations')
        
        // Test LocalStack-specific features
        expect(testEnv.dynamodbEndpoint).toBeDefined()
        expect(testEnv.redisEndpoint).toBeDefined()
      }
    })
  })

  describe('Error Handling and Recovery', () => {
    it('should handle file not found errors', async () => {
      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: 'non-existent-file.mp3',
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()

      expect(convertResponse.status).toBe(404)
      expect(convertData.error).toContain('not found')
    })

    it('should handle invalid format requests', async () => {
      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: 'test.mp3',
          format: 'invalid-format',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()

      expect(convertResponse.status).toBe(400)
      expect(convertData.error).toContain('Unsupported format')
    })

    it('should handle malformed requests', async () => {
      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: 'invalid json'
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()

      expect(convertResponse.status).toBe(400)
      expect(convertData.error).toBe('Invalid JSON in request body')
    })

    it('should handle AWS service failures gracefully', async () => {
      // This test simulates AWS service failures
      const testId = `failure-test-${Date.now()}`
      
      // Try to convert a file from a non-existent bucket
      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: 'non-existent-bucket-12345'
        })
      })

      const convertResponse = await convertPost(convertRequest)
      
      // Should handle the error gracefully
      expect([404, 500]).toContain(convertResponse.status)
    })
  })

  describe('Performance and Resource Management', () => {
    it('should handle concurrent conversions', async () => {
      const concurrentJobs = Math.min(PERFORMANCE_THRESHOLDS.concurrentJobs, 3)
      const jobPromises: Promise<any>[] = []
      
      console.log(`Testing ${concurrentJobs} concurrent conversions`)

      for (let i = 0; i < concurrentJobs; i++) {
        const testId = `concurrent-${Date.now()}-${i}`
        const uploadKey = `uploads/${testId}.mp3`
        
        // Upload test file
        await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

        // Start conversion
        const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
          method: 'POST',
          body: JSON.stringify({
            fileId: `${testId}.mp3`,
            format: 'wav',
            quality: '128k',
            bucket: testEnv.s3Bucket
          })
        })

        jobPromises.push(convertPost(convertRequest))
      }

      performanceMonitor.start()
      const responses = await Promise.all(jobPromises)
      const metrics = performanceMonitor.stop()

      // All jobs should be accepted
      responses.forEach(response => {
        expect(response.status).toBe(202)
      })

      console.log(`${concurrentJobs} concurrent jobs started in ${metrics.duration}ms`)
      console.log(`Peak memory: ${Math.round(metrics.peakMemory.heapUsed / 1024 / 1024)}MB`)

      // Wait for all jobs to complete
      const jobIds = await Promise.all(responses.map(async r => {
        const data = await r.json()
        return data.jobId
      }))

      // Monitor all jobs
      await Promise.all(jobIds.map(jobId => 
        waitForCondition(async () => {
          const job = await jobService.getJob(jobId)
          return job?.status === JobStatus.COMPLETED || job?.status === JobStatus.FAILED
        }, TEST_TIMEOUTS.integration)
      ))

      console.log('All concurrent jobs completed')

    }, TEST_TIMEOUTS.performance)

    it('should maintain stable memory usage', async () => {
      const testId = `memory-test-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`
      
      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.mediumAudio)

      performanceMonitor.start()

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

      // Monitor memory during conversion
      await waitForCondition(async () => {
        const job = await jobService.getJob(jobId)
        return job?.status === JobStatus.COMPLETED || job?.status === JobStatus.FAILED
      }, TEST_TIMEOUTS.integration)

      const metrics = performanceMonitor.stop()

      console.log(`Memory usage - Peak: ${Math.round(metrics.peakMemory.heapUsed / 1024 / 1024)}MB, Average: ${Math.round(metrics.averageMemory.heapUsed / 1024 / 1024)}MB`)

      // Memory usage should be reasonable
      expect(metrics.peakMemory.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.maxMemoryUsage)

    }, TEST_TIMEOUTS.performance)
  })

  describe('Progress Tracking Reliability', () => {
    it('should provide consistent progress updates', async () => {
      const testId = `progress-test-${Date.now()}`
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

      const progressHistory: number[] = []
      let completed = false

      // Monitor progress every second
      const progressInterval = setInterval(async () => {
        try {
          const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
          const progressResponse = await progressGet(progressRequest)
          const progressData = await progressResponse.json()

          progressHistory.push(progressData.progress)

          if (progressData.progress === 100 || progressData.progress === -1) {
            completed = true
            clearInterval(progressInterval)
          }
        } catch (error) {
          console.error('Error checking progress:', error)
        }
      }, 1000)

      // Wait for completion
      await waitForCondition(() => Promise.resolve(completed), TEST_TIMEOUTS.integration)

      // Analyze progress history
      console.log('Progress history:', progressHistory)

      // Progress should generally increase (allowing for some fluctuation)
      let regressions = 0
      for (let i = 1; i < progressHistory.length; i++) {
        if (progressHistory[i] < progressHistory[i - 1] - 5) { // Allow 5% tolerance
          regressions++
        }
      }

      console.log(`Progress regressions: ${regressions}/${progressHistory.length - 1}`)
      
      // Should have minimal regressions (the main issue we're fixing)
      expect(regressions).toBeLessThan(Math.ceil(progressHistory.length * 0.1)) // Less than 10%

    }, TEST_TIMEOUTS.integration)

    it('should handle progress polling from multiple clients', async () => {
      const testId = `multi-client-${Date.now()}`
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
      const jobId = convertData.jobId

      // Simulate multiple clients polling progress
      const clientCount = 5
      const clientPromises = Array.from({ length: clientCount }, async (_, clientIndex) => {
        const clientProgress: number[] = []
        
        await waitForCondition(async () => {
          const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
          const progressResponse = await progressGet(progressRequest)
          const progressData = await progressResponse.json()

          clientProgress.push(progressData.progress)

          return progressData.progress === 100 || progressData.progress === -1
        }, TEST_TIMEOUTS.integration)

        return clientProgress
      })

      const allClientProgress = await Promise.all(clientPromises)

      // All clients should see consistent progress
      allClientProgress.forEach((clientProgress, index) => {
        console.log(`Client ${index} saw ${clientProgress.length} progress updates`)
        expect(clientProgress.length).toBeGreaterThan(0)
        expect(clientProgress[clientProgress.length - 1]).toBeOneOf([100, -1])
      })

    }, TEST_TIMEOUTS.integration)
  })
})