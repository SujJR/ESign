const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Converts Google Docs/Sheets/Slides URLs to direct download URLs
 * @param {string} url - The Google Docs URL
 * @returns {string} - Direct download URL or original URL if not a Google Docs URL
 */
const convertGoogleDocsUrl = (url) => {
  try {
    // Check if it's a Google Docs URL
    if (url.includes('docs.google.com/document')) {
      // Extract the document ID from the URL
      const docIdMatch = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
      if (docIdMatch && docIdMatch[1]) {
        const docId = docIdMatch[1];
        // Convert to direct PDF download URL
        const downloadUrl = `https://docs.google.com/document/d/${docId}/export?format=pdf`;
        logger.info(`Converted Google Docs URL to direct download: ${downloadUrl}`);
        return downloadUrl;
      }
    } else if (url.includes('docs.google.com/spreadsheets')) {
      // Handle Google Sheets
      const docIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (docIdMatch && docIdMatch[1]) {
        const docId = docIdMatch[1];
        const downloadUrl = `https://docs.google.com/spreadsheets/d/${docId}/export?format=pdf`;
        logger.info(`Converted Google Sheets URL to direct download: ${downloadUrl}`);
        return downloadUrl;
      }
    } else if (url.includes('docs.google.com/presentation')) {
      // Handle Google Slides
      const docIdMatch = url.match(/\/presentation\/d\/([a-zA-Z0-9-_]+)/);
      if (docIdMatch && docIdMatch[1]) {
        const docId = docIdMatch[1];
        const downloadUrl = `https://docs.google.com/presentation/d/${docId}/export/pdf`;
        logger.info(`Converted Google Slides URL to direct download: ${downloadUrl}`);
        return downloadUrl;
      }
    } else if (url.includes('drive.google.com/file')) {
      // Handle Google Drive file URLs
      const fileIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
      if (fileIdMatch && fileIdMatch[1]) {
        const fileId = fileIdMatch[1];
        const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
        logger.info(`Converted Google Drive URL to direct download: ${downloadUrl}`);
        return downloadUrl;
      }
    }
    
    // Return original URL if not a Google URL or couldn't extract ID
    return url;
  } catch (error) {
    logger.warn(`Error converting Google Docs URL: ${error.message}, using original URL`);
    return url;
  }
};

/**
 * Downloads a document from a URL and saves it to the uploads directory
 * @param {string} url - The URL of the document to download
 * @param {string} [filename] - Optional custom filename
 * @param {number} [retryCount=0] - Number of retry attempts (used internally)
 * @param {Object} [customHeaders={}] - Custom headers to include in the request
 * @returns {Promise<Object>} - Object containing the saved file information
 */
const downloadDocumentFromUrl = async (url, filename = null, retryCount = 0, customHeaders = {}) => {
  let filePath = null;
  let writer = null;
  let downloadTimeout = null;
  const MAX_RETRIES = 3;
  
  try {
    // Convert Google Docs URLs to direct download URLs
    const downloadUrl = convertGoogleDocsUrl(url);
    logger.info(`Downloading document from URL: ${downloadUrl}${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : ''}`);
    if (downloadUrl !== url) {
      logger.info(`Original URL: ${url}`);
    }

    // Combine default headers with custom headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 ESign Application', // Add User-Agent to avoid some blocks
      'Accept': 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*',
      'Connection': 'keep-alive',  // Add keep-alive header to prevent socket hang up
      'Cache-Control': 'no-cache',  // Avoid caching issues
      ...customHeaders
    };

    // Make the request to download the file with a timeout
    const response = await axios({
      method: 'GET',
      url: downloadUrl, // Use converted URL
      responseType: 'stream',
      timeout: 60000, // Increased to 60 seconds timeout
      maxContentLength: 25 * 1024 * 1024, // Increased to 25MB max size
      validateStatus: status => status >= 200 && status < 300, // Only accept success status codes
      headers,
      // Handle network level errors more gracefully
      maxRedirects: 5,
      decompress: true,
      transitional: {
        clarifyTimeoutError: true,
        silentJSONParsing: false
      },
      // Using http agent options to keep connections alive
      httpAgent: new (require('http').Agent)({ keepAlive: true }),
      httpsAgent: new (require('https').Agent)({ keepAlive: true }),
    });

    // Get content type and disposition
    const contentType = response.headers['content-type'];
    const contentDisposition = response.headers['content-disposition'];
    
    // Validate content type - reject HTML responses which indicate the URL didn't work
    if (contentType && contentType.includes('text/html')) {
      throw new Error(`Invalid content type: ${contentType}. The URL appears to return HTML instead of a document. For Google Docs, ensure the document is publicly accessible.`);
    }
    
    // Log content type for debugging
    logger.info(`Content-Type: ${contentType || 'not specified'}`);
    if (contentDisposition) {
      logger.info(`Content-Disposition: ${contentDisposition}`);
    }
    
    // Extract original filename if available in content-disposition header
    let originalFilename = null;
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch && filenameMatch[1]) {
        originalFilename = filenameMatch[1].replace(/['"]/g, '');
      }
    }

    // Generate a new filename if none provided or found
    if (!filename && !originalFilename) {
      // For Google Docs PDF exports, force PDF extension
      let extension = determineExtension(contentType, null);
      if (downloadUrl.includes('docs.google.com') && downloadUrl.includes('export?format=pdf')) {
        extension = '.pdf';
        logger.info('Google Docs PDF export detected, forcing .pdf extension');
      }
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
      filename = `url-document-${uniqueSuffix}${extension}`;
    } else if (!filename) {
      // Use the original filename but ensure it has the correct extension based on content type
      const detectedExtension = determineExtension(contentType, originalFilename);
      const currentExtension = path.extname(originalFilename).toLowerCase();
      
      // If current extension doesn't match the content type, append the correct extension
      if (currentExtension && currentExtension !== detectedExtension) {
        logger.info(`File extension mismatch: ${currentExtension} vs ${detectedExtension} (from content-type)`);
        // Keep the original filename but ensure it has the correct extension
        if (detectedExtension !== '.pdf' || currentExtension === '') {
          filename = originalFilename.replace(/\.[^/.]+$/, '') + detectedExtension;
        } else {
          filename = originalFilename; // Keep original if it's not clear which is better
        }
      } else {
        filename = originalFilename;
      }
    }

    // Ensure uploads directory exists
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Create the file path
    filePath = path.join(uploadsDir, filename);
    
    // Create a write stream and pipe the response to it
    writer = fs.createWriteStream(filePath);
    
    // Track the download size
    let fileSize = 0;
    response.data.on('data', (chunk) => {
      fileSize += chunk.length;
    });

    // Return a promise that resolves when the download is complete
    return new Promise((resolve, reject) => {
      // Add error handler for the response stream
      response.data.on('error', (err) => {
        logger.error(`Error in download stream: ${err.message}`);
        if (downloadTimeout) clearTimeout(downloadTimeout);
        if (writer) writer.end();
        if (filePath) fs.unlink(filePath, () => {});
        reject(new Error(`Download stream error: ${err.message}`));
      });
      
      // Set up request aborted handler
      response.request.on('abort', () => {
        logger.error('Request aborted');
        if (downloadTimeout) clearTimeout(downloadTimeout);
        if (writer) writer.end();
        if (filePath) fs.unlink(filePath, () => {});
        reject(new Error('Request aborted - the server may have dropped the connection'));
      });
      
      // Handle socket errors which often cause "socket hang up"
      response.request.once('socket', socket => {
        socket.on('error', (err) => {
          logger.error(`Socket error: ${err.message}`);
          if (downloadTimeout) clearTimeout(downloadTimeout);
          if (writer) writer.end();
          if (filePath) fs.unlink(filePath, () => {});
          reject(new Error(`Socket error: ${err.message}`));
        });
        
        // Set socket timeout to prevent hang
        socket.setTimeout(90000); // 90 seconds socket timeout
        socket.on('timeout', () => {
          logger.error('Socket timeout');
          socket.destroy();
          if (downloadTimeout) clearTimeout(downloadTimeout);
          if (writer) writer.end();
          if (filePath) fs.unlink(filePath, () => {});
          reject(new Error('Socket timeout - the connection was idle for too long'));
        });
      });
      
      // Pipe response to file writer
      response.data.pipe(writer);
      
      // Set a timeout for the overall download process
      downloadTimeout = setTimeout(() => {
        logger.error('Download timeout - operation took too long');
        if (writer) {
          writer.end();
        }
        // Abort the request to prevent socket hang up errors
        if (response.request && typeof response.request.abort === 'function') {
          response.request.abort();
        }
        if (filePath) {
          fs.unlink(filePath, () => {});
        }
        reject(new Error('Download timeout - operation took too long'));
      }, 120000); // Increased to 120 seconds timeout for the entire download
      
      writer.on('finish', () => {
        if (downloadTimeout) clearTimeout(downloadTimeout);
        
        // Verify the file was actually written
        fs.stat(filePath, (err, stats) => {
          if (err || stats.size === 0) {
            logger.error('Downloaded file is empty or not accessible');
            fs.unlink(filePath, () => {});
            reject(new Error('Downloaded file is empty or not accessible'));
            return;
          }
          
          logger.info(`Document successfully downloaded: ${filename} (${fileSize} bytes)`);
          resolve({
            filename,
            originalName: originalFilename || filename,
            mimetype: contentType,
            size: fileSize,
            path: filePath
          });
        });
      });
      
      writer.on('error', (err) => {
        if (downloadTimeout) clearTimeout(downloadTimeout);
        logger.error(`Error writing file: ${err.message}`);
        fs.unlink(filePath, () => {}); // Delete partial file
        reject(err);
      });
    });
  } catch (error) {
    // Clean up resources in case of error
    if (downloadTimeout) clearTimeout(downloadTimeout);
    if (writer) writer.end();
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath); // Delete partial file
      } catch (unlinkError) {
        logger.error(`Failed to delete partial file: ${unlinkError.message}`);
      }
    }
    
    // Check if we should retry
    const retryableErrors = ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH', 'ENOTFOUND', 'socket hang up'];
    const shouldRetry = retryCount < MAX_RETRIES && 
                       (retryableErrors.some(code => error.code === code || error.message.includes(code)));
    
    if (shouldRetry) {
      logger.warn(`Retrying download after error: ${error.message} (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      
      // Exponential backoff - wait longer after each retry
      const backoffTime = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, backoffTime));
      
      // Retry with incremented count
      return downloadDocumentFromUrl(url, filename, retryCount + 1, customHeaders);
    }
    
    // Provide specific error messages for common network errors
    let errorMessage = 'Failed to download document from URL';
    
    if (error.code === 'ECONNABORTED') {
      errorMessage = 'Connection timed out while downloading the document';
    } else if (error.code === 'ECONNRESET' || error.message.includes('socket hang up')) {
      errorMessage = 'Connection reset by the server - socket hang up';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'Server not found - check the URL and your network connection';
    } else if (error.response) {
      // The request was made and the server responded with a status code outside of 2xx
      errorMessage = `Server responded with status ${error.response.status}: ${error.response.statusText}`;
    } else if (error.request) {
      // The request was made but no response was received
      errorMessage = 'No response received from the server - socket hang up';
    } 
    
    logger.error(`Error downloading document (after ${retryCount} retries): ${error.message}`);
    throw new Error(`${errorMessage}: ${error.message}`);
  }
};

/**
 * Determines file extension based on content type and file name
 * @param {string} contentType - MIME type of the file
 * @param {string} originalFilename - Original filename if available
 * @returns {string} - File extension including dot
 */
const determineExtension = (contentType, originalFilename = null) => {
  // First check if we have an original filename with extension
  if (originalFilename) {
    const ext = path.extname(originalFilename).toLowerCase();
    if (ext) {
      logger.info(`Using extension from original filename: ${ext}`);
      return ext;
    }
  }
  
  // Check for Google Drive specific content types
  if (contentType && contentType.includes('application/vnd.google-apps.document')) {
    logger.info('Detected Google Docs document, using .docx extension');
    return '.docx';
  }
  
  // If we have content type, map it to an extension
  if (contentType) {
    switch (contentType.toLowerCase().split(';')[0].trim()) {
      case 'application/pdf':
        return '.pdf';
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return '.docx';
      case 'application/msword':
        return '.doc';
      case 'application/json':
        return '.json';
      case 'application/vnd.google-apps.document':
        return '.docx';
      case 'text/plain':
        return '.txt';
      default:
        // For unknown types, check if the content type contains useful hints
        if (contentType.includes('word') || contentType.includes('docx')) {
          return '.docx';
        } else if (contentType.includes('pdf')) {
          return '.pdf';
        } else {
          logger.warn(`Unknown content type: ${contentType}, defaulting to .pdf`);
          return '.pdf';
        }
    }
  }
  
  // Default to PDF if we have no reliable information
  logger.warn('No content type or filename available, defaulting to .pdf extension');
  return '.pdf';
};

/**
 * Combines multiple JSON files into a single JSON object
 * @param {Array<string>} filePaths - Array of paths to JSON files
 * @returns {Promise<Object>} - Combined JSON object
 */
const combineJsonFiles = async (filePaths) => {
  try {
    logger.info(`Combining ${filePaths.length} JSON files`);
    
    const combinedJson = {};
    
    for (const filePath of filePaths) {
      const jsonContent = fs.readFileSync(filePath, 'utf8');
      const jsonData = JSON.parse(jsonContent);
      
      // Merge the JSON data into the combined object
      Object.assign(combinedJson, jsonData);
      
      // Delete the JSON file after processing
      fs.unlinkSync(filePath);
      logger.info(`Processed and removed JSON file: ${path.basename(filePath)}`);
    }
    
    logger.info(`Successfully combined JSON data with ${Object.keys(combinedJson).length} keys`);
    return combinedJson;
  } catch (error) {
    logger.error(`Error combining JSON files: ${error.message}`);
    throw new Error(`Failed to combine JSON files: ${error.message}`);
  }
};

/**
 * Process JSON file(s) uploaded from form data
 * @param {Object|Array} files - Single file object or array of file objects
 * @returns {Promise<Object>} - Combined JSON data
 */
const processJsonFiles = async (files) => {
  try {
    // Handle single file or array of files
    const jsonFiles = Array.isArray(files) ? files : [files];
    const jsonFilePaths = jsonFiles.map(file => file.path);
    
    // Combine all JSON files
    return await combineJsonFiles(jsonFilePaths);
  } catch (error) {
    logger.error(`Error processing JSON files: ${error.message}`);
    throw new Error(`Failed to process JSON files: ${error.message}`);
  }
};

/**
 * Validates and downloads a document from a URL
 * @param {string} url - URL to download document from
 * @returns {Promise<Object>} - Document file information
 */
const validateAndDownloadUrl = async (url) => {
  try {
    // Basic URL validation
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid document URL - URL must be a string');
    }
    
    // Validate URL format
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      throw new Error('Invalid URL format - could not parse URL');
    }
    
    // Check protocol
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Invalid URL protocol - only HTTP and HTTPS protocols are supported');
    }
    
    // Check for reasonable URL length
    if (url.length > 2048) {
      throw new Error('URL is too long - maximum length is 2048 characters');
    }
    
    // Avoid localhost/private IP ranges in production
    if (process.env.NODE_ENV === 'production') {
      const hostname = parsedUrl.hostname.toLowerCase();
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || 
          hostname.startsWith('10.') || hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
        throw new Error('Invalid URL - localhost and private IPs are not allowed in production');
      }
    }
    
    // Special handling for Google Drive URLs
    let downloadUrl = url;
    let customHeaders = {};
    
    if (parsedUrl.hostname.includes('google.com') || 
        parsedUrl.hostname.includes('docs.google.com') || 
        parsedUrl.hostname.includes('drive.google.com')) {
      
      logger.info('Detected Google Drive URL, applying special handling');
      
      // For Google Docs/Drive URLs, we need to transform them to export format
      if (url.includes('/document/d/') || url.includes('/file/d/')) {
        const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (fileIdMatch && fileIdMatch[1]) {
          const fileId = fileIdMatch[1];
          // Use the Google Docs export link to get DOCX format
          downloadUrl = `https://docs.google.com/document/d/${fileId}/export?format=docx`;
          logger.info(`Modified Google URL to export format: ${downloadUrl}`);
          
          // Add specific headers for Google Drive requests
          customHeaders = {
            'Accept': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          };
        }
      }
    }
    
    // Download the document with custom headers if necessary
    return await downloadDocumentFromUrl(downloadUrl, null, 0, customHeaders);
  } catch (error) {
    logger.error(`Error validating and downloading URL: ${error.message}`);
    throw error;
  }
};

/**
 * Get the base URL from the request object
 * @param {Object} req - Express request object
 * @returns {string} Base URL
 */
const getBaseUrl = (req) => {
  try {
    // If we have a trusted X-Forwarded-Proto and X-Forwarded-Host, use those
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost';
    
    return `${protocol}://${host}`;
  } catch (error) {
    logger.error(`Error getting base URL: ${error.message}`);
    // Fallback to environment variable or default
    return process.env.BASE_URL || process.env.ADOBE_WEBHOOK_URL?.replace('/api/webhooks/adobe-sign', '') || 'http://localhost:3000';
  }
};

module.exports = {
  downloadDocumentFromUrl,
  combineJsonFiles,
  processJsonFiles,
  validateAndDownloadUrl,
  getBaseUrl
};
