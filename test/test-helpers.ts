/**
 * Test helper utilities for multi-environment testing
 */

import { createReadStream, createWriteStream, existsSync } from 'fs'
import { mkdir, writeFile, unlink, access } from 'fs/promises'
import { join, dirname } from 'path'
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getCurrentTestEnvironment, TEST_FILES } from './test-config'

export class TestFileManager {
  private uploadedFiles: string[] = []
  private createdFiles: string[] = []

  async createTestAudioFile(filePath: string, sizeInMB: number): Promise<void> {
    const dir = dirname(filePath)
    await mkdir(dir, { recursive: true })

    // Create a simple audio file header (MP3)
    const mp3Header = Buffer.from([
      0xFF, 0xFB, 0x90, 0x00, // MP3 frame header
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ])

    // Create file with specified size
    const targetSize = sizeInMB * 1024 * 1024
    const chunkSize = 1024
    const writeStream = createWriteStream(filePath)

    writeStream.write(mp3Header)
    let written = mp3Header.length

    while (written < targetSize) {
      const remainingBytes = Math.min(chunkSize, targetSize - written)
      const chunk = Buffer.alloc(remainingBytes, 0x00)
      writeStream.write(chunk)
      written += remainingBytes
    }

    writeStream.end()
    this.createdFiles.push(filePath)

    return new Promise((resolve, reject) => {
      writeStream.on('finish', resolve)
      writeStream.on('error', reject)
    })
  }

  async setupTestFiles(): Promise<void> {
    // Create test fixtures directory
    await mkdir('test/fixtures', { recursive: true })

    // Create test audio files of different sizes
    if (!existsSync(TEST_FILES.smallAudio)) {
      await this.createTestAudioFile(TEST_FILES.smallAudio, 1) // 1MB
    }

    if (!existsSync(TEST_FILES.mediumAudio)) {
      await this.createTestAudioFile(TEST_FILES.mediumAudio, 10) // 10MB
    }

    if (!existsSync(TEST_FILES.largeAudio)) {
      await this.createTestAudioFile(TEST_FILES.largeAudio, 50) // 50MB
    }

    // Create invalid file
    if (!existsSync(TEST_FILES.invalidFile)) {
      await writeFile(TEST_FILES.invalidFile, 'This is not an audio file')
      this.createdFiles.push(TEST_FILES.invalidFile)
    }
  }

  async uploadTestFile(s3Client: S3Client, bucket: string, key: string, filePath: string): Promise<void> {
    const fileStream = createReadStream(filePath)
    
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: 'audio/mpeg'
    }))

    this.uploadedFiles.push(key)
  }

  async cleanup(s3Client?: S3Client, bucket?: string): Promise<void> {
    // Clean up S3 files
    if (s3Client && bucket) {
      const cleanupPromises = this.uploadedFiles.map(async (key) => {
        try {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: key
          }))
        } catch (error) {
          console.warn(`Failed to clean up S3 file ${key}:`, error)
        }
      })

      await Promise.all(cleanupPromises)
    }

    // Clean up local files
    const fileCleanupPromises = this.createdFiles.map(async (filePath) => {
      try {
        await unlink(filePath)
      } catch (error) {
        // Silently ignore file not found errors during cleanup
        if (error.code !== 'ENOENT') {
          console.warn(`Failed to clean up local file ${filePath}:`, error)
        }
      }
    })

    await Promise.all(fileCleanupPromises)

    this.uploadedFiles = []
    this.createdFiles = []
  }

  getUploadedFiles(): string[] {
    return [...this.uploadedFiles]
  }
}

export class ContainerRestartSimulator {
  private originalProcessExit: typeof process.exit
  private restartCallbacks: (() => Promise<void>)[] = []

  constructor() {
    this.originalProcessExit = process.exit
  }

  onRestart(callback: () => Promise<void>): void {
    this.restartCallbacks.push(callback)
  }

  async simulateRestart(): Promise<void> {
    console.log('Simulating container restart...')
    
    // Execute restart callbacks
    for (const callback of this.restartCallbacks) {
      try {
        await callback()
      } catch (error) {
        console.error('Error during restart callback:', error)
      }
    }

    // Simulate process restart by clearing global state
    if (global.conversionProgress) {
      delete global.conversionProgress
    }

    console.log('Container restart simulation completed')
  }

  cleanup(): void {
    process.exit = this.originalProcessExit
  }
}

export class PerformanceMonitor {
  private startTime: number = 0
  private memoryUsage: NodeJS.MemoryUsage[] = []
  private monitoringInterval?: NodeJS.Timeout

  start(): void {
    this.startTime = Date.now()
    this.memoryUsage = []

    // Monitor memory usage every second
    this.monitoringInterval = setInterval(() => {
      this.memoryUsage.push(process.memoryUsage())
    }, 1000)
  }

  stop(): PerformanceMetrics {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
    }

    const endTime = Date.now()
    const duration = endTime - this.startTime

    const peakMemory = this.memoryUsage.reduce((peak, current) => ({
      rss: Math.max(peak.rss, current.rss),
      heapUsed: Math.max(peak.heapUsed, current.heapUsed),
      heapTotal: Math.max(peak.heapTotal, current.heapTotal),
      external: Math.max(peak.external, current.external),
      arrayBuffers: Math.max(peak.arrayBuffers, current.arrayBuffers)
    }), { rss: 0, heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 })

    return {
      duration,
      peakMemory,
      averageMemory: this.calculateAverageMemory()
    }
  }

  private calculateAverageMemory(): NodeJS.MemoryUsage {
    if (this.memoryUsage.length === 0) {
      return process.memoryUsage()
    }

    const sum = this.memoryUsage.reduce((acc, current) => ({
      rss: acc.rss + current.rss,
      heapUsed: acc.heapUsed + current.heapUsed,
      heapTotal: acc.heapTotal + current.heapTotal,
      external: acc.external + current.external,
      arrayBuffers: acc.arrayBuffers + current.arrayBuffers
    }), { rss: 0, heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 })

    const count = this.memoryUsage.length

    return {
      rss: sum.rss / count,
      heapUsed: sum.heapUsed / count,
      heapTotal: sum.heapTotal / count,
      external: sum.external / count,
      arrayBuffers: sum.arrayBuffers / count
    }
  }
}

export interface PerformanceMetrics {
  duration: number
  peakMemory: NodeJS.MemoryUsage
  averageMemory: NodeJS.MemoryUsage
}

export async function waitForCondition(
  condition: () => Promise<boolean>,
  timeoutMs: number = 30000,
  intervalMs: number = 1000
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`)
}

export function createMockFFmpegProcess() {
  const { EventEmitter } = require('events')
  
  class MockFFmpegProcess extends EventEmitter {
    stdin = new EventEmitter()
    stdout = new EventEmitter()
    stderr = new EventEmitter()
    pid = Math.floor(Math.random() * 10000)
    killed = false

    kill(signal?: string) {
      this.killed = true
      this.emit('exit', 0, signal)
    }

    simulateProgress(duration: number = 180) {
      let currentTime = 0
      const interval = setInterval(() => {
        if (this.killed) {
          clearInterval(interval)
          return
        }

        currentTime += 5
        const progress = `time=${this.formatTime(currentTime)} bitrate=192.0kbits/s speed=1.0x`
        this.stderr.emit('data', Buffer.from(progress))

        if (currentTime >= duration) {
          clearInterval(interval)
          this.emit('exit', 0, null)
        }
      }, 100)
    }

    private formatTime(seconds: number): string {
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      const secs = seconds % 60
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`
    }
  }

  return new MockFFmpegProcess()
}

export async function verifyFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}