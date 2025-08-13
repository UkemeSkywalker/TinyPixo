#!/usr/bin/env tsx

import { ffmpegProgressParser, FFmpegProcessInfo } from '../lib/ffmpeg-progress-parser'

// Simulate the scenario from your logs
function testDurationEstimationFix() {
  console.log('🧪 Testing duration estimation fix')
  console.log('=' .repeat(50))

  // Create a mock process info (simulating the stuck job scenario)
  const processInfo: FFmpegProcessInfo = {
    pid: 12345,
    startTime: Date.now() - (37 * 60 * 1000), // Started 37 minutes ago
    lastProgressTime: Date.now() - 1000, // Last progress 1 second ago
    isStreaming: true,
    inputFormat: 'wav',
    outputFormat: 'mp3',
    estimatedDuration: 1189.56, // ~20 minutes (from your logs)
    fileSize: 209839382 // 200MB
  }

  // Test the scenario where current time exceeds estimated duration
  const scenarios = [
    { currentTime: 1189.56, description: 'At estimated end' },
    { currentTime: 1500, description: 'Slightly over estimate' },
    { currentTime: 2250.65, description: 'Way over estimate (your case)' },
    { currentTime: 3000, description: 'Very long file' }
  ]

  scenarios.forEach((scenario, index) => {
    console.log(`\n📊 Scenario ${index + 1}: ${scenario.description}`)
    console.log(`   Current time: ${scenario.currentTime}s (${(scenario.currentTime / 60).toFixed(1)} min)`)
    console.log(`   Estimated duration: ${processInfo.estimatedDuration}s (${(processInfo.estimatedDuration! / 60).toFixed(1)} min)`)
    
    const progressInfo = {
      currentTime: scenario.currentTime,
      duration: processInfo.estimatedDuration,
      bitrate: '192.0kbits/s',
      speed: '2.21x'
    }

    const result = ffmpegProgressParser.calculateProgress(progressInfo, processInfo)
    
    console.log(`   → Progress: ${result.progress}%`)
    console.log(`   → Stage: ${result.stage}`)
    console.log(`   → Est. remaining: ${result.estimatedTimeRemaining}s`)
    console.log(`   → Current time display: ${result.currentTime}`)
    console.log(`   → Total duration display: ${result.totalDuration}`)
  })

  console.log('\n✅ Duration estimation fix test completed')
}

testDurationEstimationFix()