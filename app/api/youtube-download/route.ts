import { NextRequest, NextResponse } from 'next/server'
import ytdl from 'ytdl-core'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

export async function POST(request: NextRequest) {
  try {
    const { url, format } = await request.json()
    
    if (!ytdl.validateURL(url)) {
      return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 })
    }

    const info = await ytdl.getInfo(url)
    const title = info.videoDetails.title.replace(/[^\w\s]/gi, '')

    if (format === 'mp4') {
      const stream = ytdl(url, { quality: 'highest', filter: 'videoandaudio' })
      const chunks: Buffer[] = []
      
      for await (const chunk of stream) {
        chunks.push(chunk)
      }
      
      const buffer = Buffer.concat(chunks)
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${title}.mp4"`
        }
      })
    } else {
      const stream = ytdl(url, { quality: 'highestaudio', filter: 'audioonly' })
      const chunks: Buffer[] = []
      
      for await (const chunk of stream) {
        chunks.push(chunk)
      }
      
      const inputBuffer = Buffer.concat(chunks)
      
      const ffmpeg = new FFmpeg()
      await ffmpeg.load()
      await ffmpeg.writeFile('input.webm', await fetchFile(inputBuffer))
      await ffmpeg.exec(['-i', 'input.webm', 'output.mp3'])
      const data = await ffmpeg.readFile('output.mp3')
      
      return new NextResponse(data, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Disposition': `attachment; filename="${title}.mp3"`
        }
      })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Download failed' }, { status: 500 })
  }
}