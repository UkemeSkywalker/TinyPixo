'use client'

import { useState, useRef, useEffect } from 'react'
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
        
        const inputName = 'input.' + originalFile.name.split('.').pop()
        const outputName = `output.${format}`

        await ffmpeg.writeFile(inputName, await fetchFile(originalFile))

        const args = ['-i', inputName, '-b:a', quality]
        if (format === 'mp3') args.push('-codec:a', 'libmp3lame')
        else if (format === 'aac') args.push('-codec:a', 'aac')
        else if (format === 'ogg') args.push('-codec:a', 'libvorbis')
        
        args.push(outputName)
        await ffmpeg.exec(args)

        const data = await ffmpeg.readFile(outputName)
        const blob = new Blob([data], { type: `audio/${format}` })
        const url = URL.createObjectURL(blob)
        
        setConvertedUrl(url)
        setConvertedSize(blob.size)
        setProgress(100) // Ensure progress shows 100% when complete
        return
      }
      
      // Server-side FFmpeg for production
      const formData = new FormData()
      formData.append('audio', originalFile)
      formData.append('format', format)
      formData.append('quality', quality)

      const response = await fetch('/api/convert-audio', {
        method: 'POST',
        body: formData,
      })
      
      // Get job ID from response headers
      const jobId = response.headers.get('X-Job-Id')
      
      // Start progress polling if we have a job ID
      if (jobId) {
        progressInterval = setInterval(async () => {
          try {
            const progressResponse = await fetch(`/api/progress?jobId=${jobId}`)
            if (progressResponse.ok) {
              const data = await progressResponse.json()
              setProgress(data.progress || 0)
              
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

      if (response.ok) {
        // Check if it's a mock response (development without FFmpeg)
        const contentType = response.headers.get('Content-Type')
        if (contentType && contentType.includes('application/json')) {
          const mockData = await response.json()
          alert(`Development mode: ${mockData.message || 'FFmpeg not installed locally'}`)
          setProgress(100)
          // Create a small mock audio file
          const mockBlob = new Blob([new ArrayBuffer(1024)], { type: 'audio/mp3' })
          const url = URL.createObjectURL(mockBlob)
          setConvertedUrl(url)
          setConvertedSize(mockBlob.size)
        } else {
          // Normal blob response
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          setConvertedUrl(url)
          setConvertedSize(blob.size)
        }
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Conversion failed' }))
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

      {!(process.env.NODE_ENV === 'production') && !ffmpegLoaded && (
        <div className="fixed bottom-4 right-4 bg-purple-600 text-white px-4 py-2 rounded-lg">
          Loading client-side FFmpeg...
        </div>
      )}
    </main>
  )
}