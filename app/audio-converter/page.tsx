'use client'

import { useState, useRef, useEffect } from 'react'
import AudioUpload from '../../components/audio/AudioUpload'
import AudioControls from '../../components/audio/AudioControls'
import AudioPreview from '../../components/audio/AudioPreview'

export default function AudioConverter() {
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null)
  const [originalSize, setOriginalSize] = useState<number>(0)
  const [convertedSize, setConvertedSize] = useState<number>(0)
  const [format, setFormat] = useState<string>('mp3')
  const [quality, setQuality] = useState<string>('192k')
  const [isConverting, setIsConverting] = useState<boolean>(false)
  const [progress, setProgress] = useState<number>(0)
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number | null>(null)
  const [phase, setPhase] = useState<'uploading' | 'converting'>('uploading')




  const handleAudioUpload = (file: File) => {
    setOriginalFile(file)
    setOriginalSize(file.size)
    setUploadedFileName(null) // Reset uploaded file name for new file
    setConvertedUrl(null)
    setConvertedSize(0)
  }

  const uploadFileInChunks = async (file: File): Promise<string> => {
    const chunkSize = 1024 * 1024 // 1MB chunks
    const totalChunks = Math.ceil(file.size / chunkSize)
    const fileId = Date.now().toString()
    const extension = file.name.split('.').pop()
    const fileName = `${fileId}.${extension}`

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      const chunk = file.slice(start, end)

      const formData = new FormData()
      formData.append('chunk', chunk)
      formData.append('chunkIndex', i.toString())
      formData.append('totalChunks', totalChunks.toString())
      formData.append('fileId', fileId)
      formData.append('fileName', fileName)

      const response = await fetch('/api/upload-chunk', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`Chunk ${i} upload failed`)
      }

      // Update upload progress
      const uploadProgress = Math.round(((i + 1) / totalChunks) * 100)
      setProgress(uploadProgress)
    }

    return fileName
  }

  const convertAudio = async () => {
    if (!originalFile) {
      alert('Please select an audio file first.')
      return
    }

    setIsConverting(true)
    setProgress(0)

    let progressInterval = null
    try {
      let fileName = uploadedFileName
      
      // Only upload if file hasn't been uploaded yet
      if (!uploadedFileName) {
        setPhase('uploading')
        fileName = await uploadFileInChunks(originalFile)
        setUploadedFileName(fileName)
      }
      
      // Phase 2: Convert the uploaded file
      setPhase('converting')
      setProgress(0)
      
      const processResponse = await fetch('/api/convert-audio/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName,
          format,
          quality,
        }),
      })
      
      const jobId = processResponse.headers.get('X-Job-Id')
      
      if (jobId) {
        progressInterval = setInterval(async () => {
          try {
            const progressResponse = await fetch(`/api/progress?jobId=${jobId}`)
            if (progressResponse.ok) {
              const data = await progressResponse.json()
              setProgress(data.progress)
              
              if (data.estimatedTimeRemaining !== undefined) {
                setEstimatedTimeRemaining(data.estimatedTimeRemaining)
              }
              
              if (data.progress >= 100) {
                clearInterval(progressInterval)
                progressInterval = null
              }
            }
          } catch (err) {
            console.error('Progress fetch error:', err)
          }
        }, 1000)
      }

      if (processResponse.ok) {
        const blob = await processResponse.blob()
        const url = URL.createObjectURL(blob)
        setConvertedUrl(url)
        setConvertedSize(blob.size)
      } else {
        const errorData = await processResponse.json().catch(() => ({ error: 'Conversion failed' }))
        alert(`Conversion failed: ${errorData.error}`)
      }
    } catch (error) {
      console.error('Conversion failed:', error)
      alert('Conversion failed. Please try again.')
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval)
      }
      setIsConverting(false)
    }
  }

  const handleDownload = () => {
    if (convertedUrl && originalFile) {
      const nameWithoutExt = originalFile.name.replace(/\.[^/.]+$/, '')
      const link = document.createElement('a')
      link.href = convertedUrl
      link.download = `${nameWithoutExt}.${format}`
      link.click()
    }
  }

  const handleBackToUpload = () => {
    setOriginalFile(null)
    setUploadedFileName(null)
    setConvertedUrl(null)
    setOriginalSize(0)
    setConvertedSize(0)
  }

  return (
    <main className="max-w-7xl mx-auto p-4">
      {!originalFile ? (
        <>
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-white mb-4">
              Convert Audio <span className="text-purple-400">Files</span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
              Convert between audio formats while maintaining quality. Perfect for compatibility and optimization.
            </p>
          </div>

          <AudioUpload onAudioUpload={handleAudioUpload} />

          <div className="grid md:grid-cols-3 gap-6 mt-12">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
              <div className="text-3xl mb-3">🎧</div>
              <h3 className="text-lg font-semibold text-white mb-2">Multiple Formats</h3>
              <p className="text-gray-400">Convert between MP3, WAV, FLAC, AAC, and OGG formats.</p>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
              <div className="text-3xl mb-3">⚡</div>
              <h3 className="text-lg font-semibold text-white mb-2">Fast Processing</h3>
              <p className="text-gray-400">Chunked upload for large files with real-time progress tracking.</p>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
              <div className="text-3xl mb-3">📁</div>
              <h3 className="text-lg font-semibold text-white mb-2">Large Files</h3>
              <p className="text-gray-400">Support for audio files up to 200MB with reliable upload.</p>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mb-4">
            <button 
              onClick={handleBackToUpload}
              className="text-purple-400 hover:text-purple-300 flex items-center gap-2"
            >
              ← Back to Upload
            </button>
          </div>

          <AudioControls
            format={format}
            quality={quality}
            onFormatChange={setFormat}
            onQualityChange={setQuality}
            onConvert={convertAudio}
            isConverting={isConverting}
            progress={progress}
            estimatedTimeRemaining={estimatedTimeRemaining}
            phase={phase}
          />

          <AudioPreview
            originalFile={originalFile}
            convertedUrl={convertedUrl}
            originalSize={originalSize}
            convertedSize={convertedSize}
            onDownload={handleDownload}
          />
        </>
      )}


    </main>
  )
}