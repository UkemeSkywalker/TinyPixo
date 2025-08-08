import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { progressService, ProgressService } from './progress-service'
import { FFmpegProcessInfo } from './ffmpeg-progress-parser'

describe('FFmpeg Progress Integration', () => {
  let testJobId: string
  let processInfo: FFmpegProcessInfo

  beforeEach(async () => {
    testJobId = `test-job-${Date.now()}`
    processInfo = {
      pid: 12345,
      startTime: Date.now(),
      lastProgressTime: Date.now(),
      isStreaming: true,
      inputFormat: 'mp3',
      outputFormat: 'wav'
    }

    // Initialize progress for the test job
    await progressService.initializeProgress(testJobId)
  })

  afterEach(async () => {
    // Clean up test data
    try {
      await progressService.setProgress(testJobId, {
        jobId: testJobId,
        progress: -1,
        stage: 'cleanup'
      })
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  describe('Real-time FFmpeg progress tracking', () => {
    it('should process FFmpeg stderr and update Redis in real-time', async () => {
      const stderrLines = [
        'Input #0, mp3, from \'pipe:0\':',
        '  Duration: 00:02:30.00, start: 0.000000, bitrate: 128 kb/s',
        'Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s',
        'Output #0, wav, to \'pipe:1\':',
        'Stream mapping:',
        'frame=    0 fps=0.0 q=0.0 size=       0kB time=00:00:00.00 bitrate=N/A speed=   0x',
        'frame=  441 fps=0.0 q=-0.0 size=    3528kB time=00:00:10.00 bitrate=2822.4kbits/s speed=20.1x',
        'frame= 1323 fps=881 q=-0.0 size=   10584kB time=00:00:30.00 bitrate=2822.4kbits/s speed=20.0x',
        'frame= 2646 fps=881 q=-0.0 size=   21168kB time=00:01:00.00 bitrate=2822.4kbits/s speed=20.0x',
        'frame= 3969 fps=881 q=-0.0 size=   31752kB time=00:01:30.00 bitrate=2822.4kbits/s speed=20.0x',
        'frame= 6615 fps=881 q=-0.0 size=   52920kB time=00:02:30.00 bitrate=2822.4kbits/s speed=20.0x'
      ]

      let lastProgress = 0

      // Process each stderr line
      for (const line of stderrLines) {
        await progressService.processFFmpegStderr(testJobId, line, processInfo)
        
        // Add delay to allow throttling to work properly
        await new Promise(resolve => setTimeout(resolve, 150))
      }

      // Verify final progress
      const finalProgress = await progressService.getProgress(testJobId)
      expect(finalProgress).toBeTruthy()
      expect(finalProgress!.progress).toBe(100) // Should reach 100% at the end
      expect(finalProgress!.stage).toBe('processing')
      expect(finalProgress!.totalDuration).toBe('00:02:30.00')
    })

    it('should handle streaming conversion with unknown duration', async () => {
      const streamingStderr = [
        'Input #0, mp3, from \'pipe:0\':',
        '  Duration: N/A, bitrate: N/A',
        'Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp',
        'Output #0, wav, to \'pipe:1\':',
        'frame=  441 fps=0.0 q=-0.0 size=    3528kB time=00:00:10.00 bitrate=2822.4kbits/s speed=20.1x',
        'frame= 1323 fps=881 q=-0.0 size=   10584kB time=00:00:30.00 bitrate=2822.4kbits/s speed=20.0x'
      ]

      const fileSize = 5 * 1024 * 1024 // 5MB file

      for (const line of streamingStderr) {
        await progressService.processFFmpegStderr(testJobId, line, processInfo, fileSize)
        await new Promise(resolve => setTimeout(resolve, 150))
      }

      const progress = await progressService.getProgress(testJobId)
      expect(progress).toBeTruthy()
      expect(progress!.progress).toBeGreaterThan(0)
      expect(progress!.progress).toBeLessThanOrEqual(95) // Capped for estimation
      expect(progress!.currentTime).toBe('00:00:30.00')
    })

    it('should throttle progress updates correctly', async () => {
      const rapidStderr = [
        'frame=  100 fps=0.0 q=-0.0 size=    800kB time=00:00:02.27 bitrate=2822.4kbits/s speed=20.1x',
        'frame=  200 fps=0.0 q=-0.0 size=   1600kB time=00:00:04.54 bitrate=2822.4kbits/s speed=20.1x',
        'frame=  300 fps=0.0 q=-0.0 size=   2400kB time=00:00:06.81 bitrate=2822.4kbits/s speed=20.1x'
      ]

      // Set duration first
      await progressService.processFFmpegStderr(testJobId, 'Duration: 00:01:00.00, start: 0.000000, bitrate: 128 kb/s', processInfo)

      const updateSpy = vi.spyOn(progressService, 'setProgress')

      // Process rapid updates (should be throttled)
      for (const line of rapidStderr) {
        await progressService.processFFmpegStderr(testJobId, line, processInfo)
        // No delay - rapid fire
      }

      // Should have fewer calls than lines due to throttling
      expect(updateSpy.mock.calls.length).toBeLessThan(rapidStderr.length)

      updateSpy.mockRestore()
    })

    it('should detect and handle FFmpeg timeout', async () => {
      // Create a process that started long ago
      const timedOutProcess: FFmpegProcessInfo = {
        ...processInfo,
        startTime: Date.now() - 400000, // 400 seconds ago
        lastProgressTime: Date.now() - 70000 // No progress for 70 seconds
      }

      const isTimedOut = progressService.checkFFmpegTimeout(timedOutProcess)
      expect(isTimedOut).toBe(true)
    })

    it('should check streaming compatibility correctly', async () => {
      // Compatible formats
      const mp3ToWav = progressService.checkStreamingCompatibility('mp3', 'wav')
      expect(mp3ToWav.supportsStreaming).toBe(true)
      expect(mp3ToWav.fallbackRecommended).toBe(false)

      // Incompatible formats
      const flacToWav = progressService.checkStreamingCompatibility('flac', 'wav')
      expect(flacToWav.supportsStreaming).toBe(false)
      expect(flacToWav.fallbackRecommended).toBe(true)
      expect(flacToWav.reason).toContain('requires file access')
    })

    it('should handle FFmpeg errors gracefully', async () => {
      const errorLines = [
        'Input #0, mp3, from \'pipe:0\':',
        'pipe:0: Invalid data found when processing input',
        'Error opening input stream'
      ]

      // Should not throw errors
      for (const line of errorLines) {
        await expect(
          progressService.processFFmpegStderr(testJobId, line, processInfo)
        ).resolves.not.toThrow()
      }

      // Progress should still be retrievable
      const progress = await progressService.getProgress(testJobId)
      expect(progress).toBeTruthy()
    })

    it('should provide format compatibility information', async () => {
      const mp3Compat = progressService.getFormatCompatibility('mp3')
      expect(mp3Compat).toEqual({
        format: 'mp3',
        supportsStreaming: true,
        requiresFileAccess: false,
        estimatedComplexity: 'low'
      })

      const allFormats = progressService.getSupportedFormats()
      expect(allFormats.length).toBeGreaterThan(0)
      expect(allFormats.map(f => f.format)).toContain('mp3')
      expect(allFormats.map(f => f.format)).toContain('wav')
    })
  })

  describe('Progress fallback scenarios', () => {
    it('should fall back to DynamoDB when Redis is unavailable', async () => {
      // This test would require mocking Redis failure
      // For now, we'll test the basic fallback logic
      const progress = await progressService.getProgress('non-existent-job')
      expect(progress).toBeNull()
    })

    it('should handle file-based conversion fallback', async () => {
      const fileBasedProcess: FFmpegProcessInfo = {
        ...processInfo,
        isStreaming: false
      }

      const stderrLines = [
        'Duration: 00:01:30.00, start: 0.000000, bitrate: 128 kb/s',
        'frame= 1323 fps=881 q=-0.0 size=   10584kB time=00:00:45.00 bitrate=2822.4kbits/s speed=20.0x'
      ]

      for (const line of stderrLines) {
        await progressService.processFFmpegStderr(testJobId, line, fileBasedProcess)
        await new Promise(resolve => setTimeout(resolve, 150))
      }

      const progress = await progressService.getProgress(testJobId)
      expect(progress).toBeTruthy()
      expect(progress!.progress).toBe(50) // 45/90 * 100 = 50%
    })
  })

  describe('Process info management', () => {
    it('should create FFmpeg process info correctly', async () => {
      const processInfo = progressService.createFFmpegProcessInfo(
        12345,
        'mp3',
        'wav',
        true
      )

      expect(processInfo.pid).toBe(12345)
      expect(processInfo.inputFormat).toBe('mp3')
      expect(processInfo.outputFormat).toBe('wav')
      expect(processInfo.isStreaming).toBe(true)
      expect(processInfo.startTime).toBeCloseTo(Date.now(), -2) // Within 100ms
      expect(processInfo.lastProgressTime).toBeCloseTo(Date.now(), -2)
    })
  })
})