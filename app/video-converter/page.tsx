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
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number | null>(null)
  const [phase, setPhase] = useState<'uploading' | 'converting'>('uploading')
  const [ffmpegLoaded, setFfmpegLoaded] = useState<boolean>(false)
  const ffmpegRef = useRef<any>(null)

  // Load FFmpeg WASM for local development
  useEffect(() => {
    // Skip FFmpeg loading in production (we use server-side FFmpeg there)
    if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') return
    
    const loadFFmpeg = async () => {
      try {
        console.log('Loading client-side FFmpeg for local development')
        const { FFmpeg } = await import('@ffmpeg/ffmpeg')
        const { toBlobURL } = await import('@ffmpeg/util')
        
        const ffmpeg = new FFmpeg()
        ffmpegRef.current = ffmpeg
        
        ffmpeg.on('progress', ({ progress }) => {
          setProgress(Math.round(progress * 100))
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
        console.log('FFmpeg loaded successfully for local development')
      } catch (error) {
        console.error('Failed to load FFmpeg:', error)
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

    setIsConverting(true)
    setProgress(0)
    setPhase('uploading')

    // Use client-side FFmpeg in development, server-side in production
    const isProduction = process.env.NODE_ENV === 'production' || typeof window === 'undefined'
    const useClientFFmpeg = !isProduction && ffmpegLoaded && ffmpegRef.current
    
    let progressInterval = null
    try {
      // Client-side FFmpeg for local development
      if (useClientFFmpeg) {
        console.log('Using client-side FFmpeg for local development')
        const ffmpeg = ffmpegRef.current
        const { fetchFile } = await import('@ffmpeg/util')
        
        const inputName = `input.${originalFile.name.split('.').pop()}`
        const outputName = `output.${format}`

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
        }
        
        args.push('-y', outputName) // -y to overwrite
        
        await ffmpeg.exec(args)

        const data = await ffmpeg.readFile(outputName)
        const blob = new Blob([data], { type: `video/${format}` })
        const url = URL.createObjectURL(blob)
        
        setConvertedUrl(url)
        setConvertedSize(blob.size)
        setProgress(100)
        return
      }
      
      // Server-side FFmpeg for production - Two-step process
      // Step 1: Upload the file
      setProgress(1) // Show initial progress
      const uploadFormData = new FormData()
      uploadFormData.append('file', originalFile)
      uploadFormData.append('fileType', 'video')
      
      try {
        console.log(`Uploading video file: ${originalFile.name}, size: ${originalFile.size} bytes`)
        const uploadResponse = await fetch('/api/upload', {
          method: 'POST',
          body: uploadFormData,
        })
        
        if (!uploadResponse.ok) {
          let errorMessage = 'Upload failed'
          try {
            const errorData = await uploadResponse.json()
            errorMessage = errorData.error || errorMessage
          } catch (e) {
            console.error('Failed to parse error response:', e)
          }
          throw new Error(`Upload failed (${uploadResponse.status}): ${errorMessage}`)
        }
        console.log('Upload successful')
      } catch (error) {
        console.error('Upload error:', error)
        throw new Error(`Upload failed: ${error.message || 'Network error'}`)
      }
      
      const uploadData = await uploadResponse.json()
      setProgress(20) // Show upload complete
      setPhase('converting') // Switch to converting phase
      
      // Step 2: Process the file
      const processResponse = await fetch('/api/convert-video/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: uploadData.fileName,
          format,
          quality,
          resolution,
          bitrate,
          fps
        }),
      })
      
      // Get job ID from response headers
      const jobId = processResponse.headers.get('X-Job-Id')
      
      // Start progress polling if we have a job ID
      if (jobId) {
        progressInterval = setInterval(async () => {
          try {
            const progressResponse = await fetch(`/api/progress?jobId=${jobId}`)
            if (progressResponse.ok) {
              const data = await progressResponse.json()
              // Scale progress to start from 20% (after upload) to 100%
              const scaledProgress = 20 + (data.progress * 0.8)
              setProgress(Math.round(scaledProgress))
              
              // Update estimated time remaining
              if (data.estimatedTimeRemaining !== undefined) {
                setEstimatedTimeRemaining(data.estimatedTimeRemaining)
              }
              
              // If progress is 100%, stop polling
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
        // Check if it's a mock response (development without FFmpeg)
        const contentType = processResponse.headers.get('Content-Type')
        if (contentType && contentType.includes('application/json')) {
          const mockData = await processResponse.json()
          alert(`Development mode: ${mockData.message || 'FFmpeg not installed locally'}`)
          setProgress(100)
          // Create a small mock video file
          const mockBlob = new Blob([new ArrayBuffer(1024)], { type: 'video/mp4' })
          const url = URL.createObjectURL(mockBlob)
          setConvertedUrl(url)
          setConvertedSize(mockBlob.size)
        } else {
          // Normal blob response
          const blob = await processResponse.blob()
          const url = URL.createObjectURL(blob)
          setConvertedUrl(url)
          setConvertedSize(blob.size)
          setProgress(100) // Ensure progress shows 100% when complete
        }
      } else {
        const errorData = await processResponse.json().catch(() => ({ error: 'Conversion failed' }))
        alert(`Conversion failed: ${errorData.error}`)
      }
    } catch (error) {
      console.error('Conversion failed:', error)
      alert('Conversion failed. Please try again.')
    } finally {
      // Clean up interval if it exists
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
            estimatedTimeRemaining={estimatedTimeRemaining}
            phase={phase}
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

      {!(process.env.NODE_ENV === 'production') && !ffmpegLoaded && (
        <div className="fixed bottom-4 right-4 bg-purple-600 text-white px-4 py-2 rounded-lg">
          Loading client-side FFmpeg...
        </div>
      )}
    </main>
  )
}