try {
  importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js')
  console.log('JSZip loaded successfully')
} catch (error) {
  console.error('Failed to load JSZip:', error)
  self.postMessage({ type: 'ERROR', error: 'Failed to load JSZip library' })
}

let zip = new JSZip()
let fileCount = 0
let totalFiles = 0

const addFileToZip = (data) => {
  const { blob, path } = data
  zip.file(path, blob)
  fileCount++
  
  const progress = Math.floor((fileCount / totalFiles) * 100)
  self.postMessage({
    type: 'PROGRESS',
    progress
  })
}

const finalizeZip = async () => {
  try {
    console.log('Starting ZIP generation...')
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    })
    console.log('ZIP generated successfully, size:', zipBlob.size)
    
    self.postMessage({
      type: 'COMPLETE',
      zipBlob
    })
  } catch (error) {
    console.error('ZIP generation failed:', error)
    self.postMessage({
      type: 'ERROR',
      error: error.message
    })
  }
}

const resetZip = () => {
  zip = new JSZip()
  fileCount = 0
  totalFiles = 0
}

self.onmessage = function(e) {
  const { type, data } = e.data
  console.log('Worker received message:', type)
  
  switch(type) {
    case 'INIT':
      totalFiles = data.totalFiles
      console.log('Initializing ZIP for', totalFiles, 'files')
      resetZip()
      break
    case 'ADD_FILE':
      addFileToZip(data)
      break
    case 'FINALIZE':
      finalizeZip()
      break
    case 'CANCEL':
      resetZip()
      break
  }
}