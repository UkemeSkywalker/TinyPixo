import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { writeFile, unlink, readFile } from 'fs/promises'
import { join } from 'path'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('audio') as File
    const format = formData.get('format') as string
    const quality = formData.get('quality') as string

    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    const inputPath = join('/tmp', `input-${Date.now()}.${file.name.split('.').pop()}`)
    const outputPath = join('/tmp', `output-${Date.now()}.${format}`)
    
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()))

    const args = ['-i', inputPath, '-b:a', quality]
    if (format === 'mp3') args.push('-codec:a', 'libmp3lame')
    else if (format === 'aac') args.push('-codec:a', 'aac')
    else if (format === 'ogg') args.push('-codec:a', 'libvorbis')
    
    args.push(outputPath)
    
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
                'Content-Type': `audio/${format}`,
                'Content-Length': outputBuffer.length.toString()
              }
            }))
          } else {
            await unlink(inputPath).catch(() => {})
            await unlink(outputPath).catch(() => {})
            resolve(NextResponse.json({ error: 'Audio conversion failed' }, { status: 500 }))
          }
        } catch (error) {
          resolve(NextResponse.json({ error: 'File processing error' }, { status: 500 }))
        }
      })
    })
  } catch (error) {
    console.error('Audio conversion error:', error)
    return NextResponse.json({ error: 'Audio conversion failed' }, { status: 500 })
  }
}