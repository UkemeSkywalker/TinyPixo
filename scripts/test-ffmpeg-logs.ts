#!/usr/bin/env tsx

import { progressService } from '../lib/progress-service'

async function testFFmpegLogs() {
  console.log('🧪 Testing FFmpeg logs functionality')
  console.log('=' .repeat(50))

  const testJobId = 'test-logs-' + Date.now()

  try {
    // Initialize progress for test job
    await progressService.initializeProgress(testJobId)
    console.log(`✅ Initialized test job: ${testJobId}`)

    // Simulate some FFmpeg stderr lines
    const mockFFmpegLines = [
      'ffmpeg version 4.4.2 Copyright (c) 2000-2021 the FFmpeg developers',
      'Input #0, wav, from \'pipe:0\':',
      '  Duration: 00:03:45.67, bitrate: 1411 kb/s',
      '    Stream #0:0: Audio: pcm_s16le, 44100 Hz, stereo, s16, 1411 kb/s',
      'Output #0, mp3, to \'pipe:1\':',
      '  Metadata:',
      '    encoder         : Lavf58.76.100',
      '    Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s',
      'Stream mapping:',
      '  Stream #0:0 -> #0:0 (pcm_s16le -> mp3)',
      'Press [q] to stop, [?] for help',
      'size=     512kB time=00:00:32.45 bitrate= 129.2kbits/s speed=2.1x',
      'size=    1024kB time=00:01:04.90 bitrate= 129.0kbits/s speed=2.2x',
      'size=    1536kB time=00:01:37.35 bitrate= 128.8kbits/s speed=2.1x',
      'size=    2048kB time=00:02:09.80 bitrate= 128.6kbits/s speed=2.0x'
    ]

    console.log('\n📝 Simulating FFmpeg stderr lines...')
    
    // Process each line with a small delay
    for (let i = 0; i < mockFFmpegLines.length; i++) {
      const line = mockFFmpegLines[i]
      console.log(`  Processing: ${line}`)
      
      // This would normally be called by the streaming conversion service
      // For testing, we'll call the DynamoDB service directly
      const { dynamodbProgressService } = await import('../lib/progress-service-dynamodb')
      await dynamodbProgressService.addFFmpegLog(testJobId, line)
      
      // Small delay to simulate real processing
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Wait a bit for throttled updates to process
    console.log('\n⏳ Waiting for log updates to process...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Retrieve the logs
    console.log('\n📋 Retrieving stored logs...')
    const logs = await progressService.getFFmpegLogs(testJobId)
    
    console.log(`\n📊 Retrieved ${logs.length} log lines:`)
    logs.forEach((log, index) => {
      console.log(`  ${index + 1}: ${log}`)
    })

    // Test the API endpoint
    console.log('\n🌐 Testing API endpoint...')
    const response = await fetch(`http://localhost:3000/api/ffmpeg-logs?jobId=${testJobId}`)
    
    if (response.ok) {
      const data = await response.json()
      console.log(`✅ API returned ${data.logCount} logs`)
      console.log(`   Retrieved at: ${data.retrievedAt}`)
    } else {
      console.log(`❌ API request failed: ${response.status}`)
    }

    // Test progress API with logs
    console.log('\n📈 Testing progress API with logs...')
    const progressResponse = await fetch(`http://localhost:3000/api/progress?jobId=${testJobId}&includeLogs=true`)
    
    if (progressResponse.ok) {
      const progressData = await progressResponse.json()
      console.log(`✅ Progress API returned with ${progressData.ffmpegLogs?.length || 0} recent logs`)
    } else {
      console.log(`❌ Progress API request failed: ${progressResponse.status}`)
    }

  } catch (error) {
    console.error('❌ Test failed:', error)
  }

  console.log('\n🏁 FFmpeg logs test completed')
}

testFFmpegLogs().catch(console.error)