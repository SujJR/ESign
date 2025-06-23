/**
 * Adobe Sign client enhancer with timeout and retry support
 * This addresses the "socket hang up" error when creating agreements
 */

const axios = require('axios');
const axiosRetry = require('axios-retry').default; // Use .default for proper import
const logger = require('../utils/logger');
const { createAdobeSignClient: originalCreateClient } = require('./adobeSign');

/**
 * Enhanced Adobe Sign client creation with timeout and retry support
 * @returns {Promise<Object>} - Enhanced Axios instance for Adobe Sign API
 */
const createEnhancedAdobeSignClient = async () => {
  try {
    // Get the original client
    const client = await originalCreateClient();
    
    // Configure longer timeouts (180 seconds for all operations)
    client.defaults.timeout = 180000; // 3 minutes
    
    // Disable keep-alive to prevent socket hang up issues
    client.defaults.headers['Connection'] = 'close';
    
    // Add custom headers for debugging
    client.defaults.headers['X-Custom-Timeout'] = '180000';
    client.defaults.headers['X-Client-Type'] = 'enhanced';
    
    // Increase maxContentLength and maxBodyLength for large payloads
    client.defaults.maxContentLength = Infinity;
    client.defaults.maxBodyLength = Infinity;
    
    // Configure retry logic with more retries and better backoff
    axiosRetry(client, {
      retries: 5, // Increase retries for more reliability
      retryDelay: (retryCount) => {
        // Use exponential backoff with jitter to prevent thundering herd problem
        const baseDelay = 3000; // 3 seconds base
        const exponentialDelay = baseDelay * Math.pow(2, retryCount - 1);
        const jitter = Math.random() * 1000; // Add up to 1 second of jitter
        return exponentialDelay + jitter;
      },
      retryCondition: (error) => {
        // Retry on network errors, 5xx errors, and specific error messages
        const isNetworkError = !error.response && Boolean(error.code);
        const is5xxError = error.response && error.response.status >= 500 && error.response.status < 600;
        const isSocketHangUp = error.message && error.message.includes('socket hang up');
        const isTimeout = error.message && (
          error.message.includes('timeout') ||
          error.message.includes('ETIMEDOUT')
        );
        const isNetworkIssue = error.message && (
          error.message.includes('network error') ||
          error.message.includes('ECONNRESET') ||
          error.message.includes('ECONNABORTED') ||
          error.message.includes('ECONNREFUSED')
        );
        
        // Do NOT retry rate limit errors (429)
        const isRateLimitError = error.response && error.response.status === 429;
        if (isRateLimitError) {
          const retryAfter = error.response.data?.retryAfter || 60;
          logger.warn(`Rate limit hit (429). Not retrying automatically. Suggested retry after ${retryAfter} seconds.`);
          return false;
        }
        
        // Log detailed retry information
        if (isNetworkError || is5xxError || isSocketHangUp || isTimeout || isNetworkIssue) {
          logger.warn(`Retry condition triggered for error: ${error.message}`);
          return true;
        }
        
        return false;
      },
      onRetry: (retryCount, error, requestConfig) => {
        logger.warn(`Retrying Adobe Sign API request (${retryCount}/5) after error: ${error.message}`);
        logger.info(`Retry attempt ${retryCount} for URL: ${requestConfig.url}`);
        
        // Add a unique identifier to track retries
        if (!requestConfig.headers['X-Retry-ID']) {
          requestConfig.headers['X-Retry-ID'] = `retry-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
        }
        
        // Increase timeout on retries
        requestConfig.timeout = 180000 + (retryCount * 30000); // Add 30 seconds for each retry
        
        // Always use 'close' connection for retries
        requestConfig.headers['Connection'] = 'close';
        
        logger.info(`Retry ID: ${requestConfig.headers['X-Retry-ID']}, Timeout: ${requestConfig.timeout}ms`);
      }
    });
    
    // Add additional response interceptor for detailed logging
    client.interceptors.response.use(
      (response) => {
        // Log successful responses
        const requestPath = response.config.url;
        logger.info(`Adobe Sign API Success: ${response.status} for ${requestPath}`);
        return response;
      },
      (error) => {
        // Enhanced error logging
        if (error.response) {
          const requestPath = error.config?.url || 'unknown';
          logger.error(`Adobe Sign API Error: ${error.message} for ${requestPath}`);
          logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data || {})}`);
        } else {
          logger.error(`Adobe Sign API Network Error: ${error.message}`);
          logger.error(`Request details: ${JSON.stringify({
            method: error.config?.method,
            url: error.config?.url,
            timeout: error.config?.timeout
          })}`);
        }
        return Promise.reject(error);
      }
    );
    
    return client;
  } catch (error) {
    logger.error(`Error creating enhanced Adobe Sign client: ${error.message}`);
    throw error;
  }
};

module.exports = createEnhancedAdobeSignClient;
