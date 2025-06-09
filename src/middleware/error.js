const { ApiError } = require('../utils/apiUtils');
const { formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');
const Log = require('../models/log.model');

/**
 * Log error to MongoDB
 * @param {Error} err - Error object
 * @param {object} req - Express request object
 */
const logErrorToDb = async (err, req) => {
  try {
    await Log.create({
      level: 'error',
      message: err.message,
      metadata: {
        stack: err.stack,
        code: err.statusCode || 500
      },
      userId: req.user ? req.user._id : null,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestPath: req.originalUrl,
      requestMethod: req.method
    });
  } catch (error) {
    logger.error(`Error saving log to database: ${error.message}`);
  }
};

/**
 * Handle development errors
 */
const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json(formatResponse(
    err.statusCode,
    err.message,
    {
      error: err,
      stack: err.stack
    }
  ));
};

/**
 * Handle production errors
 */
const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json(formatResponse(
      err.statusCode,
      err.message
    ));
  } else {
    // Programming or other unknown error: don't leak error details
    logger.error('ERROR 💥', err);
    res.status(500).json(formatResponse(
      500,
      'Something went wrong'
    ));
  }
};

/**
 * Handle MongoDB validation errors
 */
const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map(el => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new ApiError(400, message);
};

/**
 * Handle MongoDB duplicate key errors
 */
const handleDuplicateFieldsDB = (err) => {
  const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new ApiError(400, message);
};

/**
 * Handle MongoDB cast errors
 */
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new ApiError(400, message);
};

/**
 * Global error handling middleware
 */
module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  
  // Log error
  logger.error(`${err.statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
  
  // Log to database
  logErrorToDb(err, req);
  
  // Handle specific errors
  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);
  } else if (process.env.NODE_ENV === 'production') {
    let error = { ...err };
    error.message = err.message;
    
    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
    
    sendErrorProd(error, res);
  }
};
