const express = require('express');
const webhookController = require('../controllers/webhook.controller');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// Webhook from Adobe Sign (no authentication - Adobe Sign calls this endpoint)
router.post('/adobe-sign', webhookController.handleAdobeSignWebhook);

// Setup webhook (requires authentication)
router.post('/setup', authenticateApiKey, requirePermissions(['admin:all']), webhookController.setupWebhook);

module.exports = router;
