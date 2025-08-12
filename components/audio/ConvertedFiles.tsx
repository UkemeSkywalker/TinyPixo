"use client";

import React, { useState, useEffect } from "react";

interface ConvertedFile {
  jobId: string;
  fileName: string;
  originalFileName: string;
  format: string;
  quality: string;
  size: number;
  conversionDate: string;
  createdAt: string;
  s3Location: {
    bucket: string;
    key: string;
    size: number;
  };
}

interface ConvertedFilesProps {
  refreshTrigger?: number; // Used to trigger refresh when new conversion completes
}

export default function ConvertedFiles({ refreshTrigger }: ConvertedFilesProps) {
  const [files, setFiles] = useState<ConvertedFile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingFiles, setDownloadingFiles] = useState<Set<string>>(new Set());

  // Fetch converted files
  const fetchConvertedFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('[ConvertedFiles] Fetching converted files...');
      
      const response = await fetch('/api/converted-files', {
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch converted files' }));
        throw new Error(errorData.error || `Failed to fetch files (${response.status})`);
      }

      const data = await response.json();
      console.log(`[ConvertedFiles] Fetched ${data.count} converted files`);
      
      setFiles(data.files || []);
    } catch (err) {
      console.error('[ConvertedFiles] Error fetching converted files:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch converted files');
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchConvertedFiles();
  }, []);

  // Refresh when refreshTrigger changes (new conversion completed)
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      console.log('[ConvertedFiles] Refresh triggered by new conversion completion');
      fetchConvertedFiles();
    }
  }, [refreshTrigger]);

  // Handle file download
  const handleDownload = async (file: ConvertedFile) => {
    if (downloadingFiles.has(file.jobId)) {
      return; // Already downloading
    }

    try {
      setDownloadingFiles(prev => new Set(prev).add(file.jobId));
      
      console.log(`[ConvertedFiles] Starting download for job ${file.jobId}`);
      
      const response = await fetch(`/api/download?jobId=${file.jobId}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(errorData.error || `Download failed (${response.status})`);
      }

      // Create blob and download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = file.originalFileName.replace(/\.[^/.]+$/, '') + '.' + file.format;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the blob URL
      URL.revokeObjectURL(url);
      
      console.log(`[ConvertedFiles] Download completed for job ${file.jobId}`);
      
    } catch (err) {
      console.error(`[ConvertedFiles] Download failed for job ${file.jobId}:`, err);
      alert(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDownloadingFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(file.jobId);
        return newSet;
      });
    }
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Format date
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Converted Files</h3>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
          <span className="ml-3 text-gray-400">Loading converted files...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Converted Files</h3>
        <div className="text-center py-8">
          <div className="text-red-400 mb-4">⚠️ Error loading converted files</div>
          <p className="text-gray-400 mb-4">{error}</p>
          <button
            onClick={fetchConvertedFiles}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Converted Files</h3>
        <div className="text-center py-8">
          <div className="text-gray-400 mb-4">📁 No converted files</div>
          <p className="text-gray-500">Your converted audio files will appear here after conversion completes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Converted Files</h3>
        <button
          onClick={fetchConvertedFiles}
          className="text-purple-400 hover:text-purple-300 text-sm flex items-center gap-1"
          disabled={loading}
        >
          🔄 Refresh
        </button>
      </div>
      
      <div className="space-y-3">
        {files.map((file) => (
          <div
            key={file.jobId}
            className="bg-gray-700 rounded-lg p-4 flex items-center justify-between"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-white font-medium truncate">
                  {file.originalFileName}
                </span>
                <span className="text-xs bg-purple-600 text-white px-2 py-1 rounded">
                  {file.format.toUpperCase()}
                </span>
                <span className="text-xs bg-gray-600 text-gray-300 px-2 py-1 rounded">
                  {file.quality}
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-400">
                <span>{formatFileSize(file.size)}</span>
                <span>{formatDate(file.conversionDate)}</span>
              </div>
            </div>
            
            <button
              onClick={() => handleDownload(file)}
              disabled={downloadingFiles.has(file.jobId)}
              className="ml-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {downloadingFiles.has(file.jobId) ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Downloading...
                </>
              ) : (
                <>
                  ⬇️ Download
                </>
              )}
            </button>
          </div>
        ))}
      </div>
      
      {files.length > 0 && (
        <div className="mt-4 text-center text-sm text-gray-500">
          {files.length} converted file{files.length !== 1 ? 's' : ''} available
        </div>
      )}
    </div>
  );
}