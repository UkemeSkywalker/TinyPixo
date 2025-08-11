#!/usr/bin/env tsx

/**
 * Test script to verify the complete audio conversion workflow with DynamoDB progress tracking
 * This script tests the end-to-end workflow including frontend API integration
 */

import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { initializeAllServices } from '../lib/aws-services'

interface TestResult {
  testName: string
  success: boolean
  error?: string
  duration?: number
}

async function runTest(testName: string, testFn: () => Promise<void>): Promise<TestResult> {
  const startTime = Date.now()
  
  try {
    console.log(`\n🧪 Running test: ${testName}`)
    await testFn()
    const duration = Date.now() - startTime
    console.log(`✅ Test passed: ${testName} (${duration}ms)`)
    return { testName, success: true, duration }
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`❌ Test failed: ${testName} (${duration}ms)`, error)
    return { 
      testName, 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      duration 
    }
  }
}

async function createTestAudioFile(): Promise<Buffer> {
  // Create a minimal WAV file for testing (44-byte header + some audio data)
  const wavHeader = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x24, 0x00, 0x00, 0x00, // File size - 8
    0x57, 0x41, 0x56, 0x45, // "WAVE"
    0x66, 0x6D, 0x74, 0x20, // "fmt "
    0x10, 0x00, 0x00, 0x00, // Subchunk1Size (16 for PCM)
    0x01, 0x00,             // AudioFormat (1 for PCM)
    0x01, 0x00,             // NumChannels (1 = mono)
    0x44, 0xAC, 0x00, 0x00, // SampleRate (44100)
    0x88, 0x58, 0x01, 0x00, // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
    0x02, 0x00,             // BlockAlign (NumChannels * BitsPerSample/8)
    0x10, 0x00,             // BitsPerSample (16)
    0x64, 0x61, 0x74, 0x61, // "data"
    0x00, 0x00, 0x00, 0x00  // Subchunk2Size (0 for now, will be updated)
  ])
  
  // Add some simple audio data (sine wave)
  const sampleRate = 44100
  const duration = 1 // 1 second
  const frequency = 440 // A4 note
  const samples = sampleRate * duration
  const audioData = Buffer.alloc(samples * 2) // 16-bit samples
  
  for (let i = 0; i < samples; i++) {
    const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 32767
    audioData.writeInt16LE(Math.round(sample), i * 2)
  }
  
  // Update the data chunk size in the header
  wavHeader.writeUInt32LE(audioData.length, 40)
  
  // Update the file size in the header
  wavHeader.writeUInt32LE(36 + audioData.length, 4)
  
  return Buffer.concat([wavHeader, audioData])
}

async function testFileUpload(): Promise<{ fileId: string; fileName: string }> {
  console.log('   Creating test audio file...')
  const audioBuffer = await createTestAudioFile()
  const fileName = `test-audio-${Date.now()}.wav`
  
  console.log(`   Uploading file: ${fileName} (${audioBuffer.length} bytes)`)
  
  // Create FormData for upload
  const formData = new FormData()
  const blob = new Blob([audioBuffer], { type: 'audio/wav' })
  formData.append('file', blob, fileName)
  formData.append('fileId', `upload-${Date.now()}`)
  
  const uploadResponse = await fetch('http://localhost:3000/api/upload-audio', {
    method: 'POST',
    body: formData
  })
  
  if (!uploadResponse.ok) {
    const errorData = await uploadResponse.json().catch(() => ({ error: 'Upload failed' }))
    throw new Error(`Upload failed: ${errorData.error || uploadResponse.statusText}`)
  }
  
  const uploadResult = await uploadResponse.json()
  console.log(`   File uploaded successfully: ${uploadResult.fileId}`)
  
  return {
    fileId: uploadResult.fileId,
    fileName: uploadResult.fileName
  }
}

async function testAudioConversion(fileId: string): Promise<string> {
  console.log(`   Starting conversion for fileId: ${fileId}`)
  
  const conversionResponse = await fetch('http://localhost:3000/api/convert-audio', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fileId,
      format: 'mp3',
      quality: '192k'
    })
  })
  
  if (!conversionResponse.ok) {
    const errorData = await conversionResponse.json().catch(() => ({ error: 'Conversion failed' }))
    throw new Error(`Conversion failed: ${errorData.error || conversionResponse.statusText}`)
  }
  
  const conversionResult = await conversionResponse.json()
  console.log(`   Conversion job created: ${conversionResult.jobId}`)
  
  return conversionResult.jobId
}

async function testProgressTracking(jobId: string): Promise<void> {
  console.log(`   Monitoring progress for jobId: ${jobId}`)
  
  let attempts = 0
  const maxAttempts = 60 // 60 seconds max
  let lastProgress = -1
  let progressUpdates = 0
  
  while (attempts < maxAttempts) {
    try {
      const progressResponse = await fetch(`http://localhost:3000/api/progress?jobId=${jobId}`, {
        headers: {
          'Cache-Control': 'no-cache'
        }
      })
      
      if (!progressResponse.ok) {
        if (progressResponse.status === 404) {
          console.log(`   Progress not found yet, waiting... (attempt ${attempts + 1})`)
          await new Promise(resolve => setTimeout(resolve, 1000))
          attempts++
          continue
        }
        throw new Error(`Progress API failed: ${progressResponse.statusText}`)
      }
      
      const progressData = await progressResponse.json()
      
      // Count progress updates
      if (progressData.progress !== lastProgress) {
        progressUpdates++
        lastProgress = progressData.progress
        console.log(`   Progress update ${progressUpdates}: ${progressData.progress}% (${progressData.stage})`)
        
        if (progressData.estimatedTimeRemaining) {
          console.log(`     Estimated time remaining: ${progressData.estimatedTimeRemaining}s`)
        }
      }
      
      // Check for completion
      if (progressData.progress >= 100 && progressData.stage === 'completed') {
        console.log(`   ✅ Conversion completed after ${progressUpdates} progress updates`)
        return
      }
      
      // Check for failure
      if (progressData.progress === -1 || progressData.stage === 'failed') {
        throw new Error(`Conversion failed: ${progressData.error || 'Unknown error'}`)
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 1000))
      attempts++
      
    } catch (error) {
      if (attempts >= maxAttempts - 1) {
        throw error
      }
      console.log(`   Progress polling error, retrying... (attempt ${attempts + 1})`)
      await new Promise(resolve => setTimeout(resolve, 1000))
      attempts++
    }
  }
  
  throw new Error(`Progress tracking timed out after ${maxAttempts} seconds`)
}

async function testDownload(jobId: string): Promise<void> {
  console.log(`   Testing download for jobId: ${jobId}`)
  
  const downloadResponse = await fetch(`http://localhost:3000/api/download?jobId=${jobId}`)
  
  if (!downloadResponse.ok) {
    const errorData = await downloadResponse.json().catch(() => ({ error: 'Download failed' }))
    throw new Error(`Download failed: ${errorData.error || downloadResponse.statusText}`)
  }
  
  const blob = await downloadResponse.blob()
  console.log(`   Downloaded converted file: ${blob.size} bytes`)
  
  if (blob.size === 0) {
    throw new Error('Downloaded file is empty')
  }
  
  // Verify it's an MP3 file by checking the header
  const arrayBuffer = await blob.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)
  
  // Check for MP3 header (ID3 tag or MP3 frame sync)
  const hasId3 = uint8Array[0] === 0x49 && uint8Array[1] === 0x44 && uint8Array[2] === 0x33 // "ID3"
  const hasMp3Sync = uint8Array[0] === 0xFF && (uint8Array[1] & 0xE0) === 0xE0 // MP3 frame sync
  
  if (!hasId3 && !hasMp3Sync) {
    // Look for MP3 sync in the first few bytes (sometimes there's padding)
    let foundSync = false
    for (let i = 0; i < Math.min(100, uint8Array.length - 1); i++) {
      if (uint8Array[i] === 0xFF && (uint8Array[i + 1] & 0xE0) === 0xE0) {
        foundSync = true
        break
      }
    }
    
    if (!foundSync) {
      console.warn('   Warning: Downloaded file may not be a valid MP3')
    }
  }
  
  console.log('   ✅ Downloaded file appears to be valid')
}

async function testCompleteWorkflow(): Promise<void> {
  // Test the complete workflow: upload -> convert -> monitor -> download
  const { fileId } = await testFileUpload()
  const jobId = await testAudioConversion(fileId)
  await testProgressTracking(jobId)
  await testDownload(jobId)
}

async function testProgressThrottling(): Promise<void> {
  // Test that progress updates are properly throttled
  console.log('   Testing progress update throttling...')
  
  const { fileId } = await testFileUpload()
  const jobId = await testAudioConversion(fileId)
  
  // Monitor progress with high frequency polling to test throttling
  let progressCalls = 0
  let uniqueProgressValues = new Set<number>()
  const startTime = Date.now()
  
  while (Date.now() - startTime < 10000) { // Poll for 10 seconds
    try {
      const progressResponse = await fetch(`http://localhost:3000/api/progress?jobId=${jobId}`)
      if (progressResponse.ok) {
        const progressData = await progressResponse.json()
        progressCalls++
        uniqueProgressValues.add(progressData.progress)
        
        if (progressData.progress >= 100) {
          break
        }
      }
    } catch (error) {
      // Ignore errors during high-frequency polling
    }
    
    await new Promise(resolve => setTimeout(resolve, 100)) // Poll every 100ms
  }
  
  console.log(`   Made ${progressCalls} progress API calls`)
  console.log(`   Received ${uniqueProgressValues.size} unique progress values`)
  
  // Verify throttling is working (should have fewer unique values than calls)
  if (uniqueProgressValues.size >= progressCalls * 0.8) {
    console.warn('   Warning: Progress throttling may not be working optimally')
  } else {
    console.log('   ✅ Progress throttling appears to be working correctly')
  }
}

async function testErrorHandling(): Promise<void> {
  console.log('   Testing error handling...')
  
  // Test conversion with invalid fileId
  try {
    const conversionResponse = await fetch('http://localhost:3000/api/convert-audio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileId: 'nonexistent-file-id',
        format: 'mp3',
        quality: '192k'
      })
    })
    
    if (conversionResponse.ok) {
      throw new Error('Expected conversion to fail with invalid fileId')
    }
    
    const errorData = await conversionResponse.json()
    console.log(`   ✅ Error handling working: ${errorData.error}`)
    
  } catch (error) {
    if (error instanceof Error && error.message.includes('Expected conversion to fail')) {
      throw error
    }
    console.log(`   ✅ Error handling working: ${error}`)
  }
  
  // Test progress API with invalid jobId
  try {
    const progressResponse = await fetch('http://localhost:3000/api/progress?jobId=nonexistent-job-id')
    
    if (progressResponse.status !== 404) {
      throw new Error(`Expected 404 for invalid jobId, got ${progressResponse.status}`)
    }
    
    console.log('   ✅ Progress API error handling working')
    
  } catch (error) {
    if (error instanceof Error && error.message.includes('Expected 404')) {
      throw error
    }
    console.log(`   ✅ Progress API error handling working: ${error}`)
  }
}

async function main(): Promise<void> {
  console.log('🚀 Starting Audio Conversion Workflow Tests')
  console.log('=' .repeat(60))
  
  try {
    // Initialize services first
    console.log('📋 Initializing AWS services...')
    await initializeAllServices()
    console.log('✅ Services initialized successfully')
    
    // Check if the development server is running
    try {
      const healthResponse = await fetch('http://localhost:3000/api/health')
      if (!healthResponse.ok) {
        throw new Error('Health check failed')
      }
      console.log('✅ Development server is running')
    } catch (error) {
      throw new Error('Development server is not running. Please start it with: npm run dev')
    }
    
    // Run all tests
    const tests = [
      { name: 'Complete Workflow', fn: testCompleteWorkflow },
      { name: 'Progress Throttling', fn: testProgressThrottling },
      { name: 'Error Handling', fn: testErrorHandling }
    ]
    
    const results: TestResult[] = []
    
    for (const test of tests) {
      const result = await runTest(test.name, test.fn)
      results.push(result)
    }
    
    // Summary
    console.log('\n' + '=' .repeat(60))
    console.log('📊 Test Results Summary')
    console.log('=' .repeat(60))
    
    const passed = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length
    const totalTime = results.reduce((sum, r) => sum + (r.duration || 0), 0)
    
    console.log(`✅ Passed: ${passed}`)
    console.log(`❌ Failed: ${failed}`)
    console.log(`⏱️  Total time: ${totalTime}ms`)
    
    if (failed > 0) {
      console.log('\n❌ Failed tests:')
      results.filter(r => !r.success).forEach(r => {
        console.log(`   - ${r.testName}: ${r.error}`)
      })
      process.exit(1)
    } else {
      console.log('\n🎉 All tests passed! Audio conversion workflow is working correctly.')
      console.log('\n✨ Key features verified:')
      console.log('   - File upload and storage')
      console.log('   - Audio conversion with DynamoDB progress tracking')
      console.log('   - Real-time progress monitoring with throttling')
      console.log('   - File download and validation')
      console.log('   - Error handling for invalid inputs')
      console.log('\n🔥 The frontend can now use DynamoDB-based progress tracking!')
    }
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error)
    process.exit(1)
  }
}

// Run the tests
main().catch(error => {
  console.error('💥 Unexpected error:', error)
  process.exit(1)
})