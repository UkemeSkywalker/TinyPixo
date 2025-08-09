import { NextRequest, NextResponse } from 'next/server'
import { jobService, JobStatus } from '../../../lib/job-service'
import { s3Client } from '../../../lib/aws-services'
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * Download converted audio files from S3 with streaming support
 * Supports both direct streaming and presigned URL generation
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('jobId')
    const presigned = searchParams.get('presigned') === 'true'

    console.log(`[Download] Request started - jobId: ${jobId}, presigned: ${presigned}`)

    if (!jobId) {
      console.log('[Download] Missing jobId parameter')
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 })
    }

    // Validate download access
    const accessValidation = await validateDownloadAccess(jobId)
    if (!accessValidation.valid) {
      console.log(`[Download] Access validation failed: ${accessValidation.error}`)
      return NextResponse.json({
        error: accessValidation.error
      }, { status: accessValidation.statusCode })
    }

    const job = accessValidation.job!

    console.log(`[Download] Access validated for job ${jobId}, file: ${job.outputS3Location!.key}`)

    // Generate presigned URL if requested
    if (presigned) {
      const presignedUrl = await generatePresignedUrl(job.outputS3Location!.bucket, job.outputS3Location!.key)
      console.log(`[Download] Generated presigned URL for job ${jobId}`)

      return NextResponse.json({
        presignedUrl,
        filename: generateFilename(jobId, job.format),
        contentType: getContentType(job.format),
        size: job.outputS3Location!.size
      })
    }

    // Stream file directly from S3
    return await streamFileFromS3(job.outputS3Location!.bucket, job.outputS3Location!.key, jobId, job.format, startTime)

  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[Download] Error after ${duration}ms:`, error)

    return NextResponse.json({
      error: 'Failed to download file',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

/**
 * Validate download access for a job
 */
async function validateDownloadAccess(jobId: string): Promise<{
  valid: boolean
  error?: string
  statusCode?: number
  job?: any
}> {
  try {
    // Get job from DynamoDB
    const job = await jobService.getJob(jobId)
    if (!job) {
      console.log(`[Download] Job ${jobId} not found in database`)
      return {
        valid: false,
        error: 'Job not found',
        statusCode: 404
      }
    }

    console.log(`[Download] Job ${jobId} found with status: ${job.status}, outputS3Location: ${job.outputS3Location ? 'present' : 'missing'}`)

    // Check if conversion is completed
    if (job.status !== JobStatus.COMPLETED) {
      console.log(`[Download] Job ${jobId} status check failed - current status: ${job.status}, expected: ${JobStatus.COMPLETED}`)

      // Provide more specific error messages
      let errorMessage: string
      let statusCode: number

      switch (job.status) {
        case JobStatus.FAILED:
          errorMessage = job.error || 'Conversion failed'
          statusCode = 410
          break
        case JobStatus.PROCESSING:
          errorMessage = 'Conversion is still in progress, please wait'
          statusCode = 400
          break
        case JobStatus.CREATED:
          errorMessage = 'Conversion has not started yet'
          statusCode = 400
          break
        default:
          errorMessage = 'Conversion not completed yet'
          statusCode = 400
      }

      return {
        valid: false,
        error: errorMessage,
        statusCode
      }
    }

    // Check if output file exists
    if (!job.outputS3Location) {
      return {
        valid: false,
        error: 'Output file not available',
        statusCode: 404
      }
    }

    // Verify file exists in S3
    try {
      await s3Client.send(new HeadObjectCommand({
        Bucket: job.outputS3Location.bucket,
        Key: job.outputS3Location.key
      }))
    } catch (s3Error: any) {
      if (s3Error.name === 'NotFound') {
        return {
          valid: false,
          error: 'File not found in storage',
          statusCode: 404
        }
      }
      throw s3Error
    }

    return {
      valid: true,
      job
    }
  } catch (error) {
    console.error('[Download] Access validation error:', error)
    return {
      valid: false,
      error: 'Failed to validate download access',
      statusCode: 500
    }
  }
}

/**
 * Stream file directly from S3 without loading into memory
 */
async function streamFileFromS3(bucket: string, key: string, jobId: string, format: string, startTime: number): Promise<NextResponse> {
  try {
    console.log(`[Download] Starting S3 stream for ${bucket}/${key}`)

    // Get object metadata first
    const headResponse = await s3Client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: key
    }))

    const contentLength = headResponse.ContentLength || 0
    const lastModified = headResponse.LastModified
    const etag = headResponse.ETag

    console.log(`[Download] File metadata - size: ${contentLength} bytes, lastModified: ${lastModified}`)

    // Get the object stream
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key
    }))

    if (!response.Body) {
      throw new Error('No body in S3 response')
    }

    // Convert AWS SDK stream to web stream
    const webStream = new ReadableStream({
      start(controller) {
        // Handle different stream types from AWS SDK
        const stream = response.Body as any

        if (stream.getReader) {
          // If it's already a ReadableStream
          const reader = stream.getReader()

          function pump(): Promise<void> {
            return reader.read().then(({ done, value }) => {
              if (done) {
                controller.close()
                return
              }
              controller.enqueue(value)
              return pump()
            }).catch(error => {
              console.error('[Download] Stream error:', error)
              controller.error(error)
            })
          }

          return pump()
        } else {
          // Handle Node.js Readable stream
          stream.on('data', (chunk: any) => {
            controller.enqueue(new Uint8Array(chunk))
          })

          stream.on('end', () => {
            controller.close()
          })

          stream.on('error', (error: any) => {
            console.error('[Download] Stream error:', error)
            controller.error(error)
          })
        }
      }
    })

    const filename = generateFilename(jobId, format)
    const contentType = getContentType(format)

    const duration = Date.now() - startTime
    console.log(`[Download] Stream setup completed in ${duration}ms, starting file transfer: ${filename}`)

    // Return streaming response with proper headers
    return new NextResponse(webStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': contentLength.toString(),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Job-Id': jobId,
        'X-File-Size': contentLength.toString(),
        'X-Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        ...(etag && { 'ETag': etag }),
        ...(lastModified && { 'Last-Modified': lastModified.toUTCString() })
      }
    })

  } catch (error) {
    console.error(`[Download] S3 streaming error for ${bucket}/${key}:`, error)
    throw error
  }
}

/**
 * Generate presigned URL for direct S3 download
 */
async function generatePresignedUrl(bucket: string, key: string): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })

    // Generate presigned URL valid for 1 hour
    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600 // 1 hour
    })

    console.log(`[Download] Generated presigned URL for ${bucket}/${key}`)
    return presignedUrl

  } catch (error) {
    console.error(`[Download] Failed to generate presigned URL for ${bucket}/${key}:`, error)
    throw new Error(`Failed to generate presigned URL: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Generate appropriate filename for download
 */
function generateFilename(jobId: string, format: string): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
  return `converted-${jobId}-${timestamp}.${format}`
}

/**
 * Get MIME type for audio format
 */
function getContentType(format: string): string {
  const contentTypes: Record<string, string> = {
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'aac': 'audio/aac',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
    'm4a': 'audio/mp4',
    'wma': 'audio/x-ms-wma',
    'opus': 'audio/opus'
  }
  return contentTypes[format.toLowerCase()] || 'application/octet-stream'
}