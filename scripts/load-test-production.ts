#!/usr/bin/env tsx

/**
 * Load testing script for App Runner production deployment
 * Tests concurrent users and various file sizes
 */

import fs from 'fs'
import path from 'path'
import { performance } from 'perf_hooks'

interface LoadTestConfig {
  baseUrl: string
  concurrentUsers: number
  testDurationMinutes: number
  fileSizes: string[]
}

interface TestResult {
  userId: number
  fileSize: string
  uploadTime: number
  conversionTime: number
  downloadTime: number
  totalTime: number
  success: boolean
  error?: string
}

class LoadTester {
  private config: LoadTestConfig
  private results: TestResult[] = []
  private testFiles: Map<string, Buffer> = new Map()

  constructor(config: LoadTestConfig) {
    this.config = config
  }

  async generateTestFiles() {
    console.log('📁 Generating test files...')
    
    const testFixturesDir = path.join(process.cwd(), 'test', 'fixtures')
    
    for (const size of this.config.fileSizes) {
      const filePath = path.join(testFixturesDir, `${size}-audio.mp3`)
      
      if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath)
        this.testFiles.set(size, fileBuffer)
        console.log(`✅ Loaded ${size} test file (${fileBuffer.length} bytes)`)
      } else {
        console.warn(`⚠️  Test file not found: ${filePath}`)
      }
    }
  }

  async uploadFile(userId: number, fileSize: string, fileBuffer: Buffer): Promise<string> {
    const formData = new FormData()
    const blob = new Blob([fileBuffer], { type: 'audio/mpeg' })
    formData.append('file', blob, `test-${userId}-${fileSize}.mp3`)

    const response = await fetch(`${this.config.baseUrl}/api/upload-audio`, {
      method: 'POST',
      body: formData
    })

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()
    return result.fileId
  }

  async startConversion(fileId: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/api/convert-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId,
        format: 'wav',
        quality: '192k'
      })
    })

    if (!response.ok) {
      throw new Error(`Conversion start failed: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()
    return result.jobId
  }

  async pollProgress(jobId: string): Promise<void> {
    let attempts = 0
    const maxAttempts = 600 // 5 minutes max
    
    while (attempts < maxAttempts) {
      const response = await fetch(`${this.config.baseUrl}/api/progress?jobId=${jobId}`)
      
      if (!response.ok) {
        throw new Error(`Progress poll failed: ${response.status} ${response.statusText}`)
      }

      const progress = await response.json()
      
      if (progress.progress >= 100) {
        return // Conversion complete
      }
      
      if (progress.progress === -1) {
        throw new Error(`Conversion failed: ${progress.error || 'Unknown error'}`)
      }

      await new Promise(resolve => setTimeout(resolve, 500))
      attempts++
    }
    
    throw new Error('Conversion timeout - progress polling exceeded maximum attempts')
  }

  async downloadFile(jobId: string): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/api/download?jobId=${jobId}`)
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }

    // Consume the response to simulate full download
    await response.arrayBuffer()
  }

  async runUserTest(userId: number): Promise<TestResult> {
    const fileSize = this.config.fileSizes[userId % this.config.fileSizes.length]
    const fileBuffer = this.testFiles.get(fileSize)
    
    if (!fileBuffer) {
      return {
        userId,
        fileSize,
        uploadTime: 0,
        conversionTime: 0,
        downloadTime: 0,
        totalTime: 0,
        success: false,
        error: `Test file not found: ${fileSize}`
      }
    }

    const startTime = performance.now()
    let uploadTime = 0
    let conversionTime = 0
    let downloadTime = 0

    try {
      // Upload phase
      const uploadStart = performance.now()
      const fileId = await this.uploadFile(userId, fileSize, fileBuffer)
      uploadTime = performance.now() - uploadStart

      // Conversion phase
      const conversionStart = performance.now()
      const jobId = await this.startConversion(fileId)
      await this.pollProgress(jobId)
      conversionTime = performance.now() - conversionStart

      // Download phase
      const downloadStart = performance.now()
      await this.downloadFile(jobId)
      downloadTime = performance.now() - downloadStart

      const totalTime = performance.now() - startTime

      return {
        userId,
        fileSize,
        uploadTime,
        conversionTime,
        downloadTime,
        totalTime,
        success: true
      }

    } catch (error) {
      const totalTime = performance.now() - startTime
      
      return {
        userId,
        fileSize,
        uploadTime,
        conversionTime,
        downloadTime,
        totalTime,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async runLoadTest(): Promise<void> {
    console.log(`🚀 Starting load test with ${this.config.concurrentUsers} concurrent users`)
    console.log(`📊 Test duration: ${this.config.testDurationMinutes} minutes`)
    console.log(`🎯 Target URL: ${this.config.baseUrl}`)
    
    const startTime = performance.now()
    const endTime = startTime + (this.config.testDurationMinutes * 60 * 1000)
    
    const userPromises: Promise<void>[] = []
    
    // Start concurrent users
    for (let userId = 0; userId < this.config.concurrentUsers; userId++) {
      const userPromise = this.runContinuousUserTest(userId, endTime)
      userPromises.push(userPromise)
    }
    
    // Wait for all users to complete
    await Promise.all(userPromises)
    
    console.log('\n📈 Load test completed!')
    this.printResults()
  }

  async runContinuousUserTest(userId: number, endTime: number): Promise<void> {
    let testCount = 0
    
    while (performance.now() < endTime) {
      console.log(`👤 User ${userId} starting test ${testCount + 1}`)
      
      const result = await this.runUserTest(userId)
      this.results.push(result)
      
      if (result.success) {
        console.log(`✅ User ${userId} test ${testCount + 1} completed in ${(result.totalTime / 1000).toFixed(2)}s`)
      } else {
        console.log(`❌ User ${userId} test ${testCount + 1} failed: ${result.error}`)
      }
      
      testCount++
      
      // Brief pause between tests
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    
    console.log(`👤 User ${userId} completed ${testCount} tests`)
  }

  printResults(): void {
    const successfulTests = this.results.filter(r => r.success)
    const failedTests = this.results.filter(r => !r.success)
    
    console.log('\n📊 Load Test Results:')
    console.log(`Total tests: ${this.results.length}`)
    console.log(`Successful: ${successfulTests.length} (${((successfulTests.length / this.results.length) * 100).toFixed(1)}%)`)
    console.log(`Failed: ${failedTests.length} (${((failedTests.length / this.results.length) * 100).toFixed(1)}%)`)
    
    if (successfulTests.length > 0) {
      const avgUploadTime = successfulTests.reduce((sum, r) => sum + r.uploadTime, 0) / successfulTests.length
      const avgConversionTime = successfulTests.reduce((sum, r) => sum + r.conversionTime, 0) / successfulTests.length
      const avgDownloadTime = successfulTests.reduce((sum, r) => sum + r.downloadTime, 0) / successfulTests.length
      const avgTotalTime = successfulTests.reduce((sum, r) => sum + r.totalTime, 0) / successfulTests.length
      
      console.log('\n⏱️  Average Times:')
      console.log(`Upload: ${(avgUploadTime / 1000).toFixed(2)}s`)
      console.log(`Conversion: ${(avgConversionTime / 1000).toFixed(2)}s`)
      console.log(`Download: ${(avgDownloadTime / 1000).toFixed(2)}s`)
      console.log(`Total: ${(avgTotalTime / 1000).toFixed(2)}s`)
    }
    
    if (failedTests.length > 0) {
      console.log('\n❌ Common Errors:')
      const errorCounts = new Map<string, number>()
      
      failedTests.forEach(test => {
        if (test.error) {
          const count = errorCounts.get(test.error) || 0
          errorCounts.set(test.error, count + 1)
        }
      })
      
      Array.from(errorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([error, count]) => {
          console.log(`  ${count}x: ${error}`)
        })
    }
  }
}

async function main() {
  const baseUrl = process.argv[2] || 'http://localhost:3000'
  
  if (!baseUrl.startsWith('http')) {
    console.error('❌ Please provide a valid base URL')
    console.log('Usage: tsx scripts/load-test-production.ts <base-url>')
    console.log('Example: tsx scripts/load-test-production.ts https://tinypixo-audio.us-east-1.awsapprunner.com')
    process.exit(1)
  }
  
  const config: LoadTestConfig = {
    baseUrl,
    concurrentUsers: 10,
    testDurationMinutes: 5,
    fileSizes: ['small', 'medium', 'large']
  }
  
  console.log('🧪 Production Load Test')
  console.log('======================')
  
  const tester = new LoadTester(config)
  
  try {
    await tester.generateTestFiles()
    await tester.runLoadTest()
  } catch (error) {
    console.error('❌ Load test failed:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}