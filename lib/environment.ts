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

export interface EnvironmentConfig {
  environment: Environment
  s3: S3Config
  dynamodb: DynamoDBConfig
}

export function detectEnvironment(): Environment {
  // Check for explicit environment override
  if (process.env.FORCE_AWS_ENVIRONMENT === 'true') {
    return Environment.APP_RUNNER
  }
  
  // Check if running in App Runner
  if (process.env.AWS_EXECUTION_ENV?.includes('AWS_ECS_FARGATE')) {
    return Environment.APP_RUNNER
  }
  
  // Check if running in Docker
  if (process.env.DOCKER_ENV === 'true') {
    return Environment.DOCKER
  }
  
  // Check if we should use LocalStack (explicit opt-in only)
  if (process.env.USE_LOCALSTACK === 'true') {
    return Environment.LOCAL
  }
  
  // Default to real AWS services (APP_RUNNER mode)
  return Environment.APP_RUNNER
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
        }
      }
      
    case Environment.APP_RUNNER:
      return {
        environment,
        s3: {
          region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1'
        },
        dynamodb: {
          region: process.env.AWS_REGION || 'us-east-1'
        }
      }
      
    default:
      throw new Error(`Unknown environment: ${environment}`)
  }
}