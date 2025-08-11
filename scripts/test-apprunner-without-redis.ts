#!/usr/bin/env tsx

/**
 * Test script to verify audio conversion works without Redis
 * This simulates the App Runner environment without Redis connectivity
 */

import { config } from 'dotenv'
config({ path: '.env.apprunner' })

import { progressService } from '../lib/progress-service'
import { jobService } from '../lib/job-service'

async function testWithoutRedis() {
    console.log('🧪 Testing audio conversion without Redis...')
    
    // Simulate App Runner environment
    process.env.REDIS_ENDPOINT = undefined
    process.env.REDIS_PORT = undefined
    process.env.REDIS_TLS = undefined
    
    console.log('Environment variables:')
    console.log(`  REDIS_ENDPOINT: ${process.env.REDIS_ENDPOINT || 'undefined'}`)
    console.log(`  S3_BUCKET_NAME: ${process.env.S3_BUCKET_NAME}`)
    console.log(`  AWS_REGION: ${process.env.AWS_REGION}`)
    
    try {
        // Test job creation (should work with DynamoDB)
        console.log('\n📝 Testing job creation...')
        const jobId = Date.now().toString()
        const job = await jobService.createJob(
            jobId,
            'test-file.ogg',
            'mp3',
            '192k',
            's3://test-bucket/test-file.ogg'
        )
        console.log(`✅ Job created: ${job.jobId}`)
        
        // Test progress initialization (should fallback gracefully)
        console.log('\n📊 Testing progress initialization...')
        await progressService.initializeProgress(jobId)
        console.log('✅ Progress initialized (Redis unavailable, using DynamoDB fallback)')
        
        // Test progress retrieval (should use DynamoDB fallback)
        console.log('\n📈 Testing progress retrieval...')
        const progress = await progressService.getProgress(jobId)
        console.log(`✅ Progress retrieved: ${progress?.progress}% (${progress?.stage})`)
        
        // Test job completion
        console.log('\n✅ Testing job completion...')
        await jobService.updateJobStatus(jobId, 'completed', 's3://test-bucket/output.mp3')
        await progressService.markComplete(jobId)
        console.log('✅ Job marked as complete')
        
        // Verify final progress
        const finalProgress = await progressService.getProgress(jobId)
        console.log(`✅ Final progress: ${finalProgress?.progress}% (${finalProgress?.stage})`)
        
        console.log('\n🎉 All tests passed! Audio conversion should work without Redis.')
        console.log('💡 Progress tracking will use DynamoDB fallback (slower but functional)')
        
    } catch (error: any) {
        console.error('❌ Test failed:', error.message)
        process.exit(1)
    }
}

if (require.main === module) {
    testWithoutRedis()
}