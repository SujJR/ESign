const express = require('express');
const logController = require('../controllers/log.controller');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Apply protection middleware to all routes
router.use(protect);
// Restrict log access to admin users
router.use(restrictTo('admin'));

// Get logs with pagination and filtering
router.get('/', logController.getLogs);

// Get logs summary
router.get('/summary', logController.getLogsSummary);

module.exports = router;
