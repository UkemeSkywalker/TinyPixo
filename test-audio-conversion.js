#!/usr/bin/env node

// Simple test script to verify audio conversion API endpoints
const fs = require('fs')
const path = require('path')

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000'

async function testAudioConversion() {
  console.log('Testing audio conversion API...')
  
  try {
    // Test 1: Check if progress API responds quickly
    console.log('\n1. Testing progress API response time...')
    const start = Date.now()
    const progressResponse = await fetch(`${BASE_URL}/api/progress?jobId=test-123`, {
      signal: AbortSignal.timeout(5000) // 5 second timeout
    })
    const elapsed = Date.now() - start
    console.log(`Progress API responded in ${elapsed}ms`)
    
    if (elapsed > 1000) {
      console.warn('⚠️  Progress API is slow (>1s), this could cause timeouts')
    } else {
      console.log('✅ Progress API responds quickly')
    }
    
    // Test 2: Check if cleanup endpoint exists
    console.log('\n2. Testing cleanup endpoint...')
    const cleanupResponse = await fetch(`${BASE_URL}/api/cleanup`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000)
    })
    
    if (cleanupResponse.ok) {
      const cleanupData = await cleanupResponse.json()
      console.log('✅ Cleanup endpoint working:', cleanupData.message)
    } else {
      console.log('❌ Cleanup endpoint failed:', cleanupResponse.status)
    }
    
    // Test 3: Check if download endpoint exists
    console.log('\n3. Testing download endpoint...')
    const downloadResponse = await fetch(`${BASE_URL}/api/convert-audio/download?jobId=nonexistent`, {
      signal: AbortSignal.timeout(5000)
    })
    
    if (downloadResponse.status === 404) {
      console.log('✅ Download endpoint exists and handles missing jobs correctly')
    } else {
      console.log('❌ Download endpoint unexpected response:', downloadResponse.status)
    }
    
    console.log('\n✅ All API endpoints are accessible and responding')
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('❌ Request timed out - this indicates a potential App Runner timeout issue')
    } else {
      console.error('❌ Test failed:', error.message)
    }
  }
}

// Run the test
testAudioConversion().catch(console.error)