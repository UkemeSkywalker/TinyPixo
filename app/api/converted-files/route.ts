import { NextRequest, NextResponse } from 'next/server'
import { jobService, JobStatus } from '../../../lib/job-service'
import { s3Client } from '../../../lib/aws-services'
import { HeadObjectCommand } from '@aws-sdk/client-s3'

/**
 * Get list of converted audio files for display in UI
 * Returns completed jobs with file metadata
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    console.log('[ConvertedFiles] Fetching list of converted files')

    // Get all completed jobs from DynamoDB
    const completedJobs = await getCompletedJobs()

    if (completedJobs.length === 0) {
      console.log('[ConvertedFiles] No converted files found')
      return NextResponse.json({
        files: [],
        count: 0
      })
    }

    console.log(`[ConvertedFiles] Found ${completedJobs.length} completed jobs, verifying S3 files...`)

    // Verify files exist in S3 and get metadata
    const filesWithMetadata = await Promise.all(
      completedJobs.map(async (job) => {
        try {
          if (!job.outputS3Location) {
            console.warn(`[ConvertedFiles] Job ${job.jobId} has no output S3 location`)
            return null
          }

          // Check if file exists in S3 and get metadata
          const headResponse = await s3Client.send(new HeadObjectCommand({
            Bucket: job.outputS3Location.bucket,
            Key: job.outputS3Location.key
          }))

          const fileSize = headResponse.ContentLength || job.outputS3Location.size || 0
          const lastModified = headResponse.LastModified || job.updatedAt

          return {
            jobId: job.jobId,
            fileName: generateDisplayFileName(job.jobId, job.format),
            originalFileName: extractOriginalFileName(job.inputS3Location.key),
            format: job.format,
            quality: job.quality,
            size: fileSize,
            conversionDate: lastModified,
            createdAt: job.createdAt,
            s3Location: job.outputS3Location
          }
        } catch (error: any) {
          if (error.name === 'NotFound') {
            console.warn(`[ConvertedFiles] File not found in S3 for job ${job.jobId}: ${job.outputS3Location?.key}`)
            return null
          }
          console.error(`[ConvertedFiles] Error checking S3 file for job ${job.jobId}:`, error)
          return null
        }
      })
    )

    // Filter out null results (files that don't exist or had errors)
    const validFiles = filesWithMetadata.filter(file => file !== null)

    // Sort by conversion date (newest first)
    validFiles.sort((a, b) => new Date(b!.conversionDate).getTime() - new Date(a!.conversionDate).getTime())

    const duration = Date.now() - startTime
    console.log(`[ConvertedFiles] Retrieved ${validFiles.length} valid converted files in ${duration}ms`)

    return NextResponse.json({
      files: validFiles,
      count: validFiles.length
    })

  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[ConvertedFiles] Error after ${duration}ms:`, error)

    return NextResponse.json({
      error: 'Failed to fetch converted files',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

/**
 * Get all completed jobs from DynamoDB
 */
async function getCompletedJobs() {
  try {
    // For now, we'll scan the jobs table for completed jobs
    // In a production system, you might want to use a GSI or different approach
    // to avoid scanning the entire table

    // Since we don't have a direct way to scan jobs by status in the current JobService,
    // we'll need to implement this functionality

    // For this implementation, we'll get recent jobs and filter for completed ones
    // This is a simplified approach - in production you'd want a more efficient query

    const allJobs = await getAllRecentJobs()
    const completedJobs = allJobs.filter(job => job.status === JobStatus.COMPLETED)

    console.log(`[ConvertedFiles] Found ${completedJobs.length} completed jobs out of ${allJobs.length} total jobs`)
    return completedJobs

  } catch (error) {
    console.error('[ConvertedFiles] Failed to get completed jobs:', error)
    throw new Error(`Failed to get completed jobs: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Get all recent jobs (last 7 days) from DynamoDB
 * This is a temporary implementation - in production you'd want a more efficient approach
 */
async function getAllRecentJobs() {
  try {
    // We'll need to add a scan method to JobService or implement it here
    // For now, let's implement a basic scan with time filtering

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const sevenDaysAgoTimestamp = Math.floor(sevenDaysAgo.getTime() / 1000)

    // Since JobService doesn't have a scan method, we'll implement it here
    // This is not ideal but works for the current implementation
    const jobs = await scanJobsTable(sevenDaysAgoTimestamp)

    return jobs

  } catch (error) {
    console.error('[ConvertedFiles] Failed to get recent jobs:', error)
    throw error
  }
}

/**
 * Scan jobs table for recent jobs
 * This is a temporary implementation - should be moved to JobService
 */
async function scanJobsTable(minTtl: number) {
  const { DynamoDBClient, ScanCommand } = await import('@aws-sdk/client-dynamodb')
  const { marshall, unmarshall } = await import('@aws-sdk/util-dynamodb')
  const { dynamodbClient } = await import('../../../lib/aws-services')

  try {
    const result = await dynamodbClient.send(new ScanCommand({
      TableName: 'audio-conversion-jobs',
      FilterExpression: '#ttl > :minTtl',
      ExpressionAttributeNames: {
        '#ttl': 'ttl'
      },
      ExpressionAttributeValues: marshall({
        ':minTtl': minTtl
      }),
      Limit: 100 // Limit to prevent large scans
    }))

    if (!result.Items) {
      return []
    }

    const jobs = result.Items.map(item => {
      const job = unmarshall(item)
      // Convert date strings back to Date objects
      job.createdAt = new Date(job.createdAt)
      job.updatedAt = new Date(job.updatedAt)
      return job
    })

    return jobs
  } catch (error) {
    console.error('[ConvertedFiles] Failed to scan jobs table:', error)
    throw error
  }
}

/**
 * Generate display filename for converted file
 */
function generateDisplayFileName(jobId: string, format: string): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
  return `converted-${jobId}-${timestamp}.${format}`
}

/**
 * Extract original filename from S3 key
 */
function extractOriginalFileName(s3Key: string): string {
  // S3 key format is typically: uploads/{timestamp}-{filename}
  const parts = s3Key.split('/')
  const filename = parts[parts.length - 1] // Get the last part

  // Remove timestamp prefix if present (format: {timestamp}-{filename})
  const timestampMatch = filename.match(/^\d+-(.+)$/)
  if (timestampMatch) {
    return timestampMatch[1]
  }

  return filename
}