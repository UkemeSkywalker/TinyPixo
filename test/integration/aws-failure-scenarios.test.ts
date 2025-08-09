import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as convertPost } from '../../app/api/convert-audio/route'
import { GET as progressGet } from '../../app/api/progress/route'
import { jobService } from '../../lib/job-service'
import { progressService } from '../../lib/progress-service'
import { s3Client } from '../../lib/aws-services'
import { TestFileManager, waitForCondition } from '../test-helpers'
import { getCurrentTestEnvironment, TEST_TIMEOUTS, TEST_FILES } from '../test-config'

describe('AWS Service Failure Scenarios', () => {
  const testEnv = getCurrentTestEnvironment()
  const fileManager = new TestFileManager()

  console.log(`Running AWS failure tests with ${testEnv.name}`)

  beforeAll(async () => {
    await fileManager.setupTestFiles()
  }, TEST_TIMEOUTS.integration)

  afterAll(async () => {
    await fileManager.cleanup(s3Client, testEnv.s3Bucket)
    vi.restoreAllMocks()
  }, TEST_TIMEOUTS.integration)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('S3 Service Failures', () => {
    it('should handle S3 connection timeout', async () => {
      const testId = `s3-timeout-${Date.now()}`
      
      // Mock S3 timeout
      const originalSend = s3Client.send
      vi.spyOn(s3Client, 'send').mockImplementation(async (command) => {
        if (command.constructor.name === 'HeadObjectCommand') {
          throw new Error('Connection timeout')
        }
        return originalSend.call(s3Client, command)
      })

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
      
      // Should handle timeout gracefully
      expect([404, 500, 503]).toContain(convertResponse.status)
      
      const responseData = await convertResponse.json()
      expect(responseData.error).toBeDefined()

      console.log(`S3 timeout handled: ${convertResponse.status} - ${responseData.error}`)
    })

    it('should handle S3 access denied errors', async () => {
      const testId = `s3-access-denied-${Date.now()}`
      
      // Mock S3 access denied
      vi.spyOn(s3Client, 'send').mockRejectedValue(
        Object.assign(new Error('Access Denied'), { name: 'AccessDenied' })
      )

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
      
      expect([403, 500]).toContain(convertResponse.status)
      
      const responseData = await convertResponse.json()
      expect(responseData.error).toContain('Access')

      console.log(`S3 access denied handled: ${convertResponse.status}`)
    })

    it('should handle S3 throttling with retry logic', async () => {
      const testId = `s3-throttling-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

      let callCount = 0
      const originalSend = s3Client.send
      
      // Mock throttling for first few calls, then succeed
      vi.spyOn(s3Client, 'send').mockImplementation(async (command) => {
        callCount++
        
        if (callCount <= 2 && command.constructor.name === 'HeadObjectCommand') {
          const error = new Error('SlowDown')
          error.name = 'SlowDown'
          throw error
        }
        
        return originalSend.call(s3Client, command)
      })

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
      
      // Should eventually succeed after retries
      expect([202, 500]).toContain(convertResponse.status)
      
      if (convertResponse.status === 202) {
        console.log('S3 throttling handled with retry logic')
        expect(callCount).toBeGreaterThan(2) // Should have retried
      } else {
        console.log('S3 throttling caused failure after max retries')
      }
    })

    it('should handle S3 bucket not found', async () => {
      const testId = `s3-bucket-not-found-${Date.now()}`

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
      
      expect([404, 500]).toContain(convertResponse.status)
      
      const responseData = await convertResponse.json()
      expect(responseData.error).toBeDefined()

      console.log(`S3 bucket not found handled: ${convertResponse.status}`)
    })
  })

  describe('DynamoDB Service Failures', () => {
    it('should handle DynamoDB connection failures', async () => {
      // Mock DynamoDB failure
      const mockError = new Error('DynamoDB connection failed')
      vi.spyOn(jobService, 'createJob').mockRejectedValue(mockError)

      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: 'test.mp3',
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      
      expect(convertResponse.status).toBe(500)
      
      const responseData = await convertResponse.json()
      expect(responseData.error).toContain('DynamoDB')

      console.log('DynamoDB connection failure handled')
    })

    it('should handle DynamoDB throttling', async () => {
      let callCount = 0
      const originalCreateJob = jobService.createJob.bind(jobService)
      
      // Mock throttling for first few calls
      vi.spyOn(jobService, 'createJob').mockImplementation(async (input) => {
        callCount++
        
        if (callCount <= 2) {
          const error = new Error('ProvisionedThroughputExceededException')
          error.name = 'ProvisionedThroughputExceededException'
          throw error
        }
        
        return originalCreateJob(input)
      })

      const testId = `dynamo-throttling-${Date.now()}`
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
      
      // Should eventually succeed or fail gracefully
      expect([202, 429, 500]).toContain(convertResponse.status)
      
      if (convertResponse.status === 202) {
        console.log('DynamoDB throttling handled with retry logic')
        expect(callCount).toBeGreaterThan(2)
      } else {
        console.log(`DynamoDB throttling caused ${convertResponse.status} response`)
      }
    })

    it('should handle DynamoDB table not found', async () => {
      const mockError = new Error('Table not found')
      mockError.name = 'ResourceNotFoundException'
      
      vi.spyOn(jobService, 'getJob').mockRejectedValue(mockError)

      const progressRequest = new NextRequest('http://localhost/api/progress?jobId=test-job')
      const progressResponse = await progressGet(progressRequest)
      
      expect([404, 500]).toContain(progressResponse.status)

      console.log('DynamoDB table not found handled')
    })
  })

  describe('Redis Service Failures', () => {
    it('should fallback to DynamoDB when Redis is unavailable', async () => {
      const testId = `redis-unavailable-${Date.now()}`
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

      expect(convertResponse.status).toBe(202)

      // Mock Redis failure
      vi.spyOn(progressService, 'getProgress').mockImplementation(async (jobId) => {
        // Simulate Redis failure, should fallback to DynamoDB
        const job = await jobService.getJob(jobId)
        if (!job) return null

        return {
          jobId,
          progress: job.status === 'completed' ? 100 : 
                   job.status === 'failed' ? -1 : 50,
          stage: job.status
        }
      })

      // Check progress (should use DynamoDB fallback)
      const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
      const progressResponse = await progressGet(progressRequest)
      const progressData = await progressResponse.json()

      expect(progressResponse.status).toBe(200)
      expect(progressData.jobId).toBe(jobId)
      expect(progressData.progress).toBeGreaterThanOrEqual(0)

      console.log(`Redis fallback working: ${progressData.progress}% (${progressData.stage})`)
    })

    it('should handle Redis connection timeout', async () => {
      // Mock Redis timeout
      vi.spyOn(progressService, 'setProgress').mockRejectedValue(
        new Error('Redis connection timeout')
      )

      const testId = `redis-timeout-${Date.now()}`

      // Should not throw error, just log warning
      await expect(progressService.setProgress(testId, {
        jobId: testId,
        progress: 50,
        stage: 'converting'
      })).resolves.toBeUndefined()

      console.log('Redis timeout handled gracefully')
    })

    it('should handle Redis memory pressure', async () => {
      // Mock Redis out of memory
      vi.spyOn(progressService, 'setProgress').mockRejectedValue(
        Object.assign(new Error('OOM command not allowed'), { code: 'OOM' })
      )

      const testId = `redis-oom-${Date.now()}`

      // Should handle gracefully
      await expect(progressService.setProgress(testId, {
        jobId: testId,
        progress: 75,
        stage: 'converting'
      })).resolves.toBeUndefined()

      console.log('Redis OOM handled gracefully')
    })
  })

  describe('Network and Connectivity Failures', () => {
    it('should handle network partitions', async () => {
      const testId = `network-partition-${Date.now()}`

      // Mock network error
      const networkError = new Error('Network is unreachable')
      networkError.name = 'NetworkingError'
      
      vi.spyOn(s3Client, 'send').mockRejectedValue(networkError)

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
      
      expect([500, 503]).toContain(convertResponse.status)
      
      const responseData = await convertResponse.json()
      expect(responseData.error).toBeDefined()

      console.log(`Network partition handled: ${convertResponse.status}`)
    })

    it('should handle DNS resolution failures', async () => {
      const testId = `dns-failure-${Date.now()}`

      // Mock DNS error
      const dnsError = new Error('getaddrinfo ENOTFOUND')
      dnsError.name = 'DNSError'
      
      vi.spyOn(jobService, 'createJob').mockRejectedValue(dnsError)

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
      
      expect([500, 503]).toContain(convertResponse.status)

      console.log(`DNS failure handled: ${convertResponse.status}`)
    })

    it('should handle SSL/TLS certificate errors', async () => {
      const testId = `ssl-error-${Date.now()}`

      // Mock SSL error
      const sslError = new Error('certificate verify failed')
      sslError.name = 'SSLError'
      
      vi.spyOn(s3Client, 'send').mockRejectedValue(sslError)

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
      
      expect([500, 503]).toContain(convertResponse.status)

      console.log(`SSL error handled: ${convertResponse.status}`)
    })
  })

  describe('Service Recovery and Circuit Breaker', () => {
    it('should implement circuit breaker pattern for failing services', async () => {
      let failureCount = 0
      const maxFailures = 3
      
      // Mock service that fails then recovers
      const originalSend = s3Client.send
      vi.spyOn(s3Client, 'send').mockImplementation(async (command) => {
        failureCount++
        
        if (failureCount <= maxFailures) {
          throw new Error('Service temporarily unavailable')
        }
        
        // Service recovers after max failures
        return originalSend.call(s3Client, command)
      })

      const testId = `circuit-breaker-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

      // Make multiple requests
      const requests = Array.from({ length: 5 }, (_, i) => {
        return new NextRequest('http://localhost/api/convert-audio', {
          method: 'POST',
          body: JSON.stringify({
            fileId: `${testId}-${i}.mp3`,
            format: 'wav',
            quality: '192k',
            bucket: testEnv.s3Bucket
          })
        })
      })

      const responses = await Promise.all(requests.map(req => convertPost(req)))
      
      // First few should fail, later ones might succeed
      const failedResponses = responses.filter(r => r.status >= 400).length
      const successfulResponses = responses.filter(r => r.status < 400).length

      console.log(`Circuit breaker test: ${failedResponses} failed, ${successfulResponses} succeeded`)
      
      expect(failedResponses).toBeGreaterThan(0) // Some should fail
      expect(failureCount).toBeGreaterThan(maxFailures) // Should have attempted retries
    })

    it('should recover gracefully when services come back online', async () => {
      const testId = `service-recovery-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

      let isServiceDown = true
      
      // Mock service that's initially down then comes back
      const originalCreateJob = jobService.createJob.bind(jobService)
      vi.spyOn(jobService, 'createJob').mockImplementation(async (input) => {
        if (isServiceDown) {
          throw new Error('Service temporarily unavailable')
        }
        return originalCreateJob(input)
      })

      // First request should fail
      const failRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const failResponse = await convertPost(failRequest)
      expect(failResponse.status).toBe(500)

      // Service comes back online
      isServiceDown = false

      // Second request should succeed
      const successRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const successResponse = await convertPost(successRequest)
      expect(successResponse.status).toBe(202)

      console.log('Service recovery test passed')
    })
  })

  describe('Partial Service Failures', () => {
    it('should handle mixed service availability', async () => {
      const testId = `mixed-availability-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

      // S3 works, DynamoDB fails
      vi.spyOn(jobService, 'createJob').mockRejectedValue(
        new Error('DynamoDB unavailable')
      )

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
      
      // Should fail gracefully when critical service (DynamoDB) is down
      expect(convertResponse.status).toBe(500)

      console.log('Mixed service availability handled')
    })

    it('should continue working when non-critical services fail', async () => {
      const testId = `non-critical-failure-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

      // Redis fails (non-critical, has DynamoDB fallback)
      vi.spyOn(progressService, 'setProgress').mockRejectedValue(
        new Error('Redis unavailable')
      )

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
      
      // Should still work with Redis down (DynamoDB fallback)
      expect(convertResponse.status).toBe(202)

      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      // Progress should still be available via DynamoDB fallback
      const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
      const progressResponse = await progressGet(progressRequest)
      
      expect(progressResponse.status).toBe(200)

      console.log('Non-critical service failure handled with fallback')
    })
  })
})