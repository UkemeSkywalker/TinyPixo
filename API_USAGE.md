# TinyPixo Programmatic API

## Overview
The TinyPixo Programmatic API allows developers to optimize images directly from the file system without web uploads.

## Endpoint
```
POST /api/v1/optimize
```

## Request Format
```typescript
{
  // Input (mutually exclusive)
  filePath?: string;           // Single file: "/path/to/image.jpg"
  folderPath?: string;         // Batch: "/path/to/images/"
  
  // Output settings
  outputDir: string;           // Required: "/path/to/output/"
  
  // Optimization settings
  format: 'webp' | 'avif' | 'jpeg' | 'png';
  quality: number;             // 1-100
  width?: number;              // Optional resize
  height?: number;             // Optional resize
  
  // Processing options
  preserveStructure?: boolean; // Keep folder structure for batch
  overwrite?: boolean;         // Overwrite existing files
}
```

## Usage Examples

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

## Response Format
```typescript
{
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
```

## Features
- ✅ Single file and batch folder processing
- ✅ Preserves folder structure
- ✅ Same optimization engine as web interface
- ✅ Comprehensive error handling
- ✅ Processing statistics and summaries
- ✅ Path validation and security