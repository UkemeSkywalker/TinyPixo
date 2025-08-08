import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { StreamingConversionService } from './streaming-conversion-service'
import { Job, JobStatus, S3Location, jobService } from './job-service'
import { progressService } from './progress-service'
import { s3Client, initializeAllServices } from './aws-services'
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createReadStream, createWriteStream, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'

// Skip integration tests if not in integration test environment
const isIntegrationTest = process.env.VITEST_INTEGRATION === 'true'
const skipMessage = 'Integration test - set VITEST_INTEGRATION=true to run'

describe('StreamingConversionService Integration Tests', () => {
  let service: StreamingConversionService
  let testBucket: string
  let testAudioFiles: { [key: string]: string } = {}

  beforeAll(async () => {
    if (!isIntegrationTest) {
      console.log('Skipping integration tests - set VITEST_INTEGRATION=true to run')
      return
    }

    console.log('Setting up integration test environment...')
    
    // Initialize AWS services
    await initializeAllServices()
    
    service = new StreamingConversionService()
    testBucket = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'

    // Create test audio files
    await createTestAudioFiles()
    
    console.log('Integration test environment ready')
  }, 30000) // 30 second timeout for setup

  afterAll(async () => {
    if (!isIntegrationTest) return

    console.log('Cleaning up integration test environment...')
    
    // Cleanup test files
    await cleanupTestFiles()
    
    // Cleanup service
    await service.cleanup()
    
    console.log('Integration test cleanup completed')
  }, 15000)

  beforeEach(() => {
    if (!isIntegrationTest) return
    console.log('Starting integration test...')
  })

  afterEach(() => {
    if (!isIntegrationTest) return
    console.log('Integration test completed')
  })

  describe('Streaming Conversion', () => {
    it.skipIf(!isIntegrationTest)('should convert MP3 to WAV using streaming', async () => {
      // Upload test MP3 file to S3
      const inputKey = 'uploads/test-streaming-mp3.mp3'
      await uploadTestFile('mp3', inputKey)

      // Create job
      const job: Job = {
        jobId: `streaming-test-${Date.now()}`,
        status: JobStatus.CREATED,
        inputS3Location: {
          bucket: testBucket,
          key: inputKey,
          size: await getFileSize(testAudioFiles.mp3)
        },
        format: 'wav',
        quality: '192k',
        createdAt: new Date(),
        updatedAt: new Date(),
        ttl: Math.floor(Date.now() / 1000) + 3600
      }

      console.log(`Testing streaming conversion for job ${job.jobId}`)

      // Perform conversion
      const result = await service.convertAudio(job, {
        format: 'wav',
        quality: '192k',
        timeout: 60000 // 1 minute timeout
      })

      // Verify result
      expect(result.success).toBe(true)
      expect(result.outputS3Location).toBeDefined()
      expect(result.outputS3Location!.key).toContain('.wav')
      expect(result.processingTimeMs).toBeGreaterThan(0)

      console.log(`Streaming conversion completed in ${result.processingTimeMs}ms`)
      console.log(`Output location: ${result.outputS3Location!.bucket}/${result.outputS3Location!.key}`)

      // Verify output file exists in S3
      const outputExists = await checkS3FileExists(result.outputS3Location!.bucket, result.outputS3Location!.key)
      expect(outputExists).toBe(true)

      // Verify progress reached 100%
      const finalProgress = await progressService.getProgress(job.jobId)
      expect(finalProgress).toBeDefined()
      expect(finalProgress!.progress).toBe(100)
      expect(finalProgress!.stage).toBe('completed')

      // Cleanup
      await deleteS3File(testBucket, inputKey)
      await deleteS3File(result.outputS3Location!.bucket, result.outputS3Location!.key)
    }, 120000) // 2 minute timeout

    it.skipIf(!isIntegrationTest)('should handle streaming compatibility correctly', async () => {
      // Test different format combinations
      const testCases = [
        { input: 'mp3', output: 'wav', shouldStream: true },
        { input: 'wav', output: 'mp3', shouldStream: true },
        { input: 'mp3', output: 'aac', shouldStream: true },
        { input: 'flac', output: 'wav', shouldStream: false }, // FLAC typically requires file access
      ]

      for (const testCase of testCases) {
        console.log(`Testing compatibility: ${testCase.input} -> ${testCase.output}`)
        
        const compatibility = progressService.checkStreamingCompatibility(testCase.input, testCase.output)
        
        expect(compatibility.supportsStreaming).toBe(testCase.shouldStream)
        
        if (!testCase.shouldStream) {
          expect(compatibility.reason).toBeDefined()
          expect(compatibility.fallbackRecommended).toBe(true)
        }

        console.log(`Compatibility result: streaming=${compatibility.supportsStreaming}, reason=${compatibility.reason || 'none'}`)
      }
    })

    it.skipIf(!isIntegrationTest)('should fallback to file-based conversion when streaming fails', async () => {
      // Create a job with a format combination that should trigger fallback
      const inputKey = 'uploads/test-fallback.mp3'
      await uploadTestFile('mp3', inputKey)

      const job: Job = {
        jobId: `fallback-test-${Date.now()}`,
        status: JobStatus.CREATED,
        inputS3Location: {
          bucket: testBucket,
          key: inputKey,
          size: await getFileSize(testAudioFiles.mp3)
        },
        format: 'flac', // FLAC should trigger fallback
        quality: '192k',
        createdAt: new Date(),
        updatedAt: new Date(),
        ttl: Math.floor(Date.now() / 1000) + 3600
      }

      console.log(`Testing fallback conversion for job ${job.jobId}`)

      const result = await service.convertAudio(job, {
        format: 'flac',
        quality: '192k',
        timeout: 60000
      })

      // Should succeed but use fallback
      expect(result.success).toBe(true)
      expect(result.fallbackUsed).toBe(true)
      expect(result.outputS3Location).toBeDefined()

      console.log(`Fallback conversion completed: fallbackUsed=${result.fallbackUsed}`)

      // Cleanup
      await deleteS3File(testBucket, inputKey)
      if (result.outputS3Location) {
        await deleteS3File(result.outputS3Location.bucket, result.outputS3Location.key)
      }
    }, 120000)

    it.skipIf(!isIntegrationTest)('should handle large files without memory issues', async () => {
      // This test would ideally use a larger file, but for CI we'll use the available test file
      const inputKey = 'uploads/test-large-file.mp3'
      await uploadTestFile('mp3', inputKey)

      const job: Job = {
        jobId: `large-file-test-${Date.now()}`,
        status: JobStatus.CREATED,
        inputS3Location: {
          bucket: testBucket,
          key: inputKey,
          size: await getFileSize(testAudioFiles.mp3)
        },
        format: 'wav',
        quality: '192k',
        createdAt: new Date(),
        updatedAt: new Date(),
        ttl: Math.floor(Date.now() / 1000) + 3600
      }

      console.log(`Testing large file conversion for job ${job.jobId}`)

      // Monitor memory usage during conversion
      const initialMemory = process.memoryUsage()
      console.log(`Initial memory usage: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`)

      const result = await service.convertAudio(job, {
        format: 'wav',
        quality: '192k',
        timeout: 120000 // 2 minutes for large files
      })

      const finalMemory = process.memoryUsage()
      console.log(`Final memory usage: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB`)

      // Memory increase should be reasonable (less than 100MB for streaming)
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed
      console.log(`Memory increase: ${Math.round(memoryIncrease / 1024 / 1024)}MB`)

      expect(result.success).toBe(true)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024) // Less than 100MB increase

      // Cleanup
      await deleteS3File(testBucket, inputKey)
      if (result.outputS3Location) {
        await deleteS3File(result.outputS3Location.bucket, result.outputS3Location.key)
      }
    }, 180000) // 3 minute timeout

    it.skipIf(!isIntegrationTest)('should provide real-time progress updates during streaming', async () => {
      const inputKey = 'uploads/test-progress.mp3'
      await uploadTestFile('mp3', inputKey)

      const job: Job = {
        jobId: `progress-test-${Date.now()}`,
        status: JobStatus.CREATED,
        inputS3Location: {
          bucket: testBucket,
          key: inputKey,
          size: await getFileSize(testAudioFiles.mp3)
        },
        format: 'wav',
        quality: '192k',
        createdAt: new Date(),
        updatedAt: new Date(),
        ttl: Math.floor(Date.now() / 1000) + 3600
      }

      console.log(`Testing progress updates for job ${job.jobId}`)

      // Start conversion
      const conversionPromise = service.convertAudio(job, {
        format: 'wav',
        quality: '192k',
        timeout: 60000
      })

      // Monitor progress updates
      const progressUpdates: number[] = []
      const progressCheckInterval = setInterval(async () => {
        const progress = await progressService.getProgress(job.jobId)
        if (progress && progress.progress >= 0) {
          progressUpdates.push(progress.progress)
          console.log(`Progress update: ${progress.progress}% (${progress.stage})`)
        }
      }, 500) // Check every 500ms

      // Wait for conversion to complete
      const result = await conversionPromise
      clearInterval(progressCheckInterval)

      // Verify progress updates
      expect(result.success).toBe(true)
      expect(progressUpdates.length).toBeGreaterThan(0)
      
      // Should have received multiple progress updates
      const uniqueProgressValues = [...new Set(progressUpdates)]
      expect(uniqueProgressValues.length).toBeGreaterThan(1)
      
      // Final progress should be 100%
      const finalProgress = await progressService.getProgress(job.jobId)
      expect(finalProgress!.progress).toBe(100)

      console.log(`Received ${progressUpdates.length} progress updates with ${uniqueProgressValues.length} unique values`)

      // Cleanup
      await deleteS3File(testBucket, inputKey)
      if (result.outputS3Location) {
        await deleteS3File(result.outputS3Location.bucket, result.outputS3Location.key)
      }
    }, 120000)

    it.skipIf(!isIntegrationTest)('should handle FFmpeg process timeout correctly', async () => {
      const inputKey = 'uploads/test-timeout.mp3'
      await uploadTestFile('mp3', inputKey)

      const job: Job = {
        jobId: `timeout-test-${Date.now()}`,
        status: JobStatus.CREATED,
        inputS3Location: {
          bucket: testBucket,
          key: inputKey,
          size: await getFileSize(testAudioFiles.mp3)
        },
        format: 'wav',
        quality: '192k',
        createdAt: new Date(),
        updatedAt: new Date(),
        ttl: Math.floor(Date.now() / 1000) + 3600
      }

      console.log(`Testing timeout handling for job ${job.jobId}`)

      // Use a very short timeout to trigger timeout condition
      const result = await service.convertAudio(job, {
        format: 'wav',
        quality: '192k',
        timeout: 1000 // 1 second timeout (should be too short)
      })

      // Should fail due to timeout
      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')

      console.log(`Timeout test result: success=${result.success}, error=${result.error}`)

      // Verify no active processes remain
      const activeProcesses = service.getActiveProcesses()
      expect(activeProcesses.size).toBe(0)

      // Cleanup
      await deleteS3File(testBucket, inputKey)
    }, 30000)
  })

  describe('Format Compatibility Tests', () => {
    it.skipIf(!isIntegrationTest)('should identify streaming vs file-based formats correctly', async () => {
      const formats = progressService.getSupportedFormats()
      
      console.log('Testing format compatibility:')
      
      for (const format of formats) {
        console.log(`${format.format}: streaming=${format.supportsStreaming}, complexity=${format.estimatedComplexity}`)
        
        // Verify format properties
        expect(format.format).toBeDefined()
        expect(typeof format.supportsStreaming).toBe('boolean')
        expect(['low', 'medium', 'high']).toContain(format.estimatedComplexity)
        
        if (format.requiresFileAccess) {
          expect(format.supportsStreaming).toBe(false)
        }
      }

      // Test specific format combinations
      const streamingFormats = formats.filter(f => f.supportsStreaming)
      const fileFormats = formats.filter(f => !f.supportsStreaming)

      expect(streamingFormats.length).toBeGreaterThan(0)
      console.log(`Found ${streamingFormats.length} streaming-compatible formats`)
      console.log(`Found ${fileFormats.length} file-only formats`)
    })
  })

  // Helper functions
  async function createTestAudioFiles(): Promise<void> {
    console.log('Creating test audio files...')
    
    // Create a simple test MP3 file using FFmpeg (if available)
    const testDir = join(process.cwd(), 'test-files')
    
    try {
      // Create test directory
      const { mkdirSync } = await import('fs')
      mkdirSync(testDir, { recursive: true })

      // Generate a simple test audio file using FFmpeg
      const mp3File = join(testDir, 'test-audio.mp3')
      
      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-f', 'lavfi',
          '-i', 'sine=frequency=440:duration=5', // 5 second 440Hz tone
          '-b:a', '128k',
          '-y', // Overwrite
          mp3File
        ])

        ffmpeg.on('exit', (code) => {
          if (code === 0) {
            console.log('Test MP3 file created successfully')
            resolve()
          } else {
            reject(new Error(`FFmpeg failed with exit code ${code}`))
          }
        })

        ffmpeg.on('error', reject)
      })

      testAudioFiles.mp3 = mp3File

    } catch (error) {
      console.warn('Could not create test audio files with FFmpeg, using placeholder:', error)
      
      // Create a minimal placeholder file for testing
      const { writeFileSync } = await import('fs')
      const placeholderFile = join(testDir, 'placeholder.mp3')
      writeFileSync(placeholderFile, Buffer.from('placeholder audio data'))
      testAudioFiles.mp3 = placeholderFile
    }
  }

  async function uploadTestFile(format: string, key: string): Promise<void> {
    const filePath = testAudioFiles[format]
    if (!filePath || !existsSync(filePath)) {
      throw new Error(`Test file not found: ${format}`)
    }

    const { readFileSync } = await import('fs')
    const fileContent = readFileSync(filePath)

    await s3Client.send(new PutObjectCommand({
      Bucket: testBucket,
      Key: key,
      Body: fileContent,
      ContentType: format === 'mp3' ? 'audio/mpeg' : 'audio/wav'
    }))

    console.log(`Uploaded test file: ${key}`)
  }

  async function getFileSize(filePath: string): Promise<number> {
    const { statSync } = await import('fs')
    return statSync(filePath).size
  }

  async function checkS3FileExists(bucket: string, key: string): Promise<boolean> {
    try {
      await s3Client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key
      }))
      return true
    } catch (error) {
      return false
    }
  }

  async function deleteS3File(bucket: string, key: string): Promise<void> {
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: key
      }))
      console.log(`Deleted S3 file: ${key}`)
    } catch (error) {
      console.warn(`Failed to delete S3 file ${key}:`, error)
    }
  }

  async function cleanupTestFiles(): Promise<void> {
    // Clean up local test files
    for (const [format, filePath] of Object.entries(testAudioFiles)) {
      try {
        if (existsSync(filePath)) {
          unlinkSync(filePath)
          console.log(`Deleted test file: ${filePath}`)
        }
      } catch (error) {
        console.warn(`Failed to delete test file ${filePath}:`, error)
      }
    }

    // Clean up test directory
    try {
      const testDir = join(process.cwd(), 'test-files')
      const { rmSync } = await import('fs')
      rmSync(testDir, { recursive: true, force: true })
      console.log('Test directory cleaned up')
    } catch (error) {
      console.warn('Failed to clean up test directory:', error)
    }
  }
})