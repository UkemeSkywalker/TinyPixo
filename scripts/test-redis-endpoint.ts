#!/usr/bin/env tsx

/**
 * Test Redis connectivity to the production endpoint
 */

import Redis from 'ioredis'

const REDIS_ENDPOINT = 'master.audio-conversion-redis.u6km1j.use1.cache.amazonaws.com'
const REDIS_PORT = 6379

async function testRedisConnection() {
  console.log('🔍 Testing Redis connectivity...')
  console.log(`   Endpoint: ${REDIS_ENDPOINT}:${REDIS_PORT}`)
  console.log('   TLS: enabled')
  
  let redis: Redis | null = null
  
  try {
    redis = new Redis({
      host: REDIS_ENDPOINT,
      port: REDIS_PORT,
      tls: {},
      connectTimeout: 10000,
      lazyConnect: true,
      maxRetriesPerRequest: 3
    })
    
    console.log('⏳ Connecting...')
    await redis.connect()
    
    console.log('⏳ Testing ping...')
    const pong = await redis.ping()
    console.log(`✅ Redis connection successful! Response: ${pong}`)
    
    // Test basic operations
    console.log('⏳ Testing set/get...')
    await redis.set('test-key', 'test-value', 'EX', 60)
    const value = await redis.get('test-key')
    console.log(`✅ Set/Get test successful! Value: ${value}`)
    
    // Clean up
    await redis.del('test-key')
    console.log('✅ Cleanup completed')
    
  } catch (error: any) {
    console.error('❌ Redis connection failed:', error.message)
    
    if (error.code === 'ETIMEDOUT') {
      console.log('\n💡 Connection timeout suggests:')
      console.log('   1. Security group doesn\'t allow port 6379')
      console.log('   2. Network ACLs blocking traffic')
      console.log('   3. ElastiCache cluster in different VPC')
    } else if (error.code === 'ENOTFOUND') {
      console.log('\n💡 DNS resolution failed - check endpoint URL')
    } else if (error.message.includes('TLS')) {
      console.log('\n💡 TLS/SSL issue - ElastiCache requires encryption in transit')
    }
    
  } finally {
    if (redis) {
      redis.disconnect()
    }
  }
}

async function main() {
  console.log('🔧 Redis Endpoint Connectivity Test')
  console.log('===================================')
  
  await testRedisConnection()
  
  console.log('\n💡 If this test fails from your local machine but works from EC2:')
  console.log('   - Your local IP might not be allowed in security groups')
  console.log('   - Try running this test from an EC2 instance in the same VPC')
  console.log('\n💡 If this test works but App Runner still fails:')
  console.log('   - App Runner might be in a different VPC')
  console.log('   - Check App Runner VPC configuration')
}

if (require.main === module) {
  main()
}