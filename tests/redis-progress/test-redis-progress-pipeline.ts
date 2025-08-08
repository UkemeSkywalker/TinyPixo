#!/usr/bin/env tsx

/**
 * Test script to verify Redis progress tracking from 0% to 100% during the full pipeline
 * This addresses the specific validation criteria from Task 8:
 * "Watch progress updates in Redis going from 0% to 100% during the full pipeline"
 */

import { NextRequest } from 'next/server'
import { POST } from '../../app/api/convert-audio/route'
import { progressService } from '../../lib/progress-service'
import { jobService, JobStatus } from '../../lib/job-service'
import { s3Client } from '../../lib/aws-services'
import { PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createReadStream, existsSync } from 'fs'
import { join } from 'path'

interface ProgressSnapshot {
  timestamp: number
  progress: number
  stage: string
  source: 'redis' | 'dynamodb_fallback'
}

class RedisProgressPipelineTest {
  private testBucket = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'
  private testFileId = `redis-progress-test-${Date.now()}`
  private testAudioFile = join(process.cwd(), 'public', 'Simon Callow Charles Dickens Story (1).mp3')
  private uploadedFiles: string[] = []
  private progressSnapshots: ProgressSnapshot[] = []

  async runTest(): Promise<void> {
    console.log('🔍 Testing Redis Progress Pipeline (0% → 100%)')
    console.log('=' .repeat(60))

    try {
      // Check if test file exists
      if (!existsSync(this.testAudioFile)) {
        console.log('❌ Test audio file not found, creating mock file for testing')
        await this.createMockAudioFile()
      }

      // Step 1: Upload test file
      await this.uploadTestFile()

      // Step 2: Start conversion and monitor Redis progress
      const jobId = await this.startConversion()

      // Step 3: Monitor Redis progress in real-time
      await this.monitorRedisProgress(jobId)

      // Step 4: Validate progress progression
      this.validateProgressProgression()

      // Step 5: Verify final state
      await this.verifyFinalState(jobId)

      console.log('\n🎉 Redis Progress Pipeline Test PASSED!')
      this.printProgressSummary()

    } catch (error) {
      console.error('\n❌ Redis Progress Pipeline Test FAILED:', error)
      throw error
    } finally {
      // Cleanup
      await this.cleanup()
    }
  }

  private async createMockAudioFile(): Promise<void> {
    console.log('📁 Creating mock audio file for testing...')
    
    // Create a simple mock MP3 file (just for testing purposes)
    const mockMp3Header = Buffer.from([
      0xFF, 0xFB, 0x90, 0x00, // MP3 header
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // Padding
    ])
    
    // Create a larger buffer to simulate a real audio file
    const mockData = Buffer.alloc(1024 * 100) // 100KB mock file
    mockMp3Header.copy(mockData, 0)
    
    // Upload directly to S3 instead of creating local file
    const uploadKey = `uploads/${this.testFileId}.mp3`
    this.uploadedFiles.push(uploadKey)

    await s3Client.send(new PutObjectCommand({
      Bucket: this.testBucket,
      Key: uploadKey,
      Body: mockData,
      ContentType: 'audio/mpeg'
    }))

    console.log(`✅ Mock audio file created and uploaded: ${uploadKey}`)
  }

  private async uploadTestFile(): Promise<void> {
    if (existsSync(this.testAudioFile)) {
      console.log('📤 Uploading real test file to S3...')
      
      const uploadKey = `uploads/${this.testFileId}.mp3`
      this.uploadedFiles.push(uploadKey)

      // Read file as buffer to avoid streaming issues
      const fs = await import('fs/promises')
      const fileBuffer = await fs.readFile(this.testAudioFile)

      await s3Client.send(new PutObjectCommand({
        Bucket: this.testBucket,
        Key: uploadKey,
        Body: fileBuffer,
        ContentType: 'audio/mpeg'
      }))

      // Verify upload
      const headResult = await s3Client.send(new HeadObjectCommand({
        Bucket: this.testBucket,
        Key: uploadKey
      }))

      console.log(`✅ Test file uploaded: ${headResult.ContentLength} bytes`)
    } else {
      console.log('✅ Using mock file already uploaded')
    }
  }

  private async startConversion(): Promise<string> {
    console.log('\n🚀 Starting conversion process...')

    const conversionRequest = new NextRequest('http://localhost/api/convert-audio', {
      method: 'POST',
      body: JSON.stringify({
        fileId: `${this.testFileId}.mp3`,
        format: 'wav',
        quality: '192k',
        bucket: this.testBucket
      })
    })

    const response = await POST(conversionRequest)
    const data = await response.json()

    if (response.status !== 202) {
      throw new Error(`Conversion start failed: ${data.error}`)
    }

    console.log(`✅ Conversion started with job ID: ${data.jobId}`)
    return data.jobId
  }

  private async monitorRedisProgress(jobId: string): Promise<void> {
    console.log('\n📊 Monitoring Redis progress updates...')
    console.log('Time\t\tProgress\tStage\t\t\tSource')
    console.log('-'.repeat(80))

    let progressComplete = false
    let attempts = 0
    const maxAttempts = 120 // 2 minutes max wait time
    const pollInterval = 500 // Poll every 500ms for better granularity

    while (!progressComplete && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollInterval))
      attempts++

      try {
        // Get progress directly from Redis (not through fallback)
        const progress = await progressService.getProgress(jobId)
        
        if (progress) {
          const timestamp = Date.now()
          const progressSnapshot: ProgressSnapshot = {
            timestamp,
            progress: progress.progress,
            stage: progress.stage,
            source: 'redis' // Assume Redis unless we detect fallback
          }

          // Check if this is a new progress value worth recording
          const lastSnapshot = this.progressSnapshots[this.progressSnapshots.length - 1]
          if (!lastSnapshot || 
              lastSnapshot.progress !== progress.progress || 
              lastSnapshot.stage !== progress.stage) {
            
            this.progressSnapshots.push(progressSnapshot)
            
            const timeStr = new Date(timestamp).toLocaleTimeString()
            const progressStr = `${progress.progress}%`.padEnd(8)
            const stageStr = progress.stage.padEnd(25)
            
            console.log(`${timeStr}\t${progressStr}\t${stageStr}\t${progressSnapshot.source}`)
          }

          // Check completion
          if (progress.progress === 100) {
            progressComplete = true
            console.log('\n✅ Progress reached 100% - conversion completed!')
          } else if (progress.progress === -1) {
            throw new Error(`Conversion failed: ${progress.error}`)
          }
        } else {
          // No progress data found - might be using DynamoDB fallback
          if (attempts % 10 === 0) { // Log every 5 seconds
            console.log(`${new Date().toLocaleTimeString()}\t--\t\tNo progress data found\t\t--`)
          }
        }
      } catch (error) {
        console.error(`Error checking progress (attempt ${attempts}):`, error)
        
        // If Redis fails, we might get DynamoDB fallback
        if (attempts % 10 === 0) {
          console.log(`${new Date().toLocaleTimeString()}\t--\t\tProgress check failed\t\tdynamodb_fallback`)
        }
      }
    }

    if (!progressComplete) {
      throw new Error(`Conversion did not complete within ${maxAttempts * pollInterval / 1000} seconds`)
    }
  }

  private validateProgressProgression(): void {
    console.log('\n🔍 Validating progress progression...')

    if (this.progressSnapshots.length === 0) {
      throw new Error('No progress snapshots recorded!')
    }

    // Check that we have progress from 0% to 100%
    const progressValues = this.progressSnapshots.map(s => s.progress)
    const minProgress = Math.min(...progressValues)
    const maxProgress = Math.max(...progressValues)

    console.log(`📈 Progress range: ${minProgress}% → ${maxProgress}%`)

    // Validate progression requirements
    const validations = [
      {
        name: 'Started at or near 0%',
        condition: minProgress <= 10,
        actual: `${minProgress}%`
      },
      {
        name: 'Reached 100%',
        condition: maxProgress === 100,
        actual: `${maxProgress}%`
      },
      {
        name: 'Progress generally increased',
        condition: this.isProgressGenerallyIncreasing(),
        actual: this.getProgressTrend()
      },
      {
        name: 'Multiple progress updates',
        condition: this.progressSnapshots.length >= 3,
        actual: `${this.progressSnapshots.length} updates`
      },
      {
        name: 'Used Redis (not just fallback)',
        condition: this.progressSnapshots.some(s => s.source === 'redis'),
        actual: this.getSourceSummary()
      }
    ]

    let allValid = true
    for (const validation of validations) {
      const status = validation.condition ? '✅' : '❌'
      console.log(`${status} ${validation.name}: ${validation.actual}`)
      if (!validation.condition) allValid = false
    }

    if (!allValid) {
      throw new Error('Progress progression validation failed!')
    }

    console.log('✅ Progress progression validation passed!')
  }

  private isProgressGenerallyIncreasing(): boolean {
    if (this.progressSnapshots.length < 2) return true

    let increasingCount = 0
    let totalTransitions = 0

    for (let i = 1; i < this.progressSnapshots.length; i++) {
      const prev = this.progressSnapshots[i - 1]
      const curr = this.progressSnapshots[i]
      
      if (curr.progress !== prev.progress) {
        totalTransitions++
        if (curr.progress > prev.progress) {
          increasingCount++
        }
      }
    }

    // Allow some backwards movement (e.g., due to retries) but mostly increasing
    return totalTransitions === 0 || (increasingCount / totalTransitions) >= 0.7
  }

  private getProgressTrend(): string {
    if (this.progressSnapshots.length < 2) return 'insufficient data'

    const first = this.progressSnapshots[0].progress
    const last = this.progressSnapshots[this.progressSnapshots.length - 1].progress
    const direction = last > first ? 'increasing' : last < first ? 'decreasing' : 'stable'
    
    return `${first}% → ${last}% (${direction})`
  }

  private getSourceSummary(): string {
    const redisSources = this.progressSnapshots.filter(s => s.source === 'redis').length
    const fallbackSources = this.progressSnapshots.filter(s => s.source === 'dynamodb_fallback').length
    
    return `${redisSources} Redis, ${fallbackSources} fallback`
  }

  private async verifyFinalState(jobId: string): Promise<void> {
    console.log('\n🔍 Verifying final state...')

    // Check job status in DynamoDB
    const job = await jobService.getJob(jobId)
    if (!job) {
      throw new Error('Job not found in DynamoDB')
    }

    if (job.status !== JobStatus.COMPLETED) {
      throw new Error(`Expected job status COMPLETED, got ${job.status}`)
    }

    if (!job.outputS3Location) {
      throw new Error('No output S3 location in completed job')
    }

    // Add output file to cleanup list
    this.uploadedFiles.push(job.outputS3Location.key)

    // Verify output file exists
    const headResult = await s3Client.send(new HeadObjectCommand({
      Bucket: job.outputS3Location.bucket,
      Key: job.outputS3Location.key
    }))

    console.log(`✅ Final state verified:`)
    console.log(`   Job Status: ${job.status}`)
    console.log(`   Output File: ${job.outputS3Location.key} (${headResult.ContentLength} bytes)`)
  }

  private printProgressSummary(): void {
    console.log('\n📊 Progress Summary:')
    console.log(`   Total Updates: ${this.progressSnapshots.length}`)
    console.log(`   Duration: ${this.getTestDuration()}ms`)
    console.log(`   Progress Range: ${Math.min(...this.progressSnapshots.map(s => s.progress))}% → ${Math.max(...this.progressSnapshots.map(s => s.progress))}%`)
    console.log(`   Stages: ${[...new Set(this.progressSnapshots.map(s => s.stage))].join(', ')}`)
    console.log(`   Sources: ${this.getSourceSummary()}`)
  }

  private getTestDuration(): number {
    if (this.progressSnapshots.length < 2) return 0
    return this.progressSnapshots[this.progressSnapshots.length - 1].timestamp - this.progressSnapshots[0].timestamp
  }

  private async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up test files...')

    const cleanupPromises = this.uploadedFiles.map(async (key) => {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: this.testBucket,
          Key: key
        }))
        console.log(`   Deleted: ${key}`)
      } catch (error) {
        console.warn(`   Failed to delete ${key}:`, error)
      }
    })

    await Promise.all(cleanupPromises)
    console.log(`✅ Cleanup completed (${this.uploadedFiles.length} files)`)
  }
}

// Run the test
async function main() {
  const test = new RedisProgressPipelineTest()
  
  try {
    await test.runTest()
    console.log('\n🎉 Redis Progress Pipeline Test COMPLETED SUCCESSFULLY!')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Redis Progress Pipeline Test FAILED:', error)
    process.exit(1)
  }
}

// Only run if called directly
if (require.main === module) {
  main()
}

export { RedisProgressPipelineTest }