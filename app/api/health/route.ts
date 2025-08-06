import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

export async function GET(request: NextRequest) {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      activeJobs: 0,
      ffmpegAvailable: false,
      memoryUsage: process.memoryUsage(),
      diskUsage: {
        tmpFiles: 0,
        tmpSizeMB: 0,
        largeFiles: 0
      }
    }
    
    // Check active conversion jobs
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
    
    return NextResponse.json(health, {
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