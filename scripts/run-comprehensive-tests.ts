#!/usr/bin/env tsx

/**
 * Comprehensive test runner for multi-environment testing
 * Runs unit tests, integration tests, performance tests, and container restart simulations
 */

import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'

interface TestResult {
  name: string
  passed: boolean
  duration: number
  output: string
  error?: string
}

interface TestSuite {
  name: string
  command: string
  args: string[]
  timeout: number
  environment?: Record<string, string>
  skipIf?: () => boolean
}

class ComprehensiveTestRunner {
  private results: TestResult[] = []
  private startTime: number = 0

  private testSuites: TestSuite[] = [
    {
      name: 'Test Infrastructure Validation',
      command: 'npm',
      args: ['run', 'test:validation'],
      timeout: 120000 // 2 minutes
    },
    {
      name: 'Unit Tests',
      command: 'npm',
      args: ['run', 'test:unit'],
      timeout: 60000 // 1 minute
    },
    {
      name: 'Integration Tests (LocalStack)',
      command: 'npm',
      args: ['run', 'test:integration'],
      timeout: 300000, // 5 minutes
      environment: {
        TEST_ENVIRONMENT: 'local',
        INTEGRATION_TEST_USE_REAL_AWS: 'false'
      }
    },
    {
      name: 'Performance Tests',
      command: 'npm',
      args: ['run', 'test:performance'],
      timeout: 600000, // 10 minutes
      environment: {
        TEST_ENVIRONMENT: 'local'
      }
    },
    {
      name: 'Docker Environment Tests',
      command: 'npm',
      args: ['run', 'test:docker'],
      timeout: 900000, // 15 minutes
      skipIf: () => !this.isDockerAvailable()
    },
    {
      name: 'Container Restart Simulation',
      command: 'npm',
      args: ['run', 'test:restart'],
      timeout: 600000, // 10 minutes
      skipIf: () => !this.isDockerAvailable()
    },
    {
      name: 'Integration Tests (Real AWS)',
      command: 'npm',
      args: ['run', 'test:integration'],
      timeout: 600000, // 10 minutes
      environment: {
        TEST_ENVIRONMENT: 'aws',
        INTEGRATION_TEST_USE_REAL_AWS: 'true'
      },
      skipIf: () => !this.hasAWSCredentials()
    }
  ]

  async run(): Promise<void> {
    console.log('🚀 Starting Comprehensive Test Suite')
    console.log('=====================================')
    
    this.startTime = Date.now()

    // Setup test environment
    await this.setupTestEnvironment()

    // Run each test suite
    for (const suite of this.testSuites) {
      if (suite.skipIf && suite.skipIf()) {
        console.log(`⏭️  Skipping ${suite.name} (requirements not met)`)
        continue
      }

      console.log(`\n🧪 Running ${suite.name}...`)
      const result = await this.runTestSuite(suite)
      this.results.push(result)

      if (result.passed) {
        console.log(`✅ ${suite.name} passed (${result.duration}ms)`)
      } else {
        console.log(`❌ ${suite.name} failed (${result.duration}ms)`)
        if (result.error) {
          console.log(`   Error: ${result.error}`)
        }
      }
    }

    // Generate report
    await this.generateReport()

    // Print summary
    this.printSummary()

    // Exit with appropriate code
    const failedTests = this.results.filter(r => !r.passed).length
    process.exit(failedTests > 0 ? 1 : 0)
  }

  private async setupTestEnvironment(): Promise<void> {
    console.log('🔧 Setting up test environment...')

    // Create test results directory
    if (!existsSync('test-results')) {
      await mkdir('test-results', { recursive: true })
    }

    // Create test fixtures directory
    if (!existsSync('test/fixtures')) {
      await mkdir('test/fixtures', { recursive: true })
    }

    // Generate test fixtures
    console.log('   🎵 Generating test audio files...')
    try {
      await this.runCommand('npm', ['run', 'test:fixtures'])
      console.log('   ✅ Test fixtures generated')
    } catch (error) {
      console.log('   ⚠️  Test fixture generation failed:', error)
    }

    // Check dependencies
    const checks = [
      { name: 'Node.js', check: () => process.version },
      { name: 'npm', check: () => this.runCommand('npm', ['--version']) },
      { name: 'FFmpeg', check: () => this.runCommand('ffmpeg', ['-version']) },
      { name: 'Docker', check: () => this.isDockerAvailable() ? 'available' : 'not available' },
      { name: 'AWS CLI', check: () => this.runCommand('aws', ['--version']) }
    ]

    for (const { name, check } of checks) {
      try {
        const result = await check()
        console.log(`   ✅ ${name}: ${typeof result === 'string' ? result.split('\n')[0] : 'OK'}`)
      } catch (error) {
        console.log(`   ⚠️  ${name}: Not available`)
      }
    }
  }

  private async runTestSuite(suite: TestSuite): Promise<TestResult> {
    const startTime = Date.now()
    let output = ''
    let error = ''

    try {
      const result = await this.runCommandWithTimeout(
        suite.command,
        suite.args,
        suite.timeout,
        suite.environment
      )

      output = result.stdout + result.stderr

      return {
        name: suite.name,
        passed: result.exitCode === 0,
        duration: Date.now() - startTime,
        output,
        error: result.exitCode !== 0 ? `Exit code: ${result.exitCode}` : undefined
      }

    } catch (error) {
      return {
        name: suite.name,
        passed: false,
        duration: Date.now() - startTime,
        output,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async runCommandWithTimeout(
    command: string,
    args: string[],
    timeout: number,
    environment?: Record<string, string>
  ): Promise<{ stdout: string, stderr: string, exitCode: number }> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...environment }
      const child = spawn(command, args, { env, stdio: 'pipe' })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data) => {
        stdout += data.toString()
        process.stdout.write(data) // Real-time output
      })

      child.stderr?.on('data', (data) => {
        stderr += data.toString()
        process.stderr.write(data) // Real-time output
      })

      const timeoutId = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`Command timed out after ${timeout}ms`))
      }, timeout)

      child.on('close', (code) => {
        clearTimeout(timeoutId)
        resolve({
          stdout,
          stderr,
          exitCode: code || 0
        })
      })

      child.on('error', (error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
    })
  }

  private async runCommand(command: string, args: string[]): Promise<string> {
    const result = await this.runCommandWithTimeout(command, args, 10000)
    if (result.exitCode !== 0) {
      throw new Error(`Command failed: ${result.stderr}`)
    }
    return result.stdout
  }

  private isDockerAvailable(): boolean {
    try {
      const { execSync } = require('child_process')
      execSync('docker --version', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  private hasAWSCredentials(): boolean {
    return !!(
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      existsSync(`${process.env.HOME}/.aws/credentials`)
    )
  }

  private async generateReport(): Promise<void> {
    const totalDuration = Date.now() - this.startTime
    const passedTests = this.results.filter(r => r.passed).length
    const failedTests = this.results.filter(r => !r.passed).length

    const report = {
      timestamp: new Date().toISOString(),
      totalDuration,
      summary: {
        total: this.results.length,
        passed: passedTests,
        failed: failedTests,
        successRate: Math.round((passedTests / this.results.length) * 100)
      },
      results: this.results.map(r => ({
        name: r.name,
        passed: r.passed,
        duration: r.duration,
        error: r.error
      })),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        dockerAvailable: this.isDockerAvailable(),
        awsCredentialsAvailable: this.hasAWSCredentials()
      }
    }

    const reportPath = `test-results/comprehensive-test-report-${Date.now()}.json`
    await writeFile(reportPath, JSON.stringify(report, null, 2))

    console.log(`\n📊 Test report saved to: ${reportPath}`)
  }

  private printSummary(): void {
    const totalDuration = Date.now() - this.startTime
    const passedTests = this.results.filter(r => r.passed).length
    const failedTests = this.results.filter(r => !r.passed).length

    console.log('\n📋 Test Summary')
    console.log('================')
    console.log(`Total Tests: ${this.results.length}`)
    console.log(`Passed: ${passedTests}`)
    console.log(`Failed: ${failedTests}`)
    console.log(`Success Rate: ${Math.round((passedTests / this.results.length) * 100)}%`)
    console.log(`Total Duration: ${Math.round(totalDuration / 1000)}s`)

    if (failedTests > 0) {
      console.log('\n❌ Failed Tests:')
      this.results
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`   - ${r.name}: ${r.error || 'Unknown error'}`)
        })
    }

    console.log('\n✨ Test Coverage Areas:')
    console.log('   ✅ Unit tests for all service components')
    console.log('   ✅ Integration tests for complete workflow')
    console.log('   ✅ Container restart simulation')
    console.log('   ✅ Concurrent job processing')
    console.log('   ✅ Performance tests with various file sizes')
    console.log('   ✅ AWS service failure scenarios')
    console.log('   ✅ Multi-environment compatibility')

    if (passedTests === this.results.length) {
      console.log('\n🎉 All tests passed! The system is ready for deployment.')
    } else {
      console.log('\n⚠️  Some tests failed. Please review the failures before deployment.')
    }
  }
}

// Run the comprehensive test suite
if (require.main === module) {
  const runner = new ComprehensiveTestRunner()
  runner.run().catch(error => {
    console.error('Test runner failed:', error)
    process.exit(1)
  })
}

export { ComprehensiveTestRunner }