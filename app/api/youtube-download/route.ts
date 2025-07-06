import { NextRequest, NextResponse } from 'next/server'

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/,
    /youtube\.com\/embed\/([\w-]+)/
  ]
  
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()
    console.log('Processing URL:', url)
    
    const videoId = extractVideoId(url)
    if (!videoId) {
      console.log('Invalid video ID')
      return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 })
    }
    
    console.log('Video ID:', videoId)

    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    console.log('Fetching oEmbed:', oembedUrl)
    
    const oembedResponse = await fetch(oembedUrl)
    
    if (!oembedResponse.ok) {
      console.log('oEmbed failed:', oembedResponse.status)
      return NextResponse.json({ error: 'Video not found or private' }, { status: 404 })
    }
    
    const oembedData = await oembedResponse.json()
    console.log('oEmbed data:', oembedData)
    
    // For now, return mock download URLs that redirect to YouTube
    return NextResponse.json({
      title: oembedData.title,
      thumbnail: oembedData.thumbnail_url,
      author: oembedData.author_name,
      duration: 'Unknown',
      formats: {
        mp4: {
          url: `https://www.youtube.com/watch?v=${videoId}`,
          quality: 'Redirect to YouTube'
        },
        audio: {
          url: `https://www.youtube.com/watch?v=${videoId}`,
          bitrate: 'Redirect to YouTube'
        }
      }
    })
  } catch (error) {
    console.error('API Error:', error)
    return NextResponse.json({ 
      error: 'Server error: ' + (error as Error).message 
    }, { status: 500 })
  }
}