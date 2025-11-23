import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { writeFile, unlink, readFile } from 'fs/promises'
import { join } from 'path'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('pdf') as File
    const quality = formData.get('quality') as string

    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided' }, { status: 400 })
    }

    // Validate file type
    if (!file.type.includes('pdf')) {
      return NextResponse.json({ error: 'Invalid file type. Please upload a PDF file.' }, { status: 400 })
    }

    const inputPath = join('/tmp', `input-${Date.now()}.pdf`)
    const outputPath = join('/tmp', `output-${Date.now()}.pdf`)

    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()))

    const args = [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=/${quality}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      `-sOutputFile=${outputPath}`,
      inputPath
    ]

    // Create a unique job ID for this conversion
    const jobId = Date.now().toString()
    let progressData = { jobId, progress: 0, status: 'processing' }

    // Store progress in memory (in production, use Redis or similar)
    global.conversionProgress = global.conversionProgress || {}
    global.conversionProgress[jobId] = progressData

    return new Promise<NextResponse>((resolve) => {
      // Use system Ghostscript
      const gsPath = process.env.GHOSTSCRIPT_PATH || 'gs'
      console.log(`Using Ghostscript at: ${gsPath}`)

      try {
        const gs = spawn(gsPath, args)

        // Handle spawn errors
        gs.on('error', (err) => {
          console.error('Ghostscript spawn error:', err)
          resolve(NextResponse.json({ error: 'Ghostscript process error: ' + err.message }, { status: 500 }))
        })

        // Fake progress tracking since Ghostscript doesn't provide real progress
        const progressInterval = setInterval(() => {
          if (progressData.progress < 90) {
            progressData.progress += Math.random() * 10 + 5
            progressData.status = 'processing'
            global.conversionProgress[jobId] = progressData
            console.log(`Progress updated: ${progressData.progress}% for job ${jobId}`)
          }
        }, 300)

        gs.on('close', async (code) => {
          clearInterval(progressInterval)
          
          try {
            if (code === 0) {
              const outputBuffer = await readFile(outputPath)
              await unlink(inputPath)
              await unlink(outputPath)

              // Set progress to 100% when complete
              progressData.progress = 100
              progressData.status = 'completed'
              global.conversionProgress[jobId] = progressData

              resolve(new NextResponse(outputBuffer as BodyInit, {
                headers: {
                  'Content-Type': 'application/pdf',
                  'Content-Length': outputBuffer.length.toString(),
                  'X-Job-Id': jobId
                }
              }))
            } else {
              await unlink(inputPath).catch(() => { })
              await unlink(outputPath).catch(() => { })
              resolve(NextResponse.json({ error: 'PDF compression failed' }, { status: 500 }))
            }
          } catch (error) {
            resolve(NextResponse.json({ error: 'File processing error' }, { status: 500 }))
          }
        })
      } catch (error) {
        console.error('Failed to spawn Ghostscript:', error)
        resolve(NextResponse.json({
          error: 'Ghostscript not found. Please install Ghostscript on your system.'
        }, { status: 500 }))
      }
    })
  } catch (error) {
    console.error('PDF compression error:', error)
    return NextResponse.json({ error: 'PDF compression failed' }, { status: 500 })
  }
}