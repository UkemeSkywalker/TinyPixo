#!/usr/bin/env tsx

import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

type EnvironmentMode = 'local' | 'aws'

interface EnvironmentConfig {
  mode: EnvironmentMode
  description: string
  variables: Record<string, string>
}

const ENVIRONMENTS: Record<EnvironmentMode, EnvironmentConfig> = {
  local: {
    mode: 'local',
    description: 'LocalStack development environment',
    variables: {
      FORCE_AWS_ENVIRONMENT: 'false',
      S3_BUCKET_NAME: 'audio-conversion-bucket',
      AWS_REGION: 'us-east-1',
      // Remove AWS-specific variables
      REDIS_ENDPOINT: '',
      REDIS_PORT: '6379',
      REDIS_TLS: 'false'
    }
  },
  aws: {
    mode: 'aws',
    description: 'Real AWS services',
    variables: {
      FORCE_AWS_ENVIRONMENT: 'true',
      S3_BUCKET_NAME: process.env.S3_BUCKET_NAME || 'audio-conversion-app-bucket',
      AWS_REGION: process.env.AWS_REGION || 'us-east-1',
      REDIS_ENDPOINT: process.env.REDIS_ENDPOINT || '',
      REDIS_PORT: process.env.REDIS_PORT || '6379',
      REDIS_TLS: 'true'
    }
  }
}

function getCurrentEnvironment(): EnvironmentMode {
  if (process.env.FORCE_AWS_ENVIRONMENT === 'true') {
    return 'aws'
  }
  return 'local'
}

function updateEnvFile(config: EnvironmentConfig): void {
  const envPath = join(process.cwd(), '.env.local')
  let envContent = ''
  
  // Read existing .env.local if it exists
  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, 'utf-8')
  }
  
  // Parse existing variables
  const existingVars: Record<string, string> = {}
  const lines = envContent.split('\n')
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=')
      if (key && valueParts.length > 0) {
        existingVars[key.trim()] = valueParts.join('=').trim()
      }
    }
  }
  
  // Update with new configuration
  for (const [key, value] of Object.entries(config.variables)) {
    existingVars[key] = value
  }
  
  // Generate new content
  const newLines: string[] = [
    '# Audio Conversion App Environment Configuration',
    `# Current mode: ${config.mode} (${config.description})`,
    `# Generated at: ${new Date().toISOString()}`,
    ''
  ]
  
  // Add environment-specific section
  newLines.push(`# ${config.description}`)
  for (const [key, value] of Object.entries(config.variables)) {
    if (value) {
      newLines.push(`${key}=${value}`)
    } else {
      newLines.push(`# ${key}=`)
    }
  }
  
  // Add other existing variables that aren't managed by this script
  const managedKeys = new Set(Object.keys(config.variables))
  const otherVars = Object.entries(existingVars).filter(([key]) => !managedKeys.has(key))
  
  if (otherVars.length > 0) {
    newLines.push('', '# Other variables')
    for (const [key, value] of otherVars) {
      newLines.push(`${key}=${value}`)
    }
  }
  
  writeFileSync(envPath, newLines.join('\n') + '\n')
}

function displayCurrentConfig(): void {
  const current = getCurrentEnvironment()
  const config = ENVIRONMENTS[current]
  
  console.log(`\n📋 Current environment: ${config.mode}`)
  console.log(`   Description: ${config.description}`)
  console.log('   Configuration:')
  
  for (const [key, value] of Object.entries(config.variables)) {
    const actualValue = process.env[key] || value
    if (actualValue) {
      console.log(`     ${key}=${actualValue}`)
    } else {
      console.log(`     ${key}=(not set)`)
    }
  }
}

function switchEnvironment(targetMode: EnvironmentMode): void {
  const config = ENVIRONMENTS[targetMode]
  
  console.log(`\n🔄 Switching to ${config.mode} environment...`)
  console.log(`   ${config.description}`)
  
  updateEnvFile(config)
  
  console.log('✅ Environment configuration updated')
  console.log('   File: .env.local')
  
  if (targetMode === 'aws') {
    console.log('\n⚠️ AWS environment selected:')
    console.log('   - Ensure AWS credentials are configured')
    console.log('   - Run: npm run setup:aws-resources (if not done)')
    console.log('   - Set REDIS_ENDPOINT after ElastiCache is ready')
    console.log('   - Test with: npm run test:aws-connectivity')
  } else {
    console.log('\n💻 Local environment selected:')
    console.log('   - Start services: npm run dev:services')
    console.log('   - Test with: npm run test:connectivity')
  }
  
  console.log('\n🔄 Restart your development server to apply changes')
}

function validateAWSSetup(): void {
  console.log('\n🔍 Validating AWS setup...')
  
  const requiredForAWS = ['AWS_REGION']
  const missing: string[] = []
  
  for (const varName of requiredForAWS) {
    if (!process.env[varName]) {
      missing.push(varName)
    }
  }
  
  if (missing.length > 0) {
    console.log(`❌ Missing required variables: ${missing.join(', ')}`)
    return
  }
  
  console.log('✅ Basic AWS configuration looks good')
  
  if (!process.env.REDIS_ENDPOINT) {
    console.log('⚠️ REDIS_ENDPOINT not set - Redis tests will be skipped')
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]
  
  if (command === 'status') {
    displayCurrentConfig()
    if (getCurrentEnvironment() === 'aws') {
      validateAWSSetup()
    }
    return
  }
  
  if (command === 'local') {
    switchEnvironment('local')
    return
  }
  
  if (command === 'aws') {
    switchEnvironment('aws')
    return
  }
  
  // Default: show help
  console.log('🔧 Environment Switching Utility')
  console.log('')
  console.log('Usage:')
  console.log('  npm run switch:env status  - Show current environment')
  console.log('  npm run switch:env local   - Switch to LocalStack')
  console.log('  npm run switch:env aws     - Switch to real AWS')
  console.log('')
  console.log('Examples:')
  console.log('  # Switch to local development')
  console.log('  npm run switch:env local')
  console.log('  npm run dev:services')
  console.log('  npm run test:connectivity')
  console.log('')
  console.log('  # Switch to real AWS')
  console.log('  npm run switch:env aws')
  console.log('  npm run setup:aws-resources')
  console.log('  npm run test:aws-connectivity')
  
  displayCurrentConfig()
}

if (require.main === module) {
  main()
}