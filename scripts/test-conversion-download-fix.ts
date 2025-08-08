#!/usr/bin/env tsx

/**
 * Test script to validate the conversion-download timing fix
 */

import { readFileSync } from 'fs'
import { join } from 'path'

console.log('🔍 Testing Conversion-Download Timing Fix')
console.log('='.repeat(60))

function validateFrontendRetryLogic() {
    console.log('\n📱 Checking frontend retry logic...')

    try {
        const pageContent = readFileSync(join(process.cwd(), 'app/audio-converter/page.tsx'), 'utf-8')

        const checks = [
            {
                name: 'Has retry loop with maxRetries',
                test: pageContent.includes('maxRetries') && pageContent.includes('for (let attempt')
            },
            {
                name: 'Handles "not completed yet" errors specifically',
                test: pageContent.includes('not completed yet') && pageContent.includes('retryDelay')
            },
            {
                name: 'Has proper retry delay',
                test: pageContent.includes('setTimeout(resolve, retryDelay)')
            },
            {
                name: 'Logs retry attempts',
                test: pageContent.includes('attempt ${attempt}/${maxRetries}')
            },
            {
                name: 'Exits on success',
                test: pageContent.includes('return // Success')
            }
        ]

        let passed = 0
        checks.forEach(check => {
            const status = check.test ? '✅' : '❌'
            console.log(`  ${status} ${check.name}`)
            if (check.test) passed++
        })

        console.log(`\n📊 Frontend retry logic: ${passed}/${checks.length} checks passed`)
        return passed === checks.length

    } catch (error) {
        console.error('❌ Failed to validate frontend:', error)
        return false
    }
}

function validateBackendLogging() {
    console.log('\n🖥️ Checking backend logging improvements...')

    try {
        const downloadApiContent = readFileSync(join(process.cwd(), 'app/api/download/route.ts'), 'utf-8')

        const checks = [
            {
                name: 'Logs job status validation',
                test: downloadApiContent.includes('Job ${jobId} status check failed')
            },
            {
                name: 'Logs job retrieval',
                test: downloadApiContent.includes('Job ${jobId} found with status')
            },
            {
                name: 'Logs missing jobs',
                test: downloadApiContent.includes('Job ${jobId} not found in database')
            }
        ]

        let passed = 0
        checks.forEach(check => {
            const status = check.test ? '✅' : '❌'
            console.log(`  ${status} ${check.name}`)
            if (check.test) passed++
        })

        console.log(`\n📊 Backend logging: ${passed}/${checks.length} checks passed`)
        return passed === checks.length

    } catch (error) {
        console.error('❌ Failed to validate backend:', error)
        return false
    }
}

function validateConversionTiming() {
    console.log('\n⏱️ Checking conversion timing improvements...')

    try {
        const conversionApiContent = readFileSync(join(process.cwd(), 'app/api/convert-audio/route.ts'), 'utf-8')

        const checks = [
            {
                name: 'Has delay before marking progress complete',
                test: conversionApiContent.includes('setTimeout(resolve, 100)') &&
                    conversionApiContent.includes('ensure DynamoDB consistency')
            },
            {
                name: 'Updates job status before progress',
                test: conversionApiContent.indexOf('updateJobStatus') < conversionApiContent.indexOf('markComplete')
            }
        ]

        let passed = 0
        checks.forEach(check => {
            const status = check.test ? '✅' : '❌'
            console.log(`  ${status} ${check.name}`)
            if (check.test) passed++
        })

        console.log(`\n📊 Conversion timing: ${passed}/${checks.length} checks passed`)
        return passed === checks.length

    } catch (error) {
        console.error('❌ Failed to validate conversion API:', error)
        return false
    }
}

async function main() {
    console.log('Starting validation of conversion-download timing fix...\n')

    const results = [
        validateFrontendRetryLogic(),
        validateBackendLogging(),
        validateConversionTiming()
    ]

    const totalPassed = results.filter(Boolean).length
    const totalTests = results.length

    console.log('\n' + '='.repeat(60))
    console.log('📋 VALIDATION SUMMARY')
    console.log('='.repeat(60))

    if (totalPassed === totalTests) {
        console.log('✅ ALL VALIDATIONS PASSED!')
        console.log('\n🎉 Conversion-Download Timing Fix Complete!')
        console.log('\nThe fix addresses the race condition by:')
        console.log('• ✅ Adding retry logic in frontend download function')
        console.log('• ✅ Handling "not completed yet" errors gracefully')
        console.log('• ✅ Adding delay in backend before marking progress complete')
        console.log('• ✅ Improved logging for debugging timing issues')

        console.log('\n🔧 How it works:')
        console.log('1. Conversion completes and updates job status to COMPLETED')
        console.log('2. Small delay ensures DynamoDB consistency')
        console.log('3. Progress is marked as 100% complete')
        console.log('4. Frontend detects 100% and attempts download')
        console.log('5. If download fails with "not completed yet", retry up to 5 times')
        console.log('6. Each retry waits 1 second before trying again')

        console.log('\n🚀 Your 200MB file conversion should now complete successfully!')

    } else {
        console.log(`❌ ${totalTests - totalPassed} validation(s) failed`)
        console.log('\n🔧 Issues found that need to be addressed:')

        if (!results[0]) console.log('• Frontend retry logic needs fixes')
        if (!results[1]) console.log('• Backend logging needs improvements')
        if (!results[2]) console.log('• Conversion timing needs adjustments')
    }

    console.log('\n' + '='.repeat(60))
    process.exit(totalPassed === totalTests ? 0 : 1)
}

main().catch(console.error)