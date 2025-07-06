import { NextRequest, NextResponse } from 'next/server'
import ytdl from 'ytdl-core'

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()
    
    if (!ytdl.validateURL(url)) {
      return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 })
    }

    const info = await ytdl.getInfo(url)
    const title = info.videoDetails.title.replace(/[^\w\s-]/gi, '').trim()
    
    const videoFormats = ytdl.filterFormats(info.formats, 'videoandaudio')
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly')
    
    const mp4Video = videoFormats.find(f => f.container === 'mp4') || videoFormats[0]
    const audioOnly = audioFormats.find(f => f.audioBitrate && f.audioBitrate > 128) || audioFormats[0]
    
    return NextResponse.json({
      title,
      thumbnail: info.videoDetails.thumbnails?.[0]?.url,
      duration: info.videoDetails.lengthSeconds,
      formats: {
        mp4: mp4Video ? {
          url: mp4Video.url,
          quality: mp4Video.qualityLabel,
          size: mp4Video.contentLength
        } : null,
        audio: audioOnly ? {
          url: audioOnly.url,
          bitrate: audioOnly.audioBitrate,
          size: audioOnly.contentLength
        } : null
      }
    })
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json({ error: 'Failed to get video info' }, { status: 500 })
  }
}