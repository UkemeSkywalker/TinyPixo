'use client'

import { useState } from 'react'
import ImageUpload from '../components/ImageUpload'
import ImageComparison from '../components/ImageComparison'
import ControlPanel from '../components/ControlPanel'
import BatchProcessor from '../components/BatchProcessor'

export default function Home() {
  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [optimizedImage, setOptimizedImage] = useState<string | null>(null)
  const [originalSize, setOriginalSize] = useState<number>(0)
  const [optimizedSize, setOptimizedSize] = useState<number>(0)
  const [format, setFormat] = useState<string>('webp')
  const [quality, setQuality] = useState<number>(80)
  const [width, setWidth] = useState<number | undefined>()
  const [height, setHeight] = useState<number | undefined>()
  const [maintainAspect, setMaintainAspect] = useState<boolean>(true)
  const [originalFilename, setOriginalFilename] = useState<string>('')
  const [originalDimensions, setOriginalDimensions] = useState<{width: number, height: number} | null>(null)
  const [batchFiles, setBatchFiles] = useState<File[] | null>(null)

  const processImage = async (file?: File) => {
    if (!originalImage && !file) return
    
    try {
      const formData = new FormData()
      if (file) {
        formData.append('image', file)
      } else {
        const response = await fetch(originalImage!)
        const blob = await response.blob()
        formData.append('image', blob)
      }
      
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
        const optimizedUrl = URL.createObjectURL(blob)
        setOptimizedImage(optimizedUrl)
        setOptimizedSize(blob.size)
      }
    } catch (error) {
      console.error('Processing failed:', error)
    }
  }

  const handleImageUpload = async (file: File) => {
    const url = URL.createObjectURL(file)
    setOriginalImage(url)
    setOriginalSize(file.size)
    setOriginalFilename(file.name)
    setBatchFiles(null)
    
    // Get image dimensions
    const img = new Image()
    img.onload = () => {
      setOriginalDimensions({ width: img.width, height: img.height })
    }
    img.src = url
    
    await processImage(file)
  }

  const handleBatchUpload = (files: File[]) => {
    setBatchFiles(files)
    setOriginalImage(null)
  }

  const handleBackFromBatch = () => {
    setBatchFiles(null)
  }

  const handleDownload = () => {
    if (optimizedImage) {
      const nameWithoutExt = originalFilename.replace(/\.[^/.]+$/, '')
      const link = document.createElement('a')
      link.href = optimizedImage
      link.download = `${nameWithoutExt}.${format}`
      link.click()
    }
  }

  return (
    <>
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-xl font-bold text-blue-400">TinyPixo</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4">
        {batchFiles ? (
          <BatchProcessor 
            files={batchFiles}
            format={format}
            quality={quality}
            width={width}
            height={height}
            onBack={handleBackFromBatch}
            onFormatChange={setFormat}
            onQualityChange={setQuality}
          />
        ) : !originalImage ? (
          <ImageUpload 
            onImageUpload={handleImageUpload}
            onBatchUpload={handleBatchUpload}
          />
        ) : (
          <>
            <ImageComparison 
              originalImage={originalImage}
              optimizedImage={optimizedImage}
              originalSize={originalSize}
              optimizedSize={optimizedSize}
            />
            <ControlPanel
              format={format}
              quality={quality}
              width={width}
              height={height}
              maintainAspect={maintainAspect}
              onFormatChange={(newFormat) => {
                setFormat(newFormat)
                setTimeout(() => processImage(), 100)
              }}
              onQualityChange={(newQuality) => {
                setQuality(newQuality)
                setTimeout(() => processImage(), 100)
              }}
              onWidthChange={(newWidth) => {
                setWidth(newWidth)
                setTimeout(() => processImage(), 100)
              }}
              onHeightChange={(newHeight) => {
                setHeight(newHeight)
                setTimeout(() => processImage(), 100)
              }}
              onMaintainAspectChange={setMaintainAspect}
              onPercentageResize={(percentage) => {
                if (originalDimensions) {
                  const newWidth = Math.round(originalDimensions.width * (percentage / 100))
                  const newHeight = Math.round(originalDimensions.height * (percentage / 100))
                  setWidth(newWidth)
                  setHeight(newHeight)
                  setTimeout(() => processImage(), 100)
                }
              }}
            />
            
            {/* Download Button */}
            <div className="mt-6 text-center">
              <button 
                onClick={handleDownload}
                disabled={!optimizedImage}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-8 py-3 rounded-lg font-medium transition-colors"
              >
                Download Optimized Image
              </button>
            </div>
          </>
        )}
      </main>
    </>
  )
}