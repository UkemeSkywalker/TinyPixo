'use client'

import { useState, useRef, useEffect } from 'react'
import VideoUpload from '../../components/video/VideoUpload'
import VideoControls from '../../components/video/VideoControls'
import VideoPreview from '../../components/video/VideoPreview'

export default function VideoConverter() {
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null)
  const [originalSize, setOriginalSize] = useState<number>(0)
  const [convertedSize, setConvertedSize] = useState<number>(0)
  const [format, setFormat] = useState<string>('mp4')
  const [quality, setQuality] = useState<string>('medium')
  const [resolution, setResolution] = useState<string>('original')
  const [bitrate, setBitrate] = useState<string>('auto')
  const [fps, setFps] = useState<string>('original')
  const [isConverting, setIsConverting] = useState<boolean>(false)
  const [progress, setProgress] = useState<number>(0)
  // FFmpeg loading removed - now using server-side processing

  const handleVideoUpload = (file: File) => {
    setOriginalFile(file)
    setOriginalSize(file.size)
    setConvertedUrl(null)
    setConvertedSize(0)
  }

  const convertVideo = async () => {
    if (!originalFile) {
      alert('Please upload a video file first.')
      return
    }

    setIsConverting(true)
    setProgress(0)

    try {
      const formData = new FormData()
      formData.append('video', originalFile)
      formData.append('format', format)
      formData.append('quality', quality)
      formData.append('resolution', resolution)
      formData.append('bitrate', bitrate)
      formData.append('fps', fps)

      const response = await fetch('/api/convert-video', {
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
              Convert Video <span className="text-purple-400">Files</span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
              Convert between video formats, adjust quality, and resize videos. All processing happens in your browser.
            </p>
          </div>

          <VideoUpload onVideoUpload={handleVideoUpload} />

          <div className="grid md:grid-cols-3 gap-6 mt-12">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
              <div className="text-3xl mb-3">🎬</div>
              <h3 className="text-lg font-semibold text-white mb-2">Multiple Formats</h3>
              <p className="text-gray-400">Convert between MP4, WebM, AVI, and MOV formats.</p>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
              <div className="text-3xl mb-3">📐</div>
              <h3 className="text-lg font-semibold text-white mb-2">Resize & Compress</h3>
              <p className="text-gray-400">Adjust resolution and quality to optimize file size.</p>
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

          <VideoControls
            format={format}
            quality={quality}
            resolution={resolution}
            bitrate={bitrate}
            fps={fps}
            onFormatChange={setFormat}
            onQualityChange={setQuality}
            onResolutionChange={setResolution}
            onBitrateChange={setBitrate}
            onFpsChange={setFps}
            onConvert={convertVideo}
            isConverting={isConverting}
            progress={progress}
          />

          <VideoPreview
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