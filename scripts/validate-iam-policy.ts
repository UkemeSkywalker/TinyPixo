#!/usr/bin/env tsx

/**
 * Script to validate the proposed IAM policy for App Runner
 */

interface IAMPolicyDocument {
  Version: string
  Statement: any[]
}

class IAMPolicyValidator {
  private policy: IAMPolicyDocument

  constructor(policyJson: string) {
    this.policy = JSON.parse(policyJson)
  }

  /**
   * Validate the complete policy
   */
  validatePolicy(): void {
    console.log('🔍 Validating IAM Policy for Smart Temporary Files + 105MB Limit')
    console.log('=' .repeat(60))

    const issues: string[] = []
    const warnings: string[] = []
    const successes: string[] = []

    // Validate each statement
    this.policy.Statement.forEach((statement, index) => {
      console.log(`\n📋 Statement ${index + 1}:`)
      this.validateStatement(statement, issues, warnings, successes)
    })

    // Check for missing permissions
    this.checkMissingPermissions(issues, warnings)

    // Print results
    this.printResults(issues, warnings, successes)
  }

  /**
   * Validate individual statement
   */
  private validateStatement(statement: any, issues: string[], warnings: string[], successes: string[]): void {
    // Check S3 permissions
    if (statement.Resource && statement.Resource.some((r: string) => r.includes('s3::'))) {
      this.validateS3Statement(statement, issues, warnings, successes)
    }

    // Check DynamoDB permissions
    if (statement.Resource && (
      typeof statement.Resource === 'string' && statement.Resource.includes('dynamodb') ||
      Array.isArray(statement.Resource) && statement.Resource.some((r: string) => r.includes('dynamodb'))
    )) {
      this.validateDynamoDBStatement(statement, issues, warnings, successes)
    }

    // Check ElastiCache permissions
    if (statement.Action && statement.Action.includes('elasticache:*')) {
      warnings.push('ElastiCache permissions included but not needed for Smart Temporary Files')
    }
  }

  /**
   * Validate S3 statement
   */
  private validateS3Statement(statement: any, issues: string[], warnings: string[], successes: string[]): void {
    const requiredS3Actions = [
      's3:GetObject',
      's3:PutObject', 
      's3:DeleteObject',
      's3:ListBucket'
    ]

    const multipartActions = [
      's3:CreateMultipartUpload',
      's3:UploadPart',
      's3:CompleteMultipartUpload',
      's3:AbortMultipartUpload'
    ]

    // Check basic actions
    const hasBasicActions = requiredS3Actions.every(action => statement.Action.includes(action))
    if (hasBasicActions) {
      successes.push('✅ S3 basic permissions: Present')
    } else {
      const missing = requiredS3Actions.filter(action => !statement.Action.includes(action))
      issues.push(`❌ S3 missing actions: ${missing.join(', ')}`)
    }

    // Check multipart upload actions (important for large files)
    const hasMultipartActions = multipartActions.some(action => statement.Action.includes(action))
    if (!hasMultipartActions) {
      warnings.push('⚠️  S3 multipart upload actions missing (needed for files > 5MB)')
    } else {
      successes.push('✅ S3 multipart upload: Supported')
    }

    // Check bucket resource
    const bucketResource = 'arn:aws:s3:::audio-conversion-app-bucket'
    const objectResource = 'arn:aws:s3:::audio-conversion-app-bucket/*'
    
    if (statement.Resource.includes(bucketResource) && statement.Resource.includes(objectResource)) {
      successes.push('✅ S3 bucket and object resources: Correct')
    } else {
      issues.push('❌ S3 resources incomplete (need both bucket and bucket/*)')
    }
  }

  /**
   * Validate DynamoDB statement
   */
  private validateDynamoDBStatement(statement: any, issues: string[], warnings: string[], successes: string[]): void {
    const requiredActions = [
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem'
    ]

    const hasRequiredActions = requiredActions.every(action => statement.Action.includes(action))
    if (hasRequiredActions) {
      successes.push('✅ DynamoDB basic actions: Present')
    } else {
      const missing = requiredActions.filter(action => !statement.Action.includes(action))
      issues.push(`❌ DynamoDB missing actions: ${missing.join(', ')}`)
    }

    // Check resources
    const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource]
    
    // Check for wildcard in jobs table (potential issue)
    const jobsTableWildcard = resources.some((r: string) => 
      r.includes('audio-conversion-jobs') && r.includes('*')
    )
    if (jobsTableWildcard) {
      warnings.push('⚠️  Jobs table uses wildcard (*) - should be specific account ID')
    }

    // Check for required tables
    const requiredTables = [
      'audio-conversion-jobs',
      'audio-conversion-progress', 
      'audio-conversion-uploads'
    ]

    requiredTables.forEach(table => {
      const hasTable = resources.some((r: string) => r.includes(table))
      if (hasTable) {
        successes.push(`✅ DynamoDB table ${table}: Included`)
      } else {
        issues.push(`❌ DynamoDB table ${table}: Missing`)
      }
    })
  }

  /**
   * Check for missing permissions needed for Smart Temporary Files
   */
  private checkMissingPermissions(issues: string[], warnings: string[]): void {
    console.log('\n🔍 Checking Smart Temporary Files Requirements...')

    // Check if all required DynamoDB tables are covered
    const allStatements = JSON.stringify(this.policy.Statement)
    
    if (!allStatements.includes('audio-conversion-progress')) {
      issues.push('❌ Missing audio-conversion-progress table permissions')
    }

    // Check for S3 multipart upload support
    if (!allStatements.includes('CreateMultipartUpload')) {
      warnings.push('⚠️  Missing S3 multipart upload permissions (needed for 105MB files)')
    }

    // Check for unnecessary permissions
    if (allStatements.includes('elasticache')) {
      warnings.push('⚠️  ElastiCache permissions not needed for current implementation')
    }
  }

  /**
   * Print validation results
   */
  private printResults(issues: string[], warnings: string[], successes: string[]): void {
    console.log('\n' + '='.repeat(60))
    console.log('📊 VALIDATION RESULTS')
    console.log('='.repeat(60))

    // Print successes
    if (successes.length > 0) {
      console.log('\n✅ WORKING PERMISSIONS:')
      successes.forEach(success => console.log(`   ${success}`))
    }

    // Print warnings
    if (warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:')
      warnings.forEach(warning => console.log(`   ${warning}`))
    }

    // Print issues
    if (issues.length > 0) {
      console.log('\n❌ CRITICAL ISSUES:')
      issues.forEach(issue => console.log(`   ${issue}`))
    }

    // Overall verdict
    console.log('\n' + '='.repeat(60))
    if (issues.length === 0) {
      if (warnings.length === 0) {
        console.log('🎉 VERDICT: POLICY WILL WORK PERFECTLY!')
      } else {
        console.log('✅ VERDICT: POLICY WILL WORK (with minor optimizations possible)')
      }
      console.log('✅ Smart Temporary Files + 105MB Limit will function correctly')
    } else {
      console.log('❌ VERDICT: POLICY HAS CRITICAL ISSUES')
      console.log('🔧 Fix the critical issues before deploying')
    }

    // Recommendations
    this.printRecommendations(issues, warnings)
  }

  /**
   * Print recommendations
   */
  private printRecommendations(issues: string[], warnings: string[]): void {
    console.log('\n💡 RECOMMENDATIONS:')
    
    if (issues.length > 0) {
      console.log('\n🚨 CRITICAL FIXES NEEDED:')
      if (issues.some(i => i.includes('audio-conversion-progress'))) {
        console.log('   • Add permissions for audio-conversion-progress table')
      }
      if (issues.some(i => i.includes('multipart'))) {
        console.log('   • Add S3 multipart upload permissions for large files')
      }
    }

    if (warnings.length > 0) {
      console.log('\n⚡ OPTIMIZATIONS:')
      if (warnings.some(w => w.includes('wildcard'))) {
        console.log('   • Replace wildcards (*) with specific account ID: 910883278292')
      }
      if (warnings.some(w => w.includes('multipart'))) {
        console.log('   • Add S3 multipart permissions for better large file support')
      }
      if (warnings.some(w => w.includes('elasticache'))) {
        console.log('   • Remove ElastiCache permissions (not needed)')
      }
    }

    console.log('\n🎯 FOR SMART TEMPORARY FILES + 105MB LIMIT:')
    console.log('   • Ensure all 3 DynamoDB tables have full permissions')
    console.log('   • Include S3 multipart upload actions')
    console.log('   • Use specific account IDs instead of wildcards')
  }
}

// Test with the provided policy
const providedPolicy = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::audio-conversion-app-bucket",
        "arn:aws:s3:::audio-conversion-app-bucket/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:*:table/audio-conversion-jobs"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:DescribeTable"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:910883278292:table/audio-conversion-uploads"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "elasticache:*"
      ],
      "Resource": "*"
    }
  ]
}`

if (require.main === module) {
  const validator = new IAMPolicyValidator(providedPolicy)
  validator.validatePolicy()
}

export { IAMPolicyValidator }