const mongoose = require('mongoose');
const logger = require('../utils/logger');
const dns = require('dns');

// Enhanced MongoDB connection with multiple fallback strategies
const connectDB = async () => {
  const maxRetries = 5;
  let retryCount = 0;
  
  // Multiple connection strings to try
  const connectionStrings = [
    process.env.MONGODB_URI,
    process.env.MONGODB_URI?.replace('mongodb+srv://', 'mongodb://'),
    // Direct IP fallback (you can add your cluster IPs here)
  ].filter(Boolean);

  const testDNSResolution = async (hostname) => {
    return new Promise((resolve) => {
      dns.lookup(hostname, (err, address) => {
        if (err) {
          logger.error(`DNS lookup failed for ${hostname}: ${err.message}`);
          resolve(false);
        } else {
          logger.info(`DNS lookup successful for ${hostname}: ${address}`);
          resolve(true);
        }
      });
    });
  };

  const attemptConnection = async (connectionString, stringIndex = 0) => {
    try {
      // Test DNS resolution for SRV records
      if (connectionString.includes('mongodb+srv://')) {
        const hostname = connectionString.match(/mongodb\+srv:\/\/[^:]+:[^@]+@([^\/]+)/)?.[1];
        if (hostname) {
          logger.info(`Testing DNS resolution for ${hostname}...`);
          const dnsWorking = await testDNSResolution(hostname);
          if (!dnsWorking) {
            logger.warn(`DNS resolution failed for ${hostname}, trying next connection string...`);
            throw new Error(`DNS resolution failed for ${hostname}`);
          }
        }
      }

      const options = {
        serverSelectionTimeoutMS: 15000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 15000,
        heartbeatFrequencyMS: 30000,
        maxPoolSize: 10,
        minPoolSize: 2,
        retryWrites: true,
        w: 'majority',
        // Network settings
        family: 4, // Use IPv4, skip trying IPv6
        bufferCommands: false, // Fixed: proper option name
        // Auth settings  
        authSource: 'admin',
        // Additional options for better connectivity
        maxIdleTimeMS: 30000
      };

      logger.info(`Attempting to connect to MongoDB (attempt ${retryCount + 1}/${maxRetries}) using connection string ${stringIndex + 1}...`);
      
      // Log the connection string (without password)
      const safeUri = connectionString.replace(/:([^:@]+)@/, ':****@');
      logger.info(`Connecting to: ${safeUri}`);
      
      const conn = await mongoose.connect(connectionString, options);
      logger.info(`✅ MongoDB Connected successfully: ${conn.connection.host}`);
      logger.info(`Database: ${conn.connection.name}`);
      
      // Set up connection event listeners
      mongoose.connection.on('error', (err) => {
        logger.error(`MongoDB connection error: ${err.message}`);
      });
      
      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
      });
      
      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected successfully');
      });

      mongoose.connection.on('close', () => {
        logger.warn('MongoDB connection closed');
      });
      
      // Test the connection by running a simple operation
      await mongoose.connection.db.admin().ping();
      logger.info('✅ MongoDB ping successful - connection is healthy');
      
      return true;
      
    } catch (error) {
      logger.error(`❌ MongoDB connection attempt ${retryCount + 1} failed with connection string ${stringIndex + 1}: ${error.message}`);
      
      // Try next connection string if available
      if (stringIndex + 1 < connectionStrings.length) {
        logger.info('Trying next connection string...');
        return attemptConnection(connectionStrings[stringIndex + 1], stringIndex + 1);
      }
      
      retryCount++;
      
      if (retryCount < maxRetries) {
        const delay = Math.min(5000 * retryCount, 30000); // Exponential backoff, max 30s
        logger.info(`Retrying in ${delay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return attemptConnection(connectionStrings[0], 0); // Start with first connection string again
      } else {
        logger.error('❌ All MongoDB connection attempts failed with all connection strings');
        logger.warn('🔄 Server will continue running with mock database for testing purposes');
        setupMockDatabase();
        return false;
      }
    }
  };

  // Start connection attempts
  if (!connectionStrings.length) {
    logger.error('❌ No MongoDB connection string found in environment variables');
    setupMockDatabase();
    return false;
  }

  return attemptConnection(connectionStrings[0]);
};

// Mock database setup for testing when MongoDB is unavailable
const setupMockDatabase = () => {
  logger.info('🔧 Setting up mock database for testing...');
  
  // Create mock collections in memory
  global.mockTransactions = new Map();
  global.mockDocuments = new Map();
  global.mockLogs = new Map();
  global.mockUsers = new Map();
  global.mockApiKeys = new Map();
  
  // Add some sample data
  global.mockDocuments.set('sample-doc-1', {
    _id: 'sample-doc-1',
    filename: 'sample-contract.pdf',
    originalName: 'contract.pdf',
    status: 'completed'
  });
  
  logger.info('✅ Mock database ready - API endpoints will return test data');
};

module.exports = connectDB;
