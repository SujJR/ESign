/**
 * Standard API response format
 * @param {number|string} statusCodeOrMessage - HTTP status code or message if first parameter
 * @param {string|any} messageOrData - Response message or data if message was first param
 * @param {any|boolean} dataOrIsError - Response data or isError flag
 * @returns {object} - Formatted response object
 */
exports.formatResponse = (statusCodeOrMessage, messageOrData = null, dataOrIsError = null) => {
  // Handle different calling patterns
  let statusCode, message, data, isError = false;
  
  // Check if the first parameter is a number (status code) or a string (message)
  if (typeof statusCodeOrMessage === 'number') {
    // Original format: (statusCode, message, data)
    statusCode = statusCodeOrMessage;
    message = messageOrData;
    data = dataOrIsError;
  } else {
    // Alternative format: (message, data, isError)
    message = statusCodeOrMessage;
    data = messageOrData;
    isError = dataOrIsError === true;
    statusCode = isError ? 400 : 200; // Default status codes
  }
  
  const success = !isError && statusCode >= 200 && statusCode < 400;
  
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
