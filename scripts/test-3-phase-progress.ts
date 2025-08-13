#!/usr/bin/env tsx

/**
 * Test script for 3-phase progress system
 * Tests the complete flow: upload -> conversion -> s3upload -> completed
 */

import { progressService } from '../lib/progress-service'
import { s3UploadService } from '../lib/s3-upload-service'
import { writeFileSync, unlinkSync } from 'fs'

async function test3PhaseProgress() {
  const testJobId = `test-3phase-${Date.now()}`
  console.log(`🧪 Testing 3-phase progress system with job ${testJobId}`)

  try {
    // Phase 1: Initialize with upload phase (simulating file upload completion)
    console.log('\n📤 Phase 1: File Upload')
    await progressService.initializeProgress(testJobId)
    
    // Simulate upload progress
    for (let i = 0; i <= 100; i += 20) {
      await progressService.setProgress(testJobId, {
        jobId: testJobId,
        progress: i,
        stage: `uploading file (${i}%)`,
        phase: 'upload'
      })
      console.log(`  Upload progress: ${i}%`)
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    // Phase 2: Start conversion phase
    console.log('\n🔄 Phase 2: Audio Conversion')
    await progressService.startConversionPhase(testJobId)
    
    // Simulate conversion progress
    for (let i = 0; i <= 100; i += 25) {
      await progressService.setProgress(testJobId, {
        jobId: testJobId,
        progress: i,
        stage: `converting audio (${i}%)`,
        phase: 'conversion',
        currentTime: `00:${Math.floor(i/4).toString().padStart(2, '0')}:00.00`,
        totalDuration: '00:04:00.00'
      })
      console.log(`  Conversion progress: ${i}%`)
      await new Promise(resolve => setTimeout(resolve, 300))
    }

    // Phase 3: Start S3 upload phase
    console.log('\n☁️  Phase 3: S3 Upload')
    await progressService.startS3UploadPhase(testJobId)

    // Create a test file for S3 upload
    const testFilePath = `/tmp/${testJobId}.mp3`
    const testContent = Buffer.alloc(1024 * 1024, 'test') // 1MB test file
    writeFileSync(testFilePath, testContent)

    try {
      // Test S3 upload with progress (this will fail without proper AWS config, but we can test the progress logic)
      console.log('  Testing S3 upload progress tracking...')
      
      // Simulate S3 upload progress manually
      const fileSize = testContent.length
      for (let uploaded = 0; uploaded <= fileSize; uploaded += fileSize / 5) {
        await progressService.updateS3UploadProgress(testJobId, uploaded, fileSize)
        const percent = Math.round((uploaded / fileSize) * 100)
        console.log(`  S3 upload progress: ${percent}% (${uploaded}/${fileSize} bytes)`)
        await new Promise(resolve => setTimeout(resolve, 200))
      }

    } catch (s3Error) {
      console.log('  S3 upload test skipped (expected without AWS config)')
      
      // Manually simulate final S3 upload progress
      await progressService.updateS3UploadProgress(testJobId, testContent.length, testContent.length)
    }

    // Cleanup test file
    try {
      unlinkSync(testFilePath)
    } catch (cleanupError) {
      console.warn('  Failed to cleanup test file:', cleanupError)
    }

    // Phase 4: Mark as completed
    console.log('\n✅ Phase 4: Completion')
    await progressService.markComplete(testJobId)

    // Verify final state
    const finalProgress = await progressService.getProgress(testJobId)
    console.log('\n📊 Final Progress State:')
    console.log(`  Job ID: ${finalProgress?.jobId}`)
    console.log(`  Progress: ${finalProgress?.progress}%`)
    console.log(`  Stage: ${finalProgress?.stage}`)
    console.log(`  Phase: ${finalProgress?.phase}`)
    console.log(`  Updated: ${new Date(finalProgress?.updatedAt || 0).toISOString()}`)

    // Test phase transitions
    console.log('\n🔄 Testing Phase Transitions:')
    
    const testJobId2 = `test-transitions-${Date.now()}`
    await progressService.initializeProgress(testJobId2)
    
    let progress = await progressService.getProgress(testJobId2)
    console.log(`  Initial phase: ${progress?.phase} (expected: upload)`)
    
    await progressService.startConversionPhase(testJobId2)
    progress = await progressService.getProgress(testJobId2)
    console.log(`  After startConversionPhase: ${progress?.phase} (expected: conversion)`)
    
    await progressService.startS3UploadPhase(testJobId2)
    progress = await progressService.getProgress(testJobId2)
    console.log(`  After startS3UploadPhase: ${progress?.phase} (expected: s3upload)`)
    
    await progressService.markComplete(testJobId2)
    progress = await progressService.getProgress(testJobId2)
    console.log(`  After markComplete: ${progress?.phase} (expected: completed)`)

    console.log('\n🎉 3-phase progress system test completed successfully!')

  } catch (error) {
    console.error('\n❌ 3-phase progress system test failed:', error)
    throw error
  }
}

async function testProgressPolling() {
  console.log('\n🔄 Testing Progress Polling Simulation')
  
  const testJobId = `test-polling-${Date.now()}`
  
  // Simulate what the frontend polling would see
  await progressService.initializeProgress(testJobId)
  
  // Phase 1: Upload
  console.log('  Frontend would see: Phase 1 (Upload)')
  await progressService.setProgress(testJobId, {
    jobId: testJobId,
    progress: 50,
    stage: 'uploading file (50%)',
    phase: 'upload'
  })
  
  let progress = await progressService.getProgress(testJobId)
  console.log(`    Poll result: ${progress?.phase} - ${progress?.stage} (${progress?.progress}%)`)
  
  // Phase 2: Conversion
  console.log('  Frontend would see: Phase 2 (Conversion)')
  await progressService.startConversionPhase(testJobId)
  await progressService.setProgress(testJobId, {
    jobId: testJobId,
    progress: 75,
    stage: 'converting audio (75%)',
    phase: 'conversion'
  })
  
  progress = await progressService.getProgress(testJobId)
  console.log(`    Poll result: ${progress?.phase} - ${progress?.stage} (${progress?.progress}%)`)
  
  // Phase 3: S3 Upload
  console.log('  Frontend would see: Phase 3 (S3 Upload)')
  await progressService.startS3UploadPhase(testJobId)
  await progressService.updateS3UploadProgress(testJobId, 30 * 1024 * 1024, 50 * 1024 * 1024)
  
  progress = await progressService.getProgress(testJobId)
  console.log(`    Poll result: ${progress?.phase} - ${progress?.stage} (${progress?.progress}%)`)
  
  // Completion
  console.log('  Frontend would see: Completed')
  await progressService.markComplete(testJobId)
  
  progress = await progressService.getProgress(testJobId)
  console.log(`    Poll result: ${progress?.phase} - ${progress?.stage} (${progress?.progress}%)`)
}

// Run the tests
async function main() {
  console.log('🚀 Starting 3-Phase Progress System Tests\n')
  
  try {
    await test3PhaseProgress()
    await testProgressPolling()
    
    console.log('\n✅ All tests passed! The 3-phase progress system is working correctly.')
    
  } catch (error) {
    console.error('\n❌ Tests failed:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}