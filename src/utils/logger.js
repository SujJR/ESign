const winston = require('winston');
const morgan = require('morgan');

// Define custom log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Determine log level based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'warn';
};

// Define log colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Add colors to winston
winston.addColors(colors);

// Define winston format with organization context
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    let message = `${info.timestamp} ${info.level}: ${info.message}`;
    
    // Add organization context if available
    if (info.organization || info.organizationName || info.apiKeyId) {
      const orgInfo = [];
      if (info.organizationName) orgInfo.push(`org=${info.organizationName}`);
      if (info.organizationId) orgInfo.push(`orgId=${info.organizationId}`);
      if (info.apiKeyId) orgInfo.push(`apiKey=${info.apiKeyId}`);
      
      if (orgInfo.length > 0) {
        message += ` [${orgInfo.join(', ')}]`;
      }
    }
    
    return message;
  })
);

// Define transport options
const transports = [
  new winston.transports.Console(),
  new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
  }),
  new winston.transports.File({ filename: 'logs/all.log' }),
];

// Create winston logger
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});

// Enhanced logging methods with organization context
const originalInfo = logger.info;
const originalError = logger.error;
const originalWarn = logger.warn;
const originalDebug = logger.debug;

// Override logging methods to auto-include organization context from req object
logger.logWithContext = function(level, message, meta = {}, req = null) {
  const logData = { ...meta };
  
  // Extract organization context from request if available
  if (req && req.apiKey) {
    logData.organizationId = req.apiKey.organization?.id;
    logData.organizationName = req.apiKey.organization?.name;
    logData.apiKeyId = req.apiKey.keyId;
    logData.apiKeyName = req.apiKey.name;
    logData.environment = req.apiKey.environment;
  }
  
  this[level](message, logData);
};

logger.infoWithContext = function(message, meta = {}, req = null) {
  this.logWithContext('info', message, meta, req);
};

logger.errorWithContext = function(message, meta = {}, req = null) {
  this.logWithContext('error', message, meta, req);
};

logger.warnWithContext = function(message, meta = {}, req = null) {
  this.logWithContext('warn', message, meta, req);
};

logger.debugWithContext = function(message, meta = {}, req = null) {
  this.logWithContext('debug', message, meta, req);
};

// Create morgan middleware
const morganMiddleware = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  {
    stream: {
      write: (message) => logger.http(message.trim()),
    },
  }
);

module.exports = logger;
module.exports.morganMiddleware = morganMiddleware;
