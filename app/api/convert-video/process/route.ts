import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { readFile, unlink, access } from 'fs/promises'
import { join } from 'path'

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const { fileName, format, quality, resolution } = data
    
    if (!fileName || !format) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }
    
    const inputPath = join('/tmp', fileName)
    const outputPath = join('/tmp', `output-${Date.now()}.${format}`)
    
    // Check if the file exists
    try {
      await access(inputPath)
    } catch (error) {
      return NextResponse.json({ error: 'File not found or expired' }, { status: 404 })
    }
    
    const args = ['-i', inputPath]
    
    // Quality settings
    if (quality === 'high') args.push('-crf', '18')
    else if (quality === 'medium') args.push('-crf', '23')
    else args.push('-crf', '28')
    
    // Resolution scaling
    if (resolution && resolution !== 'original') {
      if (resolution === '1080p') args.push('-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease')
      else if (resolution === '720p') args.push('-vf', 'scale=1280:720:force_original_aspect_ratio=decrease')
      else if (resolution === '480p') args.push('-vf', 'scale=854:480:force_original_aspect_ratio=decrease')
      else if (resolution === '360p') args.push('-vf', 'scale=640:360:force_original_aspect_ratio=decrease')
    }
    
    // Codec settings
    if (format === 'mp4') {
      args.push('-c:v', 'libx264', '-preset', 'fast')
    } else if (format === 'webm') {
      args.push('-c:v', 'libvpx')
    } else if (format === 'avi') {
      args.push('-c:v', 'libx264')
    }
    
    args.push('-y', outputPath)
    
    // Create a unique job ID for this conversion
    const jobId = Date.now().toString()
    let progressData = { 
      jobId, 
      progress: 0,
      startTime: Date.now(),
      estimatedTimeRemaining: null
    }
    
    // Store progress in memory (in production, use Redis or similar)
    global.conversionProgress = global.conversionProgress || {}
    global.conversionProgress[jobId] = progressData
    
    return new Promise<NextResponse>((resolve) => {
      // Use system FFmpeg (needs to be installed locally)
      const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
      console.log(`Using FFmpeg path: ${ffmpegPath}`)
      
      try {
        const ffmpeg = spawn(ffmpegPath, args)
        
        // Handle spawn errors
        ffmpeg.on('error', (err) => {
          console.error('FFmpeg spawn error:', err)
          resolve(NextResponse.json({ error: 'FFmpeg process error: ' + err.message }, { status: 500 }))
        })
        
        // Track if we've found the duration
        let totalDuration = 60 // Default assumption (60 seconds)
        let durationFound = false
        
        // Capture stderr for progress tracking
        ffmpeg.stderr.on('data', (data) => {
          const output = data.toString()
          
          // First try to find duration in the output
          if (!durationFound) {
            const durationMatch = output.match(/Duration: ([\\d:.]+)/)
            if (durationMatch && durationMatch[1]) {
              const durationParts = durationMatch[1].split(':')
              totalDuration = 
                parseFloat(durationParts[0]) * 3600 + 
                parseFloat(durationParts[1]) * 60 + 
                parseFloat(durationParts[2])
              durationFound = true
              console.log(`Detected video duration: ${totalDuration} seconds`)
            }
          }
          
          // Look for time=00:00:00.00 pattern in FFmpeg output
          const timeMatch = output.match(/time=([\\d:.]+)/)
          if (timeMatch && timeMatch[1]) {
            const timeParts = timeMatch[1].split(':')
            const seconds = 
              parseFloat(timeParts[0]) * 3600 + 
              parseFloat(timeParts[1]) * 60 + 
              parseFloat(timeParts[2])
            
            // Calculate progress based on detected duration
            const progress = Math.min(99, Math.round((seconds / totalDuration) * 100))
            
            // Calculate estimated time remaining
            if (progress > 0) {
              const elapsedMs = Date.now() - progressData.startTime
              const estimatedTotalMs = (elapsedMs / progress) * 100
              const estimatedRemainingMs = Math.max(0, estimatedTotalMs - elapsedMs)
              
              // Convert to seconds and round
              const estimatedRemainingSeconds = Math.round(estimatedRemainingMs / 1000)
              
              // Update progress data
              progressData.progress = progress
              progressData.estimatedTimeRemaining = estimatedRemainingSeconds
            } else {
              progressData.progress = progress
            }
            
            global.conversionProgress[jobId] = progressData
          }
        })
        
        ffmpeg.on('close', async (code) => {
          try {
            if (code === 0) {
              const outputBuffer = await readFile(outputPath)
              await unlink(inputPath)
              await unlink(outputPath)
              
              // Set progress to 100% when complete
              progressData.progress = 100
              global.conversionProgress[jobId] = progressData
              
              resolve(new NextResponse(outputBuffer, {
                headers: { 
                  'Content-Type': `video/${format}`,
                  'Content-Length': outputBuffer.length.toString(),
                  'X-Job-Id': jobId
                }
              }))
            } else {
              await unlink(inputPath).catch(() => {})
              await unlink(outputPath).catch(() => {})
              resolve(NextResponse.json({ error: 'Video conversion failed' }, { status: 500 }))
            }
          } catch (error) {
            resolve(NextResponse.json({ error: 'File processing error' }, { status: 500 }))
          }
        })
      } catch (error) {
        console.error('Failed to spawn FFmpeg:', error)
        resolve(NextResponse.json({ 
          error: 'FFmpeg not found. Please install FFmpeg on your system.'
        }, { status: 500 }))
      }
    })
  } catch (error) {
    console.error('Video conversion error:', error)
    return NextResponse.json({ error: 'Video conversion failed' }, { status: 500 })
  }
}