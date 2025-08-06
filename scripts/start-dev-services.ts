#!/usr/bin/env tsx

import { execSync } from 'child_process'
import { initializeAllServices } from '../lib/aws-services'

async function waitForServices(): Promise<void> {
  console.log('⏳ Waiting for services to be ready...')
  
  // Wait for LocalStack to be ready
  let retries = 30
  while (retries > 0) {
    try {
      execSync('curl -s http://localhost:4566/_localstack/health', { stdio: 'pipe' })
      console.log('✅ LocalStack is ready')
      break
    } catch (error) {
      retries--
      if (retries === 0) {
        throw new Error('LocalStack failed to start')
      }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  
  // Wait for DynamoDB Local to be ready
  retries = 30
  while (retries > 0) {
    try {
      execSync('curl -s http://localhost:8000', { stdio: 'pipe' })
      console.log('✅ DynamoDB Local is ready')
      break
    } catch (error) {
      retries--
      if (retries === 0) {
        throw new Error('DynamoDB Local failed to start')
      }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  
  // Wait for Redis to be ready
  retries = 30
  while (retries > 0) {
    try {
      execSync('nc -z localhost 6379', { stdio: 'pipe' })
      console.log('✅ Redis is ready')
      break
    } catch (error) {
      retries--
      if (retries === 0) {
        throw new Error('Redis failed to start')
      }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
}

async function main(): Promise<void> {
  try {
    console.log('🚀 Starting development services...')
    
    // Start Docker Compose services
    execSync('docker-compose -f docker-compose.dev.yml up -d', { stdio: 'inherit' })
    
    // Wait for services to be ready
    await waitForServices()
    
    // Initialize AWS services (create buckets, tables, etc.)
    await initializeAllServices()
    
    console.log('\n🎉 Development environment is ready!')
    console.log('\nServices running:')
    console.log('  - LocalStack S3: http://localhost:4566')
    console.log('  - DynamoDB Local: http://localhost:8000')
    console.log('  - Redis: localhost:6379')
    console.log('\nRun `npm run test:connectivity` to verify everything is working')
    console.log('Run `npm run dev:services:stop` to stop all services')
    
  } catch (error) {
    console.error('💥 Failed to start development services:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}