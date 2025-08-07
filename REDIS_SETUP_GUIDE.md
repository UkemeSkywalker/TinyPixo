# Redis ElastiCache Setup Guide

## Why Automated Creation May Fail

ElastiCache Redis clusters require specific VPC configuration:
- **Subnet Groups**: Define which subnets the cluster can use
- **Security Groups**: Control network access to the cluster
- **VPC Settings**: Must be compatible with your existing infrastructure

These settings vary by AWS account and region, making automated creation challenging.

## Manual Creation Steps

### 1. Go to AWS ElastiCache Console
- Navigate to: https://console.aws.amazon.com/elasticache/
- Select your region (e.g., us-east-1)

### 2. Create Redis Cluster
1. Click **"Create cache"**
2. Choose **"Redis OSS"**
3. Set **Cluster name**: `audio-conversion-redis`
4. Set **Node type**: `cache.t3.small` (or larger for production)
5. Set **Engine version**: `7.0`
6. Set **Port**: `6379`

### 3. Configure Network Settings
1. **VPC**: Choose your default VPC or existing VPC
2. **Subnet group**: 
   - Use existing subnet group, or
   - Create new subnet group with subnets from multiple AZs
3. **Security groups**:
   - Create or select security group that allows:
   - **Inbound**: Port 6379 from your application (App Runner, EC2, etc.)
   - **Outbound**: All traffic

### 4. Configure Security
1. **Encryption in transit**: ✅ Enable
2. **Encryption at rest**: ✅ Enable
3. **Auth token**: Leave empty for now (optional)

### 5. Create and Wait
1. Click **"Create cache"**
2. Wait 10-15 minutes for cluster to become **Available**

### 6. Get Connection Details
Once available:
1. Click on your cluster name
2. Copy the **Primary endpoint** or **Configuration endpoint**
3. Set environment variable: `REDIS_ENDPOINT=your-cluster-endpoint.cache.amazonaws.com`

## Testing Connection

After setup, test with:
```bash
# Set the endpoint
export REDIS_ENDPOINT=your-cluster-endpoint.cache.amazonaws.com
export AWS_REGION=us-east-1

# Test connectivity
npm run test:aws-connectivity
```

## Alternative: Use Redis Locally

For development, you can skip ElastiCache and use local Redis:
```bash
# Switch to local environment
npm run switch:env local

# Start local services
npm run dev:services

# Test local connectivity
npm run test:connectivity
```

## Troubleshooting

### Connection Timeouts
- Check security groups allow port 6379
- Ensure your application and Redis are in same VPC
- Verify subnet group spans multiple AZs

### Access Denied
- Check IAM permissions for ElastiCache
- Verify security group rules
- Ensure encryption settings match client configuration

### DNS Resolution
- Use the full endpoint address
- Don't include `redis://` or `rediss://` prefix in REDIS_ENDPOINT
- The application will add the appropriate protocol prefix