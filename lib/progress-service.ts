import { dynamodbProgressService, ProgressData } from './progress-service-dynamodb'
import { jobService, Job } from './job-service'
import { ffmpegProgressParser, FFmpegProcessInfo } from './ffmpeg-progress-parser'

// Re-export ProgressData interface for compatibility
export type { ProgressData }

export class ProgressService {
  constructor() {
    // DynamoDB-based progress service - no initialization needed
  }

  /**
   * Helper function to create ProgressData with required fields
   */
  private createProgressData(partial: Partial<ProgressData>): ProgressData {
    return {
      jobId: partial.jobId || '',
      progress: partial.progress || 0,
      stage: partial.stage || 'unknown',
      phase: partial.phase || 'upload', // Default to upload phase if not specified
      estimatedTimeRemaining: partial.estimatedTimeRemaining,
      error: partial.error,
      startTime: partial.startTime,
      currentTime: partial.currentTime,
      totalDuration: partial.totalDuration,
      ttl: partial.ttl || Math.floor(Date.now() / 1000) + 3600, // 1 hour default TTL
      updatedAt: partial.updatedAt || Date.now()
    }
  }



  /**
   * Initialize progress for a new job
   */
  async initializeProgress(jobId: string): Promise<void> {
    console.log(`[ProgressService] Initializing progress for job ${jobId}`)
    await dynamodbProgressService.initializeProgress(jobId)
  }

  /**
   * Set progress data for a job
   */
  async setProgress(jobId: string, progressData: Partial<ProgressData>): Promise<void> {
    const fullProgressData = this.createProgressData({ ...progressData, jobId })
    console.log(`[ProgressService] Setting progress for job ${jobId}: ${fullProgressData.progress}% (${fullProgressData.stage})`)
    
    try {
      await dynamodbProgressService.setProgress(jobId, fullProgressData)
    } catch (error) {
      console.error(`[ProgressService] Failed to set progress for job ${jobId}:`, error)
      // Don't throw error - progress tracking should not break the main flow
    }
  }

  /**
   * Get progress data for a job
   */
  async getProgress(jobId: string): Promise<ProgressData | null> {
    console.log(`[ProgressService] Getting progress for job ${jobId}`)

    try {
      // Try DynamoDB progress service first
      const progressData = await dynamodbProgressService.getProgress(jobId)
      if (progressData) {
        console.log(`[ProgressService] Progress retrieved from DynamoDB for job ${jobId}: ${progressData.progress}% (${progressData.stage})`)
        return progressData
      }
    } catch (error) {
      console.error(`[ProgressService] DynamoDB error for job ${jobId}, falling back to job service:`, error)
    }

    // Fallback to job service
    try {
      console.log(`[ProgressService] Falling back to job service for job ${jobId}`)
      const job = await jobService.getJob(jobId)
      
      if (job) {
        const fallbackProgress: ProgressData = {
          jobId,
          progress: this.getProgressFromJobStatus(job),
          stage: job.status,
          error: job.error,
          ttl: Math.floor(Date.now() / 1000) + 3600,
          updatedAt: Date.now()
        }
        
        console.log(`[ProgressService] Progress retrieved from job service fallback for job ${jobId}: ${fallbackProgress.progress}% (${fallbackProgress.stage})`)
        return fallbackProgress
      } else {
        console.log(`[ProgressService] Job ${jobId} not found`)
        return null
      }
    } catch (error) {
      console.error(`[ProgressService] Job service fallback failed for job ${jobId}:`, error)
      return null
    }
  }

  /**
   * Mark job as complete with 100% progress
   */
  async markComplete(jobId: string): Promise<void> {
    console.log(`[ProgressService] Marking job ${jobId} as complete`)
    await dynamodbProgressService.markComplete(jobId)
  }

  /**
   * Mark job as failed with error information
   */
  async markFailed(jobId: string, error: string): Promise<void> {
    console.log(`[ProgressService] Marking job ${jobId} as failed: ${error}`)
    await dynamodbProgressService.markFailed(jobId, error)
  }

  /**
   * Transition job to conversion phase
   */
  async startConversionPhase(jobId: string): Promise<void> {
    console.log(`[ProgressService] Starting conversion phase for job ${jobId}`)
    await dynamodbProgressService.startConversionPhase(jobId)
  }

  /**
   * Transition job to S3 upload phase
   */
  async startS3UploadPhase(jobId: string): Promise<void> {
    console.log(`[ProgressService] Starting S3 upload phase for job ${jobId}`)
    await dynamodbProgressService.startS3UploadPhase(jobId)
  }

  /**
   * Update S3 upload progress
   */
  async updateS3UploadProgress(
    jobId: string, 
    uploadedBytes: number, 
    totalBytes: number
  ): Promise<void> {
    await dynamodbProgressService.updateS3UploadProgress(jobId, uploadedBytes, totalBytes)
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
      await dynamodbProgressService.processFFmpegStderr(jobId, stderrLine, processInfo, fallbackFileSize)
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
    return dynamodbProgressService.createFFmpegProcessInfo(pid, inputFormat, outputFormat, isStreaming)
  }

  /**
   * Check if FFmpeg process has timed out
   */
  checkFFmpegTimeout(processInfo: FFmpegProcessInfo): boolean {
    return dynamodbProgressService.checkFFmpegTimeout(processInfo)
  }

  /**
   * Check streaming compatibility for given formats
   */
  checkStreamingCompatibility(inputFormat: string, outputFormat: string): {
    supportsStreaming: boolean
    reason?: string
    fallbackRecommended: boolean
  } {
    return dynamodbProgressService.checkStreamingCompatibility(inputFormat, outputFormat)
  }

  /**
   * Get format compatibility information
   */
  getFormatCompatibility(format: string) {
    return dynamodbProgressService.getFormatCompatibility(format)
  }

  /**
   * Get all supported formats
   */
  getSupportedFormats() {
    return dynamodbProgressService.getSupportedFormats()
  }

  /**
   * Get FFmpeg logs for a job
   */
  async getFFmpegLogs(jobId: string): Promise<string[]> {
    console.log(`[ProgressService] Getting FFmpeg logs for job ${jobId}`)
    
    try {
      return await dynamodbProgressService.getFFmpegLogs(jobId)
    } catch (error) {
      console.error(`[ProgressService] Failed to get FFmpeg logs for job ${jobId}:`, error)
      return []
    }
  }

  /**
   * Clean up expired progress data (called periodically)
   */
  async cleanupExpiredProgress(): Promise<void> {
    console.log('[ProgressService] Starting cleanup of expired progress data')
    
    try {
      await dynamodbProgressService.cleanupExpiredProgress()
    } catch (error) {
      console.error('[ProgressService] Failed to cleanup expired progress data:', error)
    }
  }

  /**
   * Convert job status to progress percentage for job service fallback
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
}

// Export singleton instance
export const progressService = new ProgressService()