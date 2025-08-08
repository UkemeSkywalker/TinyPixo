const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');

async function testUpload() {
  try {
    // Create a test audio file
    const testContent = Buffer.alloc(1024 * 1024, 'a'); // 1MB test file
    fs.writeFileSync('test-audio.mp3', testContent);
    
    // Create form data
    const form = new FormData();
    form.append('file', fs.createReadStream('test-audio.mp3'), {
      filename: 'test-audio.mp3',
      contentType: 'audio/mpeg'
    });
    
    console.log('Testing upload endpoint...');
    
    // Make request
    const response = await fetch('http://localhost:3000/api/upload-audio', {
      method: 'POST',
      body: form
    });
    
    const result = await response.json();
    
    console.log('Response status:', response.status);
    console.log('Response body:', JSON.stringify(result, null, 2));
    
    // Clean up
    fs.unlinkSync('test-audio.mp3');
    
    if (response.status === 200) {
      console.log('✅ Upload test passed!');
    } else {
      console.log('❌ Upload test failed!');
    }
    
  } catch (error) {
    console.error('Test error:', error);
  }
}

testUpload();