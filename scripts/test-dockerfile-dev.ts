#!/usr/bin/env tsx

/**
 * Test Dockerfile.dev locally before deployment
 * Validates that the Docker image builds and runs correctly
 */

import { spawn } from 'child_process'
import { performance } from 'perf_hooks'

interface DockerTestResult {
  step: string
  success: boolean
  duration: number
  error?: string
  output?: string
}

class DockerTester {
  private results: DockerTestResult[] = []
  private imageName = 'tinypixo-audio:v2.0.0-test'
  private containerName = 'tinypixo-audio-test-container'

  async runCommand(command: string, args: string[], timeout = 60000): Promise<{ success: boolean, output: string, error?: string }> {
    return new Promise((resolve) => {
      const startTime = performance.now()
      const process = spawn(command, args, { stdio: 'pipe' })
      
      let stdout = ''
      let stderr = ''
      
      process.stdout?.on('data', (data) => {
        stdout += data.toString()
      })
      
      process.stderr?.on('data', (data) => {
        stderr += data.toString()
      })
      
      const timeoutId = setTimeout(() => {
        process.kill('SIGKILL')
        resolve({
          success: false,
          output: stdout,
          error: `Command timeout after ${timeout}ms`
        })
      }, timeout)
      
      process.on('close', (code) => {
        clearTimeout(timeoutId)
        const duration = performance.now() - startTime
        
        resolve({
          success: code === 0,
          output: stdout,
          error: code !== 0 ? stderr : undefined
        })
      })
      
      process.on('error', (error) => {
        clearTimeout(timeoutId)
        resolve({
          success: false,
          output: stdout,
          error: error.message
        })
      })
    })
  }

  async testDockerBuild(): Promise<DockerTestResult> {
    console.log('🔨 Building Docker image with Dockerfile.dev...')
    const startTime = performance.now()
    
    const result = await this.runCommand('docker', [
      'build',
      '--platform', 'linux/amd64',
      '-f', 'Dockerfile.dev',
      '-t', this.imageName,
      '.'
    ], 300000) // 5 minute timeout
    
    const duration = performance.now() - startTime
    
    return {
      step: 'Docker Build',
      success: result.success,
      duration,
      error: result.error,
      output: result.output.slice(-1000) // Last 1000 chars
    }
  }

  async testDockerRun(): Promise<DockerTestResult> {
    console.log('🚀 Starting Docker container...')
    const startTime = performance.now()
    
    // Start container in detached mode
    const result = await this.runCommand('docker', [
      'run',
      '-d',
      '--name', this.containerName,
      '-p', '3001:3000',
      '-e', 'NODE_ENV=production',
      '-e', 'FORCE_AWS_ENVIRONMENT=false',
      this.imageName
    ], 30000)
    
    const duration = performance.now() - startTime
    
    return {
      step: 'Docker Run',
      success: result.success,
      duration,
      error: result.error,
      output: result.output
    }
  }

  async testContainerHealth(): Promise<DockerTestResult> {
    console.log('🏥 Testing container health...')
    const startTime = performance.now()
    
    // Wait for container to start
    await new Promise(resolve => setTimeout(resolve, 10000))
    
    try {
      const response = await fetch('http://localhost:3001/api/health', {
        signal: AbortSignal.timeout(10000)
      })
      
      const duration = performance.now() - startTime
      
      if (response.ok) {
        const health = await response.json()
        
        return {
          step: 'Container Health',
          success: true,
          duration,
          output: JSON.stringify(health, null, 2)
        }
      } else {
        return {
          step: 'Container Health',
          success: false,
          duration,
          error: `HTTP ${response.status}: ${response.statusText}`
        }
      }
    } catch (error) {
      const duration = performance.now() - startTime
      
      return {
        step: 'Container Health',
        success: false,
        duration,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async testFFmpegAvailability(): Promise<DockerTestResult> {
    console.log('🎵 Testing FFmpeg availability in container...')
    const startTime = performance.now()
    
    const result = await this.runCommand('docker', [
      'exec',
      this.containerName,
      'ffmpeg',
      '-version'
    ], 10000)
    
    const duration = performance.now() - startTime
    
    return {
      step: 'FFmpeg Availability',
      success: result.success,
      duration,
      error: result.error,
      output: result.output.split('\n')[0] // First line with version
    }
  }

  async testSharpAvailability(): Promise<DockerTestResult> {
    console.log('🖼️ Testing Sharp availability in container...')
    const startTime = performance.now()
    
    const result = await this.runCommand('docker', [
      'exec',
      this.containerName,
      'node',
      '-e',
      'console.log(require("sharp").format)'
    ], 10000)
    
    const duration = performance.now() - startTime
    
    return {
      step: 'Sharp Availability',
      success: result.success,
      duration,
      error: result.error,
      output: result.output
    }
  }

  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up Docker resources...')
    
    // Stop and remove container
    await this.runCommand('docker', ['stop', this.containerName], 10000)
    await this.runCommand('docker', ['rm', this.containerName], 10000)
    
    // Remove image
    await this.runCommand('docker', ['rmi', this.imageName], 10000)
    
    console.log('✅ Cleanup completed')
  }

  async runAllTests(): Promise<void> {
    console.log('🧪 Testing Dockerfile.dev locally')
    console.log('=' .repeat(50))
    
    try {
      // Test 1: Build image
      const buildResult = await this.testDockerBuild()
      this.results.push(buildResult)
      this.printResult(buildResult)
      
      if (!buildResult.success) {
        console.log('❌ Build failed, skipping remaining tests')
        return
      }
      
      // Test 2: Run container
      const runResult = await this.testDockerRun()
      this.results.push(runResult)
      this.printResult(runResult)
      
      if (!runResult.success) {
        console.log('❌ Container start failed, skipping remaining tests')
        return
      }
      
      // Test 3: Health check
      const healthResult = await this.testContainerHealth()
      this.results.push(healthResult)
      this.printResult(healthResult)
      
      // Test 4: FFmpeg
      const ffmpegResult = await this.testFFmpegAvailability()
      this.results.push(ffmpegResult)
      this.printResult(ffmpegResult)
      
      // Test 5: Sharp
      const sharpResult = await this.testSharpAvailability()
      this.results.push(sharpResult)
      this.printResult(sharpResult)
      
    } finally {
      await this.cleanup()
    }
    
    this.printSummary()
  }

  printResult(result: DockerTestResult): void {
    const status = result.success ? '✅' : '❌'
    const duration = (result.duration / 1000).toFixed(2)
    
    console.log(`${status} ${result.step} (${duration}s)`)
    
    if (result.error) {
      console.log(`   Error: ${result.error}`)
    }
    
    if (result.output && result.success) {
      const output = result.output.trim()
      if (output.length > 0) {
        console.log(`   Output: ${output.split('\n')[0]}`) // First line only
      }
    }
    
    console.log()
  }

  printSummary(): void {
    console.log('=' .repeat(50))
    console.log('📊 DOCKER TEST SUMMARY')
    console.log('=' .repeat(50))
    
    const passed = this.results.filter(r => r.success).length
    const total = this.results.length
    const passRate = total > 0 ? (passed / total) * 100 : 0
    
    console.log(`Total Tests: ${total}`)
    console.log(`Passed: ${passed}`)
    console.log(`Failed: ${total - passed}`)
    console.log(`Pass Rate: ${passRate.toFixed(1)}%`)
    
    if (passRate === 100) {
      console.log('\n🎉 ALL TESTS PASSED!')
      console.log('✅ Dockerfile.dev is ready for App Runner deployment')
      console.log('\nNext steps:')
      console.log('1. Run: npm run deploy:production')
      console.log('2. Configure App Runner service manually if needed')
      console.log('3. Run: npm run validate:production <url>')
    } else {
      console.log('\n❌ SOME TESTS FAILED')
      console.log('Review the errors above and fix Dockerfile.dev before deploying')
      
      const failedTests = this.results.filter(r => !r.success)
      console.log('\n🔍 Failed Tests:')
      failedTests.forEach(test => {
        console.log(`  ❌ ${test.step}: ${test.error || 'Unknown error'}`)
      })
    }
  }
}

async function main() {
  const tester = new DockerTester()
  
  try {
    await tester.runAllTests()
  } catch (error) {
    console.error('❌ Docker test failed:', error)
    await tester.cleanup()
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}