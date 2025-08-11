# Redis Failover Fix for App Runner Production

## Problem Summary

The Redis → DynamoDB failover mechanism was **correctly implemented** but **not working in production** due to configuration and timeout issues:

1. **Redis environment variables commented out** in `apprunner.yaml`
2. **App Runner defaulting to `localhost:6379`** when `REDIS_ENDPOINT` not set
3. **30-second connection timeout** blocking requests instead of failing fast
4. **Requests hanging** instead of gracefully falling back to DynamoDB

## Root Cause Analysis

### Configuration Issue
```yaml
# In apprunner.yaml - Redis was disabled
# - name: REDIS_ENDPOINT
#   value: master.audio-conversion-redis.u6km1j.use1.cache.amazonaws.com
```

### Timeout Issue
```typescript
// Old code - 30 second timeout in production
connectTimeout: 30000, // Too long for production failover
```

### Environment Detection Issue
```typescript
// App Runner environment falls back to localhost when REDIS_ENDPOINT not set
redis: {
  host: process.env.REDIS_ENDPOINT || 'localhost', // ← Problem here
  port: parseInt(process.env.REDIS_PORT || '6379'),
  tls: process.env.REDIS_TLS !== 'false'
}
```

## Solution Implemented

### 1. Fast Failover Configuration
```typescript
// lib/aws-services.ts - Updated getRedisClient()
export async function getRedisClient(): Promise<RedisClientType | null> {
  // Check if Redis is properly configured for App Runner
  if (!process.env.REDIS_ENDPOINT && config.environment === Environment.APP_RUNNER) {
    console.log('[Redis] No REDIS_ENDPOINT configured for App Runner, skipping Redis initialization')
    return null // ← Fast fail instead of trying localhost
  }

  // Reduced timeout for production
  connectTimeout: config.environment === Environment.APP_RUNNER ? 5000 : 30000, // ← 5s vs 30s

  // Timeout wrapper for connection
  const connectionPromise = redisClient.connect()
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Redis connection timeout')), 
      config.environment === Environment.APP_RUNNER ? 5000 : 30000)
  })

  await Promise.race([connectionPromise, timeoutPromise]) // ← Race condition for fast fail
}
```

### 2. Graceful Service Initialization
```typescript
// lib/aws-services.ts - Updated initializeRedis()
export async function initializeRedis(): Promise<void> {
  try {
    const redis = await getRedisClient()
    
    if (!redis) {
      console.log('Redis not available, will use DynamoDB fallback for progress tracking')
      return // ← Don't throw error, allow DynamoDB fallback
    }
    
    // Test connection if Redis is available
    // ... connection test code
  } catch (error) {
    console.error('Redis initialization error, will use DynamoDB fallback:', error)
    // Don't throw error - allow app to start with DynamoDB fallback
  }
}
```

### 3. Enhanced Progress Service Logging
```typescript
// lib/progress-service.ts - Better fallback detection
private async getRedis(): Promise<RedisClientType | null> {
  try {
    if (!this.redisClient) {
      this.redisClient = await getRedisClient()
      if (this.redisClient) {
        console.log('[ProgressService] Redis client initialized successfully')
      } else {
        console.log('[ProgressService] Redis not available, will use DynamoDB fallback')
      }
    }
    return this.redisClient
  } catch (error) {
    console.error('[ProgressService] Failed to get Redis client:', error)
    return null
  }
}
```

## Deployment Instructions

### Option 1: Deploy with Redis Disabled (Recommended for immediate fix)

1. **Keep Redis environment variables commented out** in `apprunner.yaml`:
   ```yaml
   # Redis disabled for App Runner due to VPC connectivity issues
   # - name: REDIS_ENDPOINT
   #   value: master.audio-conversion-redis.u6km1j.use1.cache.amazonaws.com
   # - name: REDIS_PORT
   #   value: 6379
   # - name: REDIS_TLS
   #   value: true
   ```

2. **Deploy the updated code** to App Runner

3. **Verify the fix** works:
   ```bash
   npm run validate:redis-fix https://your-app.us-east-1.awsapprunner.com
   ```

### Option 2: Deploy with Redis Enabled (After VPC Connector setup)

1. **Set up VPC Connector** first:
   ```bash
   npm run setup:apprunner-vpc
   ```

2. **Uncomment Redis environment variables** in `apprunner.yaml`:
   ```yaml
   - name: REDIS_ENDPOINT
     value: master.audio-conversion-redis.u6km1j.use1.cache.amazonaws.com
   - name: REDIS_PORT
     value: 6379
   - name: REDIS_TLS
     value: true
   ```

3. **Deploy to App Runner**

4. **Verify Redis connection** works:
   ```bash
   npm run test:redis-connection
   ```

## Testing the Fix

### Local Testing
```bash
# Test Redis failover behavior locally
npm run test:redis-failover
```

### Production Validation
```bash
# Validate the fix in production
npm run validate:redis-fix https://your-app.us-east-1.awsapprunner.com
```

## Expected Performance Improvements

### Before Fix
- **Health check**: 30+ seconds (Redis timeout)
- **Upload requests**: 30+ seconds (Redis timeout)
- **Progress tracking**: 30+ seconds (Redis timeout)
- **User experience**: Terrible (requests hanging)

### After Fix
- **Health check**: < 2 seconds (fast failover)
- **Upload requests**: < 5 seconds (fast failover)
- **Progress tracking**: < 1 second (DynamoDB fallback)
- **User experience**: Good (responsive app)

## Monitoring and Validation

### Key Metrics to Monitor
1. **Response times** should be < 5 seconds for all endpoints
2. **Health check** should complete in < 2 seconds
3. **Progress tracking** should work without Redis
4. **No hanging requests** due to Redis timeouts

### Log Messages to Look For

#### Success (Redis Disabled)
```
[Redis] No REDIS_ENDPOINT configured for App Runner, skipping Redis initialization
[ProgressService] Redis not available, will use DynamoDB fallback
Redis not available, will use DynamoDB fallback for progress tracking
```

#### Success (Redis Enabled)
```
[Redis] Connected successfully
[Redis] Client ready
Redis connection test successful
```

#### Failure (Old Behavior)
```
Redis client error: Error: Connection timeout
Redis initialization error: Error: Connection timeout
```

## Rollback Plan

If the fix causes issues:

1. **Revert the changes** to `lib/aws-services.ts`
2. **Redeploy** the previous version
3. **Temporarily disable Redis** by commenting out environment variables
4. **Investigate** the specific issue

## Future Improvements

1. **Set up VPC Connector** for proper Redis connectivity
2. **Implement Redis health checks** in the health endpoint
3. **Add Redis connection metrics** to CloudWatch
4. **Consider Redis Cluster** for high availability
5. **Implement circuit breaker pattern** for Redis connections

## Validation Checklist

After deployment, verify:

- [ ] **Health endpoint responds** in < 2 seconds
- [ ] **Audio upload works** without hanging
- [ ] **Progress tracking functional** (shows 0% → 50% → 100%)
- [ ] **No Redis timeout errors** in logs
- [ ] **DynamoDB fallback messages** appear in logs
- [ ] **Concurrent requests** handled properly
- [ ] **Container restarts** don't break functionality

---

**Status**: ✅ Ready for deployment  
**Impact**: High - Fixes production hanging requests  
**Risk**: Low - Graceful fallback, no breaking changes  
**Rollback**: Easy - Revert code changes