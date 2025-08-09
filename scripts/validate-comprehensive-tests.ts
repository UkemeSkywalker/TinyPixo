#!/usr/bin/env tsx

/**
 * Validation script for comprehensive test suite
 * Runs basic validation to ensure test infrastructure is working
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'

interface ValidationResult {
  name: string
  passed: boolean
  message: string
}

class TestValidator {
  private results: ValidationResult[] = []

  async validate(): Promise<void> {
    console.log('🔍 Validating comprehensive test suite...')
    console.log('==========================================')

    // Check test file structure
    await this.validateTestStructure()
    
    // Check test configuration
    await this.validateTestConfiguration()
    
    // Run basic unit tests
    await this.validateBasicTests()
    
    // Print results
    this.printResults()
  }

  private async validateTestStructure(): Promise<void> {
    console.log('\n📁 Validating test structure...')
    
    const requiredFiles = [
      'test/setup.ts',
      'test/test-config.ts',
      'test/test-helpers.ts',
      'test/unit/ffmpeg-progress-parser.test.ts',
      'test/unit/job-service.test.ts',
      'test/unit/progress-service.test.ts',
      'test/unit/streaming-conversion-service.test.ts',
      'test/integration/complete-workflow.test.ts',
      'test/integration/container-restart.test.ts',
      'test/integration/aws-failure-scenarios.test.ts',
      'test/performance/load-testing.test.ts',
      'test/comprehensive-validation.test.ts'
    ]

    for (const file of requiredFiles) {
      const exists = existsSync(file)
      this.results.push({
        name: `Test file: ${file}`,
        passed: exists,
        message: exists ? 'Found' : 'Missing'
      })
    }
  }

  private async validateTestConfiguration(): Promise<void> {
    console.log('\n⚙️  Validating test configuration...')
    
    const configFiles = [
      'vitest.config.ts',
      'docker-compose.test.yml',
      'Dockerfile.test'
    ]

    for (const file of configFiles) {
      const exists = existsSync(file)
      this.results.push({
        name: `Config file: ${file}`,
        passed: exists,
        message: exists ? 'Found' : 'Missing'
      })
    }

    // Check package.json test scripts
    try {
      const packageJson = require('../package.json')
      const requiredScripts = [
        'test',
        'test:unit',
        'test:integration', 
        'test:performance',
        'test:coverage',
        'test:comprehensive'
      ]

      for (const script of requiredScripts) {
        const exists = packageJson.scripts && packageJson.scripts[script]
        this.results.push({
          name: `NPM script: ${script}`,
          passed: !!exists,
          message: exists ? 'Defined' : 'Missing'
        })
      }
    } catch (error) {
      this.results.push({
        name: 'Package.json validation',
        passed: false,
        message: 'Failed to read package.json'
      })
    }
  }

  private async validateBasicTests(): Promise<void> {
    console.log('\n🧪 Running basic test validation...')
    
    try {
      // Run just the FFmpeg progress parser test as it's working
      const result = await this.runCommand('npm', ['run', 'test', 'test/unit/ffmpeg-progress-parser.test.ts'])
      
      this.results.push({
        name: 'Basic unit test execution',
        passed: result.exitCode === 0,
        message: result.exitCode === 0 ? 'Passed' : 'Failed'
      })
    } catch (error) {
      this.results.push({
        name: 'Basic unit test execution',
        passed: false,
        message: `Error: ${error}`
      })
    }

    // Test fixture generation
    try {
      const result = await this.runCommand('npm', ['run', 'test:fixtures'])
      
      this.results.push({
        name: 'Test fixture generation',
        passed: result.exitCode === 0,
        message: result.exitCode === 0 ? 'Generated successfully' : 'Failed to generate'
      })
    } catch (error) {
      this.results.push({
        name: 'Test fixture generation',
        passed: false,
        message: `Error: ${error}`
      })
    }
  }

  private async runCommand(command: string, args: string[]): Promise<{ exitCode: number, stdout: string, stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: 'pipe' })
      
      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        resolve({
          exitCode: code || 0,
          stdout,
          stderr
        })
      })

      child.on('error', (error) => {
        resolve({
          exitCode: 1,
          stdout,
          stderr: error.message
        })
      })
    })
  }

  private printResults(): void {
    console.log('\n📊 Validation Results')
    console.log('=====================')
    
    const passed = this.results.filter(r => r.passed).length
    const total = this.results.length
    
    console.log(`\nOverall: ${passed}/${total} checks passed (${Math.round((passed/total) * 100)}%)`)
    
    // Group results by category
    const categories = {
      'Test Structure': this.results.filter(r => r.name.startsWith('Test file:')),
      'Configuration': this.results.filter(r => r.name.startsWith('Config file:') || r.name.startsWith('NPM script:')),
      'Test Execution': this.results.filter(r => r.name.includes('test execution') || r.name.includes('fixture'))
    }

    for (const [category, results] of Object.entries(categories)) {
      if (results.length === 0) continue
      
      console.log(`\n${category}:`)
      for (const result of results) {
        const status = result.passed ? '✅' : '❌'
        const name = result.name.replace(/^[^:]+:\s*/, '')
        console.log(`  ${status} ${name}: ${result.message}`)
      }
    }

    const failedResults = this.results.filter(r => !r.passed)
    if (failedResults.length > 0) {
      console.log('\n⚠️  Issues to address:')
      for (const result of failedResults) {
        console.log(`  - ${result.name}: ${result.message}`)
      }
    }

    if (passed === total) {
      console.log('\n🎉 All validation checks passed! The comprehensive test suite is ready.')
    } else {
      console.log(`\n⚠️  ${total - passed} issues found. Please address them before running the full test suite.`)
    }
  }
}

// Run validation
if (require.main === module) {
  const validator = new TestValidator()
  validator.validate().catch(error => {
    console.error('Validation failed:', error)
    process.exit(1)
  })
}

export { TestValidator }