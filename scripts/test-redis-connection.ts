#!/usr/bin/env tsx

/**
 * Test Redis connection with different configurations
 */

import { createClient } from 'redis'

const REDIS_ENDPOINT = 'master.audio-conversion-redis.u6km1j.use1.cache.amazonaws.com'
const REDIS_PORT = 6379

async function testRedisConnection() {
    console.log('🧪 Testing Redis Connection')
    console.log('=' .repeat(40))
    
    const configurations = [
        {
            name: 'Production TLS (App Runner config)',
            config: {
                url: `rediss://${REDIS_ENDPOINT}:${REDIS_PORT}`,
                socket: {
                    connectTimeout: 10000,
                    tls: true
                }
            }
        },
        {
            name: 'Extended Timeout TLS',
            config: {
                url: `rediss://${REDIS_ENDPOINT}:${REDIS_PORT}`,
                socket: {
                    connectTimeout: 30000,
                    tls: true,
                    rejectUnauthorized: false
                }
            }
        },
        {
            name: 'No TLS (fallback test)',
            config: {
                url: `redis://${REDIS_ENDPOINT}:${REDIS_PORT}`,
                socket: {
                    connectTimeout: 10000
                }
            }
        }
    ]
    
    for (const { name, config } of configurations) {
        console.log(`\n🔌 Testing: ${name}`)
        console.log(`   URL: ${config.url}`)
        
        try {
            const client = createClient(config)
            
            // Set up error handler
            client.on('error', (err) => {
                console.log(`   ❌ Connection error: ${err.message}`)
            })
            
            console.log('   ⏳ Connecting...')
            await client.connect()
            
            console.log('   ⏳ Testing PING...')
            const pong = await client.ping()
            console.log(`   ✅ PING response: ${pong}`)
            
            console.log('   ⏳ Testing SET/GET...')
            await client.set('test:connection', 'success')
            const value = await client.get('test:connection')
            console.log(`   ✅ SET/GET test: ${value}`)
            
            await client.del('test:connection')
            await client.disconnect()
            
            console.log(`   ✅ ${name} - SUCCESS!`)
            console.log('   💡 This configuration works. Use it in App Runner.')
            break
            
        } catch (error: any) {
            console.log(`   ❌ ${name} - FAILED: ${error.message}`)
            
            // Provide specific guidance based on error
            if (error.message.includes('timeout')) {
                console.log('   💡 Timeout suggests security group or network issue')
            } else if (error.message.includes('ENOTFOUND')) {
                console.log('   💡 DNS resolution failed - check endpoint')
            } else if (error.message.includes('ECONNREFUSED')) {
                console.log('   💡 Connection refused - Redis may not be running')
            } else if (error.message.includes('SSL') || error.message.includes('TLS')) {
                console.log('   💡 TLS issue - try without TLS or check certificates')
            }
        }
    }
    
    console.log('\n📋 Summary:')
    console.log('   If all tests failed:')
    console.log('   1. Security group issue (most common)')
    console.log('   2. Redis cluster not in same VPC as App Runner')
    console.log('   3. App Runner needs VPC connector')
    console.log('   4. Redis cluster subnet group misconfigured')
}

if (require.main === module) {
    testRedisConnection()
}