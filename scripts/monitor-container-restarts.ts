#!/usr/bin/env tsx

/**
 * Container restart monitoring script
 * Monitors App Runner service for container restarts and job recovery
 */

import { 
  AppRunnerClient, 
  DescribeServiceCommand,
  ListOperationsCommand,
  ListServicesCommand
} from '@aws-sdk/client-apprunner'
import { 
  CloudWatchLogsClient, 
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  GetLogEventsCommand
} from '@aws-sdk/client-cloudwatch-logs'

const AWS_REGION = 'us-east-1'
const SERVICE_NAME = 'tinypixo-audio'

interface RestartEvent {
  timestamp: Date
  reason: string
  logStream: string
  activeJobs?: number
}

class ContainerRestartMonitor {
  private appRunnerClient: AppRunnerClient
  private cloudWatchClient: CloudWatchLogsClient
  private serviceArn: string | null = null
  private logGroupName: string | null = null

  constructor() {
    this.appRunnerClient = new AppRunnerClient({ region: AWS_REGION })
    this.cloudWatchClient = new CloudWatchLogsClient({ region: AWS_REGION })
  }

  async initialize() {
    console.log('🔍 Initializing container restart monitor...')
    
    // Find the service ARN
    const services = await this.appRunnerClient.send(new ListServicesCommand({}))
    // Note: This is a simplified approach - in practice you'd need to find the service differently
    
    // For now, we'll construct the log group name based on service name
    this.logGroupName = `/aws/apprunner/${SERVICE_NAME}/application`
    
    console.log(`📊 Monitoring log group: ${this.logGroupName}`)
  }

  async checkForRestarts(sinceMinutes: number = 60): Promise<RestartEvent[]> {
    if (!this.logGroupName) {
      throw new Error('Monitor not initialized')
    }

    const restartEvents: RestartEvent[] = []
    const startTime = new Date(Date.now() - (sinceMinutes * 60 * 1000))

    try {
      // Get log streams
      const logStreamsResponse = await this.cloudWatchClient.send(
        new DescribeLogStreamsCommand({
          logGroupName: this.logGroupName,
          orderBy: 'LastEventTime',
          descending: true,
          limit: 10
        })
      )

      if (!logStreamsResponse.logStreams) {
        console.log('⚠️  No log streams found')
        return restartEvents
      }

      // Check each log stream for restart indicators
      for (const logStream of logStreamsResponse.logStreams) {
        if (!logStream.logStreamName) continue

        try {
          const logEventsResponse = await this.cloudWatchClient.send(
            new GetLogEventsCommand({
              logGroupName: this.logGroupName,
              logStreamName: logStream.logStreamName,
              startTime: startTime.getTime(),
              limit: 1000
            })
          )

          if (logEventsResponse.events) {
            for (const event of logEventsResponse.events) {
              if (this.isRestartEvent(event.message || '')) {
                restartEvents.push({
                  timestamp: new Date(event.timestamp || 0),
                  reason: this.extractRestartReason(event.message || ''),
                  logStream: logStream.logStreamName,
                  activeJobs: this.extractActiveJobs(event.message || '')
                })
              }
            }
          }
        } catch (error) {
          console.warn(`⚠️  Could not read log stream ${logStream.logStreamName}:`, error.message)
        }
      }
    } catch (error) {
      console.error('❌ Error checking for restarts:', error)
    }

    return restartEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }

  private isRestartEvent(message: string): boolean {
    const restartIndicators = [
      'Container started',
      'Application starting',
      'Server listening',
      'Health check',
      'Process restarted',
      'Container restart',
      'Service restart'
    ]

    return restartIndicators.some(indicator => 
      message.toLowerCase().includes(indicator.toLowerCase())
    )
  }

  private extractRestartReason(message: string): string {
    if (message.includes('memory')) return 'Memory pressure'
    if (message.includes('timeout')) return 'Health check timeout'
    if (message.includes('error')) return 'Application error'
    if (message.includes('scale')) return 'Auto-scaling'
    return 'Unknown'
  }

  private extractActiveJobs(message: string): number | undefined {
    const match = message.match(/activeJobs[:\s]+(\d+)/i)
    return match ? parseInt(match[1]) : undefined
  }

  async monitorJobRecovery(baseUrl: string): Promise<void> {
    console.log('🔄 Monitoring job recovery after restarts...')
    
    const restarts = await this.checkForRestarts(30) // Last 30 minutes
    
    if (restarts.length === 0) {
      console.log('✅ No container restarts detected in the last 30 minutes')
      return
    }

    console.log(`🔄 Found ${restarts.length} container restart(s):`)
    
    for (const restart of restarts) {
      console.log(`  📅 ${restart.timestamp.toISOString()}`)
      console.log(`  📝 Reason: ${restart.reason}`)
      console.log(`  📊 Active jobs: ${restart.activeJobs || 'unknown'}`)
      console.log(`  📋 Log stream: ${restart.logStream}`)
      console.log()
    }

    // Test job recovery by checking health endpoint
    try {
      const healthResponse = await fetch(`${baseUrl}/api/health`)
      
      if (healthResponse.ok) {
        const health = await healthResponse.json()
        console.log('✅ Service is healthy after restarts')
        console.log(`📊 Current active jobs: ${health.activeJobs}`)
        console.log(`🔧 Services status:`)
        console.log(`  S3: ${health.services?.s3?.status || 'unknown'}`)
        console.log(`  DynamoDB: ${health.services?.dynamodb?.status || 'unknown'}`)
        console.log(`  Redis: ${health.services?.redis?.status || 'unknown'}`)
      } else {
        console.log('❌ Service is unhealthy after restarts')
      }
    } catch (error) {
      console.error('❌ Could not check service health:', error.message)
    }
  }

  async simulateContainerRestart(baseUrl: string): Promise<void> {
    console.log('🧪 Simulating container restart scenario...')
    
    // Step 1: Start a conversion job
    console.log('1️⃣ Starting a test conversion job...')
    
    try {
      // Create a test file upload
      const testData = new Uint8Array(1024 * 1024) // 1MB test data
      const formData = new FormData()
      const blob = new Blob([testData], { type: 'audio/mpeg' })
      formData.append('file', blob, 'restart-test.mp3')

      const uploadResponse = await fetch(`${baseUrl}/api/upload-audio`, {
        method: 'POST',
        body: formData
      })

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.status}`)
      }

      const uploadResult = await uploadResponse.json()
      const fileId = uploadResult.fileId

      // Start conversion
      const conversionResponse = await fetch(`${baseUrl}/api/convert-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          format: 'wav',
          quality: '192k'
        })
      })

      if (!conversionResponse.ok) {
        throw new Error(`Conversion failed: ${conversionResponse.status}`)
      }

      const conversionResult = await conversionResponse.json()
      const jobId = conversionResult.jobId

      console.log(`✅ Started job: ${jobId}`)

      // Step 2: Monitor progress briefly
      console.log('2️⃣ Monitoring initial progress...')
      
      let initialProgress = 0
      for (let i = 0; i < 5; i++) {
        const progressResponse = await fetch(`${baseUrl}/api/progress?jobId=${jobId}`)
        
        if (progressResponse.ok) {
          const progress = await progressResponse.json()
          initialProgress = progress.progress
          console.log(`   Progress: ${progress.progress}%`)
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      // Step 3: Instructions for manual restart
      console.log('\n3️⃣ MANUAL ACTION REQUIRED:')
      console.log('   Go to AWS App Runner console')
      console.log('   Find your service and trigger a restart')
      console.log('   Wait for the service to restart completely')
      console.log('   Then press Enter to continue monitoring...')
      
      // Wait for user input
      await new Promise(resolve => {
        process.stdin.once('data', () => resolve(true))
      })

      // Step 4: Check job recovery
      console.log('4️⃣ Checking job recovery after restart...')
      
      let recoveryAttempts = 0
      const maxRecoveryAttempts = 30
      
      while (recoveryAttempts < maxRecoveryAttempts) {
        try {
          const progressResponse = await fetch(`${baseUrl}/api/progress?jobId=${jobId}`)
          
          if (progressResponse.ok) {
            const progress = await progressResponse.json()
            console.log(`   Recovery progress: ${progress.progress}%`)
            
            if (progress.progress >= 100) {
              console.log('✅ Job completed successfully after restart!')
              break
            }
            
            if (progress.progress === -1) {
              console.log('❌ Job failed after restart')
              break
            }
          } else {
            console.log(`   Progress check failed: ${progressResponse.status}`)
          }
        } catch (error) {
          console.log(`   Recovery check error: ${error.message}`)
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000))
        recoveryAttempts++
      }
      
      if (recoveryAttempts >= maxRecoveryAttempts) {
        console.log('⚠️  Recovery monitoring timed out')
      }

    } catch (error) {
      console.error('❌ Restart simulation failed:', error)
    }
  }
}

async function main() {
  const command = process.argv[2]
  const baseUrl = process.argv[3]
  
  if (!command || !baseUrl) {
    console.error('❌ Usage: tsx scripts/monitor-container-restarts.ts <command> <base-url>')
    console.log('Commands:')
    console.log('  check    - Check for recent container restarts')
    console.log('  monitor  - Monitor job recovery after restarts')
    console.log('  simulate - Simulate restart scenario (requires manual restart)')
    console.log('')
    console.log('Example: tsx scripts/monitor-container-restarts.ts check https://tinypixo-audio.us-east-1.awsapprunner.com')
    process.exit(1)
  }
  
  const monitor = new ContainerRestartMonitor()
  
  try {
    await monitor.initialize()
    
    switch (command) {
      case 'check':
        const restarts = await monitor.checkForRestarts(60)
        if (restarts.length === 0) {
          console.log('✅ No container restarts detected in the last hour')
        } else {
          console.log(`🔄 Found ${restarts.length} restart(s) in the last hour`)
        }
        break
        
      case 'monitor':
        await monitor.monitorJobRecovery(baseUrl)
        break
        
      case 'simulate':
        await monitor.simulateContainerRestart(baseUrl)
        break
        
      default:
        console.error(`❌ Unknown command: ${command}`)
        process.exit(1)
    }
  } catch (error) {
    console.error('❌ Monitor failed:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}