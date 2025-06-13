#!/usr/bin/env node

/**
 * API Key Generator Utility
 * 
 * This script generates initial API keys for the ESign application.
 * Run this script to create your first admin API key.
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const ApiKey = require('./src/models/apiKey.model');

// Load environment variables
dotenv.config();

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const generateApiKey = async (name, permissions, options = {}) => {
  try {
    const { apiKey, keyId, prefix, keyHash } = ApiKey.generateApiKey();
    
    const apiKeyDoc = await ApiKey.create({
      name,
      keyId,
      keyHash,
      prefix,
      permissions,
      expiresAt: options.expiresAt || null,
      allowedIPs: options.allowedIPs || [],
      rateLimit: {
        requestsPerMinute: options.requestsPerMinute || 100,
        requestsPerHour: options.requestsPerHour || 1000
      },
      metadata: options.metadata || {},
      createdBy: 'system'
    });
    
    console.log('\n✅ API Key Created Successfully!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Name: ${name}`);
    console.log(`API Key: ${apiKey}`);
    console.log(`Key ID: ${keyId}`);
    console.log(`Permissions: ${permissions.join(', ')}`);
    console.log(`Rate Limit: ${apiKeyDoc.rateLimit.requestsPerMinute}/min, ${apiKeyDoc.rateLimit.requestsPerHour}/hour`);
    if (options.expiresAt) {
      console.log(`Expires: ${options.expiresAt.toISOString()}`);
    } else {
      console.log('Expires: Never');
    }
    console.log('═══════════════════════════════════════════════════════════');
    console.log('⚠️  IMPORTANT: Store this API key securely!');
    console.log('   This is the only time the full key will be displayed.');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    return { apiKey, keyId, apiKeyDoc };
  } catch (error) {
    console.error('Error creating API key:', error);
    throw error;
  }
};

const generateInitialKeys = async () => {
  try {
    console.log('🚀 ESign API Key Generator');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    await connectDB();
    
    // Check if any API keys already exist
    const existingKeys = await ApiKey.countDocuments();
    
    if (existingKeys > 0) {
      console.log(`⚠️  Found ${existingKeys} existing API key(s).`);
      console.log('Do you want to create additional keys? (y/N)');
      
      // For automated scripts, we'll assume "no" unless FORCE_CREATE is set
      if (!process.env.FORCE_CREATE) {
        console.log('Skipping key creation. Set FORCE_CREATE=true to override.');
        process.exit(0);
      }
    }
    
    // Generate admin API key
    const adminKey = await generateApiKey(
      'Admin API Key',
      ['admin:all'],
      {
        requestsPerMinute: 500,
        requestsPerHour: 5000,
        metadata: {
          description: 'Full admin access API key',
          createdBy: 'initial-setup'
        }
      }
    );
    
    // Generate document management API key
    const docKey = await generateApiKey(
      'Document Management API Key',
      ['documents:read', 'documents:write', 'documents:send'],
      {
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        metadata: {
          description: 'Document management operations',
          createdBy: 'initial-setup'
        }
      }
    );
    
    // Generate read-only API key
    const readOnlyKey = await generateApiKey(
      'Read-Only API Key',
      ['documents:read', 'logs:read'],
      {
        requestsPerMinute: 200,
        requestsPerHour: 2000,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
        metadata: {
          description: 'Read-only access for monitoring and reporting',
          createdBy: 'initial-setup'
        }
      }
    );
    
    console.log('🎉 Initial API keys generated successfully!');
    console.log('\nQuick Start:');
    console.log('1. Use the Admin API Key to manage other keys');
    console.log('2. Use the Document Management key for regular operations');
    console.log('3. Use the Read-Only key for monitoring');
    console.log('\nAPI Usage Examples:');
    console.log(`curl -H "X-API-Key: ${adminKey.apiKey}" http://localhost:3000/api/documents`);
    console.log(`curl -H "Authorization: Bearer ${docKey.apiKey}" http://localhost:3000/api/documents`);
    console.log('\n📝 Save these keys in a secure location!');
    
  } catch (error) {
    console.error('❌ Error generating API keys:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

// Command line interface
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
ESign API Key Generator

Usage:
  node generate-api-keys.js [options]

Options:
  --help, -h     Show this help message
  --force        Force creation even if keys exist
  
Environment Variables:
  FORCE_CREATE=true   Force creation of new keys
  MONGODB_URI        MongoDB connection string

Examples:
  node generate-api-keys.js
  FORCE_CREATE=true node generate-api-keys.js
  `);
  process.exit(0);
}

if (args.includes('--force')) {
  process.env.FORCE_CREATE = 'true';
}

// Run the generator
generateInitialKeys();
