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
  const [isConverting, setIsConverting] = useState<boolean>(false)
  const [progress, setProgress] = useState<number>(0)
  const [ffmpegLoaded, setFfmpegLoaded] = useState<boolean>(false)
  const ffmpegRef = useRef<any>(null)

  useEffect(() => {
    const loadFFmpeg = async () => {
      if (typeof window === 'undefined') return
      
      try {
        const { FFmpeg } = await import('@ffmpeg/ffmpeg')
        const { toBlobURL } = await import('@ffmpeg/util')
        
        const ffmpeg = new FFmpeg()
        ffmpegRef.current = ffmpeg
        
        ffmpeg.on('progress', ({ progress }) => {
          setProgress(Math.round(progress * 100))
        })
        
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.2/dist/umd'
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        })
        setFfmpegLoaded(true)
      } catch (error) {
        console.error('Failed to load FFmpeg:', error)
      }
    }
    loadFFmpeg()
  }, [])

  const handleVideoUpload = (file: File) => {
    setOriginalFile(file)
    setOriginalSize(file.size)
    setConvertedUrl(null)
    setConvertedSize(0)
  }

  const convertVideo = async () => {
    if (!originalFile || !ffmpegLoaded || !ffmpegRef.current) return

    setIsConverting(true)
    setProgress(0)
    const ffmpeg = ffmpegRef.current

    try {
      const { fetchFile } = await import('@ffmpeg/util')
      
      const inputName = 'input.mp4'
      const outputName = `output.${format}`

      console.log('Writing file to FFmpeg...')
      await ffmpeg.writeFile(inputName, await fetchFile(originalFile))

      const args = ['-i', inputName]
      
      // Simpler quality settings
      if (quality === 'high') {
        args.push('-crf', '18')
      } else if (quality === 'medium') {
        args.push('-crf', '23')
      } else {
        args.push('-crf', '28')
      }
      
      // Resolution scaling
      if (resolution !== 'original') {
        if (resolution === '1080p') args.push('-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease')
        else if (resolution === '720p') args.push('-vf', 'scale=1280:720:force_original_aspect_ratio=decrease')
        else if (resolution === '480p') args.push('-vf', 'scale=854:480:force_original_aspect_ratio=decrease')
      }
      
      // Simpler codec settings
      if (format === 'mp4') {
        args.push('-c:v', 'libx264', '-preset', 'fast')
      } else if (format === 'webm') {
        args.push('-c:v', 'libvpx', '-b:v', '1M')
      }
      
      args.push('-y', outputName) // -y to overwrite
      
      console.log('FFmpeg args:', args)
      await ffmpeg.exec(args)

      console.log('Reading converted file...')
      const data = await ffmpeg.readFile(outputName)
      const blob = new Blob([data], { type: `video/${format}` })
      const url = URL.createObjectURL(blob)
      
      setConvertedUrl(url)
      setConvertedSize(blob.size)
      console.log('Conversion completed successfully')
    } catch (error) {
      console.error('Conversion failed:', error)
      alert('Conversion failed. Check console for details.')
    } finally {
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
            onFormatChange={setFormat}
            onQualityChange={setQuality}
            onResolutionChange={setResolution}
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

      {!ffmpegLoaded && (
        <div className="fixed bottom-4 right-4 bg-purple-600 text-white px-4 py-2 rounded-lg">
          Loading video converter...
        </div>
      )}
    </main>
  )
}