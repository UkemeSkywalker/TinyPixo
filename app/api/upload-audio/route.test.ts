import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { s3Client, getRedisClient } from '../../../lib/aws-services'
import { 
  CreateMultipartUploadCommand, 
  UploadPartCommand, 
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3'

// Mock AWS services
vi.mock('../../../lib/aws-services', () => ({
  s3Client: {
    send: vi.fn()
  },
  getRedisClient: vi.fn()
}))

// Mock crypto
vi.mock('crypto', () => ({
  randomUUID: () => 'test-uuid-123'
}))

const mockS3Client = vi.mocked(s3Client)
const mockGetRedisClient = vi.mocked(getRedisClient)

// Mock Redis client
const mockRedisClient = {
  setEx: vi.fn(),
  get: vi.fn(),
  del: vi.fn()
}

describe('/api/upload-audio', () => {
  beforeAll(() => {
    // Set environment variables
    process.env.S3_BUCKET_NAME = 'test-bucket'
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedisClient.mockResolvedValue(mockRedisClient as any)
    
    // Mock Date.now for consistent fileId generation
    vi.spyOn(Date, 'now').mockReturnValue(1640995200000) // 2022-01-01
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(() => {
    delete process.env.S3_BUCKET_NAME
  })

  describe('Form Upload', () => {
    it('should successfully upload a small audio file using simple upload', async () => {
      // Mock S3 response
      mockS3Client.send.mockResolvedValueOnce({})

      // Create test file
      const fileContent = Buffer.from('fake audio content')
      const file = new File([fileContent], 'test.mp3', { type: 'audio/mpeg' })
      
      const formData = new FormData()
      formData.append('file', file)

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(result.fileId).toBe('1640995200000-test-uuid-123')
      expect(result.fileName).toBe('test.mp3')
      expect(result.size).toBe(fileContent.length)
      expect(result.s3Location).toEqual({
        bucket: 'test-bucket',
        key: 'uploads/1640995200000-test-uuid-123.mp3',
        size: fileContent.length
      })

      // Verify S3 call
      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(PutObjectCommand)
      )
    })

    it('should successfully upload a large audio file using multipart upload', async () => {
      // Mock S3 responses
      mockS3Client.send
        .mockResolvedValueOnce({ UploadId: 'test-upload-id' }) // CreateMultipartUpload
        .mockResolvedValueOnce({ ETag: '"etag1"' }) // UploadPart 1
        .mockResolvedValueOnce({ ETag: '"etag2"' }) // UploadPart 2
        .mockResolvedValueOnce({}) // CompleteMultipartUpload

      // Mock Redis operations
      mockRedisClient.setEx.mockResolvedValue('OK' as any)
      mockRedisClient.del.mockResolvedValue(1)

      // Create large test file (15MB)
      const fileSize = 15 * 1024 * 1024
      const fileContent = Buffer.alloc(fileSize, 'a')
      const file = new File([fileContent], 'large-test.wav', { type: 'audio/wav' })
      
      const formData = new FormData()
      formData.append('file', file)

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(result.fileId).toBe('1640995200000-test-uuid-123')
      expect(result.fileName).toBe('large-test.wav')
      expect(result.size).toBe(fileSize)

      // Verify S3 calls
      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(CreateMultipartUploadCommand)
      )
      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(UploadPartCommand)
      )
      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(CompleteMultipartUploadCommand)
      )

      // Verify Redis calls for progress tracking
      expect(mockRedisClient.setEx).toHaveBeenCalled()
      expect(mockRedisClient.del).toHaveBeenCalled()
    })

    it('should reject files that are too large', async () => {
      // Create a large buffer that actually exceeds the limit
      const largeBuffer = Buffer.alloc(201 * 1024 * 1024) // Actually allocate 201MB
      const file = new File([largeBuffer], 'huge-file.mp3', { type: 'audio/mpeg' })
      
      const formData = new FormData()
      formData.append('file', file)

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toContain('exceeds maximum allowed size')
      expect(mockS3Client.send).not.toHaveBeenCalled()
    })

    it('should reject unsupported file formats', async () => {
      const fileContent = Buffer.from('fake content')
      const file = new File([fileContent], 'test.txt', { type: 'text/plain' })
      
      const formData = new FormData()
      formData.append('file', file)

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toContain('Unsupported file format')
      expect(mockS3Client.send).not.toHaveBeenCalled()
    })

    it('should reject empty files', async () => {
      const file = new File([], 'empty.mp3', { type: 'audio/mpeg' })
      
      const formData = new FormData()
      formData.append('file', file)

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toBe('File is empty')
      expect(mockS3Client.send).not.toHaveBeenCalled()
    })

    it('should handle S3 upload failures with retry', async () => {
      // Mock S3 to fail twice then succeed
      mockS3Client.send
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({})

      const fileContent = Buffer.from('fake audio content')
      const file = new File([fileContent], 'test.mp3', { type: 'audio/mpeg' })
      
      const formData = new FormData()
      formData.append('file', file)

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      
      // Should have retried 3 times total
      expect(mockS3Client.send).toHaveBeenCalledTimes(3)
    })

    it('should abort multipart upload on failure', async () => {
      // Mock S3 responses - create succeeds, upload part fails after all retries
      mockS3Client.send.mockImplementation((command) => {
        if (command.constructor.name === 'CreateMultipartUploadCommand') {
          return Promise.resolve({ UploadId: 'test-upload-id' })
        } else if (command.constructor.name === 'UploadPartCommand') {
          return Promise.reject(new Error('Upload failed'))
        } else if (command.constructor.name === 'AbortMultipartUploadCommand') {
          return Promise.resolve({})
        }
        return Promise.reject(new Error('Unexpected command'))
      })

      // Mock Redis operations
      mockRedisClient.setEx.mockResolvedValue('OK' as any)
      mockRedisClient.del.mockResolvedValue(1)

      // Create large test file (triggers multipart upload)
      const fileSize = 15 * 1024 * 1024
      const fileContent = Buffer.alloc(fileSize, 'a')
      const file = new File([fileContent], 'test.wav', { type: 'audio/wav' })
      
      const formData = new FormData()
      formData.append('file', file)

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(500)
      expect(result.error).toBe('Form upload failed')

      // Verify abort was called (should be the last call)
      const calls = mockS3Client.send.mock.calls
      const lastCall = calls[calls.length - 1]
      expect(lastCall[0]).toBeInstanceOf(AbortMultipartUploadCommand)
    }, 15000) // 15 second timeout for retry delays
  })

  describe('Chunked Upload', () => {
    it('should initiate chunked upload successfully', async () => {
      // Mock S3 response
      mockS3Client.send.mockResolvedValueOnce({ UploadId: 'test-upload-id' })
      mockRedisClient.setEx.mockResolvedValue('OK' as any)

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'initiate',
          fileName: 'test.mp3',
          fileSize: 50 * 1024 * 1024 // 50MB
        })
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(result.fileId).toBe('1640995200000-test-uuid-123')
      expect(result.uploadId).toBe('test-upload-id')
      expect(result.chunkSize).toBe(10 * 1024 * 1024) // 10MB
      expect(result.totalChunks).toBe(5)

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(CreateMultipartUploadCommand)
      )
    })

    it('should upload chunk successfully', async () => {
      // Mock existing upload progress
      const mockProgress = {
        uploadId: 'test-upload-id',
        fileId: '1640995200000-test-uuid-123',
        fileName: 'test.mp3',
        totalSize: 20 * 1024 * 1024,
        uploadedSize: 0,
        totalChunks: 2,
        completedChunks: 0,
        parts: [],
        s3Key: 'uploads/1640995200000-test-uuid-123.mp3',
        bucketName: 'test-bucket'
      }

      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(mockProgress))
      mockS3Client.send.mockResolvedValueOnce({ ETag: '"etag1"' })
      mockRedisClient.setEx.mockResolvedValue('OK' as any)

      const chunkData = Buffer.alloc(5 * 1024 * 1024, 'a').toString('base64') // 5MB chunk

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'upload',
          fileId: '1640995200000-test-uuid-123',
          chunkIndex: 0,
          totalChunks: 2,
          chunk: chunkData
        })
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(result.chunkIndex).toBe(0)
      expect(result.progress).toBeGreaterThan(0)

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(UploadPartCommand)
      )
    })

    it('should complete chunked upload successfully', async () => {
      // Mock completed upload progress
      const mockProgress = {
        uploadId: 'test-upload-id',
        fileId: '1640995200000-test-uuid-123',
        fileName: 'test.mp3',
        totalSize: 20 * 1024 * 1024,
        uploadedSize: 20 * 1024 * 1024,
        totalChunks: 2,
        completedChunks: 2,
        parts: [
          { ETag: '"etag1"', PartNumber: 1 },
          { ETag: '"etag2"', PartNumber: 2 }
        ],
        s3Key: 'uploads/1640995200000-test-uuid-123.mp3',
        bucketName: 'test-bucket'
      }

      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(mockProgress))
      mockS3Client.send.mockResolvedValueOnce({}) // CompleteMultipartUpload
      mockRedisClient.del.mockResolvedValue(1)

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          fileId: '1640995200000-test-uuid-123'
        })
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(result.fileId).toBe('1640995200000-test-uuid-123')
      expect(result.s3Location).toEqual({
        bucket: 'test-bucket',
        key: 'uploads/1640995200000-test-uuid-123.mp3',
        size: 20 * 1024 * 1024
      })

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(CompleteMultipartUploadCommand)
      )
    })

    it('should abort chunked upload successfully', async () => {
      // Mock upload progress
      const mockProgress = {
        uploadId: 'test-upload-id',
        fileId: '1640995200000-test-uuid-123',
        fileName: 'test.mp3',
        totalSize: 20 * 1024 * 1024,
        uploadedSize: 10 * 1024 * 1024,
        totalChunks: 2,
        completedChunks: 1,
        parts: [{ ETag: '"etag1"', PartNumber: 1 }],
        s3Key: 'uploads/1640995200000-test-uuid-123.mp3',
        bucketName: 'test-bucket'
      }

      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(mockProgress))
      mockS3Client.send.mockResolvedValueOnce({}) // AbortMultipartUpload
      mockRedisClient.del.mockResolvedValue(1)

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'abort',
          fileId: '1640995200000-test-uuid-123'
        })
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(result.message).toBe('Upload aborted successfully')

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(AbortMultipartUploadCommand)
      )
    })

    it('should get upload status successfully', async () => {
      // Mock upload progress
      const mockProgress = {
        uploadId: 'test-upload-id',
        fileId: '1640995200000-test-uuid-123',
        fileName: 'test.mp3',
        totalSize: 20 * 1024 * 1024,
        uploadedSize: 10 * 1024 * 1024,
        totalChunks: 2,
        completedChunks: 1,
        parts: [{ ETag: '"etag1"', PartNumber: 1 }],
        s3Key: 'uploads/1640995200000-test-uuid-123.mp3',
        bucketName: 'test-bucket'
      }

      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(mockProgress))

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          fileId: '1640995200000-test-uuid-123'
        })
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(result.fileId).toBe('1640995200000-test-uuid-123')
      expect(result.progress).toBe(50) // 50% uploaded
      expect(result.completedChunks).toBe(1)
      expect(result.totalChunks).toBe(2)
    })

    it('should handle Redis failure with in-memory fallback', async () => {
      // Mock Redis failure
      mockGetRedisClient.mockRejectedValue(new Error('Redis connection failed'))

      // Mock S3 response
      mockS3Client.send.mockResolvedValueOnce({ UploadId: 'test-upload-id' })

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'initiate',
          fileName: 'test.mp3',
          fileSize: 50 * 1024 * 1024
        })
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(result.fileId).toBe('1640995200000-test-uuid-123')
    })
  })

  describe('Error Handling', () => {
    it('should handle unsupported content type', async () => {
      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'invalid body'
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toBe('Unsupported content type')
    })

    it('should handle missing file in form data', async () => {
      const formData = new FormData()
      // No file added

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toBe('No file provided')
    })

    it('should handle invalid chunked upload action', async () => {
      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'invalid-action'
        })
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toBe('Invalid action')
    })

    it('should handle upload session not found', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null)

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'upload',
          fileId: 'non-existent-id',
          chunkIndex: 0,
          totalChunks: 2,
          chunk: 'data'
        })
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(404)
      expect(result.error).toBe('Upload session not found')
    })

    it('should handle incomplete upload on complete', async () => {
      // Mock incomplete upload progress
      const mockProgress = {
        uploadId: 'test-upload-id',
        fileId: '1640995200000-test-uuid-123',
        fileName: 'test.mp3',
        totalSize: 20 * 1024 * 1024,
        uploadedSize: 10 * 1024 * 1024,
        totalChunks: 2,
        completedChunks: 1, // Only 1 of 2 chunks completed
        parts: [{ ETag: '"etag1"', PartNumber: 1 }],
        s3Key: 'uploads/1640995200000-test-uuid-123.mp3',
        bucketName: 'test-bucket'
      }

      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(mockProgress))

      const request = new NextRequest('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          fileId: '1640995200000-test-uuid-123'
        })
      })

      const response = await POST(request)
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toBe('Upload incomplete')
      expect(result.details).toBe('1/2 chunks uploaded')
    })
  })

  describe('File Validation', () => {
    const supportedFormats = ['mp3', 'wav', 'aac', 'ogg', 'm4a', 'flac']
    
    supportedFormats.forEach(format => {
      it(`should accept ${format} files`, async () => {
        mockS3Client.send.mockResolvedValueOnce({})

        const fileContent = Buffer.from('fake audio content')
        const mimeType = format === 'mp3' ? 'audio/mpeg' : 
                        format === 'm4a' ? 'audio/mp4' : 
                        `audio/${format}`
        const file = new File([fileContent], `test.${format}`, { type: mimeType })
        
        const formData = new FormData()
        formData.append('file', file)

        const request = new NextRequest('http://localhost:3000/api/upload-audio', {
          method: 'POST',
          body: formData
        })

        const response = await POST(request)
        const result = await response.json()

        expect(response.status).toBe(200)
        expect(result.success).toBe(true)
      })
    })

    const unsupportedFormats = ['txt', 'exe', 'pdf', 'jpg', 'mp4']
    
    unsupportedFormats.forEach(format => {
      it(`should reject ${format} files`, async () => {
        const fileContent = Buffer.from('fake content')
        const file = new File([fileContent], `test.${format}`, { type: 'application/octet-stream' })
        
        const formData = new FormData()
        formData.append('file', file)

        const request = new NextRequest('http://localhost:3000/api/upload-audio', {
          method: 'POST',
          body: formData
        })

        const response = await POST(request)
        const result = await response.json()

        expect(response.status).toBe(400)
        expect(result.error).toContain('Unsupported file format')
        expect(mockS3Client.send).not.toHaveBeenCalled()
      })
    })
  })
})