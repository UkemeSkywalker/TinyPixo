"use client";

import React, { useState } from "react";
import AudioUpload from "../../components/audio/AudioUpload";
import AudioControls from "../../components/audio/AudioControls";
import AudioPreview from "../../components/audio/AudioPreview";


interface UploadedFile {
  fileId: string;
  fileName: string;
  size: number;
}

interface ConversionJob {
  jobId: string;
  status: string;
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
    "idle" | "uploading" | "converting" | "completed" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);


  const handleAudioUpload = async (file: File) => {
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

  const uploadFile = async (file: File): Promise<void> => {
    setIsUploading(true);
    setPhase("uploading");
    setUploadProgress(0);
    setError(null);

    // Generate a unique fileId for progress tracking (browser-compatible)
    const generateUUID = () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
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

            setConversionProgress(data.progress || 0);

            if (data.estimatedTimeRemaining !== undefined) {
              setEstimatedTimeRemaining(data.estimatedTimeRemaining);
            }

            if (data.progress >= 100 && data.stage === "completed") {
              console.log("[Progress] Conversion completed");
              setPhase("completed");
              await downloadConvertedFile(jobId);

              resolve();
              return;
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

  const downloadConvertedFile = async (jobId: string): Promise<void> => {
    const maxRetries = 8;
    const baseRetryDelay = 500; // Start with 500ms

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `[Download] Starting download for jobId: ${jobId} (attempt ${attempt}/${maxRetries})`
        );

        const downloadResponse = await fetch(`/api/download?jobId=${jobId}`);

        if (downloadResponse.ok) {
          const blob = await downloadResponse.blob();
          console.log("[Download] Downloaded file size:", blob.size);

          const url = URL.createObjectURL(blob);
          setConvertedUrl(url);
          setConvertedSize(blob.size);

          console.log("[Download] Converted audio ready for download");
          return; // Success, exit the retry loop
        }

        const errorData = await downloadResponse
          .json()
          .catch(() => ({ error: "Download failed" }));

        // Calculate retry delay for this attempt
        const retryDelay =
          Math.min(baseRetryDelay * Math.pow(1.5, attempt - 1), 3000) +
          Math.random() * 200;

        // If it's a "not completed yet" error and we have retries left, wait and retry
        if (
          downloadResponse.status === 400 &&
          errorData.error?.includes("not completed yet") &&
          attempt < maxRetries
        ) {
          console.log(
            `[Download] Job not ready yet, retrying in ${Math.round(
              retryDelay
            )}ms (attempt ${attempt}/${maxRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }

        // For other errors or if we've exhausted retries, throw the error
        throw new Error(
          errorData.error ||
            `Download failed with status ${downloadResponse.status}`
        );
      } catch (error) {
        if (attempt === maxRetries) {
          console.error("[Download] Download failed after all retries:", error);
          setError(
            error instanceof Error
              ? error.message
              : "Failed to download converted audio"
          );
          setPhase("error");
          return;
        }

        // Calculate retry delay for error handling
        const retryDelay =
          Math.min(baseRetryDelay * Math.pow(1.5, attempt - 1), 3000) +
          Math.random() * 200;

        // If it's not the last attempt and it's a network error, retry
        if (
          error instanceof Error &&
          error.message.includes("not completed yet")
        ) {
          console.log(
            `[Download] Retrying download in ${Math.round(
              retryDelay
            )}ms (attempt ${attempt}/${maxRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }

        // For other errors, don't retry
        console.error("[Download] Download failed:", error);
        setError(
          error instanceof Error
            ? error.message
            : "Failed to download converted audio"
        );
        setPhase("error");
        return;
      }
    }
  };

  const handleDownload = () => {
    if (convertedUrl && originalFile) {
      const nameWithoutExt = originalFile.name.replace(/\.[^/.]+$/, "");
      const link = document.createElement("a");
      link.href = convertedUrl;
      link.download = `${nameWithoutExt}.${format}`;
      link.click();
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
                Support for audio files up to 500MB with reliable upload.
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
          />

          <AudioPreview
            originalFile={originalFile}
            convertedUrl={convertedUrl}
            originalSize={originalSize}
            convertedSize={convertedSize}
            onDownload={handleDownload}
          />


        </>
      )}


    </main>
  );
}
