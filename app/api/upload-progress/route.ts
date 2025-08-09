import { NextRequest, NextResponse } from 'next/server'
import { getRedisClient } from '../../../lib/aws-services'

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const fileId = request.nextUrl.searchParams.get('fileId')
    
    if (!fileId) {
      console.log('[Upload Progress API] Request missing fileId parameter')
      return NextResponse.json({ error: 'No file ID provided' }, { status: 400 })
    }
    
    console.log(`[Upload Progress API] Request for fileId: ${fileId}`)
    
    // Get upload progress from Redis
    const redis = await getRedisClient()
    const progressData = await redis.get(`upload:${fileId}`)
    
    if (!progressData) {
      console.log(`[Upload Progress API] Upload ${fileId} not found`)
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }
    
    const progress = JSON.parse(progressData)
    const progressPercent = Math.round((progress.uploadedSize / progress.totalSize) * 100)
    
    const responseTime = Date.now() - startTime
    console.log(`[Upload Progress API] Returning upload progress for fileId ${fileId}: ${progressPercent}% (${progress.completedChunks}/${progress.totalChunks} chunks) - Response time: ${responseTime}ms`)
    
    // Return simplified progress data
    const responseData = {
      fileId: progress.fileId,
      fileName: progress.fileName,
      progress: progressPercent,
      uploadedSize: progress.uploadedSize,
      totalSize: progress.totalSize,
      completedChunks: progress.completedChunks,
      totalChunks: progress.totalChunks,
      stage: progressPercent >= 100 ? 'completed' : 'uploading'
    }
    
    // Add proper cache headers to prevent caching of progress responses
    return NextResponse.json(responseData, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Response-Time': `${responseTime}ms`
      }
    })
  } catch (error) {
    const responseTime = Date.now() - startTime
    console.error(`[Upload Progress API] Error after ${responseTime}ms:`, error)
    return NextResponse.json(
      { error: 'Failed to get upload progress' }, 
      { 
        status: 500,
        headers: {
          'X-Response-Time': `${responseTime}ms`
        }
      }
    )
  }
}