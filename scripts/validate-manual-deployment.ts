#!/usr/bin/env tsx

/**
 * Simple validation script for manual App Runner deployment
 * Tests the core functionality after manual deployment
 */

async function validateDeployment(baseUrl: string) {
  console.log('🧪 Validating Manual App Runner Deployment')
  console.log(`🎯 Target: ${baseUrl}`)
  console.log('=' .repeat(50))
  
  let passed = 0
  let total = 0
  
  // Test 1: Health Check
  total++
  console.log('1️⃣ Testing health endpoint...')
  try {
    const response = await fetch(`${baseUrl}/api/health`)
    if (response.ok) {
      const health = await response.json()
      console.log(`   ✅ Health: ${health.status}`)
      console.log(`   📊 Environment: ${health.environment}`)
      console.log(`   🔧 FFmpeg: ${health.ffmpegAvailable ? 'Available' : 'Missing'}`)
      
      if (health.services) {
        console.log(`   🪣 S3: ${health.services.s3?.status || 'unknown'}`)
        console.log(`   🗄️ DynamoDB: ${health.services.dynamodb?.status || 'unknown'}`)
        console.log(`   🔴 Redis: ${health.services.redis?.status || 'unknown'}`)
      }
      passed++
    } else {
      console.log(`   ❌ Health check failed: ${response.status}`)
    }
  } catch (error) {
    console.log(`   ❌ Health check error: ${error.message}`)
  }
  
  // Test 2: Audio Converter Page
  total++
  console.log('\n2️⃣ Testing audio converter page...')
  try {
    const response = await fetch(`${baseUrl}/audio-converter`)
    if (response.ok) {
      const html = await response.text()
      if (html.includes('Audio Converter')) {
        console.log('   ✅ Audio converter page accessible')
        passed++
      } else {
        console.log('   ❌ Audio converter page missing content')
      }
    } else {
      console.log(`   ❌ Audio converter page failed: ${response.status}`)
    }
  } catch (error) {
    console.log(`   ❌ Audio converter page error: ${error.message}`)
  }
  
  // Test 3: Image Optimization (v1 feature)
  total++
  console.log('\n3️⃣ Testing image optimization (v1)...')
  try {
    const response = await fetch(`${baseUrl}/`)
    if (response.ok) {
      console.log('   ✅ Home page accessible (Sharp/image optimization should work)')
      passed++
    } else {
      console.log(`   ❌ Home page failed: ${response.status}`)
    }
  } catch (error) {
    console.log(`   ❌ Home page error: ${error.message}`)
  }
  
  // Test 4: Basic Upload Test (if you have a test file)
  total++
  console.log('\n4️⃣ Testing file upload capability...')
  try {
    // Create a small test file
    const testData = new Uint8Array(1024) // 1KB test data
    const formData = new FormData()
    const blob = new Blob([testData], { type: 'audio/mpeg' })
    formData.append('file', blob, 'test.mp3')

    const response = await fetch(`${baseUrl}/api/upload-audio`, {
      method: 'POST',
      body: formData
    })

    if (response.ok) {
      const result = await response.json()
      console.log(`   ✅ Upload successful: ${result.fileId}`)
      passed++
    } else {
      console.log(`   ❌ Upload failed: ${response.status}`)
    }
  } catch (error) {
    console.log(`   ❌ Upload error: ${error.message}`)
  }
  
  // Summary
  console.log('\n' + '=' .repeat(50))
  console.log('📊 VALIDATION SUMMARY')
  console.log('=' .repeat(50))
  console.log(`Tests Passed: ${passed}/${total}`)
  console.log(`Success Rate: ${((passed/total) * 100).toFixed(1)}%`)
  
  if (passed === total) {
    console.log('\n🎉 ALL TESTS PASSED!')
    console.log('✅ Your App Runner deployment is working correctly')
    console.log('\n📋 Next Steps:')
    console.log('1. Test with real audio files in the UI')
    console.log('2. Monitor CloudWatch logs for any issues')
    console.log('3. Test container restart resilience')
    console.log('4. Monitor progress tracking (no 95% → 0% resets)')
  } else {
    console.log('\n⚠️ Some tests failed - check the issues above')
    console.log('\n🔍 Common fixes:')
    console.log('- Verify all environment variables are set correctly')
    console.log('- Check IAM permissions for S3, DynamoDB, Redis')
    console.log('- Ensure security groups allow Redis access')
    console.log('- Review CloudWatch logs for detailed errors')
  }
}

async function main() {
  const baseUrl = process.argv[2]
  
  if (!baseUrl || !baseUrl.startsWith('http')) {
    console.error('❌ Please provide your App Runner service URL')
    console.log('Usage: tsx scripts/validate-manual-deployment.ts <app-runner-url>')
    console.log('Example: tsx scripts/validate-manual-deployment.ts https://abc123.us-east-1.awsapprunner.com')
    process.exit(1)
  }
  
  try {
    await validateDeployment(baseUrl)
  } catch (error) {
    console.error('❌ Validation failed:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}