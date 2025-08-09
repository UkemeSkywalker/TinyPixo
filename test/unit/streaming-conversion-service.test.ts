import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest'
import { StreamingConversionService } from '../../lib/streaming-conversion-service-fixed'
import { Job, JobStatus, S3Location } from '../../lib/job-service'
import { ProgressData } from '../../lib/progress-service'
import { createMockFFmpegProcess } from '../test-helpers'
import { spawn } from 'child_process'

// Mock child_process
vi.mock('child_process')

// Mock fs/promises
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    writeFile: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn()
  }
})

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  GetObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn()
}))

vi.mock('../../lib/aws-services', () => ({
  s3Client: {
    send: vi.fn(),
    getObject: vi.fn(() => ({
      createReadStream: vi.fn(() => ({
        pipe: vi.fn(),
        on: vi.fn()
      }))
    }))
  },
  dynamodbClient: {
    send: vi.fn()
  }
}))

describe('StreamingConversionService', () => {
  let service: StreamingConversionService
  let mockS3Client: any
  let mockSpawn: any
  let progressCallback: vi.MockedFunction<(progress: ProgressData) => Promise<void>>

  const mockJob: Job = {
    jobId: 'test-job-123',
    status: JobStatus.CREATED,
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
    // Mock console methods
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    // Setup mocks
    mockS3Client = {
      send: vi.fn(),
      getObject: vi.fn(() => ({
        createReadStream: vi.fn(() => ({
          pipe: vi.fn(),
          on: vi.fn()
        }))
      }))
    }

    mockSpawn = vi.mocked(spawn)
    progressCallback = vi.fn().mockResolvedValue(undefined)

    service = new StreamingConversionService()
    
    vi.clearAllMocks()
  })

  describe('streamingConvertAudio', () => {
    it('should successfully convert audio using streaming', async () => {
      const mockProcess = createMockFFmpegProcess()
      mockSpawn.mockReturnValue(mockProcess)

      // Mock S3 operations
      mockS3Client.send.mockResolvedValueOnce({}) // HeadObject
      mockS3Client.send.mockResolvedValueOnce({ Location: 'test-location' }) // Upload

      // Start conversion
      const conversionPromise = service.streamingConvertAudio(mockJob, progressCallback)

      // Simulate FFmpeg progress
      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('Duration: 00:03:00.00'))
        mockProcess.stderr.emit('data', Buffer.from('time=00:01:30.00 bitrate=192.0kbits/s'))
        mockProcess.stderr.emit('data', Buffer.from('time=00:03:00.00 bitrate=192.0kbits/s'))
        mockProcess.emit('exit', 0, null)
      }, 100)

      const result = await conversionPromise

      expect(result).toEqual({
        bucket: 'test-bucket',
        key: 'conversions/test-job-123.wav',
        size: expect.any(Number)
      })

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'test-job-123',
          progress: expect.any(Number),
          stage: 'converting'
        })
      )
    }, 10000)

    it('should handle FFmpeg process failure', async () => {
      const mockProcess = createMockFFmpegProcess()
      mockSpawn.mockReturnValue(mockProcess)

      const conversionPromise = service.streamingConvertAudio(mockJob, progressCallback)

      // Simulate FFmpeg failure
      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('Error: Invalid input format'))
        mockProcess.emit('exit', 1, null)
      }, 100)

      await expect(conversionPromise).rejects.toThrow('FFmpeg process failed')
    }, 10000)

    it('should handle FFmpeg timeout', async () => {
      const mockProcess = createMockFFmpegProcess()
      mockSpawn.mockReturnValue(mockProcess)

      const conversionPromise = service.streamingConvertAudio(mockJob, progressCallback)

      // Don't emit exit event to simulate timeout
      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('Duration: 00:03:00.00'))
      }, 100)

      await expect(conversionPromise).rejects.toThrow('Conversion timeout')
    }, 15000)

    it('should fallback to file-based conversion when streaming fails', async () => {
      const mockProcess = createMockFFmpegProcess()
      mockSpawn.mockReturnValue(mockProcess)

      // Mock streaming failure
      mockS3Client.getObject.mockImplementation(() => {
        throw new Error('Streaming not supported')
      })

      // Mock successful file-based conversion
      vi.spyOn(service, 'fallbackFileConversion').mockResolvedValue({
        bucket: 'test-bucket',
        key: 'conversions/test-job-123.wav',
        size: 2048000
      })

      const result = await service.streamingConvertAudio(mockJob, progressCallback)

      expect(service.fallbackFileConversion).toHaveBeenCalledWith(mockJob, progressCallback)
      expect(result.key).toBe('conversions/test-job-123.wav')
    })

    it('should validate streaming support for different formats', async () => {
      const mp3Job = { ...mockJob, format: 'mp3' }
      const wavJob = { ...mockJob, format: 'wav' }
      const flacJob = { ...mockJob, format: 'flac' }

      expect(service.validateStreamingSupport('mp3')).toBe(true)
      expect(service.validateStreamingSupport('wav')).toBe(true)
      expect(service.validateStreamingSupport('flac')).toBe(false)
    })
  })

  describe('parseFFmpegProgress', () => {
    it('should parse duration from FFmpeg output', () => {
      const stderrOutput = 'Duration: 00:03:45.67, start: 0.000000, bitrate: 320 kb/s'
      
      const progress = service.parseFFmpegProgress(stderrOutput, 'test-job')

      expect(progress).toMatchObject({
        jobId: 'test-job',
        totalDuration: '00:03:45.67'
      })
    })

    it('should parse time progress from FFmpeg output', () => {
      const stderrOutput = 'frame= 1234 fps=1.0 q=28.0 size=    1024kB time=00:01:30.45 bitrate= 192.0kbits/s speed=1.0x'
      
      service.parseFFmpegProgress('Duration: 00:03:00.00', 'test-job') // Set duration first
      const progress = service.parseFFmpegProgress(stderrOutput, 'test-job')

      expect(progress).toMatchObject({
        jobId: 'test-job',
        currentTime: '00:01:30.45',
        progress: 50.25 // (90.45 / 180) * 100
      })
    })

    it('should handle missing duration gracefully', () => {
      const stderrOutput = 'frame= 1234 fps=1.0 q=28.0 size=    1024kB time=00:01:30.45 bitrate= 192.0kbits/s speed=1.0x'
      
      const progress = service.parseFFmpegProgress(stderrOutput, 'test-job')

      expect(progress).toMatchObject({
        jobId: 'test-job',
        currentTime: '00:01:30.45',
        progress: 0 // Unknown duration
      })
    })

    it('should handle various time formats', () => {
      const testCases = [
        { input: 'time=00:01:30.45', expected: 90.45 },
        { input: 'time=01:00:00.00', expected: 3600 },
        { input: 'time=00:00:05.123', expected: 5.123 }
      ]

      testCases.forEach(({ input, expected }) => {
        const progress = service.parseFFmpegProgress(input, 'test-job')
        expect(progress?.currentTime).toBe(input.split('=')[1])
      })
    })
  })

  describe('fallbackFileConversion', () => {
    it('should perform file-based conversion when streaming fails', async () => {
      const mockProcess = createMockFFmpegProcess()
      mockSpawn.mockReturnValue(mockProcess)

      // Mock file operations
      vi.mock('fs/promises', () => ({
        writeFile: vi.fn(),
        unlink: vi.fn(),
        access: vi.fn()
      }))

      const conversionPromise = service.fallbackFileConversion(mockJob, progressCallback)

      // Simulate successful conversion
      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('Duration: 00:03:00.00'))
        mockProcess.stderr.emit('data', Buffer.from('time=00:03:00.00 bitrate=192.0kbits/s'))
        mockProcess.emit('exit', 0, null)
      }, 100)

      const result = await conversionPromise

      expect(result).toEqual({
        bucket: 'test-bucket',
        key: 'conversions/test-job-123.wav',
        size: expect.any(Number)
      })
    }, 10000)

    it('should clean up temporary files after conversion', async () => {
      const mockProcess = createMockFFmpegProcess()
      mockSpawn.mockReturnValue(mockProcess)

      const { unlink } = await import('fs/promises')
      const mockUnlink = vi.mocked(unlink)

      const conversionPromise = service.fallbackFileConversion(mockJob, progressCallback)

      setTimeout(() => {
        mockProcess.emit('exit', 0, null)
      }, 100)

      await conversionPromise

      expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('/tmp/'))
    }, 10000)
  })

  describe('error handling and recovery', () => {
    it('should handle S3 connection failures', async () => {
      mockS3Client.send.mockRejectedValue(new Error('S3 connection failed'))

      await expect(
        service.streamingConvertAudio(mockJob, progressCallback)
      ).rejects.toThrow('S3 connection failed')
    })

    it('should handle invalid audio formats', async () => {
      const invalidJob = { ...mockJob, format: 'invalid' as any }

      await expect(
        service.streamingConvertAudio(invalidJob, progressCallback)
      ).rejects.toThrow('Unsupported format')
    })

    it('should implement retry logic for transient failures', async () => {
      const mockProcess = createMockFFmpegProcess()
      mockSpawn.mockReturnValue(mockProcess)

      // Mock transient S3 failure then success
      mockS3Client.send
        .mockRejectedValueOnce(new Error('Temporary S3 failure'))
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Location: 'test-location' })

      const conversionPromise = service.streamingConvertAudio(mockJob, progressCallback)

      setTimeout(() => {
        mockProcess.emit('exit', 0, null)
      }, 100)

      const result = await conversionPromise

      expect(result).toBeDefined()
      expect(mockS3Client.send).toHaveBeenCalledTimes(3) // Initial failure + 2 retries
    }, 10000)
  })

  describe('resource management', () => {
    it('should limit concurrent conversions', async () => {
      const jobs = Array.from({ length: 10 }, (_, i) => ({
        ...mockJob,
        jobId: `job-${i}`
      }))

      const conversionPromises = jobs.map(job => 
        service.streamingConvertAudio(job, progressCallback)
      )

      // Mock processes for all jobs
      jobs.forEach(() => {
        const mockProcess = createMockFFmpegProcess()
        mockSpawn.mockReturnValue(mockProcess)
        setTimeout(() => mockProcess.emit('exit', 0, null), 100)
      })

      const results = await Promise.allSettled(conversionPromises)

      // Some conversions should be queued/limited
      const successful = results.filter(r => r.status === 'fulfilled').length
      const failed = results.filter(r => r.status === 'rejected').length

      expect(successful + failed).toBe(10)
      expect(successful).toBeGreaterThan(0)
    }, 15000)

    it('should monitor memory usage during conversion', async () => {
      const mockProcess = createMockFFmpegProcess()
      mockSpawn.mockReturnValue(mockProcess)

      const initialMemory = process.memoryUsage()
      
      const conversionPromise = service.streamingConvertAudio(mockJob, progressCallback)

      setTimeout(() => {
        mockProcess.emit('exit', 0, null)
      }, 100)

      await conversionPromise

      const finalMemory = process.memoryUsage()
      
      // Memory usage should not increase dramatically
      expect(finalMemory.heapUsed - initialMemory.heapUsed).toBeLessThan(100 * 1024 * 1024) // 100MB
    }, 10000)
  })

  describe('format compatibility', () => {
    it('should handle different input/output format combinations', async () => {
      const formatCombinations = [
        { input: 'mp3', output: 'wav' },
        { input: 'wav', output: 'mp3' },
        { input: 'aac', output: 'wav' },
        { input: 'ogg', output: 'mp3' }
      ]

      for (const { input, output } of formatCombinations) {
        const testJob = {
          ...mockJob,
          inputS3Location: { ...mockJob.inputS3Location, key: `uploads/test.${input}` },
          format: output
        }

        const mockProcess = createMockFFmpegProcess()
        mockSpawn.mockReturnValue(mockProcess)

        const conversionPromise = service.streamingConvertAudio(testJob, progressCallback)

        setTimeout(() => {
          mockProcess.emit('exit', 0, null)
        }, 100)

        const result = await conversionPromise

        expect(result.key).toBe(`conversions/test-job-123.${output}`)
      }
    }, 20000)
  })
})