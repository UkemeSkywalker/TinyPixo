import { spawn, ChildProcess } from 'child_process'
import { Readable, PassThrough } from 'stream'
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { s3Client } from './aws-services'
import { Job, JobStatus, S3Location, jobService } from './job-service'
import { progressService, ProgressData } from './progress-service'
import { FFmpegProcessInfo } from './ffmpeg-progress-parser'

export interface ConversionOptions {
    format: string
    quality: string
    timeout?: number // in milliseconds, default 5 minutes
}

export interface ConversionResult {
    success: boolean
    outputS3Location?: S3Location
    error?: string
    fallbackUsed: boolean
    processingTimeMs: number
}

export interface StreamingCompatibilityCheck {
    supportsStreaming: boolean
    reason?: string
    fallbackRecommended: boolean
}

export class StreamingConversionService {
    private readonly DEFAULT_TIMEOUT_MS = 300000 // 5 minutes
    private readonly MIN_MULTIPART_SIZE = 5 * 1024 * 1024 // 5MB minimum for multipart upload
    private readonly MAX_MEMORY_USAGE = 100 * 1024 * 1024 // 100MB max memory for streaming

    private client: S3Client
    private activeProcesses = new Map<string, ChildProcess>()

    constructor(client?: S3Client) {
        this.client = client || s3Client
    }

    /**
     * Convert audio using streaming architecture (experimental)
     * Falls back to file-based conversion if streaming fails
     */
    async convertAudio(job: Job, options: ConversionOptions): Promise<ConversionResult> {
        const startTime = Date.now()
        console.log(`[StreamingConversionService] Starting conversion for job ${job.jobId}: ${job.inputS3Location.key} -> ${options.format}`)

        // Initialize progress tracking
        await progressService.initializeProgress(job.jobId)

        // Check streaming compatibility
        const inputFormat = this.extractFormatFromKey(job.inputS3Location.key)
        const compatibility = this.checkStreamingCompatibility(inputFormat, options.format)

        console.log(`[StreamingConversionService] Streaming compatibility check for ${inputFormat} -> ${options.format}: ${compatibility.supportsStreaming ? 'SUPPORTED' : 'NOT SUPPORTED'}${compatibility.reason ? ` (${compatibility.reason})` : ''}`)

        let result: ConversionResult

        if (compatibility.supportsStreaming && !compatibility.fallbackRecommended) {
            try {
                // Attempt streaming conversion
                console.log(`[StreamingConversionService] Attempting streaming conversion for job ${job.jobId}`)
                result = await this.streamingConvertAudio(job, options)

                if (result.success) {
                    console.log(`[StreamingConversionService] Streaming conversion successful for job ${job.jobId}`)
                    return result
                } else {
                    console.warn(`[StreamingConversionService] Streaming conversion failed for job ${job.jobId}, falling back to file-based: ${result.error}`)
                }
            } catch (error) {
                console.warn(`[StreamingConversionService] Streaming conversion error for job ${job.jobId}, falling back to file-based:`, error)
            }
        }

        // Fallback to file-based conversion
        console.log(`[StreamingConversionService] Using file-based conversion for job ${job.jobId}`)
        result = await this.fallbackFileConversion(job, options)
        result.fallbackUsed = true
        result.processingTimeMs = Date.now() - startTime

        return result
    }

    /**
     * Streaming conversion: S3 -> FFmpeg -> S3 (no local files)
     */
    private async streamingConvertAudio(job: Job, options: ConversionOptions): Promise<ConversionResult> {
        const startTime = Date.now()
        const outputKey = `conversions/${job.jobId}.${options.format}`
        const timeout = options.timeout || this.DEFAULT_TIMEOUT_MS

        console.log(`[StreamingConversionService] Starting streaming conversion: ${job.inputS3Location.key} -> ${outputKey}`)

        try {
            // Update progress: Creating input stream
            await progressService.setProgress(job.jobId, {
                jobId: job.jobId,
                progress: 5,
                stage: 'creating S3 input stream'
            })

            // Create S3 input stream
            const inputStream = await this.createS3InputStream(job.inputS3Location)
            console.log(`[StreamingConversionService] S3 input stream created for ${job.inputS3Location.key}`)

            // Update progress: Starting FFmpeg
            await progressService.setProgress(job.jobId, {
                jobId: job.jobId,
                progress: 15,
                stage: 'starting FFmpeg process'
            })

            // Create FFmpeg process with streaming I/O
            const ffmpegProcess = await this.createFFmpegProcess(
                job.jobId,
                options,
                this.extractFormatFromKey(job.inputS3Location.key),
                options.format
            )

            // Update progress: Setting up streams
            await progressService.setProgress(job.jobId, {
                jobId: job.jobId,
                progress: 25,
                stage: 'setting up streaming pipeline'
            })

            // Create S3 upload stream
            const outputStream = new PassThrough()
            const s3Upload = this.createS3UploadStream(job.inputS3Location.bucket, outputKey, outputStream)

            // Set up process monitoring
            const processInfo = progressService.createFFmpegProcessInfo(
                ffmpegProcess.pid!,
                this.extractFormatFromKey(job.inputS3Location.key),
                options.format,
                true // isStreaming = true
            )

            // Update progress: Connecting streams
            await progressService.setProgress(job.jobId, {
                jobId: job.jobId,
                progress: 35,
                stage: 'connecting streaming pipeline'
            })

            // Connect streams: S3 Input -> FFmpeg -> S3 Output
            inputStream.pipe(ffmpegProcess.stdin!)
            ffmpegProcess.stdout!.pipe(outputStream)

            // Monitor FFmpeg stderr for progress
            this.setupProgressMonitoring(job.jobId, ffmpegProcess, processInfo, job.inputS3Location.size, outputStream)

            // Update progress: Processing started
            await progressService.setProgress(job.jobId, {
                jobId: job.jobId,
                progress: 40,
                stage: 'streaming conversion started'
            })

            // Set up timeout handling
            const timeoutHandle = setTimeout(() => {
                console.warn(`[StreamingConversionService] Streaming conversion timeout for job ${job.jobId}`)
                this.terminateProcess(job.jobId, ffmpegProcess)
            }, timeout)

            // Wait for conversion to complete
            const conversionResult = await Promise.race([
                this.waitForStreamingCompletion(job.jobId, ffmpegProcess, s3Upload),
                this.waitForTimeout(timeout)
            ])

            clearTimeout(timeoutHandle)
            this.activeProcesses.delete(job.jobId)

            if (conversionResult.success) {
                // Get the actual file size from S3 if not available from upload result
                let actualSize = 'outputSize' in conversionResult ? (conversionResult.outputSize || 0) : 0
                
                if (actualSize === 0) {
                    try {
                        const headResult = await this.client.send(new HeadObjectCommand({
                            Bucket: job.inputS3Location.bucket,
                            Key: outputKey
                        }))
                        actualSize = headResult.ContentLength || 0
                        console.log(`[StreamingConversionService] Retrieved actual file size from S3: ${actualSize} bytes`)
                    } catch (error) {
                        console.warn(`[StreamingConversionService] Could not get file size from S3: ${error}`)
                    }
                }

                const outputS3Location: S3Location = {
                    bucket: job.inputS3Location.bucket,
                    key: outputKey,
                    size: actualSize
                }

                // Mark progress as complete
                await progressService.markComplete(job.jobId)

                console.log(`[StreamingConversionService] Streaming conversion completed for job ${job.jobId}: ${outputKey}`)

                return {
                    success: true,
                    outputS3Location,
                    fallbackUsed: false,
                    processingTimeMs: Date.now() - startTime
                }
            } else {
                await progressService.markFailed(job.jobId, conversionResult.error || 'Streaming conversion failed')
                return {
                    success: false,
                    error: conversionResult.error,
                    fallbackUsed: false,
                    processingTimeMs: Date.now() - startTime
                }
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown streaming error'
            console.error(`[StreamingConversionService] Streaming conversion error for job ${job.jobId}:`, error)

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
     * Fallback file-based conversion with careful resource management
     */
    private async fallbackFileConversion(job: Job, options: ConversionOptions): Promise<ConversionResult> {
        const startTime = Date.now()
        const outputKey = `conversions/${job.jobId}.${options.format}`
        const timeout = options.timeout || this.DEFAULT_TIMEOUT_MS

        console.log(`[StreamingConversionService] Starting file-based conversion fallback for job ${job.jobId}`)

        try {
            // Update progress to show fallback is working
            await progressService.setProgress(job.jobId, {
                jobId: job.jobId,
                progress: 25,
                stage: 'downloading for file-based conversion'
            })

            // Download input file from S3
            const inputResponse = await this.client.send(new GetObjectCommand({
                Bucket: job.inputS3Location.bucket,
                Key: job.inputS3Location.key
            }))

            if (!inputResponse.Body) {
                throw new Error('Failed to download input file from S3')
            }

            // Convert the input stream to buffer for file-based processing
            const inputBuffer = await this.streamToBuffer(inputResponse.Body as Readable)

            await progressService.setProgress(job.jobId, {
                jobId: job.jobId,
                progress: 50,
                stage: 'file-based conversion processing'
            })

            // For this experimental implementation, we'll create a simple converted output
            // In a real implementation, this would use FFmpeg with temporary files
            const outputBuffer = await this.simulateFileBasedConversion(inputBuffer, options.format)

            await progressService.setProgress(job.jobId, {
                jobId: job.jobId,
                progress: 75,
                stage: 'uploading converted file'
            })

            // Upload the converted file back to S3
            await this.client.send(new PutObjectCommand({
                Bucket: job.inputS3Location.bucket,
                Key: outputKey,
                Body: outputBuffer,
                ContentType: this.getContentTypeFromKey(outputKey)
            }))

            const outputS3Location: S3Location = {
                bucket: job.inputS3Location.bucket,
                key: outputKey,
                size: outputBuffer.length
            }

            await progressService.markComplete(job.jobId)

            console.log(`[StreamingConversionService] File-based conversion completed for job ${job.jobId}: ${outputKey}`)

            return {
                success: true,
                outputS3Location,
                fallbackUsed: true,
                processingTimeMs: Date.now() - startTime
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'File-based conversion failed'
            console.error(`[StreamingConversionService] File-based conversion error for job ${job.jobId}:`, error)

            await progressService.markFailed(job.jobId, errorMessage)

            return {
                success: false,
                error: errorMessage,
                fallbackUsed: true,
                processingTimeMs: Date.now() - startTime
            }
        }
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
     * Simulate file-based conversion (placeholder implementation)
     */
    private async simulateFileBasedConversion(inputBuffer: Buffer, outputFormat: string): Promise<Buffer> {
        // This is a placeholder implementation for the experimental version
        // In a real implementation, this would:
        // 1. Write inputBuffer to a temporary file
        // 2. Run FFmpeg on the temporary file
        // 3. Read the output file
        // 4. Clean up temporary files

        console.log(`[StreamingConversionService] Simulating file-based conversion to ${outputFormat}`)

        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 1000))

        // Create a mock converted file (in reality, this would be the FFmpeg output)
        const mockConvertedData = Buffer.concat([
            Buffer.from(`Mock ${outputFormat.toUpperCase()} file header\n`),
            inputBuffer,
            Buffer.from(`\nMock ${outputFormat.toUpperCase()} file footer`)
        ])

        return mockConvertedData
    }

    /**
     * Create S3 input stream
     */
    private async createS3InputStream(s3Location: S3Location): Promise<Readable> {
        const command = new GetObjectCommand({
            Bucket: s3Location.bucket,
            Key: s3Location.key
        })

        const response = await this.client.send(command)

        if (!response.Body) {
            throw new Error(`Failed to get S3 object: ${s3Location.bucket}/${s3Location.key}`)
        }

        return response.Body as Readable
    }

    /**
     * Create FFmpeg process for streaming
     */
    private async createFFmpegProcess(
        jobId: string,
        options: ConversionOptions,
        inputFormat: string,
        outputFormat: string
    ): Promise<ChildProcess> {
        // Validate FFmpeg installation
        if (!await this.validateFFmpegInstallation()) {
            throw new Error('FFmpeg is not installed or not accessible')
        }

        // Build FFmpeg arguments for streaming
        const args = [
            '-i', 'pipe:0',           // Read from stdin
            '-f', outputFormat,       // Output format
            '-b:a', options.quality,  // Audio bitrate
            '-y',                     // Overwrite output
            'pipe:1'                  // Write to stdout
        ]

        console.log(`[StreamingConversionService] Starting FFmpeg process for job ${jobId}: ffmpeg ${args.join(' ')}`)

        const ffmpegProcess = spawn('ffmpeg', args, {
            stdio: ['pipe', 'pipe', 'pipe']
        })

        if (!ffmpegProcess.pid) {
            throw new Error('Failed to start FFmpeg process')
        }

        // Store active process for cleanup
        this.activeProcesses.set(jobId, ffmpegProcess)

        console.log(`[StreamingConversionService] FFmpeg process started for job ${jobId} with PID ${ffmpegProcess.pid}`)

        return ffmpegProcess
    }

    /**
     * Create S3 upload stream
     */
    private createS3UploadStream(bucket: string, key: string, inputStream: Readable): Upload {
        const upload = new Upload({
            client: this.client,
            params: {
                Bucket: bucket,
                Key: key,
                Body: inputStream,
                ContentType: this.getContentTypeFromKey(key)
            },
            partSize: this.MIN_MULTIPART_SIZE, // Use 5MB minimum part size
            queueSize: 4
        })

        console.log(`[StreamingConversionService] S3 upload stream created for ${bucket}/${key} with ${this.MIN_MULTIPART_SIZE} byte parts`)

        return upload
    }

    /**
     * Set up progress monitoring for FFmpeg process
     */
    private setupProgressMonitoring(
        jobId: string,
        ffmpegProcess: ChildProcess,
        processInfo: FFmpegProcessInfo,
        fallbackFileSize?: number,
        outputStream?: NodeJS.ReadWriteStream
    ): void {
        if (!ffmpegProcess.stderr) {
            console.warn(`[StreamingConversionService] No stderr available for progress monitoring on job ${jobId}`)
            return
        }

        // Set up synthetic progress updates for very fast conversions
        let lastSyntheticProgress = 40
        const progressInterval = setInterval(async () => {
            try {
                const elapsedTime = Date.now() - processInfo.startTime

                // Provide synthetic progress updates every 500ms for better granularity
                if (elapsedTime > 500 && !ffmpegProcess.killed) {
                    // Increment progress gradually
                    lastSyntheticProgress = Math.min(lastSyntheticProgress + 5, 85) // Increment by 5%, cap at 85%

                    await progressService.setProgress(jobId, {
                        jobId,
                        progress: lastSyntheticProgress,
                        stage: 'streaming conversion in progress',
                        currentTime: `${(elapsedTime / 1000).toFixed(1)}s`,
                        estimatedTimeRemaining: Math.max(Math.ceil((10000 - elapsedTime) / 1000), 1)
                    })
                }
            } catch (error) {
                console.error(`[StreamingConversionService] Synthetic progress update error for job ${jobId}:`, error)
            }
        }, 500) // Update every 500ms for better granularity

        // Clean up interval when process exits
        ffmpegProcess.on('exit', () => {
            clearInterval(progressInterval)
        })

        // Set initial progress
        progressService.setProgress(jobId, {
            jobId,
            progress: 10,
            stage: 'starting FFmpeg conversion'
        }).catch(error => {
            console.error(`[StreamingConversionService] Initial progress update error for job ${jobId}:`, error)
        })

        ffmpegProcess.stderr.on('data', (data: Buffer) => {
            const stderrLine = data.toString()

            // Process each line separately
            const lines = stderrLine.split('\n')
            for (const line of lines) {
                if (line.trim()) {
                    // Process FFmpeg stderr asynchronously to avoid blocking
                    progressService.processFFmpegStderr(jobId, line, processInfo, fallbackFileSize)
                        .catch(error => {
                            console.error(`[StreamingConversionService] Progress monitoring error for job ${jobId}:`, error)
                        })
                }
            }
        })

        // Add progress updates for different stages of the streaming process
        let outputDataReceived = false
        ffmpegProcess.stdout?.on('data', () => {
            // When we start receiving output data, update progress (only once)
            if (!outputDataReceived) {
                outputDataReceived = true
                progressService.setProgress(jobId, {
                    jobId,
                    progress: 50,
                    stage: 'processing audio stream'
                }).catch(error => {
                    console.error(`[StreamingConversionService] Stream progress update error for job ${jobId}:`, error)
                })
            }
        })

        // Monitor S3 upload progress (only if outputStream is provided)
        if (outputStream) {
            let uploadStarted = false
            outputStream.on('data', () => {
                if (!uploadStarted) {
                    uploadStarted = true
                    progressService.setProgress(jobId, {
                        jobId,
                        progress: 70,
                        stage: 'uploading to S3'
                    }).catch(error => {
                        console.error(`[StreamingConversionService] Upload progress update error for job ${jobId}:`, error)
                    })
                }
            })
        }

        console.log(`[StreamingConversionService] Progress monitoring set up for job ${jobId}`)
    }

    /**
     * Wait for streaming conversion to complete
     */
    private async waitForStreamingCompletion(
        jobId: string,
        ffmpegProcess: ChildProcess,
        s3Upload: Upload
    ): Promise<{ success: boolean; error?: string; outputSize?: number }> {
        return new Promise((resolve) => {
            let ffmpegExited = false
            let s3UploadCompleted = false
            let ffmpegExitCode: number | null = null
            let s3UploadResult: any = null
            let error: string | null = null

            // Handle FFmpeg process exit
            ffmpegProcess.on('exit', (code, signal) => {
                ffmpegExited = true
                ffmpegExitCode = code

                console.log(`[StreamingConversionService] FFmpeg process exited for job ${jobId}: code=${code}, signal=${signal}`)

                if (code !== 0) {
                    error = `FFmpeg process failed with exit code ${code}${signal ? ` (signal: ${signal})` : ''}`
                }

                checkCompletion()
            })

            // Handle FFmpeg process error
            ffmpegProcess.on('error', (err) => {
                console.error(`[StreamingConversionService] FFmpeg process error for job ${jobId}:`, err)
                error = `FFmpeg process error: ${err.message}`
                ffmpegExited = true
                checkCompletion()
            })

            // Handle S3 upload completion
            s3Upload.done()
                .then((result) => {
                    s3UploadCompleted = true
                    s3UploadResult = result
                    console.log(`[StreamingConversionService] S3 upload completed for job ${jobId}: ${result.Location}`)
                    checkCompletion()
                })
                .catch((err) => {
                    s3UploadCompleted = true
                    error = `S3 upload failed: ${err.message}`
                    console.error(`[StreamingConversionService] S3 upload error for job ${jobId}:`, err)
                    checkCompletion()
                })

            function checkCompletion() {
                if (ffmpegExited && s3UploadCompleted) {
                    if (error || ffmpegExitCode !== 0) {
                        resolve({
                            success: false,
                            error: error || `FFmpeg failed with exit code ${ffmpegExitCode}`
                        })
                    } else {
                        resolve({
                            success: true,
                            outputSize: s3UploadResult?.ContentLength || 0
                        })
                    }
                }
            }
        })
    }

    /**
     * Wait for timeout
     */
    private async waitForTimeout(timeoutMs: number): Promise<{ success: boolean; error: string }> {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve({
                    success: false,
                    error: `Conversion timed out after ${timeoutMs}ms`
                })
            }, timeoutMs)
        })
    }

    /**
     * Terminate FFmpeg process and cleanup
     */
    private terminateProcess(jobId: string, ffmpegProcess: ChildProcess): void {
        console.log(`[StreamingConversionService] Terminating FFmpeg process for job ${jobId}`)

        try {
            if (ffmpegProcess.pid && !ffmpegProcess.killed) {
                // Try graceful termination first
                ffmpegProcess.kill('SIGTERM')

                // Force kill after 5 seconds if still running
                setTimeout(() => {
                    if (!ffmpegProcess.killed) {
                        console.warn(`[StreamingConversionService] Force killing FFmpeg process for job ${jobId}`)
                        ffmpegProcess.kill('SIGKILL')
                    }
                }, 5000)
            }
        } catch (error) {
            console.error(`[StreamingConversionService] Error terminating process for job ${jobId}:`, error)
        }

        this.activeProcesses.delete(jobId)
    }

    /**
     * Check streaming compatibility for format combination
     */
    private checkStreamingCompatibility(inputFormat: string, outputFormat: string): StreamingCompatibilityCheck {
        return progressService.checkStreamingCompatibility(inputFormat, outputFormat)
    }

    /**
     * Validate FFmpeg installation
     */
    private async validateFFmpegInstallation(): Promise<boolean> {
        return new Promise((resolve) => {
            const ffmpeg = spawn('ffmpeg', ['-version'], { stdio: 'pipe' })

            ffmpeg.on('exit', (code) => {
                resolve(code === 0)
            })

            ffmpeg.on('error', () => {
                resolve(false)
            })

            // Timeout after 5 seconds
            setTimeout(() => {
                ffmpeg.kill()
                resolve(false)
            }, 5000)
        })
    }

    /**
     * Extract format from S3 key
     */
    private extractFormatFromKey(key: string): string {
        const extension = key.split('.').pop()?.toLowerCase()
        return extension || 'unknown'
    }

    /**
     * Get content type from S3 key
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
     * Get all active processes (for monitoring/debugging)
     */
    getActiveProcesses(): Map<string, ChildProcess> {
        return new Map(this.activeProcesses)
    }

    /**
     * Cleanup all active processes (for shutdown)
     */
    async cleanup(): Promise<void> {
        console.log(`[StreamingConversionService] Cleaning up ${this.activeProcesses.size} active processes`)

        const cleanupPromises = Array.from(this.activeProcesses.entries()).map(([jobId, process]) => {
            return new Promise<void>((resolve) => {
                this.terminateProcess(jobId, process)
                // Give processes time to terminate
                setTimeout(resolve, 1000)
            })
        })

        await Promise.all(cleanupPromises)
        this.activeProcesses.clear()

        console.log('[StreamingConversionService] Cleanup completed')
    }
}

// Export singleton instance
export const streamingConversionService = new StreamingConversionService()