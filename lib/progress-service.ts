import { RedisClientType } from 'redis'
import { getRedisClient } from './aws-services'
import { jobService, Job } from './job-service'
import { ffmpegProgressParser, FFmpegProcessInfo, FFmpegProgressInfo } from './ffmpeg-progress-parser'

export interface ProgressData {
  jobId: string
  progress: number // 0-100
  stage: string
  estimatedTimeRemaining?: number
  error?: string
  startTime?: number
  currentTime?: string
  totalDuration?: string
}

interface RetryConfig {
  maxRetries: number
  baseDelay: number
  maxDelay: number
  backoffMultiplier: number
}

const REDIS_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 500,
  maxDelay: 5000,
  backoffMultiplier: 2
}

export class ProgressService {
  private redisClient: RedisClientType | null = null
  private readonly PROGRESS_TTL = 3600 // 1 hour in seconds
  private readonly PROGRESS_KEY_PREFIX = 'progress:'

  constructor() {
    // Initialize Redis client lazily
  }

  /**
   * Get Redis client with connection handling
   */
  private async getRedis(): Promise<RedisClientType | null> {
    try {
      if (!this.redisClient) {
        console.log('[ProgressService] Initializing Redis client...')
        this.redisClient = await getRedisClient()
        console.log('[ProgressService] Redis client initialized successfully')
      }
      return this.redisClient
    } catch (error) {
      console.error('[ProgressService] Failed to get Redis client:', error)
      return null
    }
  }

  /**
   * Generate Redis key for job progress
   */
  private getProgressKey(jobId: string): string {
    return `${this.PROGRESS_KEY_PREFIX}${jobId}`
  }

  /**
   * Initialize progress for a new job
   */
  async initializeProgress(jobId: string): Promise<void> {
    const initialProgress: ProgressData = {
      jobId,
      progress: 0,
      stage: 'initialized',
      startTime: Date.now()
    }

    console.log(`[ProgressService] Initializing progress for job ${jobId}`)
    await this.setProgress(jobId, initialProgress)
  }

  /**
   * Set progress data for a job
   */
  async setProgress(jobId: string, progressData: ProgressData): Promise<void> {
    const key = this.getProgressKey(jobId)
    const data = JSON.stringify(progressData)

    console.log(`[ProgressService] Setting progress for job ${jobId}: ${progressData.progress}% (${progressData.stage})`)

    try {
      const redis = await this.getRedis()
      if (redis) {
        await this.executeRedisWithRetry(async () => {
          await redis.setEx(key, this.PROGRESS_TTL, data)
        })
        console.log(`[ProgressService] Progress stored in Redis for job ${jobId} with TTL ${this.PROGRESS_TTL}s`)
      } else {
        console.warn(`[ProgressService] Redis unavailable, progress for job ${jobId} not stored`)
      }
    } catch (error) {
      console.error(`[ProgressService] Failed to set progress in Redis for job ${jobId}:`, error)
      // Don't throw error - progress tracking should not break the main flow
    }
  }

  /**
   * Get progress data for a job (Redis-first, DynamoDB fallback)
   */
  async getProgress(jobId: string): Promise<ProgressData | null> {
    const key = this.getProgressKey(jobId)

    console.log(`[ProgressService] Getting progress for job ${jobId}`)

    try {
      // Try Redis first (fast, real-time)
      const redis = await this.getRedis()
      if (redis) {
        const redisData = await this.executeRedisWithRetry(async () => {
          return await redis.get(key)
        })

        if (redisData) {
          const progressData = JSON.parse(redisData) as ProgressData
          console.log(`[ProgressService] Progress retrieved from Redis for job ${jobId}: ${progressData.progress}% (${progressData.stage})`)
          return progressData
        } else {
          console.log(`[ProgressService] No progress data found in Redis for job ${jobId}`)
        }
      } else {
        console.warn(`[ProgressService] Redis unavailable, falling back to DynamoDB for job ${jobId}`)
      }
    } catch (error) {
      console.error(`[ProgressService] Redis error for job ${jobId}, falling back to DynamoDB:`, error)
    }

    // Fallback to DynamoDB (slower, but persistent)
    try {
      console.log(`[ProgressService] Falling back to DynamoDB for job ${jobId}`)
      const job = await jobService.getJob(jobId)
      
      if (job) {
        const fallbackProgress: ProgressData = {
          jobId,
          progress: this.getProgressFromJobStatus(job),
          stage: job.status,
          error: job.error
        }
        
        console.log(`[ProgressService] Progress retrieved from DynamoDB fallback for job ${jobId}: ${fallbackProgress.progress}% (${fallbackProgress.stage})`)
        return fallbackProgress
      } else {
        console.log(`[ProgressService] Job ${jobId} not found in DynamoDB`)
        return null
      }
    } catch (error) {
      console.error(`[ProgressService] DynamoDB fallback failed for job ${jobId}:`, error)
      return null
    }
  }

  /**
   * Mark job as complete with 100% progress
   */
  async markComplete(jobId: string): Promise<void> {
    const completeProgress: ProgressData = {
      jobId,
      progress: 100,
      stage: 'completed'
    }

    console.log(`[ProgressService] Marking job ${jobId} as complete`)
    await this.setProgress(jobId, completeProgress)
  }

  /**
   * Mark job as failed with error information
   */
  async markFailed(jobId: string, error: string): Promise<void> {
    const failedProgress: ProgressData = {
      jobId,
      progress: -1, // -1 indicates failure
      stage: 'failed',
      error
    }

    console.log(`[ProgressService] Marking job ${jobId} as failed: ${error}`)
    await this.setProgress(jobId, failedProgress)
  }

  /**
   * Process FFmpeg stderr line and update progress if needed
   */
  async processFFmpegStderr(
    jobId: string,
    stderrLine: string,
    processInfo: FFmpegProcessInfo,
    fallbackFileSize?: number
  ): Promise<void> {
    try {
      // Parse the stderr line
      const progressInfo = ffmpegProgressParser.parseStderr(stderrLine, processInfo)
      
      if (!progressInfo) {
        return // No progress information in this line
      }

      // Store duration information if found (don't throttle duration updates)
      if (progressInfo.duration && !processInfo.estimatedDuration) {
        processInfo.estimatedDuration = progressInfo.duration
        console.log(`[ProgressService] Duration detected for job ${jobId}: ${progressInfo.duration}s`)
      }

      // For progress updates with currentTime, check throttling
      if (progressInfo.currentTime !== undefined) {
        // For streaming conversions, be less aggressive with throttling to capture more updates
        const shouldUpdate = processInfo.isStreaming ? 
          (Date.now() - processInfo.lastProgressTime) >= 25 : // 25ms for streaming
          ffmpegProgressParser.shouldUpdateProgress(processInfo) // Normal throttling for file-based

        if (!shouldUpdate) {
          return
        }

        // Calculate progress with fallback strategies
        const progressData = ffmpegProgressParser.calculateProgress(
          progressInfo,
          processInfo,
          fallbackFileSize
        )

        // Update the jobId to match the actual job
        progressData.jobId = jobId

        // Store progress in Redis
        await this.setProgress(jobId, progressData)

        console.log(`[ProgressService] FFmpeg progress updated for job ${jobId}: ${progressData.progress}% (${progressData.stage})`)
      }
    } catch (error) {
      console.error(`[ProgressService] Failed to process FFmpeg stderr for job ${jobId}:`, error)
      // Don't throw - progress tracking should not break the conversion process
    }
  }

  /**
   * Initialize FFmpeg process info for progress tracking
   */
  createFFmpegProcessInfo(
    pid: number,
    inputFormat: string,
    outputFormat: string,
    isStreaming: boolean = false
  ): FFmpegProcessInfo {
    return {
      pid,
      startTime: Date.now(),
      lastProgressTime: Date.now(),
      isStreaming,
      inputFormat,
      outputFormat
    }
  }

  /**
   * Check if FFmpeg process has timed out
   */
  checkFFmpegTimeout(processInfo: FFmpegProcessInfo): boolean {
    return ffmpegProgressParser.detectTimeout(processInfo)
  }

  /**
   * Check streaming compatibility for given formats
   */
  checkStreamingCompatibility(inputFormat: string, outputFormat: string): {
    supportsStreaming: boolean
    reason?: string
    fallbackRecommended: boolean
  } {
    return ffmpegProgressParser.checkStreamingCompatibility(inputFormat, outputFormat)
  }

  /**
   * Get format compatibility information
   */
  getFormatCompatibility(format: string) {
    return ffmpegProgressParser.getFormatCompatibility(format)
  }

  /**
   * Get all supported formats
   */
  getSupportedFormats() {
    return ffmpegProgressParser.getSupportedFormats()
  }

  /**
   * Clean up expired progress data (called periodically)
   */
  async cleanupExpiredProgress(): Promise<void> {
    console.log('[ProgressService] Starting cleanup of expired progress data')

    try {
      const redis = await this.getRedis()
      if (!redis) {
        console.warn('[ProgressService] Redis unavailable, skipping progress cleanup')
        return
      }

      // Get all progress keys
      const keys = await this.executeRedisWithRetry(async () => {
        return await redis.keys(`${this.PROGRESS_KEY_PREFIX}*`)
      })

      if (keys.length === 0) {
        console.log('[ProgressService] No progress keys found for cleanup')
        return
      }

      console.log(`[ProgressService] Found ${keys.length} progress keys, checking TTL...`)

      // Check TTL for each key and log expired ones
      let expiredCount = 0
      for (const key of keys) {
        try {
          const ttl = await redis.ttl(key)
          if (ttl === -2) { // Key doesn't exist (already expired)
            expiredCount++
          } else if (ttl === -1) { // Key exists but has no TTL (shouldn't happen)
            console.warn(`[ProgressService] Key ${key} has no TTL, setting TTL`)
            await redis.expire(key, this.PROGRESS_TTL)
          }
        } catch (error) {
          console.error(`[ProgressService] Error checking TTL for key ${key}:`, error)
        }
      }

      console.log(`[ProgressService] Progress cleanup completed. Found ${expiredCount} expired keys (automatically cleaned by Redis TTL)`)
    } catch (error) {
      console.error('[ProgressService] Failed to cleanup expired progress data:', error)
    }
  }

  /**
   * Convert job status to progress percentage for DynamoDB fallback
   */
  private getProgressFromJobStatus(job: Job): number {
    switch (job.status) {
      case 'created':
        return 0
      case 'processing':
        return 50 // Assume 50% if we don't have real-time data
      case 'completed':
        return 100
      case 'failed':
        return -1
      default:
        return 0
    }
  }

  /**
   * Execute Redis operation with retry logic
   */
  private async executeRedisWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null
    
    for (let attempt = 0; attempt <= REDIS_RETRY_CONFIG.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error')
        
        if (attempt === REDIS_RETRY_CONFIG.maxRetries) {
          break
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          REDIS_RETRY_CONFIG.baseDelay * Math.pow(REDIS_RETRY_CONFIG.backoffMultiplier, attempt),
          REDIS_RETRY_CONFIG.maxDelay
        )

        console.log(`[ProgressService] Redis operation failed (attempt ${attempt + 1}/${REDIS_RETRY_CONFIG.maxRetries + 1}), retrying in ${delay}ms:`, lastError.message)
        
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    throw lastError
  }
}

// Export singleton instance
export const progressService = new ProgressService()