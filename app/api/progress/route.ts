import { NextRequest, NextResponse } from 'next/server'

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
    const progressData: ConversionProgress = global.conversionProgress[jobId] || { jobId, progress: 0 }
    
    console.log(`Progress API called for jobId: ${jobId}, returning:`, progressData)
    
    // Add cache headers to prevent caching of progress responses
    return NextResponse.json(progressData, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
  } catch (error) {
    console.error('Progress tracking error:', error)
    return NextResponse.json({ error: 'Failed to get progress' }, { status: 500 })
  }
}