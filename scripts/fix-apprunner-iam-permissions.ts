#!/usr/bin/env tsx

/**
 * Script to generate the correct IAM policy for App Runner with Smart Temporary Files + 105MB Limit
 */

import { writeFileSync } from 'fs'
import { join } from 'path'

interface IAMPolicyDocument {
  Version: string
  Statement: IAMStatement[]
}

interface IAMStatement {
  Effect: string
  Action: string[]
  Resource: string[]
}

class AppRunnerIAMPolicyGenerator {
  private readonly accountId = '910883278292'
  private readonly region = 'us-east-1'

  /**
   * Generate the complete IAM policy for App Runner
   */
  generateCompletePolicy(): IAMPolicyDocument {
    console.log('🔧 Generating Complete IAM Policy for App Runner')
    console.log('=' .repeat(50))

    const policy: IAMPolicyDocument = {
      Version: '2012-10-17',
      Statement: [
        this.generateS3Permissions(),
        this.generateDynamoDBPermissions(),
        this.generateLogsPermissions()
      ]
    }

    return policy
  }

  /**
   * Generate S3 permissions
   */
  private generateS3Permissions(): IAMStatement {
    return {
      Effect: 'Allow',
      Action: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
        's3:GetBucketLocation',
        's3:CreateMultipartUpload',
        's3:UploadPart',
        's3:CompleteMultipartUpload',
        's3:AbortMultipartUpload',
        's3:ListMultipartUploads',
        's3:ListParts'
      ],
      Resource: [
        `arn:aws:s3:::audio-conversion-app-bucket`,
        `arn:aws:s3:::audio-conversion-app-bucket/*`
      ]
    }
  }

  /**
   * Generate DynamoDB permissions for all Smart Temporary Files tables
   */
  private generateDynamoDBPermissions(): IAMStatement {
    const tables = [
      'audio-conversion-jobs',
      'audio-conversion-progress', 
      'audio-conversion-uploads'
    ]

    const tableArns = tables.map(table => 
      `arn:aws:dynamodb:${this.region}:${this.accountId}:table/${table}`
    )

    return {
      Effect: 'Allow',
      Action: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:DescribeTable',
        'dynamodb:DescribeTimeToLive',
        'dynamodb:UpdateTimeToLive'
      ],
      Resource: tableArns
    }
  }

  /**
   * Generate CloudWatch Logs permissions
   */
  private generateLogsPermissions(): IAMStatement {
    return {
      Effect: 'Allow',
      Action: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogGroups',
        'logs:DescribeLogStreams'
      ],
      Resource: [
        `arn:aws:logs:${this.region}:${this.accountId}:log-group:/aws/apprunner/*`
      ]
    }
  }

  /**
   * Generate AWS CLI commands to update the policy
   */
  generateAWSCLICommands(): string[] {
    return [
      '# Step 1: Get the current policy ARN',
      'aws iam list-attached-role-policies --role-name AudioConversionAppRunnerRole',
      '',
      '# Step 2: Create new policy version (replace POLICY_ARN with actual ARN)',
      'aws iam create-policy-version \\',
      '  --policy-arn POLICY_ARN \\',
      '  --policy-document file://apprunner-iam-policy.json \\',
      '  --set-as-default',
      '',
      '# Alternative: If you need to create a new policy',
      'aws iam create-policy \\',
      '  --policy-name AudioConversionAppRunnerPolicy \\',
      '  --policy-document file://apprunner-iam-policy.json',
      '',
      '# Then attach it to the role',
      'aws iam attach-role-policy \\',
      '  --role-name AudioConversionAppRunnerRole \\',
      '  --policy-arn arn:aws:iam::910883278292:policy/AudioConversionAppRunnerPolicy'
    ]
  }

  /**
   * Run the complete policy generation
   */
  async run(): Promise<void> {
    try {
      // Generate the policy
      const policy = this.generateCompletePolicy()
      
      // Save policy to file
      const policyFile = join(process.cwd(), 'apprunner-iam-policy.json')
      writeFileSync(policyFile, JSON.stringify(policy, null, 2))
      
      // Generate CLI commands
      const commands = this.generateAWSCLICommands()
      const commandsFile = join(process.cwd(), 'update-apprunner-iam.sh')
      writeFileSync(commandsFile, commands.join('\n'))
      
      // Print summary
      this.printSummary(policyFile, commandsFile)
      
    } catch (error) {
      console.error('❌ Failed to generate IAM policy:', error)
      process.exit(1)
    }
  }

  /**
   * Print summary and instructions
   */
  private printSummary(policyFile: string, commandsFile: string): void {
    console.log('\n✅ IAM Policy Generated Successfully!')
    console.log('=' .repeat(50))
    
    console.log('\n📄 Files Created:')
    console.log(`   • ${policyFile}`)
    console.log(`   • ${commandsFile}`)
    
    console.log('\n🔧 Missing Permissions Identified:')
    console.log('   ❌ dynamodb:GetItem on audio-conversion-uploads')
    console.log('   ❌ dynamodb:PutItem on audio-conversion-uploads')
    console.log('   ❌ Other DynamoDB operations on new tables')
    
    console.log('\n🚀 Quick Fix Options:')
    console.log('\n   Option 1: AWS Console (Recommended)')
    console.log('   1. Go to IAM → Roles → AudioConversionAppRunnerRole')
    console.log('   2. Find attached policy and edit it')
    console.log('   3. Add permissions for audio-conversion-uploads table')
    console.log('   4. Save changes')
    
    console.log('\n   Option 2: AWS CLI')
    console.log(`   1. Review: ${commandsFile}`)
    console.log('   2. Update POLICY_ARN with your actual policy ARN')
    console.log('   3. Run the commands')
    
    console.log('\n🎯 Required DynamoDB Tables:')
    console.log('   ✅ audio-conversion-jobs (existing)')
    console.log('   ✅ audio-conversion-progress (existing)')
    console.log('   ❌ audio-conversion-uploads (needs permissions)')
    
    console.log('\n⚡ After fixing permissions:')
    console.log('   • Upload progress tracking will work')
    console.log('   • Smart Temporary Files will function properly')
    console.log('   • 105MB file uploads will be reliable')
    
    console.log('\n🔍 To verify the fix:')
    console.log('   • Try uploading a file again')
    console.log('   • Check App Runner logs for success')
    console.log('   • Upload progress should display correctly')
  }
}

// Run the generator if called directly
if (require.main === module) {
  const generator = new AppRunnerIAMPolicyGenerator()
  generator.run().catch(error => {
    console.error('❌ Script execution failed:', error)
    process.exit(1)
  })
}

export { AppRunnerIAMPolicyGenerator }