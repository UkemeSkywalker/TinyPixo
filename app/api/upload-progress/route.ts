import { NextRequest, NextResponse } from 'next/server'
import { dynamodbProgressService } from '../../../lib/progress-service-dynamodb'

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const fileId = request.nextUrl.searchParams.get('fileId')
    
    if (!fileId) {
      console.log('[Upload Progress API] Request missing fileId parameter')
      return NextResponse.json({ error: 'No file ID provided' }, { status: 400 })
    }
    
    console.log(`[Upload Progress API] Request for fileId: ${fileId}`)
    
    // Get upload progress from DynamoDB
    const uploadData = await dynamodbProgressService.getUploadProgress(fileId)
    
    if (!uploadData) {
      console.log(`[Upload Progress API] Upload ${fileId} not found`)
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }
    
    const progressPercent = Math.round((uploadData.uploadedSize / uploadData.totalSize) * 100)
    
    const responseTime = Date.now() - startTime
    console.log(`[Upload Progress API] Returning upload progress for fileId ${fileId}: ${progressPercent}% (${uploadData.completedChunks}/${uploadData.totalChunks} chunks) - Response time: ${responseTime}ms`)
    
    // Return simplified progress data
    const responseData = {
      fileId: uploadData.fileId,
      fileName: uploadData.fileName,
      progress: progressPercent,
      uploadedSize: uploadData.uploadedSize,
      totalSize: uploadData.totalSize,
      completedChunks: uploadData.completedChunks,
      totalChunks: uploadData.totalChunks,
      stage: uploadData.stage
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