# AWS App Runner Migration Plan
## Server-Side FFmpeg Processing for Large Files

### Overview
Migrate from AWS Amplify to AWS App Runner to enable server-side audio/video processing with FFmpeg, supporting files up to 1GB+ with dedicated CPU resources.

### Current Issues
- **Client-side FFmpeg**: Browser WASM loading timeouts
- **File size limits**: Browser memory constraints (2-4GB)
- **Compatibility issues**: Different browsers, devices
- **Processing speed**: Limited by user's device

### Solution: AWS App Runner
- **Server-side processing**: No browser limitations
- **Large file support**: 1GB+ files
- **Dedicated resources**: Up to 4 vCPU, 12GB RAM
- **Auto-scaling**: Pay per use, scales to zero
- **Docker support**: Custom FFmpeg installation

---

## Implementation Plan

### Phase 1: Docker Container Setup

#### 1.1 Create Dockerfile
```dockerfile
FROM node:18-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Build Next.js app
RUN npm run build

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
```

#### 1.2 Update package.json
```json
{
  "scripts": {
    "start": "next start -p 3000",
    "build": "next build"
  }
}
```

### Phase 2: Server-Side API Routes

#### 2.1 Audio Conversion API
**File**: `/app/api/convert-audio/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { writeFile, unlink, readFile } from 'fs/promises'
import { join } from 'path'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('audio') as File
  const format = formData.get('format') as string
  const quality = formData.get('quality') as string

  // Save uploaded file
  const inputPath = join('/tmp', `input-${Date.now()}.${file.name.split('.').pop()}`)
  const outputPath = join('/tmp', `output-${Date.now()}.${format}`)
  
  await writeFile(inputPath, Buffer.from(await file.arrayBuffer()))

  // FFmpeg conversion
  const args = ['-i', inputPath, '-b:a', quality, outputPath]
  
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', args)
    
    ffmpeg.on('close', async (code) => {
      if (code === 0) {
        const outputBuffer = await readFile(outputPath)
        await unlink(inputPath)
        await unlink(outputPath)
        
        resolve(new NextResponse(outputBuffer, {
          headers: { 'Content-Type': `audio/${format}` }
        }))
      } else {
        resolve(NextResponse.json({ error: 'Conversion failed' }, { status: 500 }))
      }
    })
  })
}
```

#### 2.2 Video Conversion API
**File**: `/app/api/convert-video/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { writeFile, unlink, readFile } from 'fs/promises'
import { join } from 'path'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('video') as File
  const format = formData.get('format') as string
  const quality = formData.get('quality') as string
  const resolution = formData.get('resolution') as string

  const inputPath = join('/tmp', `input-${Date.now()}.${file.name.split('.').pop()}`)
  const outputPath = join('/tmp', `output-${Date.now()}.${format}`)
  
  await writeFile(inputPath, Buffer.from(await file.arrayBuffer()))

  // Build FFmpeg args
  const args = ['-i', inputPath]
  
  if (quality === 'high') args.push('-crf', '18')
  else if (quality === 'medium') args.push('-crf', '23')
  else args.push('-crf', '28')
  
  if (resolution !== 'original') {
    args.push('-vf', `scale=${resolution}:force_original_aspect_ratio=decrease`)
  }
  
  args.push('-c:v', 'libx264', '-preset', 'fast', outputPath)

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', args)
    
    ffmpeg.on('close', async (code) => {
      if (code === 0) {
        const outputBuffer = await readFile(outputPath)
        await unlink(inputPath)
        await unlink(outputPath)
        
        resolve(new NextResponse(outputBuffer, {
          headers: { 'Content-Type': `video/${format}` }
        }))
      } else {
        resolve(NextResponse.json({ error: 'Conversion failed' }, { status: 500 }))
      }
    })
  })
}
```

### Phase 3: Frontend Updates

#### 3.1 Remove Client-Side FFmpeg
- Delete FFmpeg imports from audio/video converter pages
- Remove WASM loading logic
- Update conversion functions to use server APIs

#### 3.2 Update Audio Converter
```typescript
const convertAudio = async () => {
  if (!originalFile) return

  setIsConverting(true)
  const formData = new FormData()
  formData.append('audio', originalFile)
  formData.append('format', format)
  formData.append('quality', quality)

  try {
    const response = await fetch('/api/convert-audio', {
      method: 'POST',
      body: formData,
    })

    if (response.ok) {
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      setConvertedUrl(url)
      setConvertedSize(blob.size)
    }
  } catch (error) {
    console.error('Conversion failed:', error)
  } finally {
    setIsConverting(false)
  }
}
```

#### 3.3 Add Progress Tracking
```typescript
// Add progress endpoint
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')
  
  // Return progress status
  return NextResponse.json({ progress: getJobProgress(jobId) })
}
```

### Phase 4: File Upload Optimization

#### 4.1 Chunked Upload Support
```typescript
// For files > 100MB, implement chunked upload
const uploadLargeFile = async (file: File) => {
  const chunkSize = 10 * 1024 * 1024 // 10MB chunks
  const chunks = Math.ceil(file.size / chunkSize)
  
  for (let i = 0; i < chunks; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, file.size)
    const chunk = file.slice(start, end)
    
    await uploadChunk(chunk, i, chunks)
  }
}
```

#### 4.2 Progress Indicators
- Real-time upload progress
- Processing progress from FFmpeg
- ETA calculations

### Phase 5: AWS App Runner Deployment

#### 5.1 Build Configuration
**File**: `apprunner.yaml`
```yaml
version: 1.0
runtime: docker
build:
  commands:
    build:
      - echo "Building Docker container..."
run:
  runtime-version: latest
  command: npm start
  network:
    port: 3000
    env: PORT
  env:
    - name: NODE_ENV
      value: production
```

#### 5.2 Resource Configuration
- **CPU**: 2 vCPU (can scale to 4)
- **Memory**: 4GB (can scale to 12GB)
- **Auto-scaling**: 1-10 instances
- **Health check**: `/api/health`

#### 5.3 Environment Variables
```bash
NODE_ENV=production
MAX_FILE_SIZE=1073741824  # 1GB
TEMP_DIR=/tmp
FFMPEG_TIMEOUT=300000     # 5 minutes
```

---

## Migration Steps

### Step 1: Local Testing
1. Create Dockerfile
2. Build container: `docker build -t tinypixo .`
3. Run locally: `docker run -p 3000:3000 tinypixo`
4. Test with large files

### Step 2: App Runner Setup
1. Push code to GitHub/ECR
2. Create App Runner service
3. Configure auto-scaling
4. Set environment variables

### Step 3: DNS & Domain
1. Configure custom domain
2. Update DNS records
3. SSL certificate setup

### Step 4: Monitoring
1. CloudWatch logs
2. Performance metrics
3. Error tracking
4. Cost monitoring

---

## Benefits After Migration

### Performance
- **File size**: 1GB+ support (vs 15MB limit)
- **Processing speed**: Dedicated CPUs (vs browser limitations)
- **Reliability**: No browser compatibility issues
- **Concurrent processing**: Multiple files simultaneously

### Cost Optimization
- **Pay per use**: Auto-scales to zero when idle
- **No idle costs**: Unlike EC2 instances
- **Predictable pricing**: Based on actual usage

### Scalability
- **Auto-scaling**: Handles traffic spikes
- **Load balancing**: Built-in distribution
- **Global deployment**: Multiple regions

---

## Estimated Timeline
- **Phase 1-2**: 2-3 days (Docker + APIs)
- **Phase 3**: 1-2 days (Frontend updates)
- **Phase 4**: 2-3 days (Upload optimization)
- **Phase 5**: 1 day (Deployment)

**Total**: 6-9 days for complete migration

---

## Cost Comparison
- **Current Amplify**: ~$20-50/month
- **App Runner**: ~$30-100/month (with better performance)
- **Break-even**: Higher performance justifies cost increase