import { useState } from "react";

interface AudioPreviewProps {
  originalFile: File | null;
  convertedUrl: string | null;
  originalSize: number;
  convertedSize: number;
  onDownload: () => void;
  isCompleted?: boolean;
  conversionJob?: any;
  isDownloading?: boolean;
}

interface AudioPlayerProps {
  conversionJob?: any;
  convertedUrl?: string | null;
  isCompleted?: boolean;
}

function AudioPlayer({
  conversionJob,
  convertedUrl,
  isCompleted,
}: AudioPlayerProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const loadPreview = () => {
    if (!conversionJob?.jobId || previewUrl) return;

    // Use the streaming endpoint for preview (no CORS issues)
    const streamingUrl = `/api/download?jobId=${conversionJob.jobId}`;
    setPreviewUrl(streamingUrl);
  };

  if (convertedUrl) {
    return (
      <audio controls className="w-full">
        <source src={convertedUrl} />
      </audio>
    );
  }

  if (isCompleted && conversionJob) {
    return (
      <div className="space-y-3">
        {previewUrl ? (
          <audio controls className="w-full">
            <source src={previewUrl} />
          </audio>
        ) : (
          <button
            onClick={loadPreview}
            className="w-full bg-gray-700 hover:bg-gray-600 px-4 py-3 rounded-lg font-medium transition-colors text-sm"
          >
            🎵 Load Audio Preview
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-gray-700 rounded-lg p-4 text-center text-gray-400">
      Audio preview will appear here after conversion
    </div>
  );
}

export default function AudioPreview({
  originalFile,
  convertedUrl,
  originalSize,
  convertedSize,
  onDownload,
  isCompleted = false,
  conversionJob,
  isDownloading = false,
}: AudioPreviewProps) {
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const compressionRatio =
    originalSize > 0
      ? (((originalSize - convertedSize) / originalSize) * 100).toFixed(1)
      : "0";

  return (
    <div className="grid md:grid-cols-2 gap-6 mt-6">
      {/* Original Audio */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4">Original</h3>
        {originalFile && (
          <>
            <div className="mb-4">
              <audio controls className="w-full">
                <source
                  src={URL.createObjectURL(originalFile)}
                  type={originalFile.type}
                />
              </audio>
            </div>
            <div className="space-y-2 text-sm text-gray-300">
              <p>
                <strong>Name:</strong> {originalFile.name}
              </p>
              <p>
                <strong>Size:</strong> {formatFileSize(originalSize)}
              </p>
              <p>
                <strong>Type:</strong> {originalFile.type}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Converted Audio */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4">Converted</h3>
        {isCompleted || convertedUrl ? (
          <>
            <div className="mb-4">
              <AudioPlayer
                conversionJob={conversionJob}
                convertedUrl={convertedUrl}
                isCompleted={isCompleted}
              />
            </div>

            <div className="space-y-2 text-sm text-gray-300 mb-4">
              <p>
                <strong>Status:</strong>{" "}
                <span className="text-green-400">✓ Conversion Complete</span>
              </p>
              {convertedSize > 0 && (
                <>
                  <p>
                    <strong>Size:</strong> {formatFileSize(convertedSize)}
                  </p>
                  <p>
                    <strong>Reduction:</strong> {compressionRatio}%
                  </p>
                </>
              )}
              {conversionJob && (
                <p>
                  <strong>Format:</strong> {conversionJob.format.toUpperCase()}
                </p>
              )}
            </div>

            <button
              onClick={onDownload}
              disabled={isDownloading}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:cursor-not-allowed px-4 py-2 rounded-lg font-medium transition-colors"
            >
              {isDownloading ? "Preparing Download..." : "Download Converted Audio"}
            </button>

            {!convertedUrl && (
              <p className="text-xs text-gray-400 mt-2 text-center">
                Click download to get your converted file directly from cloud
                storage
              </p>
            )}
          </>
        ) : (
          <div className="text-center text-gray-400 py-8">
            <p>Converted audio will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}
