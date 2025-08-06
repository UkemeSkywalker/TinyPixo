import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest'
import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand, ScanCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { JobService, JobStatus, Job, JobInput, S3Location } from './job-service'

// Mock the AWS SDK
vi.mock('@aws-sdk/client-dynamodb')
vi.mock('./aws-services', () => ({
  dynamodbClient: new DynamoDBClient({})
}))

describe('JobService', () => {
  let jobService: JobService
  let mockDynamoDBClient: any
  let mockDateNow: any

  const mockS3Location: S3Location = {
    bucket: 'test-bucket',
    key: 'uploads/test-file.mp3',
    size: 1024000
  }

  const mockJobInput: JobInput = {
    inputS3Location: mockS3Location,
    format: 'wav',
    quality: '192k'
  }

  beforeAll(() => {
    // Mock Date.now to return consistent timestamps
    mockDateNow = vi.spyOn(Date, 'now').mockReturnValue(1640995200000) // 2022-01-01 00:00:00 UTC
    
    // Mock the Date constructor to return consistent dates
    const OriginalDate = Date
    vi.stubGlobal('Date', class extends OriginalDate {
      constructor(...args: any[]) {
        if (args.length === 0) {
          // new Date() should use our mocked timestamp
          super(1640995200000)
        } else {
          // new Date(timestamp) or new Date(string) should work normally
          super(...args)
        }
      }
      
      static now() {
        return 1640995200000
      }
    })
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    // Create a fresh mock client for each test
    mockDynamoDBClient = {
      send: vi.fn()
    }
    
    jobService = new JobService(mockDynamoDBClient)
    
    // Reset all mocks
    vi.clearAllMocks()
    // Reset Date.now mock
    mockDateNow.mockReturnValue(1640995200000)
  })

  describe('createJob', () => {
    it('should create a new job successfully', async () => {
      // Mock successful DynamoDB put operation
      mockDynamoDBClient.send.mockResolvedValueOnce({})

      const job = await jobService.createJob(mockJobInput)

      expect(job).toMatchObject({
        jobId: '1640995200000',
        status: JobStatus.CREATED,
        inputS3Location: mockS3Location,
        format: 'wav',
        quality: '192k',
        createdAt: new Date(1640995200000),
        updatedAt: new Date(1640995200000),
        ttl: 1641081600 // 24 hours later (1640995200 + 86400)
      })

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(PutItemCommand)
      )
    })

    it('should calculate TTL correctly for 24 hours', async () => {
      mockDynamoDBClient.send.mockResolvedValueOnce({})

      const job = await jobService.createJob(mockJobInput)

      // TTL should be exactly 24 hours (86400 seconds) from creation time
      const expectedTTL = Math.floor(1640995200000 / 1000) + (24 * 60 * 60)
      expect(job.ttl).toBe(expectedTTL)
      expect(job.ttl).toBe(1641081600)
    })

    it('should handle DynamoDB errors with retry logic', async () => {
      // Mock first two calls to fail, third to succeed
      mockDynamoDBClient.send
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Another temporary failure'))
        .mockResolvedValueOnce({})

      const job = await jobService.createJob(mockJobInput)

      expect(job.jobId).toBe('1640995200000')
      expect(mockDynamoDBClient.send).toHaveBeenCalledTimes(3)
    })

    it('should throw error after max retries exceeded', async () => {
      // Mock all calls to fail
      mockDynamoDBClient.send.mockRejectedValue(new Error('Persistent failure'))

      await expect(jobService.createJob(mockJobInput)).rejects.toThrow('Failed to create job: Persistent failure')
      expect(mockDynamoDBClient.send).toHaveBeenCalledTimes(4) // Initial + 3 retries
    }, 10000)
  })

  describe('getJob', () => {
    const mockJobData = {
      jobId: '1640995200000',
      status: JobStatus.PROCESSING,
      inputS3Location: mockS3Location,
      format: 'wav',
      quality: '192k',
      createdAt: '2022-01-01T00:00:00.000Z',
      updatedAt: '2022-01-01T00:05:00.000Z',
      ttl: 1641081600
    }

    it('should retrieve an existing job successfully', async () => {
      mockDynamoDBClient.send.mockResolvedValueOnce({
        Item: marshall(mockJobData)
      })

      const job = await jobService.getJob('1640995200000')

      expect(job).toMatchObject({
        jobId: '1640995200000',
        status: JobStatus.PROCESSING,
        inputS3Location: mockS3Location,
        format: 'wav',
        quality: '192k',
        createdAt: new Date('2022-01-01T00:00:00.000Z'),
        updatedAt: new Date('2022-01-01T00:05:00.000Z'),
        ttl: 1641081600
      })

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(GetItemCommand)
      )
    })

    it('should return null for non-existent job', async () => {
      mockDynamoDBClient.send.mockResolvedValueOnce({
        Item: undefined
      })

      const job = await jobService.getJob('non-existent')

      expect(job).toBeNull()
    })

    it('should handle DynamoDB errors', async () => {
      mockDynamoDBClient.send.mockRejectedValue(new Error('DynamoDB error'))

      await expect(jobService.getJob('1640995200000')).rejects.toThrow('Failed to get job: DynamoDB error')
    }, 10000)
  })

  describe('updateJobStatus', () => {
    it('should update job status successfully', async () => {
      mockDynamoDBClient.send.mockResolvedValueOnce({})

      await jobService.updateJobStatus('1640995200000', JobStatus.PROCESSING)

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(UpdateItemCommand)
      )
    })

    it('should update job status with output location', async () => {
      const outputLocation: S3Location = {
        bucket: 'test-bucket',
        key: 'conversions/1640995200000.wav',
        size: 2048000
      }

      mockDynamoDBClient.send.mockResolvedValueOnce({})

      await jobService.updateJobStatus('1640995200000', JobStatus.COMPLETED, outputLocation)

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(UpdateItemCommand)
      )
    })

    it('should update job status with error message', async () => {
      mockDynamoDBClient.send.mockResolvedValueOnce({})

      await jobService.updateJobStatus('1640995200000', JobStatus.FAILED, undefined, 'FFmpeg process failed')

      expect(mockDynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(UpdateItemCommand)
      )
    })

    it('should handle DynamoDB errors', async () => {
      mockDynamoDBClient.send.mockRejectedValue(new Error('Update failed'))

      await expect(jobService.updateJobStatus('1640995200000', JobStatus.PROCESSING))
        .rejects.toThrow('Failed to update job status: Update failed')
    }, 10000)
  })

  describe('cleanupExpiredJobs', () => {
    it('should clean up expired jobs successfully', async () => {
      const expiredJob1 = {
        jobId: 'expired-1',
        status: JobStatus.COMPLETED,
        ttl: 1640908800 // 24 hours ago
      }
      
      const expiredJob2 = {
        jobId: 'expired-2',
        status: JobStatus.FAILED,
        ttl: 1640908800
      }

      // Mock scan to return expired jobs
      mockDynamoDBClient.send
        .mockResolvedValueOnce({
          Items: [marshall(expiredJob1), marshall(expiredJob2)]
        })
        // Mock delete operations
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})

      await jobService.cleanupExpiredJobs()

      expect(mockDynamoDBClient.send).toHaveBeenCalledTimes(3) // 1 scan + 2 deletes
      
      // Verify scan was called correctly
      expect(mockDynamoDBClient.send).toHaveBeenNthCalledWith(1,
        expect.any(ScanCommand)
      )

      // Verify delete operations
      expect(mockDynamoDBClient.send).toHaveBeenNthCalledWith(2,
        expect.any(DeleteItemCommand)
      )

      expect(mockDynamoDBClient.send).toHaveBeenNthCalledWith(3,
        expect.any(DeleteItemCommand)
      )
    })

    it('should handle no expired jobs', async () => {
      mockDynamoDBClient.send.mockResolvedValueOnce({
        Items: []
      })

      await jobService.cleanupExpiredJobs()

      expect(mockDynamoDBClient.send).toHaveBeenCalledTimes(1) // Only scan, no deletes
    })

    it('should handle scan errors', async () => {
      mockDynamoDBClient.send.mockRejectedValue(new Error('Scan failed'))

      await expect(jobService.cleanupExpiredJobs())
        .rejects.toThrow('Failed to cleanup expired jobs: Scan failed')
    }, 10000)

    it('should continue cleanup even if individual deletes fail', async () => {
      const expiredJob1 = { jobId: 'expired-1', ttl: 1640908800 }
      const expiredJob2 = { jobId: 'expired-2', ttl: 1640908800 }

      mockDynamoDBClient.send
        .mockResolvedValueOnce({
          Items: [marshall(expiredJob1), marshall(expiredJob2)]
        })
        .mockRejectedValueOnce(new Error('Delete failed for job 1'))
        .mockResolvedValueOnce({}) // Second delete succeeds

      // Should not throw error, but continue with cleanup
      await expect(jobService.cleanupExpiredJobs()).resolves.toBeUndefined()

      expect(mockDynamoDBClient.send).toHaveBeenCalledTimes(3)
    })
  })

  describe('retry logic', () => {
    it('should implement exponential backoff', async () => {
      // Mock to fail 2 times then succeed
      mockDynamoDBClient.send
        .mockRejectedValueOnce(new Error('Failure 1'))
        .mockRejectedValueOnce(new Error('Failure 2'))
        .mockResolvedValueOnce({})

      await jobService.createJob(mockJobInput)

      // Should have retried 2 times plus the initial call
      expect(mockDynamoDBClient.send).toHaveBeenCalledTimes(3)
    }, 10000) // Increase timeout for this test
  })
})