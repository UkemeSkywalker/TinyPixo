'use client'

import { useState } from 'react'
import PDFUpload from '../../components/pdf/PDFUpload'
import PDFControls from '../../components/pdf/PDFControls'
import PDFPreview from '../../components/pdf/PDFPreview'

export default function PDFConverter() {
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [compressedUrl, setCompressedUrl] = useState<string | null>(null)
  const [originalSize, setOriginalSize] = useState<number>(0)
  const [compressedSize, setCompressedSize] = useState<number>(0)
  const [quality, setQuality] = useState<string>('screen')
  const [isCompressing, setIsCompressing] = useState<boolean>(false)
  const [progress, setProgress] = useState<number>(0)
  const [phase, setPhase] = useState<'uploading' | 'processing' | 'downloading'>('uploading')

  const handlePDFUpload = (file: File) => {
    setOriginalFile(file)
    setOriginalSize(file.size)
    setCompressedUrl(null)
    setCompressedSize(0)
  }

  const compressPDF = async () => {
    if (!originalFile) {
      alert('Please select a PDF file first.')
      return
    }

    setIsCompressing(true)
    setProgress(0)
    setPhase('uploading')
    
    try {
      const formData = new FormData()
      formData.append('pdf', originalFile)
      formData.append('quality', quality)
      
      // Simulate upload progress
      let uploadProgress = 0
      const uploadInterval = setInterval(() => {
        uploadProgress += Math.random() * 20 + 10
        if (uploadProgress < 100) {
          setProgress(Math.round(uploadProgress))
        } else {
          setProgress(100)
          setPhase('processing')
          clearInterval(uploadInterval)
        }
      }, 100)
      
      const response = await fetch('/api/convert-pdf', {
        method: 'POST',
        body: formData,
      })
      
      clearInterval(uploadInterval)
      
      if (response.ok) {
        setPhase('downloading')
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        setCompressedUrl(url)
        setCompressedSize(blob.size)
        setProgress(100)
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Compression failed' }))
        alert(`Compression failed: ${errorData.error}`)
      }
    } catch (error) {
      console.error('Compression failed:', error)
      alert('Compression failed. Please try again.')
    } finally {
      setIsCompressing(false)
    }
  }

  const handleDownload = () => {
    if (compressedUrl && originalFile) {
      const nameWithoutExt = originalFile.name.replace(/\.pdf$/i, '')
      const downloadName = `${nameWithoutExt}-compressed.pdf`
      console.log('Original filename:', originalFile.name)
      console.log('Download filename:', downloadName)
      
      const link = document.createElement('a')
      link.href = compressedUrl
      link.download = downloadName
      link.setAttribute('download', downloadName) // Force the download attribute
      document.body.appendChild(link) // Add to DOM
      link.click()
      document.body.removeChild(link) // Remove from DOM
    }
  }

  const handleBackToUpload = () => {
    setOriginalFile(null)
    setCompressedUrl(null)
    setOriginalSize(0)
    setCompressedSize(0)
  }

  return (
    <main className="max-w-7xl mx-auto p-4">
      {!originalFile ? (
        <>
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-white mb-4">
              Compress PDF <span className="text-red-400">Files</span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
              Reduce PDF file sizes while maintaining quality. Perfect for sharing and storage optimization.
            </p>
          </div>

          <PDFUpload onPDFUpload={handlePDFUpload} />

          <div className="grid md:grid-cols-3 gap-6 mt-12">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
              <div className="text-3xl mb-3">📊</div>
              <h3 className="text-lg font-semibold text-white mb-2">Smart Compression</h3>
              <p className="text-gray-400">Advanced algorithms reduce file size by 30-70% without quality loss.</p>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
              <div className="text-3xl mb-3">⚡</div>
              <h3 className="text-lg font-semibold text-white mb-2">Fast Processing</h3>
              <p className="text-gray-400">Powered by Ghostscript for reliable and efficient compression.</p>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
              <div className="text-3xl mb-3">🎯</div>
              <h3 className="text-lg font-semibold text-white mb-2">Quality Control</h3>
              <p className="text-gray-400">Choose from 4 quality levels to balance size and readability.</p>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mb-4">
            <button 
              onClick={handleBackToUpload}
              className="text-red-400 hover:text-red-300 flex items-center gap-2"
            >
              ← Back to Upload
            </button>
          </div>

          <PDFControls
            quality={quality}
            onQualityChange={setQuality}
            onCompress={compressPDF}
            isCompressing={isCompressing}
            progress={progress}
            phase={phase}
          />

          <PDFPreview
            originalFile={originalFile}
            compressedUrl={compressedUrl}
            originalSize={originalSize}
            compressedSize={compressedSize}
            onDownload={handleDownload}
          />
        </>
      )}
    </main>
  )
}