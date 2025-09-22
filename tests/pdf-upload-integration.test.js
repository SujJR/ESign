const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

// Import models
const Document = require('../src/models/document.model');

// Import test helpers
const {
  createTestPDF,
  createTestTemplateData,
  cleanupTestFiles
} = require('./helpers/testHelpers');

// Mock external dependencies
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../src/utils/organizationLogger', () => ({
  logActivity: jest.fn()
}));

// Mock Adobe Sign to avoid external API calls
jest.mock('../src/config/adobeSign', () => ({
  getAccessToken: jest.fn().mockResolvedValue('mock-access-token'),
  uploadTransientDocument: jest.fn().mockResolvedValue({
    transientDocumentId: 'mock-transient-doc-id'
  }),
  createAgreement: jest.fn().mockResolvedValue({
    id: 'mock-agreement-id',
    status: 'OUT_FOR_SIGNATURE'
  }),
  getSigningUrl: jest.fn().mockResolvedValue({
    signingUrls: [
      { email: 'test@example.com', esignUrl: 'https://mock-signing-url.com' }
    ]
  })
}));

describe('PDF Upload Integration Tests', () => {
  let app;
  let testPdfPath;
  let testFilesToCleanup = [];

  beforeAll(async () => {
    // Create a minimal Express app for testing
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Import and use upload middleware
    const { uploadDocumentWithData, handleMulterErrors } = require('../src/middleware/upload');
    
    // Create a test endpoint that mimics the document upload functionality
    app.post('/test-pdf-upload', uploadDocumentWithData, handleMulterErrors, async (req, res) => {
      try {
        // Basic validation
        if (!req.files || !req.files.document) {
          return res.status(400).json({
            success: false,
            message: 'Document file is required'
          });
        }

        const documentFile = req.files.document[0];
        let templateData = {};

        // Parse template data from data file or body
        if (req.files.data && req.files.data[0]) {
          const dataContent = fs.readFileSync(req.files.data[0].path, 'utf8');
          templateData = JSON.parse(dataContent);
        } else if (req.body.data) {
          templateData = JSON.parse(req.body.data);
        }

        // Validate recipients
        if (!templateData.recipients || !Array.isArray(templateData.recipients) || templateData.recipients.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'At least one recipient is required in template data'
          });
        }

        // Create document record
        const document = new Document({
          filename: documentFile.filename,
          originalName: documentFile.originalname,
          fileSize: documentFile.size,
          filePath: documentFile.path,
          mimeType: documentFile.mimetype,
          status: 'uploaded',
          recipients: templateData.recipients.map((recipient, index) => ({
            name: recipient.name,
            email: recipient.email,
            title: recipient.title || '',
            order: index + 1,
            status: 'pending',
            signatureField: recipient.signatureField || `signature_${index + 1}`
          })),
          templateData: templateData,
          signingFlow: req.body.signingFlow || 'SEQUENTIAL'
        });

        const savedDocument = await document.save();

        // Mock Adobe Sign integration
        const adobeSign = require('../src/config/adobeSign');
        
        // Upload to Adobe Sign
        const uploadResult = await adobeSign.uploadTransientDocument();
        
        // Create agreement
        const agreementResult = await adobeSign.createAgreement();
        
        // Update document with Adobe data
        savedDocument.adobeAgreementId = agreementResult.id;
        savedDocument.status = 'sent_for_signature';
        
        // Generate signing URLs for recipients
        const signingUrls = await adobeSign.getSigningUrl();
        
        // Update recipients with signing URLs
        savedDocument.recipients.forEach((recipient, index) => {
          recipient.signingUrl = `https://mock-signing-url.com/${recipient.email}`;
          recipient.status = 'url_generated';
        });

        const updatedDocument = await savedDocument.save();

        res.status(201).json({
          success: true,
          message: 'Document uploaded and sent for signature successfully',
          data: {
            documentId: updatedDocument._id,
            adobeAgreementId: updatedDocument.adobeAgreementId,
            status: updatedDocument.status,
            recipients: updatedDocument.recipients,
            signingFlow: updatedDocument.signingFlow,
            createdAt: updatedDocument.createdAt
          }
        });

      } catch (error) {
        console.error('Test upload error:', error);
        res.status(500).json({
          success: false,
          message: error.message || 'Internal server error'
        });
      }
    });

    // Error handling middleware
    app.use((err, req, res, next) => {
      res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error'
      });
    });

    // Create test PDF
    testPdfPath = await createTestPDF('integration-test.pdf');
    testFilesToCleanup.push(testPdfPath);
  });

  afterAll(() => {
    cleanupTestFiles(testFilesToCleanup);
  });

  describe('PDF Upload Workflow', () => {
    test('should upload PDF and process recipients successfully', async () => {
      const templateData = createTestTemplateData({
        recipients: [
          {
            name: 'John Doe',
            email: 'john.doe@test.com',
            title: 'Test Signer'
          },
          {
            name: 'Jane Smith',
            email: 'jane.smith@test.com',
            title: 'Test Witness'
          }
        ]
      });

      const response = await request(app)
        .post('/test-pdf-upload')
        .attach('document', testPdfPath)
        .field('data', JSON.stringify(templateData))
        .field('signingFlow', 'SEQUENTIAL');

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('documentId');
      expect(response.body.data).toHaveProperty('adobeAgreementId');
      expect(response.body.data.status).toBe('sent_for_signature');
      expect(response.body.data.recipients).toHaveLength(2);
      expect(response.body.data.recipients[0].status).toBe('url_generated');
      expect(response.body.data.recipients[0].signingUrl).toBeTruthy();

      // Verify document was saved to database
      const savedDoc = await Document.findById(response.body.data.documentId);
      expect(savedDoc).toBeTruthy();
      expect(savedDoc.mimeType).toBe('application/pdf');
      expect(savedDoc.status).toBe('sent_for_signature');
      expect(savedDoc.recipients).toHaveLength(2);
    });

    test('should handle single recipient', async () => {
      const templateData = createTestTemplateData({
        recipients: [
          {
            name: 'Alice Johnson',
            email: 'alice.johnson@test.com',
            title: 'Primary Signer'
          }
        ]
      });

      const response = await request(app)
        .post('/test-pdf-upload')
        .attach('document', testPdfPath)
        .field('data', JSON.stringify(templateData));

      expect(response.status).toBe(201);
      expect(response.body.data.recipients).toHaveLength(1);
      expect(response.body.data.recipients[0].email).toBe('alice.johnson@test.com');
    });

    test('should handle parallel signing flow', async () => {
      const templateData = createTestTemplateData();

      const response = await request(app)
        .post('/test-pdf-upload')
        .attach('document', testPdfPath)
        .field('data', JSON.stringify(templateData))
        .field('signingFlow', 'PARALLEL');

      expect(response.status).toBe(201);
      expect(response.body.data.signingFlow).toBe('PARALLEL');
    });

    test('should validate required fields', async () => {
      const response = await request(app)
        .post('/test-pdf-upload')
        .attach('document', testPdfPath);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('recipient');
    });

    test('should validate recipient data', async () => {
      const invalidTemplateData = {
        recipients: [
          {
            name: 'John Doe'
            // Missing email
          }
        ]
      };

      const response = await request(app)
        .post('/test-pdf-upload')
        .attach('document', testPdfPath)
        .field('data', JSON.stringify(invalidTemplateData));

      // This should fail validation at the mongoose level
      expect(response.status).toBeOneOf([400, 500]);
      expect(response.body.success).toBe(false);
    });

    test('should store template data correctly', async () => {
      const customTemplateData = createTestTemplateData({
        projectName: 'Test Project 2024',
        department: 'Engineering',
        customField: 'Custom Value'
      });

      const response = await request(app)
        .post('/test-pdf-upload')
        .attach('document', testPdfPath)
        .field('data', JSON.stringify(customTemplateData));

      expect(response.status).toBe(201);

      // Verify template data was stored
      const savedDoc = await Document.findById(response.body.data.documentId);
      expect(savedDoc.templateData.projectName).toBe('Test Project 2024');
      expect(savedDoc.templateData.department).toBe('Engineering');
      expect(savedDoc.templateData.customField).toBe('Custom Value');
    });

    test('should handle PDF file validation', async () => {
      // Create a non-PDF file
      const textFilePath = path.join(__dirname, 'fixtures', 'invalid.txt');
      fs.writeFileSync(textFilePath, 'This is not a PDF');
      testFilesToCleanup.push(textFilePath);

      const templateData = createTestTemplateData();

      const response = await request(app)
        .post('/test-pdf-upload')
        .attach('document', textFilePath)
        .field('data', JSON.stringify(templateData));

      expect(response.status).toBeOneOf([400, 500]);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('should handle missing document file', async () => {
      const templateData = createTestTemplateData();

      const response = await request(app)
        .post('/test-pdf-upload')
        .field('data', JSON.stringify(templateData));

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Document file is required');
    });

    test('should handle invalid JSON data', async () => {
      const response = await request(app)
        .post('/test-pdf-upload')
        .attach('document', testPdfPath)
        .field('data', 'invalid json data');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });

    test('should handle empty recipients array', async () => {
      const invalidTemplateData = {
        recipients: []
      };

      const response = await request(app)
        .post('/test-pdf-upload')
        .attach('document', testPdfPath)
        .field('data', JSON.stringify(invalidTemplateData));

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('recipient');
    });
  });

  describe('Database Operations', () => {
    test('should create document with correct structure', async () => {
      const templateData = createTestTemplateData();

      const response = await request(app)
        .post('/test-pdf-upload')
        .attach('document', testPdfPath)
        .field('data', JSON.stringify(templateData));

      expect(response.status).toBe(201);

      const savedDoc = await Document.findById(response.body.data.documentId);
      
      // Verify document structure
      expect(savedDoc.filename).toBeTruthy();
      expect(savedDoc.originalName).toBe('integration-test.pdf');
      expect(savedDoc.fileSize).toBeGreaterThan(0);
      expect(savedDoc.mimeType).toBe('application/pdf');
      expect(savedDoc.status).toBe('sent_for_signature');
      expect(savedDoc.recipients).toBeDefined();
      expect(savedDoc.templateData).toBeDefined();
      expect(savedDoc.createdAt).toBeDefined();
      expect(savedDoc.updatedAt).toBeDefined();
    });

    test('should save recipient information correctly', async () => {
      const templateData = createTestTemplateData({
        recipients: [
          {
            name: 'Test User',
            email: 'test.user@example.com',
            title: 'Document Signer'
          }
        ]
      });

      const response = await request(app)
        .post('/test-pdf-upload')
        .attach('document', testPdfPath)
        .field('data', JSON.stringify(templateData));

      expect(response.status).toBe(201);

      const savedDoc = await Document.findById(response.body.data.documentId);
      const recipient = savedDoc.recipients[0];
      
      expect(recipient.name).toBe('Test User');
      expect(recipient.email).toBe('test.user@example.com');
      expect(recipient.title).toBe('Document Signer');
      expect(recipient.order).toBe(1);
      expect(recipient.status).toBe('url_generated');
      expect(recipient.signingUrl).toBeTruthy();
    });
  });
});

// Helper matcher
expect.extend({
  toBeOneOf(received, expected) {
    const pass = expected.includes(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be one of ${expected}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be one of ${expected}`,
        pass: false,
      };
    }
  },
});
