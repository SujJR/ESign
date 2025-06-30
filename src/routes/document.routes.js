const express = require('express');
const documentController = require('../controllers/document.controller');
const documentControllerAdditions = require('../controllers/document.controller.additions');
const { uploadDocument, uploadDocumentWithData, uploadDocumentFromUrl, handleMulterErrors } = require('../middleware/upload');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// Apply API key authentication to all routes
router.use(authenticateApiKey);

// Combined upload, prepare, and send endpoint (supports all 3 methods)
router.post('/upload-and-send', requirePermissions(['documents:send', 'documents:write', 'admin:all']), uploadDocumentWithData, handleMulterErrors, documentController.uploadPrepareAndSend);

// Get all documents for user
router.get('/', requirePermissions(['documents:read', 'admin:all']), documentController.getDocuments);

// Get specific document
router.get('/:id', requirePermissions(['documents:read', 'admin:all']), documentController.getDocument);

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

// Manually update recipient timestamps (fallback when Adobe Sign sync fails)
router.post('/:id/update-timestamps', requirePermissions(['documents:write', 'admin:all']), documentController.updateRecipientTimestamps);

// Recover document from socket hang up error
router.post('/:id/recover', requirePermissions(['documents:write', 'admin:all']), documentControllerAdditions.recoverDocument);

// Download document
router.get('/:id/download', requirePermissions(['documents:read', 'admin:all']), documentController.downloadDocument);

module.exports = router;
