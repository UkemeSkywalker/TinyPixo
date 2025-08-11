#!/usr/bin/env tsx

/**
 * Setup S3 bucket in sa-east-1 region for audio conversion
 */

import { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand, CreateBucketConfiguration } from '@aws-sdk/client-s3'

const BUCKET_NAME = 'audio-conversion-bucket'
const REGION = 'sa-east-1'

async function setupS3Bucket() {
  console.log(`🪣 Setting up S3 bucket '${BUCKET_NAME}' in region ${REGION}...`)
  
  const s3Client = new S3Client({
    region: REGION
  })
  
  try {
    // Check if bucket exists
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }))
    console.log(`✅ S3 bucket '${BUCKET_NAME}' already exists in ${REGION}`)
  } catch (error: any) {
    if (error.name === 'NotFound' || error.name === 'NoSuchBucket') {
      console.log(`Creating S3 bucket '${BUCKET_NAME}' in ${REGION}...`)
      
      const createBucketParams: any = {
        Bucket: BUCKET_NAME
      }
      
      // Only add CreateBucketConfiguration for regions other than us-east-1
      if (REGION !== 'us-east-1') {
        createBucketParams.CreateBucketConfiguration = {
          LocationConstraint: REGION
        }
      }
      
      await s3Client.send(new CreateBucketCommand(createBucketParams))
      console.log(`✅ S3 bucket '${BUCKET_NAME}' created successfully`)
    } else {
      throw error
    }
  }
  
  // Set up CORS policy
  console.log('Setting up CORS policy...')
  await s3Client.send(new PutBucketCorsCommand({
    Bucket: BUCKET_NAME,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedHeaders: ['*'],
          AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
          AllowedOrigins: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3000
        }
      ]
    }
  }))
  
  console.log('✅ CORS policy configured')
  console.log(`🎉 S3 bucket setup completed for ${BUCKET_NAME} in ${REGION}`)
}

if (require.main === module) {
  setupS3Bucket()
    .then(() => {
      console.log('✅ Setup completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Setup failed:', error)
      process.exit(1)
    })
}

export { setupS3Bucket }