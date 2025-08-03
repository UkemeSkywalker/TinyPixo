import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const jobId = request.nextUrl.searchParams.get('jobId')
    
    if (!jobId) {
      return NextResponse.json({ error: 'No job ID provided' }, { status: 400 })
    }
    
    // Access the global progress tracking object
    global.conversionProgress = global.conversionProgress || {}
    const progressData = global.conversionProgress[jobId] || { jobId, progress: 0 }
    
    console.log(`Progress API called for jobId: ${jobId}, returning:`, progressData)
    
    return NextResponse.json(progressData)
  } catch (error) {
    console.error('Progress tracking error:', error)
    return NextResponse.json({ error: 'Failed to get progress' }, { status: 500 })
  }
}