import React, { useRef } from 'react'

interface AudioUploadProps {
  onAudioUpload: (file: File) => void
  onFileSizeError?: (fileSize: number, maxSize: number) => void
  isUploading?: boolean
  uploadProgress?: number
}

// File size limit: 105MB
const MAX_FILE_SIZE = 105 * 1024 * 1024

export default function AudioUpload({ onAudioUpload, onFileSizeError, isUploading = false, uploadProgress = 0 }: AudioUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        onFileSizeError?.(file.size, MAX_FILE_SIZE)
        // Clear the input so user can select a different file
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        return
      }
      onAudioUpload(file)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        onFileSizeError?.(file.size, MAX_FILE_SIZE)
        return
      }
      onAudioUpload(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div 
        onClick={!isUploading ? handleClick : undefined}
        onDrop={!isUploading ? handleDrop : undefined}
        onDragOver={!isUploading ? handleDragOver : undefined}
        className={`border-2 border-dashed rounded-2xl p-12 text-center bg-gradient-to-br transition-all duration-300 ${
          isUploading 
            ? 'border-purple-400 bg-purple-900/20 cursor-not-allowed' 
            : 'border-purple-500/50 from-purple-900/10 to-pink-900/10 hover:border-purple-400 hover:bg-purple-900/20 cursor-pointer group'
        }`}
      >
        <div className="space-y-6">
          <div className={`text-7xl transition-transform duration-300 ${!isUploading ? 'group-hover:scale-110' : ''}`}>
            {isUploading ? '⏳' : '🎵'}
          </div>
          <div>
            {isUploading ? (
              <>
                <p className="text-2xl font-semibold text-white mb-2">Uploading...</p>
                <p className="text-gray-300 mb-4">{uploadProgress}% complete</p>
                <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
                  <div 
                    className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <p className="text-2xl font-semibold text-white mb-2">Drop your audio files here</p>
                <p className="text-gray-300 mb-4">or click to browse files</p>
              </>
            )}
            <div className="inline-flex items-center gap-2 text-sm text-purple-400 bg-purple-900/30 px-4 py-2 rounded-full">
              <span>🎧</span>
              <span>Supports: MP3, WAV, FLAC, AAC, OGG (Max: 105MB)</span>
            </div>
          </div>
          <input 
            ref={fileInputRef}
            type="file" 
            className="hidden" 
            accept="audio/*"
            onChange={handleFileChange}
            disabled={isUploading}
          />
        </div>
      </div>
      
      <div className="mt-6 text-center text-sm text-gray-400">
        <p>🎼 <strong>Pro tip:</strong> Convert between formats while maintaining quality</p>
      </div>
    </div>
  )
}