const express = require('express');
const multer = require('multer');
const cors = require('cors');
const sharp = require('sharp');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Endpoint for image compression
app.post('/api/compress', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const { format = 'jpeg', quality = 80 } = req.query;
    const supportedFormats = ['jpeg', 'png', 'webp', 'avif'];
    
    if (!supportedFormats.includes(format)) {
      return res.status(400).json({ error: 'Unsupported format' });
    }

    // Get original image info
    const originalSize = req.file.size;
    
    // Process image with Sharp
    let processedImage = sharp(req.file.buffer);
    
    // Convert to requested format with quality setting
    const qualityValue = parseInt(quality);
    const options = {};
    
    if (format === 'jpeg' || format === 'webp' || format === 'avif') {
      options.quality = qualityValue;
    } else if (format === 'png') {
      options.compressionLevel = Math.floor(qualityValue / 10);
    }
    
    processedImage = processedImage.toFormat(format, options);
    
    // Get processed buffer
    const outputBuffer = await processedImage.toBuffer();
    
    // Set appropriate content type
    const contentTypes = {
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      avif: 'image/avif'
    };
    
    // Send response with compression stats
    res.set('Content-Type', contentTypes[format]);
    res.set('X-Original-Size', originalSize.toString());
    res.set('X-Compressed-Size', outputBuffer.length.toString());
    res.set('Content-Disposition', `attachment; filename="compressed-image.${format}"`);
    res.send(outputBuffer);
    
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ error: 'Failed to process image' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});