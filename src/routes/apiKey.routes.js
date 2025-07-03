const express = require('express');
const apiKeyController = require('../controllers/apiKey.controller');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// All routes require admin permissions
router.use(authenticateApiKey);
router.use(requirePermissions('admin:all'));

// API Key creation endpoint - documentation removed (manual API key authorization)
// Create new API key
router.post('/', apiKeyController.createApiKey);

// API Key listing endpoint - documentation removed (manual API key authorization)
// Get all API keys
router.get('/', apiKeyController.getApiKeys);

module.exports = router;
