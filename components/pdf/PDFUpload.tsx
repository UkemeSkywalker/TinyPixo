import { useRef } from 'react'

interface PDFUploadProps {
  onPDFUpload: (file: File) => void
}

export default function PDFUpload({ onPDFUpload }: PDFUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onPDFUpload(file)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) {
      onPDFUpload(file)
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
        className="border-2 border-dashed border-red-500/50 rounded-2xl p-12 text-center bg-gradient-to-br from-red-900/10 to-orange-900/10 hover:border-red-400 hover:bg-red-900/20 transition-all duration-300 cursor-pointer group"
      >
        <div className="space-y-6">
          <div className="text-7xl group-hover:scale-110 transition-transform duration-300">📄</div>
          <div>
            <p className="text-2xl font-semibold text-white mb-2">Drop your PDF files here</p>
            <p className="text-gray-300 mb-4">or click to browse files</p>
            <div className="inline-flex items-center gap-2 text-sm text-red-400 bg-red-900/30 px-4 py-2 rounded-full">
              <span>📋</span>
              <span>Supports: PDF files up to 50MB</span>
            </div>
          </div>
          <input 
            ref={fileInputRef}
            type="file" 
            className="hidden" 
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
          />
        </div>
      </div>
      
      <div className="mt-6 text-center text-sm text-gray-400">
        <p>📊 <strong>Pro tip:</strong> Compress PDFs while maintaining readability</p>
      </div>
    </div>
  )
}