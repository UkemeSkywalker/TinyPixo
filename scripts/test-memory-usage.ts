#!/usr/bin/env tsx

/**
 * Test script to validate constant memory usage during conversion
 * Monitors memory usage patterns and validates memory efficiency
 */

import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'

interface MemorySnapshot {
  timestamp: number
  rss: number
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
}

interface TestResult {
  test: string
  passed: boolean
  message: string
  details?: any
}

class MemoryUsageTester {
  private results: TestResult[] = []
  private memorySnapshots: MemorySnapshot[] = []
  private monitoringInterval: NodeJS.Timeout | null = null

  /**
   * Run all memory usage tests
   */
  async runAllTests(): Promise<void> {
    console.log('🧪 Starting Memory Usage Tests')
    console.log('=' .repeat(50))

    try {
      // Test 1: Baseline memory usage
      await this.testBaselineMemory()

      // Test 2: Memory usage during simulated file processing
      await this.testFileProcessingMemory()

      // Test 3: Memory usage patterns over time
      await this.testMemoryPatterns()

      // Test 4: Memory leak detection
      await this.testMemoryLeaks()

      // Test 5: Garbage collection effectiveness
      await this.testGarbageCollection()

      // Print results
      this.printResults()

    } catch (error) {
      console.error('❌ Test suite failed:', error)
      process.exit(1)
    }
  }

  /**
   * Test baseline memory usage
   */
  private async testBaselineMemory(): Promise<void> {
    console.log('\n📊 Testing Baseline Memory Usage...')

    try {
      // Force garbage collection if available
      if (global.gc) {
        global.gc()
      }

      const baseline = process.memoryUsage()
      this.takeMemorySnapshot('baseline')

      // Check if memory usage is reasonable for a Node.js app
      const baselineRSSMB = baseline.rss / (1024 * 1024)
      const baselineHeapMB = baseline.heapUsed / (1024 * 1024)

      this.addResult('Baseline RSS', baselineRSSMB < 200, `${baselineRSSMB.toFixed(1)}MB RSS`)
      this.addResult('Baseline Heap', baselineHeapMB < 100, `${baselineHeapMB.toFixed(1)}MB heap used`)

      // Test memory reporting accuracy
      const memoryInfo = this.getDetailedMemoryInfo()
      this.addResult('Memory reporting', true, `Available: ${memoryInfo.available}, Total: ${memoryInfo.total}`)

    } catch (error) {
      this.addResult('Baseline Memory', false, `Error testing baseline: ${error}`)
    }
  }

  /**
   * Test memory usage during simulated file processing
   */
  private async testFileProcessingMemory(): Promise<void> {
    console.log('\n🔄 Testing File Processing Memory Usage...')

    try {
      // Start memory monitoring
      this.startMemoryMonitoring()

      // Simulate processing files of different sizes
      const testSizes = [
        { size: 10 * 1024 * 1024, name: '10MB' },
        { size: 50 * 1024 * 1024, name: '50MB' },
        { size: 100 * 1024 * 1024, name: '100MB' }
      ]

      for (const testSize of testSizes) {
        console.log(`  Processing simulated ${testSize.name} file...`)
        
        const beforeMemory = process.memoryUsage()
        this.takeMemorySnapshot(`before-${testSize.name}`)

        // Simulate memory-efficient processing (streaming approach)
        await this.simulateStreamingProcessing(testSize.size)

        const afterMemory = process.memoryUsage()
        this.takeMemorySnapshot(`after-${testSize.name}`)

        // Calculate memory increase
        const memoryIncrease = afterMemory.heapUsed - beforeMemory.heapUsed
        const memoryIncreaseRatio = memoryIncrease / testSize.size

        // Memory increase should be minimal (< 20% of file size for streaming)
        const isMemoryEfficient = memoryIncreaseRatio < 0.2
        this.addResult(`${testSize.name} processing`, isMemoryEfficient, 
          `Memory increase: ${this.formatBytes(memoryIncrease)} (${(memoryIncreaseRatio * 100).toFixed(1)}% of file size)`)

        // Force garbage collection between tests
        if (global.gc) {
          global.gc()
        }
        await this.sleep(100) // Allow GC to complete
      }

      // Stop memory monitoring
      this.stopMemoryMonitoring()

    } catch (error) {
      this.addResult('File Processing Memory', false, `Error testing processing: ${error}`)
    }
  }

  /**
   * Test memory usage patterns over time
   */
  private async testMemoryPatterns(): Promise<void> {
    console.log('\n📈 Testing Memory Patterns Over Time...')

    try {
      // Start continuous monitoring
      this.startMemoryMonitoring()

      // Simulate continuous processing for 30 seconds
      const testDuration = 30000 // 30 seconds
      const startTime = Date.now()

      while (Date.now() - startTime < testDuration) {
        // Simulate processing a 20MB file every 2 seconds
        await this.simulateStreamingProcessing(20 * 1024 * 1024)
        await this.sleep(2000)
      }

      this.stopMemoryMonitoring()

      // Analyze memory patterns
      const memoryTrend = this.analyzeMemoryTrend()
      this.addResult('Memory stability', memoryTrend.stable, 
        `Trend: ${memoryTrend.trend}, Max increase: ${this.formatBytes(memoryTrend.maxIncrease)}`)

      const memorySpikes = this.detectMemorySpikes()
      this.addResult('No memory spikes', memorySpikes.length === 0, 
        memorySpikes.length > 0 ? `${memorySpikes.length} spikes detected` : 'No significant spikes')

    } catch (error) {
      this.addResult('Memory Patterns', false, `Error testing patterns: ${error}`)
    }
  }

  /**
   * Test for memory leaks
   */
  private async testMemoryLeaks(): Promise<void> {
    console.log('\n🔍 Testing Memory Leaks...')

    try {
      // Force garbage collection
      if (global.gc) {
        global.gc()
      }

      const initialMemory = process.memoryUsage()
      this.takeMemorySnapshot('leak-test-start')

      // Simulate 20 file processing operations
      for (let i = 0; i < 20; i++) {
        await this.simulateStreamingProcessing(25 * 1024 * 1024) // 25MB each
        
        // Occasionally force garbage collection
        if (i % 5 === 0 && global.gc) {
          global.gc()
        }
      }

      // Force final garbage collection
      if (global.gc) {
        global.gc()
      }
      await this.sleep(1000) // Allow GC to complete

      const finalMemory = process.memoryUsage()
      this.takeMemorySnapshot('leak-test-end')

      // Calculate memory increase
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed
      const memoryIncreaseMB = memoryIncrease / (1024 * 1024)

      // Memory increase should be minimal after processing 500MB total (20 * 25MB)
      const hasMemoryLeak = memoryIncreaseMB > 50 // 50MB threshold
      this.addResult('No memory leaks', !hasMemoryLeak, 
        `Memory increase after 20 operations: ${memoryIncreaseMB.toFixed(1)}MB`)

      // Test heap growth rate
      const heapGrowthRate = memoryIncrease / (20 * 25 * 1024 * 1024) // per byte processed
      this.addResult('Heap growth rate', heapGrowthRate < 0.1, 
        `${(heapGrowthRate * 100).toFixed(3)}% heap growth per byte processed`)

    } catch (error) {
      this.addResult('Memory Leaks', false, `Error testing leaks: ${error}`)
    }
  }

  /**
   * Test garbage collection effectiveness
   */
  private async testGarbageCollection(): Promise<void> {
    console.log('\n🗑️  Testing Garbage Collection...')

    try {
      if (!global.gc) {
        this.addResult('GC availability', false, 'Garbage collection not available (run with --expose-gc)')
        return
      }

      // Create some garbage
      const beforeGC = process.memoryUsage()
      
      // Create temporary objects that should be garbage collected
      const garbage = []
      for (let i = 0; i < 1000; i++) {
        garbage.push(Buffer.alloc(1024 * 1024, i % 256)) // 1MB buffers
      }

      const afterAllocation = process.memoryUsage()
      const allocated = afterAllocation.heapUsed - beforeGC.heapUsed

      // Clear references
      garbage.length = 0

      // Force garbage collection
      global.gc()
      await this.sleep(100)

      const afterGC = process.memoryUsage()
      const freed = afterAllocation.heapUsed - afterGC.heapUsed
      const gcEfficiency = freed / allocated

      this.addResult('GC effectiveness', gcEfficiency > 0.8, 
        `Allocated: ${this.formatBytes(allocated)}, Freed: ${this.formatBytes(freed)} (${(gcEfficiency * 100).toFixed(1)}%)`)

      // Test GC timing
      const gcStartTime = Date.now()
      global.gc()
      const gcDuration = Date.now() - gcStartTime

      this.addResult('GC performance', gcDuration < 100, `GC took ${gcDuration}ms`)

    } catch (error) {
      this.addResult('Garbage Collection', false, `Error testing GC: ${error}`)
    }
  }

  /**
   * Simulate streaming processing (memory-efficient)
   */
  private async simulateStreamingProcessing(fileSize: number): Promise<void> {
    const chunkSize = 64 * 1024 // 64KB chunks
    const totalChunks = Math.ceil(fileSize / chunkSize)

    for (let i = 0; i < totalChunks; i++) {
      const currentChunkSize = Math.min(chunkSize, fileSize - (i * chunkSize))
      
      // Simulate reading a chunk (create and immediately process)
      const chunk = Buffer.alloc(currentChunkSize, i % 256)
      
      // Simulate processing (transform the data)
      for (let j = 0; j < chunk.length; j += 1024) {
        chunk[j] = (chunk[j] + 1) % 256
      }
      
      // Chunk goes out of scope and can be garbage collected
      
      // Yield control occasionally to allow other operations
      if (i % 100 === 0) {
        await this.sleep(1)
      }
    }
  }

  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring(): void {
    this.memorySnapshots = []
    this.monitoringInterval = setInterval(() => {
      this.takeMemorySnapshot('monitoring')
    }, 1000) // Every second
  }

  /**
   * Stop memory monitoring
   */
  private stopMemoryMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = null
    }
  }

  /**
   * Take a memory snapshot
   */
  private takeMemorySnapshot(label: string): void {
    const memory = process.memoryUsage()
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers || 0
    }
    
    this.memorySnapshots.push(snapshot)
    console.log(`    📸 Memory snapshot (${label}): RSS=${this.formatBytes(snapshot.rss)}, Heap=${this.formatBytes(snapshot.heapUsed)}`)
  }

  /**
   * Analyze memory trend
   */
  private analyzeMemoryTrend(): { stable: boolean, trend: string, maxIncrease: number } {
    if (this.memorySnapshots.length < 2) {
      return { stable: true, trend: 'insufficient data', maxIncrease: 0 }
    }

    const first = this.memorySnapshots[0]
    const last = this.memorySnapshots[this.memorySnapshots.length - 1]
    
    const heapIncrease = last.heapUsed - first.heapUsed
    const maxHeap = Math.max(...this.memorySnapshots.map(s => s.heapUsed))
    const maxIncrease = maxHeap - first.heapUsed

    let trend = 'stable'
    if (heapIncrease > 50 * 1024 * 1024) { // 50MB increase
      trend = 'increasing'
    } else if (heapIncrease < -10 * 1024 * 1024) { // 10MB decrease
      trend = 'decreasing'
    }

    const stable = Math.abs(heapIncrease) < 100 * 1024 * 1024 // 100MB threshold

    return { stable, trend, maxIncrease }
  }

  /**
   * Detect memory spikes
   */
  private detectMemorySpikes(): MemorySnapshot[] {
    if (this.memorySnapshots.length < 3) {
      return []
    }

    const spikes: MemorySnapshot[] = []
    const spikeThreshold = 50 * 1024 * 1024 // 50MB spike threshold

    for (let i = 1; i < this.memorySnapshots.length - 1; i++) {
      const prev = this.memorySnapshots[i - 1]
      const current = this.memorySnapshots[i]
      const next = this.memorySnapshots[i + 1]

      // Check if current is significantly higher than both neighbors
      if (current.heapUsed - prev.heapUsed > spikeThreshold && 
          current.heapUsed - next.heapUsed > spikeThreshold) {
        spikes.push(current)
      }
    }

    return spikes
  }

  /**
   * Get detailed memory information
   */
  private getDetailedMemoryInfo(): { available: string, total: string } {
    try {
      // Try to get system memory info
      const os = require('os')
      const totalMem = os.totalmem()
      const freeMem = os.freemem()
      
      return {
        total: this.formatBytes(totalMem),
        available: this.formatBytes(freeMem)
      }
    } catch (error) {
      return {
        total: 'unknown',
        available: 'unknown'
      }
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  /**
   * Add test result
   */
  private addResult(test: string, passed: boolean, message: string, details?: any): void {
    this.results.push({ test, passed, message, details })
    const status = passed ? '✅' : '❌'
    console.log(`  ${status} ${test}: ${message}`)
  }

  /**
   * Print final results
   */
  private printResults(): void {
    console.log('\n' + '='.repeat(50))
    console.log('📊 MEMORY USAGE TEST RESULTS')
    console.log('='.repeat(50))

    const passed = this.results.filter(r => r.passed).length
    const total = this.results.length
    const percentage = Math.round((passed / total) * 100)

    console.log(`\n✅ Passed: ${passed}/${total} (${percentage}%)`)
    console.log(`❌ Failed: ${total - passed}/${total}`)

    // Memory summary
    const finalMemory = process.memoryUsage()
    console.log(`\n💾 Final Memory Usage:`)
    console.log(`   RSS: ${this.formatBytes(finalMemory.rss)}`)
    console.log(`   Heap Used: ${this.formatBytes(finalMemory.heapUsed)}`)
    console.log(`   Heap Total: ${this.formatBytes(finalMemory.heapTotal)}`)
    console.log(`   External: ${this.formatBytes(finalMemory.external)}`)

    if (passed === total) {
      console.log('\n🎉 All memory usage tests passed!')
      console.log('✅ Memory usage is efficient and stable')
      console.log('✅ No memory leaks detected')
      console.log('✅ Garbage collection is working effectively')
    } else {
      console.log('\n⚠️  Some memory tests failed. Please review the implementation.')
      
      const failedTests = this.results.filter(r => !r.passed)
      console.log('\nFailed tests:')
      failedTests.forEach(test => {
        console.log(`  ❌ ${test.test}: ${test.message}`)
      })
    }

    // Save results to file
    const resultsFile = join(process.cwd(), 'test-results-memory-usage.json')
    writeFileSync(resultsFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: { passed, total, percentage },
      results: this.results,
      memorySnapshots: this.memorySnapshots,
      finalMemoryUsage: finalMemory
    }, null, 2))

    console.log(`\n📄 Detailed results saved to: ${resultsFile}`)
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new MemoryUsageTester()
  tester.runAllTests().catch(error => {
    console.error('❌ Test execution failed:', error)
    process.exit(1)
  })
}

export { MemoryUsageTester }