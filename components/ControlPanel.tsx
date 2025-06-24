interface ControlPanelProps {
  format: string
  quality: number
  width?: number
  height?: number
  maintainAspect: boolean
  onFormatChange: (format: string) => void
  onQualityChange: (quality: number) => void
  onWidthChange: (width: number | undefined) => void
  onHeightChange: (height: number | undefined) => void
  onMaintainAspectChange: (maintain: boolean) => void
  onPercentageResize: (percentage: number) => void
}

export default function ControlPanel({
  format,
  quality,
  width,
  height,
  maintainAspect,
  onFormatChange,
  onQualityChange,
  onWidthChange,
  onHeightChange,
  onMaintainAspectChange,
  onPercentageResize
}: ControlPanelProps) {
  const percentageOptions = [10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100]

  const handleReset = () => {
    onWidthChange(undefined)
    onHeightChange(undefined)
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Format Selection */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="font-medium mb-3">Format</h3>
        <div className="space-y-2">
          {['webp', 'avif', 'jpeg', 'png'].map((fmt) => (
            <label key={fmt} className="flex items-center space-x-2 cursor-pointer">
              <input 
                type="radio" 
                name="format" 
                value={fmt} 
                checked={format === fmt}
                onChange={(e) => onFormatChange(e.target.value)}
                className="text-blue-600" 
              />
              <span className="capitalize">{fmt}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Quality Control */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="font-medium mb-3">Quality</h3>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span>Quality</span>
            <span>{quality}%</span>
          </div>
          <input 
            type="range" 
            min="1" 
            max="100" 
            value={quality}
            onChange={(e) => onQualityChange(Number(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
          />
        </div>
      </div>

      {/* Resize Options */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="font-medium mb-3">Resize</h3>
        <div className="space-y-3">
          <select 
            onChange={(e) => onPercentageResize(Number(e.target.value))}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
            defaultValue=""
          >
            <option value="">Resize by %</option>
            {percentageOptions.map((percent) => (
              <option key={percent} value={percent}>{percent}%</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input 
              type="number" 
              placeholder="Width" 
              value={width || ''}
              onChange={(e) => onWidthChange(e.target.value ? Number(e.target.value) : undefined)}
              className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
            />
            <input 
              type="number" 
              placeholder="Height" 
              value={height || ''}
              onChange={(e) => onHeightChange(e.target.value ? Number(e.target.value) : undefined)}
              className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={maintainAspect}
                onChange={(e) => onMaintainAspectChange(e.target.checked)}
                className="text-blue-600" 
              />
              <span className="text-sm">Maintain aspect ratio</span>
            </label>
            <button
              onClick={handleReset}
              className="text-xs text-blue-400 hover:text-blue-300 underline"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}