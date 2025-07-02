/**
 * Generate a test API key for development
 */
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Generate a random API key
const apiKey = crypto.randomBytes(32).toString('hex');
console.log(`Generated API key: ${apiKey}`);

// Check if we have an .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  console.log('Found .env file, appending API_KEY');
  
  // Read the current .env file
  let envContent = fs.readFileSync(envPath, 'utf8');
  
  // Check if API_KEY already exists
  if (envContent.includes('API_KEY=')) {
    console.log('API_KEY already exists in .env file');
    // Replace the existing API_KEY
    envContent = envContent.replace(/API_KEY=.*\n?/, `API_KEY=${apiKey}\n`);
  } else {
    // Append the API_KEY
    envContent += `\nAPI_KEY=${apiKey}\n`;
  }
  
  // Write the updated content back to .env
  fs.writeFileSync(envPath, envContent);
  console.log('Updated .env file with new API_KEY');
  
} else {
  console.log('No .env file found, creating one with API_KEY');
  
  // Create a new .env file with just the API_KEY
  fs.writeFileSync(envPath, `API_KEY=${apiKey}\n`);
  console.log('Created .env file with API_KEY');
}

// Output a test curl command to validate the API key
console.log('\nTest with:');
console.log(`curl -X GET http://localhost:3000/api/health -H "X-API-Key: ${apiKey}"`);
