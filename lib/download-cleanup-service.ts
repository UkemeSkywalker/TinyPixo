import { s3Client } from './aws-services'
import { jobService, JobStatus } from './job-service'
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

export interface CleanupConfig {
  maxAgeHours: number
  batchSize: number
  dryRun: boolean
}

export interface CleanupResult {
  filesDeleted: number
  jobsProcessed: number
  errors: string[]
  duration: number
}

/**
 * Service for cleaning up downloaded files and expired jobs
 */
export class DownloadCleanupService {
  private bucketName: string

  constructor(bucketName?: string) {
    this.bucketName = bucketName || process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'
  }

  /**
   * Clean up completed downloads and expired jobs
   */
  async cleanupCompletedDownloads(config: CleanupConfig = {
    maxAgeHours: 24,
    batchSize: 100,
    dryRun: false
  }): Promise<CleanupResult> {
    const startTime = Date.now()
    const result: CleanupResult = {
      filesDeleted: 0,
      jobsProcessed: 0,
      errors: [],
      duration: 0
    }

    console.log(`[DownloadCleanup] Starting cleanup (maxAge: ${config.maxAgeHours}h, batchSize: ${config.batchSize}, dryRun: ${config.dryRun})`)

    try {
      // Get expired jobs from DynamoDB
      const expiredJobs = await this.getExpiredJobs(config.maxAgeHours)
      console.log(`[DownloadCleanup] Found ${expiredJobs.length} expired jobs`)

      // Process jobs in batches
      for (let i = 0; i < expiredJobs.length; i += config.batchSize) {
        const batch = expiredJobs.slice(i, i + config.batchSize)
        await this.processBatch(batch, config, result)
      }

      // Clean up orphaned files in S3
      await this.cleanupOrphanedFiles(config, result)

    } catch (error) {
      const errorMessage = `Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      result.errors.push(errorMessage)
      console.error(`[DownloadCleanup] ${errorMessage}`)
    }

    result.duration = Date.now() - startTime
    console.log(`[DownloadCleanup] Cleanup completed in ${result.duration}ms`)
    console.log(`[DownloadCleanup] Files deleted: ${result.filesDeleted}, Jobs processed: ${result.jobsProcessed}, Errors: ${result.errors.length}`)

    return result
  }

  /**
   * Get jobs that are older than the specified age
   */
  private async getExpiredJobs(maxAgeHours: number): Promise<any[]> {
    try {
      // Calculate cutoff time
      const cutoffTime = new Date(Date.now() - (maxAgeHours * 60 * 60 * 1000))
      
      // For now, we'll use the existing cleanup method from jobService
      // In a real implementation, you might want to add a scan operation
      // that filters by updatedAt timestamp
      
      console.log(`[DownloadCleanup] Looking for jobs older than ${cutoffTime.toISOString()}`)
      
      // This is a simplified approach - in production you'd want to use
      // DynamoDB scan with filter expressions for better performance
      return []
      
    } catch (error) {
      console.error('[DownloadCleanup] Failed to get expired jobs:', error)
      throw error
    }
  }

  /**
   * Process a batch of expired jobs
   */
  private async processBatch(jobs: any[], config: CleanupConfig, result: CleanupResult): Promise<void> {
    const deletePromises = jobs.map(async (job) => {
      try {
        result.jobsProcessed++

        // Delete output file from S3 if it exists
        if (job.outputS3Location) {
          if (!config.dryRun) {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: job.outputS3Location.bucket,
              Key: job.outputS3Location.key
            }))
          }
          
          result.filesDeleted++
          console.log(`[DownloadCleanup] ${config.dryRun ? '[DRY RUN] ' : ''}Deleted output file: ${job.outputS3Location.key}`)
        }

        // Delete input file from S3 if it exists
        if (job.inputS3Location) {
          if (!config.dryRun) {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: job.inputS3Location.bucket,
              Key: job.inputS3Location.key
            }))
          }
          
          result.filesDeleted++
          console.log(`[DownloadCleanup] ${config.dryRun ? '[DRY RUN] ' : ''}Deleted input file: ${job.inputS3Location.key}`)
        }

      } catch (error) {
        const errorMessage = `Failed to cleanup job ${job.jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        result.errors.push(errorMessage)
        console.error(`[DownloadCleanup] ${errorMessage}`)
      }
    })

    await Promise.all(deletePromises)
  }

  /**
   * Clean up orphaned files in S3 that don't have corresponding jobs
   */
  private async cleanupOrphanedFiles(config: CleanupConfig, result: CleanupResult): Promise<void> {
    try {
      console.log('[DownloadCleanup] Scanning for orphaned files...')

      // List all files in the conversions folder
      const listResponse = await s3Client.send(new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: 'conversions/',
        MaxKeys: 1000
      }))

      if (!listResponse.Contents || listResponse.Contents.length === 0) {
        console.log('[DownloadCleanup] No files found in conversions folder')
        return
      }

      console.log(`[DownloadCleanup] Found ${listResponse.Contents.length} files in conversions folder`)

      // Check each file to see if it has a corresponding job
      for (const object of listResponse.Contents) {
        if (!object.Key || !object.LastModified) continue

        // Extract job ID from file key (assuming format: conversions/{jobId}.{ext})
        const keyParts = object.Key.split('/')
        if (keyParts.length < 2) continue

        const filename = keyParts[keyParts.length - 1]
        const jobId = filename.split('.')[0]

        // Check if file is old enough to be cleaned up
        const fileAge = Date.now() - object.LastModified.getTime()
        const maxAgeMs = config.maxAgeHours * 60 * 60 * 1000

        if (fileAge < maxAgeMs) {
          continue // File is not old enough
        }

        // Check if job still exists
        try {
          const job = await jobService.getJob(jobId)
          
          if (!job) {
            // Orphaned file - delete it
            if (!config.dryRun) {
              await s3Client.send(new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: object.Key
              }))
            }
            
            result.filesDeleted++
            console.log(`[DownloadCleanup] ${config.dryRun ? '[DRY RUN] ' : ''}Deleted orphaned file: ${object.Key}`)
          }
          
        } catch (error) {
          // If we can't check the job, assume it's orphaned
          if (!config.dryRun) {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: this.bucketName,
              Key: object.Key
            }))
          }
          
          result.filesDeleted++
          console.log(`[DownloadCleanup] ${config.dryRun ? '[DRY RUN] ' : ''}Deleted potentially orphaned file: ${object.Key}`)
        }
      }

    } catch (error) {
      const errorMessage = `Failed to cleanup orphaned files: ${error instanceof Error ? error.message : 'Unknown error'}`
      result.errors.push(errorMessage)
      console.error(`[DownloadCleanup] ${errorMessage}`)
    }
  }

  /**
   * Clean up files for a specific job
   */
  async cleanupJobFiles(jobId: string, dryRun: boolean = false): Promise<boolean> {
    try {
      console.log(`[DownloadCleanup] Cleaning up files for job ${jobId}`)

      const job = await jobService.getJob(jobId)
      if (!job) {
        console.log(`[DownloadCleanup] Job ${jobId} not found`)
        return false
      }

      let filesDeleted = 0

      // Delete output file
      if (job.outputS3Location) {
        if (!dryRun) {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: job.outputS3Location.bucket,
            Key: job.outputS3Location.key
          }))
        }
        filesDeleted++
        console.log(`[DownloadCleanup] ${dryRun ? '[DRY RUN] ' : ''}Deleted output file: ${job.outputS3Location.key}`)
      }

      // Delete input file
      if (job.inputS3Location) {
        if (!dryRun) {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: job.inputS3Location.bucket,
            Key: job.inputS3Location.key
          }))
        }
        filesDeleted++
        console.log(`[DownloadCleanup] ${dryRun ? '[DRY RUN] ' : ''}Deleted input file: ${job.inputS3Location.key}`)
      }

      console.log(`[DownloadCleanup] Cleanup completed for job ${jobId}: ${filesDeleted} files ${dryRun ? 'would be ' : ''}deleted`)
      return true

    } catch (error) {
      console.error(`[DownloadCleanup] Failed to cleanup job ${jobId}:`, error)
      return false
    }
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStats(): Promise<{
    totalFiles: number
    oldFiles: number
    estimatedCleanupSize: number
  }> {
    try {
      const listResponse = await s3Client.send(new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: 'conversions/',
        MaxKeys: 1000
      }))

      const totalFiles = listResponse.Contents?.length || 0
      let oldFiles = 0
      let estimatedCleanupSize = 0

      const cutoffTime = Date.now() - (24 * 60 * 60 * 1000) // 24 hours ago

      if (listResponse.Contents) {
        for (const object of listResponse.Contents) {
          if (object.LastModified && object.LastModified.getTime() < cutoffTime) {
            oldFiles++
            estimatedCleanupSize += object.Size || 0
          }
        }
      }

      return {
        totalFiles,
        oldFiles,
        estimatedCleanupSize
      }

    } catch (error) {
      console.error('[DownloadCleanup] Failed to get cleanup stats:', error)
      return {
        totalFiles: 0,
        oldFiles: 0,
        estimatedCleanupSize: 0
      }
    }
  }
}

// Export singleton instance
export const downloadCleanupService = new DownloadCleanupService()