# Task 5 Validation Guide

This guide explains how to validate that Task 5 (Complete File Upload Service with S3 Multipart Upload) has been successfully implemented.

## Validation Criteria

Task 5 should meet these requirements:

✅ **Upload a 50MB audio file via POST `/api/upload-audio` and receive a unique fileId**
✅ **See the uploaded file appear in S3 bucket under uploads/{fileId}.mp3**
✅ **Upload files to both LocalStack S3 and real AWS S3 successfully**
✅ **Try uploading invalid formats (.txt, .exe) and see proper validation errors**
✅ **Upload large files and see multipart upload working with progress tracking**
✅ **Test upload from browser and see CORS policies allowing the request**
✅ **Simulate upload failures and see retry logic working with exponential backoff**

## Prerequisites

1. **Start Development Services**

   ```bash
   npm run dev:services
   ```

   This starts LocalStack S3, DynamoDB, and Redis.

2. **Start Next.js Development Server**
   ```bash
   npm run dev
   ```
   This starts the Next.js server on http://localhost:3000

## Validation Methods

### Method 1: Automated Validation Script

Run the comprehensive validation script:

```bash
npm run validate:task-5
```

This script will:

- Upload a 50MB audio file and verify it gets a unique fileId
- Check that the file appears in S3 under uploads/{fileId}.mp3
- Test invalid file format rejection (.txt, .exe files)
- Test large file multipart upload (25MB file)
- Test chunked upload workflow with progress tracking
- Test retry logic and error handling
- Test CORS-like browser requests

### Method 2: Browser Testing

1. Open http://localhost:3000/test-upload.html in your browser
2. Use the interactive test page to:
   - **Test 1: Form Upload** - Upload small audio files
   - **Test 2: Large File Upload** - Upload files >5MB to test multipart
   - **Test 3: Chunked Upload** - Test the chunked upload API
   - **Test 4: Invalid File Types** - Test validation with non-audio files
   - **Test 5: Generate Test Files** - Create test files of various sizes

### Method 3: Manual API Testing

#### Test 1: Upload 50MB File

```bash
# Create a 50MB test file
dd if=/dev/zero of=test-50mb.mp3 bs=1024 count=51200

# Upload via curl
curl -X POST http://localhost:3000/api/upload-audio \
  -F "file=@test-50mb.mp3" \
  -H "Content-Type: multipart/form-data"

# Clean up
rm test-50mb.mp3
```

#### Test 2: Test Invalid File Format

```bash
# Create a text file
echo "This is not an audio file" > test.txt

# Try to upload (should fail)
curl -X POST http://localhost:3000/api/upload-audio \
  -F "file=@test.txt" \
  -H "Content-Type: multipart/form-data"

# Clean up
rm test.txt
```

#### Test 3: Chunked Upload

```bash
# Initiate chunked upload
curl -X POST http://localhost:3000/api/upload-audio \
  -H "Content-Type: application/json" \
  -d '{
    "action": "initiate",
    "fileName": "chunked-test.mp3",
    "fileSize": 10485760
  }'

# Upload chunk (use fileId from previous response)
curl -X POST http://localhost:3000/api/upload-audio \
  -H "Content-Type: application/json" \
  -d '{
    "action": "upload",
    "fileId": "YOUR_FILE_ID",
    "chunkIndex": 0,
    "totalChunks": 1,
    "chunk": "BASE64_ENCODED_CHUNK_DATA"
  }'

# Complete upload
curl -X POST http://localhost:3000/api/upload-audio \
  -H "Content-Type: application/json" \
  -d '{
    "action": "complete",
    "fileId": "YOUR_FILE_ID"
  }'
```

### Method 4: Test with Real AWS S3

To test with real AWS S3 instead of LocalStack:

1. **Configure AWS Credentials**

   ```bash
   export AWS_ACCESS_KEY_ID=your_access_key
   export AWS_SECRET_ACCESS_KEY=your_secret_key
   export AWS_REGION=us-east-1
   export S3_BUCKET_NAME=your-bucket-name
   export FORCE_AWS_ENVIRONMENT=true
   ```

2. **Run AWS Test Script**
   ```bash
   npm run test:real-aws
   ```

This will test uploads to both LocalStack and real AWS S3.

## Verification Steps

### 1. Check S3 Bucket Contents

**For LocalStack:**

```bash
# List objects in LocalStack S3
aws --endpoint-url=http://localhost:4566 s3 ls s3://audio-conversion-bucket/uploads/
```

**For Real AWS:**

```bash
# List objects in real AWS S3
aws s3 ls s3://your-bucket-name/uploads/
```

### 2. Check Upload Progress in Redis

```bash
# Connect to Redis and check upload progress
redis-cli -h localhost -p 6379
> KEYS upload:*
> GET upload:YOUR_FILE_ID
```

### 3. Check Application Logs

Monitor the Next.js development server logs for:

- Upload progress messages
- Multipart upload initialization
- Chunk upload progress
- Error handling and retry attempts
- S3 operation confirmations

## Expected Results

### Successful 50MB Upload Response

```json
{
  "success": true,
  "fileId": "1640995200000-uuid-123",
  "fileName": "test-50mb.mp3",
  "size": 52428800,
  "s3Location": {
    "bucket": "audio-conversion-bucket",
    "key": "uploads/1640995200000-uuid-123.mp3",
    "size": 52428800
  }
}
```

### Invalid File Format Error

```json
{
  "error": "Unsupported file format: .txt. Supported formats: mp3, wav, aac, ogg, m4a, flac"
}
```

### Chunked Upload Progress

```json
{
  "success": true,
  "chunkIndex": 0,
  "progress": 25,
  "uploadedSize": 5242880,
  "totalSize": 20971520
}
```

## Troubleshooting

### Common Issues

1. **Server not running**

   - Make sure `npm run dev` is running
   - Check http://localhost:3000 is accessible

2. **Services not started**

   - Run `npm run dev:services` to start LocalStack, DynamoDB, and Redis
   - Check `docker ps` to see running containers

3. **S3 bucket not found**

   - The bucket is created automatically when services start
   - Check LocalStack logs: `npm run dev:services:logs`

4. **AWS credentials for real AWS testing**

   - Ensure AWS credentials are configured
   - Set `FORCE_AWS_ENVIRONMENT=true` to use real AWS
   - Verify S3 bucket exists and you have permissions

5. **Large file upload timeouts**
   - Large files may take time to upload
   - Check network connection
   - Monitor server logs for progress

### Debug Commands

```bash
# Check if services are running
docker ps

# Check LocalStack S3
aws --endpoint-url=http://localhost:4566 s3 ls

# Check Redis connection
redis-cli -h localhost -p 6379 ping

# Check DynamoDB
aws --endpoint-url=http://localhost:8000 dynamodb list-tables

# View service logs
npm run dev:services:logs
```

## Success Criteria

Task 5 is successfully implemented when:

1. ✅ 50MB audio files upload successfully and return unique fileIds
2. ✅ Files appear in S3 bucket under the correct path (uploads/{fileId}.ext)
3. ✅ Invalid file formats are rejected with proper error messages
4. ✅ Large files (>5MB) use multipart upload automatically
5. ✅ Chunked upload API works with progress tracking
6. ✅ Browser uploads work with CORS policies
7. ✅ Retry logic handles temporary failures with exponential backoff
8. ✅ Both LocalStack and real AWS S3 uploads work correctly

Run `npm run validate:task-5` to verify all criteria are met!
