import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('jobId')
    
    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId parameter' }, { status: 400 })
    }
    
    // Get progress from global store
    global.conversionProgress = global.conversionProgress || {}
    const progressData = global.conversionProgress[jobId] || { jobId, progress: 0 }
    
    return NextResponse.json(progressData)
  } catch (error) {
    console.error('Progress tracking error:', error)
    return NextResponse.json({ error: 'Failed to get progress' }, { status: 500 })
  }
}