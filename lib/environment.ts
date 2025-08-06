export enum Environment {
  LOCAL = 'local',
  DOCKER = 'docker',
  APP_RUNNER = 'app-runner'
}

export interface S3Config {
  endpoint?: string
  region: string
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
  }
  forcePathStyle?: boolean
}

export interface DynamoDBConfig {
  endpoint?: string
  region: string
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
  }
}

export interface RedisConfig {
  host: string
  port: number
  tls?: boolean
}

export interface EnvironmentConfig {
  environment: Environment
  s3: S3Config
  dynamodb: DynamoDBConfig
  redis: RedisConfig
}

export function detectEnvironment(): Environment {
  // Check if running in App Runner
  if (process.env.AWS_EXECUTION_ENV?.includes('AWS_ECS_FARGATE')) {
    return Environment.APP_RUNNER
  }
  
  // Check if running in Docker
  if (process.env.DOCKER_ENV === 'true' || process.env.NODE_ENV === 'docker') {
    return Environment.DOCKER
  }
  
  // Default to local development
  return Environment.LOCAL
}

export function getEnvironmentConfig(): EnvironmentConfig {
  const environment = detectEnvironment()
  
  switch (environment) {
    case Environment.LOCAL:
      return {
        environment,
        s3: {
          endpoint: 'http://localhost:4566',
          region: 'us-east-1',
          credentials: {
            accessKeyId: 'test',
            secretAccessKey: 'test'
          },
          forcePathStyle: true
        },
        dynamodb: {
          endpoint: 'http://localhost:8000',
          region: 'us-east-1',
          credentials: {
            accessKeyId: 'test',
            secretAccessKey: 'test'
          }
        },
        redis: {
          host: 'localhost',
          port: 6379
        }
      }
      
    case Environment.DOCKER:
      return {
        environment,
        s3: {
          endpoint: 'http://localstack:4566',
          region: 'us-east-1',
          credentials: {
            accessKeyId: 'test',
            secretAccessKey: 'test'
          },
          forcePathStyle: true
        },
        dynamodb: {
          endpoint: 'http://dynamodb-local:8000',
          region: 'us-east-1',
          credentials: {
            accessKeyId: 'test',
            secretAccessKey: 'test'
          }
        },
        redis: {
          host: 'redis',
          port: 6379
        }
      }
      
    case Environment.APP_RUNNER:
      return {
        environment,
        s3: {
          region: process.env.AWS_REGION || 'us-east-1'
        },
        dynamodb: {
          region: process.env.AWS_REGION || 'us-east-1'
        },
        redis: {
          host: process.env.REDIS_ENDPOINT || 'localhost',
          port: 6379,
          tls: true
        }
      }
      
    default:
      throw new Error(`Unknown environment: ${environment}`)
  }
}