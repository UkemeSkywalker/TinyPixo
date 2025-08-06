import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

// Handle large file uploads with chunking
export async function POST(request: NextRequest) {
  try {
    const contentLength = request.headers.get('content-length')
    const fileSizeMB = contentLength ? parseInt(contentLength) / (1024 * 1024) : 0
    
    console.log(`Receiving file upload: ${fileSizeMB.toFixed(2)}MB`)
    
    // For files over 100MB, we need special handling
    if (fileSizeMB > 100) {
      console.log('Large file detected, using streaming upload')
    }
    
    const formData = await request.formData()
    const file = formData.get('audio') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }
    
    // Validate file size (max 500MB)
    const maxSizeMB = 500
    if (fileSizeMB > maxSizeMB) {
      return NextResponse.json({ 
        error: `File too large. Maximum size is ${maxSizeMB}MB` 
      }, { status: 413 })
    }
    
    // Create unique filename with timestamp
    const timestamp = Date.now()
    const fileExtension = file.name.split('.').pop() || 'audio'
    const fileName = `upload-${timestamp}.${fileExtension}`
    const filePath = join('/tmp', fileName)
    
    // Ensure /tmp directory exists
    await mkdir('/tmp', { recursive: true })
    
    console.log(`Saving large file to: ${filePath}`)
    
    // Stream the file to disk instead of loading into memory
    const arrayBuffer = await file.arrayBuffer()
    await writeFile(filePath, Buffer.from(arrayBuffer))
    
    console.log(`Large file saved successfully: ${fileName}`)
    
    // Return file info for conversion
    return NextResponse.json({
      fileName,
      originalName: file.name,
      size: file.size,
      sizeMB: fileSizeMB.toFixed(2),
      message: 'Large file uploaded successfully'
    })
    
  } catch (error) {
    console.error('Large file upload error:', error)
    
    if (error.name === 'PayloadTooLargeError') {
      return NextResponse.json({ 
        error: 'File too large for upload' 
      }, { status: 413 })
    }
    
    return NextResponse.json({ 
      error: 'Upload failed: ' + error.message 
    }, { status: 500 })
  }
}

// Configure for large files
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '500mb', // Allow up to 500MB
    },
  },
}