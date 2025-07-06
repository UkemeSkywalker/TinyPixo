'use client'

interface VideoPreviewProps {
  originalFile: File | null
  convertedUrl: string | null
  originalSize: number
  convertedSize: number
  onDownload: () => void
}

export default function VideoPreview({
  originalFile,
  convertedUrl,
  originalSize,
  convertedSize,
  onDownload
}: VideoPreviewProps) {
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const compressionRatio = originalSize > 0 && convertedSize > 0 
    ? ((originalSize - convertedSize) / originalSize * 100).toFixed(1)
    : '0'

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Original Video */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Original Video</h3>
        {originalFile && (
          <>
            <video
              src={URL.createObjectURL(originalFile)}
              controls
              className="w-full rounded-lg mb-4"
            />
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">File name:</span>
                <span className="text-white">{originalFile.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">File size:</span>
                <span className="text-white">{formatFileSize(originalSize)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Type:</span>
                <span className="text-white">{originalFile.type}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Converted Video */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Converted Video</h3>
        {convertedUrl ? (
          <>
            <video
              src={convertedUrl}
              controls
              className="w-full rounded-lg mb-4"
            />
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-gray-400">File size:</span>
                <span className="text-white">{formatFileSize(convertedSize)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Size reduction:</span>
                <span className={`${parseFloat(compressionRatio) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {parseFloat(compressionRatio) > 0 ? '-' : '+'}{Math.abs(parseFloat(compressionRatio))}%
                </span>
              </div>
            </div>
            <button
              onClick={onDownload}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              Download Converted Video
            </button>
          </>
        ) : (
          <div className="flex items-center justify-center h-48 bg-gray-700 rounded-lg">
            <p className="text-gray-400">Converted video will appear here</p>
          </div>
        )}
      </div>
    </div>
  )
}