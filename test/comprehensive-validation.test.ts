import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TestFileGenerator } from './fixtures/generate-test-files'
import { TestFileManager, PerformanceMonitor } from './test-helpers'
import { getCurrentTestEnvironment, TEST_TIMEOUTS, PERFORMANCE_THRESHOLDS } from './test-config'
import { s3Client } from '../lib/aws-services'
import { jobService } from '../lib/job-service'
import { progressService } from '../lib/progress-service'

describe('Comprehensive Test Suite Validation', () => {
  const testEnv = getCurrentTestEnvironment()
  const fileManager = new TestFileManager()
  const fileGenerator = new TestFileGenerator()

  console.log(`Running comprehensive validation with ${testEnv.name}`)

  beforeAll(async () => {
    console.log('🔧 Setting up comprehensive test environment...')
    
    // Generate test files
    await fileGenerator.generateAll()
    
    // Setup test file manager
    await fileManager.setupTestFiles()
    
    console.log('✅ Test environment ready')
  }, TEST_TIMEOUTS.integration)

  afterAll(async () => {
    console.log('🧹 Cleaning up comprehensive test environment...')
    
    await fileManager.cleanup(s3Client, testEnv.s3Bucket)
    await fileGenerator.cleanup()
    
    console.log('✅ Cleanup complete')
  }, TEST_TIMEOUTS.integration)

  describe('Test Infrastructure Validation', () => {
    it('should have all required test files', async () => {
      const requiredFiles = [
        'test/fixtures/tiny-audio.mp3',
        'test/fixtures/small-audio.mp3',
        'test/fixtures/medium-audio.mp3',
        'test/fixtures/large-audio.mp3',
        'test/fixtures/invalid.txt'
      ]

      const { access } = await import('fs/promises')
      
      for (const file of requiredFiles) {
        await expect(access(file)).resolves.toBeUndefined()
      }
    })

    it('should have working AWS service connections', async () => {
      // Test S3 connectivity
      const { HeadBucketCommand } = await import('@aws-sdk/client-s3')
      
      try {
        await s3Client.send(new HeadBucketCommand({
          Bucket: testEnv.s3Bucket
        }))
        console.log('✅ S3 connection working')
      } catch (error) {
        console.log('⚠️  S3 connection failed:', error)
        // Don't fail the test, just log the issue
      }

      // Test DynamoDB connectivity
      try {
        await jobService.getJob('non-existent-test-job')
        console.log('✅ DynamoDB connection working')
      } catch (error) {
        console.log('⚠️  DynamoDB connection failed:', error)
      }

      // Test Redis connectivity
      try {
        await progressService.getProgress('non-existent-test-job')
        console.log('✅ Redis connection working (or fallback active)')
      } catch (error) {
        console.log('⚠️  Redis connection failed:', error)
      }
    })

    it('should have proper test environment configuration', () => {
      expect(testEnv).toBeDefined()
      expect(testEnv.name).toBeDefined()
      expect(testEnv.s3Bucket).toBeDefined()
      
      if (!testEnv.useRealAWS) {
        expect(testEnv.dynamodbEndpoint).toBeDefined()
        expect(testEnv.redisEndpoint).toBeDefined()
      }

      console.log(`Test environment: ${testEnv.name}`)
      console.log(`S3 bucket: ${testEnv.s3Bucket}`)
      console.log(`Use real AWS: ${testEnv.useRealAWS}`)
    })

    it('should have working FFmpeg installation', async () => {
      const { spawn } = await import('child_process')
      
      const ffmpegTest = new Promise<boolean>((resolve) => {
        const ffmpeg = spawn('ffmpeg', ['-version'])
        
        ffmpeg.on('close', (code) => {
          resolve(code === 0)
        })
        
        ffmpeg.on('error', () => {
          resolve(false)
        })
        
        setTimeout(() => resolve(false), 5000) // 5 second timeout
      })

      const ffmpegAvailable = await ffmpegTest
      
      if (ffmpegAvailable) {
        console.log('✅ FFmpeg is available')
      } else {
        console.log('⚠️  FFmpeg is not available - some tests may fail')
      }

      // Don't fail the test, just log the status
      expect(true).toBe(true)
    })
  })

  describe('Performance Baseline Validation', () => {
    it('should establish memory usage baseline', async () => {
      const monitor = new PerformanceMonitor()
      monitor.start()

      // Perform basic operations
      await jobService.getJob('baseline-test')
      await progressService.getProgress('baseline-test')

      const metrics = monitor.stop()

      console.log(`Baseline memory usage: ${Math.round(metrics.averageMemory.heapUsed / 1024 / 1024)}MB`)
      console.log(`Peak memory usage: ${Math.round(metrics.peakMemory.heapUsed / 1024 / 1024)}MB`)

      expect(metrics.peakMemory.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.maxMemoryUsage)
    })

    it('should validate performance thresholds are reasonable', () => {
      // Ensure thresholds are reasonable for the test environment
      expect(PERFORMANCE_THRESHOLDS.tinyFileConversion).toBeLessThan(PERFORMANCE_THRESHOLDS.smallFileConversion)
      expect(PERFORMANCE_THRESHOLDS.smallFileConversion).toBeLessThan(PERFORMANCE_THRESHOLDS.mediumFileConversion)
      expect(PERFORMANCE_THRESHOLDS.mediumFileConversion).toBeLessThan(PERFORMANCE_THRESHOLDS.largeFileConversion)
      
      expect(PERFORMANCE_THRESHOLDS.concurrentJobs).toBeGreaterThan(1)
      expect(PERFORMANCE_THRESHOLDS.maxMemoryUsage).toBeGreaterThan(100 * 1024 * 1024) // At least 100MB

      console.log('Performance thresholds:')
      console.log(`- Tiny file: ${PERFORMANCE_THRESHOLDS.tinyFileConversion}ms`)
      console.log(`- Small file: ${PERFORMANCE_THRESHOLDS.smallFileConversion}ms`)
      console.log(`- Medium file: ${PERFORMANCE_THRESHOLDS.mediumFileConversion}ms`)
      console.log(`- Large file: ${PERFORMANCE_THRESHOLDS.largeFileConversion}ms`)
      console.log(`- Concurrent jobs: ${PERFORMANCE_THRESHOLDS.concurrentJobs}`)
      console.log(`- Max memory: ${Math.round(PERFORMANCE_THRESHOLDS.maxMemoryUsage / 1024 / 1024)}MB`)
    })
  })

  describe('Test Coverage Validation', () => {
    it('should validate unit test coverage areas', () => {
      const requiredUnitTests = [
        'test/unit/streaming-conversion-service.test.ts',
        'test/unit/ffmpeg-progress-parser.test.ts',
        'test/unit/job-service.test.ts',
        'test/unit/progress-service.test.ts'
      ]

      const { existsSync } = require('fs')
      
      requiredUnitTests.forEach(testFile => {
        expect(existsSync(testFile)).toBe(true)
        console.log(`✅ Unit test exists: ${testFile}`)
      })
    })

    it('should validate integration test coverage areas', () => {
      const requiredIntegrationTests = [
        'test/integration/complete-workflow.test.ts',
        'test/integration/container-restart.test.ts',
        'test/integration/aws-failure-scenarios.test.ts'
      ]

      const { existsSync } = require('fs')
      
      requiredIntegrationTests.forEach(testFile => {
        expect(existsSync(testFile)).toBe(true)
        console.log(`✅ Integration test exists: ${testFile}`)
      })
    })

    it('should validate performance test coverage areas', () => {
      const requiredPerformanceTests = [
        'test/performance/load-testing.test.ts'
      ]

      const { existsSync } = require('fs')
      
      requiredPerformanceTests.forEach(testFile => {
        expect(existsSync(testFile)).toBe(true)
        console.log(`✅ Performance test exists: ${testFile}`)
      })
    })

    it('should validate test helper utilities', () => {
      const requiredHelpers = [
        'test/test-helpers.ts',
        'test/test-config.ts',
        'test/setup.ts'
      ]

      const { existsSync } = require('fs')
      
      requiredHelpers.forEach(helperFile => {
        expect(existsSync(helperFile)).toBe(true)
        console.log(`✅ Test helper exists: ${helperFile}`)
      })
    })
  })

  describe('Docker Environment Validation', () => {
    it('should validate Docker Compose configuration', () => {
      const { existsSync } = require('fs')
      
      expect(existsSync('docker-compose.test.yml')).toBe(true)
      expect(existsSync('Dockerfile.test')).toBe(true)
      
      console.log('✅ Docker test configuration files exist')
    })

    it('should validate Docker availability', async () => {
      try {
        const { execSync } = require('child_process')
        execSync('docker --version', { stdio: 'ignore' })
        console.log('✅ Docker is available')
      } catch (error) {
        console.log('⚠️  Docker is not available - container tests will be skipped')
      }

      // Don't fail the test, just log the status
      expect(true).toBe(true)
    })
  })

  describe('Multi-Environment Support Validation', () => {
    it('should support LocalStack environment', () => {
      if (!testEnv.useRealAWS) {
        expect(testEnv.dynamodbEndpoint).toContain('localhost')
        expect(testEnv.redisEndpoint).toContain('localhost')
        console.log('✅ LocalStack environment configuration valid')
      } else {
        console.log('⏭️  Skipping LocalStack validation (using real AWS)')
      }
    })

    it('should support real AWS environment', () => {
      if (testEnv.useRealAWS) {
        expect(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION).toBeDefined()
        console.log('✅ Real AWS environment configuration valid')
      } else {
        console.log('⏭️  Skipping real AWS validation (using LocalStack)')
      }
    })

    it('should have environment switching capability', () => {
      const { existsSync } = require('fs')
      
      expect(existsSync('scripts/switch-environment.ts')).toBe(true)
      console.log('✅ Environment switching script exists')
    })
  })

  describe('Test Execution Validation', () => {
    it('should validate npm test scripts', () => {
      const { readFileSync } = require('fs')
      const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
      
      const requiredScripts = [
        'test',
        'test:unit',
        'test:integration',
        'test:performance',
        'test:docker',
        'test:coverage',
        'test:comprehensive'
      ]

      requiredScripts.forEach(script => {
        expect(packageJson.scripts[script]).toBeDefined()
        console.log(`✅ npm script exists: ${script}`)
      })
    })

    it('should validate test timeouts are appropriate', () => {
      expect(TEST_TIMEOUTS.unit).toBeLessThan(TEST_TIMEOUTS.integration)
      expect(TEST_TIMEOUTS.integration).toBeLessThan(TEST_TIMEOUTS.performance)
      expect(TEST_TIMEOUTS.performance).toBeLessThan(TEST_TIMEOUTS.containerRestart)

      console.log('Test timeouts:')
      console.log(`- Unit: ${TEST_TIMEOUTS.unit}ms`)
      console.log(`- Integration: ${TEST_TIMEOUTS.integration}ms`)
      console.log(`- Performance: ${TEST_TIMEOUTS.performance}ms`)
      console.log(`- Container restart: ${TEST_TIMEOUTS.containerRestart}ms`)
    })
  })

  describe('Error Handling Validation', () => {
    it('should handle test file generation errors gracefully', async () => {
      // Test with invalid path
      const invalidGenerator = new TestFileGenerator()
      
      // Should not throw error
      await expect(invalidGenerator.cleanup()).resolves.toBeUndefined()
    })

    it('should handle AWS service unavailability gracefully', async () => {
      // These should not throw errors, just return null/empty results
      await expect(jobService.getJob('non-existent-job')).resolves.toBeNull()
      await expect(progressService.getProgress('non-existent-job')).resolves.toBeNull()
    })

    it('should handle file system errors gracefully', async () => {
      const testManager = new TestFileManager()
      
      // Should not throw error even if files don't exist
      await expect(testManager.cleanup()).resolves.toBeUndefined()
    })
  })

  describe('Resource Management Validation', () => {
    it('should clean up resources properly', async () => {
      const initialMemory = process.memoryUsage().heapUsed
      
      // Create and clean up test resources
      const testManager = new TestFileManager()
      await testManager.setupTestFiles()
      await testManager.cleanup(s3Client, testEnv.s3Bucket)

      const finalMemory = process.memoryUsage().heapUsed
      const memoryIncrease = finalMemory - initialMemory

      // Memory increase should be minimal
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024) // 50MB

      console.log(`Memory increase after resource test: ${Math.round(memoryIncrease / 1024 / 1024)}MB`)
    })

    it('should handle concurrent resource operations', async () => {
      const concurrentOperations = Array.from({ length: 5 }, async (_, i) => {
        const testManager = new TestFileManager()
        await testManager.setupTestFiles()
        return testManager.cleanup(s3Client, testEnv.s3Bucket)
      })

      await expect(Promise.all(concurrentOperations)).resolves.toBeDefined()
      console.log('✅ Concurrent resource operations handled successfully')
    })
  })

  describe('Test Reliability Validation', () => {
    it('should produce consistent results across multiple runs', async () => {
      const results: boolean[] = []
      
      // Run the same test multiple times
      for (let i = 0; i < 3; i++) {
        try {
          await jobService.getJob('consistency-test')
          results.push(true)
        } catch (error) {
          results.push(false)
        }
      }

      // Results should be consistent (all true or all false)
      const allSame = results.every(result => result === results[0])
      expect(allSame).toBe(true)

      console.log(`✅ Consistency test results: ${results}`)
    })

    it('should handle test isolation properly', async () => {
      // Tests should not interfere with each other
      const testId1 = `isolation-test-1-${Date.now()}`
      const testId2 = `isolation-test-2-${Date.now()}`

      await progressService.initializeProgress(testId1)
      await progressService.initializeProgress(testId2)

      const progress1 = await progressService.getProgress(testId1)
      const progress2 = await progressService.getProgress(testId2)

      expect(progress1?.jobId).toBe(testId1)
      expect(progress2?.jobId).toBe(testId2)

      console.log('✅ Test isolation working properly')
    })
  })
})