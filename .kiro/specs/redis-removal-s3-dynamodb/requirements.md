# Requirements Document

## Introduction

This feature involves completely removing Redis/ElastiCache dependency from the TinyPixo audio conversion application and rewiring the entire codebase to use only S3 and DynamoDB for all data storage, progress tracking, and file management. The goal is to eliminate the VPC connectivity issues with App Runner while maintaining all existing functionality including real-time progress tracking, file uploads, audio conversion, and downloads.

## Requirements

### Requirement 1

**User Story:** As a user, I want to upload audio files and see real-time progress tracking without any Redis dependency, so that the application works reliably in production environments.

#### Acceptance Criteria

1. WHEN a user uploads an audio file THEN the system SHALL store upload progress in DynamoDB instead of Redis
2. WHEN upload progress is requested THEN the system SHALL retrieve progress data from DynamoDB with sub-second response times
3. WHEN upload completes THEN the system SHALL update the progress status to 100% in DynamoDB
4. IF Redis connection fails THEN the system SHALL continue operating normally using only DynamoDB
5. WHEN multiple users upload simultaneously THEN each user SHALL see their individual progress without interference

### Requirement 2

**User Story:** As a user, I want audio conversion progress tracking to work seamlessly without Redis, so that I can monitor conversion status in real-time.

#### Acceptance Criteria

1. WHEN audio conversion starts THEN the system SHALL create a job record in DynamoDB with initial progress
2. WHEN FFmpeg reports conversion progress THEN the system SHALL update the DynamoDB job record with current percentage
3. WHEN conversion completes THEN the system SHALL mark the job as completed in DynamoDB with 100% progress
4. WHEN conversion fails THEN the system SHALL mark the job as failed in DynamoDB with error details
5. WHEN frontend polls for progress THEN the system SHALL return current status from DynamoDB within 500ms

### Requirement 3

**User Story:** As a user, I want all file operations to use S3 storage exclusively, so that there are no temporary files or Redis-based caching issues.

#### Acceptance Criteria

1. WHEN a file is uploaded THEN the system SHALL store it directly in S3 with proper metadata
2. WHEN audio conversion starts THEN the system SHALL read input files from S3 and write output files to S3
3. WHEN conversion completes THEN the system SHALL provide S3-based download URLs with proper expiration
4. WHEN files are no longer needed THEN the system SHALL clean up S3 objects automatically
5. WHEN download is requested THEN the system SHALL generate secure S3 presigned URLs

### Requirement 4

**User Story:** As a developer, I want all Redis-related code removed from the codebase, so that there are no unused dependencies or potential connection issues.

#### Acceptance Criteria

1. WHEN the application starts THEN the system SHALL NOT attempt to connect to Redis
2. WHEN services initialize THEN the system SHALL only initialize S3 and DynamoDB clients
3. WHEN progress is tracked THEN the system SHALL use only DynamoDB-based progress service
4. WHEN cleanup runs THEN the system SHALL clean up only DynamoDB and S3 resources
5. WHEN tests run THEN all Redis-related test mocks SHALL be removed

### Requirement 5

**User Story:** As a user, I want the same upload progress granularity as before, so that I can see detailed chunk-by-chunk progress during large file uploads.

#### Acceptance Criteria

1. WHEN uploading large files THEN the system SHALL track progress by chunks in DynamoDB
2. WHEN each chunk completes THEN the system SHALL update the chunk count and percentage in DynamoDB
3. WHEN frontend polls progress THEN the system SHALL return chunk-based progress information
4. WHEN upload is interrupted THEN the system SHALL maintain partial progress state in DynamoDB
5. WHEN upload resumes THEN the system SHALL continue from the last completed chunk

### Requirement 6

**User Story:** As a system administrator, I want automatic cleanup of expired jobs and files, so that storage costs remain controlled without Redis-based TTL.

#### Acceptance Criteria

1. WHEN jobs are created THEN the system SHALL set TTL timestamps in DynamoDB
2. WHEN cleanup runs THEN the system SHALL scan for expired jobs and delete them from DynamoDB
3. WHEN jobs are deleted THEN the system SHALL also delete associated S3 files
4. WHEN cleanup completes THEN the system SHALL log the number of cleaned up resources
5. WHEN cleanup fails partially THEN the system SHALL continue processing remaining items

### Requirement 7

**User Story:** As a user, I want the application to work identically in development and production, so that there are no environment-specific Redis issues.

#### Acceptance Criteria

1. WHEN running locally THEN the system SHALL use LocalStack S3 and DynamoDB without Redis
2. WHEN running in production THEN the system SHALL use AWS S3 and DynamoDB without Redis
3. WHEN switching environments THEN the system SHALL automatically detect and configure appropriate endpoints
4. WHEN environment variables are missing THEN the system SHALL provide clear error messages
5. WHEN services are unavailable THEN the system SHALL fail gracefully with informative errors

### Requirement 8

**User Story:** As a developer, I want comprehensive test coverage for the Redis-free implementation, so that I can be confident in the reliability of the new architecture.

#### Acceptance Criteria

1. WHEN tests run THEN all progress tracking tests SHALL pass using DynamoDB mocks
2. WHEN tests run THEN all file upload tests SHALL pass using S3 mocks
3. WHEN tests run THEN all conversion workflow tests SHALL pass without Redis dependencies
4. WHEN tests run THEN cleanup and TTL tests SHALL pass using DynamoDB TTL simulation
5. WHEN tests run THEN error handling tests SHALL cover DynamoDB and S3 failure scenarios

### Requirement 9

**User Story:** As a developer, I want to validate each implementation step against live AWS services as I build, so that I can ensure each component works correctly with real AWS DynamoDB and S3 before proceeding.

#### Acceptance Criteria

1. WHEN each task is completed THEN the system SHALL be tested against live AWS S3 and DynamoDB services
2. WHEN progress tracking is implemented THEN it SHALL be validated with real DynamoDB operations
3. WHEN file upload changes are made THEN they SHALL be tested with actual S3 uploads
4. WHEN audio conversion is modified THEN it SHALL be verified with real AWS resources
5. WHEN cleanup functionality is updated THEN it SHALL be tested against live AWS services to ensure proper resource management

### Requirement 10

**User Story:** As a user, I want all backend changes to be immediately testable through the web interface, so that I can verify functionality works end-to-end without technical knowledge.

#### Acceptance Criteria

1. WHEN upload progress tracking is updated THEN the frontend SHALL display real-time progress from DynamoDB
2. WHEN audio conversion progress is modified THEN the UI SHALL show live conversion status updates
3. WHEN API endpoints are changed THEN the frontend SHALL continue to function without errors
4. WHEN Redis dependencies are removed THEN the web interface SHALL load and operate normally
5. WHEN each task is completed THEN all related UI features SHALL be fully functional and testable through the browser