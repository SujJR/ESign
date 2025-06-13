const express = require('express');
const apiKeyController = require('../controllers/apiKey.controller');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// All routes require admin permissions
router.use(authenticateApiKey);
router.use(requirePermissions('admin:all'));

// Create new API key
router.post('/', apiKeyController.createApiKey);

// Get all API keys
router.get('/', apiKeyController.getApiKeys);

// Get specific API key
router.get('/:keyId', apiKeyController.getApiKey);

// Update API key
router.put('/:keyId', apiKeyController.updateApiKey);

// Deactivate API key
router.delete('/:keyId', apiKeyController.deactivateApiKey);

// Get API key statistics
router.get('/:keyId/stats', apiKeyController.getApiKeyStats);

// Regenerate API key
router.post('/:keyId/regenerate', apiKeyController.regenerateApiKey);

module.exports = router;
