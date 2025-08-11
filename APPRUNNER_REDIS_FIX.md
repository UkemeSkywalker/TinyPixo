# App Runner Redis Connection Fix

## Problem
Your App Runner service cannot connect to ElastiCache Redis because App Runner runs in AWS's managed VPC and cannot access your private ElastiCache cluster without proper VPC connectivity.

## Error Symptoms
```
Redis client error: Error: Connection timeout
```

## Root Cause
- App Runner is not connected to your VPC (`vpc-0cb8cd9caa773138d`)
- ElastiCache Redis is in a private subnet and requires VPC access
- No VPC Connector configured for App Runner

## Solutions

### Option 1: Quick Fix (Immediate) ⚡
**Disable Redis temporarily and use DynamoDB fallback**

1. Go to AWS Console > App Runner > Your Service
2. Configuration > Environment variables
3. **Remove** these environment variables:
   - `REDIS_ENDPOINT`
   - `REDIS_PORT`
   - `REDIS_TLS`
4. Deploy the service
5. Test audio conversion (will work with DynamoDB progress tracking)

**Pros:** Immediate fix, audio conversion works
**Cons:** Slower progress updates (DynamoDB instead of Redis)

### Option 2: Proper Fix (Recommended) 🔧
**Set up VPC Connector for App Runner**

#### Step 1: Create VPC Connector
```bash
npm run setup:apprunner-vpc
```

#### Step 2: Configure App Runner Service
1. Go to AWS Console > App Runner > Your Service
2. Configuration > Networking
3. Click "Edit"
4. Add VPC Connector:
   - Select the created VPC Connector: `audio-conversion-vpc-connector`
5. Save configuration

#### Step 3: Wait and Deploy
1. Wait 5-10 minutes for VPC Connector to become ACTIVE
2. Deploy your App Runner service
3. Test audio conversion

## Verification

### Test Redis Connection
```bash
npm run test:redis-connection
```

### Check VPC Connector Status
```bash
aws apprunner list-vpc-connectors --region us-east-1
```

### Monitor App Runner Logs
Look for:
- ✅ `Redis client initialized successfully`
- ❌ `Redis client error: Error: Connection timeout`

## Network Details (From Your Setup)
- **VPC ID:** `vpc-0cb8cd9caa773138d`
- **Redis Endpoint:** `master.audio-conversion-redis.u6km1j.use1.cache.amazonaws.com`
- **Redis Port:** `6379`
- **TLS Required:** `true`
- **Security Group:** `audio-conversion-redis-SG`

## Troubleshooting

### If VPC Connector Setup Fails
1. Check AWS permissions:
   - `apprunner:CreateVpcConnector`
   - `ec2:CreateSecurityGroup`
   - `ec2:AuthorizeSecurityGroupIngress`

### If Redis Still Times Out After VPC Connector
1. Check ElastiCache security group allows port 6379
2. Verify VPC Connector is ACTIVE
3. Ensure App Runner service is using the VPC Connector

### Emergency Fallback
If nothing works, use Option 1 (disable Redis) to get audio conversion working immediately while you troubleshoot the VPC connectivity.

## Commands Summary
```bash
# Quick diagnosis
npm run check:redis-network

# Set up VPC access (proper fix)
npm run setup:apprunner-vpc

# Test Redis connection
npm run test:redis-connection

# Verify App Runner config
npm run verify:apprunner
```