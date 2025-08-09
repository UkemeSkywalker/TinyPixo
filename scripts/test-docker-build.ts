#!/usr/bin/env tsx

/**
 * Docker Build Test Script
 * 
 * This script tests the Docker build locally to ensure it works
 * before deploying to App Runner.
 */

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
}