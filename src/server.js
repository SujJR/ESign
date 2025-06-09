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

// Import routes
const authRoutes = require('./routes/auth.routes');
const documentRoutes = require('./routes/document.routes');
const logRoutes = require('./routes/log.routes');

// Import middleware
const errorMiddleware = require('./middleware/error');
const logger = require('./utils/logger');
const { ApiError } = require('./utils/apiUtils');

// Create Express app
const app = express();

// Connect to MongoDB
connectDB();

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

// Basic route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the ESign API',
    version: '1.0.0'
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/logs', logRoutes);

// Handle 404 errors
app.use('*', (req, res, next) => {
  next(new ApiError(404, `Can't find ${req.originalUrl} on this server`));
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
