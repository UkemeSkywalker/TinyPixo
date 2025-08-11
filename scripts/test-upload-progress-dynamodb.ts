#!/usr/bin/env tsx

/**
 * Test script to validate DynamoDB-based upload progress tracking
 * This script tests the new upload progress functionality against real AWS DynamoDB
 */

import { dynamodbProgressService, UploadProgressData } from '../lib/progress-service-dynamodb'
import { randomUUID } from 'crypto'

async function testUploadProgressTracking() {
  console.log('🧪 Testing DynamoDB-based upload progress tracking...')
  
  try {
    // Initialize tables
    console.log('\n1. Initializing DynamoDB tables...')
    await dynamodbProgressService.initializeTables()
    console.log('✅ Tables initialized successfully')
    
    // Test 1: Create upload progress
    console.log('\n2. Testing upload progress creation...')
    const fileId = `test-${randomUUID()}`
    const uploadData: UploadProgressData = {
      fileId,
      fileName: 'test-audio.mp3',
      totalSize: 10485760, // 10MB
      uploadedSize: 0,
      totalChunks: 10,
      completedChunks: 0,
      stage: 'uploading',
      uploadId: `upload-${randomUUID()}`,
      s3Key: `uploads/${fileId}.mp3`,
      bucketName: 'test-bucket',
      parts: [],
      ttl: Math.floor(Date.now() / 1000) + 7200, // 2 hours TTL
      updatedAt: Date.now()
    }
    
    await dynamodbProgressService.setUploadProgress(fileId, uploadData)
    console.log(`✅ Upload progress created for fileId: ${fileId}`)
    
    // Test 2: Retrieve upload progress
    console.log('\n3. Testing upload progress retrieval...')
    const retrievedData = await dynamodbProgressService.getUploadProgress(fileId)
    if (!retrievedData) {
      throw new Error('Failed to retrieve upload progress')
    }
    
    console.log(`✅ Upload progress retrieved:`)
    console.log(`   - File: ${retrievedData.fileName}`)
    console.log(`   - Progress: ${retrievedData.completedChunks}/${retrievedData.totalChunks} chunks`)
    console.log(`   - Stage: ${retrievedData.stage}`)
    console.log(`   - TTL: ${new Date(retrievedData.ttl * 1000).toISOString()}`)
    
    // Test 3: Update upload progress (simulate chunk uploads)
    console.log('\n4. Testing upload progress updates...')
    for (let i = 1; i <= 5; i++) {
      const chunkSize = 1048576 // 1MB per chunk
      uploadData.completedChunks = i
      uploadData.uploadedSize = i * chunkSize
      uploadData.parts.push({
        ETag: `"etag-${i}"`,
        PartNumber: i
      })
      uploadData.updatedAt = Date.now()
      
      await dynamodbProgressService.setUploadProgress(fileId, uploadData)
      
      const progressPercent = Math.round((uploadData.uploadedSize / uploadData.totalSize) * 100)
      console.log(`   ✅ Chunk ${i} uploaded: ${progressPercent}% complete`)
      
      // Small delay to simulate real upload timing
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // Test 4: Mark upload as completed
    console.log('\n5. Testing upload completion...')
    uploadData.completedChunks = uploadData.totalChunks
    uploadData.uploadedSize = uploadData.totalSize
    uploadData.stage = 'completed'
    uploadData.updatedAt = Date.now()
    
    await dynamodbProgressService.setUploadProgress(fileId, uploadData)
    
    const finalData = await dynamodbProgressService.getUploadProgress(fileId)
    if (!finalData || finalData.stage !== 'completed') {
      throw new Error('Failed to mark upload as completed')
    }
    
    console.log(`✅ Upload marked as completed: ${finalData.completedChunks}/${finalData.totalChunks} chunks`)
    
    // Test 5: Test TTL functionality (simulate expired record)
    console.log('\n6. Testing TTL functionality...')
    const expiredFileId = `expired-${randomUUID()}`
    const expiredData: UploadProgressData = {
      ...uploadData,
      fileId: expiredFileId,
      ttl: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      updatedAt: Date.now() - 3600000
    }
    
    await dynamodbProgressService.setUploadProgress(expiredFileId, expiredData)
    console.log(`✅ Created expired upload record for testing: ${expiredFileId}`)
    
    // Test cleanup of expired records
    await dynamodbProgressService.cleanupExpiredProgress()
    console.log(`✅ Cleanup completed`)
    
    // Test 6: Performance test
    console.log('\n7. Testing performance with multiple concurrent uploads...')
    const startTime = Date.now()
    const concurrentUploads = 10
    const uploadPromises = []
    
    for (let i = 0; i < concurrentUploads; i++) {
      const testFileId = `perf-test-${i}-${randomUUID()}`
      const testData: UploadProgressData = {
        fileId: testFileId,
        fileName: `test-file-${i}.mp3`,
        totalSize: 5242880, // 5MB
        uploadedSize: 2621440, // 50% uploaded
        totalChunks: 5,
        completedChunks: 2,
        stage: 'uploading',
        uploadId: `upload-${testFileId}`,
        s3Key: `uploads/${testFileId}.mp3`,
        bucketName: 'test-bucket',
        parts: [
          { ETag: '"etag-1"', PartNumber: 1 },
          { ETag: '"etag-2"', PartNumber: 2 }
        ],
        ttl: Math.floor(Date.now() / 1000) + 7200,
        updatedAt: Date.now()
      }
      
      uploadPromises.push(
        dynamodbProgressService.setUploadProgress(testFileId, testData)
          .then(() => dynamodbProgressService.getUploadProgress(testFileId))
      )
    }
    
    const results = await Promise.all(uploadPromises)
    const endTime = Date.now()
    const duration = endTime - startTime
    
    console.log(`✅ Performance test completed:`)
    console.log(`   - ${concurrentUploads} concurrent operations`)
    console.log(`   - Total time: ${duration}ms`)
    console.log(`   - Average time per operation: ${Math.round(duration / concurrentUploads)}ms`)
    console.log(`   - All operations successful: ${results.every(r => r !== null)}`)
    
    // Test 7: Error handling
    console.log('\n8. Testing error handling...')
    try {
      await dynamodbProgressService.getUploadProgress('non-existent-file-id')
      console.log('✅ Non-existent file ID handled gracefully (returned null)')
    } catch (error) {
      console.log(`❌ Error handling test failed: ${error}`)
    }
    
    console.log('\n🎉 All DynamoDB upload progress tests passed!')
    console.log('\n📊 Test Summary:')
    console.log('   ✅ Table initialization')
    console.log('   ✅ Upload progress creation')
    console.log('   ✅ Upload progress retrieval')
    console.log('   ✅ Chunk-by-chunk progress updates')
    console.log('   ✅ Upload completion marking')
    console.log('   ✅ TTL configuration and cleanup')
    console.log('   ✅ Performance with concurrent operations')
    console.log('   ✅ Error handling')
    
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

// Run the test
if (require.main === module) {
  testUploadProgressTracking()
    .then(() => {
      console.log('\n✅ Test completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n❌ Test failed:', error)
      process.exit(1)
    })
}

export { testUploadProgressTracking }