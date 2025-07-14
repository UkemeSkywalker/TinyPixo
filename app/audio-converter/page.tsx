'use client'

import { useState, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import AudioUpload from '../../components/audio/AudioUpload'
import AudioControls from '../../components/audio/AudioControls'
import AudioPreview from '../../components/audio/AudioPreview'

export default function AudioConverter() {
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null)
  const [originalSize, setOriginalSize] = useState<number>(0)
  const [convertedSize, setConvertedSize] = useState<number>(0)
  const [format, setFormat] = useState<string>('mp3')
  const [quality, setQuality] = useState<string>('192k')
  const [isConverting, setIsConverting] = useState<boolean>(false)
  const [progress, setProgress] = useState<number>(0)
  // FFmpeg loading removed - now using server-side processing

  const handleAudioUpload = (file: File) => {
    setOriginalFile(file)
    setOriginalSize(file.size)
    setConvertedUrl(null)
    setConvertedSize(0)
  }

  const convertAudio = async () => {
    if (!originalFile) {
      alert('Please select an audio file first.')
      return
    }

    setIsConverting(true)
    setProgress(0)

    try {
      const formData = new FormData()
      formData.append('audio', originalFile)
      formData.append('format', format)
      formData.append('quality', quality)

      const response = await fetch('/api/convert-audio', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        setConvertedUrl(url)
        setConvertedSize(blob.size)
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Conversion failed' }))
        alert(`Conversion failed: ${errorData.error}`)
      }
    } catch (error) {
      console.error('Conversion failed:', error)
      alert('Conversion failed. Please try again.')
    } finally {
      setIsConverting(false)
      setProgress(0)
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
              <p className="text-gray-400">Client-side conversion means your files never leave your device.</p>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
              <div className="text-3xl mb-3">🔒</div>
              <h3 className="text-lg font-semibold text-white mb-2">100% Private</h3>
              <p className="text-gray-400">All processing happens locally in your browser.</p>
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