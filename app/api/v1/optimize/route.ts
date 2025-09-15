import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { promises as fs } from 'fs'
import path from 'path'

interface OptimizeRequest {
  filePath?: string
  folderPath?: string
  outputDir: string
  format: 'webp' | 'avif' | 'jpeg' | 'png'
  quality: number
  width?: number
  height?: number
  preserveStructure?: boolean
  overwrite?: boolean
}

interface OptimizeResult {
  originalPath: string
  outputPath: string
  originalSize: number
  optimizedSize: number
  compressionRatio: string
  format: string
  status: 'success' | 'skipped' | 'error'
}

interface ProcessingError {
  filePath: string
  error: string
  code: string
}

interface OptimizeResponse {
  success: boolean
  processedCount: number
  results: OptimizeResult[]
  errors?: ProcessingError[]
  summary: {
    totalOriginalSize: number
    totalOptimizedSize: number
    totalSavings: number
    compressionRatio: string
  }
}

const MAX_FILE_SIZE = 50 * 1024 * 1024
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif']

async function getBestFormat(sharpInstance: sharp.Sharp, requestedFormat: string): Promise<string> {
  const metadata = await sharpInstance.metadata()
  if (['webp', 'avif', 'jpeg', 'png'].includes(requestedFormat)) {
    return requestedFormat
  }
  const hasAlpha = metadata.channels === 4 || metadata.hasAlpha
  return hasAlpha ? 'webp' : 'webp'
}

async function optimizeWithAdaptiveQuality(
  sharpInstance: sharp.Sharp,
  format: string,
  targetQuality: number,
  originalSize: number
): Promise<Buffer> {
  let currentQuality = targetQuality
  const minQuality = 10
  
  while (currentQuality >= minQuality) {
    try {
      const instance = sharpInstance.clone()
      let outputBuffer: Buffer

      switch (format) {
        case 'webp':
          outputBuffer = await instance.webp({ quality: currentQuality, effort: 6 }).toBuffer()
          break
        case 'avif':
          outputBuffer = await instance.avif({ quality: currentQuality, effort: 4 }).toBuffer()
          break
        case 'jpeg':
          outputBuffer = await instance.jpeg({ quality: currentQuality, progressive: true }).toBuffer()
          break
        case 'png':
          outputBuffer = await instance.png({ compressionLevel: 9 }).toBuffer()
          break
        default:
          outputBuffer = await instance.webp({ quality: currentQuality }).toBuffer()
      }

      if (outputBuffer.length < originalSize) {
        return outputBuffer
      }
      currentQuality -= 20
    } catch (error) {
      currentQuality -= 25
    }
  }
  throw new Error('Cannot compress image smaller than original')
}

function validatePath(filePath: string): boolean {
  return !filePath.includes('..') && path.isAbsolute(filePath)
}

async function scanImageFolder(folderPath: string): Promise<string[]> {
  const files: string[] = []
  
  async function scan(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await scan(fullPath)
      } else if (IMAGE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath)
      }
    }
  }
  
  await scan(folderPath)
  return files
}

async function processImage(
  inputPath: string,
  outputDir: string,
  format: string,
  quality: number,
  width?: number,
  height?: number,
  preserveStructure?: boolean,
  overwrite?: boolean
): Promise<OptimizeResult> {
  try {
    const stats = await fs.stat(inputPath)
    if (stats.size > MAX_FILE_SIZE) {
      return {
        originalPath: inputPath,
        outputPath: '',
        originalSize: stats.size,
        optimizedSize: 0,
        compressionRatio: '0%',
        format,
        status: 'error'
      }
    }

    const buffer = await fs.readFile(inputPath)
    let sharpInstance = sharp(buffer).rotate()

    if (width || height) {
      sharpInstance = sharpInstance.resize(width, height, { fit: 'inside', withoutEnlargement: true })
    }

    const bestFormat = await getBestFormat(sharpInstance, format)
    const outputBuffer = await optimizeWithAdaptiveQuality(sharpInstance, bestFormat, quality, buffer.length)

    let outputPath: string
    if (preserveStructure) {
      const relativePath = path.relative(path.dirname(inputPath), inputPath)
      outputPath = path.join(outputDir, relativePath.replace(path.extname(relativePath), `.${bestFormat}`))
    } else {
      const filename = path.basename(inputPath, path.extname(inputPath))
      outputPath = path.join(outputDir, `${filename}.${bestFormat}`)
    }

    if (!overwrite && await fs.access(outputPath).then(() => true).catch(() => false)) {
      return {
        originalPath: inputPath,
        outputPath,
        originalSize: buffer.length,
        optimizedSize: 0,
        compressionRatio: '0%',
        format: bestFormat,
        status: 'skipped'
      }
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, outputBuffer)

    const compressionRatio = ((1 - outputBuffer.length / buffer.length) * 100).toFixed(1)
    
    return {
      originalPath: inputPath,
      outputPath,
      originalSize: buffer.length,
      optimizedSize: outputBuffer.length,
      compressionRatio: `${compressionRatio}%`,
      format: bestFormat,
      status: 'success'
    }
  } catch (error) {
    return {
      originalPath: inputPath,
      outputPath: '',
      originalSize: 0,
      optimizedSize: 0,
      compressionRatio: '0%',
      format,
      status: 'error'
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: OptimizeRequest = await request.json()
    
    if (!body.outputDir || (!body.filePath && !body.folderPath)) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    if (!validatePath(body.outputDir) || 
        (body.filePath && !validatePath(body.filePath)) ||
        (body.folderPath && !validatePath(body.folderPath))) {
      return NextResponse.json({ error: 'Invalid file paths' }, { status: 400 })
    }

    const results: OptimizeResult[] = []
    const errors: ProcessingError[] = []
    let filesToProcess: string[] = []

    if (body.filePath) {
      filesToProcess = [body.filePath]
    } else if (body.folderPath) {
      filesToProcess = await scanImageFolder(body.folderPath)
    }

    for (const filePath of filesToProcess) {
      try {
        const result = await processImage(
          filePath,
          body.outputDir,
          body.format,
          body.quality,
          body.width,
          body.height,
          body.preserveStructure,
          body.overwrite
        )
        results.push(result)
      } catch (error) {
        errors.push({
          filePath,
          error: error instanceof Error ? error.message : 'Processing failed',
          code: 'PROCESSING_FAILED'
        })
      }
    }

    const successfulResults = results.filter(r => r.status === 'success')
    const totalOriginalSize = successfulResults.reduce((sum, r) => sum + r.originalSize, 0)
    const totalOptimizedSize = successfulResults.reduce((sum, r) => sum + r.optimizedSize, 0)
    const totalSavings = totalOriginalSize - totalOptimizedSize
    const compressionRatio = totalOriginalSize > 0 ? 
      ((totalSavings / totalOriginalSize) * 100).toFixed(1) + '%' : '0%'

    const response: OptimizeResponse = {
      success: errors.length === 0,
      processedCount: successfulResults.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
      summary: {
        totalOriginalSize,
        totalOptimizedSize,
        totalSavings,
        compressionRatio
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'API processing failed'
    }, { status: 500 })
  }
}