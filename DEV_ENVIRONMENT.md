# Development Environment Setup

This document describes how to set up and use the local development environment with LocalStack, DynamoDB Local, and Redis.

## Prerequisites

- Docker and Docker Compose
- Node.js 18+
- npm

## Quick Start

1. **Start all services:**
   ```bash
   npm run dev:services
   ```

2. **Test connectivity:**
   ```bash
   npm run test:connectivity
   ```

3. **Start the Next.js development server:**
   ```bash
   npm run dev
   ```

4. **Stop all services:**
   ```bash
   npm run dev:services:stop
   ```

## Services

### LocalStack (S3)
- **URL:** http://localhost:4566
- **Bucket:** `audio-conversion-bucket`
- **Folders:** `uploads/`, `conversions/`

### DynamoDB Local
- **URL:** http://localhost:8000
- **Table:** `audio-conversion-jobs`
- **TTL:** Configured on `ttl` attribute

### Redis
- **Host:** localhost
- **Port:** 6379
- **Persistence:** Enabled with AOF

## Environment Detection

The application automatically detects the environment:

- **Local:** Uses localhost endpoints for all services
- **Docker:** Uses container hostnames
- **App Runner:** Uses AWS managed services

## Troubleshooting

### Services won't start
```bash
# Check if ports are in use
lsof -i :4566 -i :8000 -i :6379

# Stop any conflicting services
npm run dev:services:stop
docker system prune -f
```

### Connectivity tests fail
```bash
# Check service logs
npm run dev:services:logs

# Restart services
npm run dev:services:stop
npm run dev:services
```

### Reset environment
```bash
# Stop services and remove volumes
npm run dev:services:stop
docker-compose -f docker-compose.dev.yml down -v
docker system prune -f

# Start fresh
npm run dev:services
```

## Manual Testing

### S3 (LocalStack)
```bash
# List buckets
aws --endpoint-url=http://localhost:4566 s3 ls

# List objects
aws --endpoint-url=http://localhost:4566 s3 ls s3://audio-conversion-bucket/
```

### DynamoDB Local
```bash
# List tables
aws --endpoint-url=http://localhost:8000 dynamodb list-tables

# Scan table
aws --endpoint-url=http://localhost:8000 dynamodb scan --table-name audio-conversion-jobs
```

### Redis
```bash
# Connect to Redis
redis-cli -h localhost -p 6379

# Test commands
SET test-key "test-value"
GET test-key
```