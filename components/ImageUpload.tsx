import { useRef } from 'react'

interface ImageUploadProps {
  onImageUpload: (file: File) => void
  onBatchUpload: (files: File[]) => void
}

export default function ImageUpload({ onImageUpload, onBatchUpload }: ImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFolderClick = () => {
    folderInputRef.current?.click()
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
    
    // Filter for image files only (includes files from nested folders)
    const imageFiles = files.filter(file => file.type.startsWith('image/'))
    
    if (imageFiles.length === 0) {
      alert('No image files found in the selected folder(s). Please select a folder containing images.')
      return
    }
    
    // Show info about nested folders if applicable
    const hasNestedFiles = imageFiles.some(file => file.webkitRelativePath?.includes('/'))
    if (hasNestedFiles && imageFiles.length > 1) {
      const folderCount = new Set(imageFiles.map(file => file.webkitRelativePath?.split('/')[0])).size
      console.log(`Found ${imageFiles.length} images across ${folderCount} folder(s) including subfolders`)
    }
    
    // Validate all files first
    const validFiles = imageFiles.filter(validateFile)
    if (validFiles.length === 0) return
    
    if (validFiles.length === 1) {
      onImageUpload(validFiles[0])
    } else if (validFiles.length > 1) {
      onBatchUpload(validFiles)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    
    const items = Array.from(e.dataTransfer.items)
    const files: File[] = []
    
    // Process both files and folders
    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry()
        if (entry) {
          await processEntry(entry, files)
        }
      }
    }
    
    // Filter for image files only
    const imageFiles = files.filter(file => file.type.startsWith('image/'))
    const validFiles = imageFiles.filter(validateFile)
    
    if (validFiles.length === 0) {
      alert('No valid image files found. Please drop image files or folders containing images.')
      return
    }
    
    if (validFiles.length === 1) {
      onImageUpload(validFiles[0])
    } else {
      onBatchUpload(validFiles)
    }
  }
  
  const processEntry = async (entry: any, files: File[]): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve) => entry.file(resolve))
      files.push(file)
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      const entries = await new Promise<any[]>((resolve) => {
        reader.readEntries(resolve)
      })
      for (const childEntry of entries) {
        await processEntry(childEntry, files)
      }
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
            <p className="text-2xl font-semibold text-white mb-2">Drop images or folders here</p>
            <p className="text-gray-300 mb-4">or click to browse files</p>
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
              <div className="inline-flex items-center gap-2 text-sm text-blue-400 bg-blue-900/30 px-4 py-2 rounded-full">
                <span>✨</span>
                <span>Supports: JPG, PNG, WebP • Max 50MB</span>
              </div>
              <button
                onClick={handleFolderClick}
                className="inline-flex items-center gap-2 text-sm text-purple-400 bg-purple-900/30 px-4 py-2 rounded-full hover:bg-purple-900/50 transition-colors"
              >
                <span>📁</span>
                <span>Select Folder</span>
              </button>
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
        <input 
          ref={folderInputRef}
          type="file" 
          className="hidden" 
          accept="image/*"
          webkitdirectory=""
          multiple
          onChange={handleFileChange}
        />
      </div>
      
      {/* Quick Tips */}
      <div className="mt-6 text-center text-sm text-gray-400 space-y-2">
        <p>💡 <strong>Pro tip:</strong> Upload multiple images or select entire folders for batch processing</p>
        <p>📏 <strong>Limits:</strong> Max 50MB per file, 8000px max dimension</p>
        <p>📁 <strong>Folder mode:</strong> Recursively processes all images from selected folder and subfolders</p>
      </div>
    </div>
  )
}