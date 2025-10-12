# TinyPixo Programmatic API Implementation Plan

## Overview
This document outlines the implementation plan for adding programmatic API capabilities to TinyPixo, allowing developers to automate image compression and optimization through file system operations instead of web uploads.

## Current State Analysis

### Existing Capabilities
- **Web API**: `/api/optimize` handles single image optimization via FormData uploads
- **Supported Formats**: webp, avif, jpeg, png (user selectable)
- **Settings**: format, quality (1-100), width, height for resizing
- **Processing Engine**: Sharp with adaptive quality optimization
- **File Limits**: 50MB per image, 8000px max dimension
- **Batch Processing**: Client-side via BatchProcessor component

### Existing Architecture
```
Current Flow: [File Upload] → [FormData] → [/api/optimize] → [Sharp Processing] → [Binary Response]
```

## Proposed Solution

### New Programmatic Flow
```
New Flow: [File Path/Folder] → [/api/v1/optimize] → [File System Read] → [Sharp Processing] → [File System Write] → [JSON Response]
```

## Implementation Steps

### Step 1: Create API Structure
**Outcome**: New programmatic API endpoint structure

**Files to Create**:
```
app/api/v1/
└── optimize/
    └── route.ts
```

**Tasks**:
- Create `/api/v1/optimize` directory
- Set up TypeScript route handler
- Define request/response interfaces

### Step 2: Request Interface Design
**Outcome**: Standardized API request format

**Request Schema**:
```typescript
interface OptimizeRequest {
  // Input (mutually exclusive)
  filePath?: string;           // Single file: "/path/to/image.jpg"
  folderPath?: string;         // Batch: "/path/to/images/"
  
  // Output settings
  outputDir: string;           // Required: "/path/to/output/"
  
  // Optimization settings (same as existing API)
  format: 'webp' | 'avif' | 'jpeg' | 'png';  // User choice
  quality: number;             // 1-100
  width?: number;              // Optional resize
  height?: number;             // Optional resize
  
  // Processing options
  preserveStructure?: boolean; // Keep folder structure for batch
  overwrite?: boolean;         // Overwrite existing files
}
```

### Step 3: Response Interface Design
**Outcome**: Consistent API response format

**Response Schema**:
```typescript
interface OptimizeResponse {
  success: boolean;
  processedCount: number;
  results: OptimizeResult[];
  errors?: ProcessingError[];
  summary: {
    totalOriginalSize: number;
    totalOptimizedSize: number;
    totalSavings: number;
    compressionRatio: string;
  };
}

interface OptimizeResult {
  originalPath: string;
  outputPath: string;
  originalSize: number;
  optimizedSize: number;
  compressionRatio: string;
  format: string;
  status: 'success' | 'skipped' | 'error';
}
```

### Step 4: File System Operations
**Outcome**: Robust file handling capabilities

**Core Functions to Implement**:
```typescript
// File system utilities
async function readImageFile(filePath: string): Promise<Buffer>
async function writeOptimizedImage(buffer: Buffer, outputPath: string): Promise<void>
async function scanImageFolder(folderPath: string): Promise<string[]>
async function ensureOutputDirectory(outputDir: string): Promise<void>
async function generateOutputPath(inputPath: string, outputDir: string, format: string): Promise<string>
```

**Features**:
- Validate file paths and permissions
- Support common image extensions: .jpg, .jpeg, .png, .webp, .avif
- Recursive folder scanning
- Output directory creation
- File overwrite protection

### Step 5: Reuse Existing Optimization Logic
**Outcome**: Leverage proven Sharp processing pipeline

**Integration Strategy**:
- Extract optimization functions from `/api/optimize/route.ts`
- Reuse `getBestFormat()` function
- Reuse `optimizeWithAdaptiveQuality()` function
- Maintain same quality and format handling
- Keep existing error handling and validation

**Shared Functions**:
```typescript
// Extract from existing code
async function getBestFormat(sharpInstance: sharp.Sharp, requestedFormat: string): Promise<string>
async function optimizeWithAdaptiveQuality(/* existing params */): Promise<Buffer>
```

### Step 6: Batch Processing Implementation
**Outcome**: Efficient folder-based batch optimization

**Batch Processing Logic**:
```typescript
async function processBatch(request: OptimizeRequest): Promise<OptimizeResponse> {
  // 1. Scan folder for images
  // 2. Process each image sequentially (memory management)
  // 3. Collect results and errors
  // 4. Generate summary statistics
  // 5. Return comprehensive response
}
```

**Features**:
- Sequential processing to manage memory
- Progress tracking capability
- Error isolation (one failed image doesn't stop batch)
- Preserve folder structure option
- Skip existing files option

### Step 7: Error Handling & Validation
**Outcome**: Robust error handling and input validation

**Validation Checks**:
- File/folder path existence and permissions
- Output directory write permissions
- Image file format validation
- File size limits (50MB per image)
- Image dimension limits (8000px max)
- Format parameter validation

**Error Types**:
```typescript
interface ProcessingError {
  filePath: string;
  error: string;
  code: 'FILE_NOT_FOUND' | 'PERMISSION_DENIED' | 'INVALID_FORMAT' | 'FILE_TOO_LARGE' | 'PROCESSING_FAILED';
}
```

### Step 8: Security Considerations
**Outcome**: Secure file system access

**Security Measures**:
- Path traversal protection (`../` prevention)
- File extension whitelist
- File size limits enforcement
- Output directory restrictions
- Input sanitization

### Step 9: Testing & Documentation
**Outcome**: Well-tested and documented API

**Test Cases**:
- Single file optimization
- Batch folder processing
- Error scenarios (invalid paths, permissions, etc.)
- Format conversion accuracy
- Quality setting validation

**Documentation**:
- API endpoint documentation
- Request/response examples
- Error code reference
- Usage examples for different scenarios

## API Usage Examples

### Single File Optimization
```bash
curl -X POST http://localhost:3000/api/v1/optimize \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "/Users/john/photos/image.jpg",
    "outputDir": "/Users/john/optimized/",
    "format": "webp",
    "quality": 80,
    "width": 1920
  }'
```

### Batch Folder Processing
```bash
curl -X POST http://localhost:3000/api/v1/optimize \
  -H "Content-Type: application/json" \
  -d '{
    "folderPath": "/Users/john/photos/",
    "outputDir": "/Users/john/optimized/",
    "format": "webp",
    "quality": 85,
    "preserveStructure": true
  }'
```

## Expected Outcomes

### Immediate Benefits
- **Automation**: Developers can integrate TinyPixo into build processes
- **Batch Processing**: Efficient processing of large image collections
- **File System Integration**: Direct file-to-file optimization
- **Consistent Quality**: Same optimization engine as web interface

### Use Cases Enabled
- **Build Tools**: Integration with webpack, gulp, etc.
- **CI/CD Pipelines**: Automated image optimization in deployment
- **Content Management**: Bulk optimization of existing image libraries
- **Development Workflows**: Local image processing during development

### Performance Characteristics
- **Memory Efficient**: Sequential processing for batch operations
- **Same Quality**: Identical optimization results as web interface
- **Error Resilient**: Batch processing continues despite individual failures
- **Progress Tracking**: Optional progress monitoring for long-running batches

## Implementation Timeline

1. **Phase 1** (Steps 1-3): API structure and interfaces 
2. **Phase 2** (Steps 4-5): File system operations and optimization integration 
3. **Phase 3** (Steps 6-7): Batch processing and error handling 
4. **Phase 4** (Steps 8-9): Security, testing, and documentation


## Success Criteria

- ✅ Single file optimization works with all supported formats
- ✅ Batch folder processing handles large image collections
- ✅ Error handling provides clear feedback for all failure scenarios
- ✅ Security measures prevent unauthorized file system access
- ✅ Performance matches or exceeds current web interface
- ✅ API responses provide comprehensive processing statistics
- ✅ Documentation enables easy developer adoption

## Risk Mitigation

### File System Security
- **Risk**: Unauthorized file access
- **Mitigation**: Path validation, sandboxing, permission checks

### Memory Management
- **Risk**: Out of memory during large batch processing
- **Mitigation**: Sequential processing, memory monitoring, garbage collection

### Error Handling
- **Risk**: Batch processing stops on first error
- **Mitigation**: Error isolation, comprehensive error reporting

### Performance
- **Risk**: Slower than web interface
- **Mitigation**: Reuse existing optimization logic, efficient file I/O