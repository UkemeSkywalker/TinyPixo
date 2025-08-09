#!/usr/bin/env tsx

/**
 * Browse S3 Bucket Contents in LocalStack
 * 
 * This script lists all objects in your audio conversion S3 bucket
 * and provides detailed information about each file.
 */

import { s3Client } from '../lib/aws-services'
import { ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3'

class S3BucketBrowser {
  private bucketName = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'

  async browseBucket(): Promise<void> {
    console.log('🪣 S3 Bucket Browser (LocalStack)')
    console.log('=' .repeat(60))
    console.log(`📁 Bucket: ${this.bucketName}`)
    console.log(`🌐 Endpoint: ${process.env.S3_ENDPOINT || 'http://localhost:4566'}`)
    console.log('')

    try {
      // List all objects in the bucket
      const response = await s3Client.send(new ListObjectsV2Command({
        Bucket: this.bucketName,
        MaxKeys: 100 // Limit to 100 objects for readability
      }))

      if (!response.Contents || response.Contents.length === 0) {
        console.log('📭 Bucket is empty')
        return
      }

      console.log(`📊 Found ${response.Contents.length} objects:`)
      console.log('')

      // Group objects by folder
      const folders = new Map<string, any[]>()
      
      for (const object of response.Contents) {
        if (!object.Key) continue
        
        const folder = object.Key.includes('/') 
          ? object.Key.split('/')[0] 
          : 'root'
        
        if (!folders.has(folder)) {
          folders.set(folder, [])
        }
        folders.get(folder)!.push(object)
      }

      // Display objects grouped by folder
      for (const [folderName, objects] of folders.entries()) {
        console.log(`📂 ${folderName}/`)
        console.log('─'.repeat(40))
        
        for (const object of objects) {
          const sizeKB = Math.round((object.Size || 0) / 1024)
          const sizeMB = Math.round(sizeKB / 1024)
          const sizeDisplay = sizeMB > 0 ? `${sizeMB}MB` : `${sizeKB}KB`
          
          const fileName = object.Key!.split('/').pop() || object.Key!
          const lastModified = object.LastModified 
            ? object.LastModified.toLocaleString()
            : 'Unknown'
          
          console.log(`  📄 ${fileName}`)
          console.log(`     Size: ${sizeDisplay} (${object.Size} bytes)`)
          console.log(`     Modified: ${lastModified}`)
          console.log(`     Key: ${object.Key}`)
          console.log('')
        }
      }

      // Show bucket statistics
      const totalSize = response.Contents.reduce((sum, obj) => sum + (obj.Size || 0), 0)
      const totalSizeMB = Math.round(totalSize / 1024 / 1024)
      
      console.log('📈 Bucket Statistics:')
      console.log(`  Total Objects: ${response.Contents.length}`)
      console.log(`  Total Size: ${totalSizeMB}MB (${totalSize} bytes)`)
      console.log(`  Folders: ${folders.size}`)

    } catch (error) {
      console.error('❌ Error browsing S3 bucket:', error)
      
      if (error instanceof Error && error.message.includes('NoSuchBucket')) {
        console.log('')
        console.log('💡 The bucket might not exist yet. Try running:')
        console.log('   npm run setup:aws-resources')
      }
    }
  }

  async getObjectDetails(key: string): Promise<void> {
    try {
      console.log(`🔍 Getting details for: ${key}`)
      
      const headResponse = await s3Client.send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key
      }))

      console.log('📋 Object Details:')
      console.log(`  Content Type: ${headResponse.ContentType}`)
      console.log(`  Content Length: ${headResponse.ContentLength} bytes`)
      console.log(`  Last Modified: ${headResponse.LastModified}`)
      console.log(`  ETag: ${headResponse.ETag}`)
      
      if (headResponse.Metadata) {
        console.log('  Metadata:')
        for (const [key, value] of Object.entries(headResponse.Metadata)) {
          console.log(`    ${key}: ${value}`)
        }
      }

    } catch (error) {
      console.error(`❌ Error getting object details for ${key}:`, error)
    }
  }

  async downloadObject(key: string, outputPath?: string): Promise<void> {
    try {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3')
      const { writeFileSync } = await import('fs')
      
      console.log(`⬇️  Downloading: ${key}`)
      
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key
      }))

      if (!response.Body) {
        throw new Error('No body in S3 response')
      }

      // Convert stream to buffer
      const chunks: Buffer[] = []
      
      for await (const chunk of response.Body as any) {
        chunks.push(chunk)
      }

      const buffer = Buffer.concat(chunks)
      const fileName = outputPath || key.split('/').pop() || 'downloaded-file'
      
      writeFileSync(fileName, buffer)
      
      console.log(`✅ Downloaded to: ${fileName} (${buffer.length} bytes)`)

    } catch (error) {
      console.error(`❌ Error downloading ${key}:`, error)
    }
  }
}

// CLI interface
async function main() {
  const browser = new S3BucketBrowser()
  const args = process.argv.slice(2)
  
  if (args.length === 0) {
    // Default: browse bucket
    await browser.browseBucket()
  } else if (args[0] === 'details' && args[1]) {
    // Get object details
    await browser.getObjectDetails(args[1])
  } else if (args[0] === 'download' && args[1]) {
    // Download object
    await browser.downloadObject(args[1], args[2])
  } else {
    console.log('Usage:')
    console.log('  tsx scripts/browse-s3-bucket.ts                    # Browse bucket')
    console.log('  tsx scripts/browse-s3-bucket.ts details <key>      # Get object details')
    console.log('  tsx scripts/browse-s3-bucket.ts download <key>     # Download object')
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('💥 Script failed:', error)
    process.exit(1)
  })
}

export { S3BucketBrowser }