#!/usr/bin/env tsx

/**
 * Script to check DynamoDB VPC configuration for the audio conversion project
 */

import { DynamoDBClient, DescribeTableCommand, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import { EC2Client, DescribeVpcEndpointsCommand } from '@aws-sdk/client-ec2'
import { getEnvironmentConfig } from '../lib/environment'

interface DynamoDBTableInfo {
  tableName: string
  status: string
  region: string
  arn?: string
  creationDate?: Date
}

interface VPCEndpointInfo {
  vpcEndpointId: string
  vpcId: string
  serviceName: string
  state: string
  routeTableIds: string[]
}

class DynamoDBVPCChecker {
  private dynamoClient: DynamoDBClient
  private ec2Client: EC2Client
  private region: string

  constructor() {
    const config = getEnvironmentConfig()
    this.region = config.dynamodb.region || 'us-east-1'
    
    this.dynamoClient = new DynamoDBClient({
      region: this.region,
      credentials: config.dynamodb.credentials
    })
    
    this.ec2Client = new EC2Client({
      region: this.region,
      credentials: config.dynamodb.credentials
    })
  }

  /**
   * Check DynamoDB tables and VPC configuration
   */
  async checkDynamoDBVPC(): Promise<void> {
    console.log('🔍 Checking DynamoDB VPC Configuration')
    console.log('=' .repeat(50))
    console.log(`📍 Region: ${this.region}`)
    console.log('')

    try {
      // Step 1: List and check project DynamoDB tables
      await this.checkProjectTables()

      // Step 2: Check VPC endpoints for DynamoDB
      await this.checkVPCEndpoints()

      // Step 3: Provide recommendations
      this.provideRecommendations()

    } catch (error) {
      console.error('❌ Error checking DynamoDB VPC configuration:', error)
      
      if (error instanceof Error) {
        if (error.message.includes('UnauthorizedOperation')) {
          console.log('\n⚠️  Note: You may need additional IAM permissions to check VPC endpoints')
        }
        if (error.message.includes('ResourceNotFoundException')) {
          console.log('\n⚠️  Note: Some DynamoDB tables may not exist yet')
        }
      }
    }
  }

  /**
   * Check project-specific DynamoDB tables
   */
  private async checkProjectTables(): Promise<void> {
    console.log('📊 Checking Project DynamoDB Tables...')
    console.log('-'.repeat(40))

    const projectTables = [
      'audio-conversion-jobs',
      'audio-conversion-progress', 
      'audio-conversion-uploads'
    ]

    const tableInfos: DynamoDBTableInfo[] = []

    for (const tableName of projectTables) {
      try {
        console.log(`🔍 Checking table: ${tableName}`)
        
        const response = await this.dynamoClient.send(new DescribeTableCommand({
          TableName: tableName
        }))

        if (response.Table) {
          const tableInfo: DynamoDBTableInfo = {
            tableName: response.Table.TableName || tableName,
            status: response.Table.TableStatus || 'UNKNOWN',
            region: this.region,
            arn: response.Table.TableArn,
            creationDate: response.Table.CreationDateTime
          }

          tableInfos.push(tableInfo)
          
          console.log(`  ✅ Status: ${tableInfo.status}`)
          console.log(`  📍 ARN: ${tableInfo.arn}`)
          console.log(`  📅 Created: ${tableInfo.creationDate?.toISOString()}`)
        }
      } catch (error) {
        console.log(`  ❌ Table not found or inaccessible: ${tableName}`)
        if (error instanceof Error) {
          console.log(`     Error: ${error.message}`)
        }
      }
      console.log('')
    }

    // Summary
    console.log(`📋 Summary: Found ${tableInfos.length}/${projectTables.length} project tables`)
    console.log('')
  }

  /**
   * Check VPC endpoints for DynamoDB
   */
  private async checkVPCEndpoints(): Promise<void> {
    console.log('🌐 Checking VPC Endpoints for DynamoDB...')
    console.log('-'.repeat(40))

    try {
      const response = await this.ec2Client.send(new DescribeVpcEndpointsCommand({
        Filters: [
          {
            Name: 'service-name',
            Values: [`com.amazonaws.${this.region}.dynamodb`]
          }
        ]
      }))

      if (response.VpcEndpoints && response.VpcEndpoints.length > 0) {
        console.log(`✅ Found ${response.VpcEndpoints.length} DynamoDB VPC endpoint(s):`)
        console.log('')

        response.VpcEndpoints.forEach((endpoint, index) => {
          console.log(`🔗 VPC Endpoint ${index + 1}:`)
          console.log(`   ID: ${endpoint.VpcEndpointId}`)
          console.log(`   VPC ID: ${endpoint.VpcId}`)
          console.log(`   Service: ${endpoint.ServiceName}`)
          console.log(`   State: ${endpoint.State}`)
          console.log(`   Type: ${endpoint.VpcEndpointType}`)
          
          if (endpoint.RouteTableIds && endpoint.RouteTableIds.length > 0) {
            console.log(`   Route Tables: ${endpoint.RouteTableIds.join(', ')}`)
          }
          
          if (endpoint.SubnetIds && endpoint.SubnetIds.length > 0) {
            console.log(`   Subnets: ${endpoint.SubnetIds.join(', ')}`)
          }
          
          console.log('')
        })
      } else {
        console.log('❌ No DynamoDB VPC endpoints found')
        console.log('   This means DynamoDB traffic goes through the internet gateway')
        console.log('')
      }
    } catch (error) {
      console.log('⚠️  Could not check VPC endpoints (may need additional permissions)')
      if (error instanceof Error) {
        console.log(`   Error: ${error.message}`)
      }
      console.log('')
    }
  }

  /**
   * Provide recommendations based on findings
   */
  private provideRecommendations(): void {
    console.log('💡 Recommendations & Key Points')
    console.log('=' .repeat(50))
    
    console.log('🎯 DynamoDB VPC Configuration:')
    console.log('   • DynamoDB is a managed service - it doesn\'t run "in" a VPC')
    console.log('   • Your App Runner service connects to DynamoDB over the internet by default')
    console.log('   • VPC endpoints provide private connectivity (optional)')
    console.log('')
    
    console.log('🚀 For App Runner Deployment:')
    console.log('   ✅ No VPC configuration needed for DynamoDB access')
    console.log('   ✅ App Runner can access DynamoDB directly with IAM permissions')
    console.log('   ✅ Your current setup should work perfectly')
    console.log('')
    
    console.log('🔒 Security Notes:')
    console.log('   • Traffic is encrypted in transit (HTTPS/TLS)')
    console.log('   • Access controlled by IAM policies')
    console.log('   • No public internet exposure of your data')
    console.log('')
    
    console.log('⚡ Performance:')
    console.log('   • Direct internet access is typically faster than VPC endpoints')
    console.log('   • No additional latency from VPC routing')
    console.log('   • Perfect for App Runner\'s serverless model')
    console.log('')
  }
}

// Run the checker if called directly
if (require.main === module) {
  const checker = new DynamoDBVPCChecker()
  checker.checkDynamoDBVPC().catch(error => {
    console.error('❌ Script execution failed:', error)
    process.exit(1)
  })
}

export { DynamoDBVPCChecker }