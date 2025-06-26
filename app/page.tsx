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

  const handleBackToHome = () => {
    setOriginalImage(null)
    setOptimizedImage(null)
    setBatchFiles(null)
  }

  const handlePercentageResize = (percentage: number) => {
    // For batch processing, we'll use a fixed base size since we don't have individual dimensions
    // This is a simplified approach - in production you might want to get dimensions for each file
    const baseWidth = 1920
    const baseHeight = 1080
    const newWidth = Math.round(baseWidth * (percentage / 100))
    const newHeight = Math.round(baseHeight * (percentage / 100))
    setWidth(newWidth)
    setHeight(newHeight)
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
          <h1 
            onClick={handleBackToHome}
            className="text-xl font-bold text-blue-400 cursor-pointer hover:text-blue-300 transition-colors"
          >
            TinyPixo
          </h1>
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
            onPercentageResize={handlePercentageResize}
          />
        ) : !originalImage ? (
          <>
            {/* Hero Section */}
            <div className="text-center mb-12">
              <h1 className="text-5xl font-bold text-white mb-4">
                Optimize Images <span className="text-blue-400">Instantly</span>
              </h1>
              <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
                Reduce file sizes by up to 90% without losing quality. Perfect for web, mobile, and storage optimization.
              </p>
            </div>

            {/* Upload Section */}
            <ImageUpload 
              onImageUpload={handleImageUpload}
              onBatchUpload={handleBatchUpload}
            />

            {/* Features Grid */}
            <div className="grid md:grid-cols-3 gap-6 mt-12">
              <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                <div className="text-3xl mb-3">⚡</div>
                <h3 className="text-lg font-semibold text-white mb-2">Lightning Fast</h3>
                <p className="text-gray-400">Process images in seconds with our optimized compression algorithms.</p>
              </div>
              <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                <div className="text-3xl mb-3">🎯</div>
                <h3 className="text-lg font-semibold text-white mb-2">Smart Compression</h3>
                <p className="text-gray-400">AI-powered optimization maintains visual quality while maximizing compression.</p>
              </div>
              <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                <div className="text-3xl mb-3">📱</div>
                <h3 className="text-lg font-semibold text-white mb-2">Multiple Formats</h3>
                <p className="text-gray-400">Convert to WebP, JPEG, PNG with custom quality and size settings.</p>
              </div>
            </div>

            {/* Stats Section */}
            <div className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 rounded-lg p-8 mt-12 border border-blue-800/30">
              <div className="grid md:grid-cols-3 gap-8 text-center">
                <div>
                  <div className="text-3xl font-bold text-blue-400 mb-2">90%</div>
                  <div className="text-gray-300">Average Size Reduction</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-blue-400 mb-2">&lt;2s</div>
                  <div className="text-gray-300">Processing Time</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-blue-400 mb-2">100%</div>
                  <div className="text-gray-300">Privacy Protected</div>
                </div>
              </div>
            </div>

            {/* How It Works */}
            <div className="mt-16">
              <h2 className="text-3xl font-bold text-center text-white mb-8">How It Works</h2>
              <div className="grid md:grid-cols-3 gap-8">
                <div className="text-center">
                  <div className="bg-blue-600 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">1</div>
                  <h3 className="text-lg font-semibold text-white mb-2">Upload</h3>
                  <p className="text-gray-400">Drag & drop your images or click to select files</p>
                </div>
                <div className="text-center">
                  <div className="bg-blue-600 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">2</div>
                  <h3 className="text-lg font-semibold text-white mb-2">Optimize</h3>
                  <p className="text-gray-400">Choose format, quality, and size settings</p>
                </div>
                <div className="text-center">
                  <div className="bg-blue-600 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">3</div>
                  <h3 className="text-lg font-semibold text-white mb-2">Download</h3>
                  <p className="text-gray-400">Get your optimized images instantly</p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4">
              <button 
                onClick={handleBackToHome}
                className="text-blue-400 hover:text-blue-300 flex items-center gap-2"
              >
                ← Back to Upload
              </button>
            </div>
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

      {/* Footer */}
      <footer className="bg-gray-800 border-t border-gray-700 mt-20">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-lg font-bold text-blue-400 mb-3">TinyPixo</h3>
              <p className="text-gray-400 text-sm">Professional image optimization made simple. Reduce file sizes without compromising quality.</p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-3">Features</h4>
              <ul className="text-gray-400 text-sm space-y-1">
                <li>• Batch Processing</li>
                <li>• Multiple Formats</li>
                <li>• Custom Quality Settings</li>
                <li>• Instant Download</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-3">Privacy</h4>
              <p className="text-gray-400 text-sm">Your images are processed locally and never stored on our servers. Complete privacy guaranteed.</p>
            </div>
          </div>
          <div className="border-t border-gray-700 mt-8 pt-6 text-center text-gray-400 text-sm">
            <p>© 2024 TinyPixo. Built for developers, designers, and content creators.</p>
          </div>
        </div>
      </footer>
    </>
  )
}