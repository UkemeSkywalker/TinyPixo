import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { jobService, JobStatus } from '../../../lib/job-service'
import { s3Client, initializeAllServices } from '../../../lib/aws-services'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getEnvironmentConfig } from '../../../lib/environment'

const config = getEnvironmentConfig()
const bucketName = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'

describe('Download Integration Tests', () => {
  let testJobId: string
  let testFileKey: string
  const testFileContent = Buffer.from('fake audio file content for testing')

  beforeAll(async () => {
    // Initialize services
    await initializeAllServices()
    
    // Create a test job and upload a test file
    testJobId = `test-download-${Date.now()}`
    testFileKey = `conversions/${testJobId}.mp3`
    
    // Upload test file to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: testFileKey,
      Body: testFileContent,
      ContentType: 'audio/mpeg'
    }))
    
    // Create job in DynamoDB
    const job = await jobService.createJob({
      inputS3Location: {
        bucket: bucketName,
        key: `uploads/${testJobId}.mp3`,
        size: testFileContent.length
      },
      format: 'mp3',
      quality: '192k'
    })
    
    // Update job to completed status with output location
    await jobService.updateJobStatus(
      job.jobId,
      JobStatus.COMPLETED,
      {
        bucket: bucketName,
        key: testFileKey,
        size: testFileContent.length
      }
    )
    
    testJobId = job.jobId
  })

  afterAll(async () => {
    // Cleanup test file from S3
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: testFileKey
      }))
    } catch (error) {
      console.warn('Failed to cleanup test file:', error)
    }
  })

  describe('Direct Download Streaming', () => {
    it('should stream file directly from S3', async () => {
      const response = await fetch(`http://localhost:3000/api/download?jobId=${testJobId}`)
      
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('audio/mpeg')
      expect(response.headers.get('content-length')).toBe(testFileContent.length.toString())
      expect(response.headers.get('content-disposition')).toMatch(/attachment; filename="converted-.*\.mp3"/)
      expect(response.headers.get('x-job-id')).toBe(testJobId)
      
      const downloadedContent = await response.arrayBuffer()
      expect(Buffer.from(downloadedContent)).toEqual(testFileContent)
    })

    it('should include proper caching headers', async () => {
      const response = await fetch(`http://localhost:3000/api/download?jobId=${testJobId}`)
      
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-cache, no-store, must-revalidate')
      expect(response.headers.get('pragma')).toBe('no-cache')
      expect(response.headers.get('expires')).toBe('0')
    })

    it('should support range requests', async () => {
      const response = await fetch(`http://localhost:3000/api/download?jobId=${testJobId}`)
      
      expect(response.status).toBe(200)
      expect(response.headers.get('accept-ranges')).toBe('bytes')
    })
  })

  describe('Presigned URL Generation', () => {
    it('should generate valid presigned URL', async () => {
      const response = await fetch(`http://localhost:3000/api/download?jobId=${testJobId}&presigned=true`)
      
      expect(response.status).toBe(200)
      
      const data = await response.json()
      expect(data.presignedUrl).toBeDefined()
      expect(data.presignedUrl).toMatch(/^https?:\/\//)
      expect(data.filename).toMatch(/^converted-.*\.mp3$/)
      expect(data.contentType).toBe('audio/mpeg')
      expect(data.size).toBe(testFileContent.length)
    })

    it('should allow download via presigned URL', async () => {
      // Get presigned URL
      const presignedResponse = await fetch(`http://localhost:3000/api/download?jobId=${testJobId}&presigned=true`)
      expect(presignedResponse.status).toBe(200)
      
      const { presignedUrl } = await presignedResponse.json()
      
      // Download using presigned URL
      const downloadResponse = await fetch(presignedUrl)
      expect(downloadResponse.status).toBe(200)
      
      const downloadedContent = await downloadResponse.arrayBuffer()
      expect(Buffer.from(downloadedContent)).toEqual(testFileContent)
    })
  })

  describe('Large File Handling', () => {
    let largeFileJobId: string
    let largeFileKey: string
    let largeFileContent: Buffer

    beforeAll(async () => {
      // Create a larger test file (1MB)
      largeFileContent = Buffer.alloc(1024 * 1024, 'A')
      largeFileJobId = `test-large-${Date.now()}`
      largeFileKey = `conversions/${largeFileJobId}.wav`
      
      // Upload large file to S3
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: largeFileKey,
        Body: largeFileContent,
        ContentType: 'audio/wav'
      }))
      
      // Create job in DynamoDB
      const job = await jobService.createJob({
        inputS3Location: {
          bucket: bucketName,
          key: `uploads/${largeFileJobId}.mp3`,
          size: largeFileContent.length
        },
        format: 'wav',
        quality: '192k'
      })
      
      // Update job to completed status
      await jobService.updateJobStatus(
        job.jobId,
        JobStatus.COMPLETED,
        {
          bucket: bucketName,
          key: largeFileKey,
          size: largeFileContent.length
        }
      )
      
      largeFileJobId = job.jobId
    })

    afterAll(async () => {
      // Cleanup large test file
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: largeFileKey
        }))
      } catch (error) {
        console.warn('Failed to cleanup large test file:', error)
      }
    })

    it('should handle large files without ERR_CONTENT_LENGTH_MISMATCH', async () => {
      const response = await fetch(`http://localhost:3000/api/download?jobId=${largeFileJobId}`)
      
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('audio/wav')
      expect(response.headers.get('content-length')).toBe(largeFileContent.length.toString())
      
      const downloadedContent = await response.arrayBuffer()
      expect(downloadedContent.byteLength).toBe(largeFileContent.length)
    })

    it('should stream large files efficiently', async () => {
      const startTime = Date.now()
      
      const response = await fetch(`http://localhost:3000/api/download?jobId=${largeFileJobId}`)
      expect(response.status).toBe(200)
      
      // Consume the stream
      const reader = response.body?.getReader()
      let totalBytes = 0
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          totalBytes += value?.length || 0
        }
      }
      
      const duration = Date.now() - startTime
      
      expect(totalBytes).toBe(largeFileContent.length)
      console.log(`Large file download completed in ${duration}ms`)
    })
  })

  describe('Error Scenarios', () => {
    it('should return 404 for non-existent job', async () => {
      const response = await fetch('http://localhost:3000/api/download?jobId=non-existent-job')
      
      expect(response.status).toBe(404)
      
      const data = await response.json()
      expect(data.error).toBe('Job not found')
    })

    it('should return 400 for incomplete job', async () => {
      // Create a job that's still processing
      const incompleteJob = await jobService.createJob({
        inputS3Location: {
          bucket: bucketName,
          key: 'uploads/incomplete.mp3',
          size: 1000
        },
        format: 'mp3',
        quality: '192k'
      })
      
      const response = await fetch(`http://localhost:3000/api/download?jobId=${incompleteJob.jobId}`)
      
      expect(response.status).toBe(400)
      
      const data = await response.json()
      expect(data.error).toBe('Conversion not completed yet')
    })

    it('should return 410 for failed job', async () => {
      // Create a failed job
      const failedJob = await jobService.createJob({
        inputS3Location: {
          bucket: bucketName,
          key: 'uploads/failed.mp3',
          size: 1000
        },
        format: 'mp3',
        quality: '192k'
      })
      
      await jobService.updateJobStatus(failedJob.jobId, JobStatus.FAILED, undefined, 'Conversion failed')
      
      const response = await fetch(`http://localhost:3000/api/download?jobId=${failedJob.jobId}`)
      
      expect(response.status).toBe(410)
      
      const data = await response.json()
      expect(data.error).toBe('Conversion failed')
    })
  })

  describe('Environment Compatibility', () => {
    it('should work with current environment configuration', async () => {
      console.log(`Testing download in ${config.environment} environment`)
      
      const response = await fetch(`http://localhost:3000/api/download?jobId=${testJobId}`)
      
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('audio/mpeg')
      
      const downloadedContent = await response.arrayBuffer()
      expect(Buffer.from(downloadedContent)).toEqual(testFileContent)
    })

    it('should generate working presigned URLs for current environment', async () => {
      const response = await fetch(`http://localhost:3000/api/download?jobId=${testJobId}&presigned=true`)
      
      expect(response.status).toBe(200)
      
      const data = await response.json()
      expect(data.presignedUrl).toBeDefined()
      
      // Test that the presigned URL works
      const downloadResponse = await fetch(data.presignedUrl)
      expect(downloadResponse.status).toBe(200)
      
      const downloadedContent = await downloadResponse.arrayBuffer()
      expect(Buffer.from(downloadedContent)).toEqual(testFileContent)
    })
  })
})