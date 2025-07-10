const express = require('express');
const logger = require('../utils/logger');

// Dynamic transaction routes that switch based on database availability
const router = express.Router();

let actualRoutes = null;
let usingMockRoutes = true;

// Initialize with mock routes
try {
  actualRoutes = require('./transaction.routes.mock');
  logger.info('Initialized with mock transaction routes');
} catch (error) {
  logger.error(`Failed to load mock routes: ${error.message}`);
}

// Function to switch to real routes when database is available
const switchToRealRoutes = () => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1 && usingMockRoutes) {
      actualRoutes = require('./transaction.routes');
      usingMockRoutes = false;
      logger.info('✅ Switched to real transaction routes - database connected');
      return true;
    }
  } catch (error) {
    logger.error(`Failed to switch to real routes: ${error.message}`);
  }
  return false;
};

// Middleware to handle route switching
router.use((req, res, next) => {
  // Try to switch to real routes if we haven't already
  if (usingMockRoutes) {
    switchToRealRoutes();
  }
  
  if (actualRoutes) {
    actualRoutes(req, res, next);
  } else {
    res.status(500).json({
      success: false,
      message: 'Transaction routes not available',
      timestamp: new Date().toISOString()
    });
  }
});

// Check database connection every 30 seconds and switch if needed
setInterval(() => {
  if (usingMockRoutes) {
    switchToRealRoutes();
  }
}, 30000);

module.exports = router;
