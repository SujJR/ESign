/**
 * Enhanced document routes with improved error handling and resilience
 */

const express = require('express');
const documentController = require('../controllers/document.controller');
const documentControllerEnhanced = require('../controllers/document.controller.enhanced');
const { uploadDocument, uploadDocumentWithData, uploadDocumentFromUrl, handleMulterErrors } = require('../middleware/upload');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// Apply API key authentication to all routes
router.use(authenticateApiKey);

// ENHANCED ROUTES WITH BETTER ERROR HANDLING

// Send document for signature with enhanced error handling
router.post('/:id/send-enhanced', 
  requirePermissions(['documents:send', 'admin:all']), 
  documentControllerEnhanced.sendForSignatureEnhanced);

// Recover document with enhanced recovery logic
router.post('/:id/recover-enhanced', 
  requirePermissions(['documents:write', 'admin:all']), 
  documentControllerEnhanced.recoverDocumentEnhanced);

// Get detailed document status including Adobe Sign status
router.get('/:id/enhanced-status', 
  requirePermissions(['documents:read', 'admin:all']), 
  documentControllerEnhanced.getEnhancedDocumentStatus);

module.exports = router;
