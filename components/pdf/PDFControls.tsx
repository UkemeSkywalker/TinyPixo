interface PDFControlsProps {
  quality: string
  onQualityChange: (quality: string) => void
  onCompress: () => void
  isCompressing: boolean
  progress?: number
  estimatedTimeRemaining?: number | null
  phase?: 'uploading' | 'processing' | 'downloading'
}

// Helper function to format seconds into minutes and seconds
function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} sec`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes} min ${remainingSeconds} sec`
}

export default function PDFControls({ 
  quality, 
  onQualityChange, 
  onCompress,
  isCompressing,
  progress = 0,
  estimatedTimeRemaining = null,
  phase = 'processing'
}: PDFControlsProps) {
  const qualityOptions = [
    { value: 'screen', label: 'Screen (Smallest)', description: '72 DPI images' },
    { value: 'ebook', label: 'E-book (Medium)', description: '150 DPI images' },
    { value: 'printer', label: 'Printer (High)', description: '300 DPI images' },
    { value: 'prepress', label: 'Prepress (Highest)', description: '300+ DPI images' }
  ]

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4">Compression Settings</h3>
      
      <div className="max-w-md mx-auto">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Quality Level</label>
          <select 
            value={quality}
            onChange={(e) => onQualityChange(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
          >
            {qualityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            {qualityOptions.find(opt => opt.value === quality)?.description}
          </p>
        </div>
      </div>
      
      <div className="mt-6 text-center">
        <button 
          onClick={onCompress}
          disabled={isCompressing}
          className="bg-red-600 hover:bg-red-700 disabled:bg-gray-600 px-8 py-3 rounded-lg font-medium transition-colors"
        >
          {isCompressing ? (phase === 'uploading' ? 'Uploading...' : 'Compressing...') : 'Compress PDF'}
        </button>
        
        {isCompressing && (
          <div className="mt-4">
            {phase === 'processing' ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-red-600"></div>
                <p className="text-sm text-gray-400">Processing PDF...</p>
              </div>
            ) : (
              <>
                <div className="bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-red-600 h-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-sm text-gray-400 mt-2">
                  {phase === 'uploading' ? 'Uploading...' : phase === 'downloading' ? 'Downloading...' : 'Processing...'} {progress}% complete
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}