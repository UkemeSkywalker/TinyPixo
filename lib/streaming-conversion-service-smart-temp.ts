import { spawn, ChildProcess } from 'child_process'
import { Readable } from 'stream'
import { createWriteStream } from 'fs'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { unlinkSync, statSync } from 'fs'
import { pipeline } from 'stream/promises'
import { s3Client } from './aws-services'
import { Job, S3Location } from './job-service'
import { progressService } from './progress-service'
import { s3UploadService } from './s3-upload-service'
import { FFmpegProcessInfo } from './ffmpeg-progress-parser'

export interface ConversionOptions {
  format: string
  quality: string
  timeout?: number
}

export interface ConversionResult {
  success: boolean
  outputS3Location?: S3Location
  error?: string
  fallbackUsed: boolean
  processingTimeMs: number
}

export class SmartTempFilesConversionService {
  private readonly DEFAULT_TIMEOUT_MS = 600000 // 10 minutes for large files
  private client: S3Client
  private activeProcesses = new Map<string, ChildProcess>()

  constructor(client?: S3Client) {
    this.client = client || s3Client
  }

  /**
   * Convert audio using smart temporary files (no memory buffers)
   */
  async convertAudio(job: Job, options: ConversionOptions): Promise<ConversionResult> {
    const startTime = Date.now()
    const fileSizeMB = job.inputS3Location.size / (1024 * 1024)
    
    console.log(`[SmartTempFiles] Starting conversion for ${fileSizeMB.toFixed(1)}MB file: ${job.jobId}`)

    // Phase 2: Start conversion phase
    await progressService.startConversionPhase(job.jobId)

    const tempInputPath = `/tmp/${job.jobId}-input.${this.getFileExtension(job.inputS3Location.key)}`
    const tempOutputPath = `/tmp/${job.jobId}-output.${options.format}`
    const outputKey = `conversions/${job.jobId}.${options.format}`

    try {
      // Phase 2.1: Stream S3 file to temporary file (no memory buffer)
      console.log(`[SmartTempFiles] Phase 2.1: Downloading S3 file to temp storage`)
      await this.streamS3ToTempFile(job.inputS3Location, tempInputPath, job.jobId)
      
      // Phase 2.2: FFmpeg conversion using temporary files
      console.log(`[SmartTempFiles] Phase 2.2: Converting with FFmpeg`)
      await this.convertWithFFmpeg(tempInputPath, tempOutputPath, job.jobId, options)
      
      // Phase 3: Stream temporary file to S3 (no memory buffer)
      console.log(`[SmartTempFiles] Phase 3: Uploading converted file to S3`)
      await progressService.startS3UploadPhase(job.jobId)
      await this.streamTempFileToS3(tempOutputPath, outputKey, job.inputS3Location.bucket, job.jobId)
      
      // Get final file size
      const outputStats = statSync(tempOutputPath)
      
      // Mark as complete
      await progressService.markComplete(job.jobId)
      
      // Cleanup temp files
      this.cleanupTempFiles([tempInputPath, tempOutputPath])
      
      const processingTime = Date.now() - startTime
      console.log(`[SmartTempFiles] Conversion completed successfully in ${processingTime}ms`)
      
      return {
        success: true,
        outputS3Location: {
          bucket: job.inputS3Location.bucket,
          key: outputKey,
          size: outputStats.size
        },
        fallbackUsed: false,
        processingTimeMs: processingTime
      }

    } catch (error) {
      console.error(`[SmartTempFiles] Conversion failed:`, error)
      
      // Cleanup temp files on error
      this.cleanupTempFiles([tempInputPath, tempOutputPath])
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown conversion error'
      await progressService.markFailed(job.jobId, errorMessage)
      
      return {
        success: false,
        error: errorMessage,
        fallbackUsed: false,
        processingTimeMs: Date.now() - startTime
      }
    }
  }

  /**
   * Stream S3 file to temporary file (no memory buffer)
   */
  private async streamS3ToTempFile(s3Location: S3Location, tempFilePath: string, jobId: string): Promise<void> {
    console.log(`[SmartTempFiles] Streaming S3 to temp: ${s3Location.key} -> ${tempFilePath}`)
    
    try {
      // Get S3 object stream
      const response = await this.client.send(new GetObjectCommand({
        Bucket: s3Location.bucket,
        Key: s3Location.key
      }))

      if (!response.Body) {
        throw new Error('Failed to get S3 object body')
      }

      // Create write stream to temp file
      const writeStream = createWriteStream(tempFilePath)
      
      // Track download progress
      let downloadedBytes = 0
      const totalBytes = s3Location.size
      
      const inputStream = response.Body as Readable
      inputStream.on('data', async (chunk) => {
        downloadedBytes += chunk.length
        
        // Update progress every 5MB or 10% of file
        const progressThreshold = Math.min(5 * 1024 * 1024, totalBytes * 0.1)
        if (downloadedBytes % Math.floor(progressThreshold) < chunk.length) {
          const downloadProgress = Math.min(20, Math.floor((downloadedBytes / totalBytes) * 20))
          try {
            await progressService.setProgress(jobId, {
              jobId,
              progress: downloadProgress,
              stage: `downloading for conversion (${this.formatBytes(downloadedBytes)} / ${this.formatBytes(totalBytes)})`,
              phase: 'conversion'
            })
          } catch (error) {
            console.error(`[SmartTempFiles] Progress update error:`, error)
          }
        }
      })

      // Stream S3 -> temp file (no memory buffer)
      await pipeline(inputStream, writeStream)
      
      console.log(`[SmartTempFiles] S3 to temp file completed: ${this.formatBytes(downloadedBytes)}`)
    } catch (error) {
      console.error(`[SmartTempFiles] S3 to temp file failed:`, error)
      throw new Error(`Failed to download S3 file: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Convert audio using FFmpeg with temporary files
   */
  private async convertWithFFmpeg(inputPath: string, outputPath: string, jobId: string, options: ConversionOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      // Create FFmpeg process for file-to-file conversion
      const ffmpegProcess = this.createFFmpegProcessForFiles(inputPath, outputPath, options)
      
      // Set up progress monitoring
      const processInfo = progressService.createFFmpegProcessInfo(
        ffmpegProcess.pid!,
        this.getFileExtension(inputPath),
        options.format,
        false // File-based conversion
      )

      this.setupProgressMonitoring(jobId, ffmpegProcess, processInfo)
      
      let conversionCompleted = false

      ffmpegProcess.on('exit', (code, signal) => {
        if (conversionCompleted) return
        conversionCompleted = true
        
        console.log(`[SmartTempFiles] FFmpeg exited with code ${code}, signal ${signal}`)
        
        if (code === 0) {
          console.log(`[SmartTempFiles] FFmpeg conversion completed successfully`)
          resolve()
        } else {
          const errorMsg = `FFmpeg failed with exit code ${code}`
          console.error(`[SmartTempFiles] ${errorMsg}`)
          reject(new Error(errorMsg))
        }
        
        this.activeProcesses.delete(jobId)
      })

      ffmpegProcess.on('error', (error) => {
        if (conversionCompleted) return
        conversionCompleted = true
        
        console.error(`[SmartTempFiles] FFmpeg process error:`, error)
        reject(new Error(`FFmpeg process error: ${error.message}`))
        this.activeProcesses.delete(jobId)
      })

      // Set timeout
      const timeout = setTimeout(() => {
        if (!conversionCompleted) {
          console.warn(`[SmartTempFiles] FFmpeg timeout for job ${jobId}`)
          this.terminateProcess(jobId, ffmpegProcess)
          reject(new Error('FFmpeg conversion timed out'))
        }
      }, options.timeout || this.DEFAULT_TIMEOUT_MS)

      ffmpegProcess.on('exit', () => clearTimeout(timeout))
    })
  }

  /**
   * Create FFmpeg process for file-to-file conversion
   */
  private createFFmpegProcessForFiles(inputPath: string, outputPath: string, options: ConversionOptions): ChildProcess {
    const args = [
      '-i', inputPath,          // Input file
      '-f', options.format,     // Output format
      '-b:a', options.quality,  // Audio bitrate
      '-y',                     // Overwrite output
      outputPath                // Output file
    ]

    console.log(`[SmartTempFiles] Starting FFmpeg: ffmpeg ${args.join(' ')}`)

    const ffmpegProcess = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'] // Only capture stderr for progress
    })

    if (!ffmpegProcess.pid) {
      throw new Error('Failed to start FFmpeg process')
    }

    console.log(`[SmartTempFiles] FFmpeg started with PID ${ffmpegProcess.pid}`)
    return ffmpegProcess
  }

  /**
   * Set up progress monitoring for FFmpeg stderr
   */
  private setupProgressMonitoring(jobId: string, ffmpegProcess: ChildProcess, processInfo: FFmpegProcessInfo): void {
    if (!ffmpegProcess.stderr) return

    console.log(`[SmartTempFiles] Setting up FFmpeg progress monitoring for job ${jobId}`)

    ffmpegProcess.stderr.on('data', (data: Buffer) => {
      const stderrLine = data.toString()
      const lines = stderrLine.split('\n')
      
      for (const line of lines) {
        if (line.trim()) {
          console.log(`[SmartTempFiles] FFmpeg: ${line.trim()}`)
          
          // Process the line for progress tracking
          progressService.processFFmpegStderr(jobId, line, processInfo)
            .catch(error => {
              console.error(`[SmartTempFiles] Progress error:`, error)
            })
        }
      }
    })

    ffmpegProcess.stderr.on('close', () => {
      console.log(`[SmartTempFiles] FFmpeg stderr closed for job ${jobId}`)
    })

    ffmpegProcess.stderr.on('error', (error) => {
      console.error(`[SmartTempFiles] FFmpeg stderr error for job ${jobId}:`, error)
    })
  }

  /**
   * Stream temporary file to S3 (no memory buffer)
   */
  private async streamTempFileToS3(tempFilePath: string, outputKey: string, bucket: string, jobId: string): Promise<void> {
    console.log(`[SmartTempFiles] Streaming temp file to S3: ${tempFilePath} -> ${outputKey}`)
    
    try {
      // Use S3 upload service with streaming (no memory buffer)
      await s3UploadService.uploadWithProgress({
        bucket,
        key: outputKey,
        filePath: tempFilePath,
        jobId,
        contentType: this.getContentTypeFromKey(outputKey)
      })
      
      console.log(`[SmartTempFiles] Temp file to S3 upload completed`)
    } catch (error) {
      console.error(`[SmartTempFiles] Temp file to S3 upload failed:`, error)
      throw new Error(`Failed to upload converted file: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get file extension from path or S3 key
   */
  private getFileExtension(key: string): string {
    const parts = key.split('.')
    return parts.length > 1 ? parts[parts.length - 1] : 'unknown'
  }

  /**
   * Get content type from key
   */
  private getContentTypeFromKey(key: string): string {
    const extension = key.split('.').pop()?.toLowerCase()
    
    const contentTypes: Record<string, string> = {
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'aac': 'audio/aac',
      'ogg': 'audio/ogg',
      'flac': 'audio/flac',
      'm4a': 'audio/mp4'
    }

    return contentTypes[extension || ''] || 'application/octet-stream'
  }



  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  /**
   * Clean up temporary files
   */
  private cleanupTempFiles(tempPaths: string[]): void {
    for (const tempPath of tempPaths) {
      try {
        unlinkSync(tempPath)
        console.log(`[SmartTempFiles] Cleaned up temp file: ${tempPath}`)
      } catch (error) {
        console.warn(`[SmartTempFiles] Failed to cleanup temp file ${tempPath}:`, error)
      }
    }
  }

  /**
   * Terminate FFmpeg process
   */
  private terminateProcess(jobId: string, ffmpegProcess: ChildProcess): void {
    console.log(`[SmartTempFiles] Terminating FFmpeg process for job ${jobId}`)
    
    try {
      if (ffmpegProcess.pid && !ffmpegProcess.killed) {
        ffmpegProcess.kill('SIGTERM')
        setTimeout(() => {
          if (!ffmpegProcess.killed) {
            ffmpegProcess.kill('SIGKILL')
          }
        }, 5000)
      }
    } catch (error) {
      console.error(`[SmartTempFiles] Error terminating process:`, error)
    }

    this.activeProcesses.delete(jobId)
  }

  /**
   * Get active processes
   */
  getActiveProcesses(): Map<string, ChildProcess> {
    return new Map(this.activeProcesses)
  }

  /**
   * Cleanup all processes
   */
  async cleanup(): Promise<void> {
    console.log(`[SmartTempFiles] Cleaning up ${this.activeProcesses.size} processes`)
    
    const cleanupPromises = Array.from(this.activeProcesses.entries()).map(([jobId, process]) => {
      return new Promise<void>((resolve) => {
        this.terminateProcess(jobId, process)
        setTimeout(resolve, 1000)
      })
    })

    await Promise.all(cleanupPromises)
    this.activeProcesses.clear()
  }
}

// Export singleton instance
export const smartTempFilesConversionService = new SmartTempFilesConversionService()