# PDF Compression Implementation Plan - 3-5 Hours

## Overview
Add PDF compression functionality to TinyPixo using Ghostscript, following the existing audio/video converter pattern to ensure seamless integration without affecting current image optimization features.

## Timeline: 3-5 Hours Total

---

## Phase 1: Local Ghostscript Setup & Testing (30 minutes)

### 1.1 Install Ghostscript Locally
```bash
# macOS
brew install ghostscript

# Verify installation
gs --version
which gs
```

### 1.2 Test Ghostscript Commands
```bash
# Create test directory
mkdir pdf-test && cd pdf-test

# Test compression with different quality levels
gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dQUIET -dBATCH -sOutputFile=compressed_screen.pdf input.pdf
gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile=compressed_ebook.pdf input.pdf
gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/printer -dNOPAUSE -dQUIET -dBATCH -sOutputFile=compressed_printer.pdf input.pdf
```

### 1.3 Quality Level Testing
- `/screen` - Lowest quality (72 DPI images)
- `/ebook` - Medium quality (150 DPI images)  
- `/printer` - High quality (300 DPI images)
- `/prepress` - Highest quality (300+ DPI images)

**Success Criteria:**
- Ghostscript installed and working
- Compression reduces file size by 30-70%
- No corruption in compressed PDFs

---

## Phase 2: Backend API Development (1.5 hours)

### 2.1 Create API Structure (15 minutes)
```
app/api/
├── convert-pdf/
│   └── route.ts          # Upload endpoint (copy from convert-audio)
└── convert-pdf/process/
    └── route.ts          # Processing endpoint (copy from convert-audio/process)
```

### 2.2 Upload Endpoint (30 minutes)
**File:** `app/api/convert-pdf/route.ts`
- Copy from `app/api/convert-audio/route.ts`
- Change file type validation to PDF
- Keep same upload logic and temp file handling

### 2.3 Processing Endpoint (45 minutes)
**File:** `app/api/convert-pdf/process/route.ts`
- Copy from `app/api/convert-audio/process/route.ts`
- Replace FFmpeg logic with Ghostscript
- Add quality parameter mapping
- Implement progress tracking (fake progress based on file size)

**Ghostscript Integration:**
```typescript
const gsCommand = [
  'gs',
  '-sDEVICE=pdfwrite',
  '-dCompatibilityLevel=1.4',
  `-dPDFSETTINGS=/${quality}`, // screen, ebook, printer, prepress
  '-dNOPAUSE',
  '-dQUIET', 
  '-dBATCH',
  `-sOutputFile=${outputPath}`,
  inputPath
]
```

**Success Criteria:**
- PDF upload works (50MB limit)
- Compression processes without errors
- Progress tracking functional
- Compressed PDF downloads correctly

---

## Phase 3: Frontend Components (1 hour)

### 3.1 Create PDF Converter Page (20 minutes)
**File:** `app/pdf-converter/page.tsx`
- Copy from `app/audio-converter/page.tsx`
- Update metadata and titles
- Change component imports

### 3.2 PDF Components (40 minutes)
**Directory:** `components/pdf/`

**Files to create:**
- `PDFUpload.tsx` (copy from `components/audio/AudioUpload.tsx`)
- `PDFControls.tsx` (copy from `components/audio/AudioControls.tsx`)  
- `PDFPreview.tsx` (copy from `components/audio/AudioPreview.tsx`)

**PDFControls.tsx modifications:**
```typescript
// Quality options
const qualityOptions = [
  { value: 'screen', label: 'Screen (Smallest)', description: '72 DPI' },
  { value: 'ebook', label: 'E-book (Medium)', description: '150 DPI' },
  { value: 'printer', label: 'Printer (High)', description: '300 DPI' },
  { value: 'prepress', label: 'Prepress (Highest)', description: '300+ DPI' }
]
```

**Success Criteria:**
- PDF upload interface works
- Quality selection functional
- Progress bar displays during compression
- Download works after processing

---

## Phase 4: Navigation Integration (15 minutes)

### 4.1 Update Navigation Component
**File:** `components/Navigation.tsx`
- Add PDF converter link
- Ensure existing links still work

### 4.2 Test Existing Features
- Verify image optimization still works
- Verify audio conversion still works  
- Verify video conversion still works

**Success Criteria:**
- All existing features unaffected
- PDF converter accessible from navigation
- No broken links or components

---

## Phase 5: Docker Integration (30 minutes)

### 5.1 Update Dockerfile
**File:** `Dockerfile`
```dockerfile
# Add ghostscript to existing RUN command in runner stage
RUN apk add --no-cache \
    vips \
    vips-cpp \
    glib \
    expat \
    ffmpeg \
    ghostscript && \
    echo "FFmpeg installed at: $(which ffmpeg)" && \
    echo "Ghostscript installed at: $(which gs)" && \
    ln -sf $(which ffmpeg) /usr/local/bin/ffmpeg && \
    ln -sf $(which gs) /usr/local/bin/gs && \
    chmod +x /usr/local/bin/ffmpeg && \
    chmod +x /usr/local/bin/gs
```

### 5.2 Environment Variables
```dockerfile
ENV GHOSTSCRIPT_PATH="/usr/local/bin/gs"
```

### 5.3 Build and Test
```bash
docker build -t tinypixo-pdf .
docker run -p 3000:3000 tinypixo-pdf
```

**Success Criteria:**
- Docker builds without errors
- Ghostscript accessible in container
- PDF compression works in Docker
- All existing features work in Docker

---

## Phase 6: Testing & Debugging (30 minutes)

### 6.1 Local Testing
- Test with various PDF sizes (1MB, 10MB, 50MB)
- Test different quality settings
- Test error scenarios (corrupted PDF, oversized file)

### 6.2 Docker Testing  
- Same tests as local
- Verify memory usage stays reasonable
- Test concurrent processing

### 6.3 Integration Testing
- Test all converters work simultaneously
- Verify no interference between features
- Check navigation and UI consistency

**Success Criteria:**
- All PDF compression scenarios work
- No regressions in existing features
- Performance acceptable (under 30s for 10MB PDF)

---

## File Structure After Implementation

```
TinyPixo/
├── app/
│   ├── api/
│   │   ├── convert-pdf/
│   │   │   ├── route.ts
│   │   │   └── process/
│   │   │       └── route.ts
│   │   ├── convert-audio/          # Existing
│   │   ├── convert-video/          # Existing  
│   │   └── optimize/               # Existing
│   ├── pdf-converter/
│   │   └── page.tsx
│   ├── audio-converter/            # Existing
│   ├── video-converter/            # Existing
│   └── page.tsx                    # Existing (images)
├── components/
│   ├── pdf/
│   │   ├── PDFUpload.tsx
│   │   ├── PDFControls.tsx
│   │   └── PDFPreview.tsx
│   ├── audio/                      # Existing
│   ├── video/                      # Existing
│   └── [existing components]
└── Dockerfile                      # Updated
```

---

## Potential Issues & Solutions

### Issue 1: Ghostscript Installation Fails
**Problem:** Alpine package missing or broken
**Solution:** Test with `docker run --rm node:24-alpine sh -c "apk add ghostscript && gs --version"`
**Backup:** Use pdf-lib library (JavaScript-only solution)

### Issue 2: Large File Processing
**Problem:** 50MB PDFs take too long or crash
**Solution:** Add file size warnings, implement timeout handling
**Backup:** Reduce max file size to 20MB

### Issue 3: Memory Issues in Docker
**Problem:** Ghostscript uses too much RAM
**Solution:** Process one PDF at a time, monitor container memory
**Backup:** Add memory limits to Docker container

### Issue 4: Progress Tracking
**Problem:** Ghostscript doesn't provide real progress
**Solution:** Fake progress based on file size estimation
**Implementation:** 0-20% upload, 20-90% processing, 90-100% download

### Issue 5: File Permissions
**Problem:** nextjs user can't write temp files
**Solution:** Use `/tmp` directory with proper permissions
**Implementation:** Ensure temp files are cleaned up after processing

---

## Success Metrics

### Functional Requirements
- ✅ PDF upload (up to 50MB)
- ✅ Quality selection (4 levels)
- ✅ Compression processing
- ✅ Progress indication
- ✅ Download compressed PDF
- ✅ Error handling

### Performance Requirements  
- ✅ 10MB PDF compresses in under 30 seconds
- ✅ 30-70% file size reduction
- ✅ Memory usage under 1GB during processing
- ✅ No impact on existing features

### Integration Requirements
- ✅ Follows existing UI patterns
- ✅ Uses same upload/progress system
- ✅ Navigation integration seamless
- ✅ Docker deployment works
- ✅ All existing features unaffected

---

## Post-Implementation Enhancements (Future)

### Phase 7: Advanced Features (Not in MVP)
- Batch PDF processing
- PDF preview with PDF.js
- Advanced compression settings
- Compression statistics display
- PDF metadata removal options

### Phase 8: Optimization (Not in MVP)
- Streaming processing for large files
- Queue system for multiple PDFs
- Better progress estimation
- Memory usage optimization

---

## Ready to Start?

**Next Step:** Begin Phase 1 - Install Ghostscript locally and test compression commands.

**Command to run:**
```bash
brew install ghostscript && gs --version
```