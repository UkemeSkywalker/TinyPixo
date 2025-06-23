import React, { useState } from 'react';
import axios from 'axios';
import './ImageUploader.css';

const API_URL = 'http://localhost:5000/api';

const ImageUploader = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [format, setFormat] = useState('jpeg');
  const [quality, setQuality] = useState(80);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    setSelectedFile(file);
    setError(null);
    setStats(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = () => {
      setPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleFormatChange = (e) => {
    setFormat(e.target.value);
  };

  const handleQualityChange = (e) => {
    setQuality(e.target.value);
  };

  const handleCompress = async () => {
    if (!selectedFile) {
      setError('Please select an image first');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('image', selectedFile);

      const response = await axios.post(
        `${API_URL}/compress?format=${format}&quality=${quality}`,
        formData,
        {
          responseType: 'blob',
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      // Get compression stats from headers
      const originalSize = response.headers['x-original-size'];
      const compressedSize = response.headers['x-compressed-size'];
      
      // Create download URL
      const url = window.URL.createObjectURL(new Blob([response.data]));
      
      setStats({
        originalSize: formatBytes(originalSize),
        compressedSize: formatBytes(compressedSize),
        compressionRatio: ((1 - (compressedSize / originalSize)) * 100).toFixed(2),
        downloadUrl: url,
      });
    } catch (err) {
      console.error('Compression error:', err);
      setError('Failed to compress image. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="image-uploader">
      <div className="upload-container">
        <label className="file-input-label">
          <input
            type="file"
            onChange={handleFileChange}
            accept="image/*"
            className="file-input"
          />
          <span className="file-input-text">
            {selectedFile ? selectedFile.name : 'Choose an image'}
          </span>
        </label>

        {preview && (
          <div className="preview-container">
            <img src={preview} alt="Preview" className="image-preview" />
          </div>
        )}

        <div className="options-container">
          <div className="option-group">
            <label>Format:</label>
            <select value={format} onChange={handleFormatChange}>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
              <option value="avif">AVIF</option>
            </select>
          </div>

          <div className="option-group">
            <label>Quality: {quality}%</label>
            <input
              type="range"
              min="10"
              max="100"
              value={quality}
              onChange={handleQualityChange}
              className="quality-slider"
            />
          </div>
        </div>

        <button
          onClick={handleCompress}
          disabled={!selectedFile || loading}
          className="compress-button"
        >
          {loading ? 'Compressing...' : 'Compress Image'}
        </button>

        {error && <div className="error-message">{error}</div>}

        {stats && (
          <div className="stats-container">
            <h3>Compression Results</h3>
            <div className="stats-grid">
              <div>Original size:</div>
              <div>{stats.originalSize}</div>
              <div>Compressed size:</div>
              <div>{stats.compressedSize}</div>
              <div>Reduction:</div>
              <div>{stats.compressionRatio}%</div>
            </div>
            <a
              href={stats.downloadUrl}
              download={`compressed-image.${format}`}
              className="download-button"
            >
              Download Compressed Image
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageUploader;