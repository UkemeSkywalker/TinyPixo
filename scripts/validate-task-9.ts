#!/usr/bin/env tsx

/**
 * Validation script for Task 9: S3 streaming download service
 * 
 * This script validates all the requirements for the download service:
 * - Direct streaming downloads from S3
 * - Presigned URL generation
 * - Proper content headers and MIME types
 * - Large file handling without ERR_CONTENT_LENGTH_MISMATCH
 * - Download access validation
 * - Error handling for various scenarios
 */

import { jobService, JobStatus } from '../lib/job-service'
import { s3Client, initializeAllServices } from '../lib/aws-services'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getEnvironmentConfig } from '../lib/environment'

const config = getEnvironmentConfig()
const bucketName = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'

interface ValidationResult {
  test: string
  passed: boolean
  error?: string
  details?: any
}

class DownloadValidator {
  private results: ValidationResult[] = []
  private testJobId: string = ''
  private testFileKey: string = ''
  private testFileContent: Buffer = Buffer.from('')

  async runAllValidations(): Promise<void> {
    console.log('🚀 Starting Task 9 Download Service Validation')
    console.log(`Environment: ${config.environment}`)
    console.log(`S3 Bucket: ${bucketName}`)
    console.log('=' .repeat(60))

    try {
      await this.setupTestEnvironment()
      await this.validateDirectDownload()
      await this.validatePresignedUrls()
      await this.validateContentHeaders()
      await this.validateLargeFileHandling()
      await this.validateAccessValidation()
      await this.validateErrorHandling()
      await this.cleanupTestEnvironment()
    } catch (error) {
      console.error('❌ Validation setup failed:', error)
      process.exit(1)
    }

    this.printResults()
  }

  private async setupTestEnvironment(): Promise<void> {
    console.log('📋 Setting up test environment...')
    
    try {
      // Initialize services
      await initializeAllServices()
      
      // Create test file content
      this.testFileContent = Buffer.from('Test audio file content for download validation')
      this.testJobId = `download-test-${Date.now()}`
      this.testFileKey = `conversions/${this.testJobId}.mp3`
      
      // Upload test file to S3
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: this.testFileKey,
        Body: this.testFileContent,
        ContentType: 'audio/mpeg'
      }))
      
      // Create job in DynamoDB
      const job = await jobService.createJob({
        inputS3Location: {
          bucket: bucketName,
          key: `uploads/${this.testJobId}.mp3`,
          size: this.testFileContent.length
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
          size: this.testFileContent.length
        }
      )
      
      this.testJobId = job.jobId
      console.log(`✅ Test environment setup complete. Job ID: ${this.testJobId}`)
      
    } catch (error) {
      throw new Error(`Failed to setup test environment: ${error}`)
    }
  }

  private async validateDirectDownload(): Promise<void> {
    console.log('\n📥 Validating direct download streaming...')
    
    try {
      const response = await fetch(`http://localhost:3000/api/download?jobId=${this.testJobId}`)
      
      if (response.status !== 200) {
        throw new Error(`Expected status 200, got ${response.status}`)
      }
      
      const downloadedContent = await response.arrayBuffer()
      const downloadedBuffer = Buffer.from(downloadedContent)
      
      if (!downloadedBuffer.equals(this.testFileContent)) {
        throw new Error('Downloaded content does not match original')
      }
      
      this.results.push({
        test: 'Direct download streaming',
        passed: true,
        details: {
          status: response.status,
          contentLength: response.headers.get('content-length'),
          contentType: response.headers.get('content-type')
        }
      })
      
      console.log('✅ Direct download validation passed')
      
    } catch (error) {
      this.results.push({
        test: 'Direct download streaming',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      console.log('❌ Direct download validation failed:', error)
    }
  }

  private async validatePresignedUrls(): Promise<void> {
    console.log('\n🔗 Validating presigned URL generation...')
    
    try {
      // Get presigned URL
      const presignedResponse = await fetch(`http://localhost:3000/api/download?jobId=${this.testJobId}&presigned=true`)
      
      if (presignedResponse.status !== 200) {
        throw new Error(`Expected status 200, got ${presignedResponse.status}`)
      }
      
      const presignedData = await presignedResponse.json()
      
      if (!presignedData.presignedUrl || !presignedData.presignedUrl.startsWith('http')) {
        throw new Error('Invalid presigned URL format')
      }
      
      // Test download via presigned URL
      const downloadResponse = await fetch(presignedData.presignedUrl)
      
      if (downloadResponse.status !== 200) {
        throw new Error(`Presigned URL download failed with status ${downloadResponse.status}`)
      }
      
      const downloadedContent = await downloadResponse.arrayBuffer()
      const downloadedBuffer = Buffer.from(downloadedContent)
      
      if (!downloadedBuffer.equals(this.testFileContent)) {
        throw new Error('Presigned URL download content does not match original')
      }
      
      this.results.push({
        test: 'Presigned URL generation and download',
        passed: true,
        details: {
          presignedUrl: presignedData.presignedUrl.substring(0, 50) + '...',
          filename: presignedData.filename,
          contentType: presignedData.contentType,
          size: presignedData.size
        }
      })
      
      console.log('✅ Presigned URL validation passed')
      
    } catch (error) {
      this.results.push({
        test: 'Presigned URL generation and download',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      console.log('❌ Presigned URL validation failed:', error)
    }
  }

  private async validateContentHeaders(): Promise<void> {
    console.log('\n📋 Validating content headers and MIME types...')
    
    const testCases = [
      { format: 'mp3', expectedType: 'audio/mpeg' },
      { format: 'wav', expectedType: 'audio/wav' },
      { format: 'aac', expectedType: 'audio/aac' },
      { format: 'ogg', expectedType: 'audio/ogg' }
    ]
    
    for (const testCase of testCases) {
      try {
        // Create a test job for this format
        const formatJobId = `format-test-${testCase.format}-${Date.now()}`
        const formatFileKey = `conversions/${formatJobId}.${testCase.format}`
        
        // Upload test file
        await s3Client.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: formatFileKey,
          Body: this.testFileContent,
          ContentType: testCase.expectedType
        }))
        
        // Create job
        const job = await jobService.createJob({
          inputS3Location: {
            bucket: bucketName,
            key: `uploads/${formatJobId}.mp3`,
            size: this.testFileContent.length
          },
          format: testCase.format,
          quality: '192k'
        })
        
        // Update to completed
        await jobService.updateJobStatus(
          job.jobId,
          JobStatus.COMPLETED,
          {
            bucket: bucketName,
            key: formatFileKey,
            size: this.testFileContent.length
          }
        )
        
        // Test download
        const response = await fetch(`http://localhost:3000/api/download?jobId=${job.jobId}`)
        
        if (response.status !== 200) {
          throw new Error(`Download failed for ${testCase.format}: status ${response.status}`)
        }
        
        const contentType = response.headers.get('content-type')
        if (contentType !== testCase.expectedType) {
          throw new Error(`Wrong content type for ${testCase.format}: expected ${testCase.expectedType}, got ${contentType}`)
        }
        
        // Cleanup
        await s3Client.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: formatFileKey
        }))
        
        console.log(`✅ Content type validation passed for ${testCase.format}`)
        
      } catch (error) {
        this.results.push({
          test: `Content type validation for ${testCase.format}`,
          passed: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        console.log(`❌ Content type validation failed for ${testCase.format}:`, error)
        continue
      }
    }
    
    this.results.push({
      test: 'Content headers and MIME type detection',
      passed: true,
      details: { testedFormats: testCases.map(tc => tc.format) }
    })
  }

  private async validateLargeFileHandling(): Promise<void> {
    console.log('\n📦 Validating large file handling...')
    
    try {
      // Create a 5MB test file
      const largeFileContent = Buffer.alloc(5 * 1024 * 1024, 'L')
      const largeJobId = `large-test-${Date.now()}`
      const largeFileKey = `conversions/${largeJobId}.wav`
      
      // Upload large file
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: largeFileKey,
        Body: largeFileContent,
        ContentType: 'audio/wav'
      }))
      
      // Create job
      const job = await jobService.createJob({
        inputS3Location: {
          bucket: bucketName,
          key: `uploads/${largeJobId}.mp3`,
          size: largeFileContent.length
        },
        format: 'wav',
        quality: '192k'
      })
      
      // Update to completed
      await jobService.updateJobStatus(
        job.jobId,
        JobStatus.COMPLETED,
        {
          bucket: bucketName,
          key: largeFileKey,
          size: largeFileContent.length
        }
      )
      
      // Test download
      const startTime = Date.now()
      const response = await fetch(`http://localhost:3000/api/download?jobId=${job.jobId}`)
      
      if (response.status !== 200) {
        throw new Error(`Large file download failed: status ${response.status}`)
      }
      
      const contentLength = response.headers.get('content-length')
      if (contentLength !== largeFileContent.length.toString()) {
        throw new Error(`Content-Length mismatch: expected ${largeFileContent.length}, got ${contentLength}`)
      }
      
      // Stream the content to verify no ERR_CONTENT_LENGTH_MISMATCH
      const reader = response.body?.getReader()
      let totalBytes = 0
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          totalBytes += value?.length || 0
        }
      }
      
      if (totalBytes !== largeFileContent.length) {
        throw new Error(`Downloaded bytes mismatch: expected ${largeFileContent.length}, got ${totalBytes}`)
      }
      
      const duration = Date.now() - startTime
      
      // Cleanup
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: largeFileKey
      }))
      
      this.results.push({
        test: 'Large file handling (5MB)',
        passed: true,
        details: {
          fileSize: largeFileContent.length,
          downloadTime: `${duration}ms`,
          bytesReceived: totalBytes
        }
      })
      
      console.log(`✅ Large file validation passed (${duration}ms)`)
      
    } catch (error) {
      this.results.push({
        test: 'Large file handling (5MB)',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      console.log('❌ Large file validation failed:', error)
    }
  }

  private async validateAccessValidation(): Promise<void> {
    console.log('\n🔒 Validating download access validation...')
    
    const testCases = [
      {
        name: 'Non-existent job',
        jobId: 'non-existent-job',
        expectedStatus: 404,
        expectedError: 'Job not found'
      },
      {
        name: 'Job without jobId parameter',
        jobId: '',
        expectedStatus: 400,
        expectedError: 'Job ID is required'
      }
    ]
    
    for (const testCase of testCases) {
      try {
        const url = testCase.jobId 
          ? `http://localhost:3000/api/download?jobId=${testCase.jobId}`
          : 'http://localhost:3000/api/download'
          
        const response = await fetch(url)
        
        if (response.status !== testCase.expectedStatus) {
          throw new Error(`Expected status ${testCase.expectedStatus}, got ${response.status}`)
        }
        
        const data = await response.json()
        if (!data.error || !data.error.includes(testCase.expectedError)) {
          throw new Error(`Expected error containing "${testCase.expectedError}", got "${data.error}"`)
        }
        
        console.log(`✅ Access validation passed for: ${testCase.name}`)
        
      } catch (error) {
        this.results.push({
          test: `Access validation: ${testCase.name}`,
          passed: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        console.log(`❌ Access validation failed for ${testCase.name}:`, error)
        continue
      }
    }
    
    this.results.push({
      test: 'Download access validation',
      passed: true,
      details: { validatedScenarios: testCases.length }
    })
  }

  private async validateErrorHandling(): Promise<void> {
    console.log('\n⚠️  Validating error handling...')
    
    try {
      // Create a job that's still processing
      const processingJob = await jobService.createJob({
        inputS3Location: {
          bucket: bucketName,
          key: 'uploads/processing.mp3',
          size: 1000
        },
        format: 'mp3',
        quality: '192k'
      })
      
      const response = await fetch(`http://localhost:3000/api/download?jobId=${processingJob.jobId}`)
      
      if (response.status !== 400) {
        throw new Error(`Expected status 400 for processing job, got ${response.status}`)
      }
      
      const data = await response.json()
      if (!data.error.includes('not completed')) {
        throw new Error(`Expected error about incomplete conversion, got "${data.error}"`)
      }
      
      this.results.push({
        test: 'Error handling for incomplete jobs',
        passed: true,
        details: { status: response.status, error: data.error }
      })
      
      console.log('✅ Error handling validation passed')
      
    } catch (error) {
      this.results.push({
        test: 'Error handling for incomplete jobs',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      console.log('❌ Error handling validation failed:', error)
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
    console.log('📊 VALIDATION RESULTS')
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
        console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`)
      }
    })
    
    console.log('\n' + '='.repeat(60))
    console.log(`SUMMARY: ${passed}/${total} tests passed`)
    
    if (passed === total) {
      console.log('🎉 All validations passed! Task 9 is complete.')
      process.exit(0)
    } else {
      console.log('❌ Some validations failed. Please review and fix the issues.')
      process.exit(1)
    }
  }
}

// Run validation if called directly
if (require.main === module) {
  const validator = new DownloadValidator()
  validator.runAllValidations().catch(error => {
    console.error('💥 Validation failed:', error)
    process.exit(1)
  })
}

export { DownloadValidator }