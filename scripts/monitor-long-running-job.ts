#!/usr/bin/env tsx

import { progressService } from '../lib/progress-service'
import { streamingConversionServiceFixed } from '../lib/streaming-conversion-service-fixed'

const JOB_ID = '1755036398339'

async function monitorLongRunningJob() {
  console.log(`🔍 Monitoring long-running job: ${JOB_ID}`)
  console.log('=' .repeat(60))

  let previousTime: string | undefined
  let stuckCount = 0
  const maxStuckChecks = 5

  for (let i = 0; i < 10; i++) {
    try {
      console.log(`\n📊 Check ${i + 1}/10:`)
      
      const progressData = await progressService.getProgress(JOB_ID)
      
      if (!progressData) {
        console.log('❌ Job not found - may have completed or failed')
        break
      }

      console.log(`  Progress: ${progressData.progress}%`)
      console.log(`  Stage: ${progressData.stage}`)
      console.log(`  Current Time: ${progressData.currentTime}`)
      console.log(`  Total Duration: ${progressData.totalDuration}`)
      console.log(`  Updated: ${new Date(progressData.updatedAt).toISOString()}`)

      // Check if FFmpeg is making progress
      if (progressData.currentTime) {
        if (previousTime === progressData.currentTime) {
          stuckCount++
          console.log(`  ⚠️  Same time as previous check (${stuckCount}/${maxStuckChecks})`)
          
          if (stuckCount >= maxStuckChecks) {
            console.log(`  🚨 Job appears to be stuck - no time progress for ${stuckCount} checks`)
            
            // Check if process is still active
            const activeProcesses = streamingConversionServiceFixed.getActiveProcesses()
            if (activeProcesses.has(JOB_ID)) {
              console.log(`  💀 Terminating stuck process...`)
              const process = activeProcesses.get(JOB_ID)!
              if (process.pid && !process.killed) {
                process.kill('SIGTERM')
                console.log(`  📤 Sent SIGTERM to process ${process.pid}`)
              }
            }
            
            await progressService.markFailed(JOB_ID, 'Job stuck - no progress detected')
            console.log(`  ✅ Job marked as failed`)
            break
          }
        } else {
          stuckCount = 0
          console.log(`  ✅ Progress detected: ${previousTime} -> ${progressData.currentTime}`)
        }
        previousTime = progressData.currentTime
      }

      // Check if job completed or failed
      if (progressData.stage === 'completed') {
        console.log(`  🎉 Job completed successfully!`)
        break
      } else if (progressData.stage === 'failed') {
        console.log(`  ❌ Job failed: ${progressData.error}`)
        break
      }

      // Wait 10 seconds before next check
      if (i < 9) {
        console.log(`  ⏳ Waiting 10 seconds...`)
        await new Promise(resolve => setTimeout(resolve, 10000))
      }

    } catch (error) {
      console.error(`❌ Error during check ${i + 1}:`, error)
    }
  }

  console.log('\n🏁 Monitoring completed')
}

monitorLongRunningJob().catch(console.error)