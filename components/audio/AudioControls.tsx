interface AudioControlsProps {
  format: string
  quality: string
  onFormatChange: (format: string) => void
  onQualityChange: (quality: string) => void
  onConvert: () => void
  isConverting: boolean
}

export default function AudioControls({ 
  format, 
  quality, 
  onFormatChange, 
  onQualityChange, 
  onConvert,
  isConverting 
}: AudioControlsProps) {
  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4">Conversion Settings</h3>
      
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Output Format</label>
          <select 
            value={format}
            onChange={(e) => onFormatChange(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
          >
            <option value="mp3">MP3</option>
            <option value="wav">WAV</option>
            <option value="flac">FLAC</option>
            <option value="aac">AAC</option>
            <option value="ogg">OGG</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Quality</label>
          <select 
            value={quality}
            onChange={(e) => onQualityChange(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
          >
            <option value="128k">128 kbps</option>
            <option value="192k">192 kbps</option>
            <option value="256k">256 kbps</option>
            <option value="320k">320 kbps</option>
          </select>
        </div>
      </div>
      
      <div className="mt-6 text-center">
        <button 
          onClick={onConvert}
          disabled={isConverting}
          className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 px-8 py-3 rounded-lg font-medium transition-colors"
        >
          {isConverting ? 'Converting...' : 'Convert Audio'}
        </button>
      </div>
    </div>
  )
}