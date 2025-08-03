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

    console.log(`Starting chunked upload: ${totalChunks} chunks of ${chunkSize} bytes`)
    console.log('Generated fileName:', fileName)

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      const chunk = file.slice(start, end)

      console.log(`Uploading chunk ${i + 1}/${totalChunks} (${chunk.size} bytes)`)

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
        console.error(`Chunk ${i} upload failed with status:`, response.status)
        throw new Error(`Chunk ${i} upload failed`)
      }

      // Update upload progress
      const uploadProgress = Math.round(((i + 1) / totalChunks) * 100)
      console.log(`Upload progress: ${uploadProgress}%`)
      setProgress(uploadProgress)
    }

    console.log('Chunked upload completed successfully')
    return fileName
  }

  const convertAudio = async () => {
    if (!originalFile) {
      alert('Please select an audio file first.')
      return
    }

    console.log('=== CONVERSION STARTED ===')
    console.log('File:', originalFile.name, 'Size:', originalFile.size)
    console.log('Already uploaded:', !!uploadedFileName)
    
    setIsConverting(true)
    setProgress(0)

    let progressInterval = null
    try {
      let fileName = uploadedFileName
      
      // Only upload if file hasn't been uploaded yet
      if (!uploadedFileName) {
        console.log('Starting upload phase...')
        setPhase('uploading')
        fileName = await uploadFileInChunks(originalFile)
        setUploadedFileName(fileName)
        console.log('Upload completed, fileName:', fileName)
      } else {
        console.log('Skipping upload, using existing file:', fileName)
      }
      
      // Phase 2: Convert the uploaded file
      console.log('Starting conversion phase...')
      setPhase('converting')
      setProgress(0)
      
      console.log('Sending conversion request:', { fileName, format, quality })
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
      
      console.log('Conversion response received')
      console.log('Response status:', processResponse.status)
      console.log('Response headers:', [...processResponse.headers.entries()])
      
      const jobId = processResponse.headers.get('X-Job-Id')
      console.log('Extracted jobId:', jobId)
      
      if (jobId) {
        console.log('Starting progress polling for jobId:', jobId)
        
        // Start polling immediately, then every 500ms
        const pollProgress = async () => {
          try {
            console.log('Polling progress for jobId:', jobId)
            const progressResponse = await fetch(`/api/progress?jobId=${jobId}`)
            if (progressResponse.ok) {
              const data = await progressResponse.json()
              console.log('Progress response received:', data)
              console.log('Setting UI progress to:', data.progress + '%')
              setProgress(data.progress)
              
              if (data.estimatedTimeRemaining !== undefined) {
                setEstimatedTimeRemaining(data.estimatedTimeRemaining)
              }
              
              if (data.progress >= 100) {
                console.log('Progress complete, stopping polling')
                if (progressInterval) {
                  clearInterval(progressInterval)
                  progressInterval = null
                }
              }
            } else {
              console.error('Progress response not ok:', progressResponse.status)
            }
          } catch (err) {
            console.error('Progress fetch error:', err)
          }
        }
        
        // Poll immediately
        pollProgress()
        
        // Then poll every 500ms
        progressInterval = setInterval(pollProgress, 500)
      } else {
        console.error('No jobId received, cannot start progress polling')
      }

      if (processResponse.ok) {
        // Wait for conversion to complete
        const waitForCompletion = () => {
          return new Promise((resolve) => {
            const checkProgress = async () => {
              try {
                const progressResponse = await fetch(`/api/progress?jobId=${jobId}`)
                if (progressResponse.ok) {
                  const data = await progressResponse.json()
                  if (data.progress === 100) {
                    resolve(true)
                  } else if (data.progress === -1) {
                    resolve(false)
                  } else {
                    setTimeout(checkProgress, 500)
                  }
                } else {
                  setTimeout(checkProgress, 500)
                }
              } catch (err) {
                setTimeout(checkProgress, 500)
              }
            }
            checkProgress()
          })
        }
        
        const success = await waitForCompletion()
        if (success) {
          console.log('Conversion completed successfully')
          // Download the converted file
          const downloadResponse = await fetch(`/api/convert-audio/download?jobId=${jobId}`)
          if (downloadResponse.ok) {
            const blob = await downloadResponse.blob()
            console.log('Converted file size:', blob.size)
            const url = URL.createObjectURL(blob)
            setConvertedUrl(url)
            setConvertedSize(blob.size)
          } else {
            alert('Failed to download converted file')
          }
        } else {
          alert('Conversion failed')
        }
      } else {
        console.error('Conversion failed with status:', processResponse.status)
        const errorData = await processResponse.json().catch(() => ({ error: 'Conversion failed' }))
        console.error('Error details:', errorData)
        alert(`Conversion failed: ${errorData.error}`)
      }
    } catch (error) {
      console.error('=== CONVERSION ERROR ===')
      console.error('Error details:', error)
      console.error('Error stack:', error.stack)
      alert('Conversion failed. Please try again.')
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval)
        console.log('Progress polling stopped')
      }
      setIsConverting(false)
      console.log('=== CONVERSION ENDED ===')
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