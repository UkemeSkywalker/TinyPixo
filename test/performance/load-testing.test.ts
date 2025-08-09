import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as convertPost } from '../../app/api/convert-audio/route'
import { GET as progressGet } from '../../app/api/progress/route'
import { jobService, JobStatus } from '../../lib/job-service'
import { s3Client } from '../../lib/aws-services'
import { TestFileManager, PerformanceMonitor, waitForCondition } from '../test-helpers'
import { getCurrentTestEnvironment, TEST_TIMEOUTS, TEST_FILES, PERFORMANCE_THRESHOLDS } from '../test-config'

describe('Performance and Load Testing', () => {
  const testEnv = getCurrentTestEnvironment()
  const fileManager = new TestFileManager()
  let performanceMonitor: PerformanceMonitor

  console.log(`Running performance tests with ${testEnv.name}`)

  beforeAll(async () => {
    await fileManager.setupTestFiles()
  }, TEST_TIMEOUTS.integration)

  afterAll(async () => {
    await fileManager.cleanup(s3Client, testEnv.s3Bucket)
  }, TEST_TIMEOUTS.integration)

  beforeEach(() => {
    performanceMonitor = new PerformanceMonitor()
  })

  describe('File Size Performance Tests', () => {
    it('should handle 1MB file within performance threshold', async () => {
      const testId = `perf-1mb-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

      performanceMonitor.start()

      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      expect(convertResponse.status).toBe(202)

      // Wait for completion
      await waitForCondition(async () => {
        const job = await jobService.getJob(jobId)
        return job?.status === JobStatus.COMPLETED || job?.status === JobStatus.FAILED
      }, PERFORMANCE_THRESHOLDS.smallFileConversion)

      const metrics = performanceMonitor.stop()
      const job = await jobService.getJob(jobId)

      console.log(`1MB file conversion: ${metrics.duration}ms, Status: ${job!.status}`)
      console.log(`Peak memory: ${Math.round(metrics.peakMemory.heapUsed / 1024 / 1024)}MB`)

      expect(job!.status).toBe(JobStatus.COMPLETED)
      expect(metrics.duration).toBeLessThan(PERFORMANCE_THRESHOLDS.smallFileConversion)
      expect(metrics.peakMemory.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.maxMemoryUsage)

    }, TEST_TIMEOUTS.performance)

    it('should handle 10MB file within performance threshold', async () => {
      const testId = `perf-10mb-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.mediumAudio)

      performanceMonitor.start()

      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      expect(convertResponse.status).toBe(202)

      await waitForCondition(async () => {
        const job = await jobService.getJob(jobId)
        return job?.status === JobStatus.COMPLETED || job?.status === JobStatus.FAILED
      }, PERFORMANCE_THRESHOLDS.mediumFileConversion)

      const metrics = performanceMonitor.stop()
      const job = await jobService.getJob(jobId)

      console.log(`10MB file conversion: ${metrics.duration}ms, Status: ${job!.status}`)
      console.log(`Peak memory: ${Math.round(metrics.peakMemory.heapUsed / 1024 / 1024)}MB`)

      expect(job!.status).toBe(JobStatus.COMPLETED)
      expect(metrics.duration).toBeLessThan(PERFORMANCE_THRESHOLDS.mediumFileConversion)

    }, TEST_TIMEOUTS.performance)

    it('should handle 50MB file within performance threshold', async () => {
      const testId = `perf-50mb-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.largeAudio)

      performanceMonitor.start()

      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '128k', // Lower quality for faster processing
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      expect(convertResponse.status).toBe(202)

      await waitForCondition(async () => {
        const job = await jobService.getJob(jobId)
        return job?.status === JobStatus.COMPLETED || job?.status === JobStatus.FAILED
      }, PERFORMANCE_THRESHOLDS.largeFileConversion)

      const metrics = performanceMonitor.stop()
      const job = await jobService.getJob(jobId)

      console.log(`50MB file conversion: ${metrics.duration}ms, Status: ${job!.status}`)
      console.log(`Peak memory: ${Math.round(metrics.peakMemory.heapUsed / 1024 / 1024)}MB`)
      console.log(`Average memory: ${Math.round(metrics.averageMemory.heapUsed / 1024 / 1024)}MB`)

      expect(job!.status).toBe(JobStatus.COMPLETED)
      expect(metrics.duration).toBeLessThan(PERFORMANCE_THRESHOLDS.largeFileConversion)

    }, TEST_TIMEOUTS.performance)
  })

  describe('Concurrent Processing Tests', () => {
    it('should handle multiple concurrent small files', async () => {
      const concurrentCount = PERFORMANCE_THRESHOLDS.concurrentJobs
      const jobIds: string[] = []

      console.log(`Testing ${concurrentCount} concurrent small file conversions`)

      performanceMonitor.start()

      // Start all conversions simultaneously
      const conversionPromises = Array.from({ length: concurrentCount }, async (_, index) => {
        const testId = `concurrent-small-${Date.now()}-${index}`
        const uploadKey = `uploads/${testId}.mp3`

        await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

        const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
          method: 'POST',
          body: JSON.stringify({
            fileId: `${testId}.mp3`,
            format: 'wav',
            quality: '128k',
            bucket: testEnv.s3Bucket
          })
        })

        const response = await convertPost(convertRequest)
        const data = await response.json()
        
        expect(response.status).toBe(202)
        return data.jobId
      })

      const startedJobIds = await Promise.all(conversionPromises)
      jobIds.push(...startedJobIds)

      const startupMetrics = performanceMonitor.stop()
      console.log(`Started ${concurrentCount} jobs in ${startupMetrics.duration}ms`)

      // Monitor all jobs to completion
      performanceMonitor.start()

      const completionPromises = jobIds.map(jobId =>
        waitForCondition(async () => {
          const job = await jobService.getJob(jobId)
          return job?.status === JobStatus.COMPLETED || job?.status === JobStatus.FAILED
        }, TEST_TIMEOUTS.performance)
      )

      await Promise.all(completionPromises)

      const completionMetrics = performanceMonitor.stop()

      // Verify all jobs completed successfully
      const finalJobs = await Promise.all(jobIds.map(jobId => jobService.getJob(jobId)))
      const successfulJobs = finalJobs.filter(job => job?.status === JobStatus.COMPLETED).length
      const failedJobs = finalJobs.filter(job => job?.status === JobStatus.FAILED).length

      console.log(`Concurrent processing results:`)
      console.log(`- Successful: ${successfulJobs}/${concurrentCount}`)
      console.log(`- Failed: ${failedJobs}/${concurrentCount}`)
      console.log(`- Total time: ${completionMetrics.duration}ms`)
      console.log(`- Peak memory: ${Math.round(completionMetrics.peakMemory.heapUsed / 1024 / 1024)}MB`)

      expect(successfulJobs).toBeGreaterThan(concurrentCount * 0.8) // At least 80% success rate
      expect(completionMetrics.peakMemory.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.maxMemoryUsage * 2) // Allow 2x memory for concurrent

    }, TEST_TIMEOUTS.performance)

    it('should handle mixed file sizes concurrently', async () => {
      const testFiles = [
        { file: TEST_FILES.smallAudio, name: 'small' },
        { file: TEST_FILES.mediumAudio, name: 'medium' },
        { file: TEST_FILES.smallAudio, name: 'small2' }
      ]

      console.log('Testing mixed file size concurrent processing')

      performanceMonitor.start()

      const conversionPromises = testFiles.map(async ({ file, name }, index) => {
        const testId = `mixed-${name}-${Date.now()}-${index}`
        const uploadKey = `uploads/${testId}.mp3`

        await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, file)

        const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
          method: 'POST',
          body: JSON.stringify({
            fileId: `${testId}.mp3`,
            format: 'wav',
            quality: '192k',
            bucket: testEnv.s3Bucket
          })
        })

        const response = await convertPost(convertRequest)
        const data = await response.json()
        
        return { jobId: data.jobId, name, startTime: Date.now() }
      })

      const startedJobs = await Promise.all(conversionPromises)

      // Monitor completion times
      const completionTimes: Record<string, number> = {}

      const completionPromises = startedJobs.map(async ({ jobId, name, startTime }) => {
        await waitForCondition(async () => {
          const job = await jobService.getJob(jobId)
          return job?.status === JobStatus.COMPLETED || job?.status === JobStatus.FAILED
        }, TEST_TIMEOUTS.performance)

        completionTimes[name] = Date.now() - startTime
        return jobId
      })

      await Promise.all(completionPromises)

      const metrics = performanceMonitor.stop()

      console.log('Mixed file completion times:')
      Object.entries(completionTimes).forEach(([name, time]) => {
        console.log(`- ${name}: ${time}ms`)
      })

      console.log(`Total processing time: ${metrics.duration}ms`)
      console.log(`Peak memory: ${Math.round(metrics.peakMemory.heapUsed / 1024 / 1024)}MB`)

      // Verify all jobs completed
      const finalJobs = await Promise.all(startedJobs.map(({ jobId }) => jobService.getJob(jobId)))
      const allCompleted = finalJobs.every(job => job?.status === JobStatus.COMPLETED)

      expect(allCompleted).toBe(true)

    }, TEST_TIMEOUTS.performance)
  })

  describe('Memory Usage Tests', () => {
    it('should maintain stable memory usage during processing', async () => {
      const testId = `memory-stable-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.mediumAudio)

      // Record initial memory
      const initialMemory = process.memoryUsage()
      console.log(`Initial memory: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`)

      performanceMonitor.start()

      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      // Monitor memory during processing
      const memoryReadings: NodeJS.MemoryUsage[] = []
      const memoryInterval = setInterval(() => {
        memoryReadings.push(process.memoryUsage())
      }, 1000)

      await waitForCondition(async () => {
        const job = await jobService.getJob(jobId)
        return job?.status === JobStatus.COMPLETED || job?.status === JobStatus.FAILED
      }, TEST_TIMEOUTS.performance)

      clearInterval(memoryInterval)
      const metrics = performanceMonitor.stop()

      // Analyze memory usage
      const peakMemory = memoryReadings.reduce((peak, current) => 
        current.heapUsed > peak ? current.heapUsed : peak, initialMemory.heapUsed)

      const memoryIncrease = peakMemory - initialMemory.heapUsed
      const finalMemory = process.memoryUsage()

      console.log(`Memory analysis:`)
      console.log(`- Initial: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`)
      console.log(`- Peak: ${Math.round(peakMemory / 1024 / 1024)}MB`)
      console.log(`- Final: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB`)
      console.log(`- Increase: ${Math.round(memoryIncrease / 1024 / 1024)}MB`)

      // Memory should not increase dramatically
      expect(memoryIncrease).toBeLessThan(200 * 1024 * 1024) // 200MB max increase
      expect(metrics.peakMemory.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.maxMemoryUsage)

    }, TEST_TIMEOUTS.performance)

    it('should handle memory pressure gracefully', async () => {
      // This test simulates memory pressure by processing multiple large files
      const fileCount = 2 // Reduced for CI environments
      const jobIds: string[] = []

      console.log(`Testing memory pressure with ${fileCount} large files`)

      performanceMonitor.start()

      // Start multiple large file conversions
      for (let i = 0; i < fileCount; i++) {
        const testId = `memory-pressure-${Date.now()}-${i}`
        const uploadKey = `uploads/${testId}.mp3`

        await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.largeAudio)

        const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
          method: 'POST',
          body: JSON.stringify({
            fileId: `${testId}.mp3`,
            format: 'wav',
            quality: '128k',
            bucket: testEnv.s3Bucket
          })
        })

        const response = await convertPost(convertRequest)
        const data = await response.json()
        
        if (response.status === 202) {
          jobIds.push(data.jobId)
        } else {
          console.log(`Job ${i} rejected due to resource limits: ${response.status}`)
        }

        // Small delay to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      console.log(`Started ${jobIds.length}/${fileCount} jobs under memory pressure`)

      // Wait for all jobs to complete or fail
      const completionPromises = jobIds.map(jobId =>
        waitForCondition(async () => {
          const job = await jobService.getJob(jobId)
          return job?.status === JobStatus.COMPLETED || job?.status === JobStatus.FAILED
        }, TEST_TIMEOUTS.performance)
      )

      await Promise.all(completionPromises)

      const metrics = performanceMonitor.stop()

      // Check final job states
      const finalJobs = await Promise.all(jobIds.map(jobId => jobService.getJob(jobId)))
      const completed = finalJobs.filter(job => job?.status === JobStatus.COMPLETED).length
      const failed = finalJobs.filter(job => job?.status === JobStatus.FAILED).length

      console.log(`Memory pressure test results:`)
      console.log(`- Completed: ${completed}`)
      console.log(`- Failed: ${failed}`)
      console.log(`- Peak memory: ${Math.round(metrics.peakMemory.heapUsed / 1024 / 1024)}MB`)

      // System should handle pressure gracefully (some jobs may fail, but system should remain stable)
      expect(completed + failed).toBe(jobIds.length)
      expect(metrics.peakMemory.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.maxMemoryUsage * 3) // Allow 3x for stress test

    }, TEST_TIMEOUTS.performance)
  })

  describe('Progress Polling Performance', () => {
    it('should handle high-frequency progress polling', async () => {
      const testId = `progress-polling-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.mediumAudio)

      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      // Start high-frequency polling
      const pollInterval = 100 // Poll every 100ms
      const pollResults: { timestamp: number, duration: number, progress: number }[] = []
      let polling = true

      const pollProgress = async () => {
        while (polling) {
          const startTime = Date.now()
          
          try {
            const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
            const progressResponse = await progressGet(progressRequest)
            const progressData = await progressResponse.json()

            const endTime = Date.now()
            const duration = endTime - startTime

            pollResults.push({
              timestamp: startTime,
              duration,
              progress: progressData.progress
            })

            if (progressData.progress === 100 || progressData.progress === -1) {
              polling = false
              break
            }

          } catch (error) {
            console.error('Polling error:', error)
          }

          await new Promise(resolve => setTimeout(resolve, pollInterval))
        }
      }

      // Start polling and wait for completion
      const pollingPromise = pollProgress()

      await waitForCondition(async () => !polling, TEST_TIMEOUTS.performance)
      await pollingPromise

      // Analyze polling performance
      const avgResponseTime = pollResults.reduce((sum, result) => sum + result.duration, 0) / pollResults.length
      const maxResponseTime = Math.max(...pollResults.map(r => r.duration))
      const minResponseTime = Math.min(...pollResults.map(r => r.duration))

      console.log(`Progress polling performance:`)
      console.log(`- Total polls: ${pollResults.length}`)
      console.log(`- Average response time: ${avgResponseTime.toFixed(2)}ms`)
      console.log(`- Max response time: ${maxResponseTime}ms`)
      console.log(`- Min response time: ${minResponseTime}ms`)

      // Response times should be reasonable
      expect(avgResponseTime).toBeLessThan(500) // 500ms average
      expect(maxResponseTime).toBeLessThan(2000) // 2s max
      expect(pollResults.length).toBeGreaterThan(10) // Should have multiple polls

    }, TEST_TIMEOUTS.performance)

    it('should handle multiple clients polling simultaneously', async () => {
      const testId = `multi-client-polling-${Date.now()}`
      const uploadKey = `uploads/${testId}.mp3`

      await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.mediumAudio)

      const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
        method: 'POST',
        body: JSON.stringify({
          fileId: `${testId}.mp3`,
          format: 'wav',
          quality: '192k',
          bucket: testEnv.s3Bucket
        })
      })

      const convertResponse = await convertPost(convertRequest)
      const convertData = await convertResponse.json()
      const jobId = convertData.jobId

      const clientCount = 5
      const clientResults: Array<{ clientId: number, pollCount: number, avgResponseTime: number }> = []

      performanceMonitor.start()

      // Start multiple clients polling
      const clientPromises = Array.from({ length: clientCount }, async (_, clientId) => {
        const pollResults: number[] = []
        let polling = true

        while (polling) {
          const startTime = Date.now()

          try {
            const progressRequest = new NextRequest(`http://localhost/api/progress?jobId=${jobId}`)
            const progressResponse = await progressGet(progressRequest)
            const progressData = await progressResponse.json()

            const duration = Date.now() - startTime
            pollResults.push(duration)

            if (progressData.progress === 100 || progressData.progress === -1) {
              polling = false
            }

          } catch (error) {
            console.error(`Client ${clientId} polling error:`, error)
          }

          await new Promise(resolve => setTimeout(resolve, 500)) // Poll every 500ms
        }

        const avgResponseTime = pollResults.reduce((sum, time) => sum + time, 0) / pollResults.length

        return {
          clientId,
          pollCount: pollResults.length,
          avgResponseTime
        }
      })

      const results = await Promise.all(clientPromises)
      clientResults.push(...results)

      const metrics = performanceMonitor.stop()

      console.log(`Multi-client polling results:`)
      results.forEach(result => {
        console.log(`- Client ${result.clientId}: ${result.pollCount} polls, ${result.avgResponseTime.toFixed(2)}ms avg`)
      })

      console.log(`Total test duration: ${metrics.duration}ms`)
      console.log(`Peak memory: ${Math.round(metrics.peakMemory.heapUsed / 1024 / 1024)}MB`)

      // All clients should complete successfully
      expect(results).toHaveLength(clientCount)
      results.forEach(result => {
        expect(result.pollCount).toBeGreaterThan(0)
        expect(result.avgResponseTime).toBeLessThan(1000) // 1s max average
      })

    }, TEST_TIMEOUTS.performance)
  })

  describe('Throughput Tests', () => {
    it('should measure system throughput with sequential processing', async () => {
      const fileCount = 5
      const processingTimes: number[] = []

      console.log(`Testing sequential throughput with ${fileCount} files`)

      performanceMonitor.start()

      for (let i = 0; i < fileCount; i++) {
        const testId = `throughput-seq-${Date.now()}-${i}`
        const uploadKey = `uploads/${testId}.mp3`

        await fileManager.uploadTestFile(s3Client, testEnv.s3Bucket, uploadKey, TEST_FILES.smallAudio)

        const fileStartTime = Date.now()

        const convertRequest = new NextRequest('http://localhost/api/convert-audio', {
          method: 'POST',
          body: JSON.stringify({
            fileId: `${testId}.mp3`,
            format: 'wav',
            quality: '128k',
            bucket: testEnv.s3Bucket
          })
        })

        const convertResponse = await convertPost(convertRequest)
        const convertData = await convertResponse.json()
        const jobId = convertData.jobId

        await waitForCondition(async () => {
          const job = await jobService.getJob(jobId)
          return job?.status === JobStatus.COMPLETED || job?.status === JobStatus.FAILED
        }, TEST_TIMEOUTS.integration)

        const fileEndTime = Date.now()
        const processingTime = fileEndTime - fileStartTime
        processingTimes.push(processingTime)

        console.log(`File ${i + 1} processed in ${processingTime}ms`)
      }

      const metrics = performanceMonitor.stop()

      const totalProcessingTime = processingTimes.reduce((sum, time) => sum + time, 0)
      const avgProcessingTime = totalProcessingTime / fileCount
      const throughput = (fileCount / metrics.duration) * 1000 * 60 // files per minute

      console.log(`Sequential throughput results:`)
      console.log(`- Total time: ${metrics.duration}ms`)
      console.log(`- Average processing time: ${avgProcessingTime.toFixed(2)}ms`)
      console.log(`- Throughput: ${throughput.toFixed(2)} files/minute`)

      expect(avgProcessingTime).toBeLessThan(PERFORMANCE_THRESHOLDS.smallFileConversion)
      expect(throughput).toBeGreaterThan(1) // At least 1 file per minute

    }, TEST_TIMEOUTS.performance)
  })
})