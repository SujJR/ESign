const path = require('path');

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing';
process.env.MONGODB_URI = 'mongodb://localhost:27017/esign-test';
process.env.PORT = '3001';

// Adobe Sign test environment variables
process.env.ADOBE_SIGN_CLIENT_ID = 'test-adobe-client-id';
process.env.ADOBE_SIGN_CLIENT_SECRET = 'test-adobe-client-secret';
process.env.ADOBE_SIGN_REFRESH_TOKEN = 'test-adobe-refresh-token';
process.env.ADOBE_SIGN_BASE_URL = 'https://api.adobesign.com';

// Mock winston logger to prevent file operations during tests
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    errors: jest.fn(),
    json: jest.fn(),
    simple: jest.fn(),
    colorize: jest.fn(),
    printf: jest.fn(),
  },
  transports: {
    Console: jest.fn(),
    File: jest.fn(),
  },
}));

// Mock file system operations that might interfere with tests
const fs = require('fs');
const originalWriteFileSync = fs.writeFileSync;
const originalMkdirSync = fs.mkdirSync;

// Override certain file operations for testing
fs.writeFileSync = jest.fn((path, data, options) => {
  // Allow writing to test fixtures, but prevent writing to actual logs/uploads
  if (path.includes('/tests/fixtures/') || path.includes('/tmp/')) {
    return originalWriteFileSync(path, data, options);
  }
  // Mock other write operations
  return true;
});

fs.mkdirSync = jest.fn((path, options) => {
  // Allow creating test directories
  if (path.includes('/tests/fixtures/') || path.includes('/tmp/')) {
    return originalMkdirSync(path, options);
  }
  // Mock other directory creation
  return true;
});

module.exports = {};
