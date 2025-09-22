const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { createTestPDF, cleanupTestFiles } = require('./helpers/testHelpers');

describe('Upload Middleware - Focused Coverage Tests', () => {
  let app;
  let testPdfPath;
  let testFilesToCleanup = [];

  beforeAll(async () => {
    // Create test Express app
    app = express();
    app.use(express.json());
    
    // Import middleware after app is created
    const { 
      uploadDocument, 
      uploadDocumentWithData, 
      uploadDocumentFromUrl, 
      validateUrl, 
      handleMulterErrors 
    } = require('../src/middleware/upload');

    // Single document upload route
    app.post('/upload', uploadDocument, (req, res) => {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }
      res.json({ success: true, file: req.file });
    });

    // Multiple files upload route
    app.post('/upload-multi', uploadDocumentWithData, (req, res) => {
      res.json({ success: true, files: req.files || {} });
    });

    // URL upload route
    app.post('/upload-url', uploadDocumentFromUrl, (req, res) => {
      res.json({ success: true, files: req.files || {} });
    });

    // URL validation route
    app.post('/validate', validateUrl, (req, res) => {
      res.json({ success: true, url: req.documentUrl });
    });

    // Test route for multer errors
    app.post('/test-multer-error', (req, res, next) => {
      // Simulate a multer error
      const multerError = new multer.MulterError('LIMIT_FIELD_COUNT', 'Too many fields');
      handleMulterErrors(multerError, req, res, next);
    }, (req, res) => {
      res.json({ success: true });
    });

    // Error handling
    app.use(handleMulterErrors);
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message
      });
    });

    testPdfPath = await createTestPDF('focused-test.pdf');
    testFilesToCleanup.push(testPdfPath);
  });

  afterAll(() => {
    cleanupTestFiles(testFilesToCleanup);
  });

  describe('Document Upload', () => {
    test('should upload PDF successfully', async () => {
      const response = await request(app)
        .post('/upload')
        .attach('document', testPdfPath);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.file.mimetype).toBe('application/pdf');
    });

    test('should reject non-PDF files', async () => {
      const txtFile = path.join(__dirname, 'fixtures', 'test.txt');
      fs.writeFileSync(txtFile, 'Not a PDF');
      testFilesToCleanup.push(txtFile);

      const response = await request(app)
        .post('/upload')
        .attach('document', txtFile);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Multiple File Upload', () => {
    test('should handle document and JSON data', async () => {
      const jsonFile = path.join(__dirname, 'fixtures', 'test.json');
      fs.writeFileSync(jsonFile, JSON.stringify({ test: 'data' }));
      testFilesToCleanup.push(jsonFile);

      const response = await request(app)
        .post('/upload-multi')
        .attach('document', testPdfPath)
        .attach('data', jsonFile);

      expect(response.status).toBe(200);
      expect(response.body.files.document).toBeDefined();
      expect(response.body.files.data).toBeDefined();
    });
  });

  describe('URL Validation', () => {
    test('should validate valid HTTPS URL', async () => {
      const response = await request(app)
        .post('/validate')
        .send({ documentUrl: 'https://example.com/doc.pdf' });

      expect(response.status).toBe(200);
      expect(response.body.url).toBe('https://example.com/doc.pdf');
    });

    test('should reject invalid URL', async () => {
      const response = await request(app)
        .post('/validate')
        .send({ documentUrl: 'invalid-url' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid URL');
    });

    test('should reject missing URL', async () => {
      const response = await request(app)
        .post('/validate')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Document URL is required');
    });

    test('should reject non-HTTP protocols', async () => {
      const response = await request(app)
        .post('/validate')
        .send({ documentUrl: 'ftp://example.com/file.pdf' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid URL protocol');
    });
  });

  describe('URL File Upload', () => {
    test('should handle JSON file for URL upload', async () => {
      const jsonFile = path.join(__dirname, 'fixtures', 'url.json');
      fs.writeFileSync(jsonFile, JSON.stringify({ url: 'test' }));
      testFilesToCleanup.push(jsonFile);

      const response = await request(app)
        .post('/upload-url')
        .attach('jsonData', jsonFile);

      expect(response.status).toBe(200);
      expect(response.body.files.jsonData).toBeDefined();
    });

    test('should reject non-JSON for URL upload', async () => {
      const response = await request(app)
        .post('/upload-url')
        .attach('jsonData', testPdfPath);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Only JSON files are allowed');
    });
  });

  describe('Multer Error Handling', () => {
    test('should handle multer error other than LIMIT_FILE_SIZE', async () => {
      const response = await request(app)
        .post('/test-multer-error');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Upload error');
    });

    test('should handle non-multer errors', async () => {
      const { handleMulterErrors } = require('../src/middleware/upload');
      const regularError = new Error('Regular error');
      const next = jest.fn();
      
      handleMulterErrors(regularError, {}, {}, next);
      
      expect(next).toHaveBeenCalledWith(regularError);
    });
  });
});
