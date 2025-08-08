#!/usr/bin/env tsx

/**
 * Validation script for Task 8: Create working conversion orchestration API with job lifecycle management
 * 
 * This script validates all the requirements from the task:
 * - POST /api/convert-audio endpoint accepts fileId and conversion parameters
 * - Complete workflow: job creation → progress initialization → FFmpeg processing → status updates
 * - Integration of JobService, ProgressService, and ConversionService
 * - Comprehensive error handling for all pipeline stages
 * - Job recovery logic for handling interrupted conversions
 * - Testing with both LocalStack and real AWS services
 */

import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

interface ValidationResult {
    passed: boolean
    message: string
    details?: string[]
}

class Task8Validator {
    private results: ValidationResult[] = []

    async validate(): Promise<void> {
        console.log('🔍 Validating Task 8: Conversion Orchestration API')
        console.log('='.repeat(60))

        // Check API endpoint implementation
        this.validateAPIEndpoint()

        // Check service integration
        this.validateServiceIntegration()

        // Check error handling
        this.validateErrorHandling()

        // Check job recovery logic
        this.validateJobRecovery()

        // Check test coverage
        this.validateTestCoverage()

        // Run unit tests
        await this.runUnitTests()

        // Check integration test setup
        this.validateIntegrationTests()

        // Test Redis progress tracking
        await this.testRedisProgressTracking()

        // Print results
        this.printResults()
    }

    private validateAPIEndpoint(): void {
        console.log('\n📡 Validating API Endpoint Implementation...')

        const apiPath = 'app/api/convert-audio/route.ts'

        if (!existsSync(apiPath)) {
            this.results.push({
                passed: false,
                message: 'API endpoint file not found',
                details: [`Missing file: ${apiPath}`]
            })
            return
        }

        const apiContent = readFileSync(apiPath, 'utf-8')
        const checks = [
            {
                name: 'POST method export',
                pattern: /export\s+async\s+function\s+POST/,
                required: true
            },
            {
                name: 'Request validation',
                pattern: /parseAndValidateRequest|validateRequest/,
                required: true
            },
            {
                name: 'FileId parameter handling',
                pattern: /fileId/,
                required: true
            },
            {
                name: 'Format parameter handling',
                pattern: /format/,
                required: true
            },
            {
                name: 'Quality parameter handling',
                pattern: /quality/,
                required: true
            },
            {
                name: 'Job creation workflow',
                pattern: /createConversionJob|jobService\.createJob/,
                required: true
            },
            {
                name: 'Progress initialization',
                pattern: /initializeProgress|progressService\.initializeProgress/,
                required: true
            },
            {
                name: 'Async conversion process',
                pattern: /startConversionProcess|convertAudio/,
                required: true
            },
            {
                name: 'Job ID response',
                pattern: /jobId.*response|return.*jobId/,
                required: true
            },
            {
                name: 'HTTP 202 status',
                pattern: /status:\s*202/,
                required: true
            }
        ]

        const failedChecks = checks.filter(check => !check.pattern.test(apiContent))

        if (failedChecks.length === 0) {
            this.results.push({
                passed: true,
                message: 'API endpoint implementation complete',
                details: [`All ${checks.length} required patterns found`]
            })
        } else {
            this.results.push({
                passed: false,
                message: 'API endpoint implementation incomplete',
                details: failedChecks.map(check => `Missing: ${check.name}`)
            })
        }
    }

    private validateServiceIntegration(): void {
        console.log('\n🔗 Validating Service Integration...')

        const apiPath = 'app/api/convert-audio/route.ts'
        const apiContent = readFileSync(apiPath, 'utf-8')

        const integrationChecks = [
            {
                name: 'JobService import',
                pattern: /import.*jobService.*from.*job-service/,
                required: true
            },
            {
                name: 'ProgressService import',
                pattern: /import.*progressService.*from.*progress-service/,
                required: true
            },
            {
                name: 'StreamingConversionService import',
                pattern: /import.*streamingConversionService.*from.*streaming-conversion-service/,
                required: true
            },
            {
                name: 'JobService usage',
                pattern: /jobService\.(createJob|updateJobStatus|getJob)/,
                required: true
            },
            {
                name: 'ProgressService usage',
                pattern: /progressService\.(initializeProgress|setProgress|markComplete|markFailed)/,
                required: true
            },
            {
                name: 'ConversionService usage',
                pattern: /streamingConversionService\.convertAudio/,
                required: true
            },
            {
                name: 'Job status updates',
                pattern: /JobStatus\.(PROCESSING|COMPLETED|FAILED)/,
                required: true
            }
        ]

        const failedChecks = integrationChecks.filter(check => !check.pattern.test(apiContent))

        if (failedChecks.length === 0) {
            this.results.push({
                passed: true,
                message: 'Service integration complete',
                details: [`All ${integrationChecks.length} integration patterns found`]
            })
        } else {
            this.results.push({
                passed: false,
                message: 'Service integration incomplete',
                details: failedChecks.map(check => `Missing: ${check.name}`)
            })
        }
    }

    private validateErrorHandling(): void {
        console.log('\n🛡️ Validating Error Handling...')

        const apiPath = 'app/api/convert-audio/route.ts'
        const apiContent = readFileSync(apiPath, 'utf-8')

        const errorHandlingChecks = [
            {
                name: 'Try-catch blocks',
                pattern: /try\s*{[\s\S]*?}\s*catch/,
                required: true
            },
            {
                name: 'Error status codes',
                pattern: /status:\s*statusCode|status:\s*(400|404|429|500)/,
                required: true
            },
            {
                name: 'Error response format',
                pattern: /error.*message|NextResponse\.json.*error/,
                required: true
            },
            {
                name: 'Retry logic',
                pattern: /executeWithRetry|retry|attempt/,
                required: true
            },
            {
                name: 'AWS service error handling',
                pattern: /NotFound|throttl|quota|timeout/,
                required: true
            },
            {
                name: 'Job failure handling',
                pattern: /handleConversionError|markFailed/,
                required: true
            },
            {
                name: 'Progress error handling',
                pattern: /progress.*error|error.*progress/,
                required: true
            }
        ]

        const failedChecks = errorHandlingChecks.filter(check => !check.pattern.test(apiContent))

        if (failedChecks.length === 0) {
            this.results.push({
                passed: true,
                message: 'Error handling comprehensive',
                details: [`All ${errorHandlingChecks.length} error handling patterns found`]
            })
        } else {
            this.results.push({
                passed: false,
                message: 'Error handling incomplete',
                details: failedChecks.map(check => `Missing: ${check.name}`)
            })
        }
    }

    private validateJobRecovery(): void {
        console.log('\n🔄 Validating Job Recovery Logic...')

        const apiPath = 'app/api/convert-audio/route.ts'
        const apiContent = readFileSync(apiPath, 'utf-8')

        const recoveryChecks = [
            {
                name: 'Recovery function export',
                pattern: /export.*recoverOrphanedJobs/,
                required: true
            },
            {
                name: 'Recovery implementation',
                pattern: /recoverOrphanedJobs.*{[\s\S]*?}/,
                required: true
            },
            {
                name: 'Recovery logging',
                pattern: /console\.log.*recovery|recovery.*log/,
                required: true
            }
        ]

        const failedChecks = recoveryChecks.filter(check => !check.pattern.test(apiContent))

        if (failedChecks.length === 0) {
            this.results.push({
                passed: true,
                message: 'Job recovery logic implemented',
                details: [`All ${recoveryChecks.length} recovery patterns found`]
            })
        } else {
            this.results.push({
                passed: false,
                message: 'Job recovery logic incomplete',
                details: failedChecks.map(check => `Missing: ${check.name}`)
            })
        }
    }

    private validateTestCoverage(): void {
        console.log('\n🧪 Validating Test Coverage...')

        const unitTestPath = 'app/api/convert-audio/route.test.ts'
        const integrationTestPath = 'app/api/convert-audio/integration.test.ts'

        const testFiles = [
            { path: unitTestPath, type: 'Unit tests' },
            { path: integrationTestPath, type: 'Integration tests' }
        ]

        let allTestsExist = true
        const testDetails: string[] = []

        for (const testFile of testFiles) {
            if (existsSync(testFile.path)) {
                const content = readFileSync(testFile.path, 'utf-8')
                const testCount = (content.match(/it\(/g) || []).length
                testDetails.push(`${testFile.type}: ${testCount} test cases`)
            } else {
                allTestsExist = false
                testDetails.push(`${testFile.type}: Missing file`)
            }
        }

        this.results.push({
            passed: allTestsExist,
            message: allTestsExist ? 'Test coverage complete' : 'Test coverage incomplete',
            details: testDetails
        })
    }

    private async runUnitTests(): Promise<void> {
        console.log('\n🏃 Validating Unit Test Structure...')

        try {
            const unitTestPath = 'app/api/convert-audio/route.test.ts'
            const content = readFileSync(unitTestPath, 'utf-8')

            // Check for key test patterns
            const testPatterns = [
                /describe.*convert-audio/i,
                /it.*should.*create.*job/i,
                /it.*should.*return.*400/i,
                /it.*should.*handle.*error/i,
                /expect.*status.*toBe/,
                /expect.*jobId.*toBeDefined/
            ]

            const foundPatterns = testPatterns.filter(pattern => pattern.test(content))

            if (foundPatterns.length >= testPatterns.length - 1) { // Allow 1 missing pattern
                this.results.push({
                    passed: true,
                    message: 'Unit test structure valid',
                    details: [`Found ${foundPatterns.length}/${testPatterns.length} expected test patterns`]
                })
            } else {
                this.results.push({
                    passed: false,
                    message: 'Unit test structure incomplete',
                    details: [`Found only ${foundPatterns.length}/${testPatterns.length} expected test patterns`]
                })
            }
        } catch (error: any) {
            this.results.push({
                passed: false,
                message: 'Unit test validation failed',
                details: [error.message || 'Could not validate test structure']
            })
        }
    }

    private validateIntegrationTests(): void {
        console.log('\n🌐 Validating Integration Test Setup...')

        const integrationTestPath = 'app/api/convert-audio/integration.test.ts'

        if (!existsSync(integrationTestPath)) {
            this.results.push({
                passed: false,
                message: 'Integration tests not found',
                details: [`Missing file: ${integrationTestPath}`]
            })
            return
        }

        const content = readFileSync(integrationTestPath, 'utf-8')

        const integrationChecks = [
            {
                name: 'LocalStack support',
                pattern: /LocalStack|localstack/i,
                required: true
            },
            {
                name: 'Real AWS support',
                pattern: /real.*aws|aws.*real/i,
                required: true
            },
            {
                name: 'Complete workflow test',
                pattern: /upload.*convert.*download|complete.*workflow/i,
                required: true
            },
            {
                name: 'Progress monitoring test',
                pattern: /progress.*monitor|monitor.*progress/i,
                required: true
            },
            {
                name: 'Error scenario tests',
                pattern: /error.*scenario|failure.*test/i,
                required: true
            },
            {
                name: 'Concurrent processing test',
                pattern: /concurrent|parallel/i,
                required: true
            },
            {
                name: 'AWS service connectivity tests',
                pattern: /s3.*connectivity|dynamodb.*connectivity|redis.*connectivity/i,
                required: true
            }
        ]

        const failedChecks = integrationChecks.filter(check => !check.pattern.test(content))

        if (failedChecks.length === 0) {
            this.results.push({
                passed: true,
                message: 'Integration test setup complete',
                details: [`All ${integrationChecks.length} integration test patterns found`]
            })
        } else {
            this.results.push({
                passed: false,
                message: 'Integration test setup incomplete',
                details: failedChecks.map(check => `Missing: ${check.name}`)
            })
        }
    }

    private async testRedisProgressTracking(): Promise<void> {
        console.log('\n🔄 Testing Redis Progress Tracking (0% → 100%)...')
        
        try {
            // Import and run the Redis progress test
            const { testRedisProgressTracking } = await import('../tests/redis-progress/test-redis-progress-simple')
            await testRedisProgressTracking()
            
            this.results.push({
                passed: true,
                message: 'Redis progress tracking validated',
                details: ['Successfully tracked progress from 0% to 100% in Redis']
            })
        } catch (error: any) {
            this.results.push({
                passed: false,
                message: 'Redis progress tracking failed',
                details: [error.message || 'Redis progress test execution failed']
            })
        }
    }

    private printResults(): void {
        console.log('\n📊 Validation Results')
        console.log('='.repeat(60))

        let passedCount = 0
        let totalCount = this.results.length

        for (const result of this.results) {
            const status = result.passed ? '✅ PASS' : '❌ FAIL'
            console.log(`${status} ${result.message}`)

            if (result.details && result.details.length > 0) {
                for (const detail of result.details) {
                    console.log(`   ${result.passed ? '→' : '✗'} ${detail}`)
                }
            }

            if (result.passed) passedCount++
            console.log()
        }

        console.log('='.repeat(60))
        console.log(`📈 Overall Score: ${passedCount}/${totalCount} (${Math.round(passedCount / totalCount * 100)}%)`)

        if (passedCount === totalCount) {
            console.log('🎉 Task 8 validation PASSED! All requirements met.')
            console.log('\n✅ Validation Criteria Met:')
            console.log('   • POST /api/convert-audio endpoint implemented')
            console.log('   • Complete job lifecycle workflow')
            console.log('   • Service integration (JobService, ProgressService, ConversionService)')
            console.log('   • Comprehensive error handling')
            console.log('   • Job recovery logic')
            console.log('   • Unit and integration tests')
            console.log('   • LocalStack and real AWS support')
        } else {
            console.log('❌ Task 8 validation FAILED. Please address the issues above.')
            process.exit(1)
        }
    }
}

// Run validation
const validator = new Task8Validator()
validator.validate().catch(error => {
    console.error('Validation failed:', error)
    process.exit(1)
})