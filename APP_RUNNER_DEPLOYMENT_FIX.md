# App Runner Deployment Fix

## Issue
The app was failing in App Runner due to Redis connection timeouts. The health check was trying to connect to Redis which wasn't configured.

## Solution
Made Redis optional for App Runner deployments. The app now works without Redis by:

1. **Health Check Fix**: Skip Redis health check when `REDIS_ENDPOINT` is not configured
2. **Progress Service**: Falls back to DynamoDB when Redis is unavailable
3. **AWS Services**: Returns null for Redis client when not configured

## Deployment Steps

### 1. Environment Variables
Set these environment variables in your App Runner service:

```bash
FORCE_AWS_ENVIRONMENT=true
S3_BUCKET_NAME=tinypixo-media-bucket
AWS_REGION=us-east-1
# Do NOT set REDIS_ENDPOINT to disable Redis
```

### 2. IAM Role
Ensure your App Runner service has an IAM role with these permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:CreateBucket",
                "s3:HeadBucket"
            ],
            "Resource": [
                "arn:aws:s3:::tinypixo-media-bucket",
                "arn:aws:s3:::tinypixo-media-bucket/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "dynamodb:GetItem",
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem",
                "dynamodb:CreateTable",
                "dynamodb:DescribeTable",
                "dynamodb:UpdateTimeToLive"
            ],
            "Resource": "arn:aws:dynamodb:*:*:table/audio-conversion-jobs"
        }
    ]
}
```

### 3. Build and Deploy

```bash
# Build for App Runner (x86_64)
docker build --platform linux/amd64 -t tinypixo .

# Push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
docker tag tinypixo:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/tinypixo:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/tinypixo:latest
```

### 4. App Runner Configuration
- **CPU/Memory**: 2 vCPU / 4 GB RAM (recommended for media processing)
- **Port**: 3000
- **Health Check**: `/api/health`

## What Works Without Redis

✅ **Image optimization** - Works normally
✅ **Audio conversion** - Uses in-memory progress tracking
✅ **Video conversion** - Uses in-memory progress tracking  
✅ **Batch processing** - Works normally
✅ **Health checks** - Skip Redis, check S3/DynamoDB only

## What's Different Without Redis

- **Progress tracking**: Falls back to DynamoDB (slightly slower updates)
- **Real-time updates**: Less frequent progress updates during conversion
- **Memory usage**: Progress data stored in memory instead of Redis

## Optional: Add Redis Later

If you want real-time progress tracking, create an ElastiCache Redis cluster and set:

```bash
REDIS_ENDPOINT=your-cluster.cache.amazonaws.com
REDIS_PORT=6379
REDIS_TLS=true
```

The app will automatically use Redis when available.