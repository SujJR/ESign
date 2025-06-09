/**
 * Standard API response format
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Response message
 * @param {any} data - Response data
 * @returns {object} - Formatted response object
 */
exports.formatResponse = (statusCode, message, data = null) => {
  const success = statusCode >= 200 && statusCode < 400;
  
  return {
    success,
    status: statusCode,
    message,
    data,
    timestamp: new Date().toISOString()
  };
};

/**
 * Custom error class for API errors
 */
class ApiError extends Error {
  constructor(statusCode, message, isOperational = true, stack = '') {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    
    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

exports.ApiError = ApiError;
