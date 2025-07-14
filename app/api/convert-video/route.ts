import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { writeFile, unlink, readFile } from 'fs/promises'
import { join } from 'path'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('video') as File
    const format = formData.get('format') as string
    const quality = formData.get('quality') as string
    const resolution = formData.get('resolution') as string

    if (!file) {
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 })
    }

    const inputPath = join('/tmp', `input-${Date.now()}.${file.name.split('.').pop()}`)
    const outputPath = join('/tmp', `output-${Date.now()}.${format}`)
    
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()))

    const args = ['-i', inputPath]
    
    // Quality settings
    if (quality === 'high') args.push('-crf', '18')
    else if (quality === 'medium') args.push('-crf', '23')
    else args.push('-crf', '28')
    
    // Resolution scaling
    if (resolution !== 'original') {
      if (resolution === '1080p') args.push('-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease')
      else if (resolution === '720p') args.push('-vf', 'scale=1280:720:force_original_aspect_ratio=decrease')
      else if (resolution === '480p') args.push('-vf', 'scale=854:480:force_original_aspect_ratio=decrease')
      else if (resolution === '360p') args.push('-vf', 'scale=640:360:force_original_aspect_ratio=decrease')
    }
    
    // Codec settings
    if (format === 'mp4') {
      args.push('-c:v', 'libx264', '-preset', 'fast')
    } else if (format === 'webm') {
      args.push('-c:v', 'libvpx')
    } else if (format === 'avi') {
      args.push('-c:v', 'libx264')
    }
    
    args.push('-y', outputPath)
    
    return new Promise<NextResponse>((resolve) => {
      const ffmpeg = spawn('ffmpeg', args)
      
      ffmpeg.on('close', async (code) => {
        try {
          if (code === 0) {
            const outputBuffer = await readFile(outputPath)
            await unlink(inputPath)
            await unlink(outputPath)
            
            resolve(new NextResponse(outputBuffer, {
              headers: { 
                'Content-Type': `video/${format}`,
                'Content-Length': outputBuffer.length.toString()
              }
            }))
          } else {
            await unlink(inputPath).catch(() => {})
            await unlink(outputPath).catch(() => {})
            resolve(NextResponse.json({ error: 'Video conversion failed' }, { status: 500 }))
          }
        } catch (error) {
          resolve(NextResponse.json({ error: 'File processing error' }, { status: 500 }))
        }
      })
    })
  } catch (error) {
    console.error('Video conversion error:', error)
    return NextResponse.json({ error: 'Video conversion failed' }, { status: 500 })
  }
}