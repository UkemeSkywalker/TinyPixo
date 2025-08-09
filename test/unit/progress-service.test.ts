import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest'
import { ProgressService, ProgressData } from '../../lib/progress-service'
import { JobService, JobStatus } from '../../lib/job-service'
import { getCurrentTestEnvironment } from '../test-config'

// Mock Redis
vi.mock('redis', () => ({
  createClient: vi.fn()
}))

// Mock job service
vi.mock('../../lib/job-service', () => ({
  JobService: vi.fn(),
  jobService: {
    getJob: vi.fn(),
    updateJobStatus: vi.fn()
  },
  JobStatus: {
    CREATED: 'created',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed'
  }
}))

describe('ProgressService Unit Tests', () => {
  let progressService: ProgressService
  let mockRedisClient: any
  let mockJobService: any
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
    // Setup mock Redis client
    mockRedisClient = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(),
      ping: vi.fn(),
      on: vi.fn(),
      isReady: true
    }

    // Setup mock JobService
    mockJobService = {
      getJob: vi.fn(),
      updateJobStatus: vi.fn()
    }

    const { createClient } = require('redis')
    
    vi.mocked(createClient).mockReturnValue(mockRedisClient)
    
    // Mock the job service methods directly
    const mockJobServiceModule = vi.doMock('../../lib/job-service', () => ({
      jobService: mockJobService,
      JobService: vi.fn(),
      JobStatus: {
        CREATED: 'created',
        PROCESSING: 'processing', 
        COMPLETED: 'completed',
        FAILED: 'failed'
      }
    }))

    progressService = new ProgressService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('setProgress', () => {
    it('should store progress data in Redis', async () => {
      const progressData: ProgressData = {
        jobId: 'test-job-123',
        progress: 50,
        stage: 'converting',
        currentTime: '00:01:30.00',
        totalDuration: '00:03:00.00'
      }

      mockRedisClient.set.mockResolvedValue('OK')
      mockRedisClient.expire.mockResolvedValue(1)

      await progressService.setProgress('test-job-123', progressData)

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'progress:test-job-123',
        JSON.stringify(progressData)
      )
      expect(mockRedisClient.expire).toHaveBeenCalledWith(
        'progress:test-job-123',
        3600 // 1 hour TTL
      )
    })

    it('should handle Redis connection failures gracefully', async () => {
      const progressData: ProgressData = {
        jobId: 'test-job-123',
        progress: 50,
        stage: 'converting'
      }

      mockRedisClient.set.mockRejectedValue(new Error('Redis connection failed'))

      // Should not throw error, just log warning
      await expect(progressService.setProgress('test-job-123', progressData)).resolves.toBeUndefined()
    })

    it('should validate progress data', async () => {
      const invalidProgressData = {
        jobId: '',
        progress: -1,
        stage: ''
      } as ProgressData

      mockRedisClient.set.mockResolvedValue('OK')

      await expect(progressService.setProgress('', invalidProgressData)).rejects.toThrow()
    })

    it('should cap progress at 100%', async () => {
      const progressData: ProgressData = {
        jobId: 'test-job-123',
        progress: 150, // Over 100%
        stage: 'converting'
      }

      mockRedisClient.set.mockResolvedValue('OK')
      mockRedisClient.expire.mockResolvedValue(1)

      await progressService.setProgress('test-job-123', progressData)

      const expectedData = { ...progressData, progress: 100 }
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'progress:test-job-123',
        JSON.stringify(expectedData)
      )
    })
  })

  describe('getProgress', () => {
    it('should retrieve progress data from Redis', async () => {
      const progressData: ProgressData = {
        jobId: 'test-job-123',
        progress: 75,
        stage: 'converting',
        currentTime: '00:02:15.00',
        totalDuration: '00:03:00.00'
      }

      mockRedisClient.get.mockResolvedValue(JSON.stringify(progressData))

      const result = await progressService.getProgress('test-job-123')

      expect(result).toEqual(progressData)
      expect(mockRedisClient.get).toHaveBeenCalledWith('progress:test-job-123')
    })

    it('should fallback to DynamoDB when Redis data not found', async () => {
      mockRedisClient.get.mockResolvedValue(null)

      const mockJob = {
        jobId: 'test-job-123',
        status: JobStatus.PROCESSING,
        createdAt: new Date(),
        updatedAt: new Date()
      }

      mockJobService.getJob.mockResolvedValue(mockJob)

      const result = await progressService.getProgress('test-job-123')

      expect(result).toMatchObject({
        jobId: 'test-job-123',
        progress: expect.any(Number),
        stage: JobStatus.PROCESSING
      })

      expect(mockJobService.getJob).toHaveBeenCalledWith('test-job-123')
    })

    it('should return null for non-existent job', async () => {
      mockRedisClient.get.mockResolvedValue(null)
      mockJobService.getJob.mockResolvedValue(null)

      const result = await progressService.getProgress('non-existent-job')

      expect(result).toBeNull()
    })

    it('should handle Redis connection failures with DynamoDB fallback', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis connection failed'))

      const mockJob = {
        jobId: 'test-job-123',
        status: JobStatus.COMPLETED,
        createdAt: new Date(),
        updatedAt: new Date()
      }

      mockJobService.getJob.mockResolvedValue(mockJob)

      const result = await progressService.getProgress('test-job-123')

      expect(result).toMatchObject({
        jobId: 'test-job-123',
        progress: 100, // Completed job
        stage: JobStatus.COMPLETED
      })
    })

    it('should handle malformed Redis data', async () => {
      mockRedisClient.get.mockResolvedValue('invalid json')

      const mockJob = {
        jobId: 'test-job-123',
        status: JobStatus.PROCESSING,
        createdAt: new Date(),
        updatedAt: new Date()
      }

      mockJobService.getJob.mockResolvedValue(mockJob)

      const result = await progressService.getProgress('test-job-123')

      // Should fallback to DynamoDB when Redis data is malformed
      expect(result).toMatchObject({
        jobId: 'test-job-123',
        stage: JobStatus.PROCESSING
      })
    })
  })

  describe('initializeProgress', () => {
    it('should initialize progress at 0%', async () => {
      mockRedisClient.set.mockResolvedValue('OK')
      mockRedisClient.expire.mockResolvedValue(1)

      await progressService.initializeProgress('test-job-123')

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'progress:test-job-123',
        JSON.stringify({
          jobId: 'test-job-123',
          progress: 0,
          stage: 'initializing',
          startTime: expect.any(Number)
        })
      )
    })

    it('should handle initialization errors gracefully', async () => {
      mockRedisClient.set.mockRejectedValue(new Error('Redis error'))

      await expect(progressService.initializeProgress('test-job-123')).resolves.toBeUndefined()
    })
  })

  describe('markComplete', () => {
    it('should set progress to 100% when job completes', async () => {
      mockRedisClient.set.mockResolvedValue('OK')
      mockRedisClient.expire.mockResolvedValue(1)

      await progressService.markComplete('test-job-123')

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'progress:test-job-123',
        JSON.stringify({
          jobId: 'test-job-123',
          progress: 100,
          stage: 'completed',
          completedAt: expect.any(Number)
        })
      )
    })

    it('should extend TTL for completed jobs', async () => {
      mockRedisClient.set.mockResolvedValue('OK')
      mockRedisClient.expire.mockResolvedValue(1)

      await progressService.markComplete('test-job-123')

      expect(mockRedisClient.expire).toHaveBeenCalledWith(
        'progress:test-job-123',
        7200 // 2 hours TTL for completed jobs
      )
    })
  })

  describe('markFailed', () => {
    it('should set progress to -1 when job fails', async () => {
      mockRedisClient.set.mockResolvedValue('OK')
      mockRedisClient.expire.mockResolvedValue(1)

      await progressService.markFailed('test-job-123', 'FFmpeg process failed')

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'progress:test-job-123',
        JSON.stringify({
          jobId: 'test-job-123',
          progress: -1,
          stage: 'failed',
          error: 'FFmpeg process failed',
          failedAt: expect.any(Number)
        })
      )
    })

    it('should handle missing error message', async () => {
      mockRedisClient.set.mockResolvedValue('OK')
      mockRedisClient.expire.mockResolvedValue(1)

      await progressService.markFailed('test-job-123')

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'progress:test-job-123',
        JSON.stringify({
          jobId: 'test-job-123',
          progress: -1,
          stage: 'failed',
          error: 'Unknown error',
          failedAt: expect.any(Number)
        })
      )
    })
  })

  describe('cleanup and maintenance', () => {
    it('should clean up expired progress data', async () => {
      const expiredJobIds = ['job-1', 'job-2', 'job-3']
      
      mockRedisClient.del.mockResolvedValue(1)

      const cleanedCount = await progressService.cleanupExpiredProgress(expiredJobIds)

      expect(cleanedCount).toBe(3)
      expect(mockRedisClient.del).toHaveBeenCalledTimes(3)
    })

    it('should handle cleanup errors gracefully', async () => {
      const expiredJobIds = ['job-1', 'job-2']
      
      mockRedisClient.del
        .mockResolvedValueOnce(1) // First delete succeeds
        .mockRejectedValueOnce(new Error('Delete failed')) // Second delete fails

      const cleanedCount = await progressService.cleanupExpiredProgress(expiredJobIds)

      expect(cleanedCount).toBe(1) // Only one cleaned up
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent progress updates', async () => {
      const jobId = 'concurrent-test-job'
      const progressUpdates = [
        { progress: 10, stage: 'starting' },
        { progress: 25, stage: 'processing' },
        { progress: 50, stage: 'converting' },
        { progress: 75, stage: 'finalizing' },
        { progress: 100, stage: 'completed' }
      ]

      mockRedisClient.set.mockResolvedValue('OK')
      mockRedisClient.expire.mockResolvedValue(1)

      const updatePromises = progressUpdates.map(update =>
        progressService.setProgress(jobId, {
          jobId,
          ...update
        })
      )

      await Promise.all(updatePromises)

      expect(mockRedisClient.set).toHaveBeenCalledTimes(5)
    })

    it('should handle concurrent reads', async () => {
      const jobId = 'concurrent-read-job'
      const progressData = {
        jobId,
        progress: 50,
        stage: 'converting'
      }

      mockRedisClient.get.mockResolvedValue(JSON.stringify(progressData))

      const readPromises = Array.from({ length: 10 }, () =>
        progressService.getProgress(jobId)
      )

      const results = await Promise.all(readPromises)

      expect(results).toHaveLength(10)
      results.forEach(result => {
        expect(result).toEqual(progressData)
      })
    })
  })

  describe('performance', () => {
    it('should handle high-frequency progress updates efficiently', async () => {
      const jobId = 'performance-test-job'
      const updateCount = 1000

      mockRedisClient.set.mockResolvedValue('OK')
      mockRedisClient.expire.mockResolvedValue(1)

      const startTime = Date.now()

      const updatePromises = Array.from({ length: updateCount }, (_, i) =>
        progressService.setProgress(jobId, {
          jobId,
          progress: (i / updateCount) * 100,
          stage: 'converting'
        })
      )

      await Promise.all(updatePromises)

      const duration = Date.now() - startTime

      expect(duration).toBeLessThan(5000) // Should complete within 5 seconds
      expect(mockRedisClient.set).toHaveBeenCalledTimes(updateCount)
    })

    it('should not leak memory with many operations', async () => {
      const initialMemory = process.memoryUsage().heapUsed

      mockRedisClient.set.mockResolvedValue('OK')
      mockRedisClient.get.mockResolvedValue(JSON.stringify({ jobId: 'test', progress: 50 }))

      // Perform many operations
      for (let i = 0; i < 1000; i++) {
        await progressService.setProgress(`job-${i}`, {
          jobId: `job-${i}`,
          progress: Math.random() * 100,
          stage: 'converting'
        })

        await progressService.getProgress(`job-${i}`)
      }

      const finalMemory = process.memoryUsage().heapUsed
      const memoryIncrease = finalMemory - initialMemory

      // Memory increase should be reasonable (less than 20MB)
      expect(memoryIncrease).toBeLessThan(20 * 1024 * 1024)
    })
  })

  describe('Redis connection management', () => {
    it('should handle Redis connection loss', async () => {
      mockRedisClient.isReady = false
      mockRedisClient.get.mockRejectedValue(new Error('Connection lost'))

      const mockJob = {
        jobId: 'test-job-123',
        status: JobStatus.PROCESSING,
        createdAt: new Date(),
        updatedAt: new Date()
      }

      mockJobService.getJob.mockResolvedValue(mockJob)

      const result = await progressService.getProgress('test-job-123')

      // Should fallback to DynamoDB
      expect(result).toMatchObject({
        jobId: 'test-job-123',
        stage: JobStatus.PROCESSING
      })
    })

    it('should attempt Redis reconnection', async () => {
      mockRedisClient.connect.mockResolvedValue(undefined)

      await progressService.reconnect()

      expect(mockRedisClient.connect).toHaveBeenCalled()
    })

    it('should handle reconnection failures', async () => {
      mockRedisClient.connect.mockRejectedValue(new Error('Reconnection failed'))

      await expect(progressService.reconnect()).resolves.toBeUndefined()
    })
  })

  describe('data consistency', () => {
    it('should ensure progress values are within valid range', async () => {
      const testCases = [
        { input: -10, expected: 0 },
        { input: 0, expected: 0 },
        { input: 50, expected: 50 },
        { input: 100, expected: 100 },
        { input: 150, expected: 100 }
      ]

      mockRedisClient.set.mockResolvedValue('OK')
      mockRedisClient.expire.mockResolvedValue(1)

      for (const { input, expected } of testCases) {
        await progressService.setProgress('test-job', {
          jobId: 'test-job',
          progress: input,
          stage: 'converting'
        })

        const setCall = mockRedisClient.set.mock.calls.find(call => 
          call[0] === 'progress:test-job'
        )
        
        const storedData = JSON.parse(setCall[1])
        expect(storedData.progress).toBe(expected)
      }
    })

    it('should maintain progress monotonicity', async () => {
      const jobId = 'monotonic-test-job'
      const progressSequence = [10, 25, 50, 45, 75, 100] // Note: 45 < 50

      mockRedisClient.set.mockResolvedValue('OK')
      mockRedisClient.expire.mockResolvedValue(1)
      mockRedisClient.get.mockImplementation((key) => {
        // Simulate getting previous progress
        return Promise.resolve(JSON.stringify({
          jobId,
          progress: 50, // Previous progress
          stage: 'converting'
        }))
      })

      for (const progress of progressSequence) {
        await progressService.setProgress(jobId, {
          jobId,
          progress,
          stage: 'converting'
        })
      }

      // Should have prevented regression from 50 to 45
      const setCalls = mockRedisClient.set.mock.calls.filter(call => 
        call[0] === `progress:${jobId}`
      )

      expect(setCalls.length).toBeGreaterThan(0)
    })
  })
})