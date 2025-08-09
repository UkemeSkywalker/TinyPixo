# Production Deployment Guide - App Runner with Docker

This guide covers deploying the audio conversion application to AWS App Runner using Docker runtime with production validation.

## Overview

The deployment uses:
- **Dockerfile.dev**: Optimized Docker image with audio conversion capabilities
- **App Runner**: Docker runtime with auto-scaling and container management
- **AWS Services**: S3, DynamoDB, ElastiCache Redis for stateless architecture
- **Health Monitoring**: Comprehensive health checks and restart resilience

## Prerequisites

1. **AWS CLI configured** with appropriate permissions
2. **Node.js and npm** installed locally
3. **Docker** installed (for local testing)
4. **AWS Account** with permissions for:
   - App Runner
   - S3
   - DynamoDB
   - ElastiCache
   - CloudWatch
   - Parameter Store

## Step 1: Set Up AWS Resources

Run the deployment script to create all required AWS resources:

```bash
# Install dependencies
npm install

# Set up AWS resources (S3, DynamoDB, Redis)
tsx scripts/deploy-app-runner-production.ts
```

This script will:
- ✅ Create S3 bucket with CORS policies
- ✅ Create DynamoDB table with TTL
- ✅ Create ElastiCache Redis cluster
- ✅ Store configuration in Parameter Store
- ⚠️ Attempt to create App Runner service (may require manual setup)

## Step 2: Manual App Runner Configuration

If the automatic deployment fails, configure App Runner manually:

### 2.1 Create App Runner Service

1. Go to **AWS App Runner Console**
2. Click **Create service**
3. Choose **Source code repository**
4. Connect to your **GitHub repository**
5. Configure build settings:
   - **Runtime**: Docker
   - **Build command**: `docker build --platform linux/amd64 -f Dockerfile.dev -t tinypixo-audio:v2.0.0 .`
   - **Start command**: `docker run -p 3000:3000 tinypixo-audio:v2.0.0`

### 2.2 Environment Variables

Configure these environment variables in App Runner:

```bash
# Core application
NODE_ENV=production
BODY_SIZE_LIMIT=500mb
NEXT_SHARP_PATH=/app/node_modules/sharp

# AWS configuration
AWS_REGION=us-east-1
FORCE_AWS_ENVIRONMENT=true

# Audio conversion
FFMPEG_PATH=/usr/local/bin/ffmpeg
FFMPEG_THREADS=auto
FFMPEG_BUFFER_SIZE=64k
AUDIO_CONVERSION_TIMEOUT=300

# Memory optimization
NODE_OPTIONS=--max-http-header-size=16384 --max-old-space-size=2048
```

### 2.3 Parameter Store Secrets

Configure these secrets from Parameter Store:

```bash
S3_BUCKET_NAME=/audio-converter/s3-bucket-name
REDIS_ENDPOINT=/audio-converter/redis-endpoint
REDIS_PORT=/audio-converter/redis-port
REDIS_TLS=/audio-converter/redis-tls
```

### 2.4 Service Configuration

- **CPU**: 1 vCPU
- **Memory**: 2 GB
- **Port**: 3000
- **Health check**: `/api/health`
- **Auto-scaling**: Min 1, Max 10 instances

## Step 3: Configure Security Groups

The Redis cluster needs security group configuration:

1. Go to **ElastiCache Console**
2. Find your Redis cluster
3. Edit **Security Groups**
4. Add inbound rule:
   - **Type**: Custom TCP
   - **Port**: 6379
   - **Source**: App Runner service security group

## Step 4: Validate Deployment

### 4.1 Basic Health Check

```bash
# Check if service is running
curl https://tinypixo-audio.us-east-1.awsapprunner.com/api/health

# Expected response:
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

### 4.2 Comprehensive Validation

Run the full validation suite:

```bash
tsx scripts/validate-production-deployment.ts https://tinypixo-audio.us-east-1.awsapprunner.com
```

This validates:
- ✅ Health endpoint with all AWS services
- ✅ Audio converter UI accessibility
- ✅ Image optimization (v1 features)
- ✅ Complete audio workflow (upload → convert → download)
- ✅ Container restart resilience
- ✅ Concurrent user support
- ✅ Error handling

### 4.3 Load Testing

Test with concurrent users:

```bash
tsx scripts/load-test-production.ts https://tinypixo-audio.us-east-1.awsapprunner.com
```

This tests:
- 10 concurrent users
- Various file sizes (small, medium, large)
- 5-minute duration
- Progress tracking accuracy
- Download reliability

## Step 5: Monitor Container Restarts

### 5.1 Check for Recent Restarts

```bash
tsx scripts/monitor-container-restarts.ts check https://tinypixo-audio.us-east-1.awsapprunner.com
```

### 5.2 Monitor Job Recovery

```bash
tsx scripts/monitor-container-restarts.ts monitor https://tinypixo-audio.us-east-1.awsapprunner.com
```

### 5.3 Simulate Restart Scenario

```bash
tsx scripts/monitor-container-restarts.ts simulate https://tinypixo-audio.us-east-1.awsapprunner.com
```

This will:
1. Start a conversion job
2. Ask you to manually restart the service
3. Monitor job recovery after restart

## Step 6: Verify Issue Resolution

### 6.1 Progress Loop Fix (95% → 0%)

The main issue being fixed is the progress reset loop:

1. Upload a test file
2. Start conversion
3. Monitor progress continuously
4. Verify progress goes from 0% → 100% without resetting
5. Force a container restart during conversion
6. Verify progress continues from where it left off (or restarts cleanly)

### 6.2 Download Errors Fix

Test download reliability:

1. Convert multiple files of different sizes
2. Download each file completely
3. Verify no `ERR_CONTENT_LENGTH_MISMATCH` errors
4. Test downloads after container restarts

### 6.3 Memory Pressure Fix

Test large file handling:

1. Upload files up to 200MB
2. Convert multiple files simultaneously
3. Monitor memory usage in CloudWatch
4. Verify no container restarts due to memory pressure

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Check security groups allow port 6379
   - Verify Redis endpoint in Parameter Store
   - Check TLS configuration

2. **S3 Access Denied**
   - Verify IAM role has S3 permissions
   - Check bucket CORS policy
   - Verify bucket name in Parameter Store

3. **DynamoDB Throttling**
   - Check table capacity settings
   - Monitor CloudWatch metrics
   - Consider increasing capacity

4. **FFmpeg Not Found**
   - Verify Dockerfile.dev builds correctly
   - Check FFMPEG_PATH environment variable
   - Test locally with Docker

### Monitoring

1. **CloudWatch Logs**
   - App Runner application logs
   - Error patterns and frequencies
   - Performance metrics

2. **CloudWatch Metrics**
   - App Runner CPU/Memory usage
   - Request count and latency
   - Error rates

3. **AWS X-Ray** (optional)
   - Request tracing
   - Service dependencies
   - Performance bottlenecks

## Validation Criteria Checklist

After deployment, verify these criteria are met:

- [ ] **Service Accessibility**: App Runner service URL is accessible
- [ ] **Dual Functionality**: Both v1 (image optimization) and v2 (audio conversion) work
- [ ] **Progress Tracking**: Progress goes 0% → 100% without resetting to 0%
- [ ] **Container Resilience**: Jobs complete successfully after forced restarts
- [ ] **Load Handling**: System handles 10+ concurrent users
- [ ] **Error-Free Downloads**: No ERR_CONTENT_LENGTH_MISMATCH errors
- [ ] **Download Reliability**: All converted files download successfully
- [ ] **Issue Resolution**: Original 95% → 0% progress loop is eliminated

## Performance Expectations

### Response Times
- **Upload**: < 5 seconds for 50MB files
- **Conversion**: 1-3x real-time (3-minute audio = 3-9 minutes conversion)
- **Download**: < 10 seconds for 200MB files
- **Progress Updates**: < 500ms response time

### Throughput
- **Concurrent Jobs**: 5-10 simultaneous conversions
- **File Size Limit**: 200MB per file
- **Daily Volume**: 1000+ conversions per day

### Reliability
- **Uptime**: 99.9% availability
- **Success Rate**: 99%+ conversion success
- **Recovery Time**: < 2 minutes after container restart

## Cost Optimization

1. **App Runner**: Pay-per-use pricing scales with traffic
2. **S3**: Use lifecycle policies to delete old files
3. **DynamoDB**: On-demand billing for variable workloads
4. **ElastiCache**: Use smallest instance that meets performance needs
5. **CloudWatch**: Set log retention periods to control costs

## Security Considerations

1. **IAM Roles**: Least privilege access for App Runner
2. **VPC**: Consider VPC deployment for enhanced security
3. **Encryption**: Enable encryption at rest for S3 and DynamoDB
4. **HTTPS**: App Runner provides HTTPS by default
5. **Secrets**: Use Parameter Store for sensitive configuration

## Next Steps

After successful deployment:

1. **Set up monitoring alerts** for service health
2. **Configure backup strategies** for critical data
3. **Implement CI/CD pipeline** for automated deployments
4. **Plan capacity scaling** based on usage patterns
5. **Regular security reviews** and updates

## Support

For issues or questions:

1. Check CloudWatch logs for error details
2. Run validation scripts to identify specific problems
3. Review AWS service health dashboards
4. Test with smaller files to isolate issues
5. Monitor resource usage patterns

---

**Deployment Status**: ✅ Ready for production use
**Last Updated**: 2025-01-08
**Version**: 2.0 (Docker + Stateless Architecture)