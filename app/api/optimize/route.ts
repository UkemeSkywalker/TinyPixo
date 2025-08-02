import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

// Global progress tracking
declare global {
  var conversionProgress: { [key: string]: { jobId: string; progress: number; status: string } }
}

global.conversionProgress = global.conversionProgress || {}

// Maximum file size limit (50MB)
const MAX_FILE_SIZE = 50 * 1024 * 1024

// Smart format selection based on image characteristics
async function getBestFormat(sharpInstance: sharp.Sharp, requestedFormat: string): Promise<string> {
  const metadata = await sharpInstance.metadata()

  // If user specifically requested a format, respect it initially
  if (['webp', 'avif', 'jpeg', 'png'].includes(requestedFormat)) {
    return requestedFormat
  }

  // Smart format selection based on image characteristics
  const hasAlpha = metadata.channels === 4 || metadata.hasAlpha
  const isPhoto = metadata.width && metadata.height && (metadata.width * metadata.height) > 100000

  if (hasAlpha) {
    return 'webp' // WebP handles transparency well
  } else if (isPhoto) {
    return 'webp' // WebP is generally best for photos
  } else {
    return 'png' // PNG for graphics/simple images
  }
}

async function optimizeWithAdaptiveQuality(
  sharpInstance: sharp.Sharp,
  format: string,
  targetQuality: number,
  originalSize: number,
  originalBuffer: Buffer,
  jobId?: string
): Promise<Buffer> {
  let bestBuffer: Buffer | null = null
  let bestSize = originalSize
  let currentQuality = targetQuality
  let attempts = 0
  const maxAttempts = 8
  const minQuality = 10

  // Store original format info for fallback
  const metadata = await sharpInstance.metadata()
  const originalFormat = metadata.format

  while (attempts < maxAttempts && currentQuality >= minQuality) {
    attempts++

    if (jobId) {
      global.conversionProgress[jobId] = {
        jobId,
        progress: 70 + (attempts * 3),
        status: `optimizing (attempt ${attempts}, quality ${currentQuality}%)`
      }
    }

    try {
      // Create a fresh Sharp instance for each attempt
      const instance = sharpInstance.clone()
      let outputBuffer: Buffer

      switch (format) {
        case 'webp':
          outputBuffer = await instance.webp({
            quality: currentQuality,
            effort: 6, // Higher effort for better compression
            smartSubsample: true
          }).toBuffer()
          break
        case 'avif':
          outputBuffer = await instance.avif({
            quality: currentQuality,
            effort: 4,
            chromaSubsampling: '4:2:0'
          }).toBuffer()
          break
        case 'jpeg':
          outputBuffer = await instance.jpeg({
            quality: currentQuality,
            progressive: true,
            mozjpeg: true,
            optimiseScans: true,
            trellisQuantisation: true
          }).toBuffer()
          break
        case 'png':
          // PNG compression - use both compressionLevel and palette strategies
          const compressionLevel = Math.max(1, Math.min(9, Math.round((100 - currentQuality) / 11)))
          const useQuantization = currentQuality < 70

          if (useQuantization) {
            // Use quantization for aggressive compression
            outputBuffer = await instance
              .png({
                compressionLevel: 9,
                progressive: true,
                palette: true,
                quality: currentQuality,
                colours: Math.max(16, Math.min(256, Math.round(currentQuality * 2.56)))
              }).toBuffer()
          } else {
            outputBuffer = await instance.png({
              compressionLevel,
              progressive: true
            }).toBuffer()
          }
          break
        default:
          outputBuffer = await instance.webp({
            quality: currentQuality,
            effort: 6
          }).toBuffer()
      }

      // Check if this is the best result so far
      if (outputBuffer.length < bestSize) {
        bestBuffer = outputBuffer
        bestSize = outputBuffer.length

        // If we achieved significant compression, we can stop
        if (outputBuffer.length < originalSize * 0.8) {
          console.log(`Good compression achieved: ${originalSize} -> ${outputBuffer.length} (${((1 - outputBuffer.length / originalSize) * 100).toFixed(1)}% reduction)`)
          return outputBuffer
        }
      }

      // If output is smaller than original, we have a valid result
      if (outputBuffer.length < originalSize) {
        return outputBuffer
      }

      // Reduce quality more aggressively for next attempt
      currentQuality = Math.max(minQuality, currentQuality - 20)

    } catch (error) {
      console.error(`Compression attempt ${attempts} failed:`, error)
      currentQuality = Math.max(minQuality, currentQuality - 25)
    }
  }

  // If we have a best result that's smaller than original, use it
  if (bestBuffer && bestSize < originalSize) {
    console.log(`Using best result: ${originalSize} -> ${bestSize}`)
    return bestBuffer
  }

  // Last resort: try different formats if the requested format isn't working
  if (format !== 'webp' && format !== originalFormat) {
    console.log(`Trying WebP as fallback format`)
    try {
      const fallbackBuffer = await sharpInstance.clone().webp({
        quality: 60,
        effort: 6
      }).toBuffer()

      if (fallbackBuffer.length < originalSize) {
        return fallbackBuffer
      }
    } catch (error) {
      console.error('WebP fallback failed:', error)
    }
  }

  // If original format is different and more efficient, suggest keeping it
  if (originalFormat && originalFormat !== format) {
    console.log(`Trying to keep original format: ${originalFormat}`)
    try {
      let fallbackBuffer: Buffer

      switch (originalFormat) {
        case 'jpeg':
          fallbackBuffer = await sharpInstance.clone().jpeg({
            quality: 70,
            progressive: true,
            mozjpeg: true
          }).toBuffer()
          break
        case 'png':
          fallbackBuffer = await sharpInstance.clone().png({
            compressionLevel: 9,
            progressive: true
          }).toBuffer()
          break
        case 'webp':
          fallbackBuffer = await sharpInstance.clone().webp({
            quality: 70,
            effort: 6
          }).toBuffer()
          break
        default:
          throw new Error('Unsupported original format')
      }

      if (fallbackBuffer.length < originalSize) {
        return fallbackBuffer
      }
    } catch (error) {
      console.error('Original format fallback failed:', error)
    }
  }

  // Absolute last resort: return original if nothing worked
  console.warn(`All compression attempts failed. Original: ${originalSize}, Best attempt: ${bestSize}`)
  throw new Error(`Cannot compress image smaller than original. Try a different format or the image may already be optimally compressed.`)
}

export async function POST(request: NextRequest) {
  // Set timeout for App Runner (max 120 seconds)
  const timeoutId = setTimeout(() => {
    throw new Error('Processing timeout - image too complex')
  }, 110000) // 110 seconds to leave buffer

  try {
    const formData = await request.formData()
    const file = formData.get('image') as File
    const format = formData.get('format') as string
    const quality = parseInt(formData.get('quality') as string)
    const width = formData.get('width') ? parseInt(formData.get('width') as string) : undefined
    const height = formData.get('height') ? parseInt(formData.get('height') as string) : undefined
    const jobId = formData.get('jobId') as string

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // File size validation
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`
      }, { status: 400 })
    }

    // Initialize progress tracking
    if (jobId) {
      global.conversionProgress[jobId] = { jobId, progress: 0, status: 'starting' }
    }

    if (jobId) {
      global.conversionProgress[jobId] = { jobId, progress: 20, status: 'reading file' }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const originalSize = buffer.length

    // Memory usage check for production
    const memUsage = process.memoryUsage()
    if (memUsage.heapUsed > 1.5 * 1024 * 1024 * 1024) { // 1.5GB threshold
      console.warn('High memory usage detected:', memUsage)
      // Force garbage collection if available
      if (global.gc) global.gc()
    }

    if (jobId) {
      global.conversionProgress[jobId] = { jobId, progress: 40, status: 'initializing processor' }
    }

    // Initialize Sharp with production-optimized settings
    let sharpInstance = sharp(buffer, {
      limitInputPixels: 268402689, // ~16k x 16k max
      sequentialRead: true,
      density: 72,
      // Production optimizations
      pages: 1, // Only process first page for multi-page formats
      subifd: -1, // Disable SUBIFD processing for faster performance
    })

    // Get image metadata for validation
    const metadata = await sharpInstance.metadata()

    // Validate image dimensions
    if (metadata.width && metadata.height) {
      const maxDimension = 8000
      if (metadata.width > maxDimension || metadata.height > maxDimension) {
        return NextResponse.json({
          error: `Image dimensions too large. Maximum dimension is ${maxDimension}px`
        }, { status: 400 })
      }
    }

    if (jobId) {
      global.conversionProgress[jobId] = { jobId, progress: 60, status: 'resizing image' }
    }

    // Resize if dimensions provided
    if (width || height) {
      sharpInstance = sharpInstance.resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3 // Better quality for resizing
      })
    }

    // Get the best format for this image
    const bestFormat = await getBestFormat(sharpInstance, format)

    if (jobId) {
      global.conversionProgress[jobId] = {
        jobId,
        progress: 65,
        status: `using ${bestFormat} format for optimal compression`
      }
    }

    // Use adaptive quality optimization
    const outputBuffer = await optimizeWithAdaptiveQuality(
      sharpInstance,
      bestFormat,
      quality,
      originalSize,
      buffer,
      jobId
    )

    if (jobId) {
      global.conversionProgress[jobId] = { jobId, progress: 100, status: 'completed' }
    }

    clearTimeout(timeoutId)

    // Final validation - this should never happen with our new logic
    if (outputBuffer.length >= originalSize) {
      console.error(`CRITICAL: Output size (${outputBuffer.length}) >= original size (${originalSize})`)
      return NextResponse.json({
        error: `Cannot compress image smaller than original (${(originalSize / (1024 * 1024)).toFixed(1)}MB). The image may already be optimally compressed or try a different format.`
      }, { status: 400 })
    }

    const compressionRatio = ((1 - outputBuffer.length / originalSize) * 100).toFixed(1)
    console.log(`Compression successful: ${originalSize} -> ${outputBuffer.length} (${compressionRatio}% reduction)`)

    return new NextResponse(outputBuffer, {
      headers: {
        'Content-Type': `image/${bestFormat}`,
        'Content-Length': outputBuffer.length.toString(),
        'X-Original-Size': originalSize.toString(),
        'X-Compression-Ratio': compressionRatio,
        'X-Format-Used': bestFormat,
      },
    })
  } catch (error) {
    clearTimeout(timeoutId)
    console.error('Image processing error:', error)

    // Update progress on error
    const jobId = (await request.formData().catch(() => new FormData())).get('jobId') as string
    if (jobId) {
      global.conversionProgress[jobId] = { jobId, progress: 0, status: 'error' }
    }

    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Image processing failed'
    }, { status: 500 })
  }
}