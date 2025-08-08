import React from 'react'

interface UploadedFile {
  fileId: string
  fileName: string
  size: number
}

interface ConversionJob {
  jobId: string
  status: string
}

interface AudioControlsProps {
  format: string
  quality: string
  onFormatChange: (format: string) => void
  onQualityChange: (quality: string) => void
  onConvert: () => void
  isUploading: boolean
  isConverting: boolean
  uploadProgress: number
  conversionProgress: number
  estimatedTimeRemaining?: number | null
  phase: 'idle' | 'uploading' | 'converting' | 'completed' | 'error'
  uploadedFile: UploadedFile | null
  conversionJob: ConversionJob | null
  error: string | null
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

export default function AudioControls({ 
  format, 
  quality, 
  onFormatChange, 
  onQualityChange, 
  onConvert,
  isUploading,
  isConverting,
  uploadProgress,
  conversionProgress,
  estimatedTimeRemaining = null,
  phase,
  uploadedFile,
  conversionJob,
  error
}: AudioControlsProps) {
  const isProcessing = isUploading || isConverting
  const canConvert = uploadedFile && !isProcessing
  const currentProgress = phase === 'uploading' ? uploadProgress : conversionProgress

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4">Conversion Settings</h3>
      
      {/* File Status */}
      {uploadedFile && (
        <div className="mb-4 p-3 bg-gray-700 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-300">Uploaded File:</p>
              <p className="text-white font-medium">{uploadedFile.fileName}</p>
              <p className="text-xs text-gray-400">{(uploadedFile.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
            <div className="text-green-400">
              ✓ Ready
            </div>
          </div>
        </div>
      )}

      {/* Conversion Job Status */}
      {conversionJob && (
        <div className="mb-4 p-3 bg-gray-700 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-300">Conversion Job:</p>
              <p className="text-white font-medium">{conversionJob.jobId}</p>
              <p className="text-xs text-gray-400">Status: {conversionJob.status}</p>
            </div>
            <div className={`${phase === 'completed' ? 'text-green-400' : phase === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
              {phase === 'completed' ? '✓ Complete' : phase === 'error' ? '✗ Failed' : '⏳ Processing'}
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg">
          <p className="text-red-400 text-sm">
            <span className="font-medium">Error:</span> {error}
          </p>
        </div>
      )}
      
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Output Format</label>
          <select 
            value={format}
            onChange={(e) => onFormatChange(e.target.value)}
            disabled={isProcessing}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white disabled:opacity-50"
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
            disabled={isProcessing}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white disabled:opacity-50"
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
          disabled={!canConvert}
          className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-8 py-3 rounded-lg font-medium transition-colors"
        >
          {getButtonText()}
        </button>
        
        {isProcessing && (
          <div className="mt-4">
            <div className="bg-gray-700 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-purple-600 h-full transition-all duration-300"
                style={{ width: `${currentProgress}%` }}
              />
            </div>
            <p className="text-sm text-gray-400 mt-2">
              {getProgressText()} {currentProgress}% complete
              {phase === 'converting' && estimatedTimeRemaining !== null && currentProgress > 0 && currentProgress < 100 && (
                <span> • Estimated time remaining: {formatTime(estimatedTimeRemaining)}</span>
              )}
            </p>
            {phase === 'converting' && currentProgress < 100 && (
              <p className="text-xs text-purple-300 mt-1 animate-pulse">
                Please be patient, conversion in progress...
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )

  function getButtonText(): string {
    if (isUploading) return 'Uploading...'
    if (isConverting) return 'Converting...'
    if (!uploadedFile) return 'Upload file first'
    if (phase === 'completed') return 'Convert Another'
    return 'Convert Audio'
  }

  function getProgressText(): string {
    switch (phase) {
      case 'uploading': return 'Uploading...'
      case 'converting': return 'Converting...'
      default: return 'Processing...'
    }
  }
}

