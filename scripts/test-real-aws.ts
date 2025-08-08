#!/usr/bin/env tsx

import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import FormData from 'form-data'
import fetch from 'node-fetch'

const UPLOAD_ENDPOINT = 'http://localhost:3000/api/upload-audio'

interface TestResult {
  test: string
  passed: boolean
  details: string
  error?: string
}

const results: TestResult[] = []

function logResult(test: string, passed: boolean, details: string, error?: string) {
  const result = { test, passed, details, error }
  results.push(result)
  
  const status = passed ? '✅' : '❌'
  console.log(`${status} ${test}: ${details}`)
  if (error) {
    console.log(`   Error: ${error}`)
  }
}

function createTestAudioFile(filename: string, sizeInMB: number): Buffer {
  const sizeInBytes = sizeInMB * 1024 * 1024
  const content = Buffer.alloc(sizeInBytes, 'a')
  writeFileSync(filename, content)
  return content
}

async function testWithRealAWS() {
  console.log('🧪 TESTING WITH REAL AWS S3')
  console.log('=' .repeat(50))
  
  // Check if we're configured for real AWS
  const forceAws = process.env.FORCE_AWS_ENVIRONMENT
  const awsRegion = process.env.AWS_REGION
  const bucketName = process.env.S3_BUCKET_NAME
  
  console.log(`FORCE_AWS_ENVIRONMENT: ${forceAws}`)
  console.log(`AWS_REGION: ${awsRegion}`)
  console.log(`S3_BUCKET_NAME: ${bucketName}`)
  
  if (forceAws !== 'true') {
    console.log('\n⚠️  To test with real AWS, set FORCE_AWS_ENVIRONMENT=true')
    console.log('   Also ensure AWS credentials are configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)')
    console.log('   And set AWS_REGION and S3_BUCKET_NAME')
    return
  }
  
  if (!awsRegion || !bucketName) {
    console.log('\n❌ Missing required AWS configuration:')
    console.log('   - AWS_REGION must be set')
    console.log('   - S3_BUCKET_NAME must be set')
    return
  }
  
  console.log('\n🚀 Testing upload to real AWS S3...')
  
  try {
    // Test 1: Small file upload
    const filename = 'aws-test-small.mp3'
    const content = createTestAudioFile(filename, 5) // 5MB file
    
    const form = new FormData()
    form.append('file', readFileSync(filename), {
      filename: filename,
      contentType: 'audio/mpeg'
    })
    
    console.log('\nUploading 5MB test file to real AWS S3...')
    const response = await fetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      body: form
    })
    
    const result = await response.json()
    
    // Clean up local file
    unlinkSync(filename)
    
    if (response.status === 200 && result.success) {
      logResult(
        'Real AWS S3 Upload',
        true,
        `Successfully uploaded to real AWS S3. FileId: ${result.fileId}, Bucket: ${result.s3Location.bucket}`
      )
      
      console.log('\n📍 File uploaded to real AWS S3:')
      console.log(`   Bucket: ${result.s3Location.bucket}`)
      console.log(`   Key: ${result.s3Location.key}`)
      console.log(`   Size: ${result.size} bytes`)
      console.log(`   Region: ${awsRegion}`)
      console.log(`   Console URL: https://${awsRegion}.console.aws.amazon.com/s3/object/${result.s3Location.bucket}?prefix=${result.s3Location.key}`)
      
    } else {
      logResult(
        'Real AWS S3 Upload',
        false,
        `Upload to real AWS S3 failed with status ${response.status}`,
        JSON.stringify(result)
      )
    }
    
    // Test 2: Large file upload (multipart)
    const largeFilename = 'aws-test-large.wav'
    const largeContent = createTestAudioFile(largeFilename, 25) // 25MB file
    
    const largeForm = new FormData()
    largeForm.append('file', readFileSync(largeFilename), {
      filename: largeFilename,
      contentType: 'audio/wav'
    })
    
    console.log('\nUploading 25MB test file to real AWS S3 (multipart)...')
    const largeResponse = await fetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      body: largeForm
    })
    
    const largeResult = await largeResponse.json()
    
    // Clean up local file
    unlinkSync(largeFilename)
    
    if (largeResponse.status === 200 && largeResult.success) {
      logResult(
        'Real AWS S3 Multipart Upload',
        true,
        `Successfully uploaded large file to real AWS S3 using multipart. FileId: ${largeResult.fileId}`
      )
      
      console.log('\n📍 Large file uploaded to real AWS S3:')
      console.log(`   Bucket: ${largeResult.s3Location.bucket}`)
      console.log(`   Key: ${largeResult.s3Location.key}`)
      console.log(`   Size: ${largeResult.size} bytes`)
      console.log(`   Console URL: https://${awsRegion}.console.aws.amazon.com/s3/object/${largeResult.s3Location.bucket}?prefix=${largeResult.s3Location.key}`)
      
    } else {
      logResult(
        'Real AWS S3 Multipart Upload',
        false,
        `Large file upload to real AWS S3 failed with status ${largeResponse.status}`,
        JSON.stringify(largeResult)
      )
    }
    
  } catch (error) {
    logResult(
      'Real AWS S3 Test',
      false,
      'Failed to test with real AWS S3',
      error instanceof Error ? error.message : String(error)
    )
  }
}

async function testWithLocalStack() {
  console.log('\n🧪 TESTING WITH LOCALSTACK S3')
  console.log('=' .repeat(50))
  
  // Ensure we're using LocalStack
  const originalForceAws = process.env.FORCE_AWS_ENVIRONMENT
  delete process.env.FORCE_AWS_ENVIRONMENT
  
  try {
    const filename = 'localstack-test.mp3'
    const content = createTestAudioFile(filename, 10) // 10MB file
    
    const form = new FormData()
    form.append('file', readFileSync(filename), {
      filename: filename,
      contentType: 'audio/mpeg'
    })
    
    console.log('\nUploading 10MB test file to LocalStack S3...')
    const response = await fetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      body: form
    })
    
    const result = await response.json()
    
    // Clean up local file
    unlinkSync(filename)
    
    if (response.status === 200 && result.success) {
      logResult(
        'LocalStack S3 Upload',
        true,
        `Successfully uploaded to LocalStack S3. FileId: ${result.fileId}`
      )
      
      console.log('\n📍 File uploaded to LocalStack S3:')
      console.log(`   Bucket: ${result.s3Location.bucket}`)
      console.log(`   Key: ${result.s3Location.key}`)
      console.log(`   Size: ${result.size} bytes`)
      console.log(`   LocalStack URL: http://localhost:4566/${result.s3Location.bucket}/${result.s3Location.key}`)
      
    } else {
      logResult(
        'LocalStack S3 Upload',
        false,
        `Upload to LocalStack S3 failed with status ${response.status}`,
        JSON.stringify(result)
      )
    }
    
  } catch (error) {
    logResult(
      'LocalStack S3 Test',
      false,
      'Failed to test with LocalStack S3',
      error instanceof Error ? error.message : String(error)
    )
  } finally {
    // Restore original setting
    if (originalForceAws) {
      process.env.FORCE_AWS_ENVIRONMENT = originalForceAws
    }
  }
}

async function printSummary() {
  console.log('\n📊 AWS TESTING SUMMARY')
  console.log('=' .repeat(50))
  
  const passed = results.filter(r => r.passed).length
  const total = results.length
  
  console.log(`Total tests: ${total}`)
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${total - passed}`)
  
  if (total - passed > 0) {
    console.log('\n❌ Failed tests:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.test}: ${r.details}`)
      if (r.error) {
        console.log(`    Error: ${r.error}`)
      }
    })
  }
  
  console.log('\n' + '='.repeat(50))
  
  if (passed === total) {
    console.log('🎉 ALL AWS TESTS PASSED!')
    console.log('\nBoth LocalStack and Real AWS S3 uploads working correctly!')
  } else {
    console.log('❌ Some AWS tests failed. Please check the configuration.')
  }
}

async function main() {
  console.log('🧪 AWS S3 UPLOAD TESTING')
  console.log('Testing uploads to both LocalStack and Real AWS S3')
  console.log('=' .repeat(80))
  
  // Check if server is running
  try {
    const healthCheck = await fetch('http://localhost:3000/api/upload-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invalid' })
    })
    
    if (healthCheck.status !== 400) {
      console.log('❌ Server not responding correctly. Make sure Next.js dev server is running.')
      process.exit(1)
    }
  } catch (error) {
    console.log('❌ Cannot connect to server. Make sure Next.js dev server is running on port 3000.')
    console.log('   Run: npm run dev')
    process.exit(1)
  }
  
  // Test with LocalStack first
  await testWithLocalStack()
  
  // Test with real AWS if configured
  await testWithRealAWS()
  
  await printSummary()
}

// Run tests
main().catch(error => {
  console.error('❌ AWS testing failed:', error)
  process.exit(1)
})