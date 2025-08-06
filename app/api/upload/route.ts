import { NextRequest, NextResponse } from 'next/server'
import { writeFile } from 'fs/promises'
import { join } from 'path'

// File size limits in bytes
const FILE_SIZE_LIMITS = {
  audio: 200 * 1024 * 1024, // 200MB
  video: 500 * 1024 * 1024, // 500MB
  image: 10 * 1024 * 1024, // 10MB
}

export async function POST(request: NextRequest) {
  console.log('Upload API called with content length:', request.headers.get('content-length'))
  try {
    // Add a timeout to ensure we don't hang indefinitely
    const formDataPromise = request.formData()
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timed out')), 120000) // 2 minute timeout
    })
    
    const formData = await Promise.race([formDataPromise, timeoutPromise]) as FormData
    console.log('FormData parsed successfully')
    
    const file = formData.get('file') as File
    const fileType = formData.get('fileType') as string // 'audio', 'video', or 'image'

    if (!file) {
      console.log('No file provided in request')
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    console.log(`File received: ${file.name}, size: ${file.size}, type: ${fileType}`)

    if (!fileType || !['audio', 'video', 'image'].includes(fileType)) {
      console.log(`Invalid file type: ${fileType}`)
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
    }

    // Check file size
    if (file.size > FILE_SIZE_LIMITS[fileType as keyof typeof FILE_SIZE_LIMITS]) {
      console.log(`File too large: ${file.size} bytes, limit: ${FILE_SIZE_LIMITS[fileType as keyof typeof FILE_SIZE_LIMITS]} bytes`)
      return NextResponse.json({ 
        error: `File too large. Maximum size for ${fileType} is ${FILE_SIZE_LIMITS[fileType as keyof typeof FILE_SIZE_LIMITS] / (1024 * 1024)}MB` 
      }, { status: 400 })
    }

    // Generate a unique file ID
    const fileId = Date.now().toString()
    const extension = file.name.split('.').pop()
    const fileName = `${fileId}.${extension}`
    const filePath = join('/tmp', fileName)
    
    console.log(`Writing file to: ${filePath}`)
    
    try {
      // Get file buffer with timeout
      console.log('Getting file buffer...')
      const arrayBufferPromise = file.arrayBuffer()
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('File buffer extraction timed out')), 60000) // 1 minute timeout
      })
      
      const arrayBuffer = await Promise.race([arrayBufferPromise, timeoutPromise])
      console.log(`File buffer obtained, size: ${arrayBuffer.byteLength} bytes`)
      
      // Write file to temporary storage
      await writeFile(filePath, Buffer.from(arrayBuffer))
      console.log('File written successfully')
      
      // Return the file ID for later processing
      return NextResponse.json({ 
        success: true, 
        fileId,
        fileName,
        originalName: file.name,
        size: file.size,
        type: file.type
      })
    } catch (error) {
      console.error('Error writing file:', error)
      return NextResponse.json({ error: `File writing failed: ${error.message}` }, { status: 500 })
    }
  } catch (error) {
    console.error('File upload error:', error)
    return NextResponse.json({ error: 'File upload failed' }, { status: 500 })
  }
}