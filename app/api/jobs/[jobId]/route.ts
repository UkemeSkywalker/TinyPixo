import { NextRequest, NextResponse } from 'next/server'
import { jobService } from '../../../../lib/job-service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  console.log(`[API] GET /api/jobs/${jobId} - Retrieving job details`)

  if (!jobId) {
    console.log(`[API] GET /api/jobs/${jobId} - Missing jobId parameter`)
    return NextResponse.json(
      { error: 'Job ID is required' },
      { status: 400 }
    )
  }

  try {
    const job = await jobService.getJob(jobId)

    if (!job) {
      console.log(`[API] GET /api/jobs/${jobId} - Job not found`)
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    console.log(`[API] GET /api/jobs/${jobId} - Job retrieved successfully with status: ${job.status}`)
    
    return NextResponse.json(job, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    })
  } catch (error) {
    console.error(`[API] GET /api/jobs/${jobId} - Error retrieving job:`, error)
    
    return NextResponse.json(
      { 
        error: 'Failed to retrieve job details',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}