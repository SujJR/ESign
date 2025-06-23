const express = require('express');
const documentController = require('../controllers/document.controller');
const documentControllerAdditions = require('../controllers/document.controller.additions');
const { uploadDocument, uploadDocumentWithData, uploadDocumentFromUrl, handleMulterErrors } = require('../middleware/upload');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// Apply API key authentication to all routes
router.use(authenticateApiKey);

// Upload document
router.post('/upload', requirePermissions(['documents:write', 'admin:all']), uploadDocument, handleMulterErrors, documentController.uploadDocument);

// Upload document with JSON data for template processing
router.post('/upload-with-data', requirePermissions(['documents:write', 'admin:all']), uploadDocumentWithData, handleMulterErrors, documentController.uploadDocumentWithData);

// Upload document from URL with JSON data
router.post('/upload-from-url', 
  requirePermissions(['documents:write', 'admin:all']), 
  uploadDocumentFromUrl,
  handleMulterErrors, 
  documentController.uploadDocumentFromUrl);

// Get all documents for user
router.get('/', requirePermissions(['documents:read', 'admin:all']), documentController.getDocuments);

// Get specific document
router.get('/:id', requirePermissions(['documents:read', 'admin:all']), documentController.getDocument);

// Prepare document for signature
router.post('/:id/prepare', requirePermissions(['documents:write', 'admin:all']), documentController.prepareForSignature);

// Send document for signature
router.post('/:id/send', requirePermissions(['documents:send', 'admin:all']), documentController.sendForSignature);

// Send reminder to recipients who haven't signed yet
router.post('/:id/send-reminder', requirePermissions(['documents:send', 'admin:all']), documentController.sendReminder);

// Get signing URL for embedding in iframe
router.get('/:id/signing-url', requirePermissions(['documents:read', 'admin:all']), documentController.getSigningUrl);

// Get signing URLs for all recipients
router.get('/:id/signing-urls', requirePermissions(['documents:read', 'admin:all']), documentController.getAllSigningUrls);

// Check document status
router.get('/:id/status', requirePermissions(['documents:read', 'admin:all']), documentController.checkDocumentStatus);

// Update signature status
router.post('/:id/update-status', requirePermissions(['documents:write', 'admin:all']), documentController.updateSignatureStatus);

// Recover document from socket hang up error
router.post('/:id/recover', requirePermissions(['documents:write', 'admin:all']), documentControllerAdditions.recoverDocument);

// Download document
router.get('/:id/download', requirePermissions(['documents:read', 'admin:all']), documentController.downloadDocument);

module.exports = router;
