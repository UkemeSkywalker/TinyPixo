import { NextResponse } from 'next/server'
import Redis from 'ioredis'
import { getEnvironmentConfig } from '../../../../lib/environment'

/**
 * Dedicated Redis connectivity check endpoint
 * This endpoint specifically tests Redis connection and provides detailed diagnostics
 */
export async function GET() {
  const startTime = Date.now()
  let redis: Redis | null = null
  
  try {
    const config = getEnvironmentConfig()
    
    const redisStatus = {
      status: 'unknown',
      timestamp: new Date().toISOString(),
      config: {
        host: config.redis.host,
        port: config.redis.port,
        tls: config.redis.tls
      },
      connection: {
        connected: false,
        connectTime: null,
        pingTime: null,
        error: null
      },
      tests: {
        ping: { success: false, time: null, error: null },
        setGet: { success: false, time: null, error: null },
        info: { success: false, data: null, error: null }
      }
    }
    
    // Skip if not configured
    if (!config.redis.host || config.redis.host === 'localhost') {
      redisStatus.status = 'not_configured'
      redisStatus.connection.error = 'Redis endpoint not configured'
      return NextResponse.json(redisStatus, { status: 200 })
    }
    
    // Test connection
    const connectStart = Date.now()
    redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      tls: config.redis.tls ? {} : undefined,
      connectTimeout: 5000,
      lazyConnect: true,
      maxRetriesPerRequest: 2
    })
    
    await redis.connect()
    redisStatus.connection.connected = true
    redisStatus.connection.connectTime = Date.now() - connectStart
    
    // Test ping
    const pingStart = Date.now()
    try {
      const pong = await redis.ping()
      redisStatus.tests.ping.success = true
      redisStatus.tests.ping.time = Date.now() - pingStart
      redisStatus.connection.pingTime = redisStatus.tests.ping.time
    } catch (pingError: any) {
      redisStatus.tests.ping.error = pingError.message
    }
    
    // Test set/get
    const setGetStart = Date.now()
    try {
      const testKey = `health-check-${Date.now()}`
      const testValue = 'test-value'
      
      await redis.set(testKey, testValue, 'EX', 60) // Expire in 60 seconds
      const retrievedValue = await redis.get(testKey)
      await redis.del(testKey) // Clean up
      
      if (retrievedValue === testValue) {
        redisStatus.tests.setGet.success = true
        redisStatus.tests.setGet.time = Date.now() - setGetStart
      } else {
        redisStatus.tests.setGet.error = `Value mismatch: expected ${testValue}, got ${retrievedValue}`
      }
    } catch (setGetError: any) {
      redisStatus.tests.setGet.error = setGetError.message
    }
    
    // Get Redis info
    try {
      const info = await redis.info('server')
      const lines = info.split('\r\n').filter(line => line && !line.startsWith('#'))
      const infoObj: any = {}
      
      lines.forEach(line => {
        const [key, value] = line.split(':')
        if (key && value) {
          infoObj[key] = value
        }
      })
      
      redisStatus.tests.info.success = true
      redisStatus.tests.info.data = {
        redis_version: infoObj.redis_version,
        redis_mode: infoObj.redis_mode,
        tcp_port: infoObj.tcp_port,
        uptime_in_seconds: infoObj.uptime_in_seconds
      }
    } catch (infoError: any) {
      redisStatus.tests.info.error = infoError.message
    }
    
    // Determine overall status
    if (redisStatus.connection.connected && redisStatus.tests.ping.success) {
      if (redisStatus.tests.setGet.success) {
        redisStatus.status = 'healthy'
      } else {
        redisStatus.status = 'degraded' // Connected but can't read/write
      }
    } else {
      redisStatus.status = 'unhealthy'
    }
    
    const totalTime = Date.now() - startTime
    
    return NextResponse.json({
      ...redisStatus,
      totalTestTime: totalTime
    }, {
      status: 200,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    })
    
  } catch (error: any) {
    const totalTime = Date.now() - startTime
    
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      errorCode: error.code,
      totalTestTime: totalTime,
      connection: {
        connected: false,
        error: error.message
      }
    }, {
      status: 200, // Still return 200 so it doesn't affect health checks
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    })
    
  } finally {
    if (redis) {
      try {
        redis.disconnect()
      } catch (disconnectError) {
        // Ignore disconnect errors
      }
    }
  }
}