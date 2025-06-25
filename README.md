# TinyPixo - Fast and Efficient Image Optimization Web Application

TinyPixo is a modern web-based image optimization tool that enables users to compress and convert images to various formats while maintaining quality control. The application provides both single image and batch processing capabilities, supporting popular formats like WebP, AVIF, JPEG, and PNG.

The application leverages Next.js for server-side rendering and Sharp for high-performance image processing. It offers an intuitive user interface with real-time preview capabilities, detailed compression statistics, and flexible optimization settings. Users can adjust quality levels, resize images while maintaining aspect ratios, and process multiple images simultaneously with consistent settings.

## Screenshots

### Single Image Processing
![Single Image Processing](images/Single_Processing.png)
*Single image optimization interface showing before/after comparison with quality controls*

### Batch Processing
![Batch Processing](images/Batch_Processing.png)
*Batch processing interface for optimizing multiple images simultaneously*

## Repository Structure
```
.
├── app/                          # Next.js application directory
│   ├── api/                     # API routes for image processing
│   ├── globals.css              # Global styles and custom slider components
│   ├── layout.tsx              # Root layout component with metadata
│   └── page.tsx                # Main application page component
├── components/                  # React components
│   ├── BatchProcessor.tsx      # Handles batch image processing
│   ├── ControlPanel.tsx        # Image optimization controls
│   ├── ImageComparison.tsx     # Side-by-side image comparison
│   └── ImageUpload.tsx         # File upload handling
├── Dockerfile                   # Multi-stage Docker build configuration
├── next.config.js              # Next.js configuration
└── package.json                # Project dependencies and scripts
```

## Usage Instructions
### Prerequisites
- Node.js 18 or later
- npm or yarn package manager
- Sharp image processing library
- Docker (optional, for containerized deployment)

### Installation

#### Local Development
```bash
# Clone the repository
git clone <repository-url>
cd tinypixo

# Install dependencies
npm install

# Start development server
npm run dev
```

#### Docker Deployment
```bash
# Build Docker image
docker build -t tinypixo .

# Run container
docker run -p 3000:3000 tinypixo
```

### Image Handling
TinyPixo processes images dynamically through its web interface. Here's what you need to know about working with images in the application:

#### Supported Formats
- Input: JPEG, PNG, WebP, AVIF
- Output: WebP, AVIF, JPEG, PNG

#### Upload Methods
1. Drag and drop files directly onto the upload area
2. Click the upload area to select files using the system file picker
3. Batch upload multiple images simultaneously

#### Processing Capabilities
- Quality adjustment (1-100%)
- Format conversion
- Resize with aspect ratio preservation
- Batch processing with consistent settings

#### Storage Considerations
- Images are processed in-memory and not stored on the server
- Processed images must be downloaded after optimization
- Original images are only held in memory during processing

### Quick Start
1. Access the application at `http://localhost:3000`
2. Upload an image by dragging and dropping or clicking the upload area
3. Select desired output format (WebP, AVIF, JPEG, or PNG)
4. Adjust quality settings using the slider (1-100)
5. Configure resize options if needed
6. Download the optimized image

### More Detailed Examples

#### Single Image Optimization
```typescript
// Upload and optimize a single image
const handleImageUpload = async (file: File) => {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('format', 'webp');
  formData.append('quality', '80');
  
  const response = await fetch('/api/optimize', {
    method: 'POST',
    body: formData
  });
  
  const optimizedImage = await response.blob();
}
```

#### Batch Processing
```typescript
// Process multiple images with the same settings
const processBatch = async (files: File[]) => {
  const settings = {
    format: 'webp',
    quality: 80,
    width: 1920,
    height: 1080
  };
  
  for (const file of files) {
    // Process each file with the same settings
    await processImage(file, settings);
  }
};
```

### Troubleshooting

#### Common Issues

1. Image Upload Fails
```bash
# Check file size limits in next.config.js
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
}
```

2. Processing Error
- Ensure Sharp is properly installed
- Verify supported input formats
- Check server logs for detailed error messages

#### Performance Optimization
- Monitor memory usage during batch processing
- Use appropriate quality settings for different image types
- Consider implementing queue system for large batch operations

## Data Flow
TinyPixo processes images through a streamlined pipeline that optimizes for both performance and quality.

```ascii
[Client] -> [Upload] -> [Format Selection] -> [Quality Adjustment] -> [API Route] -> [Sharp Processing] -> [Optimized Image]
```

Component Interactions:
1. Client uploads image(s) through ImageUpload component
2. ControlPanel manages optimization settings
3. BatchProcessor handles multiple file processing
4. API route processes images using Sharp
5. Optimized images are returned to client
6. ImageComparison displays results
7. Download functionality delivers processed images