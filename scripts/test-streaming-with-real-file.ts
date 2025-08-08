#!/usr/bin/env tsx

/**
 * Test Streaming Conversion with Real Audio File
 * 
 * This script tests the streaming conversion service with the actual 57MB audio file
 * to demonstrate real-world performance and progress tracking.
 */

import { streamingConversionService } from '../lib/streaming-conversion-service'
import { Job, JobStatus } from '../lib/job-service'
import { progressService } from '../lib/progress-service'
import { s3Client, initializeAllServices } from '../lib/aws-services'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync, statSync } from 'fs'
import { join } from 'path'

class RealFileStreamingTest {
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

            // Run streaming conversion test
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
            const stats = statSync(this.realAudioFile)
            const sizeMB = Math.round(stats.size / 1024 / 1024)
            console.log(`📁 Found real audio file: ${sizeMB}MB`)
            return true
        } catch (error) {
            console.error(`❌ Real audio file not found at: ${this.realAudioFile}`)
            return false
        }
    }

    private async testStreamingConversion(): Promise<void> {
        console.log('\n🌊 Testing Streaming Conversion with Real File')
        console.log('-'.repeat(50))

        const startTime = Date.now()

        try {
            // Upload real audio file to S3
            console.log('📤 Uploading real audio file to S3...')
            const inputKey = `test-inputs/real-audio-${Date.now()}.mp3`
            const fileContent = readFileSync(this.realAudioFile)
            const fileSizeMB = Math.round(fileContent.length / 1024 / 1024)

            await s3Client.send(new PutObjectCommand({
                Bucket: this.testBucket,
                Key: inputKey,
                Body: fileContent,
                ContentType: 'audio/mpeg'
            }))

            console.log(`✅ Uploaded ${fileSizeMB}MB file to S3: ${inputKey}`)

            // Create job
            const job: Job = {
                jobId: `real-file-test-${Date.now()}`,
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
                ttl: Math.floor(Date.now() / 1000) + 7200 // 2 hours for large file
            }

            console.log(`🔄 Starting streaming conversion for job ${job.jobId}`)
            console.log(`📊 Input: ${fileSizeMB}MB MP3 -> WAV at 192k`)

            // Monitor progress in real-time
            const progressMonitor = setInterval(async () => {
                try {
                    const progress = await progressService.getProgress(job.jobId)
                    if (progress && progress.progress >= 0) {
                        const progressBar = this.createProgressBar(progress.progress)
                        const timeInfo = progress.currentTime && progress.totalDuration
                            ? ` (${progress.currentTime}/${progress.totalDuration})`
                            : ''
                        console.log(`📈 ${progressBar} ${progress.progress.toFixed(1)}% - ${progress.stage}${timeInfo}`)
                    }
                } catch (error) {
                    // Ignore progress monitoring errors
                }
            }, 2000) // Check every 2 seconds

            // Start conversion
            const result = await streamingConversionService.convertAudio(job, {
                format: 'wav',
                quality: '192k',
                timeout: 300000 // 5 minutes for large file
            })

            clearInterval(progressMonitor)
            const totalTime = Date.now() - startTime

            // Display results
            console.log('\n' + '='.repeat(50))
            if (result.success) {
                const outputSizeMB = result.outputS3Location ? Math.round(result.outputS3Location.size / 1024 / 1024) : 0
                console.log(`✅ Conversion Successful!`)
                console.log(`📁 Output: ${outputSizeMB}MB WAV file`)
                console.log(`⚡ Method: ${result.fallbackUsed ? 'File-based fallback' : 'Pure streaming'}`)
                console.log(`⏱️  Total time: ${Math.round(totalTime / 1000)}s`)
                console.log(`🚀 Processing speed: ${Math.round(fileSizeMB / (totalTime / 1000))}MB/s`)

                // Get final progress
                const finalProgress = await progressService.getProgress(job.jobId)
                if (finalProgress) {
                    console.log(`📊 Final progress: ${finalProgress.progress}% (${finalProgress.stage})`)
                }

                // Cleanup output file
                if (result.outputS3Location) {
                    await this.deleteS3File(result.outputS3Location.bucket, result.outputS3Location.key)
                }
            } else {
                console.log(`❌ Conversion Failed: ${result.error}`)
            }

            // Cleanup input file
            await this.deleteS3File(this.testBucket, inputKey)

        } catch (error) {
            console.error('❌ Streaming conversion test failed:', error)
        }
    }

    private createProgressBar(progress: number): string {
        const width = 20
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
    const test = new RealFileStreamingTest()
    test.runTest().catch(error => {
        console.error('💥 Test execution failed:', error)
        process.exit(1)
    })
}

export { RealFileStreamingTest }