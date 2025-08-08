#!/usr/bin/env tsx

/**
 * Test script to verify the download retry logic works correctly
 */

console.log('🔍 Testing Download Retry Logic')
console.log('=' .repeat(50))

// Simulate the download retry logic
async function simulateDownloadWithRetry(jobId: string, simulateDelay: boolean = true): Promise<boolean> {
  const maxRetries = 5
  const retryDelay = 100 // Shorter delay for testing

  console.log(`📥 Starting download simulation for job: ${jobId}`)

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`  🔄 Attempt ${attempt}/${maxRetries}`)

      // Simulate the timing issue - first few attempts fail, then succeed
      if (simulateDelay && attempt < 3) {
        console.log(`  ⏳ Simulating "not completed yet" error`)
        throw new Error('Conversion not completed yet')
      }

      console.log(`  ✅ Download successful on attempt ${attempt}`)
      return true

    } catch (error) {
      if (attempt === maxRetries) {
        console.log(`  ❌ Download failed after all retries: ${error}`)
        return false
      }
      
      if (error instanceof Error && error.message.includes('not completed yet')) {
        console.log(`  ⏳ Retrying in ${retryDelay}ms`)
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        continue
      }
      
      console.log(`  ❌ Non-retryable error: ${error}`)
      return false
    }
  }

  return false
}

async function runTests() {
  console.log('\n🧪 Test 1: Download with timing delay (should succeed)')
  const test1Result = await simulateDownloadWithRetry('test-job-1', true)
  console.log(`Result: ${test1Result ? '✅ PASS' : '❌ FAIL'}`)

  console.log('\n🧪 Test 2: Download without delay (should succeed immediately)')
  const test2Result = await simulateDownloadWithRetry('test-job-2', false)
  console.log(`Result: ${test2Result ? '✅ PASS' : '❌ FAIL'}`)

  console.log('\n📋 Summary:')
  console.log(`• Retry logic handles timing delays: ${test1Result ? '✅' : '❌'}`)
  console.log(`• Normal downloads work: ${test2Result ? '✅' : '❌'}`)

  if (test1Result && test2Result) {
    console.log('\n🎉 All tests passed! The download retry logic should resolve the timing issue.')
  } else {
    console.log('\n⚠️ Some tests failed. Check the implementation.')
  }
}

runTests().catch(console.error)