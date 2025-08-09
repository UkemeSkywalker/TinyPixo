#!/usr/bin/env tsx

/**
 * Generate test audio files for testing
 * Creates MP3 files of various sizes for comprehensive testing
 */

import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

interface TestFileSpec {
  name: string
  sizeInMB: number
  duration: number // in seconds
  format: 'mp3' | 'wav'
}

const TEST_FILES: TestFileSpec[] = [
  { name: 'tiny-audio.mp3', sizeInMB: 0.1, duration: 5, format: 'mp3' },
  { name: 'small-audio.mp3', sizeInMB: 1, duration: 60, format: 'mp3' },
  { name: 'medium-audio.mp3', sizeInMB: 10, duration: 600, format: 'mp3' },
  { name: 'large-audio.mp3', sizeInMB: 50, duration: 3000, format: 'mp3' },
  { name: 'xlarge-audio.mp3', sizeInMB: 100, duration: 6000, format: 'mp3' },
  { name: 'test-audio.wav', sizeInMB: 5, duration: 300, format: 'wav' }
]

class TestFileGenerator {
  private fixturesDir = join(__dirname, '.')

  async generateAll(): Promise<void> {
    console.log('Generating test audio files...')

    // Ensure fixtures directory exists
    if (!existsSync(this.fixturesDir)) {
      await mkdir(this.fixturesDir, { recursive: true })
    }

    for (const spec of TEST_FILES) {
      const filePath = join(this.fixturesDir, spec.name)
      
      if (existsSync(filePath)) {
        console.log(`   - Skipping ${spec.name} (already exists)`)
        continue
      }

      console.log(`   - Creating ${spec.name} (${spec.sizeInMB}MB, ${spec.duration}s)`)
      await this.generateTestFile(filePath, spec)
    }

    // Generate invalid test files
    await this.generateInvalidFiles()

    console.log('Test file generation complete')
  }

  private async generateTestFile(filePath: string, spec: TestFileSpec): Promise<void> {
    const targetSize = spec.sizeInMB * 1024 * 1024

    if (spec.format === 'mp3') {
      await this.generateMP3File(filePath, targetSize, spec.duration)
    } else if (spec.format === 'wav') {
      await this.generateWAVFile(filePath, targetSize, spec.duration)
    }
  }

  private async generateMP3File(filePath: string, targetSize: number, duration: number): Promise<void> {
    // Create a minimal MP3 file structure
    const mp3Header = Buffer.from([
      // MP3 frame header (MPEG-1 Layer 3, 128kbps, 44.1kHz, stereo)
      0xFF, 0xFB, 0x90, 0x00,
      // Additional MP3 frame data
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ])

    // ID3v2 header (optional metadata)
    const id3Header = Buffer.from([
      0x49, 0x44, 0x33, // "ID3"
      0x03, 0x00, // Version 2.3
      0x00, // Flags
      0x00, 0x00, 0x00, 0x00 // Size (will be updated)
    ])

    // Calculate frame size for target duration and file size
    const frameSize = 417 // Typical MP3 frame size for 128kbps
    const framesNeeded = Math.floor((targetSize - id3Header.length) / frameSize)

    const chunks: Buffer[] = [id3Header]

    // Add MP3 frames
    for (let i = 0; i < framesNeeded; i++) {
      const frame = Buffer.alloc(frameSize)
      mp3Header.copy(frame, 0)
      
      // Fill rest with pseudo-random audio data
      for (let j = mp3Header.length; j < frameSize; j++) {
        frame[j] = Math.floor(Math.random() * 256)
      }
      
      chunks.push(frame)
    }

    const fileBuffer = Buffer.concat(chunks)
    await writeFile(filePath, fileBuffer)
  }

  private async generateWAVFile(filePath: string, targetSize: number, duration: number): Promise<void> {
    // WAV file header structure
    const sampleRate = 44100
    const bitsPerSample = 16
    const channels = 2
    const bytesPerSample = bitsPerSample / 8
    const blockAlign = channels * bytesPerSample
    const byteRate = sampleRate * blockAlign

    const dataSize = targetSize - 44 // Subtract header size
    const totalSize = dataSize + 36

    const header = Buffer.alloc(44)
    let offset = 0

    // RIFF header
    header.write('RIFF', offset); offset += 4
    header.writeUInt32LE(totalSize, offset); offset += 4
    header.write('WAVE', offset); offset += 4

    // fmt chunk
    header.write('fmt ', offset); offset += 4
    header.writeUInt32LE(16, offset); offset += 4 // PCM format chunk size
    header.writeUInt16LE(1, offset); offset += 2 // PCM format
    header.writeUInt16LE(channels, offset); offset += 2
    header.writeUInt32LE(sampleRate, offset); offset += 4
    header.writeUInt32LE(byteRate, offset); offset += 4
    header.writeUInt16LE(blockAlign, offset); offset += 2
    header.writeUInt16LE(bitsPerSample, offset); offset += 2

    // data chunk
    header.write('data', offset); offset += 4
    header.writeUInt32LE(dataSize, offset)

    // Generate audio data (sine wave)
    const audioData = Buffer.alloc(dataSize)
    const frequency = 440 // A4 note
    
    for (let i = 0; i < dataSize; i += 2) {
      const sample = Math.sin(2 * Math.PI * frequency * (i / 2) / sampleRate) * 32767
      audioData.writeInt16LE(Math.floor(sample), i)
    }

    const fileBuffer = Buffer.concat([header, audioData])
    await writeFile(filePath, fileBuffer)
  }

  private async generateInvalidFiles(): Promise<void> {
    const invalidFiles = [
      { name: 'invalid.txt', content: 'This is not an audio file' },
      { name: 'corrupted.mp3', content: Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]) },
      { name: 'empty.mp3', content: Buffer.alloc(0) },
      { name: 'partial.wav', content: Buffer.from('RIFF') } // Incomplete WAV header
    ]

    for (const { name, content } of invalidFiles) {
      const filePath = join(this.fixturesDir, name)
      
      if (!existsSync(filePath)) {
        console.log(`   - Creating invalid file: ${name}`)
        await writeFile(filePath, content)
      }
    }
  }

  async cleanup(): Promise<void> {
    console.log('Cleaning up test files...')
    
    const { unlink } = await import('fs/promises')
    
    for (const spec of TEST_FILES) {
      const filePath = join(this.fixturesDir, spec.name)
      try {
        await unlink(filePath)
        console.log(`   - Removed ${spec.name}`)
      } catch (error) {
        // File might not exist, ignore
      }
    }

    // Clean up invalid files
    const invalidFiles = ['invalid.txt', 'corrupted.mp3', 'empty.mp3', 'partial.wav']
    for (const name of invalidFiles) {
      const filePath = join(this.fixturesDir, name)
      try {
        await unlink(filePath)
        console.log(`   - Removed ${name}`)
      } catch (error) {
        // File might not exist, ignore
      }
    }

    console.log('Cleanup complete')
  }
}

// CLI interface
if (require.main === module) {
  const generator = new TestFileGenerator()
  
  const command = process.argv[2]
  
  if (command === 'cleanup') {
    generator.cleanup().catch(console.error)
  } else {
    generator.generateAll().catch(console.error)
  }
}

export { TestFileGenerator, TEST_FILES }