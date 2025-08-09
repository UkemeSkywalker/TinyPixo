#!/usr/bin/env tsx

/**
 * Test script for download cleanup functionality
 */

import { downloadCleanupService } from '../lib/download-cleanup-service'
import { jobService } from '../lib/job-service'
import { s3Client, initializeAllServices } from '../lib/aws-services'
import { PutObjectCommand } from '@aws-sdk/client-s3'

const bucketName = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'

async function testDownloadCleanup() {
  console.log('🧹 Testing Download Cleanup Service')
  console.log('=' .repeat(50))

  try {
    // Initialize services
    await initializeAllServices()

    // Test 1: Get initial storage stats
    console.log('\n📊 Getting initial storage statistics...')
    const initialStats = await downloadCleanupService.getCleanupStats()
    console.log('Initial stats:', {
      totalFiles: initialStats.totalFiles,
      oldFiles: initialStats.oldFiles,
      estimatedCleanupSizeMB: Math.round(initialStats.estimatedCleanupSize / (1024 * 1024) * 100) / 100
    })

    // Test 2: Create some test files
    console.log('\n📁 Creating test files for cleanup...')
    const testFiles = [
      { key: 'conversions/test-cleanup-1.mp3', content: 'test content 1' },
      { key: 'conversions/test-cleanup-2.wav', content: 'test content 2' },
      { key: 'conversions/orphaned-file.aac', content: 'orphaned content' }
    ]

    for (const file of testFiles) {
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: file.key,
        Body: file.content
      }))
      console.log(`✅ Created test file: ${file.key}`)
    }

    // Test 3: Create corresponding jobs for some files
    console.log('\n📋 Creating corresponding jobs...')
    const job1 = await jobService.createJob({
      inputS3Location: {
        bucket: bucketName,
        key: 'uploads/test-cleanup-1.mp3',
        size: 100
      },
      format: 'mp3',
      quality: '192k'
    })

    const job2 = await jobService.createJob({
      inputS3Location: {
        bucket: bucketName,
        key: 'uploads/test-cleanup-2.wav',
        size: 100
      },
      format: 'wav',
      quality: '192k'
    })

    console.log(`✅ Created jobs: ${job1.jobId}, ${job2.jobId}`)

    // Test 4: Get updated storage stats
    console.log('\n📊 Getting updated storage statistics...')
    const updatedStats = await downloadCleanupService.getCleanupStats()
    console.log('Updated stats:', {
      totalFiles: updatedStats.totalFiles,
      oldFiles: updatedStats.oldFiles,
      estimatedCleanupSizeMB: Math.round(updatedStats.estimatedCleanupSize / (1024 * 1024) * 100) / 100,
      filesAdded: updatedStats.totalFiles - initialStats.totalFiles
    })

    // Test 5: Test orphaned file cleanup
    console.log('\n🗑️  Testing orphaned file cleanup...')
    await downloadCleanupService.cleanupOrphanedFiles()
    console.log('✅ Orphaned file cleanup completed')

    // Test 6: Get final storage stats
    console.log('\n📊 Getting final storage statistics...')
    const finalStats = await downloadCleanupService.getCleanupStats()
    console.log('Final stats:', {
      totalFiles: finalStats.totalFiles,
      oldFiles: finalStats.oldFiles,
      estimatedCleanupSizeMB: Math.round(finalStats.estimatedCleanupSize / (1024 * 1024) * 100) / 100,
      filesRemoved: updatedStats.totalFiles - finalStats.totalFiles
    })

    // Test 7: Test API endpoints
    console.log('\n🌐 Testing cleanup API endpoints...')
    
    // Test GET endpoint
    const getResponse = await fetch('http://localhost:3000/api/cleanup-downloads')
    if (getResponse.ok) {
      const getData = await getResponse.json()
      console.log('✅ GET /api/cleanup-downloads:', getData.stats)
    } else {
      console.log('❌ GET /api/cleanup-downloads failed:', getResponse.status)
    }

    // Test POST endpoint for stats
    const statsResponse = await fetch('http://localhost:3000/api/cleanup-downloads?action=stats', {
      method: 'POST'
    })
    if (statsResponse.ok) {
      const statsData = await statsResponse.json()
      console.log('✅ POST /api/cleanup-downloads?action=stats:', statsData.stats)
    } else {
      console.log('❌ POST /api/cleanup-downloads?action=stats failed:', statsResponse.status)
    }

    console.log('\n🎉 Download cleanup testing completed successfully!')

  } catch (error) {
    console.error('❌ Download cleanup testing failed:', error)
    process.exit(1)
  }
}

// Run test if called directly
if (require.main === module) {
  testDownloadCleanup().catch(error => {
    console.error('💥 Test failed:', error)
    process.exit(1)
  })
}

export { testDownloadCleanup }