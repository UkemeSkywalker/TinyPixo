# ZIP Export Implementation Plan

## Overview
Add ZIP export functionality to batch image processing that preserves folder structure while handling memory and performance constraints through chunked processing and Web Workers.

## Current State
- Batch processing handles multiple images sequentially
- Users download files individually or use "Download All" (separate files)
- No folder structure preservation
- All processing happens on main thread

## Target State
- Single ZIP download with preserved folder structure
- Memory-efficient chunked processing
- Non-blocking UI during ZIP creation
- Progress indicators for all phases
- Fallback to individual downloads if ZIP fails

## Implementation Steps

### Step 1: Add ZIP Library
**Outcome**: ZIP creation capability

**Tasks**:
- Install JSZip library: `npm install jszip`
- Add types: `npm install @types/jszip`
- Import in BatchProcessor component

### Step 2: Create Web Worker for ZIP Processing
**Outcome**: Non-blocking ZIP creation

**Files to Create**:
```
public/workers/
└── zipWorker.js
```

**Worker Responsibilities**:
- Receive processed image blobs and file paths
- Create ZIP structure with folder hierarchy
- Stream ZIP creation to avoid memory spikes
- Send progress updates back to main thread
- Return final ZIP blob

### Step 3: Modify BatchProcessor State
**Outcome**: Track ZIP creation progress

**New State Variables**:
```typescript
const [zipProgress, setZipProgress] = useState(0)
const [isCreatingZip, setIsCreatingZip] = useState(false)
const [zipWorker, setZipWorker] = useState<Worker | null>(null)
```

### Step 4: Implement Chunked Processing
**Outcome**: Memory-efficient batch processing

**Processing Strategy**:
- Process images in chunks of 5-10 files
- Clear processed blobs from memory after adding to ZIP
- Monitor memory usage and adjust chunk size dynamically
- Garbage collect between chunks

**Chunk Processing Logic**:
```typescript
const CHUNK_SIZE = 8 // Adjustable based on memory
const processInChunks = async (files: File[]) => {
  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    const chunk = files.slice(i, i + CHUNK_SIZE)
    await processChunk(chunk)
    // Force garbage collection opportunity
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
```

### Step 5: Create ZIP Worker Implementation
**Outcome**: Efficient ZIP creation off main thread

**Worker Features**:
- Receive image data in chunks
- Build ZIP incrementally
- Preserve folder structure from webkitRelativePath
- Send progress updates every 10% completion
- Handle errors gracefully

**Message Interface**:
```typescript
// Main → Worker
interface ZipWorkerMessage {
  type: 'ADD_FILE' | 'FINALIZE' | 'CANCEL'
  data?: {
    blob: Blob
    path: string
    originalPath: string
  }
}

// Worker → Main  
interface ZipWorkerResponse {
  type: 'PROGRESS' | 'COMPLETE' | 'ERROR'
  progress?: number
  zipBlob?: Blob
  error?: string
}
```

### Step 6: Update UI for ZIP Export
**Outcome**: Clear progress indication and controls

**UI Changes**:
- Add "Export as ZIP" button alongside "Download All"
- Show ZIP creation progress bar
- Display current phase: "Processing images..." → "Creating ZIP..."
- Add cancel button for ZIP creation
- Show memory usage warning for large batches

**Progress Phases**:
1. Image processing: 0-80%
2. ZIP creation: 80-100%

### Step 7: Implement Folder Structure Preservation
**Outcome**: Maintain original folder hierarchy in ZIP

**Path Processing**:
```typescript
const preserveFolderStructure = (file: File, format: string) => {
  const relativePath = file.webkitRelativePath || file.name
  const pathParts = relativePath.split('/')
  const fileName = pathParts.pop()?.replace(/\.[^/.]+$/, '') + `.${format}`
  return [...pathParts, fileName].join('/')
}
```

### Step 8: Add Memory Management
**Outcome**: Prevent browser crashes from memory exhaustion

**Memory Strategies**:
- Monitor heap usage with `performance.memory` (Chrome)
- Reduce chunk size if memory usage > 80%
- Show warning for batches > 50 files
- Implement emergency fallback to individual downloads

**Memory Monitoring**:
```typescript
const checkMemoryUsage = () => {
  if ('memory' in performance) {
    const memory = (performance as any).memory
    const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit
    return usageRatio > 0.8 // 80% threshold
  }
  return false
}
```

### Step 9: Error Handling and Fallbacks
**Outcome**: Robust error recovery

**Error Scenarios**:
- ZIP creation fails → Fallback to individual downloads
- Memory exhaustion → Reduce batch size and retry
- Worker crashes → Restart worker and retry
- Large file timeout → Skip problematic files

**Fallback Strategy**:
```typescript
const handleZipFailure = (error: string) => {
  console.warn('ZIP creation failed:', error)
  setIsCreatingZip(false)
  // Fallback to existing "Download All" functionality
  downloadAll()
}
```

### Step 10: Add User Controls
**Outcome**: User control over export process

**New Controls**:
- ZIP vs Individual download toggle
- Cancel ZIP creation button
- Batch size limit setting (default: 50 files)
- Memory usage indicator
- Estimated ZIP size preview

## Technical Implementation Details

### ZIP Worker Structure
```javascript
// public/workers/zipWorker.js
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js')

let zip = new JSZip()
let fileCount = 0
let totalFiles = 0

self.onmessage = function(e) {
  const { type, data } = e.data
  
  switch(type) {
    case 'ADD_FILE':
      addFileToZip(data)
      break
    case 'FINALIZE':
      finalizeZip()
      break
    case 'CANCEL':
      resetZip()
      break
  }
}
```

### Memory-Efficient Processing
```typescript
const processWithMemoryManagement = async (files: File[]) => {
  let chunkSize = CHUNK_SIZE
  
  for (let i = 0; i < files.length; i += chunkSize) {
    // Check memory before processing chunk
    if (checkMemoryUsage()) {
      chunkSize = Math.max(2, Math.floor(chunkSize / 2))
      console.warn(`Reducing chunk size to ${chunkSize} due to memory pressure`)
    }
    
    const chunk = files.slice(i, i + chunkSize)
    await processChunk(chunk)
  }
}
```

### Progress Calculation
```typescript
const calculateOverallProgress = (
  processedFiles: number,
  totalFiles: number,
  zipProgress: number
) => {
  const processingPhase = (processedFiles / totalFiles) * 80
  const zipPhase = (zipProgress / 100) * 20
  return Math.min(100, processingPhase + zipPhase)
}
```

## Expected Outcomes

### User Experience
- Single ZIP download preserves folder structure
- Clear progress indication throughout process
- Responsive UI during processing
- Graceful handling of large batches

### Performance Characteristics
- Memory usage stays under browser limits
- UI remains responsive during processing
- Automatic fallback for problematic batches
- Efficient processing of 100+ image folders

### File Organization
```
Original Structure:
Photos/
├── vacation/beach.jpg
└── family/reunion/group.jpg

ZIP Structure:
Photos_optimized.zip
├── vacation/beach.webp
└── family/reunion/group.webp
```

## Risk Mitigation

### Memory Exhaustion
- **Risk**: Browser crashes with large batches
- **Mitigation**: Chunked processing, memory monitoring, batch size limits

### Performance Degradation  
- **Risk**: UI freezing during ZIP creation
- **Mitigation**: Web Worker processing, progress indicators

### ZIP Creation Failure
- **Risk**: Process fails after image processing complete
- **Mitigation**: Fallback to individual downloads, error recovery

### Browser Compatibility
- **Risk**: Web Worker or ZIP features not supported
- **Mitigation**: Feature detection, graceful degradation

## Success Criteria

- ✅ Process 50+ image folders without memory issues
- ✅ Preserve complete folder structure in ZIP
- ✅ UI remains responsive during entire process
- ✅ Clear progress indication for all phases
- ✅ Graceful fallback when ZIP creation fails
- ✅ Memory usage stays under 80% of available heap
- ✅ ZIP creation completes in reasonable time (<2min for 100 images)