/**
 * Test configuration for multi-environment support
 * Handles LocalStack, Docker, and real AWS environments
 */

export interface TestEnvironment {
  name: string
  useRealAWS: boolean
  s3Bucket: string
  dynamodbEndpoint?: string
  redisEndpoint?: string
  ffmpegPath?: string
}

export const TEST_ENVIRONMENTS: Record<string, TestEnvironment> = {
  local: {
    name: 'LocalStack',
    useRealAWS: false,
    s3Bucket: 'audio-conversion-bucket',
    dynamodbEndpoint: 'http://localhost:8000',
    redisEndpoint: 'localhost:6379',
    ffmpegPath: 'ffmpeg'
  },
  docker: {
    name: 'Docker Compose',
    useRealAWS: false,
    s3Bucket: 'audio-conversion-bucket',
    dynamodbEndpoint: 'http://dynamodb-local:8000',
    redisEndpoint: 'redis:6379',
    ffmpegPath: 'ffmpeg'
  },
  aws: {
    name: 'Real AWS',
    useRealAWS: true,
    s3Bucket: process.env.S3_BUCKET_NAME || 'audio-conversion-bucket',
    ffmpegPath: 'ffmpeg'
  }
}

export function getCurrentTestEnvironment(): TestEnvironment {
  const envName = process.env.TEST_ENVIRONMENT || 'local'
  
  if (process.env.INTEGRATION_TEST_USE_REAL_AWS === 'true') {
    return TEST_ENVIRONMENTS.aws
  }
  
  if (process.env.DOCKER_ENV === 'true') {
    return TEST_ENVIRONMENTS.docker
  }
  
  return TEST_ENVIRONMENTS[envName] || TEST_ENVIRONMENTS.local
}

export const TEST_TIMEOUTS = {
  unit: 5000,
  integration: 30000,
  performance: 120000,
  containerRestart: 180000
}

export const TEST_FILES = {
  tinyAudio: 'test/fixtures/tiny-audio.mp3',
  smallAudio: 'test/fixtures/small-audio.mp3',
  mediumAudio: 'test/fixtures/medium-audio.mp3',
  largeAudio: 'test/fixtures/large-audio.mp3',
  xlargeAudio: 'test/fixtures/xlarge-audio.mp3',
  testWav: 'test/fixtures/test-audio.wav',
  invalidFile: 'test/fixtures/invalid.txt',
  corruptedFile: 'test/fixtures/corrupted.mp3',
  emptyFile: 'test/fixtures/empty.mp3',
  partialFile: 'test/fixtures/partial.wav'
}

export const PERFORMANCE_THRESHOLDS = {
  tinyFileConversion: 5000, // 5 seconds
  smallFileConversion: 15000, // 15 seconds
  mediumFileConversion: 45000, // 45 seconds
  largeFileConversion: 180000, // 3 minutes
  xlargeFileConversion: 600000, // 10 minutes
  concurrentJobs: 5,
  maxMemoryUsage: 512 * 1024 * 1024, // 512MB
  maxConcurrentMemory: 1024 * 1024 * 1024, // 1GB for concurrent tests
  progressPollingInterval: 500, // 500ms
  maxProgressPollingTime: 2000 // 2s max response time
}