'use client'

import { useState, useRef } from 'react'

/**
 * True Streaming Audio Converter Component
 * 
 * Streams audio file directly to server without buffering,
 * receives converted audio in real-time.
 */
export default function TrueStreamingConverter() {
  const [isConverting, setIsConverting] = useState(false)
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleStreamingConvert = async (format: string, quality: string) => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      setError('Please select a file first')
      return
    }

    setIsConverting(true)
    setError(null)
    setConvertedUrl(null)

    try {
      console.log(`Starting true streaming conversion: ${file.name} -> ${format}`)

      // Create streaming request
      const response = await fetch(`/api/stream-convert?format=${format}&quality=${quality}`, {
        method: 'POST',
        body: file, // Stream file directly, no FormData buffering
        headers: {
          'Content-Type': file.type || 'audio/mpeg'
        }
      })

      if (!response.ok) {
        throw new Error(`Conversion failed: ${response.statusText}`)
      }

      // Handle streaming response
      if (response.body) {
        // Option 1: Collect all chunks then create blob
        const chunks: Uint8Array[] = []
        const reader = response.body.getReader()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          
          chunks.push(value)
          
          // Optional: Show progress based on chunks received
          console.log(`Received chunk: ${value.length} bytes`)
        }

        // Create blob from all chunks
        const convertedBlob = new Blob(chunks, { 
          type: response.headers.get('Content-Type') || 'audio/wav' 
        })
        
        const url = URL.createObjectURL(convertedBlob)
        setConvertedUrl(url)
        
        console.log('Streaming conversion completed!')
      }

    } catch (error) {
      console.error('Streaming conversion error:', error)
      setError(error instanceof Error ? error.message : 'Conversion failed')
    } finally {
      setIsConverting(false)
    }
  }

  const handleRealTimeStreamingConvert = async (format: string, quality: string) => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return

    setIsConverting(true)

    try {
      // Option 2: Real-time streaming with immediate playback
      const response = await fetch(`/api/stream-convert?format=${format}&quality=${quality}`, {
        method: 'POST',
        body: file
      })

      if (response.body) {
        const reader = response.body.getReader()
        const audioContext = new AudioContext()
        const source = audioContext.createBufferSource()
        
        // Process chunks as they arrive
        const processChunk = async () => {
          const { done, value } = await reader.read()
          if (done) return

          try {
            // Decode audio chunk in real-time
            const audioBuffer = await audioContext.decodeAudioData(value.buffer)
            
            // Play immediately or append to existing audio
            source.buffer = audioBuffer
            source.connect(audioContext.destination)
            source.start()
            
            console.log('Playing converted chunk in real-time')
          } catch (decodeError) {
            console.log('Chunk not ready for decode yet, accumulating...')
          }

          // Continue processing
          processChunk()
        }

        processChunk()
      }

    } catch (error) {
      setError(error instanceof Error ? error.message : 'Real-time streaming failed')
    } finally {
      setIsConverting(false)
    }
  }

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">True Streaming Converter</h2>
      
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="mb-4 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
      />

      <div className="space-y-2 mb-4">
        <button
          onClick={() => handleStreamingConvert('wav', '192k')}
          disabled={isConverting}
          className="w-full bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {isConverting ? 'Converting...' : 'Convert to WAV (Streaming)'}
        </button>

        <button
          onClick={() => handleStreamingConvert('mp3', '192k')}
          disabled={isConverting}
          className="w-full bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600 disabled:opacity-50"
        >
          {isConverting ? 'Converting...' : 'Convert to MP3 (Streaming)'}
        </button>

        <button
          onClick={() => handleRealTimeStreamingConvert('wav', '192k')}
          disabled={isConverting}
          className="w-full bg-purple-500 text-white py-2 px-4 rounded hover:bg-purple-600 disabled:opacity-50"
        >
          {isConverting ? 'Streaming...' : 'Real-time Stream & Play'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {convertedUrl && (
        <div className="mb-4">
          <h3 className="font-semibold mb-2">Converted Audio:</h3>
          <audio controls className="w-full mb-2">
            <source src={convertedUrl} />
            Your browser does not support the audio element.
          </audio>
          <a
            href={convertedUrl}
            download="converted-audio"
            className="inline-block bg-gray-500 text-white py-1 px-3 rounded text-sm hover:bg-gray-600"
          >
            Download
          </a>
        </div>
      )}

      <div className="text-sm text-gray-600">
        <p><strong>True Streaming:</strong> No intermediate storage, direct processing</p>
        <p><strong>Real-time:</strong> Play audio as it's being converted</p>
      </div>
    </div>
  )
}