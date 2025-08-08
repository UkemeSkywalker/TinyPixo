#!/usr/bin/env tsx

/**
 * Test Streaming Conversion with Real 57MB Audio File
 * 
 * This script tests the streaming conversion service with the actual
 * "Simon Callow Charles Dickens Story (1).mp3" file from the public directory
 */

import { streamingConversionService } from '../lib/streaming-conversion-service'
import { Job, JobStatus } from '../lib/job-service'
import { progressService } from '../lib/progress-service'
import { s3Client, initializeAllServices } from '../lib/aws-services'
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'

class RealAudioStreamingTest {
    private testBucket = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'
    private realAudioFile = join(process.cwd(), 'public', 'Simon Callow Charles Dickens Story (1).mp3')

    async runTest(): Promise<void> {
        console.log('🎵 Testing Streaming Conversion with Real 57MB Audio File')
        console.log('='.repeat(80))

        try {
            // Initialize services
            console.log('🔧 Initializing services...')
            await initializeAllServices()
            console.log('✅ Services initialized')

            // Check if real audio file exists
            if (!this.checkRealAudioFile()) {
                console.error('❌ Real audio file not found')
                return
            }

            // Test streaming conversion
            await this.testStreamingConversion()

        } catch (error) {
            console.error('❌ Test failed:', error)
        } finally {
            // Cleanup any remaining processes
            await streamingConversionService.cleanup()
            console.log('🧹 Cleanup completed')
        }
    }

    private checkRealAudioFile(): boolean {
        try {
            if (!existsSync(this.realAudioFile)) {
                console.error(`❌ File not found: ${this.realAudioFile}`)
                return false
            }

            const stats = statSync(this.realAudioFile)
            const sizeMB = Math.round(stats.size / 1024 / 1024)
            console.log(`📁 Found real audio file: ${sizeMB}MB (${stats.size} bytes)`)
            console.log(`📍 Location: ${this.realAudioFile}`)
            return true
        } catch (error) {
            console.error(`❌ Error checking file: ${error}`)
            return false
        }
    }

    private async testStreamingConversion(): Promise<void> {
        console.log('\n🌊 Testing Streaming Conversion with Real 57MB File')
        console.log('-'.repeat(60))

        const startTime = Date.now()

        try {
            // Read the real audio file
            console.log('📖 Reading audio file from disk...')
            const fileContent = readFileSync(this.realAudioFile)
            const fileSizeMB = Math.round(fileContent.length / 1024 / 1024)
            console.log(`✅ File loaded: ${fileSizeMB}MB`)

            // Upload to S3
            console.log('📤 Uploading to S3...')
            const inputKey = `test-inputs/real-audio-${Date.now()}.mp3`

            const uploadStart = Date.now()
            await s3Client.send(new PutObjectCommand({
                Bucket: this.testBucket,
                Key: inputKey,
                Body: fileContent,
                ContentType: 'audio/mpeg'
            }))
            const uploadTime = Date.now() - uploadStart
            console.log(`✅ Upload completed in ${uploadTime}ms (${Math.round(fileSizeMB / (uploadTime / 1000))}MB/s)`)

            // Create job
            const job: Job = {
                jobId: `real-streaming-${Date.now()}`,
                status: JobStatus.CREATED,
                inputS3Location: {
                    bucket: this.testBucket,
                    key: inputKey,
                    size: fileContent.length
                },
                format: 'wav',
                quality: '192k',
                createdAt: new Date(),
                updatedAt: new Date(),
                ttl: Math.floor(Date.now() / 1000) + 7200 // 2 hours
            }

            console.log(`🔄 Starting streaming conversion for job ${job.jobId}`)
            console.log(`📊 Input: ${fileSizeMB}MB MP3 -> WAV at 192k`)

            // Monitor memory usage
            const initialMemory = process.memoryUsage()
            console.log(`💾 Initial memory: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`)

            // Monitor progress in real-time
            let lastProgress = -1
            const progressMonitor = setInterval(async () => {
                try {
                    const progress = await progressService.getProgress(job.jobId)
                    if (progress && progress.progress >= 0 && progress.progress !== lastProgress) {
                        lastProgress = progress.progress
                        const progressBar = this.createProgressBar(progress.progress)
                        const timeInfo = progress.currentTime && progress.totalDuration
                            ? ` (${progress.currentTime}/${progress.totalDuration})`
                            : ''
                        const eta = progress.estimatedTimeRemaining
                            ? ` ETA: ${Math.round(progress.estimatedTimeRemaining)}s`
                            : ''

                        console.log(`📈 ${progressBar} ${progress.progress.toFixed(1)}% - ${progress.stage}${timeInfo}${eta}`)
                    }
                } catch (error) {
                    // Ignore progress monitoring errors
                }
            }, 2000) // Check every 2 seconds

            // Start conversion with longer timeout for large file
            const conversionStart = Date.now()
            const result = await streamingConversionService.convertAudio(job, {
                format: 'wav',
                quality: '192k',
                timeout: 600000 // 10 minutes for large file
            })

            clearInterval(progressMonitor)
            const conversionTime = Date.now() - conversionStart
            const totalTime = Date.now() - startTime

            // Check final memory usage
            const finalMemory = process.memoryUsage()
            const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed
            const memoryIncreaseMB = Math.round(memoryIncrease / 1024 / 1024)

            console.log('\n' + '='.repeat(60))
            console.log('📊 CONVERSION RESULTS')
            console.log('='.repeat(60))

            if (result.success && result.outputS3Location) {
                const outputSizeMB = Math.round(result.outputS3Location.size / 1024 / 1024)

                console.log(`✅ Conversion Successful!`)
                console.log(`📁 Input:  ${fileSizeMB}MB MP3`)
                console.log(`📁 Output: ${outputSizeMB}MB WAV`)
                console.log(`⚡ Method: ${result.fallbackUsed ? 'File-based fallback' : 'Pure streaming'}`)
                console.log(`⏱️  Conversion time: ${Math.round(conversionTime / 1000)}s`)
                console.log(`⏱️  Total time: ${Math.round(totalTime / 1000)}s`)
                console.log(`🚀 Processing speed: ${Math.round(fileSizeMB / (conversionTime / 1000))}MB/s`)
                console.log(`💾 Memory increase: ${memoryIncreaseMB}MB`)
                console.log(`📍 Output location: ${result.outputS3Location.key}`)

                // Verify output file exists and get its actual size
                try {
                    const outputResponse = await s3Client.send(new GetObjectCommand({
                        Bucket: result.outputS3Location.bucket,
                        Key: result.outputS3Location.key
                    }))

                    const actualSize = outputResponse.ContentLength || 0
                    const actualSizeMB = Math.round(actualSize / 1024 / 1024)
                    console.log(`✅ Verified output file: ${actualSizeMB}MB (${actualSize} bytes)`)

                } catch (error) {
                    console.warn(`⚠️  Could not verify output file: ${error}`)
                }

                // Get final progress
                const finalProgress = await progressService.getProgress(job.jobId)
                if (finalProgress) {
                    console.log(`📈 Final progress: ${finalProgress.progress}% (${finalProgress.stage})`)
                }

                // Performance analysis
                console.log('\n📊 Performance Analysis:')
                if (memoryIncreaseMB < 10) {
                    console.log(`✅ Excellent memory efficiency: Only ${memoryIncreaseMB}MB increase for ${fileSizeMB}MB file`)
                } else if (memoryIncreaseMB < 50) {
                    console.log(`✅ Good memory efficiency: ${memoryIncreaseMB}MB increase for ${fileSizeMB}MB file`)
                } else {
                    console.log(`⚠️  High memory usage: ${memoryIncreaseMB}MB increase for ${fileSizeMB}MB file`)
                }

                if (!result.fallbackUsed) {
                    console.log(`✅ Pure streaming successful - no temporary files used!`)
                } else {
                    console.log(`ℹ️  Used fallback method - still successful!`)
                }

                // Cleanup output file
                await this.deleteS3File(result.outputS3Location.bucket, result.outputS3Location.key)

            } else {
                console.log(`❌ Conversion Failed`)
                console.log(`💥 Error: ${result.error}`)
                console.log(`⏱️  Failed after: ${Math.round(conversionTime / 1000)}s`)
                console.log(`💾 Memory increase: ${memoryIncreaseMB}MB`)
            }

            // Cleanup input file
            await this.deleteS3File(this.testBucket, inputKey)

        } catch (error) {
            console.error('❌ Streaming conversion test failed:', error)
        }
    }

    private createProgressBar(progress: number): string {
        const width = 30
        const filled = Math.round((progress / 100) * width)
        const empty = width - filled
        return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`
    }

    private async deleteS3File(bucket: string, key: string): Promise<void> {
        try {
            await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
            console.log(`🗑️  Deleted S3 file: ${key}`)
        } catch (error) {
            console.warn(`⚠️  Failed to delete S3 file ${key}:`, error)
        }
    }
}

// Run test if called directly
if (require.main === module) {
    const test = new RealAudioStreamingTest()
    test.runTest().catch(error => {
        console.error('💥 Test execution failed:', error)
        process.exit(1)
    })
}

export { RealAudioStreamingTest }