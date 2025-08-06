# Requirements Document

## Introduction

The audio converter application works correctly in local development and Docker environments but fails when deployed to AWS App Runner due to specific architectural issues identified through production debugging:

1. **Container Restart Data Loss**: App Runner automatically scales/restarts containers during conversion, wiping out `global.conversionProgress` in-memory state
2. **Progress Loop (95% → 0%)**: After conversion completes at 95%, container restarts cause progress API to return 0%, creating infinite polling loops
3. **Download Failures**: `ERR_CONTENT_LENGTH_MISMATCH` errors occur because converted files stored in memory are lost during container lifecycle events
4. **Large File Memory Issues**: Files 33MB-200MB cause memory pressure leading to container restarts and data loss
5. **Architecture Mismatch**: Current system tries to return files directly while also supporting job-based downloads, creating inconsistent behavior

**Root Cause**: The current architecture uses in-memory storage (`global.conversionProgress`) and temporary file storage that doesn't survive App Runner's container lifecycle management.

**Solution**: Implement persistent storage using S3 (files) + DynamoDB (job metadata) + Redis (real-time progress) to create a truly stateless, container-restart-resilient system.

## Requirements

### Requirement 1: Streaming-Based Decoupled Architecture (Experimental)

**User Story:** As a user converting audio files on AWS App Runner, I want upload and conversion to use streaming architecture that eliminates local file storage, so that I can reliably process large files without memory pressure or container restart issues.

#### Acceptance Criteria

1. WHEN a user uploads an audio file THEN the system SHALL store the original file in S3 and return immediately with a file reference
2. WHEN a user starts conversion THEN the system SHALL create a separate conversion job that references the uploaded S3 file
3. WHEN conversion is initiated THEN the system SHALL store job metadata in DynamoDB with TTL for automatic cleanup
4. WHEN FFmpeg processes audio files THEN the system SHALL stream directly from S3 input to S3 output without local file storage
5. WHEN streaming conversion encounters compatibility issues THEN the system SHALL provide fallback to local file processing with proper resource management
6. WHEN App Runner containers restart during conversion THEN the system SHALL retrieve job state from DynamoDB and restart streaming conversion from the beginning
7. WHEN conversion completes THEN the system SHALL update job status in DynamoDB with the final S3 file location
8. WHEN the system handles files of any size THEN the streaming architecture SHALL maintain consistent memory usage regardless of file size
9. WHEN upload fails THEN the conversion process SHALL not be affected, and vice versa

**Note:** This streaming approach is experimental. If FFmpeg compatibility or progress tracking complexity becomes problematic, we will implement an optimized local file approach with careful resource management.

### Requirement 2: FFmpeg Progress Tracking with Redis

**User Story:** As a user monitoring conversion progress, I want real-time, accurate progress updates that persist across container restarts, so that I can track conversion status reliably.

#### Acceptance Criteria

1. WHEN FFmpeg starts processing THEN the system SHALL parse stderr output to extract duration and time progress information
2. WHEN FFmpeg outputs progress data THEN the system SHALL handle various output formats and edge cases (missing duration, variable time formats)
3. WHEN progress is calculated THEN the system SHALL store updates in Redis with sub-second refresh rates
4. WHEN FFmpeg process fails or hangs THEN the system SHALL detect timeout conditions and update progress accordingly
5. WHEN containers restart during conversion THEN progress data SHALL be retrievable from Redis without resetting to 0%
6. WHEN progress polling occurs THEN the system SHALL read from Redis first, falling back to DynamoDB if Redis data expires
7. WHEN conversion completes THEN the system SHALL ensure progress reaches exactly 100% and maintains that status
8. WHEN multiple users convert simultaneously THEN each job SHALL have isolated progress tracking in Redis

### Requirement 3: S3-Based File Storage and Download

**User Story:** As a user downloading converted audio files, I want reliable access to my files even after container restarts, so that I can retrieve my converted audio without errors.

#### Acceptance Criteria

1. WHEN audio conversion completes THEN the system SHALL store the converted file in S3 with a unique key based on jobId
2. WHEN S3 bucket is configured THEN the system SHALL set proper CORS policies to allow browser downloads from the application domain
3. WHEN files are stored in S3 THEN the system SHALL configure appropriate ACL permissions for secure access
4. WHEN a download is requested THEN the system SHALL generate presigned URLs or stream from S3 through the API
5. WHEN containers restart between conversion and download THEN the file SHALL remain accessible via S3
6. WHEN download fails with ERR_CONTENT_LENGTH_MISMATCH THEN the system SHALL retry from S3 with proper content headers
7. WHEN any file is downloaded THEN the system SHALL stream from S3 without loading into memory to prevent memory pressure and container restarts

### Requirement 4: Stateless Job Management System

**User Story:** As a system running on AWS App Runner, I want a completely stateless architecture that eliminates all in-memory dependencies, so that container scaling and restarts don't affect ongoing conversions.

#### Acceptance Criteria

1. WHEN the application starts THEN the system SHALL initialize AWS SDK connections to S3, DynamoDB, and Redis
2. WHEN any API endpoint is called THEN the system SHALL retrieve all necessary state from external services (no global variables)
3. WHEN job data is needed THEN the system SHALL query DynamoDB for job metadata and Redis for real-time progress
4. WHEN temporary files are created THEN the system SHALL use App Runner's ephemeral storage only for FFmpeg processing, not for persistence
5. WHEN the system scales to multiple containers THEN each container SHALL operate independently without shared state
6. WHEN jobs are created THEN the system SHALL assign unique IDs and store all data externally from the start

### Requirement 5: Multi-Environment Compatibility

**User Story:** As a developer, I want the audio conversion system to work consistently across local development, Docker containers, and AWS App Runner, so that I can develop and test reliably before deploying.

#### Acceptance Criteria

1. WHEN running locally THEN the system SHALL use local Redis, DynamoDB Local, and LocalStack S3 for development
2. WHEN running in Docker THEN the system SHALL connect to containerized versions of Redis, DynamoDB, and S3 services
3. WHEN running on App Runner THEN the system SHALL connect to AWS managed services (ElastiCache, DynamoDB, S3)
4. WHEN environment variables are configured THEN the system SHALL automatically detect and connect to the appropriate service endpoints
5. WHEN AWS services are unavailable locally THEN the system SHALL provide fallback mechanisms or clear error messages
6. WHEN switching between environments THEN the system SHALL maintain consistent behavior and API responses
7. WHEN Docker containers simulate production THEN the system SHALL replicate App Runner's container restart and scaling behavior

### Requirement 6: Robust Error Handling and Recovery

**User Story:** As a user of the audio conversion system, I want proper error handling and recovery mechanisms, so that I receive clear feedback when things go wrong and the system can recover gracefully from failures.

#### Acceptance Criteria

1. WHEN file upload fails THEN the system SHALL return specific error messages and allow retry without losing progress
2. WHEN S3 upload fails THEN the system SHALL implement exponential backoff retry logic with maximum retry limits
3. WHEN DynamoDB operations fail THEN the system SHALL retry with backoff and provide fallback error responses
4. WHEN Redis connection fails THEN the system SHALL fall back to DynamoDB for progress tracking and log the degradation
5. WHEN FFmpeg process crashes THEN the system SHALL update job status to failed and provide diagnostic information
6. WHEN FFmpeg process hangs THEN the system SHALL implement timeout detection and process termination
7. WHEN container restarts during processing THEN the system SHALL detect orphaned jobs and provide recovery mechanisms
8. WHEN AWS service quotas are exceeded THEN the system SHALL return appropriate HTTP status codes and retry guidance
9. WHEN file format is unsupported THEN the system SHALL validate formats early and return clear error messages
10. WHEN disk space is insufficient THEN the system SHALL detect space issues and fail gracefully with cleanup
11. WHEN network connectivity fails THEN the system SHALL implement circuit breaker patterns for AWS services
12. WHEN job timeouts occur THEN the system SHALL clean up resources and update job status appropriately
13. WHEN download requests fail THEN the system SHALL provide retry mechanisms and alternative download methods
14. WHEN concurrent job limits are exceeded THEN the system SHALL queue jobs or return appropriate rate limiting responses
15. WHEN system resources are exhausted THEN the system SHALL reject new jobs gracefully and provide status information

### Requirement 7: Comprehensive Logging and Observability

**User Story:** As a developer debugging App Runner issues, I want detailed, structured logging throughout the entire upload-conversion-download pipeline, so that I can quickly identify and resolve problems at any stage.

#### Acceptance Criteria

1. WHEN any API endpoint is called THEN the system SHALL log request details including jobId, file size, format, and timestamp
2. WHEN file upload starts THEN the system SHALL log upload progress, S3 bucket/key, and any chunking details
3. WHEN conversion job is created THEN the system SHALL log job metadata, input S3 location, and target output format
4. WHEN FFmpeg process starts THEN the system SHALL log command arguments, input file details, and process ID
5. WHEN FFmpeg outputs progress THEN the system SHALL log raw stderr output and parsed progress percentages
6. WHEN FFmpeg process completes or fails THEN the system SHALL log exit codes, final stderr output, and processing time
7. WHEN AWS service calls are made THEN the system SHALL log service name, operation, parameters, and response status
8. WHEN AWS service calls fail THEN the system SHALL log specific error codes, retry attempts, and failure reasons
9. WHEN Redis operations occur THEN the system SHALL log key names, operations, and connection status
10. WHEN DynamoDB operations occur THEN the system SHALL log table names, operations, and item keys
11. WHEN S3 operations occur THEN the system SHALL log bucket names, object keys, and operation types
12. WHEN container restarts are detected THEN the system SHALL log container lifecycle events and their impact on active jobs
13. WHEN memory or CPU usage is high THEN the system SHALL log resource metrics and active job counts
14. WHEN download requests are made THEN the system SHALL log jobId, file location, and streaming details
15. WHEN errors occur at any stage THEN the system SHALL log full error stack traces with contextual information
16. WHEN jobs are cleaned up THEN the system SHALL log cleanup operations and any orphaned resources
17. WHEN S3 CORS or ACL issues occur THEN the system SHALL log specific permission errors and suggested fixes
