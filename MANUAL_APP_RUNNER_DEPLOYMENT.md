# Manual App Runner Deployment Guide

## Step 1: Build and Push Docker Image

### 1.1 Build the Docker Image
```bash
# Build using the existing Dockerfile (already optimized)
docker build -t audio-converter-app .

# Tag for ECR (replace with your account ID and region)
docker tag audio-converter-app:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/audio-converter-app:latest
```

### 1.2 Push to ECR
```bash
# Create ECR repository (if not exists)
aws ecr create-repository --repository-name audio-converter-app --region us-east-1

# Get login token
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

# Push image
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/audio-converter-app:latest
```

## Step 2: Create App Runner Service in Console

### 2.1 Basic Configuration
- **Service name**: `audio-converter-app`
- **Source**: Container image
- **Container image URI**: `123456789012.dkr.ecr.us-east-1.amazonaws.com/audio-converter-app:latest`
- **Deployment trigger**: Manual

### 2.2 Service Settings
- **Port**: `3000`
- **CPU**: `1 vCPU`
- **Memory**: `2 GB`
- **Environment variables**: See section below

### 2.3 Auto Scaling
- **Min size**: `1`
- **Max size**: `10`
- **Max concurrency**: `100`

### 2.4 Health Check
- **Protocol**: `HTTP`
- **Path**: `/api/health`
- **Interval**: `30` seconds
- **Timeout**: `10` seconds
- **Healthy threshold**: `2`
- **Unhealthy threshold**: `3`

## Step 3: Environment Variables

### Core Application Settings
```
NODE_ENV=production
HOSTNAME=0.0.0.0
PORT=3000
BODY_SIZE_LIMIT=500mb
```

### Next.js Configuration
```
NEXT_SHARP_PATH=/app/node_modules/sharp
NODE_OPTIONS=--max-http-header-size=16384 --max-old-space-size=2048
```

### AWS Environment Detection
```
FORCE_AWS_ENVIRONMENT=true
AWS_REGION=us-east-1
```

### Audio Conversion Settings
```
FFMPEG_PATH=/usr/local/bin/ffmpeg
FFMPEG_THREADS=auto
FFMPEG_BUFFER_SIZE=64k
AUDIO_CONVERSION_TIMEOUT=300
```

### AWS Service Configuration
```
S3_BUCKET_NAME=your-audio-conversion-bucket
REDIS_ENDPOINT=your-redis-cluster.cache.amazonaws.com
REDIS_PORT=6379
REDIS_TLS=true
```

## Step 4: Required AWS Resources

### 4.1 S3 Bucket
Create an S3 bucket for file storage:
- **Bucket name**: `your-audio-conversion-bucket`
- **Region**: `us-east-1`
- **CORS policy**: Allow all origins for development

### 4.2 DynamoDB Table
Create a DynamoDB table for job tracking:
- **Table name**: `audio-conversion-jobs`
- **Partition key**: `jobId` (String)
- **Billing mode**: On-demand
- **TTL**: Enable on `ttl` attribute

### 4.3 ElastiCache Redis
Create a Redis cluster:
- **Cluster name**: `audio-converter-redis`
- **Node type**: `cache.t3.micro`
- **Number of nodes**: `1`
- **Port**: `6379`

## Step 5: IAM Permissions

The App Runner service needs an IAM role with these permissions:

### 5.1 S3 Permissions
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject"
            ],
            "Resource": "arn:aws:s3:::your-audio-conversion-bucket/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket"
            ],
            "Resource": "arn:aws:s3:::your-audio-conversion-bucket"
        }
    ]
}
```

### 5.2 DynamoDB Permissions
```json
{
    "Version": "2012-10-17",
    "Statement": [
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
        }
    ]
}
```

### 5.3 ElastiCache Permissions
No specific IAM permissions needed, but ensure security groups allow access.

## Step 6: Security Groups

### 6.1 Redis Security Group
Create or modify the Redis security group to allow inbound traffic:
- **Type**: Custom TCP
- **Port**: 6379
- **Source**: App Runner service (you'll get this after creating the service)

## Step 7: Validation

### 7.1 Test Health Endpoint
```bash
curl https://your-app-url.us-east-1.awsapprunner.com/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "environment": "app-runner",
  "services": {
    "s3": { "status": "healthy" },
    "dynamodb": { "status": "healthy" },
    "redis": { "status": "healthy" }
  },
  "ffmpegAvailable": true
}
```

### 7.2 Test Audio Conversion
1. Go to `https://your-app-url.us-east-1.awsapprunner.com/audio-converter`
2. Upload a test audio file
3. Start conversion
4. Monitor progress (should go 0% → 100% without resetting)
5. Download the converted file

## Step 8: Monitoring

### 8.1 CloudWatch Logs
App Runner automatically creates log groups:
- `/aws/apprunner/audio-converter-app/application`
- `/aws/apprunner/audio-converter-app/service`

### 8.2 CloudWatch Metrics
Monitor these key metrics:
- **RequestCount**: Number of requests
- **ResponseTime**: Average response time
- **4XXError**: Client errors
- **5XXError**: Server errors
- **CPUUtilization**: CPU usage
- **MemoryUtilization**: Memory usage

## Troubleshooting

### Common Issues

1. **Container fails to start**
   - Check CloudWatch logs for startup errors
   - Verify all environment variables are set
   - Ensure Docker image was built correctly

2. **Health check fails**
   - Verify `/api/health` endpoint is accessible
   - Check if all AWS services are configured correctly
   - Review security group settings

3. **Audio conversion fails**
   - Check if FFmpeg is available in the container
   - Verify S3 bucket permissions
   - Monitor memory usage during conversion

4. **Progress resets to 0%**
   - This is the main issue we're fixing
   - Check Redis connection for job state persistence
   - Monitor container restarts during conversion

### Performance Tuning

1. **Memory**: Increase to 4GB if handling large files
2. **CPU**: Increase to 2 vCPU for faster conversions
3. **Concurrency**: Adjust based on conversion load
4. **Auto-scaling**: Set appropriate min/max instances

## Expected Results

After successful deployment:
- ✅ Service accessible at App Runner URL
- ✅ Both image optimization (v1) and audio conversion (v2) work
- ✅ Progress tracking works without 95% → 0% reset issue
- ✅ Container restarts don't break ongoing conversions
- ✅ System handles multiple concurrent users
- ✅ No download errors or content length mismatches
- ✅ All validation criteria from Task 13 are met

## Cost Estimate

Approximate monthly costs for moderate usage:
- **App Runner**: $25-50 (1 vCPU, 2GB, ~100 hours/month)
- **S3**: $5-15 (storage + requests)
- **DynamoDB**: $2-5 (on-demand)
- **ElastiCache**: $15-25 (t3.micro)
- **Total**: ~$50-100/month

Scale costs based on actual usage patterns.