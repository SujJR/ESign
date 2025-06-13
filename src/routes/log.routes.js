const express = require('express');
const logController = require('../controllers/log.controller');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// Apply API key authentication to all routes
router.use(authenticateApiKey);

// Get logs with pagination and filtering
router.get('/', requirePermissions(['logs:read', 'admin:all']), logController.getLogs);

// Get logs summary
router.get('/summary', requirePermissions(['logs:read', 'admin:all']), logController.getLogsSummary);

module.exports = router;
