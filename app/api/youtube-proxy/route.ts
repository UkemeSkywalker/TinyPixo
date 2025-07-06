import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const videoUrl = searchParams.get('url')
    const format = searchParams.get('format') || 'mp4'
    const title = searchParams.get('title') || 'video'
    
    if (!videoUrl) {
      return NextResponse.json({ error: 'No URL provided' }, { status: 400 })
    }

    // Create a simple text file as placeholder
    const content = `YouTube Video: ${title}\nOriginal URL: ${videoUrl}\nRequested Format: ${format}\n\nThis would contain the actual ${format} file in a production setup.`
    
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="${title.replace(/[^a-zA-Z0-9]/g, '_')}.${format}"`
      }
    })
  } catch (error) {
    return NextResponse.json({ error: 'Download failed' }, { status: 500 })
  }
}