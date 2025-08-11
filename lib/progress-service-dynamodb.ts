import { DynamoDBClient, PutItemCommand, GetItemCommand, ScanCommand, DeleteItemCommand, CreateTableCommand, DescribeTableCommand, UpdateTimeToLiveCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { ffmpegProgressParser, FFmpegProcessInfo } from './ffmpeg-progress-parser'
import { getEnvironmentConfig } from './environment'

export interface ProgressData {
  jobId: string
  progress: number // 0-100
  stage: string
  estimatedTimeRemaining?: number
  error?: string
  startTime?: number
  currentTime?: string
  totalDuration?: string
  uploadedSize?: number           // For upload progress
  totalSize?: number              // For upload progress
  completedChunks?: number        // For chunked uploads
  totalChunks?: number            // For chunked uploads
  ttl: number                     // TTL timestamp for automatic cleanup
  updatedAt: number               // Last update timestamp
}

export interface UploadProgressData {
  fileId: string                  // Partition key
  fileName: string
  totalSize: number
  uploadedSize: number
  totalChunks: number
  completedChunks: number
  stage: 'uploading' | 'completed' | 'failed'
  uploadId?: string               // S3 multipart upload ID
  s3Key?: string                  // S3 object key
  bucketName?: string             // S3 bucket name
  parts?: Array<{ETag: string; PartNumber: number}>  // S3 multipart parts
  ttl: number                     // TTL timestamp
  updatedAt: number               // Last update timestamp
}

interface RetryConfig {
  maxRetries: number
  baseDelay: number
  maxDelay: number
  backoffMultiplier: number
}

const DYNAMODB_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 500,
  maxDelay: 5000,
  backoffMultiplier: 2
}

export class DynamoDBProgressService {
  private client: DynamoDBClient
  private readonly PROGRESS_TABLE = 'audio-conversion-progress'
  private readonly UPLOADS_TABLE = 'audio-conversion-uploads'
  private readonly PROGRESS_TTL = 3600 // 1 hour in seconds
  private readonly UPLOAD_TTL = 7200 // 2 hours in seconds

  constructor(client?: DynamoDBClient) {
    if (client) {
      this.client = client
    } else {
      const config = getEnvironmentConfig()
      this.client = new DynamoDBClient({
        region: config.dynamodb.region,
        endpoint: config.dynamodb.endpoint,
        credentials: config.dynamodb.credentials
      })
    }
  }

  /**
   * Initialize DynamoDB tables for progress tracking
   */
  async initializeTables(): Promise<void> {
    console.log('[DynamoDBProgressService] Initializing progress tracking tables...')
    
    await Promise.all([
      this.createProgressTable(),
      this.createUploadsTable()
    ])
    
    console.log('[DynamoDBProgressService] All progress tracking tables initialized successfully')
  }

  /**
   * Create progress tracking table
   */
  private async createProgressTable(): Promise<void> {
    const tableName = this.PROGRESS_TABLE
    
    try {
      // Check if table exists
      await this.client.send(new DescribeTableCommand({ TableName: tableName }))
      console.log(`[DynamoDBProgressService] Progress table '${tableName}' already exists`)
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        console.log(`[DynamoDBProgressService] Creating progress table '${tableName}'...`)
        
        await this.client.send(new CreateTableCommand({
          TableName: tableName,
          KeySchema: [
            { AttributeName: 'jobId', KeyType: 'HASH' }
          ],
          AttributeDefinitions: [
            { AttributeName: 'jobId', AttributeType: 'S' }
          ],
          BillingMode: 'PAY_PER_REQUEST'
        }))
        
        console.log(`[DynamoDBProgressService] Progress table '${tableName}' created successfully`)
        
        // Wait for table to be active
        await this.waitForTableActive(tableName)
        
        // Configure TTL after table is active
        await this.configureTTL(tableName)
      } else {
        throw error
      }
    }
  }

  /**
   * Create uploads tracking table
   */
  private async createUploadsTable(): Promise<void> {
    const tableName = this.UPLOADS_TABLE
    
    try {
      // Check if table exists
      await this.client.send(new DescribeTableCommand({ TableName: tableName }))
      console.log(`[DynamoDBProgressService] Uploads table '${tableName}' already exists`)
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        console.log(`[DynamoDBProgressService] Creating uploads table '${tableName}'...`)
        
        await this.client.send(new CreateTableCommand({
          TableName: tableName,
          KeySchema: [
            { AttributeName: 'fileId', KeyType: 'HASH' }
          ],
          AttributeDefinitions: [
            { AttributeName: 'fileId', AttributeType: 'S' }
          ],
          BillingMode: 'PAY_PER_REQUEST'
        }))
        
        console.log(`[DynamoDBProgressService] Uploads table '${tableName}' created successfully`)
        
        // Wait for table to be active
        await this.waitForTableActive(tableName)
        
        // Configure TTL after table is active
        await this.configureTTL(tableName)
      } else {
        throw error
      }
    }
  }

  /**
   * Wait for table to become active
   */
  private async waitForTableActive(tableName: string): Promise<void> {
    console.log(`[DynamoDBProgressService] Waiting for table '${tableName}' to become active...`)
    
    let attempts = 0
    const maxAttempts = 30 // 30 seconds max wait
    
    while (attempts < maxAttempts) {
      try {
        const result = await this.client.send(new DescribeTableCommand({ TableName: tableName }))
        if (result.Table?.TableStatus === 'ACTIVE') {
          console.log(`[DynamoDBProgressService] Table '${tableName}' is now active`)
          return
        }
      } catch (error) {
        console.error(`[DynamoDBProgressService] Error checking table status:`, error)
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      attempts++
    }
    
    throw new Error(`Table '${tableName}' did not become active within ${maxAttempts} seconds`)
  }

  /**
   * Configure TTL for a table
   */
  private async configureTTL(tableName: string): Promise<void> {
    try {
      console.log(`[DynamoDBProgressService] Configuring TTL for table '${tableName}'...`)
      
      await this.client.send(new UpdateTimeToLiveCommand({
        TableName: tableName,
        TimeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true
        }
      }))
      
      console.log(`[DynamoDBProgressService] TTL configured successfully for table '${tableName}'`)
    } catch (error) {
      console.error(`[DynamoDBProgressService] Failed to configure TTL for table '${tableName}':`, error)
      // Don't throw - TTL configuration failure shouldn't break table creation
    }
  }

  /**
   * Initialize progress for a new job
   */
  async initializeProgress(jobId: string): Promise<void> {
    const initialProgress: ProgressData = {
      jobId,
      progress: 0,
      stage: 'initialized',
      startTime: Date.now(),
      ttl: Math.floor(Date.now() / 1000) + this.PROGRESS_TTL,
      updatedAt: Date.now()
    }

    console.log(`[DynamoDBProgressService] Initializing progress for job ${jobId}`)
    await this.setProgress(jobId, initialProgress)
  }

  /**
   * Set progress data for a job
   */
  async setProgress(jobId: string, progressData: ProgressData): Promise<void> {
    // Ensure TTL and updatedAt are set
    progressData.ttl = Math.floor(Date.now() / 1000) + this.PROGRESS_TTL
    progressData.updatedAt = Date.now()

    console.log(`[DynamoDBProgressService] Setting progress for job ${jobId}: ${progressData.progress}% (${progressData.stage})`)

    try {
      await this.executeWithRetry(async () => {
        await this.client.send(new PutItemCommand({
          TableName: this.PROGRESS_TABLE,
          Item: marshall(progressData, { 
            convertClassInstanceToMap: true,
            removeUndefinedValues: true 
          })
        }))
      })
      
      console.log(`[DynamoDBProgressService] Progress stored in DynamoDB for job ${jobId}`)
    } catch (error) {
      console.error(`[DynamoDBProgressService] Failed to set progress for job ${jobId}:`, error)
      throw new Error(`Failed to set progress: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get progress data for a job
   */
  async getProgress(jobId: string): Promise<ProgressData | null> {
    console.log(`[DynamoDBProgressService] Getting progress for job ${jobId}`)

    try {
      const result = await this.executeWithRetry(async () => {
        return await this.client.send(new GetItemCommand({
          TableName: this.PROGRESS_TABLE,
          Key: marshall({ jobId })
        }))
      })

      if (!result.Item) {
        console.log(`[DynamoDBProgressService] No progress data found for job ${jobId}`)
        return null
      }

      const progressData = unmarshall(result.Item) as ProgressData
      console.log(`[DynamoDBProgressService] Progress retrieved for job ${jobId}: ${progressData.progress}% (${progressData.stage})`)
      return progressData
    } catch (error) {
      console.error(`[DynamoDBProgressService] Failed to get progress for job ${jobId}:`, error)
      throw new Error(`Failed to get progress: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Mark job as complete with 100% progress
   */
  async markComplete(jobId: string): Promise<void> {
    const completeProgress: ProgressData = {
      jobId,
      progress: 100,
      stage: 'completed',
      ttl: Math.floor(Date.now() / 1000) + this.PROGRESS_TTL,
      updatedAt: Date.now()
    }

    console.log(`[DynamoDBProgressService] Marking job ${jobId} as complete`)
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
      error,
      ttl: Math.floor(Date.now() / 1000) + this.PROGRESS_TTL,
      updatedAt: Date.now()
    }

    console.log(`[DynamoDBProgressService] Marking job ${jobId} as failed: ${error}`)
    await this.setProgress(jobId, failedProgress)
  }

  /**
   * Set upload progress data
   */
  async setUploadProgress(fileId: string, uploadData: UploadProgressData): Promise<void> {
    // Ensure TTL and updatedAt are set
    uploadData.ttl = Math.floor(Date.now() / 1000) + this.UPLOAD_TTL
    uploadData.updatedAt = Date.now()

    console.log(`[DynamoDBProgressService] Setting upload progress for file ${fileId}: ${uploadData.completedChunks}/${uploadData.totalChunks} chunks (${uploadData.stage})`)

    try {
      await this.executeWithRetry(async () => {
        await this.client.send(new PutItemCommand({
          TableName: this.UPLOADS_TABLE,
          Item: marshall(uploadData, { 
            convertClassInstanceToMap: true,
            removeUndefinedValues: true 
          })
        }))
      })
      
      console.log(`[DynamoDBProgressService] Upload progress stored in DynamoDB for file ${fileId}`)
    } catch (error) {
      console.error(`[DynamoDBProgressService] Failed to set upload progress for file ${fileId}:`, error)
      throw new Error(`Failed to set upload progress: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get upload progress data
   */
  async getUploadProgress(fileId: string): Promise<UploadProgressData | null> {
    console.log(`[DynamoDBProgressService] Getting upload progress for file ${fileId}`)

    try {
      const result = await this.executeWithRetry(async () => {
        return await this.client.send(new GetItemCommand({
          TableName: this.UPLOADS_TABLE,
          Key: marshall({ fileId })
        }))
      })

      if (!result.Item) {
        console.log(`[DynamoDBProgressService] No upload progress data found for file ${fileId}`)
        return null
      }

      const uploadData = unmarshall(result.Item) as UploadProgressData
      console.log(`[DynamoDBProgressService] Upload progress retrieved for file ${fileId}: ${uploadData.completedChunks}/${uploadData.totalChunks} chunks (${uploadData.stage})`)
      return uploadData
    } catch (error) {
      console.error(`[DynamoDBProgressService] Failed to get upload progress for file ${fileId}:`, error)
      throw new Error(`Failed to get upload progress: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
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
        console.log(`[DynamoDBProgressService] Duration detected for job ${jobId}: ${progressInfo.duration}s`)
        
        // Update progress with duration info immediately (not throttled)
        const durationProgressData: ProgressData = {
          jobId,
          progress: 5, // Small progress bump when duration is detected
          stage: 'analyzing audio duration',
          totalDuration: this.formatSecondsToTime(progressInfo.duration),
          ttl: Math.floor(Date.now() / 1000) + this.PROGRESS_TTL,
          updatedAt: Date.now()
        }
        
        await this.setProgress(jobId, durationProgressData)
        console.log(`[DynamoDBProgressService] Duration progress updated for job ${jobId}: ${progressInfo.duration}s`)
      }

      // For progress updates with currentTime, check throttling
      if (progressInfo.currentTime !== undefined) {
        // Throttle progress updates to reduce DynamoDB write costs
        // Update every 1-2 seconds instead of every stderr line
        const timeSinceLastUpdate = Date.now() - processInfo.lastProgressTime
        const shouldUpdate = timeSinceLastUpdate >= 1500 // 1.5 second throttling for optimal cost/UX balance

        if (!shouldUpdate) {
          return
        }

        // Calculate progress with fallback strategies
        const progressData = ffmpegProgressParser.calculateProgress(
          progressInfo,
          processInfo,
          fallbackFileSize
        )

        // Update the jobId to match the actual job and add DynamoDB-specific fields
        const dynamoProgressData: ProgressData = {
          ...progressData,
          jobId,
          ttl: Math.floor(Date.now() / 1000) + this.PROGRESS_TTL,
          updatedAt: Date.now()
        }

        // Store progress in DynamoDB
        await this.setProgress(jobId, dynamoProgressData)

        console.log(`[DynamoDBProgressService] FFmpeg progress updated for job ${jobId}: ${dynamoProgressData.progress}% (${dynamoProgressData.stage}) - throttled after ${timeSinceLastUpdate}ms`)
        
        // Update the last progress time to maintain throttling
        processInfo.lastProgressTime = Date.now()
      }
    } catch (error) {
      console.error(`[DynamoDBProgressService] Failed to process FFmpeg stderr for job ${jobId}:`, error)
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
   * Format seconds to HH:MM:SS.ms string
   */
  private formatSecondsToTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = Math.floor(totalSeconds % 60)
    const centiseconds = Math.floor((totalSeconds % 1) * 100)

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`
  }

  /**
   * Clean up expired progress data
   */
  async cleanupExpiredProgress(): Promise<void> {
    console.log('[DynamoDBProgressService] Starting cleanup of expired progress data')

    try {
      const currentTime = Math.floor(Date.now() / 1000)
      
      // Clean up progress table
      await this.cleanupExpiredTable(this.PROGRESS_TABLE, currentTime, 'progress')
      
      // Clean up uploads table
      await this.cleanupExpiredTable(this.UPLOADS_TABLE, currentTime, 'upload')
      
      console.log('[DynamoDBProgressService] Progress cleanup completed')
    } catch (error) {
      console.error('[DynamoDBProgressService] Failed to cleanup expired progress data:', error)
      throw new Error(`Failed to cleanup expired progress data: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Clean up expired records from a specific table
   */
  private async cleanupExpiredTable(tableName: string, currentTime: number, type: string): Promise<void> {
    try {
      // Scan for expired records (TTL might not have cleaned them up yet)
      const result = await this.executeWithRetry(async () => {
        return await this.client.send(new ScanCommand({
          TableName: tableName,
          FilterExpression: '#ttl < :currentTime',
          ExpressionAttributeNames: {
            '#ttl': 'ttl'
          },
          ExpressionAttributeValues: marshall({
            ':currentTime': currentTime
          })
        }))
      })

      if (!result.Items || result.Items.length === 0) {
        console.log(`[DynamoDBProgressService] No expired ${type} records found for cleanup`)
        return
      }

      console.log(`[DynamoDBProgressService] Found ${result.Items.length} expired ${type} records to clean up`)

      // Delete expired records
      const deletePromises = result.Items.map(async (item) => {
        const record = unmarshall(item)
        const keyName = tableName === this.PROGRESS_TABLE ? 'jobId' : 'fileId'
        const recordId = record[keyName]
        
        console.log(`[DynamoDBProgressService] Deleting expired ${type} record ${recordId}`)
        
        try {
          await this.client.send(new DeleteItemCommand({
            TableName: tableName,
            Key: marshall({ [keyName]: recordId })
          }))
          console.log(`[DynamoDBProgressService] Expired ${type} record ${recordId} deleted successfully`)
        } catch (error) {
          console.error(`[DynamoDBProgressService] Failed to delete expired ${type} record ${recordId}:`, error)
        }
      })

      await Promise.all(deletePromises)
      console.log(`[DynamoDBProgressService] ${type} cleanup completed. Processed ${result.Items.length} expired records`)
    } catch (error) {
      console.error(`[DynamoDBProgressService] Failed to cleanup expired ${type} records:`, error)
    }
  }

  /**
   * Execute DynamoDB operation with retry logic
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null
    
    for (let attempt = 0; attempt <= DYNAMODB_RETRY_CONFIG.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error')
        
        if (attempt === DYNAMODB_RETRY_CONFIG.maxRetries) {
          break
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          DYNAMODB_RETRY_CONFIG.baseDelay * Math.pow(DYNAMODB_RETRY_CONFIG.backoffMultiplier, attempt),
          DYNAMODB_RETRY_CONFIG.maxDelay
        )

        console.log(`[DynamoDBProgressService] Operation failed (attempt ${attempt + 1}/${DYNAMODB_RETRY_CONFIG.maxRetries + 1}), retrying in ${delay}ms:`, lastError.message)
        
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    throw lastError
  }
}

// Export singleton instance
export const dynamodbProgressService = new DynamoDBProgressService()