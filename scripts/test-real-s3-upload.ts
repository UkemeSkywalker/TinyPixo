#!/usr/bin/env tsx

import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import FormData from 'form-data'
import fetch from 'node-fetch'

async function testRealS3Upload() {
  console.log('🧪 TESTING UPLOAD TO REAL AWS S3')
  console.log('=' .repeat(50))
  
  // Check current environment
  console.log('Current environment settings:')
  console.log(`FORCE_AWS_ENVIRONMENT: ${process.env.FORCE_AWS_ENVIRONMENT}`)
  console.log(`AWS_REGION: ${process.env.AWS_REGION}`)
  console.log(`S3_BUCKET_NAME: ${process.env.S3_BUCKET_NAME}`)
  console.log(`AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID ? 'Set' : 'Not set'}`)
  console.log(`AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET_ACCESS_KEY ? 'Set' : 'Not set'}`)
  
  // Temporarily switch to real AWS
  const originalForceAws = process.env.FORCE_AWS_ENVIRONMENT
  process.env.FORCE_AWS_ENVIRONMENT = 'true'
  
  try {
    // Create a test file
    const filename = 'real-aws-test.mp3'
    const content = Buffer.alloc(5 * 1024 * 1024, 'a') // 5MB test file
    writeFileSync(filename, content)
    
    console.log(`\n📤 Uploading ${filename} (${(content.length / 1024 / 1024).toFixed(2)} MB) to real AWS S3...`)
    
    // Create form data
    const form = new FormData()
    form.append('file', readFileSync(filename), {
      filename: filename,
      contentType: 'audio/mpeg'
    })
    
    // Upload to real AWS S3
    const response = await fetch('http://localhost:3000/api/upload-audio', {
      method: 'POST',
      body: form
    })
    
    const result = await response.json()
    
    // Clean up local file
    unlinkSync(filename)
    
    if (response.status === 200 && result.success) {
      console.log('\n✅ SUCCESS! File uploaded to real AWS S3!')
      console.log(`📍 File details:`)
      console.log(`   File ID: ${result.fileId}`)
      console.log(`   File Name: ${result.fileName}`)
      console.log(`   Size: ${(result.size / 1024 / 1024).toFixed(2)} MB`)
      console.log(`   S3 Bucket: ${result.s3Location.bucket}`)
      console.log(`   S3 Key: ${result.s3Location.key}`)
      console.log(`   AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`)
      
      console.log(`\n🌐 AWS Console URL:`)
      const region = process.env.AWS_REGION || 'us-east-1'
      const consoleUrl = `https://${region}.console.aws.amazon.com/s3/object/${result.s3Location.bucket}?prefix=${result.s3Location.key}`
      console.log(`   ${consoleUrl}`)
      
      console.log(`\n📋 To verify in AWS CLI:`)
      console.log(`   aws s3 ls s3://${result.s3Location.bucket}/uploads/`)
      console.log(`   aws s3 cp s3://${result.s3Location.bucket}/${result.s3Location.key} ./downloaded-file.mp3`)
      
    } else {
      console.log('\n❌ FAILED to upload to real AWS S3')
      console.log(`Status: ${response.status}`)
      console.log(`Response:`, JSON.stringify(result, null, 2))
      
      if (response.status === 500) {
        console.log('\n🔍 Possible issues:')
        console.log('   - AWS credentials not configured correctly')
        console.log('   - S3 bucket does not exist')
        console.log('   - Insufficient S3 permissions')
        console.log('   - AWS region mismatch')
      }
    }
    
  } catch (error) {
    console.log('\n❌ ERROR during upload test')
    console.error(error)
  } finally {
    // Restore original setting
    if (originalForceAws) {
      process.env.FORCE_AWS_ENVIRONMENT = originalForceAws
    } else {
      delete process.env.FORCE_AWS_ENVIRONMENT
    }
  }
}

async function main() {
  // Check if server is running
  try {
    const healthCheck = await fetch('http://localhost:3000/api/upload-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invalid' })
    })
    
    if (healthCheck.status !== 400) {
      console.log('❌ Server not responding correctly. Make sure Next.js dev server is running.')
      console.log('   Run: npm run dev')
      process.exit(1)
    }
  } catch (error) {
    console.log('❌ Cannot connect to server. Make sure Next.js dev server is running on port 3000.')
    console.log('   Run: npm run dev')
    process.exit(1)
  }
  
  await testRealS3Upload()
}

main().catch(error => {
  console.error('❌ Test failed:', error)
  process.exit(1)
})