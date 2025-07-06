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
    
    const videoId = extractVideoId(url)
    if (!videoId) {
      return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 })
    }

    // Use YouTube's oEmbed API for basic info
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    const oembedResponse = await fetch(oembedUrl)
    
    if (!oembedResponse.ok) {
      return NextResponse.json({ error: 'Video not found or private' }, { status: 404 })
    }
    
    const oembedData = await oembedResponse.json()
    
    // Create download URLs (these are example formats - in reality you'd need to extract actual stream URLs)
    const downloadUrls = {
      mp4: `https://www.youtube.com/watch?v=${videoId}`, // Placeholder - would need actual extraction
      audio: `https://www.youtube.com/watch?v=${videoId}` // Placeholder - would need actual extraction
    }
    
    return NextResponse.json({
      title: oembedData.title,
      thumbnail: oembedData.thumbnail_url,
      author: oembedData.author_name,
      duration: 'Unknown', // oEmbed doesn't provide duration
      formats: {
        mp4: {
          url: downloadUrls.mp4,
          quality: 'Best Available'
        },
        audio: {
          url: downloadUrls.audio,
          bitrate: 'Best Available'
        }
      },
      note: 'This is a demo - actual download links would require stream URL extraction'
    })
  } catch (error) {
    console.error('API Error:', error)
    return NextResponse.json({ error: 'Failed to get video info' }, { status: 500 })
  }
}