/**
 * Enhanced version of URL utilities specifically for document upload with JSON data
 * This module provides better error handling and more robust network communication
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const streamPipeline = promisify(require('stream').pipeline);
const logger = require('./logger');
const https = require('https');
const http = require('http');

// Create axios instance with enhanced configuration for reliable downloads
const axiosInstance = axios.create({
  timeout: 90000, // 90 seconds timeout
  maxContentLength: 50 * 1024 * 1024, // 50MB max size for document download
  maxBodyLength: 50 * 1024 * 1024, // 50MB max size for uploads
  validateStatus: status => status >= 200 && status < 300,
  headers: {
    'User-Agent': 'Mozilla/5.0 ESign Application',
    'Accept': 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache'
  },
  maxRedirects: 5,
  decompress: true,
  // Create custom HTTP and HTTPS agents with improved configuration
  httpAgent: new http.Agent({
    keepAlive: true,
    timeout: 90000,
    maxSockets: 10,
    maxFreeSockets: 5
  }),
  httpsAgent: new https.Agent({
    keepAlive: true,
    timeout: 90000,
    maxSockets: 10,
    maxFreeSockets: 5,
    rejectUnauthorized: false // Only for test URLs, consider enabling in production
  }),
});

/**
 * Downloads a document from a URL with enhanced error handling and retry mechanism
 * @param {string} url - The URL to download from
 * @returns {Promise<Object>} - Information about the downloaded file
 */
const downloadWithEnhancedRetry = async (url) => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000; // 2 seconds
  let attempt = 0;
  let lastError = null;

  // Generate a unique filename
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000000);
  const defaultFilename = `url-document-${timestamp}-${random}`;
  
  while (attempt < MAX_RETRIES) {
    let tempFilePath = null;
    let responseHeaders = null;
    
    try {
      logger.info(`Downloading document from URL (attempt ${attempt + 1}/${MAX_RETRIES}): ${url}`);
      
      // Make a HEAD request first to check content type and size
      const headResponse = await axiosInstance.head(url).catch(error => {
        logger.warn(`HEAD request failed: ${error.message}, proceeding with direct GET request`);
        return { headers: {} };
      });
      
      responseHeaders = headResponse.headers;
      const contentType = responseHeaders['content-type'] || 'application/octet-stream';
      const contentLength = responseHeaders['content-length'] || 0;
      
      logger.info(`Content type: ${contentType}, Size: ${contentLength || 'unknown'} bytes`);
      
      // Determine file extension
      const extension = getExtensionFromContentType(contentType);
      const filename = `${defaultFilename}${extension}`;
      
      // Create uploads directory if it doesn't exist
      const uploadsDir = path.join(__dirname, '../uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      // Set the file path
      tempFilePath = path.join(uploadsDir, filename);
      
      // Download the file
      const response = await axiosInstance({
        method: 'GET',
        url: url,
        responseType: 'stream',
      });
      
      responseHeaders = response.headers;
      
      // Use stream pipeline for better error handling
      await streamPipeline(response.data, fs.createWriteStream(tempFilePath));
      
      // Verify file exists and is not empty
      const stats = fs.statSync(tempFilePath);
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      logger.info(`Successfully downloaded document to ${tempFilePath} (${stats.size} bytes)`);
      
      // Determine content type from response headers
      const finalContentType = responseHeaders['content-type'] || contentType;
      
      return {
        filename,
        originalName: getFilenameFromUrl(url) || filename,
        mimetype: finalContentType,
        size: stats.size,
        path: tempFilePath
      };
    } catch (error) {
      lastError = error;
      logger.error(`Download attempt ${attempt + 1} failed: ${error.message}`);
      
      // Clean up any partial download
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (cleanupError) {
          logger.error(`Failed to clean up partial download: ${cleanupError.message}`);
        }
      }
      
      // Check if we should retry
      const retryableErrors = [
        'socket hang up', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 
        'EHOSTUNREACH', 'ENOTFOUND', 'timeout', 'network error'
      ];
      
      const shouldRetry = retryableErrors.some(errText => 
        error.message.toLowerCase().includes(errText.toLowerCase())
      );
      
      if (shouldRetry && attempt < MAX_RETRIES - 1) {
        attempt++;
        logger.info(`Retrying download in ${RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
        continue;
      } else {
        break;
      }
    }
  }
  
  // If we've exhausted all retries, throw the last error
  throw lastError || new Error('Failed to download document after multiple attempts');
};

/**
 * Extracts filename from URL
 * @param {string} url - The URL to extract filename from
 * @returns {string|null} - Extracted filename or null
 */
function getFilenameFromUrl(url) {
  try {
    const urlPath = new URL(url).pathname;
    const fileName = path.basename(urlPath);
    return fileName || null;
  } catch (error) {
    return null;
  }
}

/**
 * Determines file extension based on content type
 * @param {string} contentType - The content type
 * @returns {string} - File extension including dot
 */
function getExtensionFromContentType(contentType) {
  const contentTypeLower = contentType.toLowerCase();
  
  if (contentTypeLower.includes('pdf')) {
    return '.pdf';
  } else if (contentTypeLower.includes('openxmlformats-officedocument.wordprocessingml')) {
    return '.docx';
  } else if (contentTypeLower.includes('msword')) {
    return '.doc';
  } else if (contentTypeLower.includes('json')) {
    return '.json';
  } else if (contentTypeLower.includes('text/plain')) {
    return '.txt';
  } else {
    return '.pdf'; // Default extension
  }
}

/**
 * Process JSON files with enhanced error handling
 * @param {Array} files - Array of file objects
 * @returns {Promise<Object>} - Combined JSON data
 */
const processJsonFilesEnhanced = async (files) => {
  if (!files || (Array.isArray(files) && files.length === 0)) {
    return {};
  }

  try {
    const jsonFiles = Array.isArray(files) ? files : [files];
    const combinedJson = {};
    
    for (const file of jsonFiles) {
      try {
        if (!fs.existsSync(file.path)) {
          logger.warn(`JSON file not found: ${file.path}`);
          continue;
        }
        
        const jsonContent = fs.readFileSync(file.path, 'utf8');
        
        try {
          const jsonData = JSON.parse(jsonContent);
          
          // Merge the JSON data into the combined object
          Object.assign(combinedJson, jsonData);
          
          // Delete the JSON file after processing
          fs.unlinkSync(file.path);
          logger.info(`Processed and removed JSON file: ${path.basename(file.path)}`);
        } catch (parseError) {
          logger.error(`Error parsing JSON file ${file.path}: ${parseError.message}`);
          continue; // Skip this file but continue processing others
        }
      } catch (fileError) {
        logger.error(`Error processing JSON file ${file.path}: ${fileError.message}`);
        continue; // Skip this file but continue processing others
      }
    }
    
    logger.info(`Successfully combined JSON data with ${Object.keys(combinedJson).length} keys`);
    return combinedJson;
  } catch (error) {
    logger.error(`Error processing JSON files: ${error.message}`);
    throw new Error(`Failed to process JSON files: ${error.message}`);
  }
};

/**
 * Validates a URL string and checks if it's accessible
 * @param {string} url - URL to validate
 * @returns {Promise<boolean>} - True if valid and accessible
 */
const validateUrl = async (url) => {
  try {
    // Check if the URL is valid
    new URL(url);
    
    // Check if the URL is accessible with a HEAD request
    try {
      await axiosInstance.head(url, { timeout: 5000 });
      return true;
    } catch (headError) {
      logger.warn(`HEAD request failed for URL validation: ${headError.message}`);
      
      // If HEAD fails, try a GET request with a short timeout
      try {
        await axiosInstance.get(url, { 
          timeout: 5000,
          maxContentLength: 1024, // Just check if the URL is accessible
          responseType: 'stream' 
        });
        return true;
      } catch (getError) {
        logger.error(`URL validation failed: ${getError.message}`);
        return false;
      }
    }
  } catch (error) {
    logger.error(`Invalid URL format: ${error.message}`);
    return false;
  }
};

module.exports = {
  downloadWithEnhancedRetry,
  processJsonFilesEnhanced,
  validateUrl
};
