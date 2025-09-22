# ESign PDF Upload Testing

This directory contains comprehensive Jest tests for the PDF upload functionality in the ESign application.

## 🧪 Test Structure

```
tests/
├── setup.js                    # Jest configuration and MongoDB setup
├── config.js                   # Test environment configuration
├── helpers/
│   └── testHelpers.js          # Utility functions for creating test data
├── fixtures/                   # Test files and data
│   └── uploads/                # Temporary upload directory for tests
├── pdf-upload.test.js          # Main PDF upload functionality tests
├── upload-middleware.test.js   # Upload middleware specific tests
└── document-model.test.js      # Document model validation tests
```

## 🚀 Running Tests

### Quick Start
```bash
# Run all tests
npm test

# Run specific test suites
npm run test:pdf        # PDF upload functionality
npm run test:upload     # Upload middleware
npm run test:model      # Document model
npm run test:all        # All tests with verbose output

# Test with coverage report
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### Individual Test Files
```bash
# Run a specific test file
npx jest tests/pdf-upload.test.js --verbose

# Run tests matching a pattern
npx jest --testNamePattern="should upload PDF"

# Run tests for a specific describe block
npx jest --testNamePattern="Error Handling"
```

## 📋 Test Coverage

The tests cover the following areas:

### 1. PDF Upload Functionality (`pdf-upload.test.js`)
- ✅ File upload with template data
- ✅ Multiple recipients handling
- ✅ Different signing flows (SEQUENTIAL/PARALLEL)
- ✅ URL-based document upload
- ✅ Adobe Sign integration
- ✅ Error handling and validation
- ✅ Security and authentication
- ✅ Performance testing
- ✅ Concurrent uploads

### 2. Upload Middleware (`upload-middleware.test.js`)
- ✅ File type validation (PDF, DOCX, DOC)
- ✅ File size limits (10MB)
- ✅ MIME type checking
- ✅ Multiple file uploads
- ✅ Unique filename generation
- ✅ Storage directory handling
- ✅ Error handling

### 3. Document Model (`document-model.test.js`)
- ✅ Schema validation
- ✅ Required fields checking
- ✅ Enum value validation
- ✅ Default values
- ✅ Document operations (create, update)
- ✅ Recipient management
- ✅ Template data storage
- ✅ Query operations
- ✅ Edge cases

## 🛠️ Test Environment Setup

### Prerequisites
```bash
# Install test dependencies
npm install --save-dev jest supertest mongodb-memory-server pdfkit
```

### Environment Variables
The tests use the following environment variables (automatically set in test config):
```
NODE_ENV=test
JWT_SECRET=test-jwt-secret-key-for-testing
MONGODB_URI=mongodb://localhost:27017/esign-test
ADOBE_SIGN_CLIENT_ID=test-adobe-client-id
ADOBE_SIGN_CLIENT_SECRET=test-adobe-client-secret
ADOBE_SIGN_REFRESH_TOKEN=test-adobe-refresh-token
```

### Database
Tests use an in-memory MongoDB instance provided by `mongodb-memory-server`, so no external database setup is required.

## 🎯 Writing New Tests

### Test File Structure
```javascript
const request = require('supertest');
const { createTestPDF, createTestTemplateData } = require('./helpers/testHelpers');

describe('Your Test Suite', () => {
  let testData;

  beforeAll(async () => {
    // Setup that runs once before all tests
  });

  beforeEach(async () => {
    // Setup that runs before each test
    testData = createTestTemplateData();
  });

  afterEach(async () => {
    // Cleanup after each test
  });

  afterAll(async () => {
    // Cleanup after all tests
  });

  test('should do something', async () => {
    // Your test code here
    expect(result).toBe(expected);
  });
});
```

### Using Test Helpers
```javascript
const {
  createTestPDF,
  createTestTemplateData,
  createTestApiKey,
  cleanupTestFiles,
  mockAdobeSignResponses
} = require('./helpers/testHelpers');

// Create a test PDF file
const testPdfPath = await createTestPDF('my-test.pdf', 'Custom content');

// Create template data with recipients
const templateData = createTestTemplateData({
  customField: 'value',
  recipients: [
    { name: 'John Doe', email: 'john@test.com' }
  ]
});

// Create API key for authentication
const apiKey = createTestApiKey();
```

### Mocking External Services
```javascript
// Mock Adobe Sign API
jest.mock('../src/config/adobeSign', () => ({
  uploadTransientDocument: jest.fn().mockResolvedValue({ 
    transientDocumentId: 'mock-id' 
  }),
  createAgreement: jest.fn().mockResolvedValue({ 
    id: 'mock-agreement-id' 
  })
}));

// Mock file operations
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn()
}));
```

## 🔍 Test Debugging

### Running Tests in Debug Mode
```bash
# Run with Node.js debugging
node --inspect-brk node_modules/.bin/jest tests/pdf-upload.test.js

# Run with verbose output
npm run test:pdf -- --verbose

# Run specific test by name
npm test -- --testNamePattern="should upload PDF successfully"
```

### Common Debugging Tips
1. Use `console.log()` in tests for debugging
2. Check test setup in `setup.js` for database issues
3. Verify mock implementations for external service calls
4. Use `--detectOpenHandles` to find hanging promises
5. Check file cleanup in test helpers

## 📊 Coverage Reports

Coverage reports are generated in the `coverage/` directory:
```bash
npm run test:coverage
open coverage/lcov-report/index.html  # View HTML report
```

Coverage targets:
- Lines: 80%+
- Functions: 80%+
- Branches: 75%+
- Statements: 80%+

## 🚨 Troubleshooting

### Common Issues

**MongoDB Connection Issues**
```bash
# Clear Jest cache
npx jest --clearCache

# Check if MongoDB memory server is properly installed
npm list mongodb-memory-server
```

**File Upload Issues**
```bash
# Ensure uploads directory exists
mkdir -p tests/fixtures/uploads

# Check file permissions
ls -la tests/fixtures/
```

**Adobe Sign Mock Issues**
```bash
# Verify mock implementation
npm test -- --testNamePattern="Adobe Sign" --verbose
```

### Test Performance
- Tests should complete within 30 seconds
- Individual tests should complete within 5 seconds
- Use `jest.setTimeout(30000)` for longer operations

## 📝 Contributing

When adding new tests:
1. Follow the existing test structure
2. Use descriptive test names
3. Include both positive and negative test cases
4. Add error handling tests
5. Update this README if adding new test categories
6. Ensure tests clean up after themselves

## 🔗 Related Documentation

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [MongoDB Memory Server](https://github.com/nodkz/mongodb-memory-server)
- [Adobe Sign API Documentation](https://opensource.adobe.com/acrobat-sign/)
