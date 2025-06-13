const express = require('express');
const documentController = require('../controllers/document.controller');
const { uploadDocument, uploadDocumentWithData, handleMulterErrors } = require('../middleware/upload');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// Apply API key authentication to all routes
router.use(authenticateApiKey);

// Upload document
router.post('/upload', requirePermissions(['documents:write', 'admin:all']), uploadDocument, handleMulterErrors, documentController.uploadDocument);

// Upload document with JSON data for template processing
router.post('/upload-with-data', requirePermissions(['documents:write', 'admin:all']), uploadDocumentWithData, handleMulterErrors, documentController.uploadDocumentWithData);

// Get all documents for user
router.get('/', requirePermissions(['documents:read', 'admin:all']), documentController.getDocuments);

// Get specific document
router.get('/:id', requirePermissions(['documents:read', 'admin:all']), documentController.getDocument);

// Prepare document for signature
router.post('/:id/prepare', requirePermissions(['documents:write', 'admin:all']), documentController.prepareForSignature);

// Send document for signature
router.post('/:id/send', requirePermissions(['documents:send', 'admin:all']), documentController.sendForSignature);

// Send document for signature using two-step approach
router.post('/:id/send-two-step', requirePermissions(['documents:send', 'admin:all']), documentController.sendForSignatureTwoStep);

// Send document for signature using comprehensive approach with multiple fallbacks
router.post('/:id/send-comprehensive', requirePermissions(['documents:send', 'admin:all']), documentController.sendForSignatureComprehensive);

// Send reminder to recipients who haven't signed yet
router.post('/:id/send-reminder', requirePermissions(['documents:send', 'admin:all']), documentController.sendReminder);

// Get signing URL for embedding in iframe
router.get('/:id/signing-url', requirePermissions(['documents:read', 'admin:all']), documentController.getSigningUrl);

// Get signing URLs for all recipients
router.get('/:id/signing-urls', requirePermissions(['documents:read', 'admin:all']), documentController.getAllSigningUrls);

// Check document status
router.get('/:id/status', requirePermissions(['documents:read', 'admin:all']), documentController.checkDocumentStatus);

// Download document
router.get('/:id/download', requirePermissions(['documents:read', 'admin:all']), documentController.downloadDocument);

module.exports = router;
