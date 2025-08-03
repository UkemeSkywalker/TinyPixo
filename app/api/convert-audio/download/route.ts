import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'fs/promises'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('jobId')
    
    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
    }

    const progressData = global.conversionProgress?.[jobId]
    if (!progressData || progressData.progress !== 100) {
      return NextResponse.json({ error: 'Conversion not complete' }, { status: 400 })
    }

    if (!progressData.outputBuffer) {
      return NextResponse.json({ error: 'Output file not found' }, { status: 404 })
    }

    // Clean up the output file
    if (progressData.outputPath) {
      await unlink(progressData.outputPath).catch(() => {})
    }
    
    // Clean up progress data
    delete global.conversionProgress[jobId]
    
    return new NextResponse(progressData.outputBuffer, {
      headers: { 
        'Content-Type': `audio/${progressData.format}`,
        'Content-Length': progressData.outputBuffer.length.toString()
      }
    })
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json({ error: 'Download failed' }, { status: 500 })
  }
}