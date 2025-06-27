interface AudioPreviewProps {
  originalFile: File | null
  convertedUrl: string | null
  originalSize: number
  convertedSize: number
  onDownload: () => void
}

export default function AudioPreview({ 
  originalFile, 
  convertedUrl, 
  originalSize, 
  convertedSize,
  onDownload 
}: AudioPreviewProps) {
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const compressionRatio = originalSize > 0 ? ((originalSize - convertedSize) / originalSize * 100).toFixed(1) : '0'

  return (
    <div className="grid md:grid-cols-2 gap-6 mt-6">
      {/* Original Audio */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4">Original</h3>
        {originalFile && (
          <>
            <div className="mb-4">
              <audio controls className="w-full">
                <source src={URL.createObjectURL(originalFile)} type={originalFile.type} />
              </audio>
            </div>
            <div className="space-y-2 text-sm text-gray-300">
              <p><strong>Name:</strong> {originalFile.name}</p>
              <p><strong>Size:</strong> {formatFileSize(originalSize)}</p>
              <p><strong>Type:</strong> {originalFile.type}</p>
            </div>
          </>
        )}
      </div>

      {/* Converted Audio */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4">Converted</h3>
        {convertedUrl ? (
          <>
            <div className="mb-4">
              <audio controls className="w-full">
                <source src={convertedUrl} />
              </audio>
            </div>
            <div className="space-y-2 text-sm text-gray-300 mb-4">
              <p><strong>Size:</strong> {formatFileSize(convertedSize)}</p>
              <p><strong>Reduction:</strong> {compressionRatio}%</p>
            </div>
            <button 
              onClick={onDownload}
              className="w-full bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Download Converted Audio
            </button>
          </>
        ) : (
          <div className="text-center text-gray-400 py-8">
            <p>Converted audio will appear here</p>
          </div>
        )}
      </div>
    </div>
  )
}