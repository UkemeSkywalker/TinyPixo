#!/usr/bin/env tsx

/**
 * Detailed Redis connectivity test with comprehensive diagnostics
 */

import Redis from 'ioredis'
import { getEnvironmentConfig } from '../lib/environment'

async function testRedisDetailed() {
  console.log('🔍 Detailed Redis Connectivity Test')
  console.log('===================================')
  
  const config = getEnvironmentConfig()
  
  console.log('\n📋 Configuration:')
  console.log(`   Environment: ${config.environment}`)
  console.log(`   Host: ${config.redis.host}`)
  console.log(`   Port: ${config.redis.port}`)
  console.log(`   TLS: ${config.redis.tls}`)
  
  if (!config.redis.host || config.redis.host === 'localhost') {
    console.log('❌ Redis not configured for this environment')
    return
  }
  
  let redis: Redis | null = null
  const tests = []
  
  try {
    // Test 1: Connection
    console.log('\n🔌 Test 1: Connection')
    const connectStart = Date.now()
    
    redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      tls: config.redis.tls ? {} : undefined,
      connectTimeout: 10000,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      // Enable more detailed logging
      showFriendlyErrorStack: true
    })
    
    // Listen for connection events
    redis.on('connect', () => {
      console.log('   ✅ Connected to Redis')
    })
    
    redis.on('ready', () => {
      console.log('   ✅ Redis is ready')
    })
    
    redis.on('error', (error) => {
      console.log(`   ❌ Redis error: ${error.message}`)
    })
    
    redis.on('close', () => {
      console.log('   ℹ️ Redis connection closed')
    })
    
    await redis.connect()
    const connectTime = Date.now() - connectStart
    console.log(`   ✅ Connection successful (${connectTime}ms)`)
    tests.push({ name: 'Connection', success: true, time: connectTime })
    
    // Test 2: Ping
    console.log('\n🏓 Test 2: Ping')
    const pingStart = Date.now()
    const pong = await redis.ping()
    const pingTime = Date.now() - pingStart
    console.log(`   ✅ Ping successful: ${pong} (${pingTime}ms)`)
    tests.push({ name: 'Ping', success: true, time: pingTime })
    
    // Test 3: Set/Get
    console.log('\n📝 Test 3: Set/Get Operations')
    const setGetStart = Date.now()
    const testKey = `test-${Date.now()}`
    const testValue = 'Hello Redis!'
    
    await redis.set(testKey, testValue, 'EX', 60)
    const retrievedValue = await redis.get(testKey)
    await redis.del(testKey)
    
    const setGetTime = Date.now() - setGetStart
    
    if (retrievedValue === testValue) {
      console.log(`   ✅ Set/Get successful (${setGetTime}ms)`)
      tests.push({ name: 'Set/Get', success: true, time: setGetTime })
    } else {
      console.log(`   ❌ Set/Get failed: expected '${testValue}', got '${retrievedValue}'`)
      tests.push({ name: 'Set/Get', success: false, error: 'Value mismatch' })
    }
    
    // Test 4: Redis Info
    console.log('\n📊 Test 4: Redis Server Info')
    const info = await redis.info('server')
    const lines = info.split('\r\n').filter(line => line && !line.startsWith('#'))
    
    console.log('   Server Information:')
    lines.slice(0, 10).forEach(line => {
      if (line.includes(':')) {
        const [key, value] = line.split(':')
        console.log(`     ${key}: ${value}`)
      }
    })
    
    // Test 5: Memory Usage
    console.log('\n💾 Test 5: Memory Usage')
    const memoryInfo = await redis.info('memory')
    const memoryLines = memoryInfo.split('\r\n').filter(line => 
      line.includes('used_memory_human') || 
      line.includes('used_memory_peak_human') ||
      line.includes('maxmemory_human')
    )
    
    memoryLines.forEach(line => {
      if (line.includes(':')) {
        const [key, value] = line.split(':')
        console.log(`     ${key}: ${value}`)
      }
    })
    
    // Test 6: Connection Pool
    console.log('\n🏊 Test 6: Connection Pool Test')
    const poolStart = Date.now()
    const promises = []
    
    for (let i = 0; i < 5; i++) {
      promises.push(redis.ping())
    }
    
    await Promise.all(promises)
    const poolTime = Date.now() - poolStart
    console.log(`   ✅ 5 concurrent pings successful (${poolTime}ms)`)
    
    console.log('\n🎉 All Redis tests completed successfully!')
    
  } catch (error: any) {
    console.error(`\n❌ Redis test failed: ${error.message}`)
    console.error(`   Error code: ${error.code}`)
    console.error(`   Error stack: ${error.stack}`)
    
    // Provide specific troubleshooting based on error
    if (error.code === 'ETIMEDOUT') {
      console.log('\n💡 Connection timeout troubleshooting:')
      console.log('   1. Check security groups allow port 6379')
      console.log('   2. Verify Redis cluster is in same VPC')
      console.log('   3. Check network ACLs')
      console.log('   4. Verify Redis endpoint is correct')
    } else if (error.code === 'ENOTFOUND') {
      console.log('\n💡 DNS resolution failed:')
      console.log('   1. Check Redis endpoint URL is correct')
      console.log('   2. Verify DNS resolution works')
    } else if (error.message.includes('TLS') || error.message.includes('SSL')) {
      console.log('\n💡 TLS/SSL issue:')
      console.log('   1. ElastiCache requires TLS in production')
      console.log('   2. Check REDIS_TLS environment variable')
    }
    
  } finally {
    if (redis) {
      redis.disconnect()
    }
  }
  
  // Summary
  console.log('\n📊 Test Summary:')
  console.log('================')
  tests.forEach(test => {
    const status = test.success ? '✅' : '❌'
    const time = test.time ? ` (${test.time}ms)` : ''
    console.log(`${status} ${test.name}${time}`)
  })
}

if (require.main === module) {
  testRedisDetailed()
}