import { useState, useRef, useEffect } from 'react'

interface BatchFile {
  file: File
  originalSize: number
  optimizedSize: number
  status: 'pending' | 'processing' | 'completed' | 'error'
  optimizedBlob?: Blob
}

interface BatchProcessorProps {
  files: File[]
  format: string
  quality: number
  width?: number
  height?: number
  onBack: () => void
  onFormatChange: (format: string) => void
  onQualityChange: (quality: number) => void
  onPercentageResize?: (percentage: number) => void
}

export default function BatchProcessor({ files, format, quality, width, height, onBack, onFormatChange, onQualityChange, onPercentageResize }: BatchProcessorProps) {
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>(
    files.map(file => ({
      file,
      originalSize: file.size,
      optimizedSize: 0,
      status: 'pending'
    }))
  )
  const [isProcessing, setIsProcessing] = useState(false)
  const [isCreatingZip, setIsCreatingZip] = useState(false)
  const [zipProgress, setZipProgress] = useState(0)
  const [zipWorker, setZipWorker] = useState<Worker | null>(null)
  const shouldStopRef = useRef(false)
  const CHUNK_SIZE = 8
  
  useEffect(() => {
    return () => {
      if (zipWorker) {
        zipWorker.terminate()
      }
    }
  }, [zipWorker])

  const checkMemoryUsage = () => {
    if ('memory' in performance) {
      const memory = (performance as any).memory
      const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit
      return usageRatio > 0.8
    }
    return false
  }

  const processInChunks = async () => {
    setIsProcessing(true)
    shouldStopRef.current = false
    let chunkSize = CHUNK_SIZE
    
    for (let i = 0; i < batchFiles.length; i += chunkSize) {
      if (shouldStopRef.current) break
      
      if (checkMemoryUsage()) {
        chunkSize = Math.max(2, Math.floor(chunkSize / 2))
        console.warn(`Reducing chunk size to ${chunkSize} due to memory pressure`)
      }
      
      const chunk = batchFiles.slice(i, i + chunkSize)
      await processChunk(chunk, i)
      
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    setIsProcessing(false)
  }

  const processChunk = async (chunk: BatchFile[], startIndex: number) => {
    for (let j = 0; j < chunk.length; j++) {
      const i = startIndex + j
      if (shouldStopRef.current) break
      
      setBatchFiles(prev => prev.map((bf, idx) => 
        idx === i ? { ...bf, status: 'processing' } : bf
      ))

      try {
        if (batchFiles[i].file.size > 50 * 1024 * 1024) {
          setBatchFiles(prev => prev.map((bf, idx) => 
            idx === i ? { ...bf, status: 'error' } : bf
          ))
          continue
        }
        
        const formData = new FormData()
        formData.append('image', batchFiles[i].file)
        formData.append('format', format)
        formData.append('quality', quality.toString())
        if (width) formData.append('width', width.toString())
        if (height) formData.append('height', height.toString())

        const response = await fetch('/api/optimize', {
          method: 'POST',
          body: formData,
        })

        if (response.ok) {
          const blob = await response.blob()
          setBatchFiles(prev => prev.map((bf, idx) => 
            idx === i ? { 
              ...bf, 
              status: 'completed', 
              optimizedSize: blob.size,
              optimizedBlob: blob 
            } : bf
          ))
        } else {
          setBatchFiles(prev => prev.map((bf, idx) => 
            idx === i ? { ...bf, status: 'error' } : bf
          ))
        }
      } catch (error) {
        setBatchFiles(prev => prev.map((bf, idx) => 
          idx === i ? { ...bf, status: 'error' } : bf
        ))
      }
    }
  }

  const stopProcessing = () => {
    shouldStopRef.current = true
    setIsProcessing(false)
    if (isCreatingZip && zipWorker) {
      zipWorker.postMessage({ type: 'CANCEL' })
      setIsCreatingZip(false)
      setZipProgress(0)
    }
  }

  const preserveFolderStructure = (file: File, format: string) => {
    const relativePath = file.webkitRelativePath || file.name
    const pathParts = relativePath.split('/')
    const fileName = pathParts.pop()?.replace(/\.[^/.]+$/, '') + `.${format}`
    return [...pathParts, fileName].join('/')
  }

  const createZipExport = async () => {
    const completedFiles = batchFiles.filter(bf => bf.status === 'completed' && bf.optimizedBlob)
    if (completedFiles.length === 0) return

    console.log('Starting ZIP export for', completedFiles.length, 'files')
    setIsCreatingZip(true)
    setZipProgress(0)

    try {
      console.log('Creating worker...')
      const worker = new Worker('/workers/zipWorker.js')
      setZipWorker(worker)

      worker.onerror = (error) => {
        console.error('Worker error:', error)
        setIsCreatingZip(false)
        setZipProgress(0)
        downloadAll()
      }

      worker.onmessage = (e) => {
        const { type, progress, zipBlob, error } = e.data
        console.log('Received message from worker:', type, progress)
        
        switch (type) {
          case 'PROGRESS':
            setZipProgress(progress)
            break
          case 'COMPLETE':
            console.log('ZIP creation complete, downloading...')
            const url = URL.createObjectURL(zipBlob)
            const link = document.createElement('a')
            link.href = url
            link.download = `optimized_images.zip`
            link.click()
            URL.revokeObjectURL(url)
            setIsCreatingZip(false)
            setZipProgress(0)
            worker.terminate()
            setZipWorker(null)
            break
          case 'ERROR':
            console.error('ZIP creation failed:', error)
            setIsCreatingZip(false)
            setZipProgress(0)
            worker.terminate()
            setZipWorker(null)
            downloadAll()
            break
        }
      }

      console.log('Sending INIT message...')
      worker.postMessage({ type: 'INIT', data: { totalFiles: completedFiles.length } })

      console.log('Adding files to ZIP...')
      for (const bf of completedFiles) {
        const path = preserveFolderStructure(bf.file, format)
        worker.postMessage({ 
          type: 'ADD_FILE', 
          data: { blob: bf.optimizedBlob, path } 
        })
      }

      console.log('Sending FINALIZE message...')
      worker.postMessage({ type: 'FINALIZE' })
    } catch (error) {
      console.error('Failed to create ZIP:', error)
      setIsCreatingZip(false)
      setZipProgress(0)
      downloadAll()
    }
  }

  const downloadAll = () => {
    batchFiles.forEach((bf) => {
      if (bf.optimizedBlob) {
        const nameWithoutExt = bf.file.name.replace(/\.[^/.]+$/, '')
        const url = URL.createObjectURL(bf.optimizedBlob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${nameWithoutExt}.${format}`
        link.click()
        URL.revokeObjectURL(url)
      }
    })
  }

  const downloadSingle = (bf: BatchFile) => {
    if (bf.optimizedBlob) {
      const nameWithoutExt = bf.file.name.replace(/\.[^/.]+$/, '')
      const url = URL.createObjectURL(bf.optimizedBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${nameWithoutExt}.${format}`
      link.click()
      URL.revokeObjectURL(url)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 KB'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const completedFiles = batchFiles.filter(bf => bf.status === 'completed').length
  const totalSavings = batchFiles.reduce((acc, bf) => acc + (bf.originalSize - bf.optimizedSize), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Batch Processing</h2>
          <p className="text-gray-400">{files.length} files selected</p>
        </div>
        <button onClick={onBack} className="text-blue-400 hover:text-blue-300">
          ← Back
        </button>
      </div>

      {/* Settings */}
      <div className="grid md:grid-cols-3 gap-6 bg-gray-800 rounded-xl p-4">
        <div>
          <h3 className="font-medium mb-3">Format</h3>
          <div className="flex gap-4">
            {['webp', 'avif', 'jpeg', 'png'].map((fmt) => (
              <label key={fmt} className="flex items-center space-x-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="batch-format" 
                  value={fmt} 
                  checked={format === fmt}
                  onChange={(e) => onFormatChange(e.target.value)}
                  className="text-blue-600" 
                />
                <span className="capitalize text-sm">{fmt}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <h3 className="font-medium mb-3">Quality: {quality}%</h3>
          <input 
            type="range" 
            min="1" 
            max="100" 
            value={quality}
            onChange={(e) => onQualityChange(Number(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
          />
        </div>
        <div>
          <h3 className="font-medium mb-3">Resize</h3>
          <select 
            onChange={(e) => {
              const percentage = Number(e.target.value)
              if (percentage && onPercentageResize) {
                onPercentageResize(percentage)
              }
            }}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
            defaultValue=""
          >
            <option value="">Original size</option>
            {[10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100].map((percent) => (
              <option key={percent} value={percent}>{percent}%</option>
            ))}
          </select>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-4 flex-wrap">
        <button
          onClick={processInChunks}
          disabled={isProcessing || isCreatingZip}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-6 py-2 rounded-lg font-medium"
        >
          {isProcessing ? 'Processing...' : 'Start Processing'}
        </button>
        
        {(isProcessing || isCreatingZip) && (
          <button
            onClick={stopProcessing}
            className="bg-red-600 hover:bg-red-700 px-6 py-2 rounded-lg font-medium"
          >
            Stop
          </button>
        )}
        
        {completedFiles > 0 && !isProcessing && (
          <>
            <button
              onClick={createZipExport}
              disabled={isCreatingZip}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 px-6 py-2 rounded-lg font-medium"
            >
              {isCreatingZip ? `Creating ZIP... ${zipProgress}%` : `Export as ZIP (${completedFiles})`}
            </button>
            <button
              onClick={downloadAll}
              disabled={isCreatingZip}
              className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-6 py-2 rounded-lg font-medium"
            >
              Download All ({completedFiles})
            </button>
          </>
        )}
      </div>
      
      {/* ZIP Progress */}
      {isCreatingZip && (
        <div className="bg-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Creating ZIP archive...</span>
            <span className="text-sm text-gray-400">{zipProgress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="bg-purple-600 h-2 rounded-full transition-all duration-300" 
              style={{ width: `${zipProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      {completedFiles > 0 && (
        <div className="bg-gray-800 rounded-xl p-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-green-400">{completedFiles}</div>
              <div className="text-sm text-gray-400">Completed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-400">{formatFileSize(totalSavings)}</div>
              <div className="text-sm text-gray-400">Total Saved</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-purple-400">{files.length}</div>
              <div className="text-sm text-gray-400">Total Files</div>
            </div>
          </div>
          {files.length > 50 && (
            <div className="mt-3 p-2 bg-yellow-900/30 border border-yellow-600 rounded text-yellow-400 text-xs text-center">
              ⚠️ Large batch detected. ZIP creation may take longer.
            </div>
          )}
        </div>
      )}

      {/* File List */}
      <div className="bg-gray-800 rounded-xl p-4">
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {batchFiles.map((bf, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className={`w-3 h-3 rounded-full ${
                  bf.status === 'pending' ? 'bg-gray-500' :
                  bf.status === 'processing' ? 'bg-yellow-500 animate-pulse' :
                  bf.status === 'completed' ? 'bg-green-500' : 'bg-red-500'
                }`} />
                <span className="text-sm font-medium truncate max-w-xs" title={bf.file.webkitRelativePath || bf.file.name}>
                  {bf.file.webkitRelativePath || bf.file.name}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-sm text-gray-400">
                  {formatFileSize(bf.originalSize)}
                  {bf.status === 'completed' && (
                    <span className={`ml-2 ${bf.optimizedSize > bf.originalSize ? 'text-yellow-400' : 'text-green-400'}`}>
                      → {formatFileSize(bf.optimizedSize)}
                      {bf.optimizedSize > bf.originalSize && (
                        <span className="text-xs ml-1">⚠️</span>
                      )}
                    </span>
                  )}
                  {bf.status === 'error' && (
                    <span className="text-red-400 ml-2 text-xs">
                      {bf.file.size > 50 * 1024 * 1024 ? 'Too large' : 'Failed'}
                    </span>
                  )}
                </div>
                {bf.status === 'completed' && (
                  <button
                    onClick={() => downloadSingle(bf)}
                    className="text-blue-400 hover:text-blue-300 text-xs px-2 py-1 rounded border border-blue-400 hover:border-blue-300 transition-colors"
                  >
                    ↓
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}