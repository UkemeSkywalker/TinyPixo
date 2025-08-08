# Redis Progress Tracking Tests

This folder contains dedicated tests for validating Redis progress tracking from 0% to 100% during the audio conversion pipeline.

## Files

### `test-redis-progress-simple.ts`
- **Purpose**: Unit-style test that simulates Redis progress tracking
- **Method**: Creates mock progress updates from 0% to 100%
- **Validation**: Confirms Redis storage, retrieval, and monotonic progression
- **Usage**: `npx tsx tests/redis-progress/test-redis-progress-simple.ts`

### `test-redis-progress-pipeline.ts`
- **Purpose**: End-to-end test with real file upload and conversion
- **Method**: Uploads actual audio file and monitors real conversion progress
- **Validation**: Tracks actual Redis progress during complete pipeline
- **Usage**: `npx tsx tests/redis-progress/test-redis-progress-pipeline.ts`

### `redis-progress-integration.test.ts`
- **Purpose**: Vitest integration tests for Redis progress tracking
- **Method**: Comprehensive test suite with real AWS/LocalStack integration
- **Coverage**: 
  - Full pipeline progress tracking (0% → 100%)
  - Concurrent job progress tracking
  - Redis fallback scenarios
- **Usage**: `npx vitest run tests/redis-progress/redis-progress-integration.test.ts`

## Test Organization

These tests were moved from the main `scripts/` folder to provide better organization:

- **Before**: Tests scattered in `scripts/` folder
- **After**: Dedicated `tests/redis-progress/` folder for Redis-specific tests

## Task 8 Validation

These tests specifically address the Task 8 validation criteria:

> **Validation Criteria:** Watch progress updates in Redis going from 0% to 100% during the full pipeline

All tests in this folder validate this requirement through different approaches:

1. **Simulated Progress** (`test-redis-progress-simple.ts`)
2. **Real Pipeline Progress** (`test-redis-progress-pipeline.ts`) 
3. **Integration Test Suite** (`redis-progress-integration.test.ts`)

## Running the Tests

### Individual Tests
```bash
# Simple Redis progress simulation
npx tsx tests/redis-progress/test-redis-progress-simple.ts

# Full pipeline with real files
npx tsx tests/redis-progress/test-redis-progress-pipeline.ts

# Integration test suite
npx vitest run tests/redis-progress/redis-progress-integration.test.ts
```

### All Redis Progress Tests
```bash
# Run all tests in this folder
npx vitest run tests/redis-progress/
```

### With LocalStack
```bash
# Start LocalStack first
npm run dev:services

# Then run tests
npx vitest run tests/redis-progress/
```

### With Real AWS
```bash
# Set environment variable
export INTEGRATION_TEST_USE_REAL_AWS=true

# Run tests
npx vitest run tests/redis-progress/
```

## Expected Output

All tests should demonstrate Redis progress tracking from 0% to 100%:

```
📈 Simulating progress updates:
Time            Progress        Stage
------------------------------------------------------------
10:16:32 PM     0%              initialized              
10:16:32 PM     5%              creating S3 input stream 
10:16:32 PM     15%             starting FFmpeg process  
...
10:16:34 PM     95%             finalizing upload        
10:16:34 PM     100%            completed                

✅ Validation Results:
✅ Started at 0%: 0%
✅ Reached 100%: 100%
✅ Multiple progress updates: 12 updates
✅ Progress is monotonically increasing: 0% → 100% (monotonic)
```

This confirms that Redis progress tracking works correctly throughout the entire conversion pipeline.