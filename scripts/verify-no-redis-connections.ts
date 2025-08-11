#!/usr/bin/env tsx

/**
 * Verification script to ensure no Redis connections are attempted
 * during DynamoDB-only progress service initialization
 */

import { DynamoDBProgressService } from '../lib/progress-service-dynamodb'
import { initializeAllServices } from '../lib/aws-services'

// Capture console logs to verify no Redis connection attempts
const originalConsoleLog = console.log
const originalConsoleError = console.error
const logs: string[] = []

console.log = (...args: any[]) => {
  const message = args.join(' ')
  logs.push(message)
  originalConsoleLog(...args)
}

console.error = (...args: any[]) => {
  const message = args.join(' ')
  logs.push(message)
  originalConsoleError(...args)
}

async function verifyNoRedisConnections() {
  console.log('🔍 Verifying no Redis connections are attempted...')
  console.log('=' .repeat(50))

  try {
    // Initialize services
    await initializeAllServices()
    
    // Create progress service
    const progressService = new DynamoDBProgressService()
    await progressService.initializeTables()
    
    // Test basic operations
    const testJobId = `no-redis-test-${Date.now()}`
    await progressService.initializeProgress(testJobId)
    await progressService.getProgress(testJobId)
    
    // Restore original console methods
    console.log = originalConsoleLog
    console.error = originalConsoleError
    
    // Check logs for actual Redis connection attempts (be very specific)
    const redisLogs = logs.filter(log => {
      const lowerLog = log.toLowerCase()
      return (
        lowerLog.includes('connecting to redis') ||
        lowerLog.includes('redis client') ||
        lowerLog.includes('redis connection') ||
        lowerLog.includes('redis url') ||
        lowerLog.includes('redis endpoint') ||
        lowerLog.includes('[redis]') ||
        lowerLog.includes('redis.set') ||
        lowerLog.includes('redis.get') ||
        lowerLog.includes('createclient')
      ) && !lowerLog.includes('redis-free') && !lowerLog.includes('no redis') && !lowerLog.includes('without redis')
    })
    
    console.log('\n📋 Redis Connection Analysis')
    console.log('-'.repeat(30))
    
    if (redisLogs.length === 0) {
      console.log('✅ No Redis connection attempts found in logs')
      console.log('✅ Service initialization is Redis-free')
    } else {
      console.log('❌ Found Redis-related log messages:')
      redisLogs.forEach(log => console.log(`  - ${log}`))
      throw new Error('Redis connections were attempted')
    }
    
    // Check for DynamoDB-only messages
    const dynamodbLogs = logs.filter(log => 
      log.toLowerCase().includes('dynamodb') ||
      log.toLowerCase().includes('progress table') ||
      log.toLowerCase().includes('uploads table')
    )
    
    console.log('\n📋 DynamoDB Usage Analysis')
    console.log('-'.repeat(30))
    
    if (dynamodbLogs.length > 0) {
      console.log('✅ DynamoDB operations detected:')
      console.log(`  - Found ${dynamodbLogs.length} DynamoDB-related log messages`)
      console.log('✅ Service is using DynamoDB for progress tracking')
    } else {
      console.log('⚠️  No DynamoDB operations detected in logs')
    }
    
    console.log('\n🎉 Verification completed successfully!')
    console.log('✅ No Redis connections attempted')
    console.log('✅ DynamoDB-only progress service working correctly')
    
  } catch (error) {
    console.log = originalConsoleLog
    console.error = originalConsoleError
    console.error('\n❌ Verification failed:', error)
    throw error
  }
}

// Run the verification
if (require.main === module) {
  verifyNoRedisConnections()
    .then(() => {
      console.log('\n✅ No Redis connections verification passed')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n❌ No Redis connections verification failed:', error)
      process.exit(1)
    })
}

export { verifyNoRedisConnections }