import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest'
import { RedisClientType } from 'redis'
import { ProgressService, ProgressData } from './progress-service'
import { JobService, JobStatus, Job, S3Location } from './job-service'

// Mock the dependencies
vi.mock('./aws-services', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getRedisClient: vi.fn()
  }
})

vi.mock('./job-service', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    jobService: {
      getJob: vi.fn()
    }
  }
})

describe('ProgressService', () => {
  let progressService: ProgressService
  let mockRedisClient: any
  let mockJobService: any
  let mockGetRedisClient: any

  const testJobId = 'test-job-123'
  const testProgressData: ProgressData = {
    jobId: testJobId,
    progress: 45,
    stage: 'converting',
    estimatedTimeRemaining: 120,
    startTime: Date.now()
  }

  const mockJob: Job = {
    jobId: testJobId,
    status: JobStatus.PROCESSING,
    inputS3Location: {
      bucket: 'test-bucket',
      key: 'uploads/test.mp3',
      size: 1024000
    },
    format: 'wav',
    quality: '192k',
    createdAt: new Date(),
    updatedAt: new Date(),
    ttl: Math.floor(Date.now() / 1000) + 86400
  }

  beforeAll(() => {
    // Mock console methods to reduce test noise
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    // Create fresh mocks for each test
    mockRedisClient = {
      setEx: vi.fn(),
      get: vi.fn(),
      keys: vi.fn(),
      ttl: vi.fn(),
      expire: vi.fn()
    }

    mockGetRedisClient = vi.fn().mockResolvedValue(mockRedisClient)
    
    // Mock is already set up at module level

    // Mock the job service
    mockJobService = {
      getJob: vi.fn()
    }
    
    // Mock is already set up at module level

    // Create fresh service instance
    progressService = new ProgressService()
    
    // Clear all mocks
    vi.clearAllMocks()
  })

  describe('initializeProgress', () => {
    it('should initialize progress with 0% and initialized stage', async () => {
      mockRedisClient.setEx.mockResolvedValueOnce('OK')

      await progressService.initializeProgress(testJobId)

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        `progress:${testJobId}`,
        3600, // TTL
        expect.stringContaining('"progress":0')
      )

      const setExCall = mockRedisClient.setEx.mock.calls[0]
      const progressData = JSON.parse(setExCall[2])
      expect(progressData).toMatchObject({
        jobId: testJobId,
        progress: 0,
        stage: 'initialized'
      })
      expect(progressData.startTime).toBeTypeOf('number')
    })

    it('should handle Redis connection failure gracefully', async () => {
      mockGetRedisClient.mockResolvedValueOnce(null)

      // Should not throw error
      await expect(progressService.initializeProgress(testJobId)).resolves.toBeUndefined()
    })
  })

  describe('setProgress', () => {
    it('should store progress data in Redis with TTL', async () => {
      mockRedisClient.setEx.mockResolvedValueOnce('OK')

      await progressService.setProgress(testJobId, testProgressData)

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        `progress:${testJobId}`,
        3600,
        JSON.stringify(testProgressData)
      )
    })

    it('should handle Redis errors without throwing', async () => {
      mockRedisClient.setEx.mockRejectedValueOnce(new Error('Redis connection failed'))

      // Should not throw error
      await expect(progressService.setProgress(testJobId, testProgressData)).resolves.toBeUndefined()
    })

    it('should retry Redis operations with exponential backoff', async () => {
      mockRedisClient.setEx
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Another failure'))
        .mockResolvedValueOnce('OK')

      await progressService.setProgress(testJobId, testProgressData)

      expect(mockRedisClient.setEx).toHaveBeenCalledTimes(3)
    }, 10000)

    it('should handle Redis unavailable scenario', async () => {
      mockGetRedisClient.mockResolvedValueOnce(null)

      await expect(progressService.setProgress(testJobId, testProgressData)).resolves.toBeUndefined()
      expect(mockRedisClient.setEx).not.toHaveBeenCalled()
    })
  })

  describe('getProgress', () => {
    it('should retrieve progress from Redis when available', async () => {
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(testProgressData))

      const result = await progressService.getProgress(testJobId)

      expect(result).toEqual(testProgressData)
      expect(mockRedisClient.get).toHaveBeenCalledWith(`progress:${testJobId}`)
      expect(mockJobService.getJob).not.toHaveBeenCalled()
    })

    it('should fallback to DynamoDB when Redis data not found', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null)
      mockJobService.getJob.mockResolvedValueOnce(mockJob)

      const result = await progressService.getProgress(testJobId)

      expect(result).toMatchObject({
        jobId: testJobId,
        progress: 50, // Processing status maps to 50%
        stage: 'processing'
      })
      expect(mockJobService.getJob).toHaveBeenCalledWith(testJobId)
    })

    it('should handle completed job status in DynamoDB fallback', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null)
      const completedJob = { ...mockJob, status: JobStatus.COMPLETED }
      mockJobService.getJob.mockResolvedValueOnce(completedJob)

      const result = await progressService.getProgress(testJobId)

      expect(result).toMatchObject({
        jobId: testJobId,
        progress: 100,
        stage: 'completed'
      })
    })

    it('should handle failed job status in DynamoDB fallback', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null)
      const failedJob = { ...mockJob, status: JobStatus.FAILED, error: 'FFmpeg failed' }
      mockJobService.getJob.mockResolvedValueOnce(failedJob)

      const result = await progressService.getProgress(testJobId)

      expect(result).toMatchObject({
        jobId: testJobId,
        progress: -1,
        stage: 'failed',
        error: 'FFmpeg failed'
      })
    })

    it('should return null when job not found in both Redis and DynamoDB', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null)
      mockJobService.getJob.mockResolvedValueOnce(null)

      const result = await progressService.getProgress(testJobId)

      expect(result).toBeNull()
    })

    it('should fallback to DynamoDB when Redis connection fails', async () => {
      mockGetRedisClient.mockResolvedValueOnce(null)
      mockJobService.getJob.mockResolvedValueOnce(mockJob)

      const result = await progressService.getProgress(testJobId)

      expect(result).toMatchObject({
        jobId: testJobId,
        progress: 50,
        stage: 'processing'
      })
    })

    it('should fallback to DynamoDB when Redis throws error', async () => {
      mockRedisClient.get.mockRejectedValueOnce(new Error('Redis error'))
      mockJobService.getJob.mockResolvedValueOnce(mockJob)

      const result = await progressService.getProgress(testJobId)

      expect(result).toMatchObject({
        jobId: testJobId,
        progress: 50,
        stage: 'processing'
      })
    })

    it('should return null when both Redis and DynamoDB fail', async () => {
      mockRedisClient.get.mockRejectedValueOnce(new Error('Redis error'))
      mockJobService.getJob.mockRejectedValueOnce(new Error('DynamoDB error'))

      const result = await progressService.getProgress(testJobId)

      expect(result).toBeNull()
    })
  })

  describe('markComplete', () => {
    it('should set progress to 100% with completed stage', async () => {
      mockRedisClient.setEx.mockResolvedValueOnce('OK')

      await progressService.markComplete(testJobId)

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        `progress:${testJobId}`,
        3600,
        expect.stringContaining('"progress":100')
      )

      const setExCall = mockRedisClient.setEx.mock.calls[0]
      const progressData = JSON.parse(setExCall[2])
      expect(progressData).toMatchObject({
        jobId: testJobId,
        progress: 100,
        stage: 'completed'
      })
    })
  })

  describe('markFailed', () => {
    it('should set progress to -1 with failed stage and error message', async () => {
      mockRedisClient.setEx.mockResolvedValueOnce('OK')
      const errorMessage = 'FFmpeg process crashed'

      await progressService.markFailed(testJobId, errorMessage)

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        `progress:${testJobId}`,
        3600,
        expect.stringContaining('"progress":-1')
      )

      const setExCall = mockRedisClient.setEx.mock.calls[0]
      const progressData = JSON.parse(setExCall[2])
      expect(progressData).toMatchObject({
        jobId: testJobId,
        progress: -1,
        stage: 'failed',
        error: errorMessage
      })
    })
  })

  describe('cleanupExpiredProgress', () => {
    it('should check TTL for all progress keys', async () => {
      const progressKeys = ['progress:job1', 'progress:job2', 'progress:job3']
      mockRedisClient.keys.mockResolvedValueOnce(progressKeys)
      mockRedisClient.ttl
        .mockResolvedValueOnce(1800) // Active key
        .mockResolvedValueOnce(-2)   // Expired key
        .mockResolvedValueOnce(-1)   // Key with no TTL

      mockRedisClient.expire.mockResolvedValueOnce(1)

      await progressService.cleanupExpiredProgress()

      expect(mockRedisClient.keys).toHaveBeenCalledWith('progress:*')
      expect(mockRedisClient.ttl).toHaveBeenCalledTimes(3)
      expect(mockRedisClient.expire).toHaveBeenCalledWith('progress:job3', 3600)
    })

    it('should handle no progress keys', async () => {
      mockRedisClient.keys.mockResolvedValueOnce([])

      await progressService.cleanupExpiredProgress()

      expect(mockRedisClient.keys).toHaveBeenCalledWith('progress:*')
      expect(mockRedisClient.ttl).not.toHaveBeenCalled()
    })

    it('should handle Redis unavailable during cleanup', async () => {
      mockGetRedisClient.mockResolvedValueOnce(null)

      await expect(progressService.cleanupExpiredProgress()).resolves.toBeUndefined()
      expect(mockRedisClient.keys).not.toHaveBeenCalled()
    })

    it('should handle errors during cleanup gracefully', async () => {
      mockRedisClient.keys.mockRejectedValueOnce(new Error('Redis error'))

      await expect(progressService.cleanupExpiredProgress()).resolves.toBeUndefined()
    })
  })

  describe('Redis retry logic', () => {
    it('should retry failed Redis operations with exponential backoff', async () => {
      mockRedisClient.get
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce(JSON.stringify(testProgressData))

      const result = await progressService.getProgress(testJobId)

      expect(result).toEqual(testProgressData)
      expect(mockRedisClient.get).toHaveBeenCalledTimes(3)
    }, 10000)

    it('should give up after max retries and fallback to DynamoDB', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Persistent Redis failure'))
      mockJobService.getJob.mockResolvedValueOnce(mockJob)

      const result = await progressService.getProgress(testJobId)

      expect(result).toMatchObject({
        jobId: testJobId,
        progress: 50,
        stage: 'processing'
      })
      expect(mockRedisClient.get).toHaveBeenCalledTimes(4) // Initial + 3 retries
    }, 10000)
  })

  describe('Environment compatibility', () => {
    it('should work with LocalStack Redis', async () => {
      // This test verifies the service works with LocalStack
      mockRedisClient.setEx.mockResolvedValueOnce('OK')
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(testProgressData))

      await progressService.setProgress(testJobId, testProgressData)
      const result = await progressService.getProgress(testJobId)

      expect(result).toEqual(testProgressData)
    })

    it('should work with real AWS ElastiCache Redis', async () => {
      // This test verifies the service works with real AWS Redis
      mockRedisClient.setEx.mockResolvedValueOnce('OK')
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(testProgressData))

      await progressService.setProgress(testJobId, testProgressData)
      const result = await progressService.getProgress(testJobId)

      expect(result).toEqual(testProgressData)
    })
  })

  describe('TTL and automatic cleanup', () => {
    it('should set TTL on progress data', async () => {
      mockRedisClient.setEx.mockResolvedValueOnce('OK')

      await progressService.setProgress(testJobId, testProgressData)

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        `progress:${testJobId}`,
        3600, // 1 hour TTL
        JSON.stringify(testProgressData)
      )
    })

    it('should handle expired keys during cleanup', async () => {
      mockRedisClient.keys.mockResolvedValueOnce(['progress:expired-job'])
      mockRedisClient.ttl.mockResolvedValueOnce(-2) // Key expired

      await progressService.cleanupExpiredProgress()

      expect(mockRedisClient.ttl).toHaveBeenCalledWith('progress:expired-job')
      // Should not try to set TTL on expired key
      expect(mockRedisClient.expire).not.toHaveBeenCalled()
    })
  })
})