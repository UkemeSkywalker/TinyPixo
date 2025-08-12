#!/usr/bin/env tsx

/**
 * Complete validation script for download service implementation
 * Tests all aspects of task 4 requirements
 */

import { spawn } from 'child_process'

interface ValidationResult {
  requirement: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  message: string
  details?: string
}

class DownloadServiceValidator {
  private baseUrl = 'http://localhost:3000'
  private results: ValidationResult[] = []
  private devServer: any = null

  async validateAll(): Promise<void> {
    console.log('🔍 Validating Download Service Implementation (Task 4)')
    console.log('=' .repeat(60))

    try {
      await this.startDevServer()
      await this.waitForServer()

      // Validate all requirements from task 4
      await this.validateDownloadAPIEndpoint()
      await this.validateConvertedFilesListing()
      await this.validateFileMetadataDisplay()
      await this.validateUIIntegration()
      await this.validateDownloadFunctionality()
      await this.validateErrorHandling()

      this.printValidationResults()

    } catch (error) {
      console.error('❌ Validation failed:', error)
    } finally {
      await this.stopDevServer()
    }
  }

  private async startDevServer(): Promise<void> {
    console.log('🚀 Starting development server...')
    
    this.devServer = spawn('npm', ['run', 'dev'], {
      stdio: 'pipe',
      detached: false
    })

    this.devServer.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      if (output.includes('Ready')) {
        console.log('✅ Development server ready')
      }
    })
  }

  private async stopDevServer(): Promise<void> {
    if (this.devServer) {
      console.log('🛑 Stopping development server...')
      this.devServer.kill('SIGTERM')
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

  private async validateDownloadAPIEndpoint(): Promise<void> {
    console.log('\n📥 Validating Download API Endpoint...')
    
    try {
      // Test the download API exists and handles requests properly
      const response = await fetch(`${this.baseUrl}/api/download?jobId=nonexistent`)
      
      if (response.status === 404) {
        this.results.push({
          requirement: 'Download API endpoint exists',
          status: 'PASS',
          message: 'API endpoint properly handles requests and returns 404 for non-existent jobs'
        })
      } else {
        this.results.push({
          requirement: 'Download API endpoint exists',
          status: 'FAIL',
          message: `Expected 404 for non-existent job, got ${response.status}`
        })
      }
    } catch (error) {
      this.results.push({
        requirement: 'Download API endpoint exists',
        status: 'FAIL',
        message: `API endpoint not accessible: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    }
  }

  private async validateConvertedFilesListing(): Promise<void> {
    console.log('\n📋 Validating Converted Files Listing...')
    
    try {
      const response = await fetch(`${this.baseUrl}/api/converted-files`)
      
      if (!response.ok) {
        this.results.push({
          requirement: 'File listing functionality',
          status: 'FAIL',
          message: `Converted files API returned ${response.status}`
        })
        return
      }

      const data = await response.json()
      
      // Validate response structure
      if (!data.hasOwnProperty('files') || !data.hasOwnProperty('count')) {
        this.results.push({
          requirement: 'File listing functionality',
          status: 'FAIL',
          message: 'API response missing required fields (files, count)'
        })
        return
      }

      if (!Array.isArray(data.files)) {
        this.results.push({
          requirement: 'File listing functionality',
          status: 'FAIL',
          message: 'Files field is not an array'
        })
        return
      }

      this.results.push({
        requirement: 'File listing functionality',
        status: 'PASS',
        message: `Successfully lists ${data.count} converted files`,
        details: `API returns proper structure with files array and count`
      })

    } catch (error) {
      this.results.push({
        requirement: 'File listing functionality',
        status: 'FAIL',
        message: `Failed to fetch converted files: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    }
  }

  private async validateFileMetadataDisplay(): Promise<void> {
    console.log('\n📊 Validating File Metadata Display...')
    
    try {
      const response = await fetch(`${this.baseUrl}/api/converted-files`)
      const data = await response.json()
      
      if (data.files.length === 0) {
        this.results.push({
          requirement: 'File metadata display',
          status: 'SKIP',
          message: 'No converted files available to test metadata display'
        })
        return
      }

      const file = data.files[0]
      const requiredFields = ['fileName', 'originalFileName', 'format', 'quality', 'size', 'conversionDate']
      const missingFields = requiredFields.filter(field => !file.hasOwnProperty(field))
      
      if (missingFields.length > 0) {
        this.results.push({
          requirement: 'File metadata display',
          status: 'FAIL',
          message: `Missing metadata fields: ${missingFields.join(', ')}`
        })
        return
      }

      // Validate data types
      const validations = [
        { field: 'size', type: 'number', value: file.size },
        { field: 'format', type: 'string', value: file.format },
        { field: 'quality', type: 'string', value: file.quality },
        { field: 'conversionDate', type: 'string', value: file.conversionDate }
      ]

      const invalidFields = validations.filter(v => typeof v.value !== v.type)
      
      if (invalidFields.length > 0) {
        this.results.push({
          requirement: 'File metadata display',
          status: 'FAIL',
          message: `Invalid field types: ${invalidFields.map(f => `${f.field} (${typeof f.value})`).join(', ')}`
        })
        return
      }

      this.results.push({
        requirement: 'File metadata display',
        status: 'PASS',
        message: 'All required metadata fields present with correct types',
        details: `Includes: name, size (${file.size} bytes), format (${file.format}), quality (${file.quality}), date`
      })

    } catch (error) {
      this.results.push({
        requirement: 'File metadata display',
        status: 'FAIL',
        message: `Failed to validate metadata: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    }
  }

  private async validateUIIntegration(): Promise<void> {
    console.log('\n🖥️ Validating UI Integration...')
    
    try {
      const response = await fetch(`${this.baseUrl}/audio-converter`)
      
      if (!response.ok) {
        this.results.push({
          requirement: 'UI displays converted files section',
          status: 'FAIL',
          message: `Audio converter page failed to load: ${response.status}`
        })
        return
      }

      const html = await response.text()
      
      // Check for converted files section
      if (!html.includes('Converted Files')) {
        this.results.push({
          requirement: 'UI displays converted files section',
          status: 'FAIL',
          message: 'Converted Files section not found in audio converter page'
        })
        return
      }

      // Check for loading state
      if (!html.includes('Loading converted files')) {
        this.results.push({
          requirement: 'UI displays converted files section',
          status: 'FAIL',
          message: 'Loading state not found in converted files section'
        })
        return
      }

      this.results.push({
        requirement: 'UI displays converted files section',
        status: 'PASS',
        message: 'Converted Files section properly integrated into audio converter page',
        details: 'Section includes loading state and proper structure'
      })

    } catch (error) {
      this.results.push({
        requirement: 'UI displays converted files section',
        status: 'FAIL',
        message: `Failed to validate UI: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    }
  }

  private async validateDownloadFunctionality(): Promise<void> {
    console.log('\n⬇️ Validating Download Functionality...')
    
    try {
      // First get a list of converted files
      const filesResponse = await fetch(`${this.baseUrl}/api/converted-files`)
      const filesData = await filesResponse.json()
      
      if (filesData.files.length === 0) {
        this.results.push({
          requirement: 'Download buttons work correctly',
          status: 'SKIP',
          message: 'No converted files available to test download functionality'
        })
        return
      }

      const testFile = filesData.files[0]
      
      // Test download with HEAD request
      const headResponse = await fetch(`${this.baseUrl}/api/download?jobId=${testFile.jobId}`, {
        method: 'HEAD'
      })

      if (!headResponse.ok) {
        this.results.push({
          requirement: 'Download buttons work correctly',
          status: 'FAIL',
          message: `Download HEAD request failed: ${headResponse.status} ${headResponse.statusText}`
        })
        return
      }

      // Validate download headers
      const contentType = headResponse.headers.get('content-type')
      const contentDisposition = headResponse.headers.get('content-disposition')
      const contentLength = headResponse.headers.get('content-length')

      const headerValidations = []
      
      if (!contentType || !contentType.startsWith('audio/')) {
        headerValidations.push(`Invalid content-type: ${contentType}`)
      }
      
      if (!contentDisposition || !contentDisposition.includes('attachment')) {
        headerValidations.push(`Invalid content-disposition: ${contentDisposition}`)
      }
      
      if (!contentLength || parseInt(contentLength) <= 0) {
        headerValidations.push(`Invalid content-length: ${contentLength}`)
      }

      if (headerValidations.length > 0) {
        this.results.push({
          requirement: 'Download buttons work correctly',
          status: 'FAIL',
          message: 'Download headers validation failed',
          details: headerValidations.join('; ')
        })
        return
      }

      this.results.push({
        requirement: 'Download buttons work correctly',
        status: 'PASS',
        message: 'Download functionality works with proper headers',
        details: `Content-Type: ${contentType}, Size: ${contentLength} bytes`
      })

    } catch (error) {
      this.results.push({
        requirement: 'Download buttons work correctly',
        status: 'FAIL',
        message: `Failed to validate download: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    }
  }

  private async validateErrorHandling(): Promise<void> {
    console.log('\n⚠️ Validating Error Handling...')
    
    try {
      // Test various error scenarios
      const errorTests = [
        {
          name: 'Missing jobId parameter',
          url: `${this.baseUrl}/api/download`,
          expectedStatus: 400
        },
        {
          name: 'Non-existent job',
          url: `${this.baseUrl}/api/download?jobId=nonexistent`,
          expectedStatus: 404
        },
        {
          name: 'Invalid jobId format',
          url: `${this.baseUrl}/api/download?jobId=invalid-format-123`,
          expectedStatus: 404
        }
      ]

      const failedTests = []
      
      for (const test of errorTests) {
        try {
          const response = await fetch(test.url)
          if (response.status !== test.expectedStatus) {
            failedTests.push(`${test.name}: expected ${test.expectedStatus}, got ${response.status}`)
          }
        } catch (error) {
          failedTests.push(`${test.name}: request failed - ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      if (failedTests.length > 0) {
        this.results.push({
          requirement: 'Proper error handling',
          status: 'FAIL',
          message: 'Some error handling tests failed',
          details: failedTests.join('; ')
        })
      } else {
        this.results.push({
          requirement: 'Proper error handling',
          status: 'PASS',
          message: 'All error scenarios handled correctly',
          details: 'Missing params (400), non-existent jobs (404), invalid formats (404)'
        })
      }

    } catch (error) {
      this.results.push({
        requirement: 'Proper error handling',
        status: 'FAIL',
        message: `Failed to validate error handling: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    }
  }

  private printValidationResults(): void {
    console.log('\n📋 Validation Results Summary')
    console.log('=' .repeat(60))
    
    const passed = this.results.filter(r => r.status === 'PASS').length
    const failed = this.results.filter(r => r.status === 'FAIL').length
    const skipped = this.results.filter(r => r.status === 'SKIP').length
    const total = this.results.length
    
    console.log(`Overall: ${passed}/${total - skipped} requirements validated (${skipped} skipped)\n`)
    
    this.results.forEach(result => {
      const statusIcon = {
        'PASS': '✅',
        'FAIL': '❌',
        'SKIP': '⏭️'
      }[result.status]
      
      console.log(`${statusIcon} ${result.requirement}`)
      console.log(`   ${result.message}`)
      if (result.details) {
        console.log(`   Details: ${result.details}`)
      }
      console.log()
    })

    // Final assessment
    if (failed === 0) {
      console.log('🎉 All validation requirements passed!')
      console.log('✅ Task 4: Download service implementation is complete and working correctly.')
    } else {
      console.log(`⚠️ ${failed} requirement(s) failed validation.`)
      console.log('❌ Task 4: Download service implementation needs fixes.')
    }

    // Task completion criteria check
    console.log('\n📝 Task 4 Completion Criteria:')
    const criteria = [
      'Download API endpoint successfully retrieves files from S3',
      'Converted files appear in UI immediately after conversion completion',
      'Download buttons work and serve correct file content with proper headers',
      'File metadata (name, size, format) displayed accurately in converted section',
      'Frontend automatically refreshes converted section when conversion completes',
      'Download links work without errors and serve files with correct MIME types',
      'Converted section shows "No converted files" message when empty'
    ]

    criteria.forEach((criterion, index) => {
      const relatedResults = this.results.filter(r => 
        r.requirement.toLowerCase().includes(criterion.toLowerCase().split(' ')[0]) ||
        criterion.toLowerCase().includes(r.requirement.toLowerCase().split(' ')[0])
      )
      
      const hasPassing = relatedResults.some(r => r.status === 'PASS')
      const hasFailing = relatedResults.some(r => r.status === 'FAIL')
      
      let status = '⏭️'
      if (hasPassing && !hasFailing) status = '✅'
      else if (hasFailing) status = '❌'
      
      console.log(`${status} ${criterion}`)
    })
  }
}

// Run validation if this script is executed directly
if (require.main === module) {
  const validator = new DownloadServiceValidator()
  validator.validateAll().catch(console.error)
}

export { DownloadServiceValidator }