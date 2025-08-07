#!/usr/bin/env tsx

import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

function updateEnvFile(redisEndpoint: string): void {
  const envPath = join(process.cwd(), '.env.local')
  let envContent = ''
  
  // Read existing .env.local
  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, 'utf-8')
  }
  
  // Parse existing variables
  const lines = envContent.split('\n')
  const updatedLines: string[] = []
  let redisEndpointUpdated = false
  
  for (const line of lines) {
    if (line.startsWith('REDIS_ENDPOINT=')) {
      updatedLines.push(`REDIS_ENDPOINT=${redisEndpoint}`)
      redisEndpointUpdated = true
    } else {
      updatedLines.push(line)
    }
  }
  
  // If REDIS_ENDPOINT wasn't found, add it
  if (!redisEndpointUpdated) {
    updatedLines.push(`REDIS_ENDPOINT=${redisEndpoint}`)
  }
  
  writeFileSync(envPath, updatedLines.join('\n'))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const endpoint = args[0]
  
  if (!endpoint) {
    console.log('🔧 Redis Endpoint Configuration')
    console.log('')
    console.log('Usage:')
    console.log('  npm run set:redis-endpoint <endpoint>')
    console.log('')
    console.log('Example:')
    console.log('  npm run set:redis-endpoint audio-conversion-redis.abc123.cache.amazonaws.com')
    console.log('')
    console.log('After creating your Redis cluster in AWS Console:')
    console.log('1. Copy the Primary Endpoint (without redis:// prefix)')
    console.log('2. Run the command above with your endpoint')
    console.log('3. Test with: npm run test:aws-connectivity')
    return
  }
  
  // Clean the endpoint (remove protocol prefixes if present)
  const cleanEndpoint = endpoint
    .replace(/^redis:\/\//, '')
    .replace(/^rediss:\/\//, '')
    .replace(/:6379$/, '') // Remove port if included
  
  console.log(`🔧 Setting Redis endpoint: ${cleanEndpoint}`)
  
  updateEnvFile(cleanEndpoint)
  
  console.log('✅ Updated .env.local file')
  console.log('')
  console.log('Current configuration:')
  console.log(`   REDIS_ENDPOINT=${cleanEndpoint}`)
  console.log(`   REDIS_PORT=6379`)
  console.log(`   REDIS_TLS=true`)
  console.log('')
  console.log('🧪 Test connectivity with:')
  console.log('   npm run test:aws-connectivity')
}

if (require.main === module) {
  main()
}