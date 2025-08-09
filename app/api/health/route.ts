import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { getEnvironmentConfig } from '../../../lib/environment'
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb'
import Redis from 'ioredis'

export async function GET(request: NextRequest) {
  try {
    const config = getEnvironmentConfig()
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: config.environment,
      activeJobs: 0,
      ffmpegAvailable: false,
      memoryUsage: process.memoryUsage(),
      diskUsage: {
        tmpFiles: 0,
        tmpSizeMB: 0,
        largeFiles: 0
      },
      services: {
        s3: { status: 'unknown', error: null },
        dynamodb: { status: 'unknown', error: null },
        redis: { status: 'unknown', error: null }
      }
    }
    
    // Check AWS services
    await Promise.allSettled([
      checkS3Health(config, health),
      checkDynamoDBHealth(config, health),
      checkRedisHealth(config, health)
    ])
    
    // Check active conversion jobs (legacy support)
    if (global.conversionProgress) {
      health.activeJobs = Object.keys(global.conversionProgress).length
    }
    
    // Check disk usage in /tmp
    try {
      const tmpFiles = await readdir('/tmp')
      let totalSize = 0
      let largeFileCount = 0
      
      for (const file of tmpFiles) {
        try {
          const filePath = join('/tmp', file)
          const stats = await stat(filePath)
          totalSize += stats.size
          
          if (stats.size > 100 * 1024 * 1024) { // Files > 100MB
            largeFileCount++
          }
        } catch (error) {
          // Skip files we can't stat
        }
      }
      
      health.diskUsage = {
        tmpFiles: tmpFiles.length,
        tmpSizeMB: Math.round(totalSize / (1024 * 1024)),
        largeFiles: largeFileCount
      }
      
      // Warn if disk usage is high
      if (health.diskUsage.tmpSizeMB > 1000) { // > 1GB
        health.status = 'warning'
      }
      
    } catch (error) {
      console.log('Could not check disk usage:', error.message)
    }
    
    // Check if FFmpeg is available
    try {
      const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
      const ffmpeg = spawn(ffmpegPath, ['-version'])
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ffmpeg.kill()
          reject(new Error('FFmpeg check timeout'))
        }, 5000)
        
        ffmpeg.on('close', (code) => {
          clearTimeout(timeout)
          if (code === 0) {
            health.ffmpegAvailable = true
            resolve(true)
          } else {
            reject(new Error(`FFmpeg exit code: ${code}`))
          }
        })
        
        ffmpeg.on('error', (err) => {
          clearTimeout(timeout)
          reject(err)
        })
      })
    } catch (error) {
      console.log('FFmpeg not available:', error.message)
      health.ffmpegAvailable = false
    }
    
    // Determine overall health status
    const serviceStatuses = Object.values(health.services).map(s => s.status)
    if (serviceStatuses.includes('unhealthy')) {
      health.status = 'unhealthy'
    } else if (serviceStatuses.includes('warning') || !health.ffmpegAvailable) {
      health.status = 'warning'
    }
    
    const statusCode = health.status === 'unhealthy' ? 503 : 200
    
    return NextResponse.json(health, {
      status: statusCode,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    })
  } catch (error) {
    console.error('Health check error:', error)
    return NextResponse.json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

async function checkS3Health(config: any, health: any) {
  try {
    const s3Client = new S3Client(config.s3)
    const bucketName = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'
    
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }))
    
    health.services.s3 = {
      status: 'healthy',
      bucket: bucketName,
      region: config.s3.region
    }
  } catch (error) {
    health.services.s3 = {
      status: 'unhealthy',
      error: error.message
    }
  }
}

async function checkDynamoDBHealth(config: any, health: any) {
  try {
    const dynamoClient = new DynamoDBClient(config.dynamodb)
    const tableName = 'audio-conversion-jobs'
    
    const response = await dynamoClient.send(new DescribeTableCommand({ 
      TableName: tableName 
    }))
    
    health.services.dynamodb = {
      status: 'healthy',
      table: tableName,
      tableStatus: response.Table?.TableStatus,
      region: config.dynamodb.region
    }
  } catch (error) {
    health.services.dynamodb = {
      status: 'unhealthy',
      error: error.message
    }
  }
}

async function checkRedisHealth(config: any, health: any) {
  let redis: Redis | null = null
  
  try {
    redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      tls: config.redis.tls ? {} : undefined,
      connectTimeout: 5000,
      lazyConnect: true
    })
    
    await redis.connect()
    await redis.ping()
    
    health.services.redis = {
      status: 'healthy',
      host: config.redis.host,
      port: config.redis.port,
      tls: config.redis.tls
    }
  } catch (error) {
    health.services.redis = {
      status: 'unhealthy',
      error: error.message
    }
  } finally {
    if (redis) {
      redis.disconnect()
    }
  }
}