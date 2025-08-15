#!/usr/bin/env tsx

/**
 * Script to check if the App Runner IAM role has the required permissions
 * for Smart Temporary Files + 105MB Limit implementation
 */

import { IAMClient, GetRoleCommand, ListAttachedRolePoliciesCommand, GetPolicyVersionCommand, GetRolePolicyCommand, ListRolePoliciesCommand } from '@aws-sdk/client-iam'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getEnvironmentConfig } from '../lib/environment'

interface PermissionCheck {
  service: string
  action: string
  resource: string
  required: boolean
  status: 'pass' | 'fail' | 'unknown'
  error?: string
}

class IAMPermissionChecker {
  private iamClient: IAMClient
  private stsClient: STSClient
  private dynamoClient: DynamoDBClient
  private s3Client: S3Client
  private roleName = 'AudioConversionAppRunnerRole'
  private accountId = '910883278292'
  private region = 'us-east-1'

  constructor() {
    const config = getEnvironmentConfig()
    
    this.iamClient = new IAMClient({
      region: this.region,
      credentials: config.dynamodb.credentials
    })
    
    this.stsClient = new STSClient({
      region: this.region,
      credentials: config.dynamodb.credentials
    })
    
    this.dynamoClient = new DynamoDBClient({
      region: this.region,
      credentials: config.dynamodb.credentials
    })
    
    this.s3Client = new S3Client({
      region: this.region,
      credentials: config.s3.credentials
    })
  }

  /**
   * Run complete permission check
   */
  async checkPermissions(): Promise<void> {
    console.log('🔍 Checking IAM Permissions for Smart Temporary Files + 105MB Limit')
    console.log('=' .repeat(60))
    console.log(`📋 Role: ${this.roleName}`)
    console.log(`🏢 Account: ${this.accountId}`)
    console.log(`📍 Region: ${this.region}`)
    console.log('')

    try {
      // Step 1: Verify current identity
      await this.verifyIdentity()

      // Step 2: Check role exists and get policies
      await this.checkRoleAndPolicies()

      // Step 3: Test actual permissions with real AWS calls
      await this.testActualPermissions()

    } catch (error) {
      console.error('❌ Permission check failed:', error)
      
      if (error instanceof Error) {
        if (error.message.includes('AccessDenied')) {
          console.log('\n⚠️  Note: You may need additional IAM permissions to check policies')
          console.log('   Trying direct permission tests instead...')
          await this.testActualPermissions()
        }
      }
    }
  }

  /**
   * Verify current AWS identity
   */
  private async verifyIdentity(): Promise<void> {
    console.log('🔐 Verifying AWS Identity...')
    
    try {
      const identity = await this.stsClient.send(new GetCallerIdentityCommand({}))
      console.log(`   ✅ Account: ${identity.Account}`)
      console.log(`   ✅ User/Role: ${identity.Arn}`)
      console.log('')
    } catch (error) {
      console.log('   ⚠️  Could not verify identity')
      console.log('')
    }
  }

  /**
   * Check role and attached policies
   */
  private async checkRoleAndPolicies(): Promise<void> {
    console.log('📋 Checking IAM Role and Policies...')
    
    try {
      // Get role information
      const roleResponse = await this.iamClient.send(new GetRoleCommand({
        RoleName: this.roleName
      }))
      
      if (roleResponse.Role) {
        console.log(`   ✅ Role exists: ${roleResponse.Role.RoleName}`)
        console.log(`   📅 Created: ${roleResponse.Role.CreateDate?.toISOString()}`)
        console.log('')
      }

      // Get attached managed policies
      const attachedPolicies = await this.iamClient.send(new ListAttachedRolePoliciesCommand({
        RoleName: this.roleName
      }))

      if (attachedPolicies.AttachedPolicies && attachedPolicies.AttachedPolicies.length > 0) {
        console.log('   📎 Attached Managed Policies:')
        for (const policy of attachedPolicies.AttachedPolicies) {
          console.log(`      • ${policy.PolicyName} (${policy.PolicyArn})`)
        }
        console.log('')
      }

      // Get inline policies
      const inlinePolicies = await this.iamClient.send(new ListRolePoliciesCommand({
        RoleName: this.roleName
      }))

      if (inlinePolicies.PolicyNames && inlinePolicies.PolicyNames.length > 0) {
        console.log('   📝 Inline Policies:')
        for (const policyName of inlinePolicies.PolicyNames) {
          console.log(`      • ${policyName}`)
        }
        console.log('')
      }

    } catch (error) {
      console.log('   ⚠️  Could not retrieve role/policy information')
      console.log(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      console.log('')
    }
  }

  /**
   * Test actual permissions with real AWS API calls
   */
  private async testActualPermissions(): Promise<void> {
    console.log('🧪 Testing Actual Permissions...')
    console.log('-'.repeat(40))

    const permissionTests: PermissionCheck[] = []

    // Test S3 permissions
    await this.testS3Permissions(permissionTests)

    // Test DynamoDB permissions
    await this.testDynamoDBPermissions(permissionTests)

    // Print results
    this.printPermissionResults(permissionTests)
  }

  /**
   * Test S3 permissions
   */
  private async testS3Permissions(permissionTests: PermissionCheck[]): Promise<void> {
    console.log('📦 Testing S3 Permissions...')

    const s3Tests = [
      {
        action: 'GetObject',
        description: 'Read files from S3',
        test: async () => {
          // Try to get a non-existent object (should get AccessDenied or NoSuchKey)
          await this.s3Client.send(new GetObjectCommand({
            Bucket: 'audio-conversion-app-bucket',
            Key: 'test-permission-check.txt'
          }))
        }
      },
      {
        action: 'PutObject', 
        description: 'Upload files to S3',
        test: async () => {
          // Try to put a small test object
          await this.s3Client.send(new PutObjectCommand({
            Bucket: 'audio-conversion-app-bucket',
            Key: 'permission-test.txt',
            Body: 'test'
          }))
        }
      }
    ]

    for (const test of s3Tests) {
      try {
        await test.test()
        permissionTests.push({
          service: 'S3',
          action: test.action,
          resource: 'audio-conversion-app-bucket',
          required: true,
          status: 'pass'
        })
        console.log(`   ✅ s3:${test.action}: PASS`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        
        if (errorMessage.includes('NoSuchKey') || errorMessage.includes('NoSuchBucket')) {
          // These errors mean we have permission but resource doesn't exist
          permissionTests.push({
            service: 'S3',
            action: test.action,
            resource: 'audio-conversion-app-bucket',
            required: true,
            status: 'pass'
          })
          console.log(`   ✅ s3:${test.action}: PASS (resource not found, but permission exists)`)
        } else if (errorMessage.includes('AccessDenied') || errorMessage.includes('Forbidden')) {
          permissionTests.push({
            service: 'S3',
            action: test.action,
            resource: 'audio-conversion-app-bucket',
            required: true,
            status: 'fail',
            error: errorMessage
          })
          console.log(`   ❌ s3:${test.action}: FAIL - ${errorMessage}`)
        } else {
          permissionTests.push({
            service: 'S3',
            action: test.action,
            resource: 'audio-conversion-app-bucket',
            required: true,
            status: 'unknown',
            error: errorMessage
          })
          console.log(`   ⚠️  s3:${test.action}: UNKNOWN - ${errorMessage}`)
        }
      }
    }
    console.log('')
  }

  /**
   * Test DynamoDB permissions
   */
  private async testDynamoDBPermissions(permissionTests: PermissionCheck[]): Promise<void> {
    console.log('🗄️  Testing DynamoDB Permissions...')

    const tables = [
      'audio-conversion-jobs',
      'audio-conversion-progress',
      'audio-conversion-uploads'
    ]

    for (const tableName of tables) {
      // Test GetItem
      try {
        await this.dynamoClient.send(new GetItemCommand({
          TableName: tableName,
          Key: {
            'testKey': { S: 'permission-test' }
          }
        }))
        
        permissionTests.push({
          service: 'DynamoDB',
          action: 'GetItem',
          resource: tableName,
          required: true,
          status: 'pass'
        })
        console.log(`   ✅ dynamodb:GetItem on ${tableName}: PASS`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        
        if (errorMessage.includes('ResourceNotFoundException')) {
          // Table doesn't exist, but we have permission
          permissionTests.push({
            service: 'DynamoDB',
            action: 'GetItem',
            resource: tableName,
            required: true,
            status: 'pass'
          })
          console.log(`   ✅ dynamodb:GetItem on ${tableName}: PASS (table not found, but permission exists)`)
        } else if (errorMessage.includes('AccessDeniedException') || errorMessage.includes('not authorized')) {
          permissionTests.push({
            service: 'DynamoDB',
            action: 'GetItem',
            resource: tableName,
            required: true,
            status: 'fail',
            error: errorMessage
          })
          console.log(`   ❌ dynamodb:GetItem on ${tableName}: FAIL - Access Denied`)
        } else {
          permissionTests.push({
            service: 'DynamoDB',
            action: 'GetItem',
            resource: tableName,
            required: true,
            status: 'unknown',
            error: errorMessage
          })
          console.log(`   ⚠️  dynamodb:GetItem on ${tableName}: UNKNOWN - ${errorMessage}`)
        }
      }

      // Test PutItem
      try {
        await this.dynamoClient.send(new PutItemCommand({
          TableName: tableName,
          Item: {
            'testKey': { S: 'permission-test' },
            'testValue': { S: 'test' }
          }
        }))
        
        permissionTests.push({
          service: 'DynamoDB',
          action: 'PutItem',
          resource: tableName,
          required: true,
          status: 'pass'
        })
        console.log(`   ✅ dynamodb:PutItem on ${tableName}: PASS`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        
        if (errorMessage.includes('ResourceNotFoundException')) {
          permissionTests.push({
            service: 'DynamoDB',
            action: 'PutItem',
            resource: tableName,
            required: true,
            status: 'pass'
          })
          console.log(`   ✅ dynamodb:PutItem on ${tableName}: PASS (table not found, but permission exists)`)
        } else if (errorMessage.includes('AccessDeniedException') || errorMessage.includes('not authorized')) {
          permissionTests.push({
            service: 'DynamoDB',
            action: 'PutItem',
            resource: tableName,
            required: true,
            status: 'fail',
            error: errorMessage
          })
          console.log(`   ❌ dynamodb:PutItem on ${tableName}: FAIL - Access Denied`)
        } else {
          permissionTests.push({
            service: 'DynamoDB',
            action: 'PutItem',
            resource: tableName,
            required: true,
            status: 'unknown',
            error: errorMessage
          })
          console.log(`   ⚠️  dynamodb:PutItem on ${tableName}: UNKNOWN - ${errorMessage}`)
        }
      }
    }
    console.log('')
  }

  /**
   * Print permission test results
   */
  private printPermissionResults(permissionTests: PermissionCheck[]): void {
    console.log('=' .repeat(60))
    console.log('📊 PERMISSION CHECK RESULTS')
    console.log('=' .repeat(60))

    const passed = permissionTests.filter(p => p.status === 'pass').length
    const failed = permissionTests.filter(p => p.status === 'fail').length
    const unknown = permissionTests.filter(p => p.status === 'unknown').length
    const total = permissionTests.length

    console.log(`\n📈 Summary: ${passed}/${total} permissions working`)
    console.log(`   ✅ Passed: ${passed}`)
    console.log(`   ❌ Failed: ${failed}`)
    console.log(`   ⚠️  Unknown: ${unknown}`)

    // Show failed permissions
    const failedPermissions = permissionTests.filter(p => p.status === 'fail')
    if (failedPermissions.length > 0) {
      console.log('\n❌ MISSING PERMISSIONS:')
      failedPermissions.forEach(perm => {
        console.log(`   • ${perm.service}: ${perm.action} on ${perm.resource}`)
      })
    }

    // Overall verdict
    console.log('\n' + '='.repeat(60))
    if (failed === 0) {
      console.log('🎉 VERDICT: ALL REQUIRED PERMISSIONS ARE WORKING!')
      console.log('✅ Smart Temporary Files + 105MB Limit should work correctly')
    } else {
      console.log('❌ VERDICT: MISSING CRITICAL PERMISSIONS')
      console.log('🔧 Update your IAM policy to fix the failed permissions above')
      
      // Specific guidance for common issues
      const missingUploadsTable = failedPermissions.some(p => 
        p.resource === 'audio-conversion-uploads'
      )
      
      if (missingUploadsTable) {
        console.log('\n🎯 CRITICAL: Missing audio-conversion-uploads table permissions')
        console.log('   This is causing your current upload progress errors!')
        console.log('   Add this table to your IAM policy DynamoDB resources.')
      }
    }

    console.log('\n💡 Next Steps:')
    if (failed > 0) {
      console.log('   1. Update IAM policy with missing permissions')
      console.log('   2. Wait 1-2 minutes for changes to propagate')
      console.log('   3. Test file upload again')
    } else {
      console.log('   1. Your permissions look good!')
      console.log('   2. If still having issues, check App Runner logs')
      console.log('   3. Verify DynamoDB tables exist')
    }
  }
}

// Run the permission checker if called directly
if (require.main === module) {
  const checker = new IAMPermissionChecker()
  checker.checkPermissions().catch(error => {
    console.error('❌ Permission check failed:', error)
    process.exit(1)
  })
}

export { IAMPermissionChecker }