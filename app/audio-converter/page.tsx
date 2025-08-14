"use client";

import React, { useState } from "react";
import AudioUpload from "../../components/audio/AudioUpload";
import AudioControls from "../../components/audio/AudioControls";
import AudioPreview from "../../components/audio/AudioPreview";
import FFmpegLogsViewer from "../../components/audio/FFmpegLogsViewer";

interface UploadedFile {
  fileId: string;
  fileName: string;
  size: number;
}

interface ConversionJob {
  jobId: string;
  status: string;
  format?: string;
  outputS3Location?: {
    bucket: string;
    key: string;
    size: number;
  };
}

export default function AudioConverter() {
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [conversionJob, setConversionJob] = useState<ConversionJob | null>(
    null
  );
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null);
  const [originalSize, setOriginalSize] = useState<number>(0);
  const [convertedSize, setConvertedSize] = useState<number>(0);
  const [format, setFormat] = useState<string>("mp3");
  const [quality, setQuality] = useState<string>("192k");
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [conversionProgress, setConversionProgress] = useState<number>(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<
    number | null
  >(null);
  const [phase, setPhase] = useState<
    "idle" | "uploading" | "converting" | "s3uploading" | "completed" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [currentStage, setCurrentStage] = useState<string>("");
  const [showFFmpegLogs, setShowFFmpegLogs] = useState<boolean>(false);

  const handleAudioUpload = async (file: File) => {
    // File size validation (frontend check)
    const MAX_FILE_SIZE = 105 * 1024 * 1024; // 105MB
    if (file.size > MAX_FILE_SIZE) {
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);
      setError(`File too large (${fileSizeMB}MB). Please select a file smaller than 105MB.`);
      setPhase("error");
      return;
    }

    setOriginalFile(file);
    setOriginalSize(file.size);
    setUploadedFile(null);
    setConversionJob(null);
    setConvertedUrl(null);
    setConvertedSize(0);
    setError(null);

    // Start upload immediately
    await uploadFile(file);
  };

  const handleFileSizeError = (fileSize: number, maxSize: number) => {
    const fileSizeMB = (fileSize / 1024 / 1024).toFixed(1);
    const maxSizeMB = (maxSize / 1024 / 1024).toFixed(0);
    setError(`File too large (${fileSizeMB}MB). Please select a file smaller than ${maxSizeMB}MB.`);
    setPhase("error");
  };

  const uploadFile = async (file: File): Promise<void> => {
    setIsUploading(true);
    setPhase("uploading");
    setUploadProgress(0);
    setError(null);

    // Generate a unique fileId for progress tracking (browser-compatible)
    const generateUUID = () => {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
        /[xy]/g,
        function (c) {
          const r = (Math.random() * 16) | 0;
          const v = c == "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        }
      );
    };
    const fileId = `${Date.now()}-${generateUUID()}`;
    let progressInterval: NodeJS.Timeout | null = null;

    // Progress polling setup for large files (>5MB)
    let initialDelayTimeout: NodeJS.Timeout | null = null;
    let isPollingActive = true;

    const cleanupProgressPolling = () => {
      console.log("[Upload Progress] Cleaning up progress polling");
      isPollingActive = false;
      if (initialDelayTimeout) {
        clearTimeout(initialDelayTimeout);
        initialDelayTimeout = null;
        console.log("[Upload Progress] Cleared initial delay timeout");
      }
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
        console.log("[Upload Progress] Cleared progress interval");
      }
    };

    try {
      console.log(
        `[Upload] Starting upload for file: ${file.name} (${file.size} bytes) with fileId: ${fileId}`
      );

      if (file.size > 5 * 1024 * 1024) {
        let pollAttempts = 0;
        const maxPollAttempts = 3;

        const pollProgress = async () => {
          if (!isPollingActive) return;

          try {
            const progressResponse = await fetch(
              `/api/upload-progress?fileId=${fileId}`
            );
            if (progressResponse.ok) {
              const progressData = await progressResponse.json();
              console.log(
                `[Upload Progress] ${progressData.progress}% (${progressData.completedChunks}/${progressData.totalChunks} chunks)`
              );
              setUploadProgress(Math.min(progressData.progress, 99));
              pollAttempts = 0;
            } else if (progressResponse.status === 404) {
              console.log("[Upload Progress] Upload not started yet");
            } else {
              throw new Error(
                `Progress API returned ${progressResponse.status}`
              );
            }
          } catch (error) {
            pollAttempts++;
            console.warn(
              `[Upload Progress] Failed to fetch progress (attempt ${pollAttempts}/${maxPollAttempts}):`,
              error
            );

            if (pollAttempts >= maxPollAttempts) {
              console.warn(
                "[Upload Progress] Too many polling failures, stopping progress updates"
              );
              cleanupProgressPolling();
            }
          }
        };

        const startPolling = () => {
          if (!isPollingActive) return;
          console.log("[Upload Progress] Starting progress polling");
          progressInterval = setInterval(pollProgress, 750);
        };

        // Start polling after a delay
        initialDelayTimeout = setTimeout(startPolling, 1000);
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileId", fileId); // Pass the fileId to the backend

      const response = await fetch("/api/upload-audio", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Upload failed" }));
        throw new Error(
          errorData.error || `Upload failed with status ${response.status}`
        );
      }

      const result = await response.json();
      console.log(`[Upload] Upload completed:`, result);

      setUploadedFile({
        fileId: result.fileId,
        fileName: result.fileName,
        size: result.size,
      });
      setUploadProgress(100);
      setPhase("idle");

      console.log(`[Upload] File uploaded successfully: ${result.fileId}`);
    } catch (error) {
      console.error("[Upload] Upload failed:", error);
      setError(error instanceof Error ? error.message : "Upload failed");
      setPhase("error");
    } finally {
      // Clear progress polling
      cleanupProgressPolling();
      setIsUploading(false);
    }
  };

  const convertAudio = async () => {
    if (!uploadedFile) {
      setError("Please upload a file first");
      return;
    }

    console.log(
      "[Conversion] Starting conversion for fileId:",
      uploadedFile.fileId
    );

    setIsConverting(true);
    setPhase("converting");
    setConversionProgress(0);
    setError(null);

    let progressInterval: NodeJS.Timeout | null = null;

    try {
      // Start conversion job
      const conversionResponse = await fetch("/api/convert-audio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileId: uploadedFile.fileId,
          format,
          quality,
        }),
      });

      if (!conversionResponse.ok) {
        const errorData = await conversionResponse
          .json()
          .catch(() => ({ error: "Conversion failed" }));
        throw new Error(
          errorData.error ||
            `Conversion failed with status ${conversionResponse.status}`
        );
      }

      const conversionResult = await conversionResponse.json();
      const jobId = conversionResult.jobId;

      console.log("[Conversion] Job created:", jobId);

      setConversionJob({
        jobId,
        status: conversionResult.status,
        format: format,
      });

      // Start progress polling
      await startProgressPolling(jobId);
    } catch (error) {
      console.error("[Conversion] Conversion failed:", error);
      setError(error instanceof Error ? error.message : "Conversion failed");
      setPhase("error");
    } finally {
      if (progressInterval) {
        clearTimeout(progressInterval);
      }
      setIsConverting(false);
    }
  };

  const startProgressPolling = async (jobId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      let pollAttempts = 0;
      let pollDelay = 500; // Start with 500ms
      const maxPollDelay = 5000; // Max 5 seconds between polls
      const maxAttempts = 600; // 5 minutes max (600 * 500ms)

      const pollProgress = async () => {
        try {
          console.log(
            `[Progress] Polling progress for jobId: ${jobId}, attempt: ${
              pollAttempts + 1
            }`
          );

          const progressResponse = await fetch(`/api/progress?jobId=${jobId}`, {
            headers: {
              "Cache-Control": "no-cache",
            },
          });

          if (progressResponse.ok) {
            const data = await progressResponse.json();
            console.log("[Progress] Progress data received:", data);

            // Reset poll delay on successful response
            pollDelay = 500;
            pollAttempts = 0;

            // Handle 3-phase progress system
            if (data.phase) {
              switch (data.phase) {
                case 'upload':
                  setPhase('uploading');
                  setUploadProgress(data.progress || 0);
                  break;
                case 'conversion':
                  setPhase('converting');
                  setConversionProgress(data.progress || 0);
                  break;
                case 's3upload':
                  setPhase('s3uploading');
                  setConversionProgress(data.progress || 0); // Reuse conversion progress for S3 upload
                  break;
                case 'completed':
                  setPhase('completed');
                  setConversionProgress(100);
                  break;
              }
            } else {
              // Fallback for old single-phase system
              setConversionProgress(data.progress || 0);
            }
            
            // Update current stage for better user feedback
            if (data.stage) {
              setCurrentStage(data.stage);
            }

            if (data.estimatedTimeRemaining !== undefined) {
              setEstimatedTimeRemaining(data.estimatedTimeRemaining);
            }

            if (data.progress >= 100 && (data.stage === "completed" || data.phase === "completed")) {
              console.log(
                "[Progress] Conversion completed - showing results immediately"
              );
              setPhase("completed");

              // Get the converted file size from the progress data or fetch job details
              if (data.outputSize) {
                setConvertedSize(data.outputSize);
              } else {
                // Fetch job details to get the output size
                fetchJobDetails(jobId);
              }

              resolve();
              return;
            }

            // Handle failed jobs - stop polling
            if (data.progress < 0 || data.stage === "failed") {
              console.log(
                "[Progress] Job failed - stopping progress polling"
              );
              setPhase("error");
              setError(data.error || "Conversion failed");
              resolve();
              return;
            }

            // Handle large files that exceed estimated duration
            if (data.progress >= 99 && data.stage === "processing") {
              // Check if this is a large file taking longer than expected
              if (data.estimatedTimeRemaining === -1) {
                console.log(
                  "[Progress] Large file processing beyond estimated duration"
                );
                // Continue polling but don't get stuck - this is normal for large files
              } else {
                // If stuck at high progress for too long, check job status directly
                const stuckTime = Date.now() - (data.updatedAt || Date.now());
                if (stuckTime > 30000) {
                  // If stuck for more than 30 seconds
                  console.log(
                    "[Progress] Progress stuck at high percentage, checking job status directly"
                  );
                  try {
                    const jobResponse = await fetch(`/api/jobs/${jobId}`);
                    if (jobResponse.ok) {
                      const jobData = await jobResponse.json();
                      if (jobData.status === "completed") {
                        console.log(
                          "[Progress] Job is actually completed, showing results"
                        );
                        setPhase("completed");
                        if (jobData.outputS3Location?.size) {
                          setConvertedSize(jobData.outputS3Location.size);
                        }
                        resolve();
                        return;
                      }
                    }
                  } catch (error) {
                    console.error(
                      "[Progress] Failed to check job status:",
                      error
                    );
                  }
                }
              }
            }

            if (data.progress === -1 || data.stage === "failed") {
              console.log("[Progress] Conversion failed");
              setError(data.error || "Conversion failed");
              setPhase("error");
              reject(new Error(data.error || "Conversion failed"));
              return;
            }

            // Schedule next poll
            setTimeout(pollProgress, pollDelay);
          } else {
            console.error(
              "[Progress] Progress response not ok:",
              progressResponse.status
            );
            handlePollError();
          }
        } catch (err) {
          console.error("[Progress] Progress fetch error:", err);
          handlePollError();
        }
      };

      const handlePollError = () => {
        pollAttempts++;

        // If too many failures, stop polling
        if (pollAttempts > maxAttempts) {
          console.error("[Progress] Too many polling failures, stopping");
          setError("Connection lost during conversion");
          setPhase("error");
          reject(new Error("Connection lost during conversion"));
          return;
        }

        // Exponential backoff
        pollDelay = Math.min(pollDelay * 1.5, maxPollDelay);
        console.log(
          `[Progress] Retrying in ${pollDelay}ms (attempt ${pollAttempts})`
        );

        // Schedule retry
        setTimeout(pollProgress, pollDelay);
      };

      // Start polling immediately
      pollProgress();
    });
  };

  const fetchJobDetails = async (jobId: string) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (response.ok) {
        const jobData = await response.json();
        if (jobData.outputS3Location?.size) {
          setConvertedSize(jobData.outputS3Location.size);
        }
        // Update the conversion job with complete data
        setConversionJob((prev) =>
          prev
            ? {
                ...prev,
                outputS3Location: jobData.outputS3Location,
              }
            : null
        );
      }
    } catch (error) {
      console.error("[Job Details] Failed to fetch job details:", error);
    }
  };

  const handleDownload = async () => {
    if (!conversionJob || !originalFile) {
      console.error("[Download] Missing conversion job or original file");
      return;
    }

    try {
      console.log("[Download] Requesting presigned URL for download");
      setError(null); // Clear any previous errors
      setIsDownloading(true);

      // Create the desired filename based on original file
      const nameWithoutExt = originalFile.name.replace(/\.[^/.]+$/, "");
      const desiredFilename = `${nameWithoutExt}.${
        conversionJob.format || format
      }`;

      const response = await fetch(
        `/api/download?jobId=${
          conversionJob.jobId
        }&presigned=true&filename=${encodeURIComponent(desiredFilename)}`
      );

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Download failed" }));
        throw new Error(
          errorData.error || `Download failed with status ${response.status}`
        );
      }

      const { presignedUrl, filename } = await response.json();

      console.log("[Download] Got presigned URL, initiating download");

      // Try direct presigned URL first (fastest method)
      console.log("[Download] Attempting direct presigned URL download");
      const link = document.createElement("a");
      link.href = presignedUrl;
      link.download = filename;

      // For better compatibility, add the link to DOM temporarily
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      console.log("[Download] Direct download initiated successfully");
    } catch (error) {
      console.error("[Download] Download failed:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to download converted audio"
      );
    } finally {
      // Reset downloading state after a short delay to give user feedback
      setTimeout(() => setIsDownloading(false), 1000);
    }
  };

  const handleBackToUpload = () => {
    setOriginalFile(null);
    setUploadedFile(null);
    setConversionJob(null);
    setConvertedUrl(null);
    setOriginalSize(0);
    setConvertedSize(0);
    setUploadProgress(0);
    setConversionProgress(0);
    setEstimatedTimeRemaining(null);
    setPhase("idle");
    setError(null);
    setCurrentStage("");
  };

  return (
    <main className="max-w-7xl mx-auto p-4">
      {!originalFile ? (
        <>
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-white mb-4">
              Convert Audio <span className="text-purple-400">Files</span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
              Convert between audio formats while maintaining quality. Perfect
              for compatibility and optimization.
            </p>
          </div>

          <AudioUpload
            onAudioUpload={handleAudioUpload}
            onFileSizeError={handleFileSizeError}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
          />

          <div className="grid md:grid-cols-3 gap-6 mt-12">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
              <div className="text-3xl mb-3">🎧</div>
              <h3 className="text-lg font-semibold text-white mb-2">
                Multiple Formats
              </h3>
              <p className="text-gray-400">
                Convert between MP3, WAV, FLAC, AAC, and OGG formats.
              </p>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
              <div className="text-3xl mb-3">⚡</div>
              <h3 className="text-lg font-semibold text-white mb-2">
                Fast Processing
              </h3>
              <p className="text-gray-400">
                Chunked upload for large files with real-time progress tracking.
              </p>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
              <div className="text-3xl mb-3">📁</div>
              <h3 className="text-lg font-semibold text-white mb-2">
                Large Files
              </h3>
              <p className="text-gray-400">
                Support for audio files up to 105MB with reliable conversion.
              </p>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mb-4">
            <button
              onClick={handleBackToUpload}
              className="text-purple-400 hover:text-purple-300 flex items-center gap-2"
            >
              ← Back to Upload
            </button>
          </div>

          <AudioControls
            format={format}
            quality={quality}
            onFormatChange={setFormat}
            onQualityChange={setQuality}
            onConvert={convertAudio}
            isUploading={isUploading}
            isConverting={isConverting}
            uploadProgress={uploadProgress}
            conversionProgress={conversionProgress}
            estimatedTimeRemaining={estimatedTimeRemaining}
            phase={phase}
            uploadedFile={uploadedFile}
            conversionJob={conversionJob}
            error={error}
            currentStage={currentStage}
          />

          <AudioPreview
            originalFile={originalFile}
            convertedUrl={convertedUrl}
            originalSize={originalSize}
            convertedSize={convertedSize}
            onDownload={handleDownload}
            isCompleted={phase === "completed"}
            conversionJob={conversionJob}
            isDownloading={isDownloading}
          />

          {/* FFmpeg Logs Button - Show when converting or completed */}
          {(phase === "converting" || phase === "s3uploading" || phase === "completed") && conversionJob && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setShowFFmpegLogs(true)}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
              >
                📋 View FFmpeg Logs
              </button>
            </div>
          )}

          {/* FFmpeg Logs Viewer Modal */}
          {conversionJob && (
            <FFmpegLogsViewer
              jobId={conversionJob.jobId}
              isVisible={showFFmpegLogs}
              onClose={() => setShowFFmpegLogs(false)}
            />
          )}
        </>
      )}
    </main>
  );
}
