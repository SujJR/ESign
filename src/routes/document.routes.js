const express = require('express');
const documentController = require('../controllers/document.controller');
const { protect } = require('../middleware/auth');
const { uploadDocument, uploadDocumentWithData, handleMulterErrors } = require('../middleware/upload');

const router = express.Router();

// Apply protection middleware to all routes
router.use(protect);

// Upload document
router.post('/upload', uploadDocument, handleMulterErrors, documentController.uploadDocument);

// Upload document with JSON data for template processing
router.post('/upload-with-data', uploadDocumentWithData, handleMulterErrors, documentController.uploadDocumentWithData);

// Get all documents for user
router.get('/', documentController.getDocuments);

// Get specific document
router.get('/:id', documentController.getDocument);

// Prepare document for signature
router.post('/:id/prepare', documentController.prepareForSignature);

// Send document for signature
router.post('/:id/send', documentController.sendForSignature);

// Send document for signature using two-step approach
router.post('/:id/send-two-step', documentController.sendForSignatureTwoStep);

// Send document for signature using comprehensive approach with multiple fallbacks
router.post('/:id/send-comprehensive', documentController.sendForSignatureComprehensive);

// Send reminder to recipients who haven't signed yet
router.post('/:id/send-reminder', documentController.sendReminder);

// Get signing URL for embedding in iframe
router.get('/:id/signing-url', documentController.getSigningUrl);

// Get signing URLs for all recipients
router.get('/:id/signing-urls', documentController.getAllSigningUrls);

// Check document status
router.get('/:id/status', documentController.checkDocumentStatus);

// Download document
router.get('/:id/download', documentController.downloadDocument);

module.exports = router;
