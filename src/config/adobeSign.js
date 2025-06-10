const axios = require('axios');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

/**
 * Adobe Sign API client configuration
 */
const adobeSignConfig = {
  clientId: process.env.ADOBE_CLIENT_ID,
  clientSecret: process.env.ADOBE_CLIENT_SECRET,
  // Initial base URL for getting API access points
  initialBaseURL: process.env.ADOBE_API_BASE_URL ? 
    (process.env.ADOBE_API_BASE_URL.endsWith('/') 
      ? process.env.ADOBE_API_BASE_URL 
      : `${process.env.ADOBE_API_BASE_URL}/`) 
    : 'https://api.na1.adobesign.com/',
  // The actual API base URL will be fetched from /baseUris endpoint
  baseURL: null,
  integrationKey: process.env.ADOBE_INTEGRATION_KEY,
};

/**
 * Creates an axios instance for Adobe Sign API calls
 * Note: This implementation uses direct API Key authentication rather than OAuth
 * @returns {object} - Axios instance configured for Adobe Sign API
 */
const createAdobeSignClient = async () => {
  try {
    // Get access token
    const token = await getAccessToken();
    
    // Get the correct API access point if not already fetched
    if (!adobeSignConfig.baseURL) {
      await fetchApiAccessPoints();
    }
    
    // Setup headers
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
    
    // Add API user email header if available
    if (process.env.ADOBE_API_USER_EMAIL && process.env.ADOBE_API_USER_EMAIL !== 'your_email@example.com') {
      headers['x-api-user'] = 'email:' + process.env.ADOBE_API_USER_EMAIL;
    }
    
    // Create axios instance with the correct base URL
    const client = axios.create({
      baseURL: adobeSignConfig.baseURL,
      headers
    });

    // Add response interceptor for error handling
    client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error(`Adobe Sign API Error: ${error.message}`);
        if (error.response) {
          logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
          // Log headers for debugging
          logger.error(`Request Headers: ${JSON.stringify(error.config.headers)}`);
          
          // If we get an INVALID_API_ACCESS_POINT error, try to refresh the base URI
          if (error.response.data && 
              error.response.data.code === 'INVALID_API_ACCESS_POINT') {
            logger.warn('Invalid API access point detected, will refresh for next request');
            // Reset baseURL to force a refresh on next client creation
            adobeSignConfig.baseURL = null;
          }
        }
        return Promise.reject(error);
      }
    );

    return client;
  } catch (error) {
    logger.error(`Error creating Adobe Sign client: ${error.message}`);
    throw error;
  }
};

/**
 * Gets an access token for Adobe Sign API
 * For this implementation, we're using the integration key directly
 * @returns {Promise<string>} - Access token
 */
const getAccessToken = async () => {
  try {
    // Check if integration key exists
    if (!adobeSignConfig.integrationKey) {
      throw new Error('Adobe Sign integration key not configured');
    }
    
    logger.info('Using integration key as access token');
    return adobeSignConfig.integrationKey;
  } catch (error) {
    logger.error(`Error obtaining Adobe Sign access token: ${error.message}`);
    throw error;
  }
};

/**
 * Fetches the correct API access point URLs from Adobe Sign
 * This is a required first step before making other API calls
 * @returns {Promise<Object>} - Object containing API access points
 */
const fetchApiAccessPoints = async () => {
  try {
    logger.info('Fetching Adobe Sign API access points');
    
    // Get access token
    const token = await getAccessToken();
    
    // Make request to get base URIs
    const response = await axios.get(`${adobeSignConfig.initialBaseURL}api/rest/v6/baseUris`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Log success
    logger.info('Successfully fetched Adobe Sign API access points');
    
    // Store the api access point in config
    if (response.data && response.data.apiAccessPoint) {
      // Make sure the URL ends with a slash
      adobeSignConfig.baseURL = response.data.apiAccessPoint.endsWith('/') 
        ? response.data.apiAccessPoint 
        : `${response.data.apiAccessPoint}/`;
      
      logger.info(`Using Adobe Sign API access point: ${adobeSignConfig.baseURL}`);
    } else {
      logger.warn('No API access point found in response, using initial base URL');
      adobeSignConfig.baseURL = adobeSignConfig.initialBaseURL;
    }
    
    return response.data;
  } catch (error) {
    logger.error(`Error fetching Adobe Sign API access points: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
    }
    
    // If we can't get the access points, use the initial base URL
    logger.warn('Using initial base URL as fallback');
    adobeSignConfig.baseURL = adobeSignConfig.initialBaseURL;
    
    throw error;
  }
};

/**
 * Uploads a document to Adobe Sign as a transient document
 * This is a more reliable approach than using base64 encoding in the agreement creation
 * @param {string} filePath - Path to the file to upload
 * @returns {Promise<string>} - Transient document ID
 */
const uploadTransientDocument = async (filePath) => {
  try {
    // Ensure we have the correct API access point
    if (!adobeSignConfig.baseURL) {
      await fetchApiAccessPoints();
    }
    
    // Get access token
    const token = await getAccessToken();
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found at path: ${filePath}`);
    }
    
    // Get file stats
    const fileStats = fs.statSync(filePath);
    if (fileStats.size === 0) {
      throw new Error('File is empty');
    }
    
    logger.info(`Uploading file ${path.basename(filePath)} (${fileStats.size} bytes) as transient document`);
    
    // Create form data for multipart upload
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('File-Name', path.basename(filePath));
    formData.append('Mime-Type', 'application/pdf');
    formData.append('File', fs.createReadStream(filePath));
    
    // Setup headers
    const headers = {
      'Authorization': `Bearer ${token}`
    };
    
    // Add API user email header if available
    if (process.env.ADOBE_API_USER_EMAIL) {
      headers['x-api-user'] = 'email:' + process.env.ADOBE_API_USER_EMAIL;
    }
    
    // Upload file
    const response = await axios.post(
      `${adobeSignConfig.baseURL}api/rest/v6/transientDocuments`, 
      formData,
      {
        headers: {
          ...headers,
          ...formData.getHeaders()
        }
      }
    );
    
    logger.info(`File uploaded successfully as transient document: ${response.data.transientDocumentId}`);
    return response.data.transientDocumentId;
  } catch (error) {
    logger.error(`Error uploading transient document: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
};

module.exports = {
  adobeSignConfig,
  createAdobeSignClient,
  getAccessToken,
  fetchApiAccessPoints,
  uploadTransientDocument
};
