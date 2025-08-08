import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { jobService, JobStatus } from '../../../lib/job-service'
import { s3Client } from '../../../lib/aws-services'

// Mock dependencies
vi.mock('../../../lib/job-service')
vi.mock('../../../lib/aws-services')
vi.mock('@aws-sdk/s3-request-presigner')

const mockJobService = vi.mocked(jobService)
const mockS3Client = vi.mocked(s3Client)

describe('/api/download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Input Validation', () => {
    it('should return 400 when jobId is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/download')
      
      const response = await GET(request)
      const data = await response.json()
      
      expect(response.status).toBe(400)
      expect(data.error).toBe('Job ID is required')
    })

    it('should return 404 when job is not found', async () => {
      mockJobService.getJob.mockResolvedValue(null)
      
      const request = new NextRequest('http://localhost:3000/api/download?jobId=nonexistent')
      
      const response = await GET(request)
      const data = await response.json()
      
      expect(response.status).toBe(404)
      expect(data.error).toBe('Job not found')
      expect(mockJobService.getJob).toHaveBeenCalledWith('nonexistent')
    })
  })

  describe('Job Status Validation', () => {
    it('should return 400 when conversion is not completed', async () => {
      const job = {
        jobId: 'test-job',
        status: JobStatus.PROCESSING,
        format: 'mp3',
        outputS3Location: null
      }
      
      mockJobService.getJob.mockResolvedValue(job)
      
      const request = new NextRequest('http://localhost:3000/api/download?jobId=test-job')
      
      const response = await GET(request)
      const data = await response.json()
      
      expect(response.status).toBe(400)
      expect(data.error).toBe('Conversion not completed yet')
    })

    it('should return 410 when conversion failed', async () => {
      const job = {
        jobId: 'failed-job',
        status: JobStatus.FAILED,
        format: 'mp3',
        outputS3Location: null
      }
      
      mockJobService.getJob.mockResolvedValue(job)
      
      const request = new NextRequest('http://localhost:3000/api/download?jobId=failed-job')
      
      const response = await GET(request)
      const data = await response.json()
      
      expect(response.status).toBe(410)
      expect(data.error).toBe('Conversion failed')
    })

    it('should return 404 when output file location is missing', async () => {
      const job = {
        jobId: 'completed-job',
        status: JobStatus.COMPLETED,
        format: 'mp3',
        outputS3Location: null
      }
      
      mockJobService.getJob.mockResolvedValue(job)
      
      const request = new NextRequest('http://localhost:3000/api/download?jobId=completed-job')
      
      const response = await GET(request)
      const data = await response.json()
      
      expect(response.status).toBe(404)
      expect(data.error).toBe('Output file not available')
    })
  })

  describe('S3 File Validation', () => {
    it('should return 404 when file does not exist in S3', async () => {
      const job = {
        jobId: 'test-job',
        status: JobStatus.COMPLETED,
        format: 'mp3',
        outputS3Location: {
          bucket: 'test-bucket',
          key: 'conversions/test-job.mp3',
          size: 1000000
        }
      }
      
      mockJobService.getJob.mockResolvedValue(job)
      
      // Mock S3 HeadObject to throw NotFound error
      const notFoundError = new Error('Not Found')
      notFoundError.name = 'NotFound'
      mockS3Client.send.mockRejectedValue(notFoundError)
      
      const request = new NextRequest('http://localhost:3000/api/download?jobId=test-job')
      
      const response = await GET(request)
      const data = await response.json()
      
      expect(response.status).toBe(404)
      expect(data.error).toBe('File not found in storage')
    })
  })

  describe('Presigned URL Generation', () => {
    it('should return presigned URL when requested', async () => {
      const job = {
        jobId: 'test-job',
        status: JobStatus.COMPLETED,
        format: 'mp3',
        outputS3Location: {
          bucket: 'test-bucket',
          key: 'conversions/test-job.mp3',
          size: 1000000
        }
      }
      
      mockJobService.getJob.mockResolvedValue(job)
      
      // Mock successful S3 HeadObject
      mockS3Client.send.mockResolvedValue({
        ContentLength: 1000000,
        LastModified: new Date(),
        ETag: '"abc123"'
      })
      
      // Mock presigned URL generation
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      vi.mocked(getSignedUrl).mockResolvedValue('https://presigned-url.com/file')
      
      const request = new NextRequest('http://localhost:3000/api/download?jobId=test-job&presigned=true')
      
      const response = await GET(request)
      const data = await response.json()
      
      expect(response.status).toBe(200)
      expect(data.presignedUrl).toBe('https://presigned-url.com/file')
      expect(data.contentType).toBe('audio/mpeg')
      expect(data.size).toBe(1000000)
      expect(data.filename).toMatch(/^converted-test-job-\d{8}T\d{6}\.mp3$/)
    })
  })

  describe('Content Type Detection', () => {
    const testCases = [
      { format: 'mp3', expected: 'audio/mpeg' },
      { format: 'wav', expected: 'audio/wav' },
      { format: 'aac', expected: 'audio/aac' },
      { format: 'ogg', expected: 'audio/ogg' },
      { format: 'flac', expected: 'audio/flac' },
      { format: 'm4a', expected: 'audio/mp4' },
      { format: 'wma', expected: 'audio/x-ms-wma' },
      { format: 'opus', expected: 'audio/opus' },
      { format: 'unknown', expected: 'application/octet-stream' }
    ]

    testCases.forEach(({ format, expected }) => {
      it(`should return correct content type for ${format}`, async () => {
        const job = {
          jobId: 'test-job',
          status: JobStatus.COMPLETED,
          format,
          outputS3Location: {
            bucket: 'test-bucket',
            key: `conversions/test-job.${format}`,
            size: 1000000
          }
        }
        
        mockJobService.getJob.mockResolvedValue(job)
        mockS3Client.send.mockResolvedValue({
          ContentLength: 1000000,
          LastModified: new Date(),
          ETag: '"abc123"'
        })
        
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
        vi.mocked(getSignedUrl).mockResolvedValue('https://presigned-url.com/file')
        
        const request = new NextRequest(`http://localhost:3000/api/download?jobId=test-job&presigned=true`)
        
        const response = await GET(request)
        const data = await response.json()
        
        expect(response.status).toBe(200)
        expect(data.contentType).toBe(expected)
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle S3 service errors gracefully', async () => {
      const job = {
        jobId: 'test-job',
        status: JobStatus.COMPLETED,
        format: 'mp3',
        outputS3Location: {
          bucket: 'test-bucket',
          key: 'conversions/test-job.mp3',
          size: 1000000
        }
      }
      
      mockJobService.getJob.mockResolvedValue(job)
      
      // Mock S3 service error - first call (HeadObject) succeeds, second call (GetObject) fails
      mockS3Client.send
        .mockResolvedValueOnce({ // HeadObject succeeds
          ContentLength: 1000000,
          LastModified: new Date(),
          ETag: '"abc123"'
        })
        .mockRejectedValueOnce(new Error('Service Unavailable')) // GetObject fails
      
      const request = new NextRequest('http://localhost:3000/api/download?jobId=test-job')
      
      const response = await GET(request)
      const data = await response.json()
      
      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to download file')
      expect(data.details).toBe('Service Unavailable')
    })

    it('should handle job service errors gracefully', async () => {
      mockJobService.getJob.mockRejectedValue(new Error('Database connection failed'))
      
      const request = new NextRequest('http://localhost:3000/api/download?jobId=test-job')
      
      const response = await GET(request)
      const data = await response.json()
      
      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to validate download access')
    })
  })

  describe('Filename Generation', () => {
    it('should generate unique filenames with timestamp', async () => {
      const job = {
        jobId: 'test-job-123',
        status: JobStatus.COMPLETED,
        format: 'wav',
        outputS3Location: {
          bucket: 'test-bucket',
          key: 'conversions/test-job-123.wav',
          size: 5000000
        }
      }
      
      mockJobService.getJob.mockResolvedValue(job)
      mockS3Client.send.mockResolvedValue({
        ContentLength: 5000000,
        LastModified: new Date(),
        ETag: '"def456"'
      })
      
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      vi.mocked(getSignedUrl).mockResolvedValue('https://presigned-url.com/file')
      
      const request = new NextRequest('http://localhost:3000/api/download?jobId=test-job-123&presigned=true')
      
      const response = await GET(request)
      const data = await response.json()
      
      expect(response.status).toBe(200)
      expect(data.filename).toMatch(/^converted-test-job-123-\d{8}T\d{6}\.wav$/)
    })
  })
})