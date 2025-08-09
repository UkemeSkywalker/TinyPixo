# Comprehensive Test Suite

This directory contains a comprehensive test suite for the audio conversion system with multi-environment support, designed to validate the system's reliability across different deployment scenarios.

## Test Structure

```
test/
├── unit/                           # Unit tests for individual components
│   ├── streaming-conversion-service.test.ts
│   └── ffmpeg-progress-parser.test.ts
├── integration/                    # End-to-end integration tests
│   ├── complete-workflow.test.ts
│   ├── container-restart.test.ts
│   └── aws-failure-scenarios.test.ts
├── performance/                    # Performance and load testing
│   └── load-testing.test.ts
├── fixtures/                       # Test data files (auto-generated)
│   ├── small-audio.mp3
│   ├── medium-audio.mp3
│   └── large-audio.mp3
├── test-config.ts                  # Test configuration and environments
├── test-helpers.ts                 # Test utilities and helpers
└── setup.ts                       # Global test setup

```

## Test Categories

### 1. Unit Tests (`test/unit/`)

Tests individual service components with mocked dependencies:

- **StreamingConversionService**: Tests streaming FFmpeg conversion with S3 integration
- **FFmpegProgressParser**: Tests progress parsing from FFmpeg stderr output
- **JobService**: Tests job lifecycle management with DynamoDB
- **ProgressService**: Tests real-time progress tracking with Redis

**Coverage**: >90% code coverage for all service components

### 2. Integration Tests (`test/integration/`)

Tests complete workflows and system interactions:

- **Complete Workflow**: Upload → Convert → Download end-to-end testing
- **Container Restart**: Simulates App Runner container restarts during processing
- **AWS Failure Scenarios**: Tests resilience to AWS service failures

**Validation**: 
- Complete user workflows work end-to-end
- System survives container restarts without data loss
- Graceful handling of AWS service failures

### 3. Performance Tests (`test/performance/`)

Tests system performance under various load conditions:

- **File Size Performance**: 1MB, 10MB, 50MB file processing times
- **Concurrent Processing**: Multiple simultaneous conversions
- **Memory Usage**: Memory stability during processing
- **Progress Polling**: High-frequency progress polling performance

**Thresholds**:
- Small files (1MB): <10 seconds
- Medium files (10MB): <30 seconds  
- Large files (50MB): <2 minutes
- Memory usage: <512MB peak
- Concurrent jobs: 5+ simultaneous

## Multi-Environment Support

The test suite supports three environments:

### Local Development
- **Services**: LocalStack S3, DynamoDB Local, Redis
- **Usage**: `npm run test` or `TEST_ENVIRONMENT=local npm run test:integration`
- **Setup**: `npm run dev:services`

### Docker Environment
- **Services**: Containerized LocalStack, DynamoDB, Redis
- **Usage**: `npm run test:docker`
- **Setup**: Automatic via Docker Compose

### Real AWS
- **Services**: Real AWS S3, DynamoDB, ElastiCache
- **Usage**: `INTEGRATION_TEST_USE_REAL_AWS=true npm run test:integration`
- **Setup**: AWS credentials and resources required

## Running Tests

### Quick Test Commands

```bash
# Run all unit tests
npm run test:unit

# Run integration tests (LocalStack)
npm run test:integration

# Run performance tests
npm run test:performance

# Run with coverage
npm run test:coverage

# Run comprehensive test suite
npm run test:comprehensive
```

### Docker Testing

```bash
# Run tests in Docker environment
npm run test:docker

# Setup Docker test environment
npm run test:docker:setup

# Teardown Docker test environment
npm run test:docker:teardown

# Test container restart scenarios
npm run test:restart
```

### Real AWS Testing

```bash
# Set up AWS resources first
npm run setup:aws-resources

# Run tests against real AWS
INTEGRATION_TEST_USE_REAL_AWS=true npm run test:integration

# Check AWS connectivity
npm run test:aws-connectivity
```

## Test Configuration

### Environment Variables

```bash
# Test environment selection
TEST_ENVIRONMENT=local|docker|aws

# AWS testing
INTEGRATION_TEST_USE_REAL_AWS=true|false
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket-name

# Service endpoints (for LocalStack/Docker)
S3_ENDPOINT=http://localhost:4566
DYNAMODB_ENDPOINT=http://localhost:8000
REDIS_ENDPOINT=localhost:6379
```

### Performance Thresholds

Configurable in `test/test-config.ts`:

```typescript
export const PERFORMANCE_THRESHOLDS = {
  smallFileConversion: 10000,    // 10 seconds
  mediumFileConversion: 30000,   // 30 seconds
  largeFileConversion: 120000,   // 2 minutes
  concurrentJobs: 5,             // Max concurrent
  maxMemoryUsage: 512 * 1024 * 1024  // 512MB
}
```

## Test Validation Criteria

After completing task 12, you should be able to:

### ✅ Unit Test Coverage
- Run `npm test` and see all unit tests pass with >90% code coverage
- All service components tested with mocked dependencies
- Edge cases and error scenarios covered

### ✅ Integration Testing
- Execute integration tests that verify complete workflow with both LocalStack and real AWS
- Upload → conversion → download flow works end-to-end
- Progress tracking works without 95% → 0% reset issue

### ✅ Container Restart Resilience
- Simulate container restarts and see job recovery tests passing
- Jobs survive container lifecycle events
- Progress data persists across restarts

### ✅ Concurrent Processing
- Run concurrent job tests and see system handle multiple conversions simultaneously
- Resource limits respected
- No memory leaks or resource exhaustion

### ✅ Docker Environment
- Start Docker test environment and see it replicate App Runner container behavior
- All services (S3, DynamoDB, Redis) work in containerized environment
- Container restart simulation works

### ✅ Performance Validation
- Run performance tests with 200MB files and see acceptable processing times
- Memory usage stays within thresholds
- System handles load gracefully

### ✅ AWS Service Failures
- Test AWS service failures and see recovery mechanisms working correctly
- Circuit breaker patterns implemented
- Graceful degradation when services unavailable

## Troubleshooting

### Common Issues

1. **Docker not available**: Install Docker Desktop or Docker Engine
2. **AWS credentials missing**: Set up AWS CLI or environment variables
3. **LocalStack connection failed**: Run `npm run dev:services` first
4. **FFmpeg not found**: Install FFmpeg system dependency
5. **Test timeouts**: Increase timeout values in test configuration

### Debug Commands

```bash
# Check service connectivity
npm run test:connectivity
npm run test:aws-connectivity

# View service logs
npm run dev:services:logs

# Inspect running services
npm run inspect:services

# Check AWS resources
npm run check:aws-resources
```

### Test Data

Test files are automatically generated in `test/fixtures/`:
- `small-audio.mp3`: 1MB test file
- `medium-audio.mp3`: 10MB test file  
- `large-audio.mp3`: 50MB test file
- `invalid.txt`: Invalid file for error testing

## Continuous Integration

The test suite is designed for CI/CD environments:

```yaml
# Example GitHub Actions workflow
- name: Run Unit Tests
  run: npm run test:unit

- name: Run Integration Tests
  run: npm run test:integration
  env:
    TEST_ENVIRONMENT: docker

- name: Run Performance Tests
  run: npm run test:performance
  timeout-minutes: 20

- name: Generate Coverage Report
  run: npm run test:coverage
```

## Contributing

When adding new tests:

1. Follow the existing test structure and naming conventions
2. Add appropriate timeout values for long-running tests
3. Use test helpers for common operations
4. Mock external dependencies in unit tests
5. Test both success and failure scenarios
6. Update this README with new test categories

## Test Results

Test results are saved to `test-results/` directory:
- JSON reports with detailed metrics
- Coverage reports in HTML format
- Performance benchmarks
- Failure analysis and logs