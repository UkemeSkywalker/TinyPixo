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
        
        ffmpeg.on('log', ({ message }) => {
          console.log('FFmpeg log:', message)
        })
        
        // Try multiple CDNs for better reliability
        const cdnUrls = [
          'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd',
          'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd',
          'https://unpkg.com/@ffmpeg/core-st@0.12.6/dist/umd'
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

  const handleAudioUpload = (file: File) => {
    setOriginalFile(file)
    setOriginalSize(file.size)
    setConvertedUrl(null)
    setConvertedSize(0)
  }

  const convertAudio = async () => {
    if (!originalFile || !ffmpegLoaded || !ffmpegRef.current) {
      alert('Audio converter not ready. Please wait for it to load.')
      return
    }

    setIsConverting(true)
    const ffmpeg = ffmpegRef.current

    try {
      const { fetchFile } = await import('@ffmpeg/util')
      
      const inputName = 'input.' + originalFile.name.split('.').pop()
      const outputName = `output.${format}`

      console.log('Writing audio file to FFmpeg...')
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
    } catch (error) {
      console.error('Conversion failed:', error)
      alert(`Conversion failed: ${error.message || 'Unknown error'}. Please try again with a different file or format.`)
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

      {!ffmpegLoaded && (
        <div className="fixed bottom-4 right-4 bg-purple-600 text-white px-4 py-2 rounded-lg">
          Loading audio converter...
        </div>
      )}
    </main>
  )
}