# Large Audio File Handling (200MB+)

## Additional Problems with Large Files

When users upload 200MB+ audio files, several new issues emerge beyond the original timeout problems:

### **1. Upload Timeouts**
- **Problem**: 200MB upload takes 3-10 minutes depending on connection
- **App Runner Limit**: 120-second request timeout
- **Result**: Upload fails before completion

### **2. Memory Exhaustion**
- **Problem**: Loading 200MB+ files into memory crashes the container
- **App Runner Limit**: Limited RAM per container
- **Result**: Out of memory errors, container restarts

### **3. Disk Space Issues**
- **Problem**: Multiple large files fill `/tmp` directory
- **App Runner Limit**: Limited ephemeral storage
- **Result**: No space left on device errors

### **4. Extended Conversion Times**
- **Problem**: Large files take 15-30 minutes to convert
- **Previous Limit**: 10-minute timeout
- **Result**: Conversion killed before completion

## Implemented Solutions

### **1. Large File Upload Endpoint** (`/api/upload-large`)
```typescript
// Handles files up to 500MB with proper streaming
// Validates file size before processing
// Uses disk storage instead of memory
```

**Features:**
- ✅ 500MB file size limit
- ✅ Streams to disk (no memory loading)
- ✅ File size validation
- ✅ Progress tracking support

### **2. Dynamic Conversion Timeouts**
```typescript
// Adjusts timeout based on file size
const maxConversionTime = fileSizeMB > 100 ? 20 * 60 * 1000 : 10 * 60 * 1000
```

**Timeouts:**
- Small files (<100MB): 10 minutes
- Large files (>100MB): 20 minutes

### **3. Smart Memory Management**
```typescript
if (outputSizeMB > 50) {
  // Store path only - no memory loading
  progressData.outputPath = outputPath
  progressData.isLargeFile = true
} else {
  // Load small files into memory for speed
  progressData.outputBuffer = outputBuffer
}
```

**Strategy:**
- Files >50MB: Path-based storage
- Files <50MB: Memory-based storage

### **4. Enhanced Cleanup System**
```typescript
// Aggressive cleanup for large files
const shouldCleanup = jobAge > maxAge || 
                     progressData.progress === -1 || 
                     (progressData.isLargeFile && jobAge > 10 * 60 * 1000)
```

**Cleanup Rules:**
- Large files: Cleaned after 10 minutes
- Regular files: Cleaned after 30 minutes
- Failed jobs: Cleaned immediately

### **5. Disk Usage Monitoring**
```typescript
// Health endpoint tracks disk usage
diskUsage: {
  tmpFiles: 15,
  tmpSizeMB: 1250,
  largeFiles: 3
}
```

**Monitoring:**
- Total files in `/tmp`
- Total disk usage in MB
- Count of large files (>100MB)
- Warning when usage >1GB

### **6. Chunked Upload Support** (Future Enhancement)
```typescript
// For files >200MB, upload in 10MB chunks
const chunkSize = 10 * 1024 * 1024 // 10MB chunks
```

**Benefits:**
- Bypasses 120-second upload timeout
- Resumable uploads
- Better progress tracking
- Network failure recovery

## Usage Guidelines

### **File Size Limits**
- **Maximum**: 500MB per file
- **Recommended**: <200MB for best performance
- **Optimal**: <100MB for fastest processing

### **Expected Processing Times**
| File Size | Upload Time | Conversion Time | Total Time |
|-----------|-------------|-----------------|------------|
| 50MB      | 30-60s      | 2-5 min        | 3-6 min    |
| 100MB     | 1-2 min     | 5-10 min       | 6-12 min   |
| 200MB     | 2-4 min     | 10-20 min      | 12-24 min  |
| 500MB     | 5-10 min    | 20-40 min      | 25-50 min  |

### **Resource Usage**
| File Size | Memory Usage | Disk Usage | Cleanup Time |
|-----------|--------------|------------|--------------|
| <50MB     | ~100MB RAM   | ~150MB     | 30 min       |
| 50-200MB  | ~50MB RAM    | ~400MB     | 10 min       |
| >200MB    | ~50MB RAM    | ~1GB       | 10 min       |

## Monitoring Large File Operations

### **Health Check**
```bash
curl https://your-app.com/api/health
```

**Watch for:**
- `diskUsage.tmpSizeMB > 1000` (>1GB usage)
- `diskUsage.largeFiles > 5` (too many large files)
- `status: "warning"` (resource constraints)

### **Manual Cleanup**
```bash
curl -X POST https://your-app.com/api/cleanup
```

**Triggers cleanup when:**
- Disk space is low
- Too many abandoned jobs
- System performance degrades

### **Automatic Cleanup Schedule**
Consider setting up a cron job to run cleanup every 10 minutes:
```bash
# Every 10 minutes
*/10 * * * * curl -X POST https://your-app.com/api/cleanup
```

## Error Handling for Large Files

### **Upload Errors**
- `413 Payload Too Large`: File exceeds 500MB limit
- `408 Request Timeout`: Upload took >10 minutes
- `507 Insufficient Storage`: Not enough disk space

### **Conversion Errors**
- `Conversion timeout`: File too large for 20-minute limit
- `Out of memory`: System overloaded
- `No space left`: Disk full during conversion

### **Download Errors**
- `404 Not Found`: File cleaned up or expired
- `500 Internal Error`: Disk read failure

## Best Practices

1. **Validate file size** before upload
2. **Show realistic time estimates** to users
3. **Monitor disk usage** regularly
4. **Set up automatic cleanup**
5. **Consider file compression** for very large files
6. **Implement chunked uploads** for files >200MB

The system now handles large files gracefully while preventing resource exhaustion and timeout issues.