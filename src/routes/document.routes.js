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

// Check document status
router.get('/:id/status', documentController.checkDocumentStatus);

// Download document
router.get('/:id/download', documentController.downloadDocument);

module.exports = router;
