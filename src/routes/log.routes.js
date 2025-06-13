const express = require('express');
const logController = require('../controllers/log.controller');

const router = express.Router();

// Get logs with pagination and filtering
router.get('/', logController.getLogs);

// Get logs summary
router.get('/summary', logController.getLogsSummary);

module.exports = router;
