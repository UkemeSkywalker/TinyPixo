'use client'

import { useState } from 'react'

interface LargeFileUploadProps {
  onUploadComplete: (fileName: string) => void
  onUploadProgress: (progress: number) => void
  onError: (error: string) => void
}

export default function LargeFileUpload({ 
  onUploadComplete, 
  onUploadProgress, 
  onError 
}: LargeFileUploadProps) {
  const [isUploading, setIsUploading] = useState(false)

  const uploadLargeFile = async (file: File) => {
    const fileSizeMB = file.size / (1024 * 1024)
    console.log(`Uploading large file: ${fileSizeMB.toFixed(2)}MB`)
    
    setIsUploading(true)
    onUploadProgress(0)
    
    try {
      // For very large files (>200MB), we might need chunked upload
      if (fileSizeMB > 200) {
        await uploadInChunks(file)
      } else {
        await uploadDirect(file)
      }
    } catch (error) {
      console.error('Large file upload failed:', error)
      onError(error.message || 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }
  
  const uploadDirect = async (file: File) => {
    const formData = new FormData()
    formData.append('audio', file)
    
    // Create XMLHttpRequest for progress tracking
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      
      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100)
          onUploadProgress(progress)
        }
      })
      
      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText)
            onUploadComplete(response.fileName)
            resolve()
          } catch (error) {
            reject(new Error('Invalid response from server'))
          }
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`))
        }
      })
      
      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'))
      })
      
      xhr.addEventListener('timeout', () => {
        reject(new Error('Upload timeout - file too large'))
      })
      
      // Set timeout to 10 minutes for large files
      xhr.timeout = 10 * 60 * 1000
      
      xhr.open('POST', '/api/upload-large')
      xhr.send(formData)
    })
  }
  
  const uploadInChunks = async (file: File) => {
    const chunkSize = 10 * 1024 * 1024 // 10MB chunks
    const totalChunks = Math.ceil(file.size / chunkSize)
    const uploadId = Date.now().toString()
    
    console.log(`Uploading in ${totalChunks} chunks of ${chunkSize / (1024 * 1024)}MB each`)
    
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      const chunk = file.slice(start, end)
      
      const formData = new FormData()
      formData.append('chunk', chunk)
      formData.append('chunkIndex', chunkIndex.toString())
      formData.append('totalChunks', totalChunks.toString())
      formData.append('uploadId', uploadId)
      formData.append('fileName', file.name)
      
      const response = await fetch('/api/upload-chunked', {
        method: 'POST',
        body: formData
      })
      
      if (!response.ok) {
        throw new Error(`Chunk upload failed: ${response.status}`)
      }
      
      const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100)
      onUploadProgress(progress)
    }
    
    // Finalize the chunked upload
    const finalizeResponse = await fetch('/api/upload-chunked/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, fileName: file.name })
    })
    
    if (!finalizeResponse.ok) {
      throw new Error('Failed to finalize chunked upload')
    }
    
    const result = await finalizeResponse.json()
    onUploadComplete(result.fileName)
  }
  
  return { uploadLargeFile, isUploading }
}