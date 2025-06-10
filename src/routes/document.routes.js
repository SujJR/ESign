const express = require('express');
const documentController = require('../controllers/document.controller');
const { protect } = require('../middleware/auth');
const { uploadDocument, handleMulterErrors } = require('../middleware/upload');

const router = express.Router();

// Apply protection middleware to all routes
router.use(protect);

// Upload document
router.post('/upload', uploadDocument, handleMulterErrors, documentController.uploadDocument);

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

// Check document status
router.get('/:id/status', documentController.checkDocumentStatus);

// Download document
router.get('/:id/download', documentController.downloadDocument);

module.exports = router;
