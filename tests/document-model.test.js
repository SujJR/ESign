const mongoose = require('mongoose');
const Document = require('../src/models/document.model');
const { createTestTemplateData } = require('./helpers/testHelpers');

describe('Document Model Tests', () => {
  describe('Document Schema Validation', () => {
    test('should create a valid document', async () => {
      const documentData = {
        filename: 'test-document-123.pdf',
        originalName: 'test-document.pdf',
        fileSize: 1024000,
        filePath: '/uploads/test-document-123.pdf',
        mimeType: 'application/pdf',
        pageCount: 5,
        status: 'uploaded',
        recipients: [
          {
            name: 'John Doe',
            email: 'john@test.com',
            order: 1,
            status: 'pending',
            signatureField: 'signature_1',
            title: 'Test Signer'
          }
        ],
        templateData: createTestTemplateData(),
        signingFlow: 'SEQUENTIAL'
      };

      const document = new Document(documentData);
      const savedDocument = await document.save();

      expect(savedDocument._id).toBeDefined();
      expect(savedDocument.filename).toBe('test-document-123.pdf');
      expect(savedDocument.status).toBe('uploaded');
      expect(savedDocument.recipients).toHaveLength(1);
      expect(savedDocument.recipients[0].name).toBe('John Doe');
      expect(savedDocument.createdAt).toBeDefined();
      expect(savedDocument.updatedAt).toBeDefined();
    });

    test('should require mandatory fields', async () => {
      const document = new Document({});

      let error;
      try {
        await document.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.filename).toBeDefined();
      expect(error.errors.originalName).toBeDefined();
      expect(error.errors.fileSize).toBeDefined();
      expect(error.errors.filePath).toBeDefined();
      expect(error.errors.mimeType).toBeDefined();
    });

    test('should validate status enum values', async () => {
      const documentData = {
        filename: 'test.pdf',
        originalName: 'test.pdf',
        fileSize: 1024,
        filePath: '/uploads/test.pdf',
        mimeType: 'application/pdf',
        status: 'invalid_status'
      };

      const document = new Document(documentData);

      let error;
      try {
        await document.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.status).toBeDefined();
    });

    test('should validate recipient status enum values', async () => {
      const documentData = {
        filename: 'test.pdf',
        originalName: 'test.pdf',
        fileSize: 1024,
        filePath: '/uploads/test.pdf',
        mimeType: 'application/pdf',
        recipients: [{
          name: 'John Doe',
          email: 'john@test.com',
          status: 'invalid_recipient_status'
        }]
      };

      const document = new Document(documentData);

      let error;
      try {
        await document.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors['recipients.0.status']).toBeDefined();
    });

    test('should validate signing flow enum values', async () => {
      const documentData = {
        filename: 'test.pdf',
        originalName: 'test.pdf',
        fileSize: 1024,
        filePath: '/uploads/test.pdf',
        mimeType: 'application/pdf',
        signingFlow: 'INVALID_FLOW'
      };

      const document = new Document(documentData);

      let error;
      try {
        await document.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.signingFlow).toBeDefined();
    });
  });

  describe('Default Values', () => {
    test('should set default values correctly', async () => {
      const documentData = {
        filename: 'test.pdf',
        originalName: 'test.pdf',
        fileSize: 1024,
        filePath: '/uploads/test.pdf',
        mimeType: 'application/pdf'
      };

      const document = new Document(documentData);
      const savedDocument = await document.save();

      expect(savedDocument.pageCount).toBe(0);
      expect(savedDocument.status).toBe('uploaded');
      expect(savedDocument.adobeAgreementId).toBeNull();
      expect(savedDocument.organization).toBeNull();
      expect(savedDocument.apiKeyId).toBeNull();
      expect(savedDocument.creator).toBeNull();
      expect(savedDocument.recipients).toEqual([]);
      expect(savedDocument.adobeMetadata).toEqual({});
      expect(savedDocument.signatureFieldMapping).toEqual({});
      expect(savedDocument.templateData).toEqual({});
      expect(savedDocument.templateVariables).toEqual([]);
      expect(savedDocument.processedFilePath).toBeNull();
      expect(savedDocument.pdfFilePath).toBeNull();
      expect(savedDocument.documentAnalysis).toEqual({});
      expect(savedDocument.autoDetectedSignatureFields).toEqual([]);
      expect(savedDocument.lastReminderSent).toBeNull();
      expect(savedDocument.reminderCount).toBe(0);
      expect(savedDocument.signingFlow).toBe('SEQUENTIAL');
      expect(savedDocument.errorMessage).toBeNull();
    });

    test('should set recipient default values correctly', async () => {
      const documentData = {
        filename: 'test.pdf',
        originalName: 'test.pdf',
        fileSize: 1024,
        filePath: '/uploads/test.pdf',
        mimeType: 'application/pdf',
        recipients: [{
          name: 'John Doe',
          email: 'john@test.com'
        }]
      };

      const document = new Document(documentData);
      const savedDocument = await document.save();

      const recipient = savedDocument.recipients[0];
      expect(recipient.order).toBe(1);
      expect(recipient.status).toBe('pending');
      expect(recipient.signedAt).toBeNull();
      expect(recipient.lastReminderSent).toBeNull();
      expect(recipient.lastSigningUrlAccessed).toBeNull();
      expect(recipient.signatureField).toBeNull();
      expect(recipient.title).toBeNull();
      expect(recipient.signingUrl).toBeNull();
    });
  });

  describe('Document Operations', () => {
    test('should update document status', async () => {
      const document = new Document({
        filename: 'test.pdf',
        originalName: 'test.pdf',
        fileSize: 1024,
        filePath: '/uploads/test.pdf',
        mimeType: 'application/pdf'
      });

      const savedDocument = await document.save();
      expect(savedDocument.status).toBe('uploaded');

      const originalUpdatedAt = savedDocument.updatedAt;
      
      // Add a delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 5));
      
      savedDocument.status = 'sent_for_signature';
      const updatedDocument = await savedDocument.save();

      expect(updatedDocument.status).toBe('sent_for_signature');
      expect(updatedDocument.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
    });

    test('should add recipients to document', async () => {
      const document = new Document({
        filename: 'test.pdf',
        originalName: 'test.pdf',
        fileSize: 1024,
        filePath: '/uploads/test.pdf',
        mimeType: 'application/pdf'
      });

      const savedDocument = await document.save();

      savedDocument.recipients.push({
        name: 'Alice Johnson',
        email: 'alice@test.com',
        order: 1,
        status: 'pending'
      });

      savedDocument.recipients.push({
        name: 'Bob Wilson',
        email: 'bob@test.com',
        order: 2,
        status: 'pending'
      });

      const updatedDocument = await savedDocument.save();

      expect(updatedDocument.recipients).toHaveLength(2);
      expect(updatedDocument.recipients[0].name).toBe('Alice Johnson');
      expect(updatedDocument.recipients[1].name).toBe('Bob Wilson');
    });

    test('should update recipient status', async () => {
      const document = new Document({
        filename: 'test.pdf',
        originalName: 'test.pdf',
        fileSize: 1024,
        filePath: '/uploads/test.pdf',
        mimeType: 'application/pdf',
        recipients: [{
          name: 'John Doe',
          email: 'john@test.com',
          status: 'pending'
        }]
      });

      const savedDocument = await document.save();

      savedDocument.recipients[0].status = 'signed';
      savedDocument.recipients[0].signedAt = new Date();

      const updatedDocument = await savedDocument.save();

      expect(updatedDocument.recipients[0].status).toBe('signed');
      expect(updatedDocument.recipients[0].signedAt).toBeDefined();
    });

    test('should store template data', async () => {
      const templateData = createTestTemplateData({
        customField: 'customValue',
        projectId: 'PROJ-001',
        department: 'Engineering'
      });

      const document = new Document({
        filename: 'test.pdf',
        originalName: 'test.pdf',
        fileSize: 1024,
        filePath: '/uploads/test.pdf',
        mimeType: 'application/pdf',
        templateData: templateData
      });

      const savedDocument = await document.save();

      expect(savedDocument.templateData.customField).toBe('customValue');
      expect(savedDocument.templateData.projectId).toBe('PROJ-001');
      expect(savedDocument.templateData.department).toBe('Engineering');
      expect(savedDocument.templateData.recipients).toBeDefined();
    });

    test('should store Adobe metadata', async () => {
      const adobeMetadata = {
        agreementId: 'test-agreement-123',
        transientDocumentId: 'test-transient-456',
        participantSets: [
          {
            participantSetId: 'set-1',
            memberInfos: [
              { email: 'john@test.com', participantId: 'participant-1' }
            ]
          }
        ]
      };

      const document = new Document({
        filename: 'test.pdf',
        originalName: 'test.pdf',
        fileSize: 1024,
        filePath: '/uploads/test.pdf',
        mimeType: 'application/pdf',
        adobeMetadata: adobeMetadata
      });

      const savedDocument = await document.save();

      expect(savedDocument.adobeMetadata.agreementId).toBe('test-agreement-123');
      expect(savedDocument.adobeMetadata.transientDocumentId).toBe('test-transient-456');
      expect(savedDocument.adobeMetadata.participantSets).toHaveLength(1);
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      // Create test documents
      await Document.create([
        {
          filename: 'doc1.pdf',
          originalName: 'document1.pdf',
          fileSize: 1024,
          filePath: '/uploads/doc1.pdf',
          mimeType: 'application/pdf',
          status: 'uploaded',
          apiKeyId: 'api-key-1'
        },
        {
          filename: 'doc2.pdf',
          originalName: 'document2.pdf',
          fileSize: 2048,
          filePath: '/uploads/doc2.pdf',
          mimeType: 'application/pdf',
          status: 'sent_for_signature',
          apiKeyId: 'api-key-1'
        },
        {
          filename: 'doc3.pdf',
          originalName: 'document3.pdf',
          fileSize: 3072,
          filePath: '/uploads/doc3.pdf',
          mimeType: 'application/pdf',
          status: 'completed',
          apiKeyId: 'api-key-2'
        }
      ]);
    });

    test('should find documents by status', async () => {
      const uploadedDocs = await Document.find({ status: 'uploaded' });
      const sentDocs = await Document.find({ status: 'sent_for_signature' });
      const completedDocs = await Document.find({ status: 'completed' });

      expect(uploadedDocs).toHaveLength(1);
      expect(sentDocs).toHaveLength(1);
      expect(completedDocs).toHaveLength(1);
    });

    test('should find documents by API key', async () => {
      const apiKey1Docs = await Document.find({ apiKeyId: 'api-key-1' });
      const apiKey2Docs = await Document.find({ apiKeyId: 'api-key-2' });

      expect(apiKey1Docs).toHaveLength(2);
      expect(apiKey2Docs).toHaveLength(1);
    });

    test('should sort documents by creation date', async () => {
      const docs = await Document.find({}).sort({ createdAt: -1 });

      expect(docs).toHaveLength(3);
      expect(docs[0].createdAt).toBeInstanceOf(Date);
      expect(docs[1].createdAt).toBeInstanceOf(Date);
      expect(docs[2].createdAt).toBeInstanceOf(Date);
    });

    test('should find documents by recipient email', async () => {
      // First add a recipient to one document
      await Document.findOneAndUpdate(
        { filename: 'doc1.pdf' },
        {
          $push: {
            recipients: {
              name: 'John Doe',
              email: 'john@test.com',
              status: 'pending'
            }
          }
        }
      );

      const docs = await Document.find({ 'recipients.email': 'john@test.com' });
      expect(docs).toHaveLength(1);
      expect(docs[0].filename).toBe('doc1.pdf');
    });
  });

  describe('Validation Edge Cases', () => {
    test('should handle empty string values', async () => {
      const document = new Document({
        filename: '',
        originalName: '',
        fileSize: 1024,
        filePath: '',
        mimeType: ''
      });

      let error;
      try {
        await document.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
    });

    test('should handle very large file sizes', async () => {
      const document = new Document({
        filename: 'large-file.pdf',
        originalName: 'large-file.pdf',
        fileSize: Number.MAX_SAFE_INTEGER,
        filePath: '/uploads/large-file.pdf',
        mimeType: 'application/pdf'
      });

      const savedDocument = await document.save();
      expect(savedDocument.fileSize).toBe(Number.MAX_SAFE_INTEGER);
    });

    test('should handle special characters in filenames', async () => {
      const document = new Document({
        filename: 'test-file-äöü-ñ-中文.pdf',
        originalName: 'original-äöü-ñ-中文.pdf',
        fileSize: 1024,
        filePath: '/uploads/test-file-äöü-ñ-中文.pdf',
        mimeType: 'application/pdf'
      });

      const savedDocument = await document.save();
      expect(savedDocument.filename).toBe('test-file-äöü-ñ-中文.pdf');
      expect(savedDocument.originalName).toBe('original-äöü-ñ-中文.pdf');
    });
  });
});
