import { NextRequest, NextResponse } from 'next/server'
import { writeFile, appendFile, readFile, unlink } from 'fs/promises'
import { join } from 'path'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const chunk = formData.get('chunk') as File
    const chunkIndex = parseInt(formData.get('chunkIndex') as string)
    const totalChunks = parseInt(formData.get('totalChunks') as string)
    const fileId = formData.get('fileId') as string
    const fileName = formData.get('fileName') as string

    if (!chunk || isNaN(chunkIndex) || isNaN(totalChunks) || !fileId || !fileName) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    const tempFilePath = join('/tmp', `${fileId}.part`)
    const chunkBuffer = Buffer.from(await chunk.arrayBuffer())

    // For first chunk, create new file; for others, append
    if (chunkIndex === 0) {
      await writeFile(tempFilePath, chunkBuffer)
    } else {
      await appendFile(tempFilePath, chunkBuffer)
    }

    // If this is the last chunk, finalize the file
    if (chunkIndex === totalChunks - 1) {
      const finalPath = join('/tmp', fileName)
      await writeFile(finalPath, await readFile(tempFilePath))
      await unlink(tempFilePath)
      
      return NextResponse.json({ 
        success: true, 
        fileId,
        fileName,
        completed: true 
      })
    }

    return NextResponse.json({ 
      success: true, 
      chunkIndex,
      completed: false 
    })
  } catch (error) {
    console.error('Chunk upload error:', error)
    return NextResponse.json({ error: 'Chunk upload failed' }, { status: 500 })
  }
}