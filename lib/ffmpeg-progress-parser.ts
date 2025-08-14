import { ProgressData } from './progress-service'

export interface FFmpegProgressInfo {
  duration?: number // Total duration in seconds
  currentTime?: number // Current time in seconds
  progress?: number // Progress percentage (0-100)
  bitrate?: string // Current bitrate
  speed?: string // Processing speed
  size?: string // Output size
  fps?: number // Frames per second (for video)
}

export interface FormatCompatibility {
  format: string
  supportsStreaming: boolean
  requiresFileAccess: boolean
  estimatedComplexity: 'low' | 'medium' | 'high'
}

export interface FFmpegProcessInfo {
  pid?: number
  startTime: number
  lastProgressTime: number
  isStreaming: boolean
  inputFormat?: string
  outputFormat?: string
  estimatedDuration?: number
  fileSize?: number
}

export class FFmpegProgressParser {
  private readonly TIMEOUT_MS = 300000 // 5 minutes
  private readonly PROGRESS_UPDATE_INTERVAL_MS = 50 // 50ms minimum between updates for more responsive progress
  private readonly TIME_REGEX = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/
  private readonly DURATION_REGEX = /Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/
  private readonly BITRATE_REGEX = /bitrate=\s*([0-9.]+[kmg]?bits\/s)/i
  private readonly SPEED_REGEX = /speed=\s*([0-9.]+x)/i
  private readonly SIZE_REGEX = /size=\s*([0-9]+[kmg]?B)/i
  private readonly FPS_REGEX = /fps=\s*([0-9.]+)/i

  // Format compatibility matrix for streaming vs file-based processing
  private readonly FORMAT_COMPATIBILITY: Record<string, FormatCompatibility> = {
    'mp3': {
      format: 'mp3',
      supportsStreaming: true,
      requiresFileAccess: false,
      estimatedComplexity: 'low'
    },
    'wav': {
      format: 'wav',
      supportsStreaming: true,
      requiresFileAccess: false,
      estimatedComplexity: 'low'
    },
    'aac': {
      format: 'aac',
      supportsStreaming: true,
      requiresFileAccess: false,
      estimatedComplexity: 'medium'
    },
    'ogg': {
      format: 'ogg',
      supportsStreaming: true,
      requiresFileAccess: false,
      estimatedComplexity: 'medium'
    },
    'flac': {
      format: 'flac',
      supportsStreaming: false, // FLAC often requires seeking for optimal compression
      requiresFileAccess: true,
      estimatedComplexity: 'high'
    },
    'm4a': {
      format: 'm4a',
      supportsStreaming: false, // M4A container requires file access for metadata
      requiresFileAccess: true,
      estimatedComplexity: 'medium'
    },
    'wma': {
      format: 'wma',
      supportsStreaming: false, // WMA has complex container requirements
      requiresFileAccess: true,
      estimatedComplexity: 'high'
    }
  }

  /**
   * Parse FFmpeg stderr output and extract progress information
   */
  parseStderr(stderrLine: string, processInfo: FFmpegProcessInfo): FFmpegProgressInfo | null {
    const line = stderrLine.trim()
    
    if (!line) {
      return null
    }

    console.log(`[FFmpegProgressParser] Parsing stderr: ${line}`)

    const progressInfo: FFmpegProgressInfo = {}

    // Extract duration (usually appears early in the output)
    const durationMatch = line.match(this.DURATION_REGEX)
    if (durationMatch) {
      const duration = this.parseTimeToSeconds(durationMatch[1], durationMatch[2], durationMatch[3], durationMatch[4])
      progressInfo.duration = duration
      
      // IMPORTANT: Store the real duration in processInfo so it persists across calls
      processInfo.estimatedDuration = duration
      
      console.log(`[FFmpegProgressParser] Extracted REAL duration: ${duration} seconds (${durationMatch[0]}) - updating processInfo`)
      return progressInfo
    }

    // Extract current time and other progress metrics
    const timeMatch = line.match(this.TIME_REGEX)
    if (timeMatch) {
      const currentTime = this.parseTimeToSeconds(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4])
      progressInfo.currentTime = currentTime

      // Extract additional metrics from the same line
      const bitrateMatch = line.match(this.BITRATE_REGEX)
      if (bitrateMatch) {
        progressInfo.bitrate = bitrateMatch[1]
      }

      const speedMatch = line.match(this.SPEED_REGEX)
      if (speedMatch) {
        progressInfo.speed = speedMatch[1]
      }

      const sizeMatch = line.match(this.SIZE_REGEX)
      if (sizeMatch) {
        progressInfo.size = sizeMatch[1]
      }

      const fpsMatch = line.match(this.FPS_REGEX)
      if (fpsMatch) {
        progressInfo.fps = parseFloat(fpsMatch[1])
      }

      console.log(`[FFmpegProgressParser] Extracted progress metrics: time=${currentTime}s, bitrate=${progressInfo.bitrate}, speed=${progressInfo.speed}`)
      return progressInfo
    }

    // Look for error indicators
    if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) {
      console.warn(`[FFmpegProgressParser] Detected error in stderr: ${line}`)
    }

    return null
  }

  /**
   * Calculate progress percentage with fallback strategies
   */
  calculateProgress(
    progressInfo: FFmpegProgressInfo,
    processInfo: FFmpegProcessInfo,
    fallbackFileSize?: number
  ): ProgressData {
    const jobId = `process-${processInfo.pid || Date.now()}`
    let progress = 0
    let stage = 'processing'
    let estimatedTimeRemaining: number | undefined

    // Prioritize real duration from FFmpeg output, fallback to estimated
    const duration = progressInfo.duration || processInfo.estimatedDuration
    const currentTime = progressInfo.currentTime

    // Primary method: Use duration-based calculation
    if (duration && currentTime !== undefined) {
      if (currentTime > duration) {
        // If current time exceeds estimated duration, this means the initial duration estimate was wrong
        // This commonly happens with large files or files with variable bitrates
        // We need to dynamically adjust our understanding of the total duration
        
        const overage = currentTime - duration
        const overageRatio = overage / duration
        
        // For significant overages (>10%), assume the file is much longer than estimated
        if (overageRatio > 0.1) {
          // Use a more aggressive adjustment - assume the file could be up to 2x longer
          const adjustedDuration = Math.max(currentTime * 1.1, duration * 1.5)
          progress = Math.min((currentTime / adjustedDuration) * 100, 95) // Cap at 95% for dynamic estimation
          stage = 'processing (duration longer than estimated)'
          
          console.log(`[FFmpegProgressParser] Large duration overage detected (${overageRatio.toFixed(1)}x), using dynamic estimation`)
          console.log(`[FFmpegProgressParser] Adjusted progress: ${progress.toFixed(1)}% (${currentTime}s / ~${adjustedDuration.toFixed(1)}s estimated)`)
        } else {
          // Small overage, use conservative adjustment
          const adjustedDuration = duration + (overage * 0.8)
          progress = Math.min((currentTime / adjustedDuration) * 100, 98)
          
          console.log(`[FFmpegProgressParser] Small duration overage, adjusting: ${progress.toFixed(1)}% (${currentTime}/${duration}s, adjusted: ${adjustedDuration.toFixed(1)}s)`)
        }
      } else {
        // Normal case: current time is within estimated duration
        const rawProgress = (currentTime / duration) * 100
        
        if (rawProgress >= 99.5) {
          // Very close to completion - show finalization stage
          progress = 99
          stage = 'finalizing conversion'
          console.log(`[FFmpegProgressParser] 🔄 FINALIZATION PHASE: ${currentTime}s / ${duration}s (${rawProgress.toFixed(1)}%)`)
        } else {
          // Normal progress
          progress = Math.min(rawProgress, 98) // Cap at 98% until very close to end
        }
        
        const durationType = progressInfo.duration ? "REAL" : "ESTIMATED"
        console.log(`[FFmpegProgressParser] Duration-based progress: ${progress.toFixed(1)}% (${currentTime}/${duration}s) [${durationType}]`)
      }
      
      // Estimate remaining time based on processing speed
      if (currentTime > 0) {
        const elapsedTime = (Date.now() - processInfo.startTime) / 1000
        const processingRate = currentTime / elapsedTime
        
        // Check if processing is taking much longer than expected
        if (elapsedTime > duration * 2) {
          console.log(`[FFmpegProgressParser] ⚠️  Long processing detected: ${elapsedTime.toFixed(0)}s elapsed for ${duration}s file`)
          stage = 'processing large file (taking longer than expected)'
        }
        
        const remainingTime = Math.max(duration - currentTime, 0)
        if (remainingTime > 0 && currentTime <= duration) {
          estimatedTimeRemaining = Math.ceil(remainingTime / processingRate)
        } else {
          estimatedTimeRemaining = -1 // Indicate unknown remaining time for overages
        }
      }
    }
    // Fallback 1: Use file size estimation for streaming
    else if (processInfo.isStreaming && fallbackFileSize && currentTime) {
      // Estimate progress based on processing time and typical audio duration/size ratios
      // This is a rough estimation for streaming scenarios where duration is unknown
      const estimatedDurationFromSize = this.estimateDurationFromFileSize(fallbackFileSize, processInfo.inputFormat)
      if (estimatedDurationFromSize > 0) {
        progress = Math.min((currentTime / estimatedDurationFromSize) * 100, 95) // Cap at 95% for estimation
        processInfo.estimatedDuration = estimatedDurationFromSize
        
        console.log(`[FFmpegProgressParser] File-size-based progress estimation: ${progress.toFixed(1)}% (estimated duration: ${estimatedDurationFromSize}s)`)
      }
    }
    // Fallback 2: Time-based estimation for unknown duration
    else if (currentTime && processInfo.estimatedDuration) {
      progress = Math.min((currentTime / processInfo.estimatedDuration) * 100, 95)
      console.log(`[FFmpegProgressParser] Time-based progress estimation: ${progress.toFixed(1)}%`)
    }
    // Fallback 3: Processing time heuristic
    else if (currentTime) {
      // For very short files or when duration is unknown, use processing time as a rough indicator
      const processingTime = (Date.now() - processInfo.startTime) / 1000
      if (processingTime > 5) { // After 5 seconds of processing
        progress = Math.min(processingTime * 10, 90) // Rough heuristic, cap at 90%
        stage = 'processing (estimating)'
        console.log(`[FFmpegProgressParser] Processing-time-based estimation: ${progress.toFixed(1)}%`)
      }
    }

    // Update process info
    processInfo.lastProgressTime = Date.now()

    return {
      jobId,
      progress: Math.round(progress * 100) / 100, // Round to 2 decimal places
      stage,
      phase: 'conversion', // FFmpeg progress is always in conversion phase
      estimatedTimeRemaining,
      currentTime: currentTime ? this.formatSecondsToTime(currentTime) : undefined,
      totalDuration: duration ? this.formatSecondsToTime(duration) : undefined,
      ttl: Math.floor(Date.now() / 1000) + 3600, // 1 hour TTL
      updatedAt: Date.now()
    }
  }

  /**
   * Check if a format supports streaming conversion
   */
  checkStreamingCompatibility(inputFormat: string, outputFormat: string): {
    supportsStreaming: boolean
    reason?: string
    fallbackRecommended: boolean
  } {
    const inputCompat = this.FORMAT_COMPATIBILITY[inputFormat.toLowerCase()]
    const outputCompat = this.FORMAT_COMPATIBILITY[outputFormat.toLowerCase()]

    if (!inputCompat || !outputCompat) {
      return {
        supportsStreaming: false,
        reason: `Unknown format compatibility: ${inputFormat} -> ${outputFormat}`,
        fallbackRecommended: true
      }
    }

    if (!inputCompat.supportsStreaming || !outputCompat.supportsStreaming) {
      return {
        supportsStreaming: false,
        reason: `Format requires file access: ${!inputCompat.supportsStreaming ? inputFormat : outputFormat}`,
        fallbackRecommended: true
      }
    }

    if (inputCompat.estimatedComplexity === 'high' || outputCompat.estimatedComplexity === 'high') {
      return {
        supportsStreaming: false,
        reason: 'High complexity conversion may require multiple passes',
        fallbackRecommended: true
      }
    }

    return {
      supportsStreaming: true,
      fallbackRecommended: false
    }
  }

  /**
   * Detect if FFmpeg process has timed out
   */
  detectTimeout(processInfo: FFmpegProcessInfo): boolean {
    const now = Date.now()
    const totalElapsed = now - processInfo.startTime
    const timeSinceLastProgress = now - processInfo.lastProgressTime

    // Timeout if total time exceeds limit OR no progress for extended period
    const hasTimedOut = totalElapsed > this.TIMEOUT_MS || 
                       (timeSinceLastProgress > 60000 && totalElapsed > 30000) // No progress for 1 min after 30s

    if (hasTimedOut) {
      console.warn(`[FFmpegProgressParser] Process timeout detected: total=${totalElapsed}ms, since_progress=${timeSinceLastProgress}ms`)
    }

    return hasTimedOut
  }

  /**
   * Check if enough time has passed for a progress update
   */
  shouldUpdateProgress(processInfo: FFmpegProcessInfo): boolean {
    const timeSinceLastUpdate = Date.now() - processInfo.lastProgressTime
    return timeSinceLastUpdate >= this.PROGRESS_UPDATE_INTERVAL_MS
  }

  /**
   * Parse time string (HH:MM:SS.ms) to seconds
   */
  private parseTimeToSeconds(hours: string, minutes: string, seconds: string, centiseconds: string): number {
    const h = parseInt(hours, 10) || 0
    const m = parseInt(minutes, 10) || 0
    const s = parseInt(seconds, 10) || 0
    const cs = parseInt(centiseconds, 10) || 0
    
    return h * 3600 + m * 60 + s + cs / 100
  }

  /**
   * Format seconds back to HH:MM:SS.ms string
   */
  private formatSecondsToTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = Math.floor(totalSeconds % 60)
    const centiseconds = Math.floor((totalSeconds % 1) * 100)

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`
  }

  /**
   * Estimate audio duration from file size (rough heuristic)
   */
  private estimateDurationFromFileSize(fileSizeBytes: number, format?: string): number {
    // Rough estimates based on typical bitrates for different formats
    const typicalBitrates = {
      'mp3': 128000, // 128 kbps
      'wav': 1411200, // 1411 kbps (CD quality)
      'aac': 128000, // 128 kbps
      'ogg': 128000, // 128 kbps
      'flac': 700000, // ~700 kbps (variable)
      'm4a': 128000, // 128 kbps
    }

    const bitrate = typicalBitrates[format?.toLowerCase() || 'mp3'] || 128000
    const estimatedSeconds = (fileSizeBytes * 8) / bitrate

    console.log(`[FFmpegProgressParser] Estimated duration from file size: ${estimatedSeconds}s (${fileSizeBytes} bytes, ${bitrate} bps)`)
    
    return Math.max(estimatedSeconds, 1) // Minimum 1 second
  }

  /**
   * Get format compatibility information
   */
  getFormatCompatibility(format: string): FormatCompatibility | null {
    return this.FORMAT_COMPATIBILITY[format.toLowerCase()] || null
  }

  /**
   * Get all supported formats
   */
  getSupportedFormats(): FormatCompatibility[] {
    return Object.values(this.FORMAT_COMPATIBILITY)
  }
}

// Export singleton instance
export const ffmpegProgressParser = new FFmpegProgressParser()