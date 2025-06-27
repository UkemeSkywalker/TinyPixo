import { useRef } from 'react'

interface AudioUploadProps {
  onAudioUpload: (file: File) => void
}

export default function AudioUpload({ onAudioUpload }: AudioUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onAudioUpload(file)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) {
      onAudioUpload(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div 
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="border-2 border-dashed border-purple-500/50 rounded-2xl p-12 text-center bg-gradient-to-br from-purple-900/10 to-pink-900/10 hover:border-purple-400 hover:bg-purple-900/20 transition-all duration-300 cursor-pointer group"
      >
        <div className="space-y-6">
          <div className="text-7xl group-hover:scale-110 transition-transform duration-300">🎵</div>
          <div>
            <p className="text-2xl font-semibold text-white mb-2">Drop your audio files here</p>
            <p className="text-gray-300 mb-4">or click to browse files</p>
            <div className="inline-flex items-center gap-2 text-sm text-purple-400 bg-purple-900/30 px-4 py-2 rounded-full">
              <span>🎧</span>
              <span>Supports: MP3, WAV, FLAC, AAC, OGG</span>
            </div>
          </div>
          <input 
            ref={fileInputRef}
            type="file" 
            className="hidden" 
            accept="audio/*"
            onChange={handleFileChange}
          />
        </div>
      </div>
      
      <div className="mt-6 text-center text-sm text-gray-400">
        <p>🎼 <strong>Pro tip:</strong> Convert between formats while maintaining quality</p>
      </div>
    </div>
  )
}