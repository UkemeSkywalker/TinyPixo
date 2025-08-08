import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeAllServices } from '../../../lib/aws-services'
import { getEnvironmentConfig } from '../../../lib/environment'

// Integration tests for upload service with real AWS services
describe('Upload Service Integration Tests', () => {
  const config = getEnvironmentConfig()
  
  beforeAll(async () => {
    console.log(`Running integration tests with environment: ${config.environment}`)
    
    // Initialize AWS services
    try {
      await initializeAllServices()
      console.log('AWS services initialized successfully')
    } catch (error) {
      console.error('Failed to initialize AWS services:', error)
      throw error
    }
  }, 30000) // 30 second timeout for AWS initialization

  beforeEach(() => {
    // Set test environment variables
    process.env.S3_BUCKET_NAME = 'audio-conversion-bucket'
  })

  describe('Form Upload Integration', () => {
    it('should upload a small audio file to S3', async () => {
      // Create test audio file
      const audioContent = Buffer.alloc(1024 * 1024, 'a') // 1MB file
      const formData = new FormData()
      const file = new File([audioContent], 'integration-test.mp3', { type: 'audio/mpeg' })
      formData.append('file', file)

      // Make request to upload endpoint
      const response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.success).toBe(true)
      expect(result.fileId).toBeDefined()
      expect(result.fileName).toBe('integration-test.mp3')
      expect(result.size).toBe(audioContent.length)
      expect(result.s3Location).toBeDefined()
      expect(result.s3Location.bucket).toBe('audio-conversion-bucket')
      expect(result.s3Location.key).toMatch(/^uploads\/.*\.mp3$/)

      console.log(`✅ Small file uploaded successfully: ${result.s3Location.key}`)
    }, 15000)

    it('should upload a large audio file using multipart upload', async () => {
      // Create large test audio file (50MB)
      const audioContent = Buffer.alloc(50 * 1024 * 1024, 'b') // 50MB file
      const formData = new FormData()
      const file = new File([audioContent], 'large-integration-test.wav', { type: 'audio/wav' })
      formData.append('file', file)

      // Make request to upload endpoint
      const response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.success).toBe(true)
      expect(result.fileId).toBeDefined()
      expect(result.fileName).toBe('large-integration-test.wav')
      expect(result.size).toBe(audioContent.length)
      expect(result.s3Location).toBeDefined()
      expect(result.s3Location.bucket).toBe('audio-conversion-bucket')
      expect(result.s3Location.key).toMatch(/^uploads\/.*\.wav$/)

      console.log(`✅ Large file uploaded successfully: ${result.s3Location.key}`)
    }, 60000) // 60 second timeout for large file upload

    it('should reject files that exceed size limit', async () => {
      // Create file larger than 200MB (simulate with metadata)
      const smallContent = Buffer.alloc(1024, 'c')
      const file = new File([smallContent], 'oversized-test.mp3', { type: 'audio/mpeg' })
      
      // Mock the file size to be over limit
      Object.defineProperty(file, 'size', { value: 201 * 1024 * 1024 })
      
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      expect(response.status).toBe(400)
      
      const result = await response.json()
      expect(result.error).toContain('exceeds maximum allowed size')

      console.log(`✅ Oversized file rejected correctly`)
    })

    it('should reject unsupported file formats', async () => {
      const textContent = Buffer.from('This is not an audio file')
      const formData = new FormData()
      const file = new File([textContent], 'not-audio.txt', { type: 'text/plain' })
      formData.append('file', file)

      const response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      expect(response.status).toBe(400)
      
      const result = await response.json()
      expect(result.error).toContain('Unsupported file format')

      console.log(`✅ Unsupported format rejected correctly`)
    })
  })

  describe('Chunked Upload Integration', () => {
    it('should handle complete chunked upload workflow', async () => {
      const fileName = 'chunked-integration-test.aac'
      const fileSize = 25 * 1024 * 1024 // 25MB
      const chunkSize = 10 * 1024 * 1024 // 10MB chunks
      const totalChunks = Math.ceil(fileSize / chunkSize)

      // Step 1: Initiate upload
      let response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'initiate',
          fileName,
          fileSize
        })
      })

      expect(response.status).toBe(200)
      
      let result = await response.json()
      expect(result.success).toBe(true)
      expect(result.fileId).toBeDefined()
      expect(result.uploadId).toBeDefined()
      expect(result.totalChunks).toBe(totalChunks)

      const fileId = result.fileId
      console.log(`✅ Chunked upload initiated: ${fileId}`)

      // Step 2: Upload chunks
      for (let i = 0; i < totalChunks; i++) {
        const chunkStart = i * chunkSize
        const chunkEnd = Math.min(chunkStart + chunkSize, fileSize)
        const actualChunkSize = chunkEnd - chunkStart
        
        // Create chunk data
        const chunkData = Buffer.alloc(actualChunkSize, `chunk${i}`).toString('base64')

        response = await fetch('http://localhost:3000/api/upload-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upload',
            fileId,
            chunkIndex: i,
            totalChunks,
            chunk: chunkData
          })
        })

        expect(response.status).toBe(200)
        
        result = await response.json()
        expect(result.success).toBe(true)
        expect(result.chunkIndex).toBe(i)
        expect(result.progress).toBeGreaterThan(0)

        console.log(`✅ Chunk ${i + 1}/${totalChunks} uploaded (${result.progress}%)`)
      }

      // Step 3: Complete upload
      response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          fileId
        })
      })

      expect(response.status).toBe(200)
      
      result = await response.json()
      expect(result.success).toBe(true)
      expect(result.fileId).toBe(fileId)
      expect(result.fileName).toBe(fileName)
      expect(result.size).toBe(fileSize)
      expect(result.s3Location).toBeDefined()
      expect(result.s3Location.key).toMatch(/^uploads\/.*\.aac$/)

      console.log(`✅ Chunked upload completed: ${result.s3Location.key}`)
    }, 90000) // 90 second timeout for chunked upload

    it('should handle upload status requests', async () => {
      const fileName = 'status-test.ogg'
      const fileSize = 15 * 1024 * 1024 // 15MB

      // Initiate upload
      let response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'initiate',
          fileName,
          fileSize
        })
      })

      const initResult = await response.json()
      const fileId = initResult.fileId

      // Upload one chunk
      const chunkData = Buffer.alloc(10 * 1024 * 1024, 'data').toString('base64')
      
      await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upload',
          fileId,
          chunkIndex: 0,
          totalChunks: 2,
          chunk: chunkData
        })
      })

      // Check status
      response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          fileId
        })
      })

      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.success).toBe(true)
      expect(result.fileId).toBe(fileId)
      expect(result.progress).toBeGreaterThan(0)
      expect(result.progress).toBeLessThan(100)
      expect(result.completedChunks).toBe(1)
      expect(result.totalChunks).toBe(2)

      console.log(`✅ Upload status retrieved: ${result.progress}% complete`)

      // Abort the upload to clean up
      await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'abort',
          fileId
        })
      })
    }, 30000)

    it('should handle upload abort', async () => {
      const fileName = 'abort-test.flac'
      const fileSize = 20 * 1024 * 1024 // 20MB

      // Initiate upload
      let response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'initiate',
          fileName,
          fileSize
        })
      })

      const initResult = await response.json()
      const fileId = initResult.fileId

      // Upload one chunk
      const chunkData = Buffer.alloc(10 * 1024 * 1024, 'data').toString('base64')
      
      await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upload',
          fileId,
          chunkIndex: 0,
          totalChunks: 2,
          chunk: chunkData
        })
      })

      // Abort upload
      response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'abort',
          fileId
        })
      })

      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.success).toBe(true)
      expect(result.message).toBe('Upload aborted successfully')

      console.log(`✅ Upload aborted successfully`)

      // Verify status returns not found
      response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          fileId
        })
      })

      expect(response.status).toBe(404)
    }, 30000)
  })

  describe('Error Handling Integration', () => {
    it('should handle S3 service errors gracefully', async () => {
      // Use invalid bucket name to trigger S3 error
      const originalBucket = process.env.S3_BUCKET_NAME
      process.env.S3_BUCKET_NAME = 'non-existent-bucket-12345'

      const audioContent = Buffer.alloc(1024, 'a')
      const formData = new FormData()
      const file = new File([audioContent], 'error-test.mp3', { type: 'audio/mpeg' })
      formData.append('file', file)

      const response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      expect(response.status).toBe(500)
      
      const result = await response.json()
      expect(result.error).toBe('Form upload failed')
      expect(result.details).toBeDefined()

      console.log(`✅ S3 error handled gracefully: ${result.details}`)

      // Restore original bucket name
      process.env.S3_BUCKET_NAME = originalBucket
    })

    it('should handle Redis connection failures with fallback', async () => {
      // This test verifies that the system continues to work even if Redis is unavailable
      // The upload service should fall back to in-memory storage
      
      const fileName = 'redis-fallback-test.m4a'
      const fileSize = 15 * 1024 * 1024

      // Temporarily break Redis connection by using invalid endpoint
      const originalRedisHost = process.env.REDIS_HOST
      process.env.REDIS_HOST = 'invalid-redis-host'

      try {
        // Initiate upload (should work with in-memory fallback)
        const response = await fetch('http://localhost:3000/api/upload-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'initiate',
            fileName,
            fileSize
          })
        })

        expect(response.status).toBe(200)
        
        const result = await response.json()
        expect(result.success).toBe(true)
        expect(result.fileId).toBeDefined()

        console.log(`✅ Redis fallback working: ${result.fileId}`)

        // Clean up by aborting the upload
        await fetch('http://localhost:3000/api/upload-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'abort',
            fileId: result.fileId
          })
        })
      } finally {
        // Restore Redis configuration
        if (originalRedisHost) {
          process.env.REDIS_HOST = originalRedisHost
        } else {
          delete process.env.REDIS_HOST
        }
      }
    }, 30000)
  })

  describe('CORS and Browser Compatibility', () => {
    it('should handle browser-like requests with proper headers', async () => {
      const audioContent = Buffer.alloc(1024, 'a')
      const formData = new FormData()
      const file = new File([audioContent], 'cors-test.mp3', { type: 'audio/mpeg' })
      formData.append('file', file)

      // Simulate browser request with CORS headers
      const response = await fetch('http://localhost:3000/api/upload-audio', {
        method: 'POST',
        headers: {
          'Origin': 'http://localhost:3000',
          'Referer': 'http://localhost:3000/audio-converter'
        },
        body: formData
      })

      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.success).toBe(true)

      console.log(`✅ CORS-like request handled successfully`)
    })
  })
})

// Helper function to run integration tests conditionally
export function runIntegrationTests() {
  const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true'
  
  if (!shouldRun) {
    console.log('Skipping integration tests. Set RUN_INTEGRATION_TESTS=true to run them.')
    return
  }

  console.log('Running integration tests...')
}