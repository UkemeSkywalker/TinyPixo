import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest'
import { JobService, Job, JobStatus, JobInput } from '../../lib/job-service'
import { getCurrentTestEnvironment } from '../test-config'

// Mock AWS SDK
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
  PutItemCommand: vi.fn(),
  GetItemCommand: vi.fn(),
  UpdateItemCommand: vi.fn(),
  ScanCommand: vi.fn(),
  DeleteItemCommand: vi.fn()
}))

vi.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: vi.fn(),
  unmarshall: vi.fn()
}))

vi.mock('../../lib/aws-services', () => ({
  dynamodbClient: {
    send: vi.fn()
  }
}))

describe('JobService Unit Tests', () => {
  let jobService: JobService
  let mockDynamoClient: any
  const testEnv = getCurrentTestEnvironment()

  beforeAll(() => {
    // Mock console methods to reduce noise
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    // Setup mock DynamoDB client
    mockDynamoClient = {
      send: vi.fn()
    }

    // Mock the DynamoDB operations
    const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb')

    // Create mock functions directly
    const mockMarshall = vi.fn().mockReturnValue({})
    const mockUnmarshall = vi.fn().mockReturnValue({})
    
    // Replace the imported functions with mocks
    vi.doMock('@aws-sdk/util-dynamodb', () => ({
      marshall: mockMarshall,
      unmarshall: mockUnmarshall
    }))

    jobService = new JobService(mockDynamoClient)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('createJob', () => {
    it('should create a new job with valid input', async () => {
      const jobInput: JobInput = {
        inputS3Location: {
          bucket: 'test-bucket',
          key: 'uploads/test.mp3',
          size: 1024000
        },
        format: 'wav',
        quality: '192k'
      }

      mockDynamoClient.send.mockResolvedValue({})

      const job = await jobService.createJob(jobInput)

      expect(job).toMatchObject({
        jobId: expect.any(String),
        status: JobStatus.CREATED,
        inputS3Location: jobInput.inputS3Location,
        format: jobInput.format,
        quality: jobInput.quality,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        ttl: expect.any(Number)
      })

      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          constructor: { name: 'PutItemCommand' }
        })
      )
    })

    it('should generate unique job IDs', async () => {
      const jobInput: JobInput = {
        inputS3Location: {
          bucket: 'test-bucket',
          key: 'uploads/test.mp3',
          size: 1024000
        },
        format: 'wav',
        quality: '192k'
      }

      mockDynamoClient.send.mockResolvedValue({})

      const job1 = await jobService.createJob(jobInput)
      const job2 = await jobService.createJob(jobInput)

      expect(job1.jobId).not.toBe(job2.jobId)
    })

    it('should set TTL for automatic cleanup', async () => {
      const jobInput: JobInput = {
        inputS3Location: {
          bucket: 'test-bucket',
          key: 'uploads/test.mp3',
          size: 1024000
        },
        format: 'wav',
        quality: '192k'
      }

      mockDynamoClient.send.mockResolvedValue({})

      const job = await jobService.createJob(jobInput)
      const currentTime = Math.floor(Date.now() / 1000)
      const expectedTTL = currentTime + (24 * 60 * 60) // 24 hours

      expect(job.ttl).toBeGreaterThan(currentTime)
      expect(job.ttl).toBeLessThanOrEqual(expectedTTL + 10) // Allow 10 second tolerance
    })

    it('should handle DynamoDB errors', async () => {
      const jobInput: JobInput = {
        inputS3Location: {
          bucket: 'test-bucket',
          key: 'uploads/test.mp3',
          size: 1024000
        },
        format: 'wav',
        quality: '192k'
      }

      const dynamoError = new Error('DynamoDB error')
      mockDynamoClient.send.mockRejectedValue(dynamoError)

      await expect(jobService.createJob(jobInput)).rejects.toThrow('DynamoDB error')
    })
  })

  describe('getJob', () => {
    it('should retrieve existing job', async () => {
      const mockJobData = {
        jobId: 'test-job-123',
        status: JobStatus.PROCESSING,
        inputS3Location: {
          bucket: 'test-bucket',
          key: 'uploads/test.mp3',
          size: 1024000
        },
        format: 'wav',
        quality: '192k',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 86400
      }

      mockDynamoClient.send.mockResolvedValue({
        Item: mockJobData
      })

      const job = await jobService.getJob('test-job-123')

      expect(job).toMatchObject({
        jobId: 'test-job-123',
        status: JobStatus.PROCESSING,
        inputS3Location: mockJobData.inputS3Location,
        format: 'wav',
        quality: '192k'
      })

      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          constructor: { name: 'GetItemCommand' }
        })
      )
    })

    it('should return null for non-existent job', async () => {
      mockDynamoClient.send.mockResolvedValue({})

      const job = await jobService.getJob('non-existent-job')

      expect(job).toBeNull()
    })

    it('should handle DynamoDB errors gracefully', async () => {
      const dynamoError = new Error('DynamoDB connection failed')
      mockDynamoClient.send.mockRejectedValue(dynamoError)

      await expect(jobService.getJob('test-job')).rejects.toThrow('DynamoDB connection failed')
    })
  })

  describe('updateJobStatus', () => {
    it('should update job status successfully', async () => {
      mockDynamoClient.send.mockResolvedValue({})

      await jobService.updateJobStatus('test-job-123', JobStatus.COMPLETED)

      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          constructor: { name: 'UpdateItemCommand' }
        })
      )
    })

    it('should update job with output location when completed', async () => {
      const outputLocation = {
        bucket: 'test-bucket',
        key: 'conversions/test-job-123.wav',
        size: 2048000
      }

      mockDynamoClient.send.mockResolvedValue({})

      await jobService.updateJobStatus('test-job-123', JobStatus.COMPLETED, outputLocation)

      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          constructor: { name: 'UpdateItemCommand' }
        })
      )
    })

    it('should update job with error message when failed', async () => {
      mockDynamoClient.send.mockResolvedValue({})

      await jobService.updateJobStatus('test-job-123', JobStatus.FAILED, undefined, 'FFmpeg process failed')

      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          constructor: { name: 'UpdateItemCommand' }
        })
      )
    })

    it('should handle update errors', async () => {
      const updateError = new Error('Update failed')
      mockDynamoClient.send.mockRejectedValue(updateError)

      await expect(
        jobService.updateJobStatus('test-job-123', JobStatus.COMPLETED)
      ).rejects.toThrow('Update failed')
    })
  })

  describe('cleanupExpiredJobs', () => {
    it('should scan and delete expired jobs', async () => {
      const expiredJobs = [
        { jobId: 'expired-job-1', ttl: Math.floor(Date.now() / 1000) - 3600 },
        { jobId: 'expired-job-2', ttl: Math.floor(Date.now() / 1000) - 7200 }
      ]

      // Mock scan response
      mockDynamoClient.send
        .mockResolvedValueOnce({
          Items: expiredJobs
        })
        .mockResolvedValue({}) // Delete operations

      const cleanedCount = await jobService.cleanupExpiredJobs()

      expect(cleanedCount).toBe(2)
      expect(mockDynamoClient.send).toHaveBeenCalledTimes(3) // 1 scan + 2 deletes
    })

    it('should handle cleanup errors gracefully', async () => {
      const scanError = new Error('Scan failed')
      mockDynamoClient.send.mockRejectedValue(scanError)

      const cleanedCount = await jobService.cleanupExpiredJobs()

      expect(cleanedCount).toBe(0)
    })

    it('should handle partial cleanup failures', async () => {
      const expiredJobs = [
        { jobId: 'expired-job-1', ttl: Math.floor(Date.now() / 1000) - 3600 },
        { jobId: 'expired-job-2', ttl: Math.floor(Date.now() / 1000) - 7200 }
      ]

      mockDynamoClient.send
        .mockResolvedValueOnce({ Items: expiredJobs }) // Scan succeeds
        .mockResolvedValueOnce({}) // First delete succeeds
        .mockRejectedValueOnce(new Error('Delete failed')) // Second delete fails

      const cleanedCount = await jobService.cleanupExpiredJobs()

      expect(cleanedCount).toBe(1) // Only one job cleaned up
    })
  })

  describe('job validation', () => {
    it('should validate job input format', async () => {
      const invalidJobInput = {
        inputS3Location: {
          bucket: '',
          key: '',
          size: -1
        },
        format: 'invalid-format',
        quality: 'invalid-quality'
      } as any

      mockDynamoClient.send.mockResolvedValue({})

      await expect(jobService.createJob(invalidJobInput)).rejects.toThrow()
    })

    it('should validate supported audio formats', async () => {
      const supportedFormats = ['mp3', 'wav', 'aac', 'ogg']
      
      for (const format of supportedFormats) {
        const jobInput: JobInput = {
          inputS3Location: {
            bucket: 'test-bucket',
            key: 'uploads/test.mp3',
            size: 1024000
          },
          format,
          quality: '192k'
        }

        mockDynamoClient.send.mockResolvedValue({})

        const job = await jobService.createJob(jobInput)
        expect(job.format).toBe(format)
      }
    })

    it('should validate quality settings', async () => {
      const validQualities = ['128k', '192k', '256k', '320k']
      
      for (const quality of validQualities) {
        const jobInput: JobInput = {
          inputS3Location: {
            bucket: 'test-bucket',
            key: 'uploads/test.mp3',
            size: 1024000
          },
          format: 'wav',
          quality
        }

        mockDynamoClient.send.mockResolvedValue({})

        const job = await jobService.createJob(jobInput)
        expect(job.quality).toBe(quality)
      }
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent job creation', async () => {
      const jobInput: JobInput = {
        inputS3Location: {
          bucket: 'test-bucket',
          key: 'uploads/test.mp3',
          size: 1024000
        },
        format: 'wav',
        quality: '192k'
      }

      mockDynamoClient.send.mockResolvedValue({})

      const concurrentJobs = Array.from({ length: 10 }, () => 
        jobService.createJob(jobInput)
      )

      const jobs = await Promise.all(concurrentJobs)

      // All jobs should be created successfully
      expect(jobs).toHaveLength(10)
      
      // All job IDs should be unique
      const jobIds = jobs.map(job => job.jobId)
      const uniqueJobIds = new Set(jobIds)
      expect(uniqueJobIds.size).toBe(10)
    })

    it('should handle concurrent status updates', async () => {
      const jobId = 'concurrent-test-job'
      mockDynamoClient.send.mockResolvedValue({})

      const statusUpdates = [
        JobStatus.PROCESSING,
        JobStatus.PROCESSING,
        JobStatus.COMPLETED
      ]

      const updatePromises = statusUpdates.map(status =>
        jobService.updateJobStatus(jobId, status)
      )

      await Promise.all(updatePromises)

      expect(mockDynamoClient.send).toHaveBeenCalledTimes(3)
    })
  })

  describe('error recovery', () => {
    it('should implement retry logic for transient failures', async () => {
      const jobInput: JobInput = {
        inputS3Location: {
          bucket: 'test-bucket',
          key: 'uploads/test.mp3',
          size: 1024000
        },
        format: 'wav',
        quality: '192k'
      }

      // Mock transient failure then success
      mockDynamoClient.send
        .mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'))
        .mockResolvedValueOnce({})

      const job = await jobService.createJob(jobInput)

      expect(job).toBeDefined()
      expect(mockDynamoClient.send).toHaveBeenCalledTimes(2)
    })

    it('should fail after max retries', async () => {
      const jobInput: JobInput = {
        inputS3Location: {
          bucket: 'test-bucket',
          key: 'uploads/test.mp3',
          size: 1024000
        },
        format: 'wav',
        quality: '192k'
      }

      // Mock persistent failure
      mockDynamoClient.send.mockRejectedValue(new Error('Persistent error'))

      await expect(jobService.createJob(jobInput)).rejects.toThrow('Persistent error')
    })
  })

  describe('performance', () => {
    it('should handle large number of jobs efficiently', async () => {
      const startTime = Date.now()
      const jobCount = 100

      mockDynamoClient.send.mockResolvedValue({})

      const jobPromises = Array.from({ length: jobCount }, (_, i) => {
        const jobInput: JobInput = {
          inputS3Location: {
            bucket: 'test-bucket',
            key: `uploads/test-${i}.mp3`,
            size: 1024000
          },
          format: 'wav',
          quality: '192k'
        }
        return jobService.createJob(jobInput)
      })

      const jobs = await Promise.all(jobPromises)
      const duration = Date.now() - startTime

      expect(jobs).toHaveLength(jobCount)
      expect(duration).toBeLessThan(5000) // Should complete within 5 seconds
    })

    it('should not leak memory with many operations', async () => {
      const initialMemory = process.memoryUsage().heapUsed

      mockDynamoClient.send.mockResolvedValue({})

      // Perform many operations
      for (let i = 0; i < 1000; i++) {
        const jobInput: JobInput = {
          inputS3Location: {
            bucket: 'test-bucket',
            key: `uploads/test-${i}.mp3`,
            size: 1024000
          },
          format: 'wav',
          quality: '192k'
        }
        await jobService.createJob(jobInput)
      }

      const finalMemory = process.memoryUsage().heapUsed
      const memoryIncrease = finalMemory - initialMemory

      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024)
    })
  })
})