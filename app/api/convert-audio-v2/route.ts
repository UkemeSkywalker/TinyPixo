import { NextRequest, NextResponse } from 'next/server'
import { streamingConversionServiceFixed as streamingConversionService } from '../../../lib/streaming-conversion-service-fixed'
import { jobService, JobStatus } from '../../../lib/job-service'
import { s3Client } from '../../../lib/aws-services'
import { PutObjectCommand } from '@aws-sdk/client-s3'

/**
 * New Streaming Audio Conversion API
 * 
 * This replaces the old file-based conversion with the new streaming service
 * that provides better performance, progress tracking, and reliability.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('audio') as File
    const format = formData.get('format') as string
    const quality = formData.get('quality') as string

    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    if (!format || !quality) {
      return NextResponse.json({ error: 'Format and quality are required' }, { status: 400 })
    }

    console.log(`[ConvertAudioV2] Starting conversion: ${file.name} -> ${format} at ${quality}`)

    // Upload file to S3
    const inputKey = `uploads/${Date.now()}-${file.name}`
    const bucket = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'

    const fileBuffer = Buffer.from(await file.arrayBuffer())

    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: inputKey,
      Body: fileBuffer,
      ContentType: file.type || 'audio/mpeg'
    }))

    console.log(`[ConvertAudioV2] File uploaded to S3: ${inputKey}`)

    // Create job in DynamoDB
    const job = await jobService.createJob({
      inputS3Location: {
        bucket,
        key: inputKey,
        size: fileBuffer.length
      },
      format,
      quality
    })

    console.log(`[ConvertAudioV2] Job created: ${job.jobId}`)

    // Start streaming conversion
    const result = await streamingConversionService.convertAudio(job, {
      format,
      quality,
      timeout: 300000 // 5 minutes
    })

    if (result.success && result.outputS3Location) {
      // Update job status
      await jobService.updateJobStatus(
        job.jobId,
        JobStatus.COMPLETED,
        result.outputS3Location
      )

      console.log(`[ConvertAudioV2] Conversion completed: ${result.outputS3Location.key}`)

      // Return job information for client to track progress and download
      return NextResponse.json({
        success: true,
        jobId: job.jobId,
        outputLocation: result.outputS3Location,
        processingTimeMs: result.processingTimeMs,
        method: result.fallbackUsed ? 'file-based' : 'streaming',
        message: 'Conversion completed successfully'
      })

    } else {
      // Update job status to failed
      await jobService.updateJobStatus(
        job.jobId,
        JobStatus.FAILED,
        undefined,
        result.error
      )

      console.error(`[ConvertAudioV2] Conversion failed: ${result.error}`)

      return NextResponse.json({
        success: false,
        jobId: job.jobId,
        error: result.error || 'Conversion failed',
        processingTimeMs: result.processingTimeMs
      }, { status: 500 })
    }

  } catch (error) {
    console.error('[ConvertAudioV2] API error:', error)
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 })
  }
}

/**
 * Get conversion job status and progress
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('jobId')

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 })
    }

    // Get job from DynamoDB
    const job = await jobService.getJob(jobId)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Get real-time progress from DynamoDB
    const { progressService } = await import('../../../lib/progress-service')
    const progress = await progressService.getProgress(jobId)

    return NextResponse.json({
      jobId: job.jobId,
      status: job.status,
      progress: progress?.progress || 0,
      stage: progress?.stage || job.status,
      inputLocation: job.inputS3Location,
      outputLocation: job.outputS3Location,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    })

  } catch (error) {
    console.error('[ConvertAudioV2] Status check error:', error)
    return NextResponse.json({
      error: 'Failed to get job status'
    }, { status: 500 })
  }
}