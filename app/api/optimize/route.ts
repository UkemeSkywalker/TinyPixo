import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('image') as File
    const format = formData.get('format') as string
    const quality = parseInt(formData.get('quality') as string)
    const width = formData.get('width') ? parseInt(formData.get('width') as string) : undefined
    const height = formData.get('height') ? parseInt(formData.get('height') as string) : undefined

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Check file size limit (10MB for AWS Amplify)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Maximum size is 10MB.' }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let sharpInstance = sharp(buffer)
    
    // Set Sharp to use less memory for large images
    sharpInstance = sharpInstance.limitInputPixels(268402689) // ~16k x 16k max

    // Resize if dimensions provided
    if (width || height) {
      sharpInstance = sharpInstance.resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true
      })
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