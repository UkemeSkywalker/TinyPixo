#!/usr/bin/env tsx

/**
 * Test Redis connection with improved configuration
 */

import { createClient } from 'redis'

const REDIS_ENDPOINT = 'master.audio-conversion-redis.u6km1j.use1.cache.amazonaws.com'
const REDIS_PORT = 6379
const REDIS_TLS = true

async function testRedisWithNewConfig() {
    console.log('🧪 Testing Redis with improved configuration')
    console.log('=' .repeat(50))
    
    const redisUrl = REDIS_TLS
        ? `rediss://${REDIS_ENDPOINT}:${REDIS_PORT}`
        : `redis://${REDIS_ENDPOINT}:${REDIS_PORT}`
    
    console.log(`🔗 Connecting to: ${redisUrl}`)
    console.log(`🔒 TLS enabled: ${REDIS_TLS}`)
    
    try {
        const client = createClient({
            url: redisUrl,
            socket: {
                connectTimeout: 30000, // 30 seconds for VPC Connector
                commandTimeout: 10000,  // 10 seconds for commands
                tls: REDIS_TLS, // Enable TLS
                rejectUnauthorized: false, // For ElastiCache TLS
                servername: REDIS_ENDPOINT
            },
            commandsQueueMaxLength: 1000,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3
        })
        
        // Set up event listeners
        client.on('error', (err) => {
            console.log(`❌ Redis error: ${err.message}`)
        })
        
        client.on('connect', () => {
            console.log('✅ Redis connected')
        })
        
        client.on('ready', () => {
            console.log('✅ Redis ready')
        })
        
        client.on('reconnecting', () => {
            console.log('🔄 Redis reconnecting...')
        })
        
        console.log('⏳ Connecting to Redis...')
        await client.connect()
        
        console.log('⏳ Testing PING...')
        const pong = await client.ping()
        console.log(`✅ PING response: ${pong}`)
        
        console.log('⏳ Testing SET/GET...')
        await client.set('test:apprunner:connection', JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'App Runner VPC Connector test'
        }))
        
        const value = await client.get('test:apprunner:connection')
        console.log(`✅ SET/GET test successful: ${value}`)
        
        console.log('⏳ Testing TTL...')
        await client.setEx('test:apprunner:ttl', 60, 'TTL test')
        const ttl = await client.ttl('test:apprunner:ttl')
        console.log(`✅ TTL test successful: ${ttl} seconds remaining`)
        
        // Cleanup
        await client.del(['test:apprunner:connection', 'test:apprunner:ttl'])
        await client.disconnect()
        
        console.log('\n🎉 All Redis tests passed!')
        console.log('💡 The improved configuration should work in App Runner')
        
    } catch (error: any) {
        console.log(`\n❌ Redis connection failed: ${error.message}`)
        
        // Provide specific guidance
        if (error.message.includes('timeout')) {
            console.log('💡 Connection timeout - possible causes:')
            console.log('   1. VPC Connector not properly configured in App Runner')
            console.log('   2. Security groups blocking traffic')
            console.log('   3. ElastiCache in different VPC than VPC Connector')
        } else if (error.message.includes('ENOTFOUND')) {
            console.log('💡 DNS resolution failed - check Redis endpoint')
        } else if (error.message.includes('SSL') || error.message.includes('TLS')) {
            console.log('💡 TLS/SSL issue - check ElastiCache encryption settings')
        }
        
        console.log('\n🔧 Next steps:')
        console.log('   1. Verify App Runner has VPC Connector configured')
        console.log('   2. Check security group rules allow port 6379')
        console.log('   3. Consider temporary workaround: disable Redis')
    }
}

if (require.main === module) {
    testRedisWithNewConfig()
}