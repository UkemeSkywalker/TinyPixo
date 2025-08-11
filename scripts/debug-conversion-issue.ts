#!/usr/bin/env tsx

/**
 * Debug script to identify the conversion completion issue
 */

async function createTestAudioFile(): Promise<Buffer> {
  // Create a minimal WAV file for testing
  const wavHeader = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x24, 0x08, 0x00, 0x00, // File size - 8
    0x57, 0x41, 0x56, 0x45, // "WAVE"
    0x66, 0x6D, 0x74, 0x20, // "fmt "
    0x10, 0x00, 0x00, 0x00, // Subchunk1Size (16 for PCM)
    0x01, 0x00,             // AudioFormat (1 for PCM)
    0x01, 0x00,             // NumChannels (1 = mono)
    0x44, 0xAC, 0x00, 0x00, // SampleRate (44100)
    0x88, 0x58, 0x01, 0x00, // ByteRate
    0x02, 0x00,             // BlockAlign
    0x10, 0x00,             // BitsPerSample (16)
    0x64, 0x61, 0x74, 0x61, // "data"
    0x00, 0x08, 0x00, 0x00  // Subchunk2Size
  ])
  
  // Add minimal audio data
  const audioData = Buffer.alloc(2048) // 2KB of audio data
  for (let i = 0; i < audioData.length; i += 2) {
    const sample = Math.sin(2 * Math.PI * 440 * i / 44100) * 16383
    audioData.writeInt16LE(Math.round(sample), i)
  }
  
  return Buffer.concat([wavHeader, audioData])
}

async function testConversion(): Promise<void> {
  console.log('🔍 Debug: Testing conversion completion issue')
  
  try {
    // Step 1: Upload file
    console.log('📤 Step 1: Upload test file')
    const audioBuffer = await createTestAudioFile()
    const fileName = `debug-test-${Date.now()}.wav`
    const fileId = `debug-${Date.now()}`
    
    const formData = new FormData()
    const blob = new Blob([audioBuffer], { type: 'audio/wav' })
    formData.append('file', blob, fileName)
    formData.append('fileId', fileId)
    
    const uploadResponse = await fetch('http://localhost:3000/api/upload-audio', {
      method: 'POST',
      body: formData
    })
    
    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.statusText}`)
    }
    
    const uploadResult = await uploadResponse.json()
    console.log(`✅ File uploaded: ${uploadResult.fileId}`)
    
    // Step 2: Start conversion
    console.log('🔄 Step 2: Start conversion')
    const conversionResponse = await fetch('http://localhost:3000/api/convert-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: uploadResult.fileId,
        format: 'mp3',
        quality: '128k'
      })
    })
    
    if (!conversionResponse.ok) {
      throw new Error(`Conversion failed: ${conversionResponse.statusText}`)
    }
    
    const conversionResult = await conversionResponse.json()
    const jobId = conversionResult.jobId
    console.log(`✅ Conversion started: ${jobId}`)
    
    // Step 3: Monitor progress for 20 seconds
    console.log('📊 Step 3: Monitor progress for 20 seconds')
    let lastProgress = -1
    let progressCount = 0
    
    for (let i = 0; i < 20; i++) {
      try {
        const progressResponse = await fetch(`http://localhost:3000/api/progress?jobId=${jobId}`)
        
        if (progressResponse.ok) {
          const progressData = await progressResponse.json()
          
          if (progressData.progress !== lastProgress) {
            progressCount++
            lastProgress = progressData.progress
            console.log(`   Progress ${progressCount}: ${progressData.progress}% (${progressData.stage})`)
            
            if (progressData.progress >= 100) {
              console.log('🎉 Conversion completed successfully!')
              return
            }
            
            if (progressData.progress === -1) {
              console.log('❌ Conversion failed!')
              return
            }
          }
        } else {
          console.log(`   Progress API error: ${progressResponse.status}`)
        }
      } catch (error) {
        console.log(`   Progress fetch error: ${error}`)
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    
    console.log('⏰ Monitoring timeout - checking final status')
    
    // Final check
    try {
      const finalProgressResponse = await fetch(`http://localhost:3000/api/progress?jobId=${jobId}`)
      if (finalProgressResponse.ok) {
        const finalProgress = await finalProgressResponse.json()
        console.log(`   Final progress: ${finalProgress.progress}% (${finalProgress.stage})`)
        
        if (finalProgress.progress >= 100) {
          console.log('🎉 Conversion completed (detected in final check)!')
        } else {
          console.log('❌ Conversion stuck at final progress')
        }
      }
    } catch (error) {
      console.log(`   Final check error: ${error}`)
    }
    
  } catch (error) {
    console.error('💥 Debug test failed:', error)
  }
}

async function main(): Promise<void> {
  try {
    // Check server
    const healthResponse = await fetch('http://localhost:3000/api/health')
    if (!healthResponse.ok) {
      throw new Error('Server not running')
    }
    
    await testConversion()
    
  } catch (error) {
    console.error('💥 Debug failed:', error)
    process.exit(1)
  }
}

main().catch(console.error)