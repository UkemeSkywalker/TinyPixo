import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest'
import { StreamingConversionService, ConversionOptions } from './streaming-conversion-service'
import { Job, JobStatus, S3Location } from './job-service'
import { spawn } from 'child_process'
import { Readable, PassThrough } from 'stream'
import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

// Mock dependencies
vi.mock('child_process')
vi.mock('@aws-sdk/client-s3')
vi.mock('@aws-sdk/lib-storage')
vi.mock('./aws-services')
vi.mock('./job-service')
vi.mock('./progress-service')

const mockSpawn = vi.mocked(spawn)
const mockS3Client = vi.mocked(S3Client)
const mockUpload = vi.mocked(Upload)

describe('StreamingConversionService', () => {
  let service: StreamingConversionService
  let mockS3ClientInstance: any
  let mockJob: Job
  let mockOptions: ConversionOptions

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
    vi.clearAllMocks()

    // Mock S3 client
    mockS3ClientInstance = {
      send: vi.fn()
    }
    mockS3Client.mockImplementation(() => mockS3ClientInstance)

    service = new StreamingConversionService(mockS3ClientInstance)

    // Mock job data
    mockJob = {
      jobId: 'test-job-123',
      status: JobStatus.CREATED,
      inputS3Location: {
        bucket: 'test-bucket',
        key: 'uploads/test-audio.mp3',
        size: 1024000 // 1MB
      },
      format: 'wav',
      quality: '192k',
      createdAt: new Date(),
      updatedAt: new Date(),
      ttl: Date.now() + 86400000
    }

    mockOptions = {
      format: 'wav',
      quality: '192k',
      timeout: 30000
    }
  })

  afterEach(async () => {
    // Cleanup any active processes
    await service.cleanup()
  })

  describe('convertAudio', () => {
    it('should attempt streaming conversion for compatible formats', async () => {
      // Mock streaming compatibility check to return true
      const mockProgressService = await import('./progress-service')
      vi.spyOn(mockProgressService.progressService, 'checkStreamingCompatibility').mockReturnValue({
        supportsStreaming: true,
        fallbackRecommended: false
      })
      vi.spyOn(mockProgressService.progressService, 'initializeProgress').mockResolvedValue()

      // Mock successful streaming conversion
      const mockStreamingResult = {
        success: true,
        outputS3Location: {
          bucket: 'test-bucket',
          key: 'conversions/test-job-123.wav',
          size: 2048000
        },
        fallbackUsed: false,
        processingTimeMs: 5000
      }

      // Mock the private streamingConvertAudio method
      vi.spyOn(service as any, 'streamingConvertAudio').mockResolvedValue(mockStreamingResult)

      const result = await service.convertAudio(mockJob, mockOptions)

      expect(result.success).toBe(true)
      expect(result.fallbackUsed).toBe(false)
      expect(result.outputS3Location).toBeDefined()
      expect(mockProgressService.progressService.initializeProgress).toHaveBeenCalledWith('test-job-123')
    })

    it('should fallback to file-based conversion when streaming is not supported', async () => {
      // Mock streaming compatibility check to return false
      const mockProgressService = await import('./progress-service')
      vi.spyOn(mockProgressService.progressService, 'checkStreamingCompatibility').mockReturnValue({
        supportsStreaming: false,
        reason: 'Format requires file access',
        fallbackRecommended: true
      })
      vi.spyOn(mockProgressService.progressService, 'initializeProgress').mockResolvedValue()

      // Mock successful fallback conversion
      const mockFallbackResult = {
        success: true,
        outputS3Location: {
          bucket: 'test-bucket',
          key: 'conversions/test-job-123.wav',
          size: 2048000
        },
        fallbackUsed: true,
        processingTimeMs: 3000
      }

      vi.spyOn(service as any, 'fallbackFileConversion').mockResolvedValue(mockFallbackResult)

      const result = await service.convertAudio(mockJob, mockOptions)

      expect(result.success).toBe(true)
      expect(result.fallbackUsed).toBe(true)
      expect(result.outputS3Location).toBeDefined()
    })

    it('should fallback when streaming conversion fails', async () => {
      const mockProgressService = await import('./progress-service')
      vi.spyOn(mockProgressService.progressService, 'checkStreamingCompatibility').mockReturnValue({
        supportsStreaming: true,
        fallbackRecommended: false
      })
      vi.spyOn(mockProgressService.progressService, 'initializeProgress').mockResolvedValue()

      // Mock failed streaming conversion
      const mockStreamingResult = {
        success: false,
        error: 'Streaming failed',
        fallbackUsed: false,
        processingTimeMs: 1000
      }

      // Mock successful fallback conversion
      const mockFallbackResult = {
        success: true,
        outputS3Location: {
          bucket: 'test-bucket',
          key: 'conversions/test-job-123.wav',
          size: 2048000
        },
        fallbackUsed: true,
        processingTimeMs: 3000
      }

      vi.spyOn(service as any, 'streamingConvertAudio').mockResolvedValue(mockStreamingResult)
      vi.spyOn(service as any, 'fallbackFileConversion').mockResolvedValue(mockFallbackResult)

      const result = await service.convertAudio(mockJob, mockOptions)

      expect(result.success).toBe(true)
      expect(result.fallbackUsed).toBe(true)
    })
  })

  describe('streaming conversion', () => {
    it('should create proper S3 input stream', async () => {
      const mockBody = new Readable()
      mockS3ClientInstance.send.mockResolvedValue({
        Body: mockBody
      })

      const inputStream = await (service as any).createS3InputStream(mockJob.inputS3Location)

      expect(inputStream).toBe(mockBody)
      expect(mockS3ClientInstance.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: 'test-bucket',
            Key: 'uploads/test-audio.mp3'
          })
        })
      )
    })

    it('should create FFmpeg process with correct arguments', async () => {
      const mockProcess = {
        pid: 12345,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
        killed: false,
        on: vi.fn()
      }

      mockSpawn.mockReturnValue(mockProcess as any)

      // Mock FFmpeg validation
      vi.spyOn(service as any, 'validateFFmpegInstallation').mockResolvedValue(true)

      const process = await (service as any).createFFmpegProcess(
        'test-job-123',
        mockOptions,
        'mp3',
        'wav'
      )

      expect(mockSpawn).toHaveBeenCalledWith('ffmpeg', [
        '-i', 'pipe:0',
        '-f', 'wav',
        '-b:a', '192k',
        '-y',
        'pipe:1'
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      expect(process.pid).toBe(12345)
    })

    it('should handle FFmpeg process timeout', async () => {
      const mockProcess = {
        pid: 12345,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
        killed: false,
        on: vi.fn()
      }

      mockSpawn.mockReturnValue(mockProcess as any)

      // Mock timeout scenario
      vi.useFakeTimers()

      const terminatePromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          service['terminateProcess']('test-job-123', mockProcess as any)
          resolve()
        }, 100)
      })

      vi.advanceTimersByTime(100)
      await terminatePromise

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')

      vi.useRealTimers()
    })

    it('should setup progress monitoring correctly', async () => {
      const mockProcess = {
        pid: 12345,
        stderr: new PassThrough()
      }

      const mockProcessInfo = {
        pid: 12345,
        startTime: Date.now(),
        lastProgressTime: Date.now(),
        isStreaming: true,
        inputFormat: 'mp3',
        outputFormat: 'wav'
      }

      const mockProgressService = await import('./progress-service')
      vi.spyOn(mockProgressService.progressService, 'processFFmpegStderr').mockResolvedValue()

      // Setup progress monitoring
      ;(service as any).setupProgressMonitoring('test-job-123', mockProcess, mockProcessInfo, 1024000)

      // Simulate FFmpeg stderr output
      mockProcess.stderr.emit('data', Buffer.from('Duration: 00:03:45.67\n'))
      mockProcess.stderr.emit('data', Buffer.from('time=00:01:23.45 bitrate=128.0kbits/s speed=2.5x\n'))

      // Allow async processing
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockProgressService.progressService.processFFmpegStderr).toHaveBeenCalledWith(
        'test-job-123',
        'Duration: 00:03:45.67',
        mockProcessInfo,
        1024000
      )

      expect(mockProgressService.progressService.processFFmpegStderr).toHaveBeenCalledWith(
        'test-job-123',
        'time=00:01:23.45 bitrate=128.0kbits/s speed=2.5x',
        mockProcessInfo,
        1024000
      )
    })
  })

  describe('fallback conversion', () => {
    it('should complete fallback conversion successfully', async () => {
      const mockProgressService = await import('./progress-service')
      vi.spyOn(mockProgressService.progressService, 'setProgress').mockResolvedValue()
      vi.spyOn(mockProgressService.progressService, 'markComplete').mockResolvedValue()

      // Use fake timers to speed up the test
      vi.useFakeTimers()

      const conversionPromise = (service as any).fallbackFileConversion(mockJob, mockOptions)

      // Advance timers to simulate processing
      vi.advanceTimersByTime(3000)

      const result = await conversionPromise

      expect(result.success).toBe(true)
      expect(result.fallbackUsed).toBe(true)
      expect(result.outputS3Location).toEqual({
        bucket: 'test-bucket',
        key: 'conversions/test-job-123.wav',
        size: expect.any(Number)
      })

      expect(mockProgressService.progressService.setProgress).toHaveBeenCalledWith('test-job-123', {
        jobId: 'test-job-123',
        progress: 50,
        stage: 'file-based conversion'
      })

      expect(mockProgressService.progressService.markComplete).toHaveBeenCalledWith('test-job-123')

      vi.useRealTimers()
    })
  })

  describe('format compatibility', () => {
    it('should correctly identify streaming-compatible formats', () => {
      const compatibility = (service as any).checkStreamingCompatibility('mp3', 'wav')
      
      // This will depend on the actual implementation in progress-service
      expect(compatibility).toHaveProperty('supportsStreaming')
      expect(compatibility).toHaveProperty('fallbackRecommended')
    })

    it('should extract format from S3 key correctly', () => {
      expect((service as any).extractFormatFromKey('uploads/test.mp3')).toBe('mp3')
      expect((service as any).extractFormatFromKey('uploads/test.WAV')).toBe('wav')
      expect((service as any).extractFormatFromKey('uploads/test')).toBe('unknown')
    })

    it('should get correct content type from key', () => {
      expect((service as any).getContentTypeFromKey('test.mp3')).toBe('audio/mpeg')
      expect((service as any).getContentTypeFromKey('test.wav')).toBe('audio/wav')
      expect((service as any).getContentTypeFromKey('test.unknown')).toBe('application/octet-stream')
    })
  })

  describe('FFmpeg validation', () => {
    it('should validate FFmpeg installation successfully', async () => {
      const mockProcess = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 10) // Simulate successful exit
          }
        }),
        kill: vi.fn()
      }

      mockSpawn.mockReturnValue(mockProcess as any)

      const isValid = await (service as any).validateFFmpegInstallation()

      expect(isValid).toBe(true)
      expect(mockSpawn).toHaveBeenCalledWith('ffmpeg', ['-version'], { stdio: 'pipe' })
    })

    it('should handle FFmpeg validation failure', async () => {
      const mockProcess = {
        on: vi.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Command not found')), 10)
          }
        }),
        kill: vi.fn()
      }

      mockSpawn.mockReturnValue(mockProcess as any)

      const isValid = await (service as any).validateFFmpegInstallation()

      expect(isValid).toBe(false)
    })

    it('should handle FFmpeg validation timeout', async () => {
      const mockProcess = {
        on: vi.fn(),
        kill: vi.fn()
      }

      mockSpawn.mockReturnValue(mockProcess as any)

      vi.useFakeTimers()

      const validationPromise = (service as any).validateFFmpegInstallation()

      // Advance time to trigger timeout
      vi.advanceTimersByTime(5000)

      const isValid = await validationPromise

      expect(isValid).toBe(false)
      expect(mockProcess.kill).toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('process management', () => {
    it('should track active processes', async () => {
      const mockProcess = {
        pid: 12345,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
        killed: false,
        on: vi.fn()
      }

      mockSpawn.mockReturnValue(mockProcess as any)
      vi.spyOn(service as any, 'validateFFmpegInstallation').mockResolvedValue(true)

      await (service as any).createFFmpegProcess('test-job-123', mockOptions, 'mp3', 'wav')

      const activeProcesses = service.getActiveProcesses()
      expect(activeProcesses.has('test-job-123')).toBe(true)
      expect(activeProcesses.get('test-job-123')).toBe(mockProcess)
    })

    it('should cleanup all active processes', async () => {
      const mockProcess1 = {
        pid: 12345,
        kill: vi.fn(),
        killed: false
      }

      const mockProcess2 = {
        pid: 12346,
        kill: vi.fn(),
        killed: false
      }

      // Manually add processes to simulate active conversions
      service['activeProcesses'].set('job-1', mockProcess1 as any)
      service['activeProcesses'].set('job-2', mockProcess2 as any)

      await service.cleanup()

      expect(mockProcess1.kill).toHaveBeenCalledWith('SIGTERM')
      expect(mockProcess2.kill).toHaveBeenCalledWith('SIGTERM')
      expect(service.getActiveProcesses().size).toBe(0)
    })

    it('should terminate process gracefully then forcefully', async () => {
      vi.useFakeTimers()

      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        killed: false
      }

      service['activeProcesses'].set('test-job', mockProcess as any)

      // Start termination
      ;(service as any).terminateProcess('test-job', mockProcess)

      // Should call SIGTERM first
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')

      // Advance time to trigger SIGKILL
      vi.advanceTimersByTime(5000)

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
      expect(service.getActiveProcesses().has('test-job')).toBe(false)

      vi.useRealTimers()
    })
  })

  describe('error handling', () => {
    it('should handle S3 input stream creation failure', async () => {
      mockS3ClientInstance.send.mockRejectedValue(new Error('S3 access denied'))

      await expect((service as any).createS3InputStream(mockJob.inputS3Location))
        .rejects.toThrow('S3 access denied')
    })

    it('should handle missing S3 response body', async () => {
      mockS3ClientInstance.send.mockResolvedValue({
        Body: null
      })

      await expect((service as any).createS3InputStream(mockJob.inputS3Location))
        .rejects.toThrow('Failed to get S3 object: test-bucket/uploads/test-audio.mp3')
    })

    it('should handle FFmpeg process creation failure', async () => {
      mockSpawn.mockReturnValue({
        pid: undefined,
        on: vi.fn(),
        kill: vi.fn()
      } as any)

      vi.spyOn(service as any, 'validateFFmpegInstallation').mockResolvedValue(true)

      await expect((service as any).createFFmpegProcess('test-job', mockOptions, 'mp3', 'wav'))
        .rejects.toThrow('Failed to start FFmpeg process')
    })
  })
})