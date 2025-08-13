import { spawn, ChildProcess } from 'child_process'
import { Readable, PassThrough } from 'stream'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { writeFileSync, unlinkSync, readFileSync } from 'fs'
import { s3Client } from './aws-services'
import { Job, JobStatus, S3Location } from './job-service'
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

export class StreamingConversionServiceFixed {
  private readonly DEFAULT_TIMEOUT_MS = 300000 // 5 minutes
  private client: S3Client
  private activeProcesses = new Map<string, ChildProcess>()

  constructor(client?: S3Client) {
    this.client = client || s3Client
  }

  /**
   * Convert audio using a working streaming approach with 3-phase progress
   */
  async convertAudio(job: Job, options: ConversionOptions): Promise<ConversionResult> {
    const startTime = Date.now()
    console.log(`[StreamingFixed] Starting 3-phase conversion for job ${job.jobId}`)

    // Phase 1: Initial upload is already complete (handled by upload API)
    // Phase 2: Start conversion phase
    await progressService.startConversionPhase(job.jobId)

    // Check format compatibility
    const inputFormat = this.extractFormatFromKey(job.inputS3Location.key)
    const compatibility = progressService.checkStreamingCompatibility(inputFormat, options.format)

    if (!compatibility.supportsStreaming) {
      console.log(`[StreamingFixed] Format not compatible with streaming, using fallback`)
      return this.fallbackFileConversion(job, options)
    }

    try {
      // Try streaming conversion
      const result = await this.performStreamingConversion(job, options)
      result.processingTimeMs = Date.now() - startTime
      return result
    } catch (error) {
      console.error(`[StreamingFixed] Streaming failed, using fallback:`, error)
      const fallbackResult = await this.fallbackFileConversion(job, options)
      fallbackResult.processingTimeMs = Date.now() - startTime
      return fallbackResult
    }
  }

  /**
   * Perform the actual streaming conversion with proper stream handling
   */
  private async performStreamingConversion(job: Job, options: ConversionOptions): Promise<ConversionResult> {
    const outputKey = `conversions/${job.jobId}.${options.format}`
    
    console.log(`[StreamingFixed] Starting streaming conversion: ${job.inputS3Location.key} -> ${outputKey}`)

    // Check file size and use appropriate strategy
    const fileSizeMB = job.inputS3Location.size / (1024 * 1024)
    console.log(`[StreamingFixed] File size: ${fileSizeMB.toFixed(2)} MB`)

    if (fileSizeMB > 100) {
      console.log(`[StreamingFixed] Large file detected (${fileSizeMB.toFixed(2)} MB), using fallback conversion`)
      return this.fallbackFileConversion(job, options)
    }

    return new Promise(async (resolve, reject) => {
      try {
        // Download the entire file first (this is more reliable than streaming for now)
        console.log(`[StreamingFixed] Downloading file from S3...`)
        
        // Set a more generous timeout for large file downloads
        const downloadTimeout = Math.max(60000, fileSizeMB * 2000) // 2 seconds per MB, min 60s
        console.log(`[StreamingFixed] Download timeout set to ${downloadTimeout}ms`)

        let inputResponse: any
        try {
          const downloadPromise = this.client.send(new GetObjectCommand({
            Bucket: job.inputS3Location.bucket,
            Key: job.inputS3Location.key
          }))

          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Download timeout after ${downloadTimeout}ms`)), downloadTimeout)
          })

          inputResponse = await Promise.race([downloadPromise, timeoutPromise])
          
          if (!inputResponse.Body) {
            throw new Error('Failed to get S3 object body')
          }
          
          console.log(`[StreamingFixed] S3 download initiated successfully`)
        } catch (downloadError) {
          console.error(`[StreamingFixed] S3 download failed:`, downloadError)
          throw new Error(`Failed to download file from S3: ${downloadError instanceof Error ? downloadError.message : 'Unknown error'}`)
        }

        // Convert stream to buffer with progress tracking and timeout
        let inputBuffer: Buffer
        try {
          console.log(`[StreamingFixed] Starting stream to buffer conversion...`)
          inputBuffer = await this.streamToBufferWithProgress(inputResponse.Body as Readable, job.jobId, job.inputS3Location.size)
          console.log(`[StreamingFixed] Downloaded ${inputBuffer.length} bytes successfully`)
          
          if (inputBuffer.length === 0) {
            throw new Error('Downloaded file is empty')
          }
          
          if (inputBuffer.length !== job.inputS3Location.size) {
            console.warn(`[StreamingFixed] Size mismatch: expected ${job.inputS3Location.size}, got ${inputBuffer.length}`)
          }
        } catch (bufferError) {
          console.error(`[StreamingFixed] Stream to buffer conversion failed:`, bufferError)
          throw new Error(`Failed to download file content: ${bufferError instanceof Error ? bufferError.message : 'Unknown error'}`)
        }

        // Update progress
        await progressService.setProgress(job.jobId, {
          jobId: job.jobId,
          progress: 25,
          stage: 'starting FFmpeg conversion'
        })

        // Create FFmpeg process
        const ffmpegProcess = this.createFFmpegProcess(job.jobId, options)
        
        // Set up progress monitoring
        const processInfo = progressService.createFFmpegProcessInfo(
          ffmpegProcess.pid!,
          this.extractFormatFromKey(job.inputS3Location.key),
          options.format,
          true
        )

        this.setupProgressMonitoring(job.jobId, ffmpegProcess, processInfo)

        // Collect output
        const outputChunks: Buffer[] = []
        let ffmpegExited = false
        let exitCode: number | null = null

        // Handle FFmpeg stdout (converted audio data)
        ffmpegProcess.stdout!.on('data', (chunk: Buffer) => {
          outputChunks.push(chunk)
        })

        // Handle FFmpeg process exit
        ffmpegProcess.on('exit', async (code, signal) => {
          ffmpegExited = true
          exitCode = code
          const processingTime = Date.now() - processInfo.startTime
          
          console.log(`[StreamingFixed] 🏁 FFmpeg process completed for job ${job.jobId}`)
          console.log(`[StreamingFixed] 📊 Exit code: ${code}, Signal: ${signal}`)
          console.log(`[StreamingFixed] ⏱️  Total processing time: ${(processingTime / 1000).toFixed(1)}s`)

          if (code === 0) {
            try {
              console.log(`[StreamingFixed] ✅ Conversion completed, starting Phase 3: S3 Upload`)
              
              // Combine output chunks
              const outputBuffer = Buffer.concat(outputChunks)
              console.log(`[StreamingFixed] 📦 Generated output buffer: ${outputBuffer.length} bytes (${(outputBuffer.length / 1024 / 1024).toFixed(2)} MB)`)
              
              if (outputBuffer.length === 0) {
                throw new Error('FFmpeg produced no output data')
              }

              // Phase 3: Start S3 upload phase
              console.log(`[StreamingFixed] 📤 Starting Phase 3: S3 Upload`)
              await progressService.startS3UploadPhase(job.jobId)

              // Write to temporary file for S3 upload service
              const tempFilePath = `/tmp/${job.jobId}.${options.format}`
              writeFileSync(tempFilePath, outputBuffer)
              console.log(`[StreamingFixed] 💾 Temporary file written: ${tempFilePath}`)

              // Upload using S3 upload service with progress tracking
              const uploadResult = await s3UploadService.uploadWithProgress({
                bucket: job.inputS3Location.bucket,
                key: outputKey,
                filePath: tempFilePath,
                jobId: job.jobId,
                contentType: this.getContentTypeFromKey(outputKey)
              })

              // Cleanup temporary file
              try {
                unlinkSync(tempFilePath)
                console.log(`[StreamingFixed] 🗑️  Temporary file cleaned up: ${tempFilePath}`)
              } catch (cleanupError) {
                console.warn(`[StreamingFixed] Failed to cleanup temp file:`, cleanupError)
              }

              console.log(`[StreamingFixed] ✅ S3 upload completed: ${uploadResult.location}`)

              // Mark complete
              console.log(`[StreamingFixed] 🎯 Marking job ${job.jobId} as complete...`)
              await progressService.markComplete(job.jobId)
              console.log(`[StreamingFixed] ✅ Job ${job.jobId} marked as complete - ready for download!`)

              resolve({
                success: true,
                outputS3Location: {
                  bucket: uploadResult.bucket,
                  key: uploadResult.key,
                  size: uploadResult.size
                },
                fallbackUsed: false,
                processingTimeMs: 0 // Will be set by caller
              })
            } catch (uploadError) {
              console.error(`[StreamingFixed] Phase 3 (S3 Upload) failed:`, uploadError)
              await progressService.markFailed(job.jobId, `S3 upload failed: ${uploadError}`)
              resolve({
                success: false,
                error: `S3 upload failed: ${uploadError}`,
                fallbackUsed: false,
                processingTimeMs: 0
              })
            }
          } else {
            const errorMsg = `FFmpeg failed with exit code ${code}`
            console.error(`[StreamingFixed] ${errorMsg}`)
            await progressService.markFailed(job.jobId, errorMsg)
            resolve({
              success: false,
              error: errorMsg,
              fallbackUsed: false,
              processingTimeMs: 0
            })
          }

          // Cleanup
          this.activeProcesses.delete(job.jobId)
        })

        // Handle FFmpeg process error
        ffmpegProcess.on('error', async (error) => {
          console.error(`[StreamingFixed] FFmpeg process error:`, error)
          await progressService.markFailed(job.jobId, `Process error: ${error.message}`)
          resolve({
            success: false,
            error: `Process error: ${error.message}`,
            fallbackUsed: false,
            processingTimeMs: 0
          })
          this.activeProcesses.delete(job.jobId)
        })

        // Set timeout
        const timeoutHandle = setTimeout(() => {
          console.warn(`[StreamingFixed] Conversion timeout for job ${job.jobId}`)
          this.terminateProcess(job.jobId, ffmpegProcess)
          resolve({
            success: false,
            error: 'Conversion timed out',
            fallbackUsed: false,
            processingTimeMs: 0
          })
        }, options.timeout || this.DEFAULT_TIMEOUT_MS)

        // Send input data to FFmpeg
        console.log(`[StreamingFixed] Sending ${inputBuffer.length} bytes to FFmpeg`)
        ffmpegProcess.stdin!.write(inputBuffer)
        ffmpegProcess.stdin!.end()

        // Clear timeout when process exits
        ffmpegProcess.on('exit', () => {
          clearTimeout(timeoutHandle)
        })

      } catch (error) {
        console.error(`[StreamingFixed] Setup error:`, error)
        reject(error)
      }
    })
  }

  /**
   * Fallback file-based conversion with 3-phase progress
   */
  private async fallbackFileConversion(job: Job, options: ConversionOptions): Promise<ConversionResult> {
    const outputKey = `conversions/${job.jobId}.${options.format}`
    
    console.log(`[StreamingFixed] Using fallback file-based conversion with 3-phase progress`)

    try {
      // Phase 2: Conversion (already started in main method)
      console.log(`[StreamingFixed] Phase 2: Starting fallback conversion`)

      // Download file
      const inputResponse = await this.client.send(new GetObjectCommand({
        Bucket: job.inputS3Location.bucket,
        Key: job.inputS3Location.key
      }))

      if (!inputResponse.Body) {
        throw new Error('Failed to download input file')
      }

      const inputBuffer = await this.streamToBuffer(inputResponse.Body as Readable)

      // Update progress during conversion
      await progressService.setProgress(job.jobId, {
        jobId: job.jobId,
        progress: 30,
        stage: 'starting file-based conversion',
        phase: 'conversion'
      })

      // Write input to temporary file
      const inputTempPath = `/tmp/${job.jobId}_input.${this.extractFormatFromKey(job.inputS3Location.key)}`
      const outputTempPath = `/tmp/${job.jobId}_output.${options.format}`
      
      writeFileSync(inputTempPath, inputBuffer)
      console.log(`[StreamingFixed] Input file written to: ${inputTempPath}`)

      // Create FFmpeg process for file-based conversion
      const ffmpegArgs = [
        '-i', inputTempPath,
        '-f', options.format,
        '-b:a', options.quality,
        '-y',
        outputTempPath
      ]

      console.log(`[StreamingFixed] Starting file-based FFmpeg: ffmpeg ${ffmpegArgs.join(' ')}`)

      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      // Set up progress monitoring for file-based conversion
      const processInfo = progressService.createFFmpegProcessInfo(
        ffmpegProcess.pid!,
        this.extractFormatFromKey(job.inputS3Location.key),
        options.format,
        false // file-based, not streaming
      )

      this.setupProgressMonitoring(job.jobId, ffmpegProcess, processInfo)

      // Wait for FFmpeg to complete
      const conversionResult = await new Promise<Buffer>((resolve, reject) => {
        ffmpegProcess.on('exit', (code) => {
          if (code === 0) {
            try {
              const outputBuffer = readFileSync(outputTempPath)
              console.log(`[StreamingFixed] File-based conversion completed, output size: ${outputBuffer.length} bytes`)
              
              // Cleanup temp files
              try {
                unlinkSync(inputTempPath)
                unlinkSync(outputTempPath)
              } catch (cleanupError) {
                console.warn(`[StreamingFixed] Failed to cleanup temp files:`, cleanupError)
              }
              
              resolve(outputBuffer)
            } catch (error) {
              reject(new Error(`Failed to read output file: ${error}`))
            }
          } else {
            reject(new Error(`FFmpeg failed with exit code ${code}`))
          }
        })

        ffmpegProcess.on('error', (error) => {
          reject(new Error(`FFmpeg process error: ${error.message}`))
        })
      })

      const mockOutput = conversionResult

      console.log(`[StreamingFixed] Phase 2 completed, starting Phase 3: S3 Upload`)

      // Phase 3: Start S3 upload phase
      await progressService.startS3UploadPhase(job.jobId)

      // Write to temporary file for S3 upload service
      const tempFilePath = `/tmp/${job.jobId}.${options.format}`
      writeFileSync(tempFilePath, mockOutput)

      // Upload using S3 upload service with progress tracking
      const uploadResult = await s3UploadService.uploadWithProgress({
        bucket: job.inputS3Location.bucket,
        key: outputKey,
        filePath: tempFilePath,
        jobId: job.jobId,
        contentType: this.getContentTypeFromKey(outputKey)
      })

      // Cleanup temporary file
      try {
        unlinkSync(tempFilePath)
      } catch (cleanupError) {
        console.warn(`[StreamingFixed] Failed to cleanup temp file:`, cleanupError)
      }

      await progressService.markComplete(job.jobId)

      return {
        success: true,
        outputS3Location: {
          bucket: uploadResult.bucket,
          key: uploadResult.key,
          size: uploadResult.size
        },
        fallbackUsed: true,
        processingTimeMs: 0
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Fallback conversion failed'
      await progressService.markFailed(job.jobId, errorMsg)
      return {
        success: false,
        error: errorMsg,
        fallbackUsed: true,
        processingTimeMs: 0
      }
    }
  }

  /**
   * Create FFmpeg process with proper arguments
   */
  private createFFmpegProcess(jobId: string, options: ConversionOptions): ChildProcess {
    const args = [
      '-i', 'pipe:0',           // Read from stdin
      '-f', options.format,     // Output format
      '-b:a', options.quality,  // Audio bitrate
      '-y',                     // Overwrite output
      'pipe:1'                  // Write to stdout
    ]

    console.log(`[StreamingFixed] Starting FFmpeg: ffmpeg ${args.join(' ')}`)

    const ffmpegProcess = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    if (!ffmpegProcess.pid) {
      throw new Error('Failed to start FFmpeg process')
    }

    this.activeProcesses.set(jobId, ffmpegProcess)
    console.log(`[StreamingFixed] FFmpeg started with PID ${ffmpegProcess.pid}`)

    return ffmpegProcess
  }

  /**
   * Set up progress monitoring
   */
  private setupProgressMonitoring(jobId: string, ffmpegProcess: ChildProcess, processInfo: FFmpegProcessInfo): void {
    if (!ffmpegProcess.stderr) return

    console.log(`[StreamingFixed] 📊 Setting up FFmpeg progress monitoring for job ${jobId}`)
    console.log(`[StreamingFixed] 🔍 FFmpeg logs will be captured and stored for debugging`)

    ffmpegProcess.stderr.on('data', (data: Buffer) => {
      const stderrLine = data.toString()
      const lines = stderrLine.split('\n')
      
      for (const line of lines) {
        if (line.trim()) {
          // Log all FFmpeg output to console for immediate debugging
          console.log(`[StreamingFixed] 🎬 FFmpeg: ${line.trim()}`)
          
          // Log specific FFmpeg finalization messages with extra emphasis
          if (line.includes('Finishing') || line.includes('Finalizing') || line.includes('Writing trailer')) {
            console.log(`[StreamingFixed] 🔧 FFmpeg finalization: ${line.trim()}`)
          }
          
          // Log progress lines with extra detail
          if (line.includes('time=') && line.includes('bitrate=')) {
            console.log(`[StreamingFixed] ⏱️  FFmpeg progress: ${line.trim()}`)
          }
          
          // Log duration detection
          if (line.includes('Duration:')) {
            console.log(`[StreamingFixed] 📏 FFmpeg duration detected: ${line.trim()}`)
          }
          
          // Log stream information
          if (line.includes('Stream #')) {
            console.log(`[StreamingFixed] 🎵 FFmpeg stream info: ${line.trim()}`)
          }
          
          // Process the line for progress tracking and log storage
          progressService.processFFmpegStderr(jobId, line, processInfo)
            .catch(error => {
              console.error(`[StreamingFixed] Progress error:`, error)
            })
        }
      }
    })

    // Also log when stderr closes
    ffmpegProcess.stderr.on('close', () => {
      console.log(`[StreamingFixed] 📝 FFmpeg stderr stream closed for job ${jobId}`)
    })

    ffmpegProcess.stderr.on('error', (error) => {
      console.error(`[StreamingFixed] ❌ FFmpeg stderr error for job ${jobId}:`, error)
    })
  }

  /**
   * Convert stream to buffer
   */
  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = []
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
      stream.on('error', reject)
    })
  }

  /**
   * Convert stream to buffer with progress tracking for large files
   */
  private async streamToBufferWithProgress(stream: Readable, jobId: string, totalSize: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    let downloadedSize = 0
    let lastProgressUpdate = 0
    
    return new Promise((resolve, reject) => {
      let isResolved = false
      
      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout)
        }
        if (progressInterval) {
          clearInterval(progressInterval)
        }
      }
      
      stream.on('data', async (chunk) => {
        if (isResolved) return
        
        chunks.push(chunk)
        downloadedSize += chunk.length
        
        // Update progress every 5MB or when significant progress is made
        const progressThreshold = Math.min(5 * 1024 * 1024, totalSize * 0.05)
        if (downloadedSize - lastProgressUpdate >= progressThreshold) {
          lastProgressUpdate = downloadedSize
          const downloadProgress = Math.min(20, Math.floor((downloadedSize / totalSize) * 20)) // 0-20% for download
          try {
            await progressService.setProgress(jobId, {
              jobId,
              progress: downloadProgress,
              stage: `downloading (${(downloadedSize / 1024 / 1024).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB)`,
              phase: 'conversion'
            })
            console.log(`[StreamingFixed] Download progress: ${downloadProgress}% (${(downloadedSize / 1024 / 1024).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB)`)
          } catch (error) {
            console.error(`[StreamingFixed] Progress update error:`, error)
          }
        }
      })
      
      stream.on('end', () => {
        if (isResolved) return
        isResolved = true
        cleanup()
        console.log(`[StreamingFixed] Download stream ended: ${downloadedSize} bytes`)
        resolve(Buffer.concat(chunks))
      })
      
      stream.on('error', (error) => {
        if (isResolved) return
        isResolved = true
        cleanup()
        console.error(`[StreamingFixed] Download stream error:`, error)
        reject(error)
      })
      
      // Set a generous timeout for large files
      const timeoutMs = Math.max(300000, totalSize / 1024 / 1024 * 5000) // 5 seconds per MB, min 5 minutes
      console.log(`[StreamingFixed] Setting download stream timeout to ${(timeoutMs / 60000).toFixed(1)} minutes`)
      
      const timeout = setTimeout(() => {
        if (isResolved) return
        isResolved = true
        cleanup()
        console.error(`[StreamingFixed] Download stream timeout after ${(timeoutMs / 60000).toFixed(1)} minutes`)
        reject(new Error(`Download stream timeout after ${(timeoutMs / 60000).toFixed(1)} minutes`))
      }, timeoutMs)
      
      // Progress heartbeat to show we're still downloading
      const progressInterval = setInterval(async () => {
        if (isResolved) return
        
        try {
          const downloadProgress = Math.min(20, Math.floor((downloadedSize / totalSize) * 20))
          await progressService.setProgress(jobId, {
            jobId,
            progress: downloadProgress,
            stage: `downloading (${(downloadedSize / 1024 / 1024).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB)`,
            phase: 'conversion'
          })
        } catch (error) {
          console.error(`[StreamingFixed] Progress heartbeat error:`, error)
        }
      }, 10000) // Update every 10 seconds
    })
  }

  /**
   * Terminate process
   */
  private terminateProcess(jobId: string, ffmpegProcess: ChildProcess): void {
    console.log(`[StreamingFixed] Terminating process for job ${jobId}`)
    
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
      console.error(`[StreamingFixed] Error terminating process:`, error)
    }

    this.activeProcesses.delete(jobId)
  }

  /**
   * Extract format from S3 key
   */
  private extractFormatFromKey(key: string): string {
    const extension = key.split('.').pop()?.toLowerCase()
    return extension || 'unknown'
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
   * Get active processes
   */
  getActiveProcesses(): Map<string, ChildProcess> {
    return new Map(this.activeProcesses)
  }

  /**
   * Cleanup all processes
   */
  async cleanup(): Promise<void> {
    console.log(`[StreamingFixed] Cleaning up ${this.activeProcesses.size} processes`)
    
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

export const streamingConversionServiceFixed = new StreamingConversionServiceFixed()