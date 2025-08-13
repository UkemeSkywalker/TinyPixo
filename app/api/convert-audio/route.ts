import { NextRequest, NextResponse } from 'next/server'
import { jobService, JobStatus, S3Location } from '../../../lib/job-service'
import { progressService } from '../../../lib/progress-service'
import { streamingConversionServiceFixed as streamingConversionService } from '../../../lib/streaming-conversion-service-fixed'
import { s3Client } from '../../../lib/aws-services'
import { HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

interface ConversionRequest {
  fileId: string
  format: string
  quality: string
  bucket?: string
}

interface ConversionResponse {
  jobId: string
  status: string
  message: string
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

/**
 * POST /api/convert-audio - Orchestrate audio conversion workflow
 * 
 * Request body:
 * {
 *   "fileId": "audio-123",
 *   "format": "wav",
 *   "quality": "192k",
 *   "bucket": "audio-conversion-bucket" // optional, defaults to environment
 * }
 * 
 * Response:
 * {
 *   "jobId": "1754408209622",
 *   "status": "created",
 *   "message": "Conversion job created successfully"
 * }
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  let jobId: string | null = null

  try {
    console.log('[ConversionAPI] Starting conversion orchestration request')

    // Parse and validate request
    const requestData = await parseAndValidateRequest(request)
    console.log(`[ConversionAPI] Validated request: fileId=${requestData.fileId}, format=${requestData.format}, quality=${requestData.quality}`)

    // Verify input file exists in S3
    const inputS3Location = await verifyInputFile(requestData)
    console.log(`[ConversionAPI] Input file verified: ${inputS3Location.bucket}/${inputS3Location.key} (${inputS3Location.size} bytes)`)

    // Create conversion job
    const job = await createConversionJob(inputS3Location, requestData)
    jobId = job.jobId
    console.log(`[ConversionAPI] Job created: ${jobId}`)

    // Initialize progress tracking
    await initializeProgressTracking(jobId)
    console.log(`[ConversionAPI] Progress tracking initialized for job ${jobId}`)

    // Start conversion process asynchronously
    startConversionProcess(job, requestData)
      .catch(error => {
        console.error(`[ConversionAPI] Async conversion process failed for job ${jobId}:`, error)
        // Update job status to failed
        handleConversionError(jobId, error)
      })

    const responseTime = Date.now() - startTime
    console.log(`[ConversionAPI] Job ${jobId} created successfully in ${responseTime}ms`)

    // Return job ID immediately (async processing continues in background)
    return NextResponse.json({
      jobId,
      status: 'created',
      message: 'Conversion job created successfully'
    } as ConversionResponse, {
      status: 202, // Accepted - processing will continue asynchronously
      headers: {
        'X-Response-Time': `${responseTime}ms`,
        'X-Job-Id': jobId
      }
    })

  } catch (error) {
    const responseTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    console.error(`[ConversionAPI] Request failed after ${responseTime}ms:`, error)

    // If we created a job but failed later, mark it as failed
    if (jobId) {
      await handleConversionError(jobId, error)
    }

    // Determine appropriate HTTP status code
    const statusCode = getErrorStatusCode(error)

    return NextResponse.json({
      error: errorMessage,
      details: getErrorDetails(error)
    }, {
      status: statusCode, // 400, 404, 429, 500, etc.
      headers: {
        'X-Response-Time': `${responseTime}ms`
      }
    })
  }
}

/**
 * Parse and validate the conversion request
 */
async function parseAndValidateRequest(request: NextRequest): Promise<ConversionRequest> {
  let requestData: ConversionRequest

  try {
    requestData = await request.json()
  } catch (error) {
    throw new Error('Invalid JSON in request body')
  }

  // Validate required fields
  if (!requestData.fileId) {
    throw new Error('Missing required field: fileId')
  }

  if (!requestData.format) {
    throw new Error('Missing required field: format')
  }

  if (!requestData.quality) {
    throw new Error('Missing required field: quality')
  }

  // Validate format
  const supportedFormats = ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a']
  if (!supportedFormats.includes(requestData.format.toLowerCase())) {
    throw new Error(`Unsupported format: ${requestData.format}. Supported formats: ${supportedFormats.join(', ')}`)
  }

  // Validate quality
  const qualityPattern = /^\d+k?$/i
  if (!qualityPattern.test(requestData.quality)) {
    throw new Error(`Invalid quality format: ${requestData.quality}. Expected format: 128k, 192k, 320k, etc.`)
  }

  // Set default bucket if not provided
  if (!requestData.bucket) {
    requestData.bucket = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'
  }

  return requestData
}

/**
 * Verify that the input file exists in S3 and get its metadata
 */
async function verifyInputFile(requestData: ConversionRequest): Promise<S3Location> {
  try {
    console.log(`[ConversionAPI] Looking for input file with fileId: ${requestData.fileId}`)

    // First, try to find the file by listing objects with the fileId prefix
    const listResult = await executeWithRetry(async () => {
      return await s3Client.send(new ListObjectsV2Command({
        Bucket: requestData.bucket,
        Prefix: `uploads/${requestData.fileId}`,
        MaxKeys: 10
      }))
    })

    if (!listResult.Contents || listResult.Contents.length === 0) {
      throw new Error(`Input file not found: ${requestData.fileId}. Please upload the file first.`)
    }

    // Find the exact file (should be uploads/fileId.extension)
    const matchingFile = listResult.Contents.find(obj => {
      const key = obj.Key || ''
      // Match pattern: uploads/fileId.extension (not just uploads/fileId-something)
      const pattern = new RegExp(`^uploads/${requestData.fileId}\\.[a-zA-Z0-9]+$`)
      return pattern.test(key)
    })

    if (!matchingFile || !matchingFile.Key) {
      console.log(`[ConversionAPI] Available files:`, listResult.Contents.map(obj => obj.Key))
      throw new Error(`Input file not found: ${requestData.fileId}. Please upload the file first.`)
    }

    const inputKey = matchingFile.Key
    console.log(`[ConversionAPI] Found input file: ${requestData.bucket}/${inputKey}`)

    // Verify the file exists and get its metadata
    const headResult = await executeWithRetry(async () => {
      return await s3Client.send(new HeadObjectCommand({
        Bucket: requestData.bucket,
        Key: inputKey
      }))
    })

    if (!headResult.ContentLength) {
      throw new Error('Input file has no content length')
    }

    return {
      bucket: requestData.bucket!,
      key: inputKey,
      size: headResult.ContentLength
    }

  } catch (error) {
    if (error instanceof Error && error.name === 'NotFound') {
      throw new Error(`Input file not found: ${requestData.fileId}. Please upload the file first.`)
    }
    
    console.error(`[ConversionAPI] Failed to verify input file for fileId ${requestData.fileId}:`, error)
    throw new Error(`Failed to verify input file: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Create a new conversion job in DynamoDB
 */
async function createConversionJob(inputS3Location: S3Location, requestData: ConversionRequest) {
  try {
    const job = await executeWithRetry(async () => {
      return await jobService.createJob({
        inputS3Location,
        format: requestData.format,
        quality: requestData.quality
      })
    })

    console.log(`[ConversionAPI] Job created in DynamoDB: ${job.jobId}`)
    return job

  } catch (error) {
    console.error('[ConversionAPI] Failed to create job in DynamoDB:', error)
    throw new Error(`Failed to create conversion job: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Initialize progress tracking in DynamoDB
 */
async function initializeProgressTracking(jobId: string): Promise<void> {
  try {
    await executeWithRetry(async () => {
      await progressService.initializeProgress(jobId)
    })

    console.log(`[ConversionAPI] Progress tracking initialized for job ${jobId}`)

  } catch (error) {
    console.error(`[ConversionAPI] Failed to initialize progress tracking for job ${jobId}:`, error)
    // Don't throw error - progress tracking failure shouldn't block job creation
    console.warn(`[ConversionAPI] Continuing without progress tracking for job ${jobId}`)
  }
}

/**
 * Start the conversion process asynchronously
 */
async function startConversionProcess(job: any, requestData: ConversionRequest): Promise<void> {
  const jobId = job.jobId

  try {
    console.log(`[ConversionAPI] Starting async conversion process for job ${jobId}`)

    // Update job status to processing
    await updateJobStatus(jobId, JobStatus.PROCESSING)

    // Update progress to show processing has started
    await progressService.setProgress(jobId, {
      jobId,
      progress: 10,
      stage: 'starting conversion process',
      phase: 'conversion'
    })

    // Calculate timeout based on file size (more time for larger files)
    const fileSizeMB = job.inputS3Location.size / (1024 * 1024)
    let timeoutMs = 300000 // Base 5 minutes
    
    if (fileSizeMB > 50) {
      // For files > 50MB: 10 minutes base + 2 minutes per additional 50MB
      timeoutMs = 600000 + Math.ceil((fileSizeMB - 50) / 50) * 120000
    } else if (fileSizeMB > 10) {
      // For files > 10MB: 7 minutes
      timeoutMs = 420000
    }
    
    // Cap at 60 minutes for very large files
    timeoutMs = Math.min(timeoutMs, 3600000)
    
    console.log(`[ConversionAPI] File size: ${fileSizeMB.toFixed(1)}MB, timeout: ${(timeoutMs/60000).toFixed(1)} minutes`)

    // Perform the actual conversion using streaming service
    const conversionResult = await streamingConversionService.convertAudio(job, {
      format: requestData.format,
      quality: requestData.quality,
      timeout: timeoutMs
    })

    if (conversionResult.success && conversionResult.outputS3Location) {
      // Update job status to completed with output location
      await updateJobStatus(jobId, JobStatus.COMPLETED, conversionResult.outputS3Location)

      // Add a delay to ensure DynamoDB consistency before marking progress complete
      await new Promise(resolve => setTimeout(resolve, 250))

      // Verify the job status was updated before marking progress complete
      try {
        const verifyJob = await jobService.getJob(jobId)
        if (verifyJob?.status !== JobStatus.COMPLETED) {
          console.warn(`[ConversionAPI] Job status verification failed for ${jobId}, expected COMPLETED but got ${verifyJob?.status}`)
          // Add additional delay and retry once
          await new Promise(resolve => setTimeout(resolve, 250))
        }
      } catch (error) {
        console.warn(`[ConversionAPI] Job status verification error for ${jobId}:`, error)
      }

      // Mark progress as complete
      await progressService.markComplete(jobId)

      console.log(`[ConversionAPI] Conversion completed successfully for job ${jobId}: ${conversionResult.outputS3Location.key}`)
      console.log(`[ConversionAPI] Processing time: ${conversionResult.processingTimeMs}ms, Fallback used: ${conversionResult.fallbackUsed}`)

    } else {
      // Conversion failed
      const errorMessage = conversionResult.error || 'Conversion failed for unknown reason'
      await updateJobStatus(jobId, JobStatus.FAILED, undefined, errorMessage)
      await progressService.markFailed(jobId, errorMessage)

      console.error(`[ConversionAPI] Conversion failed for job ${jobId}: ${errorMessage}`)
    }

  } catch (error) {
    console.error(`[ConversionAPI] Conversion process error for job ${jobId}:`, error)
    await handleConversionError(jobId, error)
  }
}

/**
 * Update job status in DynamoDB with retry logic
 */
async function updateJobStatus(
  jobId: string, 
  status: JobStatus, 
  outputS3Location?: S3Location, 
  error?: string
): Promise<void> {
  try {
    await executeWithRetry(async () => {
      await jobService.updateJobStatus(jobId, status, outputS3Location, error)
    })

    console.log(`[ConversionAPI] Job ${jobId} status updated to ${status}`)

  } catch (updateError) {
    console.error(`[ConversionAPI] Failed to update job ${jobId} status to ${status}:`, updateError)
    // Don't throw - status update failure shouldn't break the main flow
  }
}

/**
 * Handle conversion errors by updating job status and progress
 */
async function handleConversionError(jobId: string, error: any): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : 'Unknown conversion error'

  try {
    // Update job status to failed
    await updateJobStatus(jobId, JobStatus.FAILED, undefined, errorMessage)

    // Mark progress as failed
    await progressService.markFailed(jobId, errorMessage)

    console.log(`[ConversionAPI] Error handling completed for job ${jobId}`)

  } catch (handlingError) {
    console.error(`[ConversionAPI] Failed to handle error for job ${jobId}:`, handlingError)
  }
}

/**
 * Get appropriate HTTP status code for different error types
 */
function getErrorStatusCode(error: any): number {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    
    if (message.includes('not found') || message.includes('missing')) {
      return 404
    }
    
    if (message.includes('invalid') || message.includes('unsupported')) {
      return 400
    }
    
    if (message.includes('quota') || message.includes('limit') || message.includes('throttl')) {
      return 429
    }
    
    if (message.includes('timeout')) {
      return 408
    }
    
    if (message.includes('permission') || message.includes('access denied')) {
      return 403
    }
  }
  
  return 500 // Internal server error
}

/**
 * Get detailed error information for debugging
 */
function getErrorDetails(error: any): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  
  return 'Unknown error occurred'
}

/**
 * Execute operation with retry logic for AWS service calls
 */
async function executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
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

      console.log(`[ConversionAPI] Operation failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}), retrying in ${delay}ms:`, lastError.message)
      
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * Job recovery logic - check for orphaned jobs and handle them
 * This function can be called periodically or on startup
 */
async function recoverOrphanedJobs(): Promise<void> {
  console.log('[ConversionAPI] Starting orphaned job recovery process')

  try {
    // This would typically scan DynamoDB for jobs in 'processing' state that are older than a threshold
    // For now, we'll implement a basic version that logs the intent
    
    console.log('[ConversionAPI] Orphaned job recovery completed')
    
    // In a full implementation, this would:
    // 1. Scan DynamoDB for jobs with status='processing' and old timestamps
    // 2. Check if the conversion process is still running
    // 3. Either resume the job or mark it as failed
    // 4. Clean up any temporary resources
    
  } catch (error) {
    console.error('[ConversionAPI] Orphaned job recovery failed:', error)
  }
}