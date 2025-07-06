'use client'

import { useCallback } from 'react'

interface VideoUploadProps {
  onVideoUpload: (file: File) => void
}

export default function VideoUpload({ onVideoUpload }: VideoUploadProps) {
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    const videoFile = files.find(file => file.type.startsWith('video/'))
    if (videoFile) {
      onVideoUpload(videoFile)
    }
  }, [onVideoUpload])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('video/')) {
      onVideoUpload(file)
    }
  }, [onVideoUpload])

  return (
    <div className="max-w-2xl mx-auto">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-gray-600 rounded-lg p-12 text-center hover:border-purple-400 transition-colors cursor-pointer"
        onClick={() => document.getElementById('video-upload')?.click()}
      >
        <div className="text-6xl mb-4">🎬</div>
        <h3 className="text-xl font-semibold text-white mb-2">
          Drop your video here or click to browse
        </h3>
        <p className="text-gray-400 mb-4">
          Supports MP4, WebM, AVI, MOV, and more
        </p>
        <input
          id="video-upload"
          type="file"
          accept="video/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="text-sm text-gray-500">
          Maximum file size: 500MB
        </div>
      </div>
    </div>
  )
}