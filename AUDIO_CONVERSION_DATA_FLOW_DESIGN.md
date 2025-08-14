# Audio Conversion App - Complete Data Flow & Design Architecture

## 🎯 Overview

This document provides a comprehensive visual representation of the audio conversion application's data flow, architecture, and design using Mermaid diagrams.

## 🏗️ System Architecture

```mermaid
graph LR
    subgraph "Frontend Layer"
        UI[Audio Upload UI]
        Controls[Audio Controls]
        Preview[Audio Preview]
        Progress[Progress Display]
    end
    
    subgraph "API Layer"
        UploadAPI[Upload Audio API]
        ConvertAPI[Convert Audio API]
        ProgressAPI[Progress API]
        DownloadAPI[Download API]
    end
    
    subgraph "Service Layer"
        SmartTemp[Smart Temp Files Service]
        S3Upload[S3 Upload Service]
        JobService[Job Service]
        ProgressService[Progress Service]
    end
    
    subgraph "Processing Layer"
        FFmpeg[FFmpeg Process]
        TempFiles[/tmp/ Directory]
    end
    
    subgraph "Storage Layer"
        S3[(AWS S3)]
        DynamoDB[(DynamoDB)]
        Uploads[S3: uploads/]
        Conversions[S3: conversions/]
    end
    
    UI --> UploadAPI
    Controls --> ConvertAPI
    Progress --> ProgressAPI
    Preview --> DownloadAPI
    
    UploadAPI --> S3Upload
    ConvertAPI --> SmartTemp
    ProgressAPI --> ProgressService
    DownloadAPI --> S3
    
    SmartTemp --> FFmpeg
    SmartTemp --> TempFiles
    SmartTemp --> S3Upload
    
    S3Upload --> S3
    JobService --> DynamoDB
    ProgressService --> DynamoDB
    
    S3 --> Uploads
    S3 --> Conversions
```

## 📊 Complete Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant UploadAPI
    participant S3
    participant ConvertAPI
    participant SmartTemp
    participant FFmpeg
    participant TempFiles
    participant ProgressAPI
    participant DynamoDB
    participant DownloadAPI
    
    Note over User, DownloadAPI: Phase 1: File Upload
    User->>Frontend: Select audio file (≤105MB)
    Frontend->>Frontend: Validate file size
    Frontend->>UploadAPI: POST /api/upload-audio
    UploadAPI->>UploadAPI: Validate file (105MB limit)
    UploadAPI->>S3: Stream upload to uploads/
    S3-->>UploadAPI: Upload complete
    UploadAPI-->>Frontend: Return fileId
    Frontend-->>User: Show upload success
    
    Note over User, DownloadAPI: Phase 2: Conversion Request
    User->>Frontend: Click "Convert Audio"
    Frontend->>ConvertAPI: POST /api/convert-audio
    ConvertAPI->>ConvertAPI: Validate file size (105MB)
    ConvertAPI->>DynamoDB: Create job record
    ConvertAPI->>DynamoDB: Initialize progress
    ConvertAPI-->>Frontend: Return jobId (202 Accepted)
    
    Note over User, DownloadAPI: Phase 3: Background Conversion
    ConvertAPI->>SmartTemp: Start conversion process
    SmartTemp->>S3: Stream download to temp file
    S3-->>TempFiles: /tmp/jobId-input.ext
    SmartTemp->>ProgressAPI: Update progress (Phase 2: Download)
    
    SmartTemp->>FFmpeg: Convert temp file to temp file
    FFmpeg-->>TempFiles: /tmp/jobId-output.ext
    SmartTemp->>ProgressAPI: Update progress (Phase 2: Convert)
    
    SmartTemp->>S3: Stream upload from temp file
    TempFiles-->>S3: conversions/jobId.ext
    SmartTemp->>ProgressAPI: Update progress (Phase 3: Upload)
    
    SmartTemp->>TempFiles: Cleanup temp files
    SmartTemp->>DynamoDB: Mark job complete
    SmartTemp->>ProgressAPI: Mark progress complete
    
    Note over User, DownloadAPI: Phase 4: Download
    Frontend->>ProgressAPI: Poll progress
    ProgressAPI->>DynamoDB: Get progress data
    DynamoDB-->>ProgressAPI: Progress: 100%
    ProgressAPI-->>Frontend: Conversion complete
    Frontend-->>User: Show download button
    
    User->>Frontend: Click download
    Frontend->>DownloadAPI: GET /api/download
    DownloadAPI->>S3: Generate presigned URL
    S3-->>DownloadAPI: Presigned URL
    DownloadAPI-->>Frontend: Return download URL
    Frontend-->>User: Trigger download
```

## 🔄 Smart Temporary Files Flow

```mermaid
flowchart TD
    Start([Conversion Request]) --> Validate{File Size ≤ 105MB?}
    
    Validate -->|No| Error[Return 413 Error]
    Validate -->|Yes| CreateJob[Create Job in DynamoDB]
    
    CreateJob --> InitProgress[Initialize Progress Tracking]
    InitProgress --> StartConversion[Start Background Conversion]
    
    StartConversion --> Phase1[Phase 1: S3 → Temp File]
    Phase1 --> Download[Stream S3 to /tmp/jobId-input.ext]
    Download --> UpdateP1[Update Progress: Downloading]
    
    UpdateP1 --> Phase2[Phase 2: FFmpeg Conversion]
    Phase2 --> FFmpegConvert[FFmpeg: input.ext → output.ext]
    FFmpegConvert --> UpdateP2[Update Progress: Converting]
    
    UpdateP2 --> Phase3[Phase 3: Temp File → S3]
    Phase3 --> Upload[Stream /tmp/jobId-output.ext → S3]
    Upload --> UpdateP3[Update Progress: Uploading]
    
    UpdateP3 --> Cleanup[Delete Temp Files]
    Cleanup --> Complete[Mark Job Complete]
    Complete --> End([Conversion Complete])
    
    Error --> End
    
    style Phase1 fill:#e1f5fe
    style Phase2 fill:#f3e5f5
    style Phase3 fill:#e8f5e8
    style Cleanup fill:#fff3e0
```

## 📱 Frontend Component Architecture

```mermaid
graph TB
    subgraph "Audio Converter Page"
        Page[audio-converter/page.tsx]
        
        subgraph "Upload Phase"
            AudioUpload[AudioUpload Component]
            FileValidation[File Size Validation]
            UploadProgress[Upload Progress Bar]
        end
        
        subgraph "Conversion Phase"
            AudioControls[AudioControls Component]
            FormatSelector[Format Selection]
            QualitySelector[Quality Selection]
            ConvertButton[Convert Button]
        end
        
        subgraph "Progress Phase"
            ProgressDisplay[3-Phase Progress Display]
            SubPhaseText[Sub-phase Information]
            UploadSpeed[Upload Speed Display]
            TimeRemaining[Time Remaining]
        end
        
        subgraph "Download Phase"
            AudioPreview[AudioPreview Component]
            DownloadButton[Download Button]
            FileInfo[File Size Comparison]
        end
    end
    
    Page --> AudioUpload
    Page --> AudioControls
    Page --> ProgressDisplay
    Page --> AudioPreview
    
    AudioUpload --> FileValidation
    AudioUpload --> UploadProgress
    
    AudioControls --> FormatSelector
    AudioControls --> QualitySelector
    AudioControls --> ConvertButton
    
    ProgressDisplay --> SubPhaseText
    ProgressDisplay --> UploadSpeed
    ProgressDisplay --> TimeRemaining
    
    AudioPreview --> DownloadButton
    AudioPreview --> FileInfo
```

## 🗄️ Database Schema & Relationships

```mermaid
erDiagram
    JOBS {
        string jobId PK
        string status
        object inputS3Location
        object outputS3Location
        string format
        string quality
        string error
        number createdAt
        number updatedAt
        number ttl
    }
    
    PROGRESS {
        string jobId PK
        number progress
        string stage
        string phase
        number estimatedTimeRemaining
        string error
        number startTime
        string currentTime
        string totalDuration
        number uploadedSize
        number totalSize
        array ffmpegLogs
        number ttl
        number updatedAt
    }
    
    UPLOADS {
        string fileId PK
        string fileName
        number totalSize
        number uploadedSize
        number totalChunks
        number completedChunks
        string stage
        string uploadId
        string s3Key
        string bucketName
        array parts
        number ttl
        number updatedAt
    }
    
    JOBS ||--|| PROGRESS : "tracks"
    JOBS ||--o{ UPLOADS : "references"
```

## 🔧 Service Layer Architecture

```mermaid
classDiagram
    class SmartTempFilesConversionService {
        +convertAudio(job, options)
        +streamS3ToTempFile(s3Location, tempPath, jobId)
        +convertWithFFmpeg(inputPath, outputPath, jobId, options)
        +streamTempFileToS3(tempPath, outputKey, bucket, jobId)
        +cleanupTempFiles(tempPaths)
        -createFFmpegProcessForFiles(inputPath, outputPath, options)
        -setupProgressMonitoring(jobId, process, processInfo)
    }
    
    class S3UploadService {
        +uploadWithProgress(options)
        -singleUpload(options, fileSize)
        -multipartUpload(options, fileSize, chunkSize)
        -formatBytes(bytes)
    }
    
    class ProgressService {
        +initializeProgress(jobId)
        +setProgress(jobId, progressData)
        +getProgress(jobId)
        +markComplete(jobId)
        +markFailed(jobId, error)
        +startConversionPhase(jobId)
        +startS3UploadPhase(jobId)
        +updateS3UploadProgress(jobId, uploaded, total)
        +processFFmpegStderr(jobId, stderrLine, processInfo)
    }
    
    class JobService {
        +createJob(jobData)
        +getJob(jobId)
        +updateJobStatus(jobId, status, outputLocation, error)
        +listJobs(filters)
        +deleteJob(jobId)
    }
    
    SmartTempFilesConversionService --> S3UploadService
    SmartTempFilesConversionService --> ProgressService
    SmartTempFilesConversionService --> JobService
```

## 📊 Progress Tracking System

```mermaid
stateDiagram-v2
    [*] --> Initialized: Create Job
    
    Initialized --> Phase1_Upload: Start Upload
    Phase1_Upload --> Phase1_Complete: Upload Done
    
    Phase1_Complete --> Phase2_Download: Start Conversion
    Phase2_Download --> Phase2_Converting: S3 → Temp File
    Phase2_Converting --> Phase2_Complete: FFmpeg Done
    
    Phase2_Complete --> Phase3_Upload: Start S3 Upload
    Phase3_Upload --> Phase3_Complete: Temp → S3 Done
    
    Phase3_Complete --> Completed: Mark Complete
    Phase3_Complete --> Cleanup: Delete Temp Files
    Cleanup --> Completed
    
    Initialized --> Failed: Validation Error
    Phase1_Upload --> Failed: Upload Error
    Phase2_Download --> Failed: Download Error
    Phase2_Converting --> Failed: FFmpeg Error
    Phase3_Upload --> Failed: S3 Upload Error
    
    Failed --> Cleanup: Error Cleanup
    
    Completed --> [*]
    Failed --> [*]
```

## 🔒 File Size Validation Flow

```mermaid
flowchart TD
    FileSelect[User Selects File] --> FrontendCheck{Frontend: Size ≤ 105MB?}
    
    FrontendCheck -->|No| FrontendError[Show Error: File too large]
    FrontendCheck -->|Yes| UploadAttempt[Attempt Upload]
    
    UploadAttempt --> UploadAPICheck{Upload API: Size ≤ 105MB?}
    UploadAPICheck -->|No| UploadError[Return 400: File too large]
    UploadAPICheck -->|Yes| S3Upload[Upload to S3]
    
    S3Upload --> ConvertRequest[User Requests Conversion]
    ConvertRequest --> ConvertAPICheck{Convert API: Size ≤ 105MB?}
    
    ConvertAPICheck -->|No| ConvertError[Return 413: File too large]
    ConvertAPICheck -->|Yes| StartConversion[Start Conversion Process]
    
    StartConversion --> ConversionCheck{Conversion Service: Size ≤ 105MB?}
    ConversionCheck -->|No| ConversionError[Mark Job Failed]
    ConversionCheck -->|Yes| ProcessFile[Process File Successfully]
    
    FrontendError --> End[End]
    UploadError --> End
    ConvertError --> End
    ConversionError --> End
    ProcessFile --> Success[Conversion Success]
    Success --> End
    
    style FrontendCheck fill:#e3f2fd
    style UploadAPICheck fill:#e8f5e8
    style ConvertAPICheck fill:#fff3e0
    style ConversionCheck fill:#fce4ec
```

## 💾 Memory Usage Optimization

```mermaid
graph LR
    subgraph "Before: Memory Buffers"
        OldS3[S3 Object] --> OldBuffer[Memory Buffer<br/>~300MB for 100MB file]
        OldBuffer --> OldFFmpeg[FFmpeg Process]
        OldFFmpeg --> OldBuffer2[Memory Buffer<br/>~300MB output]
        OldBuffer2 --> OldS3Out[S3 Upload]
    end
    
    subgraph "After: Smart Temp Files"
        NewS3[S3 Object] --> NewTemp1[Temp File<br/>/tmp/input.ext]
        NewTemp1 --> NewFFmpeg[FFmpeg Process<br/>File → File]
        NewFFmpeg --> NewTemp2[Temp File<br/>/tmp/output.ext]
        NewTemp2 --> NewS3Out[S3 Upload<br/>Stream from file]
        NewTemp2 --> Cleanup[Auto Cleanup]
    end
    
    subgraph "Memory Usage"
        OldMem[Old: ~300MB RAM<br/>Scales with file size]
        NewMem[New: ~30-50MB RAM<br/>Constant usage]
    end
    
    OldBuffer -.-> OldMem
    NewTemp1 -.-> NewMem
    
    style OldBuffer fill:#ffcdd2
    style OldBuffer2 fill:#ffcdd2
    style NewTemp1 fill:#c8e6c9
    style NewTemp2 fill:#c8e6c9
    style OldMem fill:#ffcdd2
    style NewMem fill:#c8e6c9
```

## 🔧 Backend Architecture (Horizontal Layout)

```mermaid
graph LR
    subgraph "API Gateway Layer"
        direction LR
        UploadRoute["/api/upload-audio"]
        ConvertRoute["/api/convert-audio"]
        ProgressRoute["/api/progress"]
        DownloadRoute["/api/download"]
        CleanupRoute["/api/cleanup"]
    end
    
    subgraph "Business Logic Layer"
        direction LR
        FileValidation[File Validation<br/>105MB Limit]
        JobOrchestration[Job Orchestration]
        ConversionEngine[Conversion Engine]
        ProgressTracking[Progress Tracking]
        ErrorHandling[Error Handling]
    end
    
    subgraph "Service Layer"
        direction LR
        SmartTempService[Smart Temp Files<br/>Service]
        S3UploadService[S3 Upload<br/>Service]
        JobService[Job<br/>Service]
        ProgressService[Progress<br/>Service]
        FFmpegParser[FFmpeg Progress<br/>Parser]
    end
    
    subgraph "Processing Layer"
        direction LR
        TempFileManager[Temp File<br/>Manager]
        FFmpegProcess[FFmpeg<br/>Process]
        StreamProcessor[Stream<br/>Processor]
        FileCleanup[File<br/>Cleanup]
    end
    
    subgraph "Data Layer"
        direction LR
        S3Storage[(S3 Storage<br/>uploads/ & conversions/)]
        DynamoJobs[(DynamoDB<br/>Jobs Table)]
        DynamoProgress[(DynamoDB<br/>Progress Table)]
        DynamoUploads[(DynamoDB<br/>Uploads Table)]
        TempStorage[(/tmp/<br/>Temporary Files)]
    end
    
    UploadRoute --> FileValidation
    ConvertRoute --> JobOrchestration
    ProgressRoute --> ProgressTracking
    DownloadRoute --> S3Storage
    CleanupRoute --> ErrorHandling
    
    FileValidation --> S3UploadService
    JobOrchestration --> ConversionEngine
    ConversionEngine --> SmartTempService
    ProgressTracking --> ProgressService
    ErrorHandling --> JobService
    
    SmartTempService --> TempFileManager
    SmartTempService --> FFmpegProcess
    SmartTempService --> StreamProcessor
    S3UploadService --> StreamProcessor
    JobService --> DynamoJobs
    ProgressService --> DynamoProgress
    ProgressService --> DynamoUploads
    
    TempFileManager --> TempStorage
    FFmpegProcess --> TempStorage
    StreamProcessor --> S3Storage
    FileCleanup --> TempStorage
    
    style UploadRoute fill:#e3f2fd
    style ConvertRoute fill:#e3f2fd
    style ProgressRoute fill:#e3f2fd
    style DownloadRoute fill:#e3f2fd
    style SmartTempService fill:#e8f5e8
    style S3Storage fill:#fff3e0
    style DynamoJobs fill:#fff3e0
    style TempStorage fill:#fce4ec
```

## 🚀 Deployment Architecture

```mermaid
graph LR
    subgraph "Client Layer"
        User[Users]
        CDN[CloudFront CDN<br/>(Optional)]
    end
    
    subgraph "Application Layer"
        AppRunner[AWS App Runner<br/>Next.js Application]
        Lambda[Lambda Functions<br/>(Optional)]
    end
    
    subgraph "Storage Layer"
        S3Bucket[S3 Bucket<br/>uploads/ & conversions/]
        DynamoTables[DynamoDB Tables<br/>jobs, progress, uploads]
    end
    
    subgraph "Monitoring Layer"
        CloudWatch[CloudWatch Logs]
        Metrics[CloudWatch Metrics]
    end
    
    User --> CDN
    CDN --> AppRunner
    User -.-> AppRunner
    
    AppRunner --> S3Bucket
    AppRunner --> DynamoTables
    AppRunner --> CloudWatch
    AppRunner --> Metrics
    
    style AppRunner fill:#e3f2fd
    style S3Bucket fill:#e8f5e8
    style DynamoTables fill:#fff3e0
```

## 🔄 Error Handling & Recovery

```mermaid
flowchart TD
    Start[Process Start] --> TryOperation{Try Operation}
    
    TryOperation -->|Success| Success[Operation Success]
    TryOperation -->|Error| ErrorType{Error Type}
    
    ErrorType -->|File Size| FileSizeError[File Too Large<br/>Return 413]
    ErrorType -->|Network| NetworkError[Network Issue<br/>Retry with Backoff]
    ErrorType -->|FFmpeg| FFmpegError[Conversion Failed<br/>Mark Job Failed]
    ErrorType -->|S3| S3Error[S3 Issue<br/>Retry Operation]
    ErrorType -->|System| SystemError[System Error<br/>Log & Cleanup]
    
    NetworkError --> RetryCount{Retry < 3?}
    S3Error --> RetryCount
    
    RetryCount -->|Yes| Wait[Wait with Backoff]
    RetryCount -->|No| GiveUp[Mark as Failed]
    
    Wait --> TryOperation
    
    FileSizeError --> Cleanup[Cleanup Resources]
    FFmpegError --> Cleanup
    GiveUp --> Cleanup
    SystemError --> Cleanup
    
    Cleanup --> UpdateProgress[Update Progress: Failed]
    UpdateProgress --> NotifyUser[Notify User of Error]
    
    Success --> End[End Success]
    NotifyUser --> End
    
    style FileSizeError fill:#ffcdd2
    style FFmpegError fill:#ffcdd2
    style GiveUp fill:#ffcdd2
    style Success fill:#c8e6c9
```

## 📈 Performance Metrics

```mermaid
graph LR
    subgraph "Key Metrics"
        Memory[Memory Usage<br/>~30-50MB constant]
        CPU[CPU Usage<br/>Moderate during FFmpeg]
        Disk[Disk I/O<br/>2x file size temp]
        Network[Network<br/>S3 upload/download]
    end
    
    subgraph "Performance Targets"
        MemTarget[Memory: < 100MB]
        CPUTarget[CPU: < 80% during conversion]
        DiskTarget[Disk: < 500MB temp space]
        TimeTarget[Time: < 5min for 100MB file]
    end
    
    Memory --> MemTarget
    CPU --> CPUTarget
    Disk --> DiskTarget
    Network --> TimeTarget
    
    style Memory fill:#c8e6c9
    style MemTarget fill:#c8e6c9
```

---

## 🎯 Summary

This comprehensive data flow and design document illustrates:

- **Complete system architecture** with all components and their relationships
- **Detailed data flow** from file upload to download
- **Smart temporary files implementation** that eliminates memory bottlenecks
- **3-phase progress tracking** system
- **File size validation** at multiple levels
- **Error handling and recovery** mechanisms
- **Memory optimization** strategy
- **Production deployment** architecture

The system is designed to be **compute-intensive rather than memory-intensive**, providing reliable audio conversion for files up to 105MB while maintaining constant memory usage regardless of file size.