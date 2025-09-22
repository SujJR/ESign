#!/usr/bin/env node

/**
 * Test Runner Script for ESign PDF Upload Testing
 * 
 * This script provides easy commands to run different test suites:
 * - npm run test:pdf - Run PDF upload tests
 * - npm run test:upload - Run upload middleware tests  
 * - npm run test:model - Run document model tests
 * - npm run test:all - Run all tests
 * - npm run test:coverage - Run tests with coverage report
 */

const { spawn } = require('child_process');
const path = require('path');

const testSuites = {
  pdf: 'tests/pdf-upload.test.js',
  upload: 'tests/upload-middleware.test.js',
  model: 'tests/document-model.test.js',
  all: 'tests/',
  coverage: '--coverage tests/'
};

const runTest = (testPath, options = []) => {
  console.log(`🧪 Running tests: ${testPath}\n`);
  
  const jestArgs = [
    testPath,
    '--verbose',
    '--colors',
    '--detectOpenHandles',
    '--forceExit',
    ...options
  ];

  const jest = spawn('npx', ['jest', ...jestArgs], {
    stdio: 'inherit',
    cwd: process.cwd()
  });

  jest.on('close', (code) => {
    if (code === 0) {
      console.log(`\n✅ Tests completed successfully!`);
    } else {
      console.log(`\n❌ Tests failed with exit code ${code}`);
    }
    process.exit(code);
  });

  jest.on('error', (err) => {
    console.error(`❌ Failed to start test runner: ${err.message}`);
    process.exit(1);
  });
};

const command = process.argv[2];
const suite = testSuites[command];

if (!suite) {
  console.log(`
🧪 ESign PDF Upload Test Runner

Available commands:
  npm run test:pdf      - Run PDF upload functionality tests
  npm run test:upload   - Run upload middleware tests
  npm run test:model    - Run document model tests
  npm run test:all      - Run all tests
  npm run test:coverage - Run all tests with coverage report

Examples:
  npm run test:pdf
  npm run test:coverage
  npm test
  `);
  process.exit(1);
}

// Handle coverage option
if (command === 'coverage') {
  runTest('tests/', ['--coverage', '--collectCoverageFrom=src/**/*.js']);
} else {
  runTest(suite);
}
