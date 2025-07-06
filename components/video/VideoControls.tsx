'use client'

interface VideoControlsProps {
  format: string
  quality: string
  resolution: string
  onFormatChange: (format: string) => void
  onQualityChange: (quality: string) => void
  onResolutionChange: (resolution: string) => void
  onConvert: () => void
  isConverting: boolean
  progress: number
}

export default function VideoControls({
  format,
  quality,
  resolution,
  onFormatChange,
  onQualityChange,
  onResolutionChange,
  onConvert,
  isConverting,
  progress
}: VideoControlsProps) {
  return (
    <div className="bg-gray-800 rounded-lg p-6 mb-6">
      <h2 className="text-xl font-semibold text-white mb-4">Conversion Settings</h2>
      
      <div className="grid md:grid-cols-3 gap-6 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Output Format
          </label>
          <select
            value={format}
            onChange={(e) => onFormatChange(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
          >
            <option value="mp4">MP4</option>
            <option value="webm">WebM</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Quality
          </label>
          <select
            value={quality}
            onChange={(e) => onQualityChange(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
          >
            <option value="high">High (Larger file)</option>
            <option value="medium">Medium (Balanced)</option>
            <option value="low">Low (Smaller file)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Resolution
          </label>
          <select
            value={resolution}
            onChange={(e) => onResolutionChange(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
          >
            <option value="original">Keep Original</option>
            <option value="1080p">1080p (1920x1080)</option>
            <option value="720p">720p (1280x720)</option>
            <option value="480p">480p (854x480)</option>
          </select>
        </div>
      </div>

      <button
        onClick={onConvert}
        disabled={isConverting}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
      >
        {isConverting ? `Converting... ${progress}%` : 'Convert Video'}
      </button>
      
      {isConverting && (
        <div className="mt-4">
          <div className="flex justify-between text-sm text-gray-300 mb-2">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="bg-purple-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>
      )}
    </div>
  )
}