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

/**
 * Send a reminder to all pending participants of an agreement
 * @param {string} accessToken - Adobe Sign access token
 * @param {string} agreementId - Adobe Sign agreement ID
 * @param {string} message - Reminder message to send to participants
 * @returns {Promise<Object>} - Adobe Sign API response
 */
const sendReminder = async (accessToken, agreementId, message = 'Please sign this document at your earliest convenience.') => {
  try {
    logger.info(`Sending reminder for agreement: ${agreementId}`);
    
    // Make sure we have the correct base URL
    if (!adobeSignConfig.baseURL) {
      await fetchApiAccessPoints();
    }
    
    // Setup headers
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    };
    
    // Add API user email header if available
    if (process.env.ADOBE_API_USER_EMAIL && process.env.ADOBE_API_USER_EMAIL !== 'your_email@example.com') {
      headers['x-api-user'] = 'email:' + process.env.ADOBE_API_USER_EMAIL;
    }
    
    // Prepare reminder data
    const reminderData = {
      status: 'ACTIVE',
      recipientParticipantIds: [],  // Empty array means all pending participants
      note: message
    };
    
    // Send reminder request
    const response = await axios.post(
      `${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}/reminders`,
      reminderData,
      { headers }
    );
    
    logger.info(`Reminder sent successfully for agreement: ${agreementId}`);
    return response.data;
  } catch (error) {
    logger.error(`Error sending reminder: ${error.message}`);
    if (error.response) {
      logger.error(`Adobe Sign API error: ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Failed to send reminder: ${error.message}`);
  }
};

/**
 * Get information about an agreement
 * @param {string} accessToken - Adobe Sign access token
 * @param {string} agreementId - Adobe Sign agreement ID
 * @returns {Promise<Object>} - Agreement information
 */
const getAgreementInfo = async (accessToken, agreementId) => {
  try {
    logger.info(`Getting agreement info for: ${agreementId}`);
    
    // Make sure we have the correct base URL
    if (!adobeSignConfig.baseURL) {
      await fetchApiAccessPoints();
    }
    
    // Setup headers
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    };
    
    // Add API user email header if available
    if (process.env.ADOBE_API_USER_EMAIL && process.env.ADOBE_API_USER_EMAIL !== 'your_email@example.com') {
      headers['x-api-user'] = 'email:' + process.env.ADOBE_API_USER_EMAIL;
    }
    
    // Get agreement info
    const response = await axios.get(
      `${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}`,
      { headers }
    );
    
    logger.info(`Successfully retrieved agreement info for: ${agreementId}`);
    return response.data;
  } catch (error) {
    logger.error(`Error getting agreement info: ${error.message}`);
    if (error.response) {
      logger.error(`Adobe Sign API error: ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Failed to get agreement info: ${error.message}`);
  }
};

/**
 * Get signing URL for a participant
 * @param {string} accessToken - Adobe Sign access token
 * @param {string} agreementId - Adobe Sign agreement ID
 * @param {string} participantId - Participant ID
 * @returns {Promise<Object>} - Signing URL info
 */
const getSigningUrl = async (accessToken, agreementId, participantId) => {
  try {
    logger.info(`Getting signing URL for participant ${participantId} in agreement: ${agreementId}`);
    
    // Make sure we have the correct base URL
    if (!adobeSignConfig.baseURL) {
      await fetchApiAccessPoints();
    }
    
    // Setup headers
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    };
    
    // Add API user email header if available
    if (process.env.ADOBE_API_USER_EMAIL && process.env.ADOBE_API_USER_EMAIL !== 'your_email@example.com') {
      headers['x-api-user'] = 'email:' + process.env.ADOBE_API_USER_EMAIL;
    }
    
    // Get signing URL
    const response = await axios.get(
      `${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}/signingUrls?participantId=${participantId}`,
      { headers }
    );
    
    logger.info(`Successfully retrieved signing URL for participant: ${participantId}`);
    return response.data;
  } catch (error) {
    logger.error(`Error getting signing URL: ${error.message}`);
    if (error.response) {
      logger.error(`Adobe Sign API error: ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Failed to get signing URL: ${error.message}`);
  }
};

/**
 * Download a signed document from Adobe Sign
 * @param {string} accessToken - Adobe Sign access token
 * @param {string} agreementId - Adobe Sign agreement ID
 * @returns {Promise<Buffer>} - Document file buffer
 */
const downloadSignedDocument = async (accessToken, agreementId) => {
  try {
    logger.info(`Downloading signed document for agreement: ${agreementId}`);
    
    // Make sure we have the correct base URL
    if (!adobeSignConfig.baseURL) {
      await fetchApiAccessPoints();
    }
    
    // Setup headers
    const headers = {
      'Authorization': `Bearer ${accessToken}`
    };
    
    // Add API user email header if available
    if (process.env.ADOBE_API_USER_EMAIL && process.env.ADOBE_API_USER_EMAIL !== 'your_email@example.com') {
      headers['x-api-user'] = 'email:' + process.env.ADOBE_API_USER_EMAIL;
    }
    
    // Download document with responseType: arraybuffer to get binary data
    const response = await axios.get(
      `${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}/documents/combined`,
      { 
        headers,
        responseType: 'arraybuffer'
      }
    );
    
    logger.info(`Successfully downloaded signed document for agreement: ${agreementId}`);
    return Buffer.from(response.data);
  } catch (error) {
    logger.error(`Error downloading signed document: ${error.message}`);
    if (error.response) {
      logger.error(`Adobe Sign API error: Status ${error.response.status}`);
    }
    throw new Error(`Failed to download signed document: ${error.message}`);
  }
};

/**
 * Creates a webhook with Adobe Sign
 * @param {string} accessToken - Adobe Sign access token
 * @param {string} webhookUrl - The URL to receive webhook events
 * @param {string} [scope='ACCOUNT'] - Scope of the webhook (ACCOUNT, GROUP, USER)
 * @returns {Promise<Object>} - Created webhook information
 */
const createWebhook = async (accessToken, webhookUrl, scope = 'ACCOUNT') => {
  try {
    logger.info(`Creating webhook with URL: ${webhookUrl}`);
    
    // Make sure we have the correct base URL
    if (!adobeSignConfig.baseURL) {
      await fetchApiAccessPoints();
    }
    
    // Setup headers
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    };
    
    // Add API user email header if available
    if (process.env.ADOBE_API_USER_EMAIL && process.env.ADOBE_API_USER_EMAIL !== 'your_email@example.com') {
      headers['x-api-user'] = 'email:' + process.env.ADOBE_API_USER_EMAIL;
    }
    
    // Define webhook configuration
    const webhookConfig = {
      name: 'ESignature_Status_Updates',
      scope,
      state: 'ACTIVE',
      webhookSubscriptionEvents: [
        'AGREEMENT_ACTION_COMPLETED',
        'AGREEMENT_SIGNED',
        'AGREEMENT_ACTION_DELEGATED',
        'AGREEMENT_ACTION_DECLINED',
        'AGREEMENT_EMAIL_VIEWED',
        'AGREEMENT_ACTION_VIEWED'
      ],
      webhookUrlInfo: {
        url: webhookUrl
      }
    };
    
    // Create webhook
    const response = await axios.post(
      `${adobeSignConfig.baseURL}api/rest/v6/webhooks`,
      webhookConfig,
      { headers }
    );
    
    logger.info(`Successfully created webhook with ID: ${response.data.id}`);
    return response.data;
  } catch (error) {
    logger.error(`Error creating webhook: ${error.message}`);
    if (error.response) {
      logger.error(`Adobe Sign API error: ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Failed to create webhook: ${error.message}`);
  }
};

module.exports = {
  adobeSignConfig,
  createAdobeSignClient,
  getAccessToken,
  fetchApiAccessPoints,
  uploadTransientDocument,
  sendReminder,
  getAgreementInfo,
  getSigningUrl,
  downloadSignedDocument,
  createWebhook
};
