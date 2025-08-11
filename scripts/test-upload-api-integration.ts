#!/usr/bin/env tsx

/**
 * Integration test for upload progress API with real S3 multipart uploads
 * This script tests the complete upload workflow including API endpoints
 */

import { randomUUID } from 'crypto'
import { s3Client } from '../lib/aws-services'
import { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000'
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'

interface UploadProgressResponse {
  fileId: string
  fileName: string
  progress: number
  uploadedSize: number
  totalSize: number
  completedChunks: number
  totalChunks: number
  stage: string
}

async function testUploadAPIIntegration() {
  console.log('🧪 Testing upload progress API integration with real S3...')
  
  const fileId = `integration-test-${randomUUID()}`
  const fileName = 'test-audio.mp3'
  const s3Key = `uploads/${fileId}.mp3`
  
  try {
    // Test 1: Create a real S3 multipart upload
    console.log('\n1. Creating real S3 multipart upload...')
    
    const createResponse = await s3Client.send(new CreateMultipartUploadCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: 'audio/mpeg',
      Metadata: {
        originalName: fileName,
        fileId: fileId,
        uploadType: 'integration-test'
      }
    }))
    
    const uploadId = createResponse.UploadId!
    console.log(`✅ S3 multipart upload created: ${uploadId}`)
    
    // Test 2: Simulate chunked upload with progress tracking
    console.log('\n2. Simulating chunked upload with progress tracking...')
    
    const chunkSize = 5 * 1024 * 1024 // 5MB chunks (minimum for S3 multipart)
    const totalSize = 3 * chunkSize // 15MB total
    const totalChunks = 3
    const parts: Array<{ ETag: string; PartNumber: number }> = []
    
    // Create upload progress record using our DynamoDB service
    const { dynamodbProgressService } = await import('../lib/progress-service-dynamodb')
    
    const uploadData = {
      fileId,
      fileName,
      totalSize,
      uploadedSize: 0,
      totalChunks,
      completedChunks: 0,
      stage: 'uploading' as const,
      uploadId,
      s3Key,
      bucketName: BUCKET_NAME,
      parts: [],
      ttl: Math.floor(Date.now() / 1000) + 7200,
      updatedAt: Date.now()
    }
    
    await dynamodbProgressService.setUploadProgress(fileId, uploadData)
    console.log(`✅ Initial upload progress stored in DynamoDB`)
    
    // Upload chunks and update progress
    for (let i = 0; i < totalChunks; i++) {
      const partNumber = i + 1
      const chunkData = Buffer.alloc(chunkSize, `chunk-${partNumber}`)
      
      console.log(`   Uploading chunk ${partNumber}/${totalChunks}...`)
      
      // Upload chunk to S3
      const uploadPartResponse = await s3Client.send(new UploadPartCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        PartNumber: partNumber,
        UploadId: uploadId,
        Body: chunkData
      }))
      
      const part = {
        ETag: uploadPartResponse.ETag!,
        PartNumber: partNumber
      }
      parts.push(part)
      
      // Update progress in DynamoDB
      uploadData.parts.push(part)
      uploadData.completedChunks = partNumber
      uploadData.uploadedSize = partNumber * chunkSize
      uploadData.updatedAt = Date.now()
      
      await dynamodbProgressService.setUploadProgress(fileId, uploadData)
      
      const progressPercent = Math.round((uploadData.uploadedSize / uploadData.totalSize) * 100)
      console.log(`   ✅ Chunk ${partNumber} uploaded: ${progressPercent}% complete`)
    }
    
    // Test 3: Test upload progress API endpoint
    console.log('\n3. Testing upload progress API endpoint...')
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/upload-progress?fileId=${fileId}`)
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }
      
      const progressData: UploadProgressResponse = await response.json()
      
      console.log(`✅ Upload progress API response:`)
      console.log(`   - File: ${progressData.fileName}`)
      console.log(`   - Progress: ${progressData.progress}%`)
      console.log(`   - Chunks: ${progressData.completedChunks}/${progressData.totalChunks}`)
      console.log(`   - Size: ${progressData.uploadedSize}/${progressData.totalSize} bytes`)
      console.log(`   - Stage: ${progressData.stage}`)
      
      // Validate response data
      if (progressData.fileId !== fileId) {
        throw new Error(`File ID mismatch: expected ${fileId}, got ${progressData.fileId}`)
      }
      
      if (progressData.progress !== 100) {
        throw new Error(`Progress should be 100%, got ${progressData.progress}%`)
      }
      
      if (progressData.completedChunks !== totalChunks) {
        throw new Error(`Chunks mismatch: expected ${totalChunks}, got ${progressData.completedChunks}`)
      }
      
      console.log(`✅ API response validation passed`)
      
    } catch (error) {
      console.error(`❌ API test failed: ${error}`)
      throw error
    }
    
    // Test 4: Complete the S3 multipart upload
    console.log('\n4. Completing S3 multipart upload...')
    
    await s3Client.send(new CompleteMultipartUploadCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber)
      }
    }))
    
    console.log(`✅ S3 multipart upload completed`)
    
    // Test 5: Mark upload as completed and test final API call
    console.log('\n5. Testing final upload completion...')
    
    uploadData.stage = 'completed'
    uploadData.updatedAt = Date.now()
    await dynamodbProgressService.setUploadProgress(fileId, uploadData)
    
    const finalResponse = await fetch(`${API_BASE_URL}/api/upload-progress?fileId=${fileId}`)
    const finalData: UploadProgressResponse = await finalResponse.json()
    
    if (finalData.stage !== 'completed') {
      throw new Error(`Expected stage 'completed', got '${finalData.stage}'`)
    }
    
    console.log(`✅ Upload marked as completed successfully`)
    
    // Test 6: Test API response time
    console.log('\n6. Testing API response time...')
    
    const responseTimeTests = 5
    const responseTimes: number[] = []
    
    for (let i = 0; i < responseTimeTests; i++) {
      const startTime = Date.now()
      const response = await fetch(`${API_BASE_URL}/api/upload-progress?fileId=${fileId}`)
      const endTime = Date.now()
      
      if (response.ok) {
        const responseTime = endTime - startTime
        responseTimes.push(responseTime)
        console.log(`   Test ${i + 1}: ${responseTime}ms`)
      }
    }
    
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    const maxResponseTime = Math.max(...responseTimes)
    
    console.log(`✅ API response time analysis:`)
    console.log(`   - Average: ${Math.round(avgResponseTime)}ms`)
    console.log(`   - Maximum: ${maxResponseTime}ms`)
    console.log(`   - All responses under 500ms: ${maxResponseTime < 500 ? 'Yes' : 'No'}`)
    
    // Test 7: Test error handling
    console.log('\n7. Testing API error handling...')
    
    const nonExistentResponse = await fetch(`${API_BASE_URL}/api/upload-progress?fileId=non-existent`)
    if (nonExistentResponse.status !== 404) {
      throw new Error(`Expected 404 for non-existent file, got ${nonExistentResponse.status}`)
    }
    console.log(`✅ Non-existent file ID returns 404 as expected`)
    
    const noFileIdResponse = await fetch(`${API_BASE_URL}/api/upload-progress`)
    if (noFileIdResponse.status !== 400) {
      throw new Error(`Expected 400 for missing fileId, got ${noFileIdResponse.status}`)
    }
    console.log(`✅ Missing fileId parameter returns 400 as expected`)
    
    console.log('\n🎉 All upload API integration tests passed!')
    console.log('\n📊 Test Summary:')
    console.log('   ✅ Real S3 multipart upload creation')
    console.log('   ✅ Chunk-by-chunk upload with progress tracking')
    console.log('   ✅ DynamoDB progress storage and retrieval')
    console.log('   ✅ Upload progress API endpoint functionality')
    console.log('   ✅ API response validation')
    console.log('   ✅ S3 multipart upload completion')
    console.log('   ✅ Upload completion marking')
    console.log('   ✅ API response time performance')
    console.log('   ✅ Error handling')
    
  } catch (error) {
    console.error('❌ Integration test failed:', error)
    throw error
  } finally {
    // Cleanup: Delete the test file from S3
    try {
      console.log('\n🧹 Cleaning up test file from S3...')
      await s3Client.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key
      }))
      console.log(`✅ Test file deleted from S3: ${s3Key}`)
    } catch (cleanupError) {
      console.warn(`⚠️ Failed to cleanup test file: ${cleanupError}`)
    }
  }
}

// Run the test
if (require.main === module) {
  testUploadAPIIntegration()
    .then(() => {
      console.log('\n✅ Integration test completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n❌ Integration test failed:', error)
      process.exit(1)
    })
}

export { testUploadAPIIntegration }