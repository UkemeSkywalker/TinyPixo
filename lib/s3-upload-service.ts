import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { createReadStream, statSync } from 'fs'
import { progressService } from './progress-service'
import { getEnvironmentConfig } from './environment'

export interface S3UploadOptions {
  bucket: string
  key: string
  filePath: string
  jobId: string
  contentType?: string
  chunkSize?: number // Default 10MB chunks
}

export interface S3UploadResult {
  location: string
  bucket: string
  key: string
  etag: string
  size: number
}

export class S3UploadService {
  private client: S3Client
  private readonly DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024 // 10MB

  constructor(client?: S3Client) {
    if (client) {
      this.client = client
    } else {
      const config = getEnvironmentConfig()
      this.client = new S3Client({
        region: config.s3.region,
        credentials: config.s3.credentials
      })
    }
  }

  /**
   * Upload file to S3 with progress tracking
   */
  async uploadWithProgress(options: S3UploadOptions): Promise<S3UploadResult> {
    const { bucket, key, filePath, jobId, contentType = 'application/octet-stream', chunkSize = this.DEFAULT_CHUNK_SIZE } = options

    console.log(`[S3UploadService] Starting upload for job ${jobId}: ${filePath} -> s3://${bucket}/${key}`)

    try {
      // Get file size
      const fileStats = statSync(filePath)
      const fileSize = fileStats.size

      console.log(`[S3UploadService] File size: ${this.formatBytes(fileSize)} for job ${jobId}`)

      // For small files, use single upload
      if (fileSize <= chunkSize) {
        return await this.singleUpload(options, fileSize)
      }

      // For large files, use multipart upload
      return await this.multipartUpload(options, fileSize, chunkSize)
    } catch (error) {
      console.error(`[S3UploadService] Upload failed for job ${jobId}:`, error)
      throw new Error(`S3 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Single upload for small files using streaming (no memory buffer)
   */
  private async singleUpload(options: S3UploadOptions, fileSize: number): Promise<S3UploadResult> {
    const { bucket, key, filePath, jobId, contentType } = options

    console.log(`[S3UploadService] Using single upload with streaming for job ${jobId}`)

    // Update progress to show upload starting
    await progressService.updateS3UploadProgress(jobId, 0, fileSize)

    // Create read stream from file (no memory buffer)
    const fileStream = createReadStream(filePath)
    
    console.log(`[S3UploadService] Starting S3 upload with streaming for job ${jobId}`)
    const uploadResult = await this.client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: contentType,
      ContentLength: fileSize
    }))

    // Update progress to 100% after successful upload
    await progressService.updateS3UploadProgress(jobId, fileSize, fileSize)

    console.log(`[S3UploadService] Single upload completed for job ${jobId}`)

    return {
      location: `https://${bucket}.s3.amazonaws.com/${key}`,
      bucket,
      key,
      etag: uploadResult.ETag || '',
      size: fileSize
    }
  }

  /**
   * Multipart upload for large files
   */
  private async multipartUpload(options: S3UploadOptions, fileSize: number, chunkSize: number): Promise<S3UploadResult> {
    const { bucket, key, filePath, jobId, contentType } = options

    console.log(`[S3UploadService] Using multipart upload for job ${jobId} (${Math.ceil(fileSize / chunkSize)} parts)`)

    let uploadId: string | undefined
    const uploadedParts: Array<{ ETag: string; PartNumber: number }> = []

    try {
      // Initialize multipart upload
      const createResult = await this.client.send(new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType
      }))

      uploadId = createResult.UploadId
      if (!uploadId) {
        throw new Error('Failed to initialize multipart upload')
      }

      console.log(`[S3UploadService] Multipart upload initialized for job ${jobId}: ${uploadId}`)

      // Upload parts
      const totalParts = Math.ceil(fileSize / chunkSize)
      let uploadedBytes = 0

      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const start = (partNumber - 1) * chunkSize
        const end = Math.min(start + chunkSize, fileSize)
        const partSize = end - start

        console.log(`[S3UploadService] Uploading part ${partNumber}/${totalParts} for job ${jobId} (${this.formatBytes(partSize)})`)

        // Create stream for this part
        const partStream = createReadStream(filePath, { start, end: end - 1 })

        // Upload part
        const uploadPartResult = await this.client.send(new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          PartNumber: partNumber,
          UploadId: uploadId,
          Body: partStream,
          ContentLength: partSize
        }))

        if (!uploadPartResult.ETag) {
          throw new Error(`Failed to upload part ${partNumber}`)
        }

        uploadedParts.push({
          ETag: uploadPartResult.ETag,
          PartNumber: partNumber
        })

        // Update progress
        uploadedBytes += partSize
        await progressService.updateS3UploadProgress(jobId, uploadedBytes, fileSize)

        console.log(`[S3UploadService] Part ${partNumber}/${totalParts} uploaded for job ${jobId} (${Math.round((uploadedBytes / fileSize) * 100)}%)`)
      }

      // Complete multipart upload
      const completeResult = await this.client.send(new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber)
        }
      }))

      console.log(`[S3UploadService] Multipart upload completed for job ${jobId}`)

      return {
        location: completeResult.Location || `https://${bucket}.s3.amazonaws.com/${key}`,
        bucket,
        key,
        etag: completeResult.ETag || '',
        size: fileSize
      }
    } catch (error) {
      // Abort multipart upload on error
      if (uploadId) {
        try {
          await this.client.send(new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId
          }))
          console.log(`[S3UploadService] Multipart upload aborted for job ${jobId}`)
        } catch (abortError) {
          console.error(`[S3UploadService] Failed to abort multipart upload for job ${jobId}:`, abortError)
        }
      }

      throw error
    }
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }
}

// Export singleton instance
export const s3UploadService = new S3UploadService()