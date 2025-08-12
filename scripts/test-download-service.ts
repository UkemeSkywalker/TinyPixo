#!/usr/bin/env tsx

/**
 * Test script for download service implementation
 * Tests the converted files API and download functionality
 */

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

interface ConvertedFile {
  jobId: string
  fileName: string
  originalFileName: string
  format: string
  quality: string
  size: number
  conversionDate: string
  s3Location: {
    bucket: string
    key: string
    size: number
  }
}

interface TestResult {
  test: string
  passed: boolean
  message: string
  duration?: number
}

class DownloadServiceTester {
  private baseUrl = 'http://localhost:3000'
  private results: TestResult[] = []
  private devServer: any = null

  async runAllTests(): Promise<void> {
    console.log('🧪 Starting Download Service Tests')
    console.log('=' .repeat(50))

    try {
      // Start dev server
      await this.startDevServer()
      
      // Wait for server to be ready
      await this.waitForServer()

      // Run tests
      await this.testConvertedFilesAPI()
      await this.testDownloadAPI()
      await this.testUIIntegration()

      // Print results
      this.printResults()

    } catch (error) {
      console.error('❌ Test suite failed:', error)
    } finally {
      // Cleanup
      await this.stopDevServer()
    }
  }

  private async startDevServer(): Promise<void> {
    console.log('🚀 Starting development server...')
    
    this.devServer = spawn('npm', ['run', 'dev'], {
      stdio: 'pipe',
      detached: false
    })

    // Handle server output
    this.devServer.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      if (output.includes('Ready')) {
        console.log('✅ Development server ready')
      }
    })

    this.devServer.stderr?.on('data', (data: Buffer) => {
      const output = data.toString()
      if (output.includes('Error')) {
        console.error('❌ Server error:', output)
      }
    })
  }

  private async stopDevServer(): Promise<void> {
    if (this.devServer) {
      console.log('🛑 Stopping development server...')
      this.devServer.kill('SIGTERM')
      
      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }

  private async waitForServer(): Promise<void> {
    console.log('⏳ Waiting for server to be ready...')
    
    const maxAttempts = 30
    let attempts = 0
    
    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`${this.baseUrl}/api/health/simple`)
        if (response.ok) {
          console.log('✅ Server is ready')
          return
        }
      } catch (error) {
        // Server not ready yet
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      attempts++
    }
    
    throw new Error('Server failed to start within timeout')
  }

  private async testConvertedFilesAPI(): Promise<void> {
    console.log('\n📁 Testing Converted Files API...')
    
    const startTime = Date.now()
    
    try {
      const response = await fetch(`${this.baseUrl}/api/converted-files`, {
        headers: {
          'Cache-Control': 'no-cache'
        }
      })

      const duration = Date.now() - startTime

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      
      // Validate response structure
      if (!data.hasOwnProperty('files') || !data.hasOwnProperty('count')) {
        throw new Error('Invalid response structure - missing files or count')
      }

      if (!Array.isArray(data.files)) {
        throw new Error('files property is not an array')
      }

      if (typeof data.count !== 'number') {
        throw new Error('count property is not a number')
      }

      if (data.files.length !== data.count) {
        throw new Error(`files array length (${data.files.length}) doesn't match count (${data.count})`)
      }

      // Validate file structure if files exist
      if (data.files.length > 0) {
        const file = data.files[0] as ConvertedFile
        const requiredFields = ['jobId', 'fileName', 'originalFileName', 'format', 'quality', 'size', 'conversionDate', 's3Location']
        
        for (const field of requiredFields) {
          if (!file.hasOwnProperty(field)) {
            throw new Error(`File object missing required field: ${field}`)
          }
        }

        // Validate s3Location structure
        const s3RequiredFields = ['bucket', 'key', 'size']
        for (const field of s3RequiredFields) {
          if (!file.s3Location.hasOwnProperty(field)) {
            throw new Error(`s3Location missing required field: ${field}`)
          }
        }
      }

      this.results.push({
        test: 'Converted Files API',
        passed: true,
        message: `Retrieved ${data.count} files successfully`,
        duration
      })

      console.log(`✅ API test passed - found ${data.count} converted files (${duration}ms)`)

      // Store first file for download test
      if (data.files.length > 0) {
        this.testFile = data.files[0]
      }

    } catch (error) {
      const duration = Date.now() - startTime
      this.results.push({
        test: 'Converted Files API',
        passed: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        duration
      })
      console.log(`❌ API test failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private testFile: ConvertedFile | null = null

  private async testDownloadAPI(): Promise<void> {
    console.log('\n⬇️ Testing Download API...')
    
    if (!this.testFile) {
      this.results.push({
        test: 'Download API',
        passed: false,
        message: 'No converted files available for download test'
      })
      console.log('❌ Download test skipped - no files available')
      return
    }

    const startTime = Date.now()
    
    try {
      // Test HEAD request first
      const headResponse = await fetch(`${this.baseUrl}/api/download?jobId=${this.testFile.jobId}`, {
        method: 'HEAD'
      })

      if (!headResponse.ok) {
        throw new Error(`Download HEAD request failed: ${headResponse.status} ${headResponse.statusText}`)
      }

      // Validate headers
      const contentType = headResponse.headers.get('content-type')
      const contentLength = headResponse.headers.get('content-length')
      const contentDisposition = headResponse.headers.get('content-disposition')

      if (!contentType || !contentType.startsWith('audio/')) {
        throw new Error(`Invalid content-type: ${contentType}`)
      }

      if (!contentLength || parseInt(contentLength) <= 0) {
        throw new Error(`Invalid content-length: ${contentLength}`)
      }

      if (!contentDisposition || !contentDisposition.includes('attachment')) {
        throw new Error(`Invalid content-disposition: ${contentDisposition}`)
      }

      // Test actual download (first 1KB only to avoid large downloads)
      const downloadResponse = await fetch(`${this.baseUrl}/api/download?jobId=${this.testFile.jobId}`, {
        headers: {
          'Range': 'bytes=0-1023' // First 1KB only
        }
      })

      if (!downloadResponse.ok && downloadResponse.status !== 206) {
        throw new Error(`Download request failed: ${downloadResponse.status} ${downloadResponse.statusText}`)
      }

      const downloadData = await downloadResponse.arrayBuffer()
      
      if (downloadData.byteLength === 0) {
        throw new Error('Downloaded data is empty')
      }

      const duration = Date.now() - startTime

      this.results.push({
        test: 'Download API',
        passed: true,
        message: `Download successful - ${downloadData.byteLength} bytes received`,
        duration
      })

      console.log(`✅ Download test passed - received ${downloadData.byteLength} bytes (${duration}ms)`)

    } catch (error) {
      const duration = Date.now() - startTime
      this.results.push({
        test: 'Download API',
        passed: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        duration
      })
      console.log(`❌ Download test failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private async testUIIntegration(): Promise<void> {
    console.log('\n🖥️ Testing UI Integration...')
    
    const startTime = Date.now()
    
    try {
      // Test that the audio converter page loads
      const response = await fetch(`${this.baseUrl}/audio-converter`)
      
      if (!response.ok) {
        throw new Error(`Audio converter page failed to load: ${response.status}`)
      }

      const html = await response.text()
      
      // Check for key UI elements
      const requiredElements = [
        'Convert Audio',
        'Converted Files',
        'ConvertedFiles' // React component
      ]

      for (const element of requiredElements) {
        if (!html.includes(element)) {
          throw new Error(`UI missing required element: ${element}`)
        }
      }

      const duration = Date.now() - startTime

      this.results.push({
        test: 'UI Integration',
        passed: true,
        message: 'Audio converter page loads with converted files section',
        duration
      })

      console.log(`✅ UI test passed - page loads correctly (${duration}ms)`)

    } catch (error) {
      const duration = Date.now() - startTime
      this.results.push({
        test: 'UI Integration',
        passed: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        duration
      })
      console.log(`❌ UI test failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private printResults(): void {
    console.log('\n📊 Test Results Summary')
    console.log('=' .repeat(50))
    
    const passed = this.results.filter(r => r.passed).length
    const total = this.results.length
    
    console.log(`Overall: ${passed}/${total} tests passed\n`)
    
    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌'
      const duration = result.duration ? ` (${result.duration}ms)` : ''
      console.log(`${status} ${result.test}${duration}`)
      console.log(`   ${result.message}\n`)
    })

    if (passed === total) {
      console.log('🎉 All tests passed! Download service implementation is working correctly.')
    } else {
      console.log(`⚠️ ${total - passed} test(s) failed. Please review the implementation.`)
    }
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  const tester = new DownloadServiceTester()
  tester.runAllTests().catch(console.error)
}

export { DownloadServiceTester }