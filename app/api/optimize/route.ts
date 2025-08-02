import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

// Global progress tracking
declare global {
  var conversionProgress: { [key: string]: { jobId: string; progress: number; status: string } }
}

global.conversionProgress = global.conversionProgress || {}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('image') as File
    const format = formData.get('format') as string
    const quality = parseInt(formData.get('quality') as string)
    const width = formData.get('width') ? parseInt(formData.get('width') as string) : undefined
    const height = formData.get('height') ? parseInt(formData.get('height') as string) : undefined
    const jobId = formData.get('jobId') as string

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Initialize progress tracking
    if (jobId) {
      global.conversionProgress[jobId] = { jobId, progress: 0, status: 'starting' }
    }

    // File size check removed - Docker container can handle large files

    if (jobId) {
      global.conversionProgress[jobId] = { jobId, progress: 20, status: 'reading file' }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    
    if (jobId) {
      global.conversionProgress[jobId] = { jobId, progress: 40, status: 'initializing processor' }
    }

    // Optimize Sharp for AWS Lambda memory constraints
    let sharpInstance = sharp(buffer, {
      limitInputPixels: 268402689,
      sequentialRead: true,
      density: 72
    })
    
    // Pre-resizing removed - Docker container has sufficient resources

    if (jobId) {
      global.conversionProgress[jobId] = { jobId, progress: 60, status: 'resizing image' }
    }

    // Resize if dimensions provided
    if (width || height) {
      sharpInstance = sharpInstance.resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true
      })
    }

    if (jobId) {
      global.conversionProgress[jobId] = { jobId, progress: 80, status: 'converting format' }
    }

    // Convert format and set quality
    let outputBuffer: Buffer
    switch (format) {
      case 'webp':
        outputBuffer = await sharpInstance.webp({ quality }).toBuffer()
        break
      case 'avif':
        outputBuffer = await sharpInstance.avif({ quality }).toBuffer()
        break
      case 'jpeg':
        outputBuffer = await sharpInstance.jpeg({ quality }).toBuffer()
        break
      case 'png':
        outputBuffer = await sharpInstance.png({ quality }).toBuffer()
        break
      default:
        outputBuffer = await sharpInstance.webp({ quality }).toBuffer()
    }

    if (jobId) {
      global.conversionProgress[jobId] = { jobId, progress: 100, status: 'completed' }
    }

    return new NextResponse(outputBuffer, {
      headers: {
        'Content-Type': `image/${format}`,
        'Content-Length': outputBuffer.length.toString(),
      },
    })
  } catch (error) {
    console.error('Image processing error:', error)
    return NextResponse.json({ error: 'Image processing failed' }, { status: 500 })
  }
}