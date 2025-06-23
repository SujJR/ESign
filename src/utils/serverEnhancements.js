/**
 * Server setup patch to apply enhanced routes and middleware
 */

// Import the necessary modules
const enhancedSocketHangUpInterceptor = require('./middleware/enhancedSocketHangUpInterceptor');
const enhancedDocumentRoutes = require('./routes/document.enhanced.routes');

/**
 * Apply enhanced routes and middleware to Express app
 * @param {Object} app - Express app instance
 */
const applyEnhancements = (app) => {
  // Apply enhanced socket hang-up interceptor
  app.use(enhancedSocketHangUpInterceptor);
  
  // Register enhanced document routes
  app.use('/api/documents', enhancedDocumentRoutes);
  
  // Log successful enhancement
  const logger = require('./utils/logger');
  logger.info('Applied enhanced routes and middleware for improved error handling');
  
  return true;
};

module.exports = applyEnhancements;
