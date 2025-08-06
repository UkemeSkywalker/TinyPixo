import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { readFile, unlink, access } from 'fs/promises'
import { join } from 'path'

type ConversionProgress = {
  jobId: string
  progress: number
  status?: string
  startTime?: number
  estimatedTimeRemaining?: number | null
  outputBuffer?: Buffer
  outputPath?: string
  format?: string
  isLargeFile?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const { fileName, format, quality } = data
    
    if (!fileName || !format || !quality) {
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
    
    const args = ['-i', inputPath, '-b:a', quality]
    if (format === 'mp3') args.push('-codec:a', 'libmp3lame')
    else if (format === 'aac') args.push('-codec:a', 'aac')
    else if (format === 'ogg') args.push('-codec:a', 'libvorbis')
    
    args.push(outputPath)
    
    // Create a unique job ID for this conversion
    const jobId = Date.now().toString()
    let progressData: ConversionProgress = { 
      jobId, 
      progress: 0,
      startTime: Date.now(),
      estimatedTimeRemaining: null
    }
    
    // Store progress in memory (in production, use Redis or similar)
    global.conversionProgress = global.conversionProgress || {}
    global.conversionProgress[jobId] = progressData
    
    // Start FFmpeg process asynchronously
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
    console.log(`Using FFmpeg at: ${ffmpegPath}`)
    console.log(`Starting conversion with args:`, args)
    
    // Set maximum conversion time based on file size
    // For large files, allow more time: 20 minutes for files over 100MB
    const inputStats = await import('fs/promises').then(fs => 
      fs.stat(inputPath).catch(() => ({ size: 0 }))
    )
    const fileSizeMB = inputStats.size / (1024 * 1024)
    const maxConversionTime = fileSizeMB > 100 ? 20 * 60 * 1000 : 10 * 60 * 1000
    
    console.log(`File size: ${fileSizeMB.toFixed(2)}MB, max conversion time: ${maxConversionTime / 60000} minutes`)
    const conversionTimeout = setTimeout(() => {
      console.error(`Conversion timeout for jobId: ${jobId}`)
      progressData.progress = -1
      if (global.conversionProgress) {
        global.conversionProgress[jobId] = progressData
      }
    }, maxConversionTime)
    
    try {
      const ffmpeg = spawn(ffmpegPath, args)
      
      // Handle spawn errors
      ffmpeg.on('error', (err) => {
        console.error('FFmpeg spawn error:', err)
        clearTimeout(conversionTimeout)
        progressData.progress = -1
        if (global.conversionProgress) {
          global.conversionProgress[jobId] = progressData
        }
      })
        
        // Track if we've found the duration
        let totalDuration = 30 // Default assumption (30 seconds)
        let durationFound = false
        let processingStarted = false
        let lastProgressUpdate = Date.now()
        
        // Set initial progress
        progressData.progress = 1
        if (global.conversionProgress) {
          global.conversionProgress[jobId] = progressData
        }
        console.log('Initial progress set to 1%')
        
        // Add periodic progress updates during processing
        const progressTimer = setInterval(() => {
          if (processingStarted && progressData.progress < 95) {
            // Gradually increase progress during processing
            const elapsed = Date.now() - lastProgressUpdate
            if (elapsed > 2000) { // Every 2 seconds
              progressData.progress = Math.min(90, progressData.progress + 5)
              if (global.conversionProgress) {
                global.conversionProgress[jobId] = progressData
              }
              console.log(`Intermediate progress update: ${progressData.progress}%`)
              lastProgressUpdate = Date.now()
            }
          }
        }, 2000)
        
        // Capture stderr for progress tracking
        ffmpeg.stderr.on('data', (data) => {
          const output = data.toString()
          console.log('FFmpeg stderr:', output)
          
          // First try to find duration in the output
          if (!durationFound) {
            const durationMatch = output.match(/Duration: ([\d:.]+)/)
            if (durationMatch && durationMatch[1]) {
              const durationParts = durationMatch[1].split(':')
              totalDuration = 
                parseFloat(durationParts[0]) * 3600 + 
                parseFloat(durationParts[1]) * 60 + 
                parseFloat(durationParts[2])
              durationFound = true
              console.log(`Detected audio duration: ${totalDuration} seconds`)
              
              // Set progress to 5% once we detect duration
              progressData.progress = 5
              if (global.conversionProgress) {
                global.conversionProgress[jobId] = progressData
              }
              console.log('Progress updated to 5% (duration detected)')
            }
          }
          
          // Detect when processing actually starts
          if (output.includes('Press [q] to stop') || output.includes('Stream mapping:')) {
            processingStarted = true
            progressData.progress = 10
            if (global.conversionProgress) {
              global.conversionProgress[jobId] = progressData
            }
            console.log('Processing started, progress set to 10%')
          }
          
          // Look for time=00:00:00.00 pattern in FFmpeg output
          const timeMatch = output.match(/time=([\d:.]+)/)
          if (timeMatch && timeMatch[1]) {
            const timeParts = timeMatch[1].split(':')
            const seconds = 
              parseFloat(timeParts[0]) * 3600 + 
              parseFloat(timeParts[1]) * 60 + 
              parseFloat(timeParts[2])
            
            // Only calculate progress if we have meaningful time data
            if (seconds > 0) {
              // Calculate progress based on detected duration
              const progress = Math.min(95, Math.max(15, Math.round((seconds / totalDuration) * 100)))
              
              // Only update if progress actually changed
              if (progress !== progressData.progress) {
                // Calculate estimated time remaining
                const elapsedMs = Date.now() - progressData.startTime
                const estimatedTotalMs = (elapsedMs / progress) * 100
                const estimatedRemainingMs = Math.max(0, estimatedTotalMs - elapsedMs)
                
                // Convert to seconds and round
                const estimatedRemainingSeconds = Math.round(estimatedRemainingMs / 1000)
                
                // Update progress data
                progressData.progress = progress
                progressData.estimatedTimeRemaining = estimatedRemainingSeconds
                
                if (global.conversionProgress) {
                  global.conversionProgress[jobId] = progressData
                }
                console.log(`Progress updated: ${progress}% (${seconds.toFixed(1)}s/${totalDuration}s`)
              }
            }
          }
        })
        
      ffmpeg.on('close', async (code) => {
        clearInterval(progressTimer) // Stop the progress timer
        clearTimeout(conversionTimeout) // Clear the conversion timeout
        console.log(`FFmpeg process closed with code: ${code}`)
        try {
          if (code === 0) {
            // Set progress to 98% before finalizing
            progressData.progress = 98
            if (global.conversionProgress) {
              global.conversionProgress[jobId] = progressData
            }
            console.log('Progress updated to 98% (finalizing conversion)')
            
            // For large files, don't load into memory - just store the path
            const outputStats = await import('fs/promises').then(fs => 
              fs.stat(outputPath).catch(() => ({ size: 0 }))
            )
            const outputSizeMB = outputStats.size / (1024 * 1024)
            
            console.log(`Output file size: ${outputSizeMB.toFixed(2)}MB`)
            
            // Clean up input file
            await unlink(inputPath)
            
            if (outputSizeMB > 50) {
              // For large files (>50MB), store path only to avoid memory issues
              console.log('Large output file - storing path only')
              progressData.outputPath = outputPath
              progressData.format = format
              progressData.isLargeFile = true
            } else {
              // For smaller files, load into memory for faster download
              console.log('Small output file - loading into memory')
              const outputBuffer = await readFile(outputPath)
              progressData.outputBuffer = outputBuffer
              progressData.outputPath = outputPath
              progressData.format = format
              progressData.isLargeFile = false
            }
            
            // Set progress to 100% when complete
            progressData.progress = 100
            if (global.conversionProgress) {
              global.conversionProgress[jobId] = progressData
            }
            console.log('Progress updated to 100% (conversion complete)')
          } else {
            console.error(`FFmpeg failed with exit code: ${code}`)
            progressData.progress = -1
            if (global.conversionProgress) {
              global.conversionProgress[jobId] = progressData
            }
            await unlink(inputPath).catch(() => {})
            await unlink(outputPath).catch(() => {})
          }
        } catch (error) {
          console.error('Error in FFmpeg close handler:', error)
          progressData.progress = -1
          if (global.conversionProgress) {
            global.conversionProgress[jobId] = progressData
          }
        }
      })
    } catch (error) {
      console.error('Failed to spawn FFmpeg:', error)
      clearTimeout(conversionTimeout)
      progressData.progress = -1
      if (global.conversionProgress) {
        global.conversionProgress[jobId] = progressData
      }
    }
    
    // Return jobId immediately for progress tracking
    return NextResponse.json({ jobId }, {
      headers: { 'X-Job-Id': jobId }
    })
  } catch (error) {
    console.error('Audio conversion error:', error)
    return NextResponse.json({ error: 'Audio conversion failed' }, { status: 500 })
  }
}