const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Import database connection
const connectDB = require('./config/db');

// Import Swagger configuration
const { swaggerServe, swaggerSetup } = require('./config/swagger');

// Import routes
const documentRoutes = require('./routes/document.routes');
const enhancedRoutes = require('./routes/enhanced.routes');
const apiKeyRoutes = require('./routes/apiKey.routes');
const organizationRoutes = require('./routes/organization.routes');
const webhookRoutes = require('./routes/webhook.routes');
const testRoutes = require('./routes/test.routes');
const transactionRoutes = require('./routes/transaction.routes'); // Use real routes

// Import middleware
const errorMiddleware = require('./middleware/error');
const logger = require('./utils/logger');
const { ApiError } = require('./utils/apiUtils');

// Create Express app
const app = express();

// Connect to MongoDB
connectDB();

// Monkey patch the missing createWebhook function
// This ensures it's available for modules that try to import it from adobeSign.js
try {
  const adobeSign = require('./config/adobeSign');
  const createWebhook = require('./config/createWebhook');
  
  // Only add if it doesn't already exist
  if (!adobeSign.createWebhook) {
    adobeSign.createWebhook = createWebhook;
    logger.info('Successfully added missing createWebhook function to adobeSign module');
  }
} catch (error) {
  logger.error(`Error patching createWebhook function: ${error.message}`);
}

// Apply direct fix for socket hang up in document controller
try {
  // Apply direct intercept first - this is the most critical fix
  const applyDirectIntercept = require('./utils/directDocumentIntercept');
  applyDirectIntercept();
  logger.info('Applied direct intercept for socket hang up in document controller');
  
  // Apply other fixes as backups
  const applyDocumentControllerFix = require('./utils/documentControllerFix');
  applyDocumentControllerFix();
  logger.info('Applied backup fix for socket hang up in document controller');
  
  // Apply enhanced form fields fix
  const enhanceAdobeSignFormFields = require('./utils/enhanceAdobeSignFormFields');
  const adobeSignFormFields = require('./utils/adobeSignFormFields');
  enhanceAdobeSignFormFields(adobeSignFormFields);
  logger.info('Applied enhanced form fields fix for socket hang up issues');
} catch (error) {
  logger.error(`Error applying socket hang up fixes: ${error.message}`);
}

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(logger.morganMiddleware);

// Add socket hang up interceptor middleware
const socketHangUpInterceptor = require('./middleware/socketHangUpInterceptor');
app.use(socketHangUpInterceptor);
logger.info('Added global socket hang up interceptor middleware');

// Basic route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the ESign API - API Key Authentication Enabled',
    version: '1.0.0',
    authentication: 'API Key required',
    endpoints: {
      documents: '/api/documents',
      enhanced: '/api/enhanced', 
      apiKeys: '/api/auth/api-keys',
      organizations: '/api/organizations',
      webhooks: '/api/webhooks',
      transactions: '/api/transactions',
      docs: '/api-docs'
    },
    authInfo: {
      header: 'X-API-Key: your_api_key',
      alternative: 'Authorization: Bearer your_api_key',
      queryParam: '?api_key=your_api_key'
    }
  });
});

// Swagger documentation
app.use('/api-docs', swaggerServe, swaggerSetup);

// API routes
app.use('/api/documents', documentRoutes);
app.use('/api/enhanced', enhancedRoutes);
app.use('/api/auth/api-keys', apiKeyRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/test', testRoutes);

// Handle 404 errors - use a regular path instead of wildcard
app.use((req, res, next) => {
  const url = req.originalUrl || req.url || 'unknown';
  next(new ApiError(404, `Route not found: ${url}`));
});

// Error handling middleware
app.use(errorMiddleware);

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  logger.error(err.stack);
  
  // Close server & exit process
  server.close(() => process.exit(1));
});

module.exports = app;
