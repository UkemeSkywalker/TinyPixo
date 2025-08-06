import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'fs/promises'

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

export async function GET(request: NextRequest) {
  try {
    const jobId = request.nextUrl.searchParams.get('jobId')
    
    if (!jobId) {
      return NextResponse.json({ error: 'No job ID provided' }, { status: 400 })
    }
    
    // Access the global progress tracking object
    global.conversionProgress = global.conversionProgress || {}
    const progressData: ConversionProgress | undefined = global.conversionProgress[jobId]
    
    console.log(`Download request for jobId: ${jobId}`)
    console.log('Available jobs:', Object.keys(global.conversionProgress))
    console.log('Job data:', progressData)
    
    if (!progressData) {
      console.error(`Job ${jobId} not found in progress tracking`)
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    
    if (progressData.progress !== 100) {
      return NextResponse.json({ error: 'Conversion not complete' }, { status: 400 })
    }
    
    const format = progressData.format || 'mp3'
    let outputBuffer
    
    // Handle both large files (path-based) and small files (memory-based)
    if (progressData.isLargeFile && progressData.outputPath) {
      console.log('Streaming large file from disk')
      try {
        // For large files, read directly from disk
        outputBuffer = await import('fs/promises').then(fs => fs.readFile(progressData.outputPath))
      } catch (error) {
        console.error('Failed to read large output file:', error)
        return NextResponse.json({ error: 'Output file not accessible' }, { status: 404 })
      }
    } else if (progressData.outputBuffer) {
      console.log('Serving small file from memory')
      outputBuffer = progressData.outputBuffer
    } else {
      return NextResponse.json({ error: 'Output file not available' }, { status: 404 })
    }
    
    // Clean up the output file from disk
    if (progressData.outputPath) {
      try {
        await unlink(progressData.outputPath)
        console.log('Cleaned up output file:', progressData.outputPath)
      } catch (error) {
        console.log('Output file already cleaned up or not found')
      }
    }
    
    // Clean up the progress data after successful download
    delete global.conversionProgress[jobId]
    
    return new NextResponse(outputBuffer, {
      headers: { 
        'Content-Type': `audio/${format}`,
        'Content-Length': outputBuffer.length.toString(),
        'Content-Disposition': `attachment; filename="converted.${format}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    })
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json({ error: 'Download failed' }, { status: 500 })
  }
}