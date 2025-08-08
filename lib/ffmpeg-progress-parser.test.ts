import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FFmpegProgressParser, FFmpegProcessInfo } from './ffmpeg-progress-parser'

describe('FFmpegProgressParser', () => {
  let parser: FFmpegProgressParser
  let mockProcessInfo: FFmpegProcessInfo

  beforeEach(() => {
    parser = new FFmpegProgressParser()
    mockProcessInfo = {
      pid: 12345,
      startTime: Date.now() - 10000, // Started 10 seconds ago
      lastProgressTime: Date.now() - 5000, // Last progress 5 seconds ago
      isStreaming: true,
      inputFormat: 'mp3',
      outputFormat: 'wav'
    }
  })

  describe('parseStderr', () => {
    it('should extract duration from FFmpeg output', () => {
      const stderrLine = 'Duration: 00:03:45.67, start: 0.000000, bitrate: 128 kb/s'
      const result = parser.parseStderr(stderrLine, mockProcessInfo)

      expect(result).toEqual({
        duration: 225.67 // 3*60 + 45 + 0.67
      })
    })

    it('should extract current time and metrics from progress line', () => {
      const stderrLine = 'frame= 1234 fps=123 q=28.0 size=    1024kB time=00:01:23.45 bitrate= 128.0kbits/s speed=1.5x'
      const result = parser.parseStderr(stderrLine, mockProcessInfo)

      expect(result).toEqual({
        currentTime: 83.45, // 1*60 + 23 + 0.45
        bitrate: '128.0kbits/s',
        speed: '1.5x',
        size: '1024kB',
        fps: 123
      })
    })

    it('should handle edge cases in time parsing', () => {
      const testCases = [
        { input: 'time=00:00:00.00', expected: 0 },
        { input: 'time=23:59:59.99', expected: 86399.99 },
        { input: 'time=01:30:45.50', expected: 5445.5 }
      ]

      testCases.forEach(({ input, expected }) => {
        const result = parser.parseStderr(input, mockProcessInfo)
        expect(result?.currentTime).toBeCloseTo(expected, 2)
      })
    })

    it('should return null for irrelevant stderr lines', () => {
      const irrelevantLines = [
        '',
        'Input #0, mp3, from \'pipe:0\':',
        'Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s',
        'Output #0, wav, to \'pipe:1\':',
        'Stream mapping:'
      ]

      irrelevantLines.forEach(line => {
        const result = parser.parseStderr(line, mockProcessInfo)
        expect(result).toBeNull()
      })
    })

    it('should detect error lines', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      const errorLines = [
        'Error opening input file',
        'Failed to initialize encoder',
        'Conversion failed with error code 1'
      ]

      errorLines.forEach(line => {
        parser.parseStderr(line, mockProcessInfo)
      })

      expect(consoleSpy).toHaveBeenCalledTimes(3)
      consoleSpy.mockRestore()
    })
  })

  describe('calculateProgress', () => {
    it('should calculate progress with known duration', () => {
      const progressInfo = {
        duration: 100,
        currentTime: 25,
        bitrate: '128kbits/s',
        speed: '1.0x'
      }

      const result = parser.calculateProgress(progressInfo, mockProcessInfo)

      expect(result.progress).toBe(25)
      expect(result.stage).toBe('processing')
      expect(result.currentTime).toBe('00:00:25.00')
      expect(result.totalDuration).toBe('00:01:40.00')
      expect(result.estimatedTimeRemaining).toBeGreaterThan(0)
    })

    it('should handle streaming fallback with file size estimation', () => {
      const progressInfo = {
        currentTime: 30
      }
      const streamingProcessInfo = {
        ...mockProcessInfo,
        isStreaming: true,
        inputFormat: 'mp3'
      }
      const fallbackFileSize = 1024 * 1024 // 1MB

      const result = parser.calculateProgress(progressInfo, streamingProcessInfo, fallbackFileSize)

      expect(result.progress).toBeGreaterThan(0)
      expect(result.progress).toBeLessThanOrEqual(95) // Capped at 95% for estimation
      expect(result.stage).toBe('processing')
      expect(streamingProcessInfo.estimatedDuration).toBeGreaterThan(0)
    })

    it('should use estimated duration fallback', () => {
      const progressInfo = {
        currentTime: 50
      }
      const processInfoWithEstimate = {
        ...mockProcessInfo,
        estimatedDuration: 200
      }

      const result = parser.calculateProgress(progressInfo, processInfoWithEstimate)

      expect(result.progress).toBe(25) // 50/200 * 100
      expect(result.progress).toBeLessThanOrEqual(95)
    })

    it('should use processing time heuristic as last resort', () => {
      const progressInfo = {
        currentTime: 10
      }
      const longRunningProcess = {
        ...mockProcessInfo,
        startTime: Date.now() - 15000 // 15 seconds ago
      }

      const result = parser.calculateProgress(progressInfo, longRunningProcess)

      expect(result.progress).toBeGreaterThan(0)
      expect(result.stage).toBe('processing (estimating)')
    })

    it('should handle zero progress gracefully', () => {
      const progressInfo = {}

      const result = parser.calculateProgress(progressInfo, mockProcessInfo)

      expect(result.progress).toBe(0)
      expect(result.stage).toBe('processing')
    })

    it('should cap progress at 100%', () => {
      const progressInfo = {
        duration: 100,
        currentTime: 150 // More than duration
      }

      const result = parser.calculateProgress(progressInfo, mockProcessInfo)

      expect(result.progress).toBe(100)
    })
  })

  describe('checkStreamingCompatibility', () => {
    it('should allow streaming for compatible formats', () => {
      const result = parser.checkStreamingCompatibility('mp3', 'wav')

      expect(result.supportsStreaming).toBe(true)
      expect(result.fallbackRecommended).toBe(false)
    })

    it('should reject streaming for incompatible formats', () => {
      const result = parser.checkStreamingCompatibility('flac', 'wav')

      expect(result.supportsStreaming).toBe(false)
      expect(result.reason).toContain('requires file access')
      expect(result.fallbackRecommended).toBe(true)
    })

    it('should reject streaming for high complexity conversions', () => {
      const result = parser.checkStreamingCompatibility('wav', 'flac')

      expect(result.supportsStreaming).toBe(false)
      expect(result.reason).toContain('requires file access')
      expect(result.fallbackRecommended).toBe(true)
    })

    it('should handle unknown formats', () => {
      const result = parser.checkStreamingCompatibility('unknown', 'wav')

      expect(result.supportsStreaming).toBe(false)
      expect(result.reason).toContain('Unknown format')
      expect(result.fallbackRecommended).toBe(true)
    })
  })

  describe('detectTimeout', () => {
    it('should detect total time timeout', () => {
      const timedOutProcess = {
        ...mockProcessInfo,
        startTime: Date.now() - 400000, // 400 seconds ago (> 300s timeout)
        lastProgressTime: Date.now() - 1000
      }

      const result = parser.detectTimeout(timedOutProcess)

      expect(result).toBe(true)
    })

    it('should detect progress stall timeout', () => {
      const stalledProcess = {
        ...mockProcessInfo,
        startTime: Date.now() - 60000, // 60 seconds ago
        lastProgressTime: Date.now() - 70000 // No progress for 70 seconds
      }

      const result = parser.detectTimeout(stalledProcess)

      expect(result).toBe(true)
    })

    it('should not timeout for active processes', () => {
      const activeProcess = {
        ...mockProcessInfo,
        startTime: Date.now() - 30000, // 30 seconds ago
        lastProgressTime: Date.now() - 1000 // Progress 1 second ago
      }

      const result = parser.detectTimeout(activeProcess)

      expect(result).toBe(false)
    })
  })

  describe('shouldUpdateProgress', () => {
    it('should allow update after sufficient time', () => {
      const processInfo = {
        ...mockProcessInfo,
        lastProgressTime: Date.now() - 1000 // 1 second ago
      }

      const result = parser.shouldUpdateProgress(processInfo)

      expect(result).toBe(true)
    })

    it('should throttle frequent updates', () => {
      const processInfo = {
        ...mockProcessInfo,
        lastProgressTime: Date.now() - 50 // 50ms ago (less than 100ms threshold)
      }

      const result = parser.shouldUpdateProgress(processInfo)

      expect(result).toBe(false)
    })
  })

  describe('format compatibility', () => {
    it('should return compatibility info for known formats', () => {
      const mp3Compat = parser.getFormatCompatibility('mp3')

      expect(mp3Compat).toEqual({
        format: 'mp3',
        supportsStreaming: true,
        requiresFileAccess: false,
        estimatedComplexity: 'low'
      })
    })

    it('should return null for unknown formats', () => {
      const result = parser.getFormatCompatibility('unknown')

      expect(result).toBeNull()
    })

    it('should return all supported formats', () => {
      const formats = parser.getSupportedFormats()

      expect(formats).toHaveLength(7)
      expect(formats.map(f => f.format)).toContain('mp3')
      expect(formats.map(f => f.format)).toContain('wav')
      expect(formats.map(f => f.format)).toContain('flac')
    })
  })

  describe('streaming scenarios', () => {
    it('should handle streaming conversion with unknown duration', () => {
      const stderrLines = [
        'Input #0, mp3, from \'pipe:0\':',
        '  Duration: N/A, bitrate: N/A',
        'Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp',
        'Output #0, wav, to \'pipe:1\':',
        'Stream mapping:',
        'frame=    0 fps=0.0 q=0.0 size=       0kB time=00:00:00.00 bitrate=N/A speed=   0x',
        'frame=  441 fps=0.0 q=-0.0 size=    3528kB time=00:00:10.00 bitrate=2822.4kbits/s speed=20.1x',
        'frame=  882 fps=881 q=-0.0 size=    7056kB time=00:00:20.00 bitrate=2822.4kbits/s speed=20.0x',
        'frame= 1323 fps=881 q=-0.0 size=   10584kB time=00:00:30.00 bitrate=2822.4kbits/s speed=20.0x'
      ]

      const streamingProcess: FFmpegProcessInfo = {
        startTime: Date.now(),
        lastProgressTime: Date.now(),
        isStreaming: true,
        inputFormat: 'mp3',
        outputFormat: 'wav'
      }

      let lastProgress = 0
      stderrLines.forEach(line => {
        const progressInfo = parser.parseStderr(line, streamingProcess)
        if (progressInfo && progressInfo.currentTime !== undefined) {
          const result = parser.calculateProgress(progressInfo, streamingProcess, 5 * 1024 * 1024) // 5MB file
          expect(result.progress).toBeGreaterThanOrEqual(lastProgress)
          lastProgress = result.progress
        }
      })

      expect(lastProgress).toBeGreaterThan(0)
    })

    it('should handle file-based conversion with known duration', () => {
      const stderrLines = [
        'Input #0, mp3, from \'input.mp3\':',
        '  Duration: 00:03:30.00, start: 0.000000, bitrate: 128 kb/s',
        'Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s',
        'Output #0, wav, to \'output.wav\':',
        'frame=    0 fps=0.0 q=0.0 size=       0kB time=00:00:00.00 bitrate=N/A speed=   0x',
        'frame=  441 fps=0.0 q=-0.0 size=    3528kB time=00:00:10.00 bitrate=2822.4kbits/s speed=20.1x',
        'frame= 4410 fps=2204 q=-0.0 size=   35280kB time=00:01:40.00 bitrate=2822.4kbits/s speed=20.0x',
        'frame= 9261 fps=3087 q=-0.0 size=   74088kB time=00:03:30.00 bitrate=2822.4kbits/s speed=20.0x'
      ]

      const fileProcess: FFmpegProcessInfo = {
        startTime: Date.now(),
        lastProgressTime: Date.now(),
        isStreaming: false,
        inputFormat: 'mp3',
        outputFormat: 'wav'
      }

      let duration: number | undefined
      let finalProgress = 0

      stderrLines.forEach(line => {
        const progressInfo = parser.parseStderr(line, fileProcess)
        if (progressInfo) {
          if (progressInfo.duration) {
            duration = progressInfo.duration
          }
          if (progressInfo.currentTime !== undefined) {
            // Create a combined progress info with both duration and current time
            const combinedProgressInfo = {
              ...progressInfo,
              duration: duration || progressInfo.duration
            }
            const result = parser.calculateProgress(combinedProgressInfo, fileProcess)
            finalProgress = result.progress
          }
        }
      })

      expect(duration).toBe(210) // 3:30 = 210 seconds
      expect(finalProgress).toBe(100)
    })

    it('should handle FFmpeg process failures', () => {
      const errorLines = [
        'Input #0, mp3, from \'pipe:0\':',
        'pipe:0: Invalid data found when processing input',
        'Error opening input stream'
      ]

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      errorLines.forEach(line => {
        parser.parseStderr(line, mockProcessInfo)
      })

      expect(consoleSpy).toHaveBeenCalledTimes(1) // Should detect 1 error line (only "Error opening input stream" contains "error")
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FFmpegProgressParser] Detected error in stderr:')
      )

      consoleSpy.mockRestore()
    })
  })

  describe('time formatting', () => {
    it('should format seconds to time string correctly', () => {
      // Access private method through type assertion for testing
      const formatMethod = (parser as any).formatSecondsToTime.bind(parser)

      expect(formatMethod(0)).toBe('00:00:00.00')
      expect(formatMethod(61.5)).toBe('00:01:01.50')
      expect(formatMethod(3661.25)).toBe('01:01:01.25')
      expect(formatMethod(86399.99)).toBe('23:59:59.99')
    })

    it('should parse time strings to seconds correctly', () => {
      // Access private method through type assertion for testing
      const parseMethod = (parser as any).parseTimeToSeconds.bind(parser)

      expect(parseMethod('00', '00', '00', '00')).toBe(0)
      expect(parseMethod('00', '01', '01', '50')).toBe(61.5)
      expect(parseMethod('01', '01', '01', '25')).toBe(3661.25)
      expect(parseMethod('23', '59', '59', '99')).toBe(86399.99)
    })
  })

  describe('file size estimation', () => {
    it('should estimate duration from file size', () => {
      // Access private method through type assertion for testing
      const estimateMethod = (parser as any).estimateDurationFromFileSize.bind(parser)

      // 1MB MP3 file at 128kbps should be roughly 65.5 seconds
      const mp3Duration = estimateMethod(1024 * 1024, 'mp3')
      expect(mp3Duration).toBeCloseTo(65.5, 1)

      // 1MB WAV file at 1411kbps should be roughly 5.8 seconds
      const wavDuration = estimateMethod(1024 * 1024, 'wav')
      expect(wavDuration).toBeCloseTo(5.8, 0)

      // Unknown format should default to MP3 estimation
      const unknownDuration = estimateMethod(1024 * 1024, 'unknown')
      expect(unknownDuration).toBeCloseTo(65.5, 1)
    })
  })
})