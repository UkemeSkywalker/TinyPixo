import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { readFile, unlink, access } from 'fs/promises'
import { join } from 'path'

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const { fileName, quality } = data
    
    if (!fileName || !quality) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }
    
    const inputPath = join('/tmp', fileName)
    const outputPath = join('/tmp', `output-${Date.now()}.pdf`)
    
    // Check if the file exists
    try {
      await access(inputPath)
    } catch (error) {
      return NextResponse.json({ error: 'File not found or expired' }, { status: 404 })
    }
    
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
    let progressData = { 
      jobId, 
      progress: 0,
      status: 'processing',
      startTime: Date.now(),
      estimatedTimeRemaining: null
    }
    
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
            const increment = Math.random() * 15 + 5 // 5-20% increments
            progressData.progress = Math.min(90, progressData.progress + increment)
            
            // Calculate estimated time remaining
            if (progressData.progress > 10) {
              const elapsedMs = Date.now() - progressData.startTime
              const estimatedTotalMs = (elapsedMs / progressData.progress) * 100
              const estimatedRemainingMs = Math.max(0, estimatedTotalMs - elapsedMs)
              const estimatedRemainingSeconds = Math.round(estimatedRemainingMs / 1000)
              
              progressData.estimatedTimeRemaining = estimatedRemainingSeconds
            }
            
            progressData.status = 'processing'
            global.conversionProgress[jobId] = progressData
          }
        }, 800)
        
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
              await unlink(inputPath).catch(() => {})
              await unlink(outputPath).catch(() => {})
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