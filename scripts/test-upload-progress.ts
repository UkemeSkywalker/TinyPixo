#!/usr/bin/env tsx

/**
 * Test script to validate upload progress tracking
 */

import { getRedisClient } from '../lib/aws-services'

async function testUploadProgress() {
  console.log('Testing upload progress tracking...')
  
  const testFileId = `test-${Date.now()}-${crypto.randomUUID()}`
  
  try {
    // Simulate upload progress data
    const mockProgress = {
      uploadId: 'test-upload-id',
      fileId: testFileId,
      fileName: 'test-audio.wav',
      totalSize: 100 * 1024 * 1024, // 100MB
      uploadedSize: 50 * 1024 * 1024, // 50MB uploaded
      totalChunks: 10,
      completedChunks: 5,
      parts: [],
      s3Key: `uploads/${testFileId}.wav`,
      bucketName: 'test-bucket'
    }
    
    console.log('1. Storing mock upload progress in Redis...')
    const redis = await getRedisClient()
    await redis.setEx(
      `upload:${testFileId}`,
      3600,
      JSON.stringify(mockProgress)
    )
    
    console.log('2. Testing upload progress API...')
    const response = await fetch(`http://localhost:3000/api/upload-progress?fileId=${testFileId}`)
    
    if (response.ok) {
      const progressData = await response.json()
      console.log('✅ Upload progress API response:', progressData)
      
      // Validate response structure
      const expectedFields = ['fileId', 'fileName', 'progress', 'uploadedSize', 'totalSize', 'completedChunks', 'totalChunks', 'stage']
      const missingFields = expectedFields.filter(field => !(field in progressData))
      
      if (missingFields.length === 0) {
        console.log('✅ All expected fields present in response')
        console.log(`   Progress: ${progressData.progress}%`)
        console.log(`   Chunks: ${progressData.completedChunks}/${progressData.totalChunks}`)
        console.log(`   Stage: ${progressData.stage}`)
      } else {
        console.log('❌ Missing fields in response:', missingFields)
      }
    } else {
      console.log('❌ Upload progress API failed:', response.status, await response.text())
    }
    
    console.log('3. Cleaning up test data...')
    await redis.del(`upload:${testFileId}`)
    
    console.log('✅ Upload progress test completed successfully')
    
  } catch (error) {
    console.error('❌ Upload progress test failed:', error)
  }
}

// Run the test
testUploadProgress().catch(console.error)