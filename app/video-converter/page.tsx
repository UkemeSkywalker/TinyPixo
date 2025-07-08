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
        
        ffmpeg.on('log', ({ message }) => {
          console.log('FFmpeg log:', message)
        })
        
        // Try multiple CDNs for better reliability
        const cdnUrls = [
          'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd',
          'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.12.6/dist/umd'
        ]
        
        let loaded = false
        for (const baseURL of cdnUrls) {
          try {
            await ffmpeg.load({
              coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
              wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            })
            loaded = true
            break
          } catch (err) {
            console.warn(`Failed to load from ${baseURL}:`, err)
            continue
          }
        }
        
        if (!loaded) {
          throw new Error('All CDN sources failed to load')
        }
        setFfmpegLoaded(true)
        console.log('FFmpeg loaded successfully')
      } catch (error) {
        console.error('Failed to load FFmpeg:', error)
        // Don't show alert immediately, let user try to use it first
        setFfmpegLoaded(false)
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
    if (!originalFile) {
      alert('Please upload a video file first.')
      return
    }
    
    if (!ffmpegLoaded || !ffmpegRef.current) {
      alert('Video converter failed to load. This might be due to network issues. Please refresh the page and try again, or check your internet connection.')
      return
    }

    setIsConverting(true)
    setProgress(0)
    const ffmpeg = ffmpegRef.current

    try {
      const { fetchFile } = await import('@ffmpeg/util')
      
      const inputName = `input.${originalFile.name.split('.').pop()}`
      const outputName = `output.${format}`

      console.log('Writing file to FFmpeg...')
      await ffmpeg.writeFile(inputName, await fetchFile(originalFile))

      const args = ['-i', inputName]
      
      // Quality and bitrate settings
      if (bitrate === 'auto') {
        if (quality === 'high') args.push('-crf', '18')
        else if (quality === 'medium') args.push('-crf', '23')
        else args.push('-crf', '28')
      } else {
        args.push('-b:v', bitrate)
      }
      
      // Video filters array
      const filters = []
      
      // Resolution scaling
      if (resolution !== 'original') {
        if (resolution === '1080p') filters.push('scale=1920:1080:force_original_aspect_ratio=decrease')
        else if (resolution === '720p') filters.push('scale=1280:720:force_original_aspect_ratio=decrease')
        else if (resolution === '480p') filters.push('scale=854:480:force_original_aspect_ratio=decrease')
        else if (resolution === '360p') filters.push('scale=640:360:force_original_aspect_ratio=decrease')
      }
      
      // FPS settings
      if (fps !== 'original') {
        filters.push(`fps=${fps}`)
      }
      
      // Apply filters if any
      if (filters.length > 0) {
        args.push('-vf', filters.join(','))
      }
      
      // Codec settings
      if (format === 'mp4') {
        args.push('-c:v', 'libx264', '-preset', 'fast')
      } else if (format === 'webm') {
        args.push('-c:v', 'libvpx')
      } else if (format === 'avi') {
        args.push('-c:v', 'libx264')
      } else if (format === 'mov') {
        args.push('-c:v', 'libx264')
      } else if (format === 'mkv') {
        args.push('-c:v', 'libx264')
      } else if (format === 'flv') {
        args.push('-c:v', 'libx264')
      } else if (format === 'wmv') {
        args.push('-c:v', 'libx264')
      } else if (format === '3gp') {
        args.push('-c:v', 'libx264', '-s', '176x144')
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
      alert(`Conversion failed: ${error.message || 'Unknown error'}. Please try again with a different file or format.`)
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

      {!ffmpegLoaded && (
        <div className="fixed bottom-4 right-4 bg-purple-600 text-white px-4 py-2 rounded-lg">
          Loading video converter...
        </div>
      )}
    </main>
  )
}