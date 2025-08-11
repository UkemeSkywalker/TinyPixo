#!/usr/bin/env tsx

/**
 * Diagnose why App Runner service tinypixoaudio-v2 failed to create
 * and check VPC configuration
 */

import { AppRunnerClient, DescribeServiceCommand, ListOperationsCommand } from '@aws-sdk/client-apprunner'
import { CloudWatchLogsClient, DescribeLogGroupsCommand, DescribeLogStreamsCommand, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs'
import { EC2Client, DescribeVpcsCommand } from '@aws-sdk/client-ec2'
import { ElastiCacheClient, DescribeReplicationGroupsCommand, DescribeCacheSubnetGroupsCommand } from '@aws-sdk/client-elasticache'

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const appRunnerClient = new AppRunnerClient({ region: AWS_REGION })
const logsClient = new CloudWatchLogsClient({ region: AWS_REGION })
const ec2Client = new EC2Client({ region: AWS_REGION })
const elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })

const FAILED_SERVICE_ARN = 'arn:aws:apprunner:us-east-1:910883278292:service/tinypixoaudio-v2/ce3d9611498941a8bb64dc6809c0a21d'

async function analyzeFailedService() {
  console.log('🔍 Analyzing failed App Runner service: tinypixoaudio-v2')
  console.log('=======================================================')
  
  try {
    // Get detailed service information
    const serviceDetails = await appRunnerClient.send(new DescribeServiceCommand({
      ServiceArn: FAILED_SERVICE_ARN
    }))
    
    const service = serviceDetails.Service
    if (!service) {
      console.log('❌ Service not found')
      return
    }
    
    console.log(`📍 Service Status: ${service.Status}`)
    console.log(`📍 Service URL: ${service.ServiceUrl || 'Not available'}`)
    console.log(`📍 Created: ${service.CreatedAt}`)
    console.log(`📍 Updated: ${service.UpdatedAt}`)
    
    if (service.HealthCheckConfiguration) {
      console.log(`📍 Health Check: ${service.HealthCheckConfiguration.Protocol} ${service.HealthCheckConfiguration.Path}`)
    }
    
    // Check source configuration
    if (service.SourceConfiguration) {
      console.log('\n📋 Source Configuration:')
      if (service.SourceConfiguration.ImageRepository) {
        const imageRepo = service.SourceConfiguration.ImageRepository
        console.log(`   Image URI: ${imageRepo.ImageIdentifier}`)
        console.log(`   Image Config: ${imageRepo.ImageConfiguration?.Port || 'Default'}`)
        
        if (imageRepo.ImageConfiguration?.RuntimeEnvironmentVariables) {
          console.log('   Environment Variables:')
          for (const [key, value] of Object.entries(imageRepo.ImageConfiguration.RuntimeEnvironmentVariables)) {
            // Don't log sensitive values
            const displayValue = key.includes('SECRET') || key.includes('KEY') ? '[HIDDEN]' : value
            console.log(`     ${key}=${displayValue}`)
          }
        }
      }
    }
    
    // Check network configuration
    if (service.NetworkConfiguration) {
      console.log('\n🌐 Network Configuration:')
      const networkConfig = service.NetworkConfiguration
      
      if (networkConfig.EgressConfiguration) {
        console.log(`   Egress Type: ${networkConfig.EgressConfiguration.EgressType}`)
        if (networkConfig.EgressConfiguration.VpcConnectorArn) {
          console.log(`   VPC Connector: ${networkConfig.EgressConfiguration.VpcConnectorArn}`)
        }
      }
      
      if (networkConfig.IngressConfiguration) {
        console.log(`   Ingress: ${networkConfig.IngressConfiguration.IsPubliclyAccessible ? 'Public' : 'Private'}`)
      }
    }
    
    // Get recent operations to see what failed
    await getServiceOperations()
    
    // Try to get logs
    await getServiceLogs()
    
  } catch (error: any) {
    console.error(`❌ Error analyzing service: ${error.message}`)
  }
}

async function getServiceOperations() {
  console.log('\n📋 Recent Service Operations:')
  
  try {
    const operations = await appRunnerClient.send(new ListOperationsCommand({
      ServiceArn: FAILED_SERVICE_ARN,
      MaxResults: 10
    }))
    
    if (operations.OperationSummaryList) {
      for (const op of operations.OperationSummaryList) {
        console.log(`   ${op.Type}: ${op.Status} (${op.StartedAt})`)
        if (op.Status === 'FAILED') {
          console.log(`     ❌ Target ARN: ${op.TargetArn}`)
        }
      }
    }
  } catch (error: any) {
    console.error(`❌ Error getting operations: ${error.message}`)
  }
}

async function getServiceLogs() {
  console.log('\n📋 Checking CloudWatch Logs:')
  
  try {
    // App Runner logs are typically in /aws/apprunner/[service-name]/[service-id]/application
    const logGroupName = '/aws/apprunner/tinypixoaudio-v2/ce3d9611498941a8bb64dc6809c0a21d/application'
    
    const logGroups = await logsClient.send(new DescribeLogGroupsCommand({
      logGroupNamePrefix: '/aws/apprunner/tinypixoaudio-v2'
    }))
    
    if (logGroups.logGroups && logGroups.logGroups.length > 0) {
      console.log('   Found log groups:')
      for (const group of logGroups.logGroups) {
        console.log(`     - ${group.logGroupName}`)
        
        // Get recent log streams
        const streams = await logsClient.send(new DescribeLogStreamsCommand({
          logGroupName: group.logGroupName,
          orderBy: 'LastEventTime',
          descending: true,
          limit: 3
        }))
        
        if (streams.logStreams) {
          for (const stream of streams.logStreams) {
            console.log(`       Stream: ${stream.logStreamName} (${stream.lastEventTime || 'no timestamp'})`)
            
            // Get recent log events
            const events = await logsClient.send(new GetLogEventsCommand({
              logGroupName: group.logGroupName,
              logStreamName: stream.logStreamName!,
              limit: 10,
              startFromHead: false
            }))
            
            if (events.events) {
              console.log('       Recent events:')
              for (const event of events.events.slice(-5)) {
                console.log(`         ${new Date(event.timestamp!).toISOString()}: ${event.message}`)
              }
            }
          }
        }
      }
    } else {
      console.log('   ❌ No log groups found - service may not have started')
    }
    
  } catch (error: any) {
    console.error(`❌ Error getting logs: ${error.message}`)
  }
}

async function checkVPCConfiguration() {
  console.log('\n🌐 VPC Configuration Analysis:')
  console.log('==============================')
  
  try {
    // Get VPC information
    const vpcs = await ec2Client.send(new DescribeVpcsCommand({}))
    
    if (vpcs.Vpcs) {
      console.log('📍 Available VPCs:')
      for (const vpc of vpcs.Vpcs) {
        const isDefault = vpc.IsDefault ? ' (DEFAULT)' : ''
        console.log(`   ${vpc.VpcId}: ${vpc.CidrBlock}${isDefault}`)
      }
    }
    
    // Get Redis cluster VPC information
    const replicationGroups = await elasticacheClient.send(new DescribeReplicationGroupsCommand({}))
    
    if (replicationGroups.ReplicationGroups) {
      for (const group of replicationGroups.ReplicationGroups) {
        if (group.ReplicationGroupId?.includes('audio-conversion')) {
          console.log(`\n📍 Redis Cluster: ${group.ReplicationGroupId}`)
          
          if (group.CacheSubnetGroupName) {
            console.log(`   Subnet Group: ${group.CacheSubnetGroupName}`)
            
            // Get subnet group details
            const subnetGroups = await elasticacheClient.send(new DescribeCacheSubnetGroupsCommand({
              CacheSubnetGroupName: group.CacheSubnetGroupName
            }))
            
            if (subnetGroups.CacheSubnetGroups?.[0]) {
              const subnetGroup = subnetGroups.CacheSubnetGroups[0]
              console.log(`   VPC ID: ${subnetGroup.VpcId}`)
              console.log(`   Subnets:`)
              
              if (subnetGroup.Subnets) {
                for (const subnet of subnetGroup.Subnets) {
                  console.log(`     - ${subnet.SubnetIdentifier} (${subnet.SubnetAvailabilityZone?.Name})`)
                }
              }
            }
          }
        }
      }
    }
    
  } catch (error: any) {
    console.error(`❌ Error checking VPC configuration: ${error.message}`)
  }
}

async function listPossibleIssues() {
  console.log('\n🚨 Possible Issues with tinypixoaudio-v2:')
  console.log('=========================================')
  
  console.log('\n1. **Service Creation Failure:**')
  console.log('   - Docker image build failed')
  console.log('   - Invalid environment variables')
  console.log('   - Health check failing')
  console.log('   - Resource limits exceeded')
  
  console.log('\n2. **Network Connectivity:**')
  console.log('   - App Runner and Redis in different VPCs')
  console.log('   - Security group rules missing')
  console.log('   - Subnet routing issues')
  
  console.log('\n3. **Configuration Issues:**')
  console.log('   - Wrong Redis endpoint in environment variables')
  console.log('   - TLS configuration mismatch')
  console.log('   - Port configuration incorrect')
  
  console.log('\n4. **Resource Issues:**')
  console.log('   - Insufficient CPU/memory allocation')
  console.log('   - Docker image too large')
  console.log('   - Build timeout')
  
  console.log('\n5. **Permission Issues:**')
  console.log('   - App Runner service role missing permissions')
  console.log('   - ECR access denied')
  console.log('   - AWS service access denied')
  
  console.log('\n💡 Next Steps:')
  console.log('   1. Check the service logs above for specific error messages')
  console.log('   2. Verify environment variables match Redis configuration')
  console.log('   3. Ensure both services are in the same VPC')
  console.log('   4. Try recreating the App Runner service')
}

async function main() {
  await analyzeFailedService()
  await checkVPCConfiguration()
  await listPossibleIssues()
}

if (require.main === module) {
  main()
}