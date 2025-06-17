const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Downloads a document from a URL and saves it to the uploads directory
 * @param {string} url - The URL of the document to download
 * @param {string} [filename] - Optional custom filename
 * @returns {Promise<Object>} - Object containing the saved file information
 */
const downloadDocumentFromUrl = async (url, filename = null) => {
  try {
    logger.info(`Downloading document from URL: ${url}`);

    // Make the request to download the file
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    // Get content type and disposition
    const contentType = response.headers['content-type'];
    const contentDisposition = response.headers['content-disposition'];
    
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
      const extension = determineExtension(contentType);
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
      filename = `url-document-${uniqueSuffix}${extension}`;
    } else if (!filename) {
      filename = originalFilename;
    }

    // Ensure uploads directory exists
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Create the file path
    const filePath = path.join(uploadsDir, filename);
    
    // Create a write stream and pipe the response to it
    const writer = fs.createWriteStream(filePath);
    
    // Track the download size
    let fileSize = 0;
    response.data.on('data', (chunk) => {
      fileSize += chunk.length;
    });

    // Return a promise that resolves when the download is complete
    return new Promise((resolve, reject) => {
      response.data.pipe(writer);
      
      writer.on('finish', () => {
        logger.info(`Document successfully downloaded: ${filename} (${fileSize} bytes)`);
        resolve({
          filename,
          originalName: originalFilename || filename,
          mimetype: contentType,
          size: fileSize,
          path: filePath
        });
      });
      
      writer.on('error', (err) => {
        logger.error(`Error writing file: ${err.message}`);
        fs.unlink(filePath, () => {}); // Delete partial file
        reject(err);
      });
    });
  } catch (error) {
    logger.error(`Error downloading document: ${error.message}`);
    throw new Error(`Failed to download document from URL: ${error.message}`);
  }
};

/**
 * Determines file extension based on content type
 * @param {string} contentType - MIME type of the file
 * @returns {string} - File extension including dot
 */
const determineExtension = (contentType) => {
  switch (contentType) {
    case 'application/pdf':
      return '.pdf';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return '.docx';
    case 'application/msword':
      return '.doc';
    case 'application/json':
      return '.json';
    default:
      return '.pdf'; // Default to PDF if unknown
  }
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
      throw new Error('Invalid document URL');
    }
    
    // Validate URL format
    try {
      new URL(url);
    } catch (error) {
      throw new Error('Invalid URL format');
    }
    
    // Download the document
    return await downloadDocumentFromUrl(url);
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
