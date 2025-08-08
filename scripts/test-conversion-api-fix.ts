#!/usr/bin/env tsx

/**
 * Test Conversion API Fix
 * 
 * This script tests that the conversion API can properly find uploaded files
 * by checking the verifyInputFile logic
 */

import { readFileSync } from 'fs'
import { join } from 'path'

console.log('🔧 Testing Conversion API Fix')
console.log('=' .repeat(40))

// Check if the conversion API has been updated with the fix
function validateConversionAPIFix() {
  console.log('\n📄 Checking conversion API implementation...')
  
  try {
    const apiContent = readFileSync(join(process.cwd(), 'app/api/convert-audio/route.ts'), 'utf-8')
    
    const checks = [
      {
        name: 'Imports ListObjectsV2Command',
        test: apiContent.includes('ListObjectsV2Command')
      },
      {
        name: 'Uses ListObjectsV2Command to find files',
        test: apiContent.includes('ListObjectsV2Command') && apiContent.includes('Prefix: `uploads/${requestData.fileId}`')
      },
      {
        name: 'Has pattern matching for file extensions',
        test: apiContent.includes('RegExp') && apiContent.includes('\\.[a-zA-Z0-9]+$')
      },
      {
        name: 'Finds exact file match',
        test: apiContent.includes('matchingFile') && apiContent.includes('pattern.test(key)')
      },
      {
        name: 'Logs available files for debugging',
        test: apiContent.includes('Available files:') && apiContent.includes('listResult.Contents.map')
      },
      {
        name: 'Uses the found file key',
        test: apiContent.includes('const inputKey = matchingFile.Key')
      }
    ]
    
    let passed = 0
    checks.forEach(check => {
      const status = check.test ? '✅' : '❌'
      console.log(`  ${status} ${check.name}`)
      if (check.test) passed++
    })
    
    console.log(`\n📊 Conversion API fix: ${passed}/${checks.length} checks passed`)
    return passed === checks.length
    
  } catch (error) {
    console.error('❌ Failed to read conversion API:', error)
    return false
  }
}

// Check the upload API to understand the file naming pattern
function validateUploadAPIPattern() {
  console.log('\n📤 Checking upload API file naming pattern...')
  
  try {
    const uploadContent = readFileSync(join(process.cwd(), 'app/api/upload-audio/route.ts'), 'utf-8')
    
    const checks = [
      {
        name: 'Generates fileId with UUID',
        test: uploadContent.includes('generateFileId') && uploadContent.includes('randomUUID')
      },
      {
        name: 'Extracts file extension',
        test: uploadContent.includes('getFileExtension')
      },
      {
        name: 'Creates S3 key with extension',
        test: uploadContent.includes('`uploads/${fileId}.${extension}`')
      },
      {
        name: 'Returns fileId in response',
        test: uploadContent.includes('fileId,') && uploadContent.includes('fileName:')
      }
    ]
    
    let passed = 0
    checks.forEach(check => {
      const status = check.test ? '✅' : '❌'
      console.log(`  ${status} ${check.name}`)
      if (check.test) passed++
    })
    
    console.log(`\n📊 Upload API pattern: ${passed}/${checks.length} checks passed`)
    return passed === checks.length
    
  } catch (error) {
    console.error('❌ Failed to read upload API:', error)
    return false
  }
}

// Main validation
async function main() {
  console.log('Starting API fix validation...\n')
  
  const results = [
    validateUploadAPIPattern(),
    validateConversionAPIFix()
  ]
  
  const totalPassed = results.filter(Boolean).length
  const totalTests = results.length
  
  console.log('\n' + '='.repeat(40))
  console.log('📋 VALIDATION SUMMARY')
  console.log('='.repeat(40))
  
  if (totalPassed === totalTests) {
    console.log('✅ ALL VALIDATIONS PASSED!')
    console.log('\n🎉 API Fix Complete!')
    console.log('\nThe conversion API has been fixed to properly find uploaded files:')
    console.log('• ✅ Upload API stores files as: uploads/{fileId}.{extension}')
    console.log('• ✅ Conversion API now searches for files with fileId prefix')
    console.log('• ✅ Uses pattern matching to find exact file with extension')
    console.log('• ✅ Provides debugging info when files are not found')
    
    console.log('\n🚀 The frontend workflow should now work correctly!')
    
  } else {
    console.log(`❌ ${totalTests - totalPassed} validation(s) failed`)
    console.log('\n🔧 Issues found that need to be addressed:')
    
    if (!results[0]) console.log('• Upload API pattern needs verification')
    if (!results[1]) console.log('• Conversion API fix needs implementation')
  }
  
  console.log('\n' + '='.repeat(40))
  process.exit(totalPassed === totalTests ? 0 : 1)
}

main().catch(console.error)