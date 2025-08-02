import ProgressBar from './ProgressBar'

interface ImageComparisonProps {
  originalImage: string
  optimizedImage: string | null
  originalSize: number
  optimizedSize: number
  isProcessing?: boolean
  progress?: number
  progressStatus?: string
}

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 KB'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export default function ImageComparison({ 
  originalImage, 
  optimizedImage, 
  originalSize, 
  optimizedSize,
  isProcessing = false,
  progress = 0,
  progressStatus = "Processing..."
}: ImageComparisonProps) {
  const savings = originalSize > 0 ? Math.round(((originalSize - optimizedSize) / originalSize) * 100) : 0
  const ratio = originalSize > 0 ? (originalSize / optimizedSize).toFixed(1) : '0'
  const isLarger = optimizedSize > originalSize
  const increase = isLarger ? Math.round(((optimizedSize - originalSize) / originalSize) * 100) : 0

  return (
    <>
      {/* Image Comparison */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Original */}
        <div className="bg-gray-800 rounded-xl overflow-hidden">
          <div className="bg-gray-700 px-4 py-2 flex justify-between items-center">
            <span className="font-medium">Original</span>
            <span className="text-sm text-gray-300">{formatFileSize(originalSize)}</span>
          </div>
          <div className="aspect-square bg-gray-900 flex items-center justify-center">
            <img src={originalImage} className="max-w-full max-h-full object-contain" alt="Original" />
          </div>
        </div>

        {/* Optimized */}
        <div className="bg-gray-800 rounded-xl overflow-hidden">
          <div className="bg-gray-700 px-4 py-2 flex justify-between items-center">
            <span className="font-medium">Optimized</span>
            <span className="text-sm text-green-400">{formatFileSize(optimizedSize)}</span>
          </div>
          <div className="aspect-square bg-gray-900 flex items-center justify-center">
            {optimizedImage && !isProcessing ? (
              <img src={optimizedImage} className="max-w-full max-h-full object-contain" alt="Optimized" />
            ) : (
              <div className="flex flex-col items-center justify-center space-y-4 p-8">
                {isProcessing && (
                  <>
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
                    <ProgressBar 
                      progress={progress} 
                      isVisible={true} 
                      label={progressStatus}
                    />
                  </>
                )}
                <div className="text-gray-500 text-center">
                  {isProcessing ? progressStatus : "Processing..."}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Warning for larger files */}
      {isLarger && optimizedSize > 0 && (
        <div className="mt-4 bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-4">
          <div className="flex items-center gap-2 text-yellow-400 mb-2">
            <span className="text-lg">⚠️</span>
            <span className="font-medium">Compression Result Larger Than Original</span>
          </div>
          <p className="text-yellow-200 text-sm">
            The converted image is {increase}% larger than the original. This can happen with:
          </p>
          <ul className="text-yellow-200 text-sm mt-2 ml-4 list-disc">
            <li>Already highly compressed images</li>
            <li>Simple images with few colors</li>
            <li>Converting from efficient formats (WebP) to less efficient ones (PNG)</li>
          </ul>
          <p className="text-yellow-200 text-sm mt-2">
            Consider using the original format or trying a different output format.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="mt-6 bg-gray-800 rounded-xl p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-red-400">{formatFileSize(originalSize)}</div>
            <div className="text-sm text-gray-400">Original</div>
          </div>
          <div>
            <div className={`text-2xl font-bold ${isLarger ? 'text-yellow-400' : 'text-green-400'}`}>
              {formatFileSize(optimizedSize)}
            </div>
            <div className="text-sm text-gray-400">Compressed</div>
          </div>
          <div>
            <div className={`text-2xl font-bold ${isLarger ? 'text-yellow-400' : 'text-blue-400'}`}>
              {isLarger ? `+${increase}%` : `${savings}%`}
            </div>
            <div className="text-sm text-gray-400">{isLarger ? 'Increased' : 'Saved'}</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-purple-400">{ratio}:1</div>
            <div className="text-sm text-gray-400">Ratio</div>
          </div>
        </div>
      </div>
    </>
  )
}