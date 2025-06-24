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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 1) {
      onImageUpload(files[0])
    } else if (files.length > 1) {
      onBatchUpload(files)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 1) {
      onImageUpload(files[0])
    } else if (files.length > 1) {
      onBatchUpload(files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  return (
    <div 
      onClick={handleClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      className="border-2 border-dashed border-gray-600 rounded-xl p-8 text-center mb-6 hover:border-blue-500 transition-colors cursor-pointer"
    >
      <div className="space-y-4">
        <div className="text-6xl">📸</div>
        <div>
          <p className="text-lg font-medium">Drop images here or click to select</p>
          <p className="text-gray-400 text-sm mt-1">Single image or multiple for batch processing</p>
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
    </div>
  )
}