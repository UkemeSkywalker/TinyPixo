#!/usr/bin/env tsx

/**
 * Test the specific permissions that were failing in App Runner logs
 */

import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { getEnvironmentConfig } from '../lib/environment'

class SpecificPermissionTester {
  private dynamoClient: DynamoDBClient

  constructor() {
    const config = getEnvironmentConfig()
    this.dynamoClient = new DynamoDBClient({
      region: config.dynamodb.region,
      credentials: config.dynamodb.credentials
    })
  }

  /**
   * Test the exact operations that were failing in App Runner
   */
  async testFailingOperations(): Promise<void> {
    console.log('🎯 Testing Specific Operations That Failed in App Runner')
    console.log('=' .repeat(55))
    console.log('📋 Based on error: audio-conversion-uploads table access')
    console.log('')

    // Test the exact operation that was failing
    await this.testUploadProgressOperations()
  }

  /**
   * Test upload progress operations on audio-conversion-uploads table
   */
  private async testUploadProgressOperations(): Promise<void> {
    console.log('📤 Testing Upload Progress Operations...')
    
    const testFileId = '1755214067213-51224292-fdac-4d54-bbb8-0c9b8adacced'
    const tableName = 'audio-conversion-uploads'

    // Test 1: GetItem (this was failing in your logs)
    console.log(`\n🔍 Testing GetItem on ${tableName}...`)
    try {
      const getResult = await this.dynamoClient.send(new GetItemCommand({
        TableName: tableName,
        Key: {
          'fileId': { S: testFileId }
        }
      }))
      
      console.log('   ✅ GetItem: SUCCESS')
      console.log(`   📄 Result: ${getResult.Item ? 'Item found' : 'Item not found (normal for test)'}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      if (errorMessage.includes('not authorized') || errorMessage.includes('AccessDenied')) {
        console.log('   ❌ GetItem: PERMISSION DENIED')
        console.log(`   🚨 This matches your App Runner error!`)
        console.log(`   Error: ${errorMessage}`)
      } else if (errorMessage.includes('ResourceNotFoundException')) {
        console.log('   ✅ GetItem: PERMISSION OK (table not found)')
        console.log('   💡 Table might not exist yet, but permission is working')
      } else {
        console.log('   ⚠️  GetItem: UNKNOWN ERROR')
        console.log(`   Error: ${errorMessage}`)
      }
    }

    // Test 2: PutItem (this was also failing)
    console.log(`\n📝 Testing PutItem on ${tableName}...`)
    try {
      await this.dynamoClient.send(new PutItemCommand({
        TableName: tableName,
        Item: {
          'fileId': { S: testFileId },
          'fileName': { S: 'test-file.wav' },
          'totalSize': { N: '23385678' },
          'uploadedSize': { N: '0' },
          'totalChunks': { N: '3' },
          'completedChunks': { N: '0' },
          'stage': { S: 'initializing' },
          'ttl': { N: Math.floor(Date.now() / 1000 + 3600).toString() },
          'updatedAt': { N: Date.now().toString() }
        }
      }))
      
      console.log('   ✅ PutItem: SUCCESS')
      console.log('   📝 Test upload progress record created')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      if (errorMessage.includes('not authorized') || errorMessage.includes('AccessDenied')) {
        console.log('   ❌ PutItem: PERMISSION DENIED')
        console.log(`   🚨 This matches your App Runner error!`)
        console.log(`   Error: ${errorMessage}`)
      } else if (errorMessage.includes('ResourceNotFoundException')) {
        console.log('   ✅ PutItem: PERMISSION OK (table not found)')
        console.log('   💡 Table might not exist yet, but permission is working')
      } else {
        console.log('   ⚠️  PutItem: UNKNOWN ERROR')
        console.log(`   Error: ${errorMessage}`)
      }
    }

    // Test 3: Check if table exists
    console.log(`\n🔍 Checking if ${tableName} table exists...`)
    try {
      const { DescribeTableCommand } = await import('@aws-sdk/client-dynamodb')
      await this.dynamoClient.send(new DescribeTableCommand({
        TableName: tableName
      }))
      console.log('   ✅ Table exists and is accessible')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      if (errorMessage.includes('ResourceNotFoundException')) {
        console.log('   ❌ Table does not exist!')
        console.log('   🔧 This could be the root cause of your issues')
      } else if (errorMessage.includes('not authorized') || errorMessage.includes('AccessDenied')) {
        console.log('   ❌ No permission to describe table')
      } else {
        console.log('   ⚠️  Unknown error checking table')
        console.log(`   Error: ${errorMessage}`)
      }
    }

    this.printConclusions()
  }

  /**
   * Print conclusions and recommendations
   */
  private printConclusions(): void {
    console.log('\n' + '='.repeat(55))
    console.log('🎯 CONCLUSIONS & RECOMMENDATIONS')
    console.log('='.repeat(55))

    console.log('\n📊 Based on the test results:')
    console.log('\n✅ If permissions worked:')
    console.log('   • Your IAM policy is correctly configured')
    console.log('   • The issue might be table existence or App Runner role assumption')
    
    console.log('\n❌ If permissions failed:')
    console.log('   • Your IAM policy needs the corrected version we provided')
    console.log('   • Make sure audio-conversion-uploads table is included')
    
    console.log('\n🔧 Next Steps:')
    console.log('   1. If table doesn\'t exist: Run table creation script')
    console.log('   2. If permissions failed: Update IAM policy')
    console.log('   3. If permissions worked: Check App Runner role assumption')
    
    console.log('\n💡 App Runner Specific Notes:')
    console.log('   • App Runner assumes the role differently than your local AWS CLI')
    console.log('   • The role might need time to propagate (wait 5-10 minutes)')
    console.log('   • Try redeploying App Runner service after IAM changes')
    
    console.log('\n🎯 For Smart Temporary Files + 105MB Limit:')
    console.log('   • All 3 DynamoDB tables must exist and have permissions')
    console.log('   • audio-conversion-uploads is critical for upload progress')
    console.log('   • Without this table, uploads will work but progress won\'t display')
  }
}

// Run the specific permission tester if called directly
if (require.main === module) {
  const tester = new SpecificPermissionTester()
  tester.testFailingOperations().catch(error => {
    console.error('❌ Specific permission test failed:', error)
    process.exit(1)
  })
}

export { SpecificPermissionTester }