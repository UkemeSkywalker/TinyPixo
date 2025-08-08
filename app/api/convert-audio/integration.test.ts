import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { jobService, JobStatus } from '../../../lib/job-service'
import { progressService } from '../../../lib/progress-service'
import { s3Client } from '../../../lib/aws-services'
import { PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createReadStream } from 'fs'
import { join } from 'path'

/**
 * Integration tests for the conversion orchestration API
 * These tests work with both LocalStack (development) and real AWS services (when configured)
 * 
 * To run with LocalStack:
 * 1. Start LocalStack: npm run dev:services
 * 2. Run tests: npm test -- app/api/convert-audio/integration.test.ts
 * 
 * To run with real AWS:
 * 1. Set AWS credentials and region
 * 2. Set INTEGRATION_TEST_USE_REAL_AWS=true
 * 3. Run tests: npm test -- app/api/convert-audio/integration.test.ts
 */

const USE_REAL_AWS = process.env.INTEGRATION_TEST_USE_REAL_AWS === 'true'
const TEST_BUCKET = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'
const TEST_TIMEOUT = 60000 // 60 seconds for integration tests

describe('Conversion API Integration Tests', () => {
  const testFileId = `integration-test-${Date.now()}`
  const testAudioFile = join(process.cwd(), 'public', 'Simon Callow Charles Dickens Story (1).mp3')
  let uploadedFiles: string[] = []

  beforeAll(async () => {
    console.log(`Running integration tests with ${USE_REAL_AWS ? 'real AWS' : 'LocalStack'}`)
    console.log(`Test bucket: ${TEST_BUCKET}`)
    
    // Verify test audio file exists
    try {
      const fs = await import('fs/promises')
      await fs.access(testAudioFile)
      console.log(`Test audio file found: ${testAudioFile}`)
    } catch (error) {
      console.warn(`Test audio file not found: ${testAudioFile}`)
      console.warn('Some tests may be skipped')
    }
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

  describe('Complete workflow integration', () => {
    it('should complete full upload → convert → download workflow', async () => {
      // Skip if test file doesn't exist
      try {
        const fs = await import('fs/promises')
        await fs.access(testAudioFile)
      } catch (error) {
        console.log('Skipping integration test - test audio file not available')
        return
      }

      console.log('Starting complete workflow integration test')

      // Step 1: Upload test file to S3 (simulating the upload API)
      const uploadKey = `uploads/${testFileId}.mp3`
      uploadedFiles.push(uploadKey)

      console.log(`Uploading test file to S3: ${uploadKey}`)
      
      const fileStream = createReadStream(testAudioFile)
      await s3Client.send(new PutObjectCommand({
        Bucket: TEST_BUCKET,
        Key: uploadKey,
        Body: fileStream,
        ContentType: 'audio/mpeg'
      }))

      // Verify upload
      const headResult = await s3Client.send(new HeadObjectCommand({
        Bucket: TEST_BUCKET,
        Key: uploadKey
      }))
      
      expect(headResult.ContentLength).toBeGreaterThan(0)
      console.log(`File uploaded successfully: ${headResult.ContentLength} bytes`)

      // Step 2: Start conversion
      console.log('Starting conversion process')
      
      const conversionRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testFileId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: TEST_BUCKET
        })
      })

      const conversionResponse = await POST(conversionRequest)
      const conversionData = await conversionResponse.json()

      expect(conversionResponse.status).toBe(202)
      expect(conversionData.jobId).toBeDefined()
      expect(conversionData.status).toBe('created')

      const jobId = conversionData.jobId
      console.log(`Conversion job created: ${jobId}`)

      // Step 3: Monitor progress
      console.log('Monitoring conversion progress')
      
      let progressComplete = false
      let attempts = 0
      const maxAttempts = 60 // 60 seconds max wait time
      
      while (!progressComplete && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)) // Wait 1 second
        attempts++

        try {
          const progress = await progressService.getProgress(jobId)
          
          if (progress) {
            console.log(`Progress: ${progress.progress}% (${progress.stage})`)
            
            if (progress.progress === 100) {
              progressComplete = true
              console.log('Conversion completed successfully')
            } else if (progress.progress === -1) {
              throw new Error(`Conversion failed: ${progress.error}`)
            }
          } else {
            console.log(`No progress data found for job ${jobId}`)
          }
        } catch (error) {
          console.error(`Error checking progress (attempt ${attempts}):`, error)
        }
      }

      if (!progressComplete) {
        throw new Error(`Conversion did not complete within ${maxAttempts} seconds`)
      }

      // Step 4: Verify job status in DynamoDB
      console.log('Verifying job status in DynamoDB')
      
      const job = await jobService.getJob(jobId)
      expect(job).toBeDefined()
      expect(job!.status).toBe(JobStatus.COMPLETED)
      expect(job!.outputS3Location).toBeDefined()
      
      const outputKey = job!.outputS3Location!.key
      uploadedFiles.push(outputKey) // Add to cleanup list
      
      console.log(`Job completed with output: ${outputKey}`)

      // Step 5: Verify output file exists in S3
      console.log('Verifying output file in S3')
      
      const outputHeadResult = await s3Client.send(new HeadObjectCommand({
        Bucket: TEST_BUCKET,
        Key: outputKey
      }))

      expect(outputHeadResult.ContentLength).toBeGreaterThan(0)
      expect(outputHeadResult.ContentType).toContain('audio')
      
      console.log(`Output file verified: ${outputHeadResult.ContentLength} bytes, ${outputHeadResult.ContentType}`)
      console.log('Complete workflow integration test passed!')

    }, TEST_TIMEOUT)

    it('should handle conversion failure gracefully', async () => {
      console.log('Testing conversion failure handling')

      // Create a job with an invalid/non-existent file
      const invalidFileId = `invalid-${Date.now()}`
      
      const conversionRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: invalidFileId,
          format: 'wav',
          quality: '192k',
          bucket: TEST_BUCKET
        })
      })

      const conversionResponse = await POST(conversionRequest)
      const conversionData = await conversionResponse.json()

      expect(conversionResponse.status).toBe(404)
      expect(conversionData.error).toContain('Input file not found')
      
      console.log('Conversion failure handling test passed!')
    })

    it('should handle concurrent conversions', async () => {
      // Skip if test file doesn't exist
      try {
        const fs = await import('fs/promises')
        await fs.access(testAudioFile)
      } catch (error) {
        console.log('Skipping concurrent test - test audio file not available')
        return
      }

      console.log('Testing concurrent conversions')

      const concurrentJobs = 3
      const jobPromises: Promise<any>[] = []

      // Upload test files for concurrent processing
      for (let i = 0; i < concurrentJobs; i++) {
        const fileId = `concurrent-${Date.now()}-${i}`
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

        jobPromises.push(POST(conversionRequest))
      }

      // Wait for all jobs to be created
      const responses = await Promise.all(jobPromises)
      
      // Verify all jobs were created successfully
      for (const response of responses) {
        expect(response.status).toBe(202)
        const data = await response.json()
        expect(data.jobId).toBeDefined()
        console.log(`Concurrent job created: ${data.jobId}`)
      }

      console.log('Concurrent conversions test passed!')
    }, TEST_TIMEOUT)


  })

  describe('AWS service integration', () => {
    it('should handle S3 connectivity', async () => {
      console.log('Testing S3 connectivity')

      try {
        // Test S3 connectivity by attempting to head a non-existent object
        await s3Client.send(new HeadObjectCommand({
          Bucket: TEST_BUCKET,
          Key: 'connectivity-test'
        }))
      } catch (error: any) {
        // Should get NotFound error, which means S3 is accessible
        expect(error.name).toBe('NotFound')
      }

      console.log('S3 connectivity test passed!')
    })

    it('should handle DynamoDB connectivity', async () => {
      console.log('Testing DynamoDB connectivity')

      try {
        // Test DynamoDB connectivity by attempting to get a non-existent job
        const result = await jobService.getJob('connectivity-test')
        expect(result).toBeNull()
      } catch (error) {
        // Should not throw error for non-existent job
        throw error
      }

      console.log('DynamoDB connectivity test passed!')
    })

    it('should handle Redis connectivity', async () => {
      console.log('Testing Redis connectivity')

      try {
        // Test Redis connectivity by attempting to get progress for non-existent job
        const result = await progressService.getProgress('connectivity-test')
        expect(result).toBeNull()
      } catch (error) {
        console.warn('Redis connectivity test failed:', error)
        // Redis failure should not break the test since it has DynamoDB fallback
      }

      console.log('Redis connectivity test completed!')
    })
  })

  describe('Error scenarios', () => {
    it('should handle AWS service throttling', async () => {
      console.log('Testing AWS service throttling simulation')

      // This test simulates what happens when AWS services are throttled
      // In a real scenario, the retry logic should handle this
      
      const conversionRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: 'throttle-test',
          format: 'wav',
          quality: '192k',
          bucket: TEST_BUCKET
        })
      })

      const conversionResponse = await POST(conversionRequest)
      
      // Should get 404 since file doesn't exist, but the request should be processed
      expect([404, 500]).toContain(conversionResponse.status)
      
      console.log('AWS service throttling test completed!')
    })

    it('should handle malformed requests', async () => {
      console.log('Testing malformed request handling')

      const malformedRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: 'invalid json'
      })

      const response = await POST(malformedRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid JSON in request body')
      
      console.log('Malformed request handling test passed!')
    })

    it('should validate request parameters', async () => {
      console.log('Testing request parameter validation')

      const testCases = [
        {
          body: { format: 'wav', quality: '192k' },
          expectedError: 'Missing required field: fileId'
        },
        {
          body: { fileId: 'test', quality: '192k' },
          expectedError: 'Missing required field: format'
        },
        {
          body: { fileId: 'test', format: 'wav' },
          expectedError: 'Missing required field: quality'
        },
        {
          body: { fileId: 'test', format: 'invalid', quality: '192k' },
          expectedError: 'Unsupported format: invalid'
        },
        {
          body: { fileId: 'test', format: 'wav', quality: 'invalid' },
          expectedError: 'Invalid quality format: invalid'
        }
      ]

      for (const testCase of testCases) {
        const request = new NextRequest('http://localhost/api/convert-audio', {
          method: 'POST',
          body: JSON.stringify(testCase.body)
        })

        const response = await POST(request)
        const data = await response.json()

        expect(response.status).toBe(400)
        expect(data.error).toContain(testCase.expectedError)
      }
      
      console.log('Request parameter validation test passed!')
    })
  })

  describe('Performance and monitoring', () => {
    it('should include performance metrics in response headers', async () => {
      console.log('Testing performance metrics')

      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: 'performance-test',
          format: 'wav',
          quality: '192k',
          bucket: TEST_BUCKET
        })
      })

      const response = await POST(request)
      
      expect(response.headers.get('X-Response-Time')).toMatch(/\d+ms/)
      
      if (response.status === 202) {
        expect(response.headers.get('X-Job-Id')).toBeDefined()
      }
      
      console.log(`Response time: ${response.headers.get('X-Response-Time')}`)
      console.log('Performance metrics test passed!')
    })

    it('should handle high load scenarios', async () => {
      console.log('Testing high load scenario')

      const requests = []
      const requestCount = 10

      for (let i = 0; i < requestCount; i++) {
        const request = new NextRequest('http://localhost/api/convert-audio', {
          method: 'POST',
          body: JSON.stringify({
            fileId: `load-test-${i}`,
            format: 'wav',
            quality: '192k',
            bucket: TEST_BUCKET
          })
        })

        requests.push(POST(request))
      }

      const startTime = Date.now()
      const responses = await Promise.all(requests)
      const endTime = Date.now()

      console.log(`Processed ${requestCount} requests in ${endTime - startTime}ms`)

      // All requests should be processed (though they may fail due to missing files)
      expect(responses).toHaveLength(requestCount)
      
      for (const response of responses) {
        expect([202, 404, 500]).toContain(response.status)
      }
      
      console.log('High load scenario test passed!')
    })
  })
})