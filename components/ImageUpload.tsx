import { useRef } from 'react'

interface ImageUploadProps {
  onImageUpload: (file: File) => void
  onBatchUpload: (files: File[]) => void
}

export default function ImageUpload({ onImageUpload, onBatchUpload }: ImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const validateFile = (file: File): boolean => {
    const maxSize = 50 * 1024 * 1024 // 50MB
    if (file.size > maxSize) {
      alert(`File "${file.name}" is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum size is 50MB.`)
      return false
    }
    return true
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    
    // Validate all files first
    const validFiles = files.filter(validateFile)
    if (validFiles.length === 0) return
    
    if (validFiles.length === 1) {
      onImageUpload(validFiles[0])
    } else if (validFiles.length > 1) {
      onBatchUpload(validFiles)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    
    // Validate all files first
    const validFiles = files.filter(validateFile)
    if (validFiles.length === 0) return
    
    if (validFiles.length === 1) {
      onImageUpload(validFiles[0])
    } else if (validFiles.length > 1) {
      onBatchUpload(validFiles)
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
        onDragEnter={(e) => e.preventDefault()}
        onDragLeave={(e) => e.preventDefault()}
        className="relative border-2 border-dashed border-blue-500/50 rounded-2xl p-12 text-center bg-gradient-to-br from-blue-900/10 to-purple-900/10 hover:border-blue-400 hover:bg-blue-900/20 transition-all duration-300 cursor-pointer group"
        style={{ zIndex: 1 }}
      >
        <div className="space-y-6">
          <div className="text-7xl group-hover:scale-110 transition-transform duration-300">🚀</div>
          <div>
            <p className="text-2xl font-semibold text-white mb-2">Drop your images here</p>
            <p className="text-gray-300 mb-4">or click to browse files</p>
            <div className="inline-flex items-center gap-2 text-sm text-blue-400 bg-blue-900/30 px-4 py-2 rounded-full">
              <span>✨</span>
              <span>Supports: JPG, PNG, WebP • Max 50MB • Single or batch upload</span>
            </div>
          </div>
        </div>
        <input 
          ref={fileInputRef}
          type="file" 
          className="hidden" 
          accept="image/*"
          multiple
          onChange={handleFileChange}
        />
      </div>
      
      {/* Quick Tips */}
      <div className="mt-6 text-center text-sm text-gray-400 space-y-2">
        <p>💡 <strong>Pro tip:</strong> Upload multiple images for batch processing</p>
        <p>📏 <strong>Limits:</strong> Max 50MB per file, 8000px max dimension</p>
      </div>
    </div>
  )
}