#!/usr/bin/env tsx

/**
 * Test the fixed streaming conversion service
 */

import { streamingConversionServiceFixed } from '../lib/streaming-conversion-service-fixed'
import { Job, JobStatus } from '../lib/job-service'
import { progressService } from '../lib/progress-service'
import { s3Client, initializeAllServices } from '../lib/aws-services'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync, statSync } from 'fs'
import { join } from 'path'

class StreamingFixedTest {
    private testBucket = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'
    private realAudioFile = join(process.cwd(), 'public', 'Simon Callow Charles Dickens Story (1).mp3')

    async runTest(): Promise<void> {
        console.log('🔧 Testing Fixed Streaming Conversion Service')
        console.log('='.repeat(60))

        try {
            // Initialize services
            await initializeAllServices()
            console.log('✅ Services initialized')

            // Test with real audio file
            await this.testWithRealFile()

        } catch (error) {
            console.error('❌ Test failed:', error)
        } finally {
            await streamingConversionServiceFixed.cleanup()
            console.log('🧹 Cleanup completed')
        }
    }

    private async testWithRealFile(): Promise<void> {
        console.log('\n🎵 Testing with Real Audio File')
        console.log('-'.repeat(40))

        // Check if file exists
        let fileStats
        try {
            fileStats = statSync(this.realAudioFile)
            console.log(`📁 Found audio file: ${Math.round(fileStats.size / 1024 / 1024)}MB`)
        } catch (error) {
            console.log('⚠️  Real audio file not found, creating test file...')
            await this.createTestFile()
            fileStats = statSync(this.realAudioFile)
        }

        const startTime = Date.now()

        // Upload to S3
        const inputKey = `test-inputs/fixed-test-${Date.now()}.mp3`
        const fileContent = readFileSync(this.realAudioFile)

        console.log('📤 Uploading to S3...')
        await s3Client.send(new PutObjectCommand({
            Bucket: this.testBucket,
            Key: inputKey,
            Body: fileContent,
            ContentType: 'audio/mpeg'
        }))

        // Create job
        const job: Job = {
            jobId: `fixed-test-${Date.now()}`,
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
            ttl: Math.floor(Date.now() / 1000) + 3600
        }

        console.log(`🔄 Starting conversion for job ${job.jobId}`)

        // Monitor progress
        const progressMonitor = setInterval(async () => {
            try {
                const progress = await progressService.getProgress(job.jobId)
                if (progress && progress.progress >= 0) {
                    const bar = this.createProgressBar(progress.progress)
                    console.log(`📈 ${bar} ${progress.progress.toFixed(1)}% - ${progress.stage}`)
                }
            } catch (error) {
                // Ignore progress errors
            }
        }, 1000)

        // Start conversion
        const result = await streamingConversionServiceFixed.convertAudio(job, {
            format: 'wav',
            quality: '192k',
            timeout: 60000
        })

        clearInterval(progressMonitor)
        const totalTime = Date.now() - startTime

        // Display results
        console.log('\n' + '='.repeat(50))
        if (result.success) {
            const inputSizeMB = Math.round(fileContent.length / 1024 / 1024)
            const outputSizeMB = result.outputS3Location ? Math.round(result.outputS3Location.size / 1024 / 1024) : 0

            console.log(`✅ Conversion Successful!`)
            console.log(`📊 Input: ${inputSizeMB}MB MP3`)
            console.log(`📊 Output: ${outputSizeMB}MB WAV`)
            console.log(`⚡ Method: ${result.fallbackUsed ? 'File-based fallback' : 'Streaming'}`)
            console.log(`⏱️  Total time: ${Math.round(totalTime / 1000)}s`)
            console.log(`🚀 Speed: ${Math.round(inputSizeMB / (totalTime / 1000))}MB/s`)

            // Get final progress
            const finalProgress = await progressService.getProgress(job.jobId)
            if (finalProgress) {
                console.log(`📈 Final progress: ${finalProgress.progress}% (${finalProgress.stage})`)
            }

            // Cleanup output
            if (result.outputS3Location) {
                await this.deleteS3File(result.outputS3Location.bucket, result.outputS3Location.key)
            }
        } else {
            console.log(`❌ Conversion Failed: ${result.error}`)
        }

        // Cleanup input
        await this.deleteS3File(this.testBucket, inputKey)
    }

    private async createTestFile(): Promise<void> {
        // Create a simple test file if the real one doesn't exist
        const testContent = Buffer.from('Mock MP3 file content for testing')
        const { writeFileSync } = await import('fs')
        writeFileSync(this.realAudioFile, testContent)
        console.log('📝 Created test file')
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
            console.log(`🗑️  Deleted: ${key}`)
        } catch (error) {
            console.warn(`⚠️  Failed to delete ${key}:`, error)
        }
    }
}

// Run test
if (require.main === module) {
    const test = new StreamingFixedTest()
    test.runTest().catch(error => {
        console.error('💥 Test failed:', error)
        process.exit(1)
    })
}

export { StreamingFixedTest }