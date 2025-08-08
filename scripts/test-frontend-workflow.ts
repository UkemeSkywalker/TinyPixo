#!/usr/bin/env tsx

/**
 * Test Frontend Workflow
 * 
 * This script tests the complete frontend workflow by simulating API calls
 */

import fetch from 'node-fetch'
import { readFileSync } from 'fs'
import { join } from 'path'

const BASE_URL = 'http://localhost:3000'

async function testWorkflow() {
  console.log('🧪 Testing Frontend Workflow')
  console.log('=' .repeat(50))

  try {
    // Test 1: Upload a test file
    console.log('\n1️⃣ Testing file upload...')
    
    // Create a simple test audio file (just for testing the API)
    const testFileContent = Buffer.from('fake audio content for testing')
    const formData = new FormData()
    
    // Create a File-like object for testing
    const testFile = new Blob([testFileContent], { type: 'audio/mpeg' })
    formData.append('file', testFile, 'test.mp3')

    const uploadResponse = await fetch(`${BASE_URL}/api/upload-audio`, {
      method: 'POST',
      body: formData as any
    })

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text()
      throw new Error(`Upload failed: ${uploadResponse.status} - ${error}`)
    }

    const uploadResult = await uploadResponse.json()
    console.log('✅ Upload successful:', uploadResult)

    // Test 2: Start conversion
    console.log('\n2️⃣ Testing conversion start...')
    
    const conversionResponse = await fetch(`${BASE_URL}/api/convert-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileId: uploadResult.fileId,
        format: 'wav',
        quality: '192k'
      })
    })

    if (!conversionResponse.ok) {
      const error = await conversionResponse.text()
      throw new Error(`Conversion failed: ${conversionResponse.status} - ${error}`)
    }

    const conversionResult = await conversionResponse.json()
    console.log('✅ Conversion started:', conversionResult)

    // Test 3: Check progress
    console.log('\n3️⃣ Testing progress polling...')
    
    const progressResponse = await fetch(`${BASE_URL}/api/progress?jobId=${conversionResult.jobId}`)
    
    if (!progressResponse.ok) {
      const error = await progressResponse.text()
      throw new Error(`Progress check failed: ${progressResponse.status} - ${error}`)
    }

    const progressResult = await progressResponse.json()
    console.log('✅ Progress check successful:', progressResult)

    console.log('\n🎉 All tests passed! Frontend workflow is working correctly.')

  } catch (error) {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  }
}

// Check if server is running
async function checkServer() {
  try {
    const response = await fetch(`${BASE_URL}/api/health`)
    return response.ok
  } catch {
    return false
  }
}

async function main() {
  const serverRunning = await checkServer()
  
  if (!serverRunning) {
    console.log('❌ Server is not running at http://localhost:3000')
    console.log('Please start the development server with: npm run dev')
    process.exit(1)
  }

  await testWorkflow()
}

main().catch(console.error)