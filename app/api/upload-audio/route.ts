import { NextRequest, NextResponse } from 'next/server'
import { s3Client, getRedisClient } from '../../../lib/aws-services'
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'

// Supported audio formats and MIME types
const SUPPORTED_FORMATS = ['mp3', 'wav', 'aac', 'ogg', 'm4a', 'flac']
const SUPPORTED_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/aac',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/flac'
]

// File size limits
const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB
const MIN_CHUNK_SIZE = 5 * 1024 * 1024 // 5MB minimum for multipart
const CHUNK_SIZE = 10 * 1024 * 1024 // 10MB chunks

interface UploadProgress {
  uploadId: string
  fileId: string
  fileName: string
  totalSize: number
  uploadedSize: number
  totalChunks: number
  completedChunks: number
  parts: Array<{ ETag: string; PartNumber: number }>
  s3Key: string
  bucketName: string
}

interface ValidationResult {
  valid: boolean
  error?: string
}

interface S3Location {
  bucket: string
  key: string
  size: number
}

// In-memory storage for upload progress (fallback when Redis is unavailable)
const uploadProgress = new Map<string, UploadProgress>()

// Utility functions
function generateFileId(): string {
  return `${Date.now()}-${randomUUID()}`
}

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  return lastDot > 0 ? fileName.substring(lastDot + 1).toLowerCase() : ''
}

function validateFile(file: File): ValidationResult {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`
    }
  }

  if (file.size === 0) {
    return {
      valid: false,
      error: 'File is empty'
    }
  }

  // Check file extension
  const extension = getFileExtension(file.name)
  if (!extension) {
    return {
      valid: false,
      error: 'File must have an extension'
    }
  }

  if (!SUPPORTED_FORMATS.includes(extension)) {
    return {
      valid: false,
      error: `Unsupported file format: .${extension}. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`
    }
  }

  // Check MIME type if available
  if (file.type && !SUPPORTED_MIME_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Unsupported MIME type: ${file.type}. File extension suggests ${extension} format.`
    }
  }

  return { valid: true }
}

function validateFileByName(fileName: string, fileSize: number): ValidationResult {
  // Check file size
  if (fileSize > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size ${(fileSize / 1024 / 1024).toFixed(1)}MB exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`
    }
  }

  if (fileSize === 0) {
    return {
      valid: false,
      error: 'File is empty'
    }
  }

  // Check file extension
  const extension = getFileExtension(fileName)
  if (!extension) {
    return {
      valid: false,
      error: 'File must have an extension'
    }
  }

  if (!SUPPORTED_FORMATS.includes(extension)) {
    return {
      valid: false,
      error: `Unsupported file format: .${extension}. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`
    }
  }

  return { valid: true }
}

// Retry utility with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error

      if (attempt === maxRetries) {
        throw lastError
      }

      const delay = baseDelay * Math.pow(2, attempt)
      console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError!
}

// Progress tracking utilities
async function storeUploadProgress(progress: UploadProgress): Promise<void> {
  try {
    const redis = await getRedisClient()
    await redis.setEx(
      `upload:${progress.fileId}`,
      3600, // 1 hour TTL
      JSON.stringify(progress)
    )
    console.log(`Upload progress stored in Redis for ${progress.fileId}`)
  } catch (error) {
    console.warn('Failed to store progress in Redis, using in-memory fallback:', error)
    uploadProgress.set(progress.fileId, progress)
  }
}

async function getUploadProgress(fileId: string): Promise<UploadProgress | null> {
  try {
    const redis = await getRedisClient()
    const data = await redis.get(`upload:${fileId}`)
    if (data) {
      return JSON.parse(data)
    }
  } catch (error) {
    console.warn('Failed to get progress from Redis, checking in-memory fallback:', error)
  }

  return uploadProgress.get(fileId) || null
}

async function deleteUploadProgress(fileId: string): Promise<void> {
  try {
    const redis = await getRedisClient()
    await redis.del(`upload:${fileId}`)
    console.log(`Upload progress deleted from Redis for ${fileId}`)
  } catch (error) {
    console.warn('Failed to delete progress from Redis:', error)
  }

  uploadProgress.delete(fileId)
}

export async function POST(request: NextRequest) {
  const bucketName = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'

  try {
    const contentType = request.headers.get('content-type') || ''

    console.log(`Upload request received - Content-Type: ${contentType}`)

    // Handle different upload types
    if (contentType.includes('multipart/form-data')) {
      return handleFormUpload(request, bucketName)
    } else if (contentType.includes('application/json')) {
      return handleChunkedUpload(request, bucketName)
    } else {
      return NextResponse.json({
        error: 'Unsupported content type',
        details: 'Expected multipart/form-data or application/json'
      }, { status: 400 })
    }
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({
      error: 'Upload failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

async function handleFormUpload(request: NextRequest, bucketName: string) {
  console.log('Handling form upload')

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    console.log(`File received: ${file.name}, size: ${file.size} bytes, type: ${file.type}`)

    // Validate file
    const validation = validateFile(file)
    if (!validation.valid) {
      console.log(`File validation failed: ${validation.error}`)
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Get fileId from form data or generate one
    const providedFileId = formData.get('fileId') as string
    const fileId = providedFileId || generateFileId()
    const extension = getFileExtension(file.name)
    const s3Key = `uploads/${fileId}.${extension}`

    console.log(`Uploading file: ${file.name} (${file.size} bytes) to ${s3Key}`)

    // For small files, use simple upload
    if (file.size < MIN_CHUNK_SIZE) {
      return handleSimpleUpload(file, bucketName, s3Key, fileId)
    } else {
      return handleMultipartFormUpload(file, bucketName, s3Key, fileId)
    }
  } catch (error) {
    console.error('Form upload error:', error)
    return NextResponse.json({
      error: 'Form upload failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

async function handleSimpleUpload(file: File, bucketName: string, s3Key: string, fileId: string) {
  try {
    console.log(`Using simple upload for file ${file.name}`)

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    await retryWithBackoff(async () => {
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: buffer,
        ContentType: file.type || 'application/octet-stream',
        Metadata: {
          originalName: file.name,
          fileId: fileId,
          uploadType: 'simple'
        }
      }))
    })

    console.log(`Simple upload completed: ${s3Key}`)

    return NextResponse.json({
      success: true,
      fileId,
      fileName: file.name,
      size: file.size,
      s3Location: {
        bucket: bucketName,
        key: s3Key,
        size: file.size
      }
    })
  } catch (error) {
    console.error('Simple upload error:', error)
    throw error
  }
}

async function handleMultipartFormUpload(file: File, bucketName: string, s3Key: string, fileId: string) {
  let uploadId: string | undefined

  try {
    console.log(`Using multipart upload for file ${file.name}`)

    // Initialize multipart upload
    const createResponse = await retryWithBackoff(async () => {
      return await s3Client.send(new CreateMultipartUploadCommand({
        Bucket: bucketName,
        Key: s3Key,
        ContentType: file.type || 'application/octet-stream',
        Metadata: {
          originalName: file.name,
          fileId: fileId,
          uploadType: 'multipart'
        }
      }))
    })

    uploadId = createResponse.UploadId!
    console.log(`Multipart upload initialized: ${uploadId}`)

    // Read file and upload in chunks
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const totalChunks = Math.ceil(buffer.length / CHUNK_SIZE)
    const parts: Array<{ ETag: string; PartNumber: number }> = []

    // Store initial progress
    const progress: UploadProgress = {
      uploadId,
      fileId,
      fileName: file.name,
      totalSize: file.size,
      uploadedSize: 0,
      totalChunks,
      completedChunks: 0,
      parts: [],
      s3Key,
      bucketName
    }
    await storeUploadProgress(progress)

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, buffer.length)
      const chunk = buffer.subarray(start, end)
      const partNumber = i + 1

      console.log(`Uploading part ${partNumber}/${totalChunks} (${chunk.length} bytes)`)

      const uploadPartResponse = await retryWithBackoff(async () => {
        return await s3Client.send(new UploadPartCommand({
          Bucket: bucketName,
          Key: s3Key,
          PartNumber: partNumber,
          UploadId: uploadId,
          Body: chunk
        }))
      })

      const part = {
        ETag: uploadPartResponse.ETag!,
        PartNumber: partNumber
      }
      parts.push(part)

      // Update progress
      progress.parts.push(part)
      progress.completedChunks = i + 1
      progress.uploadedSize = Math.min(start + chunk.length, file.size)
      await storeUploadProgress(progress)

      console.log(`Part ${partNumber} uploaded successfully, progress: ${Math.round((progress.uploadedSize / progress.totalSize) * 100)}%`)
    }

    // Complete multipart upload
    await retryWithBackoff(async () => {
      await s3Client.send(new CompleteMultipartUploadCommand({
        Bucket: bucketName,
        Key: s3Key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber)
        }
      }))
    })

    console.log(`Multipart upload completed: ${s3Key}`)

    // Clean up progress tracking
    await deleteUploadProgress(fileId)

    return NextResponse.json({
      success: true,
      fileId,
      fileName: file.name,
      size: file.size,
      s3Location: {
        bucket: bucketName,
        key: s3Key,
        size: file.size
      }
    })
  } catch (error) {
    console.error('Multipart upload error:', error)

    // Abort multipart upload on error
    if (uploadId) {
      try {
        await s3Client.send(new AbortMultipartUploadCommand({
          Bucket: bucketName,
          Key: s3Key,
          UploadId: uploadId
        }))
        console.log(`Multipart upload aborted: ${uploadId}`)
      } catch (abortError) {
        console.error('Failed to abort multipart upload:', abortError)
      }
    }

    // Clean up progress tracking
    await deleteUploadProgress(fileId)

    throw error
  }
}

async function handleChunkedUpload(request: NextRequest, bucketName: string) {
  const body = await request.json()
  const { action, fileId, fileName, fileSize, chunkIndex, totalChunks, chunk } = body

  console.log(`Chunked upload action: ${action}, fileId: ${fileId}`)

  switch (action) {
    case 'initiate':
      return initiateChunkedUpload(fileName, fileSize, bucketName)
    case 'upload':
      return uploadChunk(fileId, chunkIndex, totalChunks, chunk, bucketName)
    case 'complete':
      return completeChunkedUpload(fileId, bucketName)
    case 'abort':
      return abortChunkedUpload(fileId, bucketName)
    case 'status':
      return getUploadStatus(fileId)
    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
}

async function initiateChunkedUpload(fileName: string, fileSize: number, bucketName: string) {
  console.log(`Initiating chunked upload for ${fileName} (${fileSize} bytes)`)

  // Validate file
  const validation = validateFileByName(fileName, fileSize)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const fileId = generateFileId()
  const extension = getFileExtension(fileName)
  const s3Key = `uploads/${fileId}.${extension}`

  try {
    // Initialize multipart upload
    const createResponse = await retryWithBackoff(async () => {
      return await s3Client.send(new CreateMultipartUploadCommand({
        Bucket: bucketName,
        Key: s3Key,
        Metadata: {
          originalName: fileName,
          fileId: fileId,
          uploadType: 'chunked'
        }
      }))
    })

    const uploadId = createResponse.UploadId!
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE)

    // Store upload progress
    const progress: UploadProgress = {
      uploadId,
      fileId,
      fileName,
      totalSize: fileSize,
      uploadedSize: 0,
      totalChunks,
      completedChunks: 0,
      parts: [],
      s3Key,
      bucketName
    }
    await storeUploadProgress(progress)

    console.log(`Chunked upload initiated: ${fileId} (${uploadId})`)

    return NextResponse.json({
      success: true,
      fileId,
      uploadId,
      chunkSize: CHUNK_SIZE,
      totalChunks
    })
  } catch (error) {
    console.error('Failed to initiate chunked upload:', error)
    return NextResponse.json({
      error: 'Failed to initiate upload',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

async function uploadChunk(fileId: string, chunkIndex: number, totalChunks: number, chunkData: string, bucketName: string) {
  console.log(`Uploading chunk ${chunkIndex + 1}/${totalChunks} for ${fileId}`)

  try {
    const progress = await getUploadProgress(fileId)
    if (!progress) {
      return NextResponse.json({ error: 'Upload session not found' }, { status: 404 })
    }

    // Decode base64 chunk data
    const chunkBuffer = Buffer.from(chunkData, 'base64')
    const partNumber = chunkIndex + 1

    // Upload chunk
    const uploadPartResponse = await retryWithBackoff(async () => {
      return await s3Client.send(new UploadPartCommand({
        Bucket: progress.bucketName,
        Key: progress.s3Key,
        PartNumber: partNumber,
        UploadId: progress.uploadId,
        Body: chunkBuffer
      }))
    })

    // Update progress
    const part = {
      ETag: uploadPartResponse.ETag!,
      PartNumber: partNumber
    }
    progress.parts.push(part)
    progress.completedChunks = chunkIndex + 1
    progress.uploadedSize += chunkBuffer.length
    await storeUploadProgress(progress)

    const progressPercent = Math.round((progress.uploadedSize / progress.totalSize) * 100)
    console.log(`Chunk ${partNumber} uploaded successfully, progress: ${progressPercent}%`)

    return NextResponse.json({
      success: true,
      chunkIndex,
      progress: progressPercent,
      uploadedSize: progress.uploadedSize,
      totalSize: progress.totalSize
    })
  } catch (error) {
    console.error(`Failed to upload chunk ${chunkIndex}:`, error)
    return NextResponse.json({
      error: 'Chunk upload failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

async function completeChunkedUpload(fileId: string, bucketName: string) {
  console.log(`Completing chunked upload for ${fileId}`)

  try {
    const progress = await getUploadProgress(fileId)
    if (!progress) {
      return NextResponse.json({ error: 'Upload session not found' }, { status: 404 })
    }

    if (progress.completedChunks !== progress.totalChunks) {
      return NextResponse.json({
        error: 'Upload incomplete',
        details: `${progress.completedChunks}/${progress.totalChunks} chunks uploaded`
      }, { status: 400 })
    }

    // Complete multipart upload
    await retryWithBackoff(async () => {
      await s3Client.send(new CompleteMultipartUploadCommand({
        Bucket: progress.bucketName,
        Key: progress.s3Key,
        UploadId: progress.uploadId,
        MultipartUpload: {
          Parts: progress.parts.sort((a, b) => a.PartNumber - b.PartNumber)
        }
      }))
    })

    console.log(`Chunked upload completed: ${progress.s3Key}`)

    // Clean up progress tracking
    await deleteUploadProgress(fileId)

    return NextResponse.json({
      success: true,
      fileId,
      fileName: progress.fileName,
      size: progress.totalSize,
      s3Location: {
        bucket: progress.bucketName,
        key: progress.s3Key,
        size: progress.totalSize
      }
    })
  } catch (error) {
    console.error('Failed to complete chunked upload:', error)
    return NextResponse.json({
      error: 'Failed to complete upload',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

async function abortChunkedUpload(fileId: string, bucketName: string) {
  console.log(`Aborting chunked upload for ${fileId}`)

  try {
    const progress = await getUploadProgress(fileId)
    if (!progress) {
      return NextResponse.json({ error: 'Upload session not found' }, { status: 404 })
    }

    // Abort multipart upload
    await s3Client.send(new AbortMultipartUploadCommand({
      Bucket: progress.bucketName,
      Key: progress.s3Key,
      UploadId: progress.uploadId
    }))

    console.log(`Chunked upload aborted: ${progress.uploadId}`)

    // Clean up progress tracking
    await deleteUploadProgress(fileId)

    return NextResponse.json({
      success: true,
      message: 'Upload aborted successfully'
    })
  } catch (error) {
    console.error('Failed to abort chunked upload:', error)
    return NextResponse.json({
      error: 'Failed to abort upload',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

async function getUploadStatus(fileId: string) {
  try {
    const progress = await getUploadProgress(fileId)
    if (!progress) {
      return NextResponse.json({ error: 'Upload session not found' }, { status: 404 })
    }

    const progressPercent = Math.round((progress.uploadedSize / progress.totalSize) * 100)

    return NextResponse.json({
      success: true,
      fileId: progress.fileId,
      fileName: progress.fileName,
      progress: progressPercent,
      uploadedSize: progress.uploadedSize,
      totalSize: progress.totalSize,
      completedChunks: progress.completedChunks,
      totalChunks: progress.totalChunks
    })
  } catch (error) {
    console.error('Failed to get upload status:', error)
    return NextResponse.json({
      error: 'Failed to get upload status',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
