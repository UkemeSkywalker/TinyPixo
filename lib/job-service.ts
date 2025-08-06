import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand, ScanCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { dynamodbClient } from './aws-services'

export enum JobStatus {
  CREATED = 'created',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface S3Location {
  bucket: string
  key: string
  size: number
}

export interface Job {
  jobId: string
  status: JobStatus
  inputS3Location: S3Location
  outputS3Location?: S3Location
  format: string
  quality: string
  createdAt: Date
  updatedAt: Date
  ttl: number
  error?: string
}

export interface JobInput {
  inputS3Location: S3Location
  format: string
  quality: string
}

interface RetryConfig {
  maxRetries: number
  baseDelay: number
  maxDelay: number
  backoffMultiplier: number
}

const RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2
}

export class JobService {
  private tableName = 'audio-conversion-jobs'
  private client: DynamoDBClient

  constructor(client?: DynamoDBClient) {
    this.client = client || dynamodbClient
  }

  /**
   * Create a new conversion job
   */
  async createJob(input: JobInput): Promise<Job> {
    const jobId = Date.now().toString()
    const now = new Date()
    const ttl = Math.floor(now.getTime() / 1000) + (24 * 60 * 60) // 24 hours from now

    const job: Job = {
      jobId,
      status: JobStatus.CREATED,
      inputS3Location: input.inputS3Location,
      format: input.format,
      quality: input.quality,
      createdAt: now,
      updatedAt: now,
      ttl
    }

    console.log(`[JobService] Creating job ${jobId} with input S3 location: ${input.inputS3Location.bucket}/${input.inputS3Location.key}`)

    try {
      await this.executeWithRetry(async () => {
        await this.client.send(new PutItemCommand({
          TableName: this.tableName,
          Item: marshall(job, { convertClassInstanceToMap: true }),
          ConditionExpression: 'attribute_not_exists(jobId)' // Ensure job doesn't already exist
        }))
      })

      console.log(`[JobService] Job ${jobId} created successfully with status: ${job.status}`)
      return job
    } catch (error) {
      console.error(`[JobService] Failed to create job ${jobId}:`, error)
      throw new Error(`Failed to create job: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Job | null> {
    console.log(`[JobService] Retrieving job ${jobId}`)

    try {
      const result = await this.executeWithRetry(async () => {
        return await this.client.send(new GetItemCommand({
          TableName: this.tableName,
          Key: marshall({ jobId })
        }))
      })

      if (!result.Item) {
        console.log(`[JobService] Job ${jobId} not found`)
        return null
      }

      const job = unmarshall(result.Item) as Job
      // Convert date strings back to Date objects
      job.createdAt = new Date(job.createdAt)
      job.updatedAt = new Date(job.updatedAt)

      console.log(`[JobService] Job ${jobId} retrieved successfully with status: ${job.status}`)
      return job
    } catch (error) {
      console.error(`[JobService] Failed to get job ${jobId}:`, error)
      throw new Error(`Failed to get job: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Update job status
   */
  async updateJobStatus(jobId: string, status: JobStatus, outputS3Location?: S3Location, error?: string): Promise<void> {
    const now = new Date()
    
    console.log(`[JobService] Updating job ${jobId} status from current to ${status}`)

    try {
      const updateExpression = ['SET #status = :status', '#updatedAt = :updatedAt']
      const expressionAttributeNames: Record<string, string> = {
        '#status': 'status',
        '#updatedAt': 'updatedAt'
      }
      const expressionAttributeValues: Record<string, any> = {
        ':status': status,
        ':updatedAt': now.toISOString()
      }

      if (outputS3Location) {
        updateExpression.push('#outputS3Location = :outputS3Location')
        expressionAttributeNames['#outputS3Location'] = 'outputS3Location'
        expressionAttributeValues[':outputS3Location'] = outputS3Location
      }

      if (error) {
        updateExpression.push('#error = :error')
        expressionAttributeNames['#error'] = 'error'
        expressionAttributeValues[':error'] = error
      }

      await this.executeWithRetry(async () => {
        await this.client.send(new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ jobId }),
          UpdateExpression: updateExpression.join(', '),
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: marshall(expressionAttributeValues),
          ConditionExpression: 'attribute_exists(jobId)' // Ensure job exists
        }))
      })

      console.log(`[JobService] Job ${jobId} status updated to ${status}${outputS3Location ? ` with output location: ${outputS3Location.bucket}/${outputS3Location.key}` : ''}${error ? ` with error: ${error}` : ''}`)
    } catch (error) {
      console.error(`[JobService] Failed to update job ${jobId} status:`, error)
      throw new Error(`Failed to update job status: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Clean up expired jobs (called periodically)
   */
  async cleanupExpiredJobs(): Promise<void> {
    console.log('[JobService] Starting cleanup of expired jobs')

    try {
      // Scan for jobs that should have expired (TTL might not have cleaned them up yet)
      const currentTime = Math.floor(Date.now() / 1000)
      
      const result = await this.executeWithRetry(async () => {
        return await this.client.send(new ScanCommand({
          TableName: this.tableName,
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
        console.log('[JobService] No expired jobs found for cleanup')
        return
      }

      console.log(`[JobService] Found ${result.Items.length} expired jobs to clean up`)

      // Delete expired jobs
      const deletePromises = result.Items.map(async (item) => {
        const job = unmarshall(item) as Job
        console.log(`[JobService] Deleting expired job ${job.jobId}`)
        
        try {
          await this.client.send(new DeleteItemCommand({
            TableName: this.tableName,
            Key: marshall({ jobId: job.jobId })
          }))
          console.log(`[JobService] Expired job ${job.jobId} deleted successfully`)
        } catch (error) {
          console.error(`[JobService] Failed to delete expired job ${job.jobId}:`, error)
        }
      })

      await Promise.all(deletePromises)
      console.log(`[JobService] Cleanup completed. Processed ${result.Items.length} expired jobs`)
    } catch (error) {
      console.error('[JobService] Failed to cleanup expired jobs:', error)
      throw new Error(`Failed to cleanup expired jobs: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Execute DynamoDB operation with retry logic
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null
    
    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error')
        
        if (attempt === RETRY_CONFIG.maxRetries) {
          break
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
          RETRY_CONFIG.maxDelay
        )

        console.log(`[JobService] Operation failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}), retrying in ${delay}ms:`, lastError.message)
        
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    throw lastError
  }
}

// Export singleton instance
export const jobService = new JobService()