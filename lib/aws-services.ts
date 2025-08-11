import { S3Client, CreateBucketCommand, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, UpdateTimeToLiveCommand } from '@aws-sdk/client-dynamodb'
import { createClient, RedisClientType } from 'redis'
import { getEnvironmentConfig, Environment } from './environment'

const config = getEnvironmentConfig()

// S3 Client
export const s3Client = new S3Client({
    region: config.s3.region,
    endpoint: config.s3.endpoint,
    credentials: config.s3.credentials,
    forcePathStyle: config.s3.forcePathStyle
})

// DynamoDB Client
export const dynamodbClient = new DynamoDBClient({
    region: config.dynamodb.region,
    endpoint: config.dynamodb.endpoint,
    credentials: config.dynamodb.credentials
})

// Redis Client
let redisClient: RedisClientType | null = null

export async function getRedisClient(): Promise<RedisClientType | null> {
    if (!redisClient) {
        // Check if Redis is properly configured
        if (!process.env.REDIS_ENDPOINT && config.environment === Environment.APP_RUNNER) {
            console.log('[Redis] No REDIS_ENDPOINT configured for App Runner, skipping Redis initialization')
            return null
        }

        const redisUrl = config.redis.tls
            ? `rediss://${config.redis.host}:${config.redis.port}`
            : `redis://${config.redis.host}:${config.redis.port}`

        console.log(`[Redis] Connecting to: ${redisUrl}`)
        console.log(`[Redis] TLS enabled: ${config.redis.tls}`)
        console.log(`[Redis] Environment: ${config.environment}`)

        try {
            redisClient = createClient({
                url: redisUrl,
                socket: {
                    connectTimeout: config.environment === Environment.APP_RUNNER ? 5000 : 30000, // Fast fail in production
                    tls: config.redis.tls, // Boolean flag for TLS
                    rejectUnauthorized: false // For ElastiCache TLS
                },
                commandsQueueMaxLength: 1000
            })

            redisClient.on('error', (err) => {
                console.error('Redis client error:', err)
                // Don't throw here, let the connection attempt handle it
            })

            redisClient.on('connect', () => {
                console.log('[Redis] Connected successfully')
            })

            redisClient.on('ready', () => {
                console.log('[Redis] Client ready')
            })

            redisClient.on('reconnecting', () => {
                console.log('[Redis] Reconnecting...')
            })

            // Add timeout wrapper for connection
            const connectionPromise = redisClient.connect()
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Redis connection timeout')), 
                    config.environment === Environment.APP_RUNNER ? 5000 : 30000)
            })

            await Promise.race([connectionPromise, timeoutPromise])
            console.log('[Redis] Connection established successfully')
        } catch (error) {
            console.error('[Redis] Failed to connect, will use DynamoDB fallback:', error)
            redisClient = null
            return null
        }
    }

    return redisClient
}

// Service initialization functions
export async function initializeS3(): Promise<void> {
    const bucketName = process.env.S3_BUCKET_NAME || 'audio-conversion-bucket'

    try {
        // Check if bucket exists
        await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }))
        console.log(`S3 bucket '${bucketName}' already exists`)
    } catch (error) {
        // Bucket doesn't exist, create it
        console.log(`Creating S3 bucket '${bucketName}'...`)
        await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }))

        console.log(`S3 bucket '${bucketName}' created (folders will be created when files are uploaded)`)
    }
}

export async function initializeDynamoDB(): Promise<void> {
    const tableName = 'audio-conversion-jobs'

    try {
        console.log(`Checking if DynamoDB table '${tableName}' exists...`)
        console.log(`DynamoDB endpoint: ${config.dynamodb.endpoint}`)

        // Add timeout to the operation
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('DynamoDB operation timed out after 10 seconds')), 10000)
        })

        // Check if table exists with timeout
        const result = await Promise.race([
            dynamodbClient.send(new DescribeTableCommand({ TableName: tableName })),
            timeoutPromise
        ]) as any

        console.log(`DynamoDB table '${tableName}' already exists (status: ${result.Table?.TableStatus})`)
    } catch (error: any) {
        console.log(`DynamoDB table check error: ${error.name}`)
        if (error.name === 'ResourceNotFoundException') {
            // Table doesn't exist, create it
            console.log(`Creating DynamoDB table '${tableName}'...`)
            try {
                await dynamodbClient.send(new CreateTableCommand({
                    TableName: tableName,
                    KeySchema: [
                        { AttributeName: 'jobId', KeyType: 'HASH' }
                    ],
                    AttributeDefinitions: [
                        { AttributeName: 'jobId', AttributeType: 'S' }
                    ],
                    BillingMode: 'PAY_PER_REQUEST'
                }))

                console.log(`DynamoDB table '${tableName}' created successfully`)

                // Wait a moment for table to be active, then configure TTL
                console.log('Waiting for table to be active before configuring TTL...')
                await new Promise(resolve => setTimeout(resolve, 3000))

                console.log('Configuring TTL...')
                await dynamodbClient.send(new UpdateTimeToLiveCommand({
                    TableName: tableName,
                    TimeToLiveSpecification: {
                        AttributeName: 'ttl',
                        Enabled: true
                    }
                }))

                console.log(`DynamoDB table '${tableName}' TTL configuration applied successfully`)
            } catch (createError) {
                console.error('Error creating DynamoDB table:', createError)
                throw createError
            }
        } else {
            console.error('Unexpected DynamoDB error:', error)
            throw error
        }
    }
}

export async function initializeRedis(): Promise<void> {
    try {
        console.log('Connecting to Redis...')
        const redis = await getRedisClient()
        
        if (!redis) {
            console.log('Redis not available, will use DynamoDB fallback for progress tracking')
            return
        }

        console.log('Redis client obtained, testing connection...')

        // Test Redis connection
        console.log('Setting test key...')
        await redis.set('test-key', 'test-value')
        console.log('Getting test key...')
        const value = await redis.get('test-key')

        if (value === 'test-value') {
            console.log('Redis connection test successful')
            console.log('Cleaning up test key...')
            await redis.del('test-key')
            console.log('Redis initialization completed successfully')
        } else {
            throw new Error('Redis connection test failed')
        }
    } catch (error) {
        console.error('Redis initialization error, will use DynamoDB fallback:', error)
        // Don't throw error - allow app to start with DynamoDB fallback
    }
}

// Initialize all services
export async function initializeAllServices(): Promise<void> {
    console.log(`Initializing services for environment: ${config.environment}`)

    try {
        console.log('Step 1: Initializing S3...')
        await initializeS3()
        console.log('Step 1: S3 initialization completed')

        console.log('Step 2: Initializing DynamoDB...')
        await initializeDynamoDB()
        console.log('Step 2: DynamoDB initialization completed')

        console.log('Step 3: Initializing Redis...')
        await initializeRedis()
        console.log('Step 3: Redis initialization completed (or skipped with fallback)')

        console.log('🎉 All services initialized successfully!')
    } catch (error) {
        console.error('💥 Failed to initialize services:', error)
        throw error
    }
}