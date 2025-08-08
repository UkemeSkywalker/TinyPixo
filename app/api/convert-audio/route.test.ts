import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { POST, recoverOrphanedJobs } from './route'
import { jobService, JobStatus } from '../../../lib/job-service'
import { progressService } from '../../../lib/progress-service'
import { streamingConversionService } from '../../../lib/streaming-conversion-service'
import { s3Client } from '../../../lib/aws-services'
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

// Mock the AWS services and dependencies
vi.mock('../../../lib/aws-services')
vi.mock('../../../lib/job-service')
vi.mock('../../../lib/progress-service')
vi.mock('../../../lib/streaming-conversion-service')

describe('/api/convert-audio', () => {
  const mockFileId = 'test-audio-123'
  const mockJobId = '1754408209622'
  const mockBucket = 'test-bucket'
  const mockS3Location = {
    bucket: mockBucket,
    key: `uploads/${mockFileId}`,
    size: 1024000
  }

  const mockJob = {
    jobId: mockJobId,
    status: JobStatus.CREATED,
    inputS3Location: mockS3Location,
    format: 'wav',
    quality: '192k',
    createdAt: new Date(),
    updatedAt: new Date(),
    ttl: Math.floor(Date.now() / 1000) + 86400
  }

  beforeAll(() => {
    // Set environment variables for testing
    process.env.S3_BUCKET_NAME = mockBucket
  })

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Setup default mocks
    vi.mocked(s3Client.send).mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: mockS3Location.size,
          ContentType: 'audio/mpeg'
        }
      }
      return {}
    })

    vi.mocked(jobService.createJob).mockResolvedValue(mockJob)
    vi.mocked(jobService.updateJobStatus).mockResolvedValue()
    vi.mocked(progressService.initializeProgress).mockResolvedValue()
    vi.mocked(progressService.setProgress).mockResolvedValue()
    vi.mocked(progressService.markComplete).mockResolvedValue()
    vi.mocked(progressService.markFailed).mockResolvedValue()
    
    vi.mocked(streamingConversionService.convertAudio).mockResolvedValue({
      success: true,
      outputS3Location: {
        bucket: mockBucket,
        key: `conversions/${mockJobId}.wav`,
        size: 2048000
      },
      fallbackUsed: false,
      processingTimeMs: 5000
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(() => {
    delete process.env.S3_BUCKET_NAME
  })

  describe('POST /api/convert-audio', () => {
    it('should create conversion job successfully with valid request', async () => {
      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(202)
      expect(data).toEqual({
        jobId: mockJobId,
        status: 'created',
        message: 'Conversion job created successfully'
      })

      // Verify services were called correctly
      expect(s3Client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: mockBucket,
            Key: `uploads/${mockFileId}`
          }
        })
      )
      expect(jobService.createJob).toHaveBeenCalledWith({
        inputS3Location: mockS3Location,
        format: 'wav',
        quality: '192k'
      })
      expect(progressService.initializeProgress).toHaveBeenCalledWith(mockJobId)
    })

    it('should return 400 for missing fileId', async () => {
      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          format: 'wav',
          quality: '192k'
        })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Missing required field: fileId')
    })

    it('should return 400 for missing format', async () => {
      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          quality: '192k'
        })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Missing required field: format')
    })

    it('should return 400 for missing quality', async () => {
      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav'
        })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Missing required field: quality')
    })

    it('should return 400 for unsupported format', async () => {
      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'xyz',
          quality: '192k'
        })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Unsupported format: xyz')
    })

    it('should return 400 for invalid quality format', async () => {
      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: 'invalid'
        })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Invalid quality format: invalid')
    })

    it('should return 404 when input file not found', async () => {
      vi.mocked(s3Client.send).mockRejectedValue(
        Object.assign(new Error('Not Found'), { name: 'NotFound' })
      )

      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toContain('Input file not found')
    })

    it('should handle DynamoDB job creation failure', async () => {
      vi.mocked(jobService.createJob).mockRejectedValue(new Error('DynamoDB error'))

      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toContain('Failed to create conversion job')
    })

    it('should continue even if progress initialization fails', async () => {
      vi.mocked(progressService.initializeProgress).mockRejectedValue(new Error('Redis error'))

      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      const response = await POST(request)
      const data = await response.json()

      // Should still succeed even if progress initialization fails
      expect(response.status).toBe(202)
      expect(data.jobId).toBe(mockJobId)
    })

    it('should handle invalid JSON in request body', async () => {
      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: 'invalid json'
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid JSON in request body')
    })

    it('should use custom bucket when provided', async () => {
      const customBucket = 'custom-bucket'
      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k',
          bucket: customBucket
        })
      })

      await POST(request)

      expect(s3Client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: customBucket,
            Key: `uploads/${mockFileId}`
          }
        })
      )
    })

    it('should handle S3 service errors with retry', async () => {
      // Mock S3 to fail twice then succeed
      let callCount = 0
      vi.mocked(s3Client.send).mockImplementation(async () => {
        callCount++
        if (callCount <= 2) {
          throw new Error('Service temporarily unavailable')
        }
        return {
          ContentLength: mockS3Location.size,
          ContentType: 'audio/mpeg'
        }
      })

      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(202)
      expect(data.jobId).toBe(mockJobId)
      expect(callCount).toBe(3) // Should have retried twice
    })

    it('should validate supported audio formats', async () => {
      const supportedFormats = ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a']
      
      for (const format of supportedFormats) {
        const request = new NextRequest('http://localhost/api/convert-audio', {
          method: 'POST',
          body: JSON.stringify({
            fileId: mockFileId,
            format,
            quality: '192k'
          })
        })

        const response = await POST(request)
        expect(response.status).toBe(202)
      }
    })

    it('should validate quality format patterns', async () => {
      const validQualities = ['128k', '192k', '320k', '128', '256K']
      
      for (const quality of validQualities) {
        vi.clearAllMocks()
        vi.mocked(s3Client.send).mockResolvedValue({
          ContentLength: mockS3Location.size,
          ContentType: 'audio/mpeg'
        })
        vi.mocked(jobService.createJob).mockResolvedValue(mockJob)
        vi.mocked(progressService.initializeProgress).mockResolvedValue()

        const request = new NextRequest('http://localhost/api/convert-audio', {
          method: 'POST',
          body: JSON.stringify({
            fileId: mockFileId,
            format: 'wav',
            quality
          })
        })

        const response = await POST(request)
        expect(response.status).toBe(202)
      }
    })
  })

  describe('Async conversion process', () => {
    it('should handle successful conversion workflow', async () => {
      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      await POST(request)

      // Wait for async process to complete
      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify the complete workflow was executed
      expect(jobService.updateJobStatus).toHaveBeenCalledWith(
        mockJobId,
        JobStatus.PROCESSING
      )
      expect(streamingConversionService.convertAudio).toHaveBeenCalledWith(
        mockJob,
        {
          format: 'wav',
          quality: '192k',
          timeout: 300000
        }
      )
      expect(jobService.updateJobStatus).toHaveBeenCalledWith(
        mockJobId,
        JobStatus.COMPLETED,
        {
          bucket: mockBucket,
          key: `conversions/${mockJobId}.wav`,
          size: 2048000
        }
      )
      expect(progressService.markComplete).toHaveBeenCalledWith(mockJobId)
    })

    it('should handle conversion failure', async () => {
      vi.mocked(streamingConversionService.convertAudio).mockResolvedValue({
        success: false,
        error: 'FFmpeg process failed',
        fallbackUsed: false,
        processingTimeMs: 1000
      })

      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      await POST(request)

      // Wait for async process to complete
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(jobService.updateJobStatus).toHaveBeenCalledWith(
        mockJobId,
        JobStatus.FAILED,
        undefined,
        'FFmpeg process failed'
      )
      expect(progressService.markFailed).toHaveBeenCalledWith(
        mockJobId,
        'FFmpeg process failed'
      )
    })

    it('should handle conversion service exception', async () => {
      vi.mocked(streamingConversionService.convertAudio).mockRejectedValue(
        new Error('Service unavailable')
      )

      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      await POST(request)

      // Wait for async process to complete
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(jobService.updateJobStatus).toHaveBeenCalledWith(
        mockJobId,
        JobStatus.FAILED,
        undefined,
        'Service unavailable'
      )
      expect(progressService.markFailed).toHaveBeenCalledWith(
        mockJobId,
        'Service unavailable'
      )
    })
  })

  describe('Job recovery', () => {
    it('should execute orphaned job recovery', async () => {
      // Mock console.log to capture recovery logs
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await recoverOrphanedJobs()

      expect(consoleSpy).toHaveBeenCalledWith('[ConversionAPI] Starting orphaned job recovery process')
      expect(consoleSpy).toHaveBeenCalledWith('[ConversionAPI] Orphaned job recovery completed')

      consoleSpy.mockRestore()
    })

    it('should handle recovery errors gracefully', async () => {
      // Mock console.error to capture error logs
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      // Force an error in recovery (this is a placeholder since the current implementation doesn't have real recovery logic)
      await recoverOrphanedJobs()

      // Should not throw errors
      expect(consoleLogSpy).toHaveBeenCalledWith('[ConversionAPI] Starting orphaned job recovery process')

      consoleErrorSpy.mockRestore()
      consoleLogSpy.mockRestore()
    })
  })

  describe('Error handling and status codes', () => {
    it('should return 404 for not found errors', async () => {
      vi.mocked(s3Client.send).mockRejectedValue(
        Object.assign(new Error('File not found'), { name: 'NotFound' })
      )

      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      const response = await POST(request)
      expect(response.status).toBe(404)
    })

    it('should return 429 for throttling errors', async () => {
      vi.mocked(jobService.createJob).mockRejectedValue(
        new Error('Request rate exceeded quota')
      )

      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      const response = await POST(request)
      expect(response.status).toBe(429)
    })

    it('should return 408 for timeout errors', async () => {
      vi.mocked(s3Client.send).mockRejectedValue(
        new Error('Request timeout occurred')
      )

      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      const response = await POST(request)
      expect(response.status).toBe(408)
    })

    it('should return 403 for permission errors', async () => {
      vi.mocked(s3Client.send).mockRejectedValue(
        new Error('Access denied to resource')
      )

      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      const response = await POST(request)
      expect(response.status).toBe(403)
    })

    it('should include response time in headers', async () => {
      const request = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: mockFileId,
          format: 'wav',
          quality: '192k'
        })
      })

      const response = await POST(request)
      
      expect(response.headers.get('X-Response-Time')).toMatch(/\d+ms/)
      expect(response.headers.get('X-Job-Id')).toBe(mockJobId)
    })
  })
})