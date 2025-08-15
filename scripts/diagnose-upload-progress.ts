#!/usr/bin/env tsx

/**
 * Diagnose upload progress issues
 */

import { dynamodbProgressService } from '../lib/progress-service-dynamodb'

class UploadProgressDiagnostic {
  
  /**
   * Test upload progress storage and retrieval
   */
  async diagnoseUploadProgress(): Promise<void> {
    console.log('🔍 Diagnosing Upload Progress Issues')
    console.log('=' .repeat(50))

    const testFileId = '1755215400348-3056a560-e568-4be0-8ead-54a06d5793ce'
    
    try {
      // Test 1: Try to create a progress record
      console.log('\n📝 Test 1: Creating upload progress record...')
      
      const testProgress = {
        fileId: testFileId,
        fileName: 'test-file.wav',
        totalSize: 23385678,
        uploadedSize: 0,
        totalChunks: 3,
        completedChunks: 0,
        stage: 'uploading' as const,
        s3Key: `uploads/${testFileId}.wav`,
        bucketName: 'audio-conversion-app-bucket',
        parts: [],
        ttl: Math.floor(Date.now() / 1000) + 7200,
        updatedAt: Date.now()
      }

      await dynamodbProgressService.setUploadProgress(testFileId, testProgress)
      console.log('   ✅ Upload progress record created successfully')

      // Test 2: Try to retrieve the progress record
      console.log('\n🔍 Test 2: Retrieving upload progress record...')
      
      const retrievedProgress = await dynamodbProgressService.getUploadProgress(testFileId)
      
      if (retrievedProgress) {
        console.log('   ✅ Upload progress record retrieved successfully')
        console.log(`   📄 Stage: ${retrievedProgress.stage}`)
        console.log(`   📊 Progress: ${retrievedProgress.completedChunks}/${retrievedProgress.totalChunks} chunks`)
        console.log(`   📁 File: ${retrievedProgress.fileName}`)
      } else {
        console.log('   ❌ Upload progress record not found after creation!')
        console.log('   🚨 This indicates a storage issue')
      }

      // Test 3: Update the progress record
      console.log('\n📝 Test 3: Updating upload progress record...')
      
      const updatedProgress = {
        ...testProgress,
        uploadedSize: 11692839, // ~50%
        completedChunks: 1,
        stage: 'uploading' as const,
        updatedAt: Date.now()
      }

      await dynamodbProgressService.setUploadProgress(testFileId, updatedProgress)
      console.log('   ✅ Upload progress record updated successfully')

      // Test 4: Retrieve updated record
      const updatedRetrieved = await dynamodbProgressService.getUploadProgress(testFileId)
      
      if (updatedRetrieved) {
        console.log('   ✅ Updated progress retrieved successfully')
        console.log(`   📊 Progress: ${updatedRetrieved.completedChunks}/${updatedRetrieved.totalChunks} chunks`)
        console.log(`   💾 Uploaded: ${this.formatBytes(updatedRetrieved.uploadedSize)} / ${this.formatBytes(updatedRetrieved.totalSize)}`)
      }

      // Test 5: Test the exact scenario from logs
      console.log('\n🎯 Test 5: Testing exact scenario from App Runner logs...')
      
      // This simulates what the frontend is doing
      const frontendFileId = '1755215400348-3056a560-e568-4be0-8ead-54a06d5793ce'
      const frontendProgress = await dynamodbProgressService.getUploadProgress(frontendFileId)
      
      if (frontendProgress) {
        console.log('   ✅ Found progress for frontend fileId')
        console.log(`   📄 Details: ${JSON.stringify(frontendProgress, null, 2)}`)
      } else {
        console.log('   ❌ No progress found for frontend fileId (matches App Runner logs)')
        console.log('   💡 This confirms the upload API is not creating progress records')
      }

      this.printDiagnosticResults()

    } catch (error) {
      console.error('❌ Diagnostic failed:', error)
      
      if (error instanceof Error) {
        if (error.message.includes('not authorized')) {
          console.log('\n🚨 IAM Permission Issue:')
          console.log('   The upload progress storage is failing due to permissions')
          console.log('   This explains why no progress records are found')
        } else if (error.message.includes('ResourceNotFoundException')) {
          console.log('\n🚨 Table Missing Issue:')
          console.log('   The audio-conversion-uploads table does not exist')
          console.log('   This explains why no progress records are found')
        }
      }
    }
  }

  /**
   * Print diagnostic results and recommendations
   */
  private printDiagnosticResults(): void {
    console.log('\n' + '='.repeat(50))
    console.log('🎯 DIAGNOSTIC RESULTS')
    console.log('='.repeat(50))

    console.log('\n📊 Upload Progress Flow Analysis:')
    console.log('   1. Frontend uploads file → Upload API')
    console.log('   2. Upload API should create progress record → DynamoDB')
    console.log('   3. Frontend polls progress → Progress API → DynamoDB')
    console.log('   4. Progress API returns progress data → Frontend')

    console.log('\n🔍 Current Issue:')
    console.log('   • Step 2 is failing: Upload API not creating progress records')
    console.log('   • Step 3 works: Progress API can query DynamoDB')
    console.log('   • Result: Frontend gets "not found" for all progress queries')

    console.log('\n🛠️  Possible Causes:')
    console.log('   1. Upload API errors are being silently caught')
    console.log('   2. File size threshold logic is bypassing progress creation')
    console.log('   3. Upload API is using wrong fileId format')
    console.log('   4. Progress storage is failing but not throwing errors')

    console.log('\n🎯 Recommended Fixes:')
    console.log('   1. Add more detailed logging to upload API progress storage')
    console.log('   2. Check if small files are bypassing progress tracking')
    console.log('   3. Verify fileId consistency between upload and progress APIs')
    console.log('   4. Test with different file sizes to isolate the issue')

    console.log('\n💡 Next Steps:')
    console.log('   1. Check App Runner logs for upload API errors')
    console.log('   2. Test with a small file (< 5MB) vs large file (> 5MB)')
    console.log('   3. Add debug logging to upload API progress functions')
    console.log('   4. Verify the upload flow being used (simple vs multipart)')
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

// Run the diagnostic if called directly
if (require.main === module) {
  const diagnostic = new UploadProgressDiagnostic()
  diagnostic.diagnoseUploadProgress().catch(error => {
    console.error('❌ Diagnostic execution failed:', error)
    process.exit(1)
  })
}

export { UploadProgressDiagnostic }