# Implementation Plan

**Note: This implementation uses an experimental streaming architecture to eliminate local file storage and memory pressure issues. If FFmpeg compatibility or progress tracking complexity becomes problematic during development, we will pivot to an optimized local file approach with careful resource management.**

- [x] 1. Set up complete LocalStack development environment with working AWS services

  - Create Docker Compose configuration with LocalStack, DynamoDB Local, and Redis containers
  - Implement S3 bucket creation with uploads/ and conversions/ folder structure
  - Create DynamoDB table 'audio-conversion-jobs' with TTL configuration
  - Write environment detection utility that automatically connects to LocalStack
  - Add connectivity tests that verify S3, DynamoDB, and Redis are working end-to-end
  - Create npm scripts to start/stop the development environment
  - _Requirements: 5.1, 5.2, 5.4_

  **Validation Criteria:** After completing this task, you should be able to:

  - Run `npm run dev:services` to start LocalStack, DynamoDB, and Redis containers
  - Execute connectivity tests that successfully create S3 buckets, DynamoDB tables, and Redis connections
  - View the S3 bucket with uploads/ and conversions/ folders in LocalStack dashboard
  - Query the DynamoDB table and see it has TTL configured
  - Connect to Redis and perform basic get/set operations
  - Run `npm run dev:services:stop` to cleanly shut down all services

- [ ] 2. Build complete job management service with full CRUD operations

  - Implement Job interface with all required fields (jobId, status, S3 locations, timestamps)
  - Create JobService class with createJob, getJob, updateJobStatus, and cleanupExpiredJobs methods
  - Add DynamoDB operations with proper error handling and retry logic
  - Write comprehensive unit tests that verify all job operations work with LocalStack
  - Create API endpoint GET /api/jobs/:jobId that returns job details
  - Add logging for all job operations and state changes
  - _Requirements: 1.1, 1.3, 4.3, 6.2, 7.2, 7.10_

  **Validation Criteria:** After completing this task, you should be able to:

  - Create a new job by calling `jobService.createJob()` and receive a unique jobId
  - Retrieve job details using `jobService.getJob(jobId)` and see all fields populated
  - Update job status using `jobService.updateJobStatus(jobId, 'processing')` and verify the change
  - Call GET `/api/jobs/123` and receive job details in JSON format
  - Run unit tests with `npm test job-service` and see all tests pass
  - View job records in DynamoDB LocalStack dashboard with proper TTL timestamps
  - See detailed logs for all job operations in the console output

- [ ] 3. Create real AWS resources and validate connectivity

  - Set up real S3 bucket with proper CORS policies and folder structure (uploads/, conversions/)
  - Create real DynamoDB table 'audio-conversion-jobs' with TTL and proper indexes
  - Configure ElastiCache Redis cluster with appropriate security groups
  - Set up IAM roles and policies for S3, DynamoDB, and Redis access
  - Write connectivity tests that verify all real AWS services are accessible
  - Add environment switching utility to test with both LocalStack and real AWS
  - _Requirements: 3.2, 3.3, 5.3, 5.4, 7.11, 7.17_

  **Validation Criteria:** After completing this task, you should be able to:

  - View your S3 bucket in AWS Console with uploads/ and conversions/ folders created
  - Upload a test file to S3 from your browser and see CORS policies working correctly
  - Query your DynamoDB table in AWS Console and see TTL configuration active
  - Connect to ElastiCache Redis cluster and perform get/set operations
  - Run `npm run test:aws-connectivity` and see all real AWS services respond successfully
  - Switch between LocalStack and real AWS using environment variables
  - See IAM permissions working without access denied errors

- [ ] 4. Create working progress tracking system with Redis and API endpoint

  - Implement ProgressService with setProgress, getProgress, and progress initialization
  - Create GET /api/progress endpoint with Redis-first, DynamoDB-fallback strategy
  - Add proper caching headers and error handling for missing jobs
  - Write tests that verify progress works with both LocalStack and real AWS Redis
  - Implement progress data TTL and automatic cleanup
  - Add comprehensive logging for all Redis operations
  - _Requirements: 2.1, 2.3, 2.4, 2.6, 6.9, 7.1, 7.9_

  **Validation Criteria:** After completing this task, you should be able to:

  - Set progress using `progressService.setProgress(jobId, {progress: 45, stage: 'converting'})`
  - Call GET `/api/progress?jobId=123` and receive progress data in JSON format
  - Test with both LocalStack Redis and real ElastiCache Redis successfully
  - Simulate Redis failure and see fallback to DynamoDB working correctly
  - See progress data expire after TTL and get cleaned up automatically
  - Poll the progress endpoint rapidly and see proper no-cache headers in response
  - View detailed Redis operation logs showing all get/set operations with connection status

- [ ] 5. Build complete file upload service with S3 multipart upload

  - Create POST /api/upload-audio endpoint with chunked file upload support
  - Implement S3 multipart upload with proper chunk handling and completion
  - Add file validation for supported formats (mp3, wav, aac, ogg) and size limits
  - Create unique file ID generation and S3 key management (uploads/{fileId}.{ext})
  - Write tests that verify large files can be uploaded to both LocalStack and real S3
  - Validate CORS policies work correctly with browser uploads to real S3
  - Add upload progress tracking and comprehensive error handling with retry logic
  - _Requirements: 1.2, 1.8, 3.2, 6.1, 6.2, 6.10, 7.1, 7.11_

  **Validation Criteria:** After completing this task, you should be able to:

  - Upload a 50MB audio file via POST `/api/upload-audio` and receive a unique fileId
  - See the uploaded file appear in S3 bucket under uploads/{fileId}.mp3
  - Upload files to both LocalStack S3 and real AWS S3 successfully
  - Try uploading invalid formats (.txt, .exe) and see proper validation errors
  - Upload large files and see multipart upload working with progress tracking
  - Test upload from browser and see CORS policies allowing the request
  - Simulate upload failures and see retry logic working with exponential backoff

- [ ] 6. Implement streaming FFmpeg progress parser with fallback support (Experimental)

  - Create FFmpegProgressParser class that extracts duration and time from stderr output
  - Implement streaming-compatible progress calculation with duration estimation fallbacks
  - Add time parsing utilities (HH:MM:SS.ms to seconds) with edge case handling
  - Write comprehensive tests with various FFmpeg stderr formats for streaming scenarios
  - Create progress update mechanism that works with both streaming and file-based conversion
  - Add format compatibility detection to determine streaming vs file-based approach
  - Add timeout detection and error handling for FFmpeg process failures
  - _Requirements: 2.2, 2.5, 6.5, 6.6, 7.4, 7.5, 7.6_

  **Validation Criteria:** After completing this task, you should be able to:

  - Parse FFmpeg stderr from streaming processes and extract progress information
  - Handle cases where duration is unknown initially and estimate progress from file size
  - Run unit tests with streaming FFmpeg scenarios and see progress tracking working
  - Test format compatibility detection and see streaming vs file-based decisions
  - See progress updates written to Redis in real-time during streaming conversion
  - Test fallback scenarios when streaming progress tracking fails
  - Simulate FFmpeg streaming failures and see proper detection and recovery

- [ ] 7. Build streaming FFmpeg conversion service with S3 integration (Experimental)

  - Create StreamingConversionService that streams directly from S3 input to S3 output
  - Implement FFmpeg process spawning with pipe-based I/O (stdin/stdout streaming)
  - Integrate FFmpegProgressParser to provide real-time progress updates during streaming
  - Add fallback to file-based conversion when streaming encounters compatibility issues
  - Write end-to-end tests that convert actual audio files using streaming architecture
  - Test streaming compatibility with different audio formats and identify limitations
  - Implement process timeout, stream error handling, and automatic fallback mechanisms
  - _Requirements: 1.4, 1.5, 2.2, 3.3, 6.5, 6.6, 6.10, 7.6_

  **Validation Criteria:** After completing this task, you should be able to:

  - Convert an MP3 file to WAV using streaming and see the converted file appear in S3
  - Watch real-time progress updates in Redis during streaming conversion (may be estimated)
  - Test streaming conversion with both LocalStack S3 and real AWS S3 successfully
  - See automatic fallback to file-based conversion when streaming fails
  - Convert files without any temporary files created in /tmp (pure streaming)
  - Test FFmpeg streaming timeout and see proper process termination and cleanup
  - Identify which audio formats work with streaming vs require file-based processing

- [ ] 8. Create working conversion orchestration API with job lifecycle management

  - Implement POST /api/convert-audio endpoint that accepts fileId and conversion parameters
  - Create complete workflow: job creation → progress initialization → FFmpeg processing → status updates
  - Integrate JobService, ProgressService, and ConversionService into unified pipeline
  - Add comprehensive error handling for all pipeline stages with proper job status updates
  - Write integration tests that verify complete workflow with both LocalStack and real AWS
  - Test AWS service quotas, throttling, and error handling with real services
  - Implement job recovery logic for handling interrupted conversions
  - _Requirements: 1.1, 1.3, 1.4, 1.6, 6.7, 6.8, 6.11, 6.12, 7.1, 7.12_

  **Validation Criteria:** After completing this task, you should be able to:

  - Call POST `/api/convert-audio` with fileId and get back a jobId immediately
  - See job status progress from 'created' → 'processing' → 'completed' in DynamoDB
  - Watch progress updates in Redis going from 0% to 100% during the full pipeline
  - Test complete workflow with both LocalStack and real AWS services
  - Simulate service failures (S3, DynamoDB, Redis) and see proper error handling
  - Interrupt a conversion process and see job recovery logic working correctly
  - Run integration tests and see the entire upload → convert → complete flow working

- [ ] 9. Build S3 streaming download service with proper file serving

  - Create GET /api/download endpoint that streams converted files from S3
  - Implement presigned URL generation as alternative download method
  - Add proper content headers, MIME type detection, and Content-Length handling
  - Write tests that verify large files can be downloaded from both LocalStack and real S3
  - Validate Content-Length and CORS headers work correctly with real S3
  - Add download access validation and comprehensive error handling
  - Implement file cleanup mechanisms for completed downloads
  - _Requirements: 3.1, 3.4, 3.5, 3.7, 6.2, 6.8, 6.12, 6.13, 7.11_

  **Validation Criteria:** After completing this task, you should be able to:

  - Call GET `/api/download?jobId=123` and receive the converted audio file
  - Download large files (50MB+) without ERR_CONTENT_LENGTH_MISMATCH errors
  - See proper Content-Type headers (audio/wav, audio/mpeg) in download response
  - Generate presigned URLs and download files directly from S3
  - Test downloads from both LocalStack S3 and real AWS S3 successfully
  - Try downloading non-existent jobs and see proper 404 error handling
  - Verify file cleanup happens after successful downloads

- [ ] 10. Update frontend to use new decoupled upload/conversion/download architecture

  - Modify file upload component to use new chunked upload API with progress tracking
  - Update conversion initiation to use job-based API instead of direct file processing
  - Implement new progress polling logic that uses Redis-based progress endpoint
  - Update download handling to use S3-based streaming download endpoint
  - Add comprehensive error handling and user feedback for all stages
  - Test complete user workflow with both LocalStack and real AWS services
  - Write frontend tests that verify the complete user workflow works end-to-end
  - _Requirements: 1.8, 2.6, 3.4, 3.5, 6.1, 6.13, 6.14, 7.1_

  **Validation Criteria:** After completing this task, you should be able to:

  - Upload an audio file through the UI and see upload progress bar working
  - Click "Convert" and see conversion start with a new jobId displayed
  - Watch progress bar go from 0% to 100% without resetting to 0%
  - Download the converted file and play it to verify conversion worked
  - Test the complete workflow in browser with both LocalStack and real AWS
  - See proper error messages when uploads fail or conversions timeout
  - Run frontend tests and see all user interaction scenarios passing

- [ ] 11. Add comprehensive logging, monitoring, and debugging utilities

  - Implement structured logging system with consistent format across all services
  - Add request/response logging for all API endpoints with timing and context
  - Create service-specific logging for AWS operations, FFmpeg processes, and job lifecycle
  - Implement resource usage monitoring (CPU, memory, disk space) with alerting
  - Add container restart detection and job recovery logging
  - Create AWS service health checks and monitoring for real service connectivity
  - Write debugging utilities and health check endpoints for system validation
  - _Requirements: 6.10, 6.14, 7.1, 7.2, 7.6, 7.7, 7.8, 7.12, 7.13, 7.14_

  **Validation Criteria:** After completing this task, you should be able to:

  - See structured logs with consistent format for all API requests and responses
  - View detailed logs for every AWS operation (S3, DynamoDB, Redis) with timing
  - Monitor FFmpeg process logs with stderr output and progress calculations
  - Call GET `/api/health` and see status of all AWS services and system resources
  - See container restart events logged with impact on active jobs
  - Monitor CPU/memory usage and see alerts when thresholds are exceeded
  - Use debugging endpoints to inspect job states and system health in real-time

- [ ] 12. Create comprehensive test suite with multi-environment support

  - Write unit tests for all service components with mocked dependencies
  - Create integration tests for complete upload → conversion → download workflow
  - Add container restart simulation tests that verify job recovery mechanisms
  - Implement concurrent job processing tests with resource limit validation
  - Create Docker Compose test environment that simulates App Runner conditions
  - Add performance tests with various file sizes (1MB to 200MB) and formats
  - Test AWS service failure scenarios and recovery mechanisms with real services
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  **Validation Criteria:** After completing this task, you should be able to:

  - Run `npm test` and see all unit tests pass with >90% code coverage
  - Execute integration tests that verify complete workflow with both LocalStack and real AWS
  - Simulate container restarts and see job recovery tests passing
  - Run concurrent job tests and see system handle multiple conversions simultaneously
  - Start Docker test environment and see it replicate App Runner container behavior
  - Run performance tests with 200MB files and see acceptable processing times
  - Test AWS service failures and see recovery mechanisms working correctly

- [ ] 13. Configure and deploy to App Runner with production validation

  - Set up App Runner service configuration with proper environment variables
  - Deploy to staging environment using existing AWS resources from Task 3
  - Validate that all services connect properly in App Runner environment
  - Test container restart resilience with real conversion jobs
  - Perform load testing with concurrent users and various file sizes
  - Monitor system performance and validate that progress tracking survives container restarts
  - Verify that the 95% → 0% progress loop issue is completely resolved
  - _Requirements: 1.3, 1.5, 2.3, 3.5, 5.3, 5.4, 6.7_

  **Validation Criteria:** After completing this task, you should be able to:

  - Access your deployed App Runner service URL and see the audio converter working
  - Upload and convert files in production and see progress go from 0% to 100% without resetting
  - Force container restarts during conversion and see jobs complete successfully
  - Run load tests with 10+ concurrent users and see system handle the load
  - Monitor App Runner logs and see no ERR_CONTENT_LENGTH_MISMATCH errors
  - Download converted files without any download failures
  - Confirm the original 95% → 0% progress loop issue is completely eliminated
