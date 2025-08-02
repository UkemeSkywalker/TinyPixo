interface ProgressBarProps {
  progress: number
  isVisible: boolean
  label?: string
}

export default function ProgressBar({ progress, isVisible, label = "Processing..." }: ProgressBarProps) {
  if (!isVisible) return null

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-gray-300">{label}</span>
        <span className="text-sm text-blue-400 font-medium">{Math.round(progress)}%</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-2.5">
        <div 
          className="bg-gradient-to-r from-blue-500 to-purple-500 h-2.5 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
    </div>
  )
}