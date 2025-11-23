interface PDFPreviewProps {
  originalFile: File | null
  compressedUrl: string | null
  originalSize: number
  compressedSize: number
  onDownload: () => void
}

export default function PDFPreview({ 
  originalFile, 
  compressedUrl, 
  originalSize, 
  compressedSize,
  onDownload 
}: PDFPreviewProps) {
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const compressionRatio = originalSize > 0 ? ((originalSize - compressedSize) / originalSize * 100).toFixed(1) : '0'

  return (
    <div className="grid md:grid-cols-2 gap-6 mt-6">
      {/* Original PDF */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4">Original</h3>
        {originalFile && (
          <>
            <div className="mb-4 text-center">
              <div className="text-6xl mb-2">📄</div>
              <p className="text-sm text-gray-400">PDF Preview</p>
            </div>
            <div className="space-y-2 text-sm text-gray-300">
              <p><strong>Name:</strong> {originalFile.name}</p>
              <p><strong>Size:</strong> {formatFileSize(originalSize)}</p>
              <p><strong>Type:</strong> {originalFile.type}</p>
            </div>
          </>
        )}
      </div>

      {/* Compressed PDF */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4">Compressed</h3>
        {compressedUrl ? (
          <>
            <div className="mb-4 text-center">
              <div className="text-6xl mb-2">📄</div>
              <p className="text-sm text-gray-400">Compressed PDF</p>
            </div>
            <div className="space-y-2 text-sm text-gray-300 mb-4">
              <p><strong>Size:</strong> {formatFileSize(compressedSize)}</p>
              <p><strong>Reduction:</strong> <span className="text-green-400">{compressionRatio}%</span></p>
              <p><strong>Saved:</strong> {formatFileSize(originalSize - compressedSize)}</p>
            </div>
            <button 
              onClick={onDownload}
              className="w-full bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Download Compressed PDF
            </button>
          </>
        ) : (
          <div className="text-center text-gray-400 py-8">
            <div className="text-4xl mb-2">📄</div>
            <p>Compressed PDF will appear here</p>
          </div>
        )}
      </div>
    </div>
  )
}