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
    // Validate Adobe Sign configuration first
    const configValidation = validateAdobeSignConfig();
    if (!configValidation.isValid) {
      logger.error('Adobe Sign configuration validation failed:', configValidation.errors);
      throw new Error(`Adobe Sign configuration error: ${configValidation.errors.join(', ')}`);
    }
    
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
    
    // Check file size limit (Adobe Sign has limits)
    const maxFileSize = 100 * 1024 * 1024; // 100MB
    if (fileStats.size > maxFileSize) {
      throw new Error(`File is too large (${Math.round(fileStats.size / 1024 / 1024)}MB). Maximum allowed size is 100MB.`);
    }
    
    logger.info(`Uploading file ${path.basename(filePath)} (${fileStats.size} bytes) as transient document`);
    
    // Create form data for multipart upload
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('File-Name', path.basename(filePath));
    
    // Set correct MIME type based on file extension
    const fileExtension = path.extname(filePath).toLowerCase();
    let mimeType = 'application/pdf';
    if (fileExtension === '.docx') {
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (fileExtension === '.doc') {
      mimeType = 'application/msword';
    }
    
    formData.append('Mime-Type', mimeType);
    formData.append('File', fs.createReadStream(filePath));
    
    // Setup headers
    const headers = {
      'Authorization': `Bearer ${token}`
    };
    
    // Add API user email header if available
    if (process.env.ADOBE_API_USER_EMAIL && process.env.ADOBE_API_USER_EMAIL !== 'your_adobe_sign_email') {
      headers['x-api-user'] = 'email:' + process.env.ADOBE_API_USER_EMAIL;
      logger.info(`Using API user email: ${process.env.ADOBE_API_USER_EMAIL}`);
    } else {
      logger.warn('No API user email configured - this may cause authentication issues');
    }
    
    // Upload file
    const response = await axios.post(
      `${adobeSignConfig.baseURL}api/rest/v6/transientDocuments`, 
      formData,
      {
        headers: {
          ...headers,
          ...formData.getHeaders()
        },
        timeout: 60000, // 60 second timeout for large files
        maxBodyLength: maxFileSize,
        maxContentLength: maxFileSize
      }
    );
    
    logger.info(`File uploaded successfully as transient document: ${response.data.transientDocumentId}`);
    return response.data.transientDocumentId;
  } catch (error) {
    logger.error(`Error uploading transient document: ${error.message}`);
    
    if (error.response) {
      logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
      
      // Provide more specific error messages based on status codes
      if (error.response.status === 401) {
        throw new Error('Authentication failed. Please check your Adobe Sign integration key and API user email.');
      } else if (error.response.status === 403) {
        throw new Error('Access forbidden. Please check your Adobe Sign permissions and API user configuration.');
      } else if (error.response.status === 413) {
        throw new Error('File is too large for Adobe Sign. Maximum file size is 100MB.');
      } else if (error.response.status === 415) {
        throw new Error('Unsupported file type. Please use PDF, DOCX, or DOC files.');
      } else if (error.response.data && error.response.data.message) {
        throw new Error(`Adobe Sign API error: ${error.response.data.message}`);
      }
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
const sendReminder = async (accessToken, agreementId, message = 'Please sign this document at your earliest convenience.', participantIds = null) => {
  try {
    logger.info(`Sending reminder for agreement: ${agreementId}`);
    
    // Make sure we have the correct base URL
    if (!adobeSignConfig.baseURL) {
      await fetchApiAccessPoints();
    }
    
    // If no participant IDs provided, get agreement info to extract them
    let targetParticipantIds = participantIds || [];
    
    // If no participant IDs provided, we need to fetch participants from the agreement
    if (!targetParticipantIds || targetParticipantIds.length === 0) {
      logger.info('No participant IDs provided, fetching active participants from agreement');
      
      try {
        const agreementInfo = await getComprehensiveAgreementInfo(accessToken, agreementId);
        
        // Try different possible locations where participant info might be found
        if (agreementInfo.participants && agreementInfo.participants.participantSets) {
          for (const participantSet of agreementInfo.participants.participantSets) {
            if (participantSet.role === 'SIGNER') {
              for (const member of participantSet.memberInfos || []) {
                if (member.id) {
                  targetParticipantIds.push(member.id);
                  logger.info(`Found participant ID: ${member.id} (${member.email || 'unknown'}, status: ${member.status || 'unknown'})`);
                }
              }
            }
          }
        }
        
        // Try alternative location for participant data
        if (targetParticipantIds.length === 0 && agreementInfo.participantSets) {
          for (const participantSet of agreementInfo.participantSets) {
            if (participantSet.role === 'SIGNER') {
              for (const member of participantSet.memberInfos || []) {
                if (member.id) {
                  targetParticipantIds.push(member.id);
                  logger.info(`Found participant ID (alt location): ${member.id} (${member.email || 'unknown'}, status: ${member.status || 'unknown'})`);
                }
              }
            }
          }
        }
        
        logger.info(`Found ${targetParticipantIds.length} participant IDs from agreement`);
      } catch (error) {
        logger.error(`Error fetching agreement participants: ${error.message}`);
      }
    }
    
    // If we still don't have any participant IDs, we can't send a reminder
    if (targetParticipantIds.length === 0) {
      throw new Error('No participant IDs found for this agreement - Adobe Sign API requires at least one valid participant ID');
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

    // Prepare reminder data with the participant IDs
    const reminderData = {
      status: 'ACTIVE',
      recipientParticipantIds: targetParticipantIds,
      note: message
    };

    // Log the request we're about to make
    logger.info(`Sending reminder request to: ${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}/reminders`);
    logger.info(`Including ${targetParticipantIds.length} participant IDs in reminder request`);
    
    // Log the request payload
    logger.info(`Reminder request data: ${JSON.stringify(reminderData)}`);

    // Send reminder request with a timeout
    const response = await axios.post(
      `${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}/reminders`,
      reminderData,
      { 
        headers,
        timeout: 30000 // 30 seconds timeout
      }
    );

    // Log the response
    logger.info(`Reminder API response status: ${response.status}`);
    logger.info(`Reminder sent successfully for agreement: ${agreementId}`);
    
    return response.data;
  } catch (error) {
    // Log detailed error information
    logger.error(`Error sending reminder: ${error.message}`);
    
    if (error.response) {
      // The request was made and the server responded with a status code outside of 2xx
      logger.error(`Adobe Sign API error status: ${error.response.status}`);
      logger.error(`Adobe Sign API error data: ${JSON.stringify(error.response.data || {})}`);
      
      // Handle specific error codes
      if (error.response.status === 404) {
        throw new Error(`Agreement not found or you don't have permission to access it: ${agreementId}`);
      } else if (error.response.status === 403) {
        throw new Error(`Permission denied when sending reminder for agreement: ${agreementId}`);
      } else if (error.response.status === 400) {
        throw new Error(`Invalid request when sending reminder: ${JSON.stringify(error.response.data || {})}`);
      }
    } else if (error.request) {
      // The request was made but no response was received
      logger.error('Adobe Sign API did not respond to the reminder request');
      throw new Error('Adobe Sign API did not respond to the reminder request - timeout or connection issue');
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
    
    // Get agreement info with participant information
    // Include participantSets to get detailed participant information
    const response = await axios.get(
      `${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}?include=participantSets`,
      { headers }
    );
    
    logger.info(`Successfully retrieved agreement info for: ${agreementId}`);
    logger.info(`Agreement response keys: ${Object.keys(response.data || {}).join(', ')}`);
    
    // Log participant data structure if available
    if (response.data.participantSets) {
      logger.info(`Found ${response.data.participantSets.length} participant sets`);
    } else {
      logger.warn(`No participantSets found in response`);
    }
    
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

/**
 * Validates Adobe Sign configuration
 * @returns {Object} - Validation result with status and errors
 */
const validateAdobeSignConfig = () => {
  const errors = [];
  
  if (!adobeSignConfig.integrationKey || adobeSignConfig.integrationKey === 'your_adobe_integration_key') {
    errors.push('ADOBE_INTEGRATION_KEY is not configured or using default value');
  }
  
  if (!adobeSignConfig.initialBaseURL) {
    errors.push('ADOBE_API_BASE_URL is not configured');
  }
  
  if (!process.env.ADOBE_API_USER_EMAIL || process.env.ADOBE_API_USER_EMAIL === 'your_adobe_sign_email') {
    errors.push('ADOBE_API_USER_EMAIL is not configured or using default value');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Get comprehensive agreement information including all available participant data
 * This function tries multiple approaches to get participant information
 * @param {string} accessToken - Adobe Sign access token  
 * @param {string} agreementId - Adobe Sign agreement ID
 * @returns {Promise<Object>} - Comprehensive agreement info
 */
const getComprehensiveAgreementInfo = async (accessToken, agreementId) => {
  try {
    logger.info(`Getting comprehensive agreement info for: ${agreementId}`);
    
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
    
    let agreementInfo = null;
    let participantData = null;
    
    // Method 1: Try to get agreement info with participantSets included
    try {
      logger.info('Trying to get agreement info with participantSets...');
      const response1 = await axios.get(
        `${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}?include=participantSets`,
        { headers }
      );
      agreementInfo = response1.data;
      logger.info(`Method 1 success - Agreement response keys: ${Object.keys(agreementInfo || {}).join(', ')}`);
      
      if (agreementInfo.participantSets && agreementInfo.participantSets.length > 0) {
        logger.info(`Found ${agreementInfo.participantSets.length} participant sets via Method 1`);
        return agreementInfo;
      }
    } catch (error) {
      logger.warn(`Method 1 failed: ${error.message}`);
    }
    
    // Method 2: Try to get basic agreement info and participants separately
    try {
      logger.info('Trying to get basic agreement info...');
      const response2 = await axios.get(
        `${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}`,
        { headers }
      );
      agreementInfo = response2.data;
      logger.info(`Method 2 success - Agreement response keys: ${Object.keys(agreementInfo || {}).join(', ')}`);
    } catch (error) {
      logger.warn(`Method 2 failed: ${error.message}`);
    }
    
    // Method 3: Try to get participants via separate endpoint
    try {
      logger.info('Trying to get participants via separate endpoint...');
      const response3 = await axios.get(
        `${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}/members`,
        { headers }
      );
      participantData = response3.data;
      logger.info(`Method 3 success - Participants response keys: ${Object.keys(participantData || {}).join(', ')}`);
      
      // Merge participant data into agreement info
      if (participantData && agreementInfo) {
        agreementInfo.participants = participantData;
        logger.info('Merged participant data from separate endpoint');
      }
    } catch (error) {
      logger.warn(`Method 3 failed: ${error.message}`);
    }
    
    // Method 4: Try to get signing URLs which might contain participant info
    try {
      logger.info('Trying to get signing URLs...');
      const response4 = await axios.get(
        `${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}/signingUrls`,
        { headers }
      );
      const signingUrlData = response4.data;
      logger.info(`Method 4 success - Signing URLs response keys: ${Object.keys(signingUrlData || {}).join(', ')}`);
      
      // Merge signing URL data into agreement info
      if (signingUrlData && agreementInfo) {
        agreementInfo.signingUrls = signingUrlData;
        logger.info('Merged signing URL data');
      }
    } catch (error) {
      logger.warn(`Method 4 failed: ${error.message}`);
    }
    
    // Return whatever we managed to get
    if (agreementInfo) {
      logger.info('Returning comprehensive agreement info');
      return agreementInfo;
    } else {
      throw new Error('Failed to get agreement info via any method');
    }
    
  } catch (error) {
    logger.error(`Error getting comprehensive agreement info: ${error.message}`);
    throw new Error(`Failed to get comprehensive agreement info: ${error.message}`);
  }
};

/**
 * Get actual signing status by checking multiple Adobe Sign endpoints
 * This function works even without full credentials by using alternative detection methods
 * @param {string} accessToken - Adobe Sign access token  
 * @param {string} agreementId - Agreement ID
 * @returns {object} - Enhanced signing status with actual participant states
 */
const getActualSigningStatus = async (accessToken, agreementId, documentRecipients = null) => {
  const status = {
    signedParticipants: [],
    pendingParticipants: [],
    currentSigner: null,
    nextSigner: null,
    detectionMethod: 'none'
  };

  try {
    logger.info(`🔍 Getting actual signing status for agreement: ${agreementId}`);
    
    // Get basic agreement info first
    const agreementInfo = await getAgreementInfo(accessToken, agreementId);
    
    // Extract all participants with their order and current status
    const participants = [];
    
    // Method 1: Try to get participants from the agreement info
    if (agreementInfo && agreementInfo.participantSets && agreementInfo.participantSets.length > 0) {
      logger.info(`Found ${agreementInfo.participantSets.length} participant sets in agreement info`);
      
      for (const participantSet of agreementInfo.participantSets) {
        if (participantSet.role === 'SIGNER') {
          for (const setParticipant of participantSet.memberInfos) {
            participants.push({
              email: setParticipant.email,
              name: setParticipant.name,
              id: setParticipant.id,
              order: participantSet.order,
              status: setParticipant.status,
              originalStatus: setParticipant.status // Keep original for debugging
            });
          }
        }
      }
    } else {
      logger.warn('No participant sets found in agreement info');
      
      // Method 2: Try to use document recipients if available
      if (documentRecipients && documentRecipients.length > 0) {
        logger.info(`Using ${documentRecipients.length} recipients from document data`);
        
        // Map document recipients to participant format
        for (let i = 0; i < documentRecipients.length; i++) {
          const recipient = documentRecipients[i];
          participants.push({
            email: recipient.email,
            name: recipient.name,
            // Assign order based on array index if not specified
            order: recipient.order || i + 1, 
            // Default to ACTIVE status if not specified
            status: recipient.status === 'signed' ? 'SIGNED' : 'ACTIVE',
            originalStatus: recipient.status || 'UNKNOWN'
          });
        }
      }
    }
    
    if (participants.length === 0) {
      logger.warn('No participants found using any method');
      return status;
    }

    logger.info(`Found ${participants.length} participants to analyze`);

    // Method 1: Analyze participant status from Adobe Sign directly
    const participantSigningStatus = [];
    
    for (const baseParticipant of participants) {
      // Check if participant status indicates they've already completed their action
      const completedStatuses = [
        'SIGNED', 'APPROVED', 'ACCEPTED', 'FORM_FILLED', 
        'DELEGATED', 'COMPLETED', 'DECLINED', 'EXPIRED'
      ];
      
      const pendingActionStatuses = [
        'WAITING_FOR_MY_SIGNATURE', 'WAITING_FOR_MY_APPROVAL', 
        'WAITING_FOR_MY_DELEGATION', 'WAITING_FOR_MY_ACCEPTANCE',
        'WAITING_FOR_MY_FORM_FILLING', 'ACTIVE'
      ];
      
      const waitingStatuses = [
        'WAITING_FOR_OTHERS', 'NOT_YET_VISIBLE'
      ];
      
      let actualStatus = 'UNKNOWN';
      let canSign = false;
      let signedDetectedBy = null;
      
      logger.info(`📋 Analyzing participant: ${baseParticipant.email} - Status: ${baseParticipant.status} (Order: ${baseParticipant.order})`);
      
      if (completedStatuses.includes(baseParticipant.status)) {
        actualStatus = 'SIGNED';
        canSign = false;
        signedDetectedBy = 'status_analysis';
        logger.info(`✅ ${baseParticipant.email} COMPLETED via status: ${baseParticipant.status} (order: ${baseParticipant.order})`);
      } else if (pendingActionStatuses.includes(baseParticipant.status)) {
        actualStatus = 'PENDING';
        canSign = true;
        logger.info(`⏳ ${baseParticipant.email} CAN TAKE ACTION: ${baseParticipant.status} (order: ${baseParticipant.order})`);
      } else if (waitingStatuses.includes(baseParticipant.status)) {
        actualStatus = 'WAITING';
        canSign = false;
        logger.info(`⏸️ ${baseParticipant.email} WAITING FOR OTHERS: ${baseParticipant.status} (order: ${baseParticipant.order})`);
      } else {
        logger.warn(`❓ ${baseParticipant.email} has UNKNOWN STATUS: ${baseParticipant.status} (order: ${baseParticipant.order})`);
        // For unknown status, try to be conservative and assume they can sign unless proven otherwise
        actualStatus = 'PENDING';
        canSign = true;
      }
      
      participantSigningStatus.push({
        ...baseParticipant,
        actualStatus,
        canSign,
        signedDetectedBy
      });
    }

    // Method 2: Try to get signing URLs for each participant to double-check
    // If we can't get a signing URL, it typically means they've already signed
    logger.info(`🔗 Testing signing URL availability for each participant...`);
    
    for (const urlParticipant of participantSigningStatus) {
      // Skip if we already determined they're signed from status
      if (urlParticipant.actualStatus === 'SIGNED') {
        logger.info(`⏭️ Skipping ${urlParticipant.email} - already marked as signed`);
        continue;
      }
      
      try {
        logger.info(`🔗 Testing signing URL for ${urlParticipant.email}...`);
        // Use the participant ID if available, otherwise use email as a fallback
        // Note: Using email directly often causes false positives for "already signed"
        const participantParam = urlParticipant.id || urlParticipant.email;
        const signingUrl = await getSigningUrl(accessToken, agreementId, participantParam);
        
        // Debug: Log the full response structure to understand what we're getting
        logger.info(`🔍 Signing URL response structure for ${urlParticipant.email}: ${JSON.stringify(signingUrl, null, 2)}`);
        
        // Check multiple possible response structures
        let hasValidSigningUrl = false;
        let extractedUrl = null;
        
        if (signingUrl) {
          // Check for standard structure: signingUrls array
          if (signingUrl.signingUrls && Array.isArray(signingUrl.signingUrls) && signingUrl.signingUrls.length > 0) {
            hasValidSigningUrl = true;
            extractedUrl = signingUrl.signingUrls[0].esignUrl;
          }
          // Check for alternative structure: direct URL properties
          else if (signingUrl.signingUrl || signingUrl.esignUrl || signingUrl.url) {
            hasValidSigningUrl = true;
            extractedUrl = signingUrl.signingUrl || signingUrl.esignUrl || signingUrl.url;
          }
          // Check if it's a direct string URL
          else if (typeof signingUrl === 'string' && signingUrl.includes('http')) {
            hasValidSigningUrl = true;
            extractedUrl = signingUrl;
          }
          // Check for nested structures or other possible formats
          else if (signingUrl.data && signingUrl.data.signingUrls) {
            hasValidSigningUrl = true;
            extractedUrl = signingUrl.data.signingUrls[0]?.esignUrl;
          }
        }
        
        if (hasValidSigningUrl && extractedUrl) {
          // Participant can still sign - this means they haven't signed yet
          urlParticipant.canSign = true;
          urlParticipant.actualStatus = 'PENDING';
          urlParticipant.signingUrl = extractedUrl;
          logger.info(`✅ ${urlParticipant.email} can still sign - URL available: ${extractedUrl.substring(0, 50)}...`);
        } else {
          // Be more cautious about marking as signed based only on URL unavailability
          // Let's only mark as "likely signed" and rely on other detection methods for confirmation
          logger.info(`🚫 ${urlParticipant.email} has no signing URL - likely already signed`);
          urlParticipant.urlUnavailable = true;
          
          // Don't immediately mark as signed - we'll make that determination after all checks
          // This avoids false positives but we can use this as supporting evidence
          if (urlParticipant.actualStatus === 'PENDING') {
            urlParticipant.likelySignedFromUrl = true;
          }
        }
      } catch (error) {
        // Analyze the error to determine if they've signed
        const errorMessage = error.message.toLowerCase();
        logger.info(`⚠️ Error getting signing URL for ${urlParticipant.email}: ${error.message.substring(0, 200)}`);
        
        // Only specific error messages strongly indicate the participant has already signed
        if (errorMessage.includes('already_signed') || 
            errorMessage.includes('already signed') ||
            errorMessage.includes('participant has completed their actions')) {
          // These errors definitively indicate the participant has already signed
          urlParticipant.canSign = false;
          urlParticipant.actualStatus = 'SIGNED';
          urlParticipant.signedDetectedBy = 'signing_url_error_confirmed';
          logger.info(`✅ ${urlParticipant.email} CONFIRMED SIGNED based on specific error message`);
        } else if (errorMessage.includes('unauthorized') || 
            errorMessage.includes('forbidden') ||
            errorMessage.includes('401') ||
            errorMessage.includes('403') ||
            errorMessage.includes('access denied')) {
          // Authorization errors - inconclusive for signing status
          logger.warn(`🔒 Auth error for ${urlParticipant.email} - inconclusive for signing status`);
          urlParticipant.urlErrorInconclusive = true;
        } else {
          // For other errors, don't assume they've signed - mark as inconclusive
          logger.warn(`⚠️ Inconclusive result for ${urlParticipant.email} - URL error: ${errorMessage.substring(0, 100)}`);
          urlParticipant.urlErrorInconclusive = true;
        }
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Method 3: Get agreement events for definitive signing confirmation
    logger.info(`📋 Getting agreement events for definitive signing confirmation...`);
    try {
      const events = await getAgreementEvents(accessToken, agreementId);
      if (events && events.events && events.events.length > 0) {
        logger.info(`📋 Found ${events.events.length} agreement events`);
        
        // Look for signing completion events and other relevant events
        const signingEvents = events.events.filter(event => {
          const eventType = event.type?.toLowerCase() || '';
          const description = event.description?.toLowerCase() || '';
          
          // Only consider events that definitively indicate completion
          return eventType.includes('esigned') || 
                 eventType.includes('signed') || 
                 eventType.includes('completed') ||
                 eventType.includes('approved') ||
                 eventType.includes('accepted') ||
                 eventType.includes('action_completed') ||  // This indicates completion
                 description.includes('signed') ||
                 description.includes('completed');
        });
        
        logger.info(`🔍 Found ${signingEvents.length} potential signing completion events`);
        
        // Process signing events to mark participants as signed
        for (const event of signingEvents) {
          if (event.participantEmail) {
            const eventParticipant = participantSigningStatus.find(p => 
              p.email.toLowerCase() === event.participantEmail.toLowerCase()
            );
            
            if (eventParticipant) {
              // Only mark as signed for definitive completion events
              const eventType = event.type?.toLowerCase() || '';
              if (eventType.includes('completed') || 
                  eventType.includes('signed') || 
                  eventType.includes('approved') ||
                  eventType.includes('accepted')) {
                
                // Mark as definitely signed based on completion events
                eventParticipant.actualStatus = 'SIGNED';
                eventParticipant.canSign = false;
                eventParticipant.signedDetectedBy = 'completion_event';
                eventParticipant.signedDate = event.date;
                eventParticipant.signedEvent = event.type;
                
                logger.info(`✅ ${event.participantEmail} CONFIRMED SIGNED via completion event: ${event.type} on ${event.date}`);
              } else {
                // For non-completion events, just log but don't mark as signed
                logger.info(`ℹ️ ${event.participantEmail} had event: ${event.type} on ${event.date} (not a completion event)`);
              }
            } else {
              logger.warn(`⚠️ Event for unknown participant: ${event.participantEmail}`);
            }
          }
        }
        
        // Also look for delegation events which might indicate completion
        const delegationEvents = events.events.filter(event => {
          const eventType = event.type?.toLowerCase() || '';
          return eventType.includes('delegated') || eventType.includes('delegation');
        });
        
        for (const event of delegationEvents) {
          if (event.participantEmail) {
            const delegationParticipant = participantSigningStatus.find(p => 
              p.email.toLowerCase() === event.participantEmail.toLowerCase()
            );
            
            if (delegationParticipant && delegationParticipant.actualStatus !== 'SIGNED') {
              delegationParticipant.actualStatus = 'SIGNED';
              delegationParticipant.canSign = false;
              delegationParticipant.signedDetectedBy = 'delegation_event';
              delegationParticipant.signedDate = event.date;
              
              logger.info(`✅ ${event.participantEmail} marked as completed due to delegation event`);
            }
          }
        }
        
        status.detectionMethod = 'comprehensive_with_events';
      } else {
        logger.warn(`No events found for agreement ${agreementId}`);
        status.detectionMethod = 'status_and_urls_only';
      }
    } catch (eventsError) {
      logger.warn(`Could not get agreement events: ${eventsError.message}`);
      status.detectionMethod = 'status_and_urls_only';
    }

    // Method 4: Try to get audit trail for the most reliable signing information
    logger.info(`📜 Attempting to get audit trail for most reliable signing information...`);
    try {
      const auditTrail = await getAgreementAuditTrail(accessToken, agreementId);
      if (auditTrail) {
        logger.info(`📜 Successfully retrieved audit trail`);
        
        // Parse audit trail for signing information
        // The audit trail typically contains detailed signing information
        const auditText = auditTrail.toString?.() || JSON.stringify(auditTrail);
        
        // Look for signing patterns in the audit trail
        for (const auditParticipant of participantSigningStatus) {
          const emailPattern = auditParticipant.email.toLowerCase();
          
          // Check if this participant's email appears in signing contexts
          const signingPatterns = [
            `${emailPattern} signed`,
            `${emailPattern} has signed`,
            `signed by ${emailPattern}`,
            `${emailPattern} completed`,
            `${emailPattern} approved`
          ];
          
          const foundSigningEvidence = signingPatterns.some(pattern => 
            auditText.toLowerCase().includes(pattern)
          );
          
          if (foundSigningEvidence && auditParticipant.actualStatus !== 'SIGNED') {
            auditParticipant.actualStatus = 'SIGNED';
            auditParticipant.canSign = false;
            auditParticipant.signedDetectedBy = 'audit_trail';
            logger.info(`✅ ${auditParticipant.email} confirmed signed via audit trail analysis`);
          }
        }
        
        status.detectionMethod = 'comprehensive_with_audit';
      }
    } catch (auditError) {
      logger.warn(`Could not get audit trail: ${auditError.message}`);
      // Continue with other methods
    }

    // Method 5: Enhanced logic for sequential signing workflows
    logger.info(`🔧 Applying enhanced sequential signing logic...`);
    
    // Count how many participants are still showing as ACTIVE/PENDING after all our checks
    const stillActiveCount = participantSigningStatus.filter(p => 
      p.actualStatus === 'PENDING' && (p.status === 'ACTIVE' || p.status === 'WAITING_FOR_MY_SIGNATURE')
    ).length;
    
    const totalParticipants = participantSigningStatus.length;
    const confirmedSignedCount = participantSigningStatus.filter(p => p.actualStatus === 'SIGNED').length;
    
    logger.info(`📊 After all detection methods: ${stillActiveCount}/${totalParticipants} still showing as active/pending`);
    logger.info(`📊 Confirmed signed participants: ${confirmedSignedCount}/${totalParticipants}`);
    
    // Enhanced sequential signing logic: if we have sequential orders, apply proper workflow logic
    const hasSequentialOrders = participantSigningStatus.some(p => p.order && p.order > 1);
    
    if (hasSequentialOrders) {
      logger.info(`🔄 Applying sequential signing workflow logic`);
      
      // Sort participants by order
      const sortedByOrder = [...participantSigningStatus].sort((a, b) => (a.order || 999) - (b.order || 999));
      
      // Find the first participant who hasn't been confirmed as signed
      let currentSignerIndex = -1;
      for (let i = 0; i < sortedByOrder.length; i++) {
        const sortedParticipant = sortedByOrder[i];
        
        // If this participant hasn't been confirmed as signed, they should be the current signer
        if (sortedParticipant.actualStatus !== 'SIGNED') {
          currentSignerIndex = i;
          break;
        }
      }
      
      if (currentSignerIndex >= 0) {
        const currentSigner = sortedByOrder[currentSignerIndex];
        logger.info(`🎯 Sequential logic identifies current signer: ${currentSigner.email} (order ${currentSigner.order})`);
        
        // Mark the current signer as able to sign
        currentSigner.canSign = true;
        currentSigner.actualStatus = 'PENDING';
        currentSigner.isCurrent = true;
        
        // Mark all participants after the current signer as waiting
        for (let i = currentSignerIndex + 1; i < sortedByOrder.length; i++) {
          const waitingParticipant = sortedByOrder[i];
          if (waitingParticipant.actualStatus !== 'SIGNED') {
            logger.info(`⏸️ ${waitingParticipant.email} (order ${waitingParticipant.order}) is waiting for their turn`);
            waitingParticipant.canSign = false;
            waitingParticipant.actualStatus = 'WAITING';
            waitingParticipant.waitingReason = 'sequential_order';
          }
        }
        
        status.detectionMethod = 'enhanced_sequential_logic';
      } else {
        logger.info(`✅ All participants in sequential workflow have been confirmed as signed`);
        status.detectionMethod = 'sequential_complete';
      }
    } else if (stillActiveCount > 1) {
      // Parallel signing or unclear workflow
      logger.info(`🔄 Applying parallel signing logic - multiple participants can sign simultaneously`);
      
      // In parallel signing, all non-signed participants can potentially sign
      for (const pendingParticipant of participantSigningStatus) {
        if (pendingParticipant.actualStatus === 'PENDING') {
          pendingParticipant.canSign = true;
        }
      }
      
      status.detectionMethod = 'parallel_signing_logic';
    }

    // Method 6: Use document-level recipient information if available
    if (documentRecipients && documentRecipients.length > 0) {
      logger.info(`📋 Cross-referencing with document recipient information...`);
      
      for (const docRecipient of documentRecipients) {
        const docParticipant = participantSigningStatus.find(p => 
          p.email.toLowerCase() === docRecipient.email.toLowerCase()
        );
        
        if (docParticipant && docRecipient.status) {
          logger.info(`🔍 Document shows ${docRecipient.email} as: ${docRecipient.status}`);
          
          // If document shows recipient as signed, override Adobe Sign status
          if (['signed', 'completed', 'approved'].includes(docRecipient.status.toLowerCase())) {
            if (docParticipant.actualStatus !== 'SIGNED') {
              logger.info(`✅ Overriding ${docRecipient.email} status to SIGNED based on document data`);
              docParticipant.actualStatus = 'SIGNED';
              docParticipant.canSign = false;
              docParticipant.signedDetectedBy = 'document_status';
            }
          }
        }
      }
      
      // Update detection method to include document data
      status.detectionMethod = status.detectionMethod + '_with_document_data';
    }
    
    // Populate the final status object with processed participant data
    for (const finalParticipant of participantSigningStatus) {
      if (finalParticipant.actualStatus === 'SIGNED') {
        status.signedParticipants.push(finalParticipant);
      } else {
        status.pendingParticipants.push(finalParticipant);
        
        // Identify current and next signer for sequential workflows
        if (finalParticipant.canSign && finalParticipant.isCurrent) {
          status.currentSigner = finalParticipant;
        } else if (finalParticipant.actualStatus === 'WAITING' && !status.nextSigner) {
          status.nextSigner = finalParticipant;
        }
      }
    }
    
    // Final check: ensure we have a current signer if there are pending participants
    if (status.pendingParticipants.length > 0 && !status.currentSigner) {
      // If we didn't mark anyone as current, use the first pending participant by order
      const sortedPending = [...status.pendingParticipants].sort((a, b) => (a.order || 999) - (b.order || 999));
      if (sortedPending.length > 0) {
        status.currentSigner = sortedPending[0];
        logger.info(`📌 Final adjustment: setting ${status.currentSigner.email} as current signer (order: ${status.currentSigner.order})`);
      }
    }
    
    logger.info(`✅ Finished analyzing signing status. Detection method: ${status.detectionMethod}`);
    logger.info(`📊 Results: ${status.signedParticipants.length} signed, ${status.pendingParticipants.length} pending`);
    if (status.currentSigner) {
      logger.info(`🎯 Current signer: ${status.currentSigner.email} (${status.currentSigner.name})`);
    }
    
    return status;
  } catch (error) {
    logger.error(`Error getting actual signing status: ${error.message}`);
    throw new Error(`Failed to get actual signing status: ${error.message}`);
  }
};

/**
 * Get agreement events for an agreement
 * @param {string} accessToken - Adobe Sign access token
 * @param {string} agreementId - Adobe Sign agreement ID
 * @returns {Promise<Object>} - Agreement events information
 */
const getAgreementEvents = async (accessToken, agreementId) => {
  try {
    logger.info(`Getting agreement events for: ${agreementId}`);
    
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
    
    // Get agreement events
    const response = await axios.get(
      `${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}/events`,
      { headers }
    );
    
    logger.info(`Successfully retrieved agreement events for: ${agreementId}`);
    return response.data;
  } catch (error) {
    logger.error(`Error getting agreement events: ${error.message}`);
    if (error.response) {
      logger.error(`Adobe Sign API error: ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Failed to get agreement events: ${error.message}`);
  }
};

/**
 * Get audit trail for an agreement
 * @param {string} accessToken - Adobe Sign access token
 * @param {string} agreementId - Adobe Sign agreement ID
 * @returns {Promise<Object>} - Audit trail information
 */
const getAgreementAuditTrail = async (accessToken, agreementId) => {
  try {
    logger.info(`Getting audit trail for agreement: ${agreementId}`);
    
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
    
    // Get audit trail
    const response = await axios.get(
      `${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}/auditTrail`,
      { headers }
    );
    
    logger.info(`Successfully retrieved audit trail for agreement: ${agreementId}`);
    return response.data;
  } catch (error) {
    logger.error(`Error getting audit trail: ${error.message}`);
    if (error.response) {
      logger.error(`Adobe Sign API error: ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Failed to get audit trail: ${error.message}`);
  }
};

/**
 * Validate participant IDs against Adobe Sign
 * @param {string} accessToken - Adobe Sign access token
 * @param {string} agreementId - Adobe Sign agreement ID
 * @param {Array<string>} participantIds - Array of participant IDs to validate
 * @returns {Promise<Array<string>>} - Array of validated participant IDs
 */
const validateParticipantIds = async (accessToken, agreementId, participantIds) => {
  if (!participantIds || participantIds.length === 0) {
    return [];
  }
  
  try {
    logger.info(`Validating ${participantIds.length} participant IDs for agreement: ${agreementId}`);
    
    // Get agreement info to validate participant IDs against actual participants
    const agreementInfo = await getComprehensiveAgreementInfo(accessToken, agreementId);
    const validatedIds = [];
    
    // Track which participants were found and which weren't
    const foundIds = new Set();
    
    // First check main participant sets
    if (agreementInfo?.participants?.participantSets) {
      for (const participantSet of agreementInfo.participants.participantSets) {
        for (const memberInfo of participantSet.memberInfos || []) {
          if (participantIds.includes(memberInfo.id)) {
            validatedIds.push(memberInfo.id);
            foundIds.add(memberInfo.id);
            logger.info(`Validated participant ID: ${memberInfo.id} for ${memberInfo.email}`);
          }
        }
      }
    }
    
    // Check alternate participant locations in the agreement info
    if (agreementInfo?.participantSets) {
      for (const participantSet of agreementInfo.participantSets) {
        for (const memberInfo of participantSet.memberInfos || []) {
          if (participantIds.includes(memberInfo.id) && !foundIds.has(memberInfo.id)) {
            validatedIds.push(memberInfo.id);
            foundIds.add(memberInfo.id);
            logger.info(`Validated participant ID from alternate location: ${memberInfo.id}`);
          }
        }
      }
    }
    
    // Log any IDs that weren't found
    for (const id of participantIds) {
      if (!foundIds.has(id)) {
        logger.warn(`Participant ID not found in agreement: ${id}`);
      }
    }
    
    logger.info(`Validated ${validatedIds.length} out of ${participantIds.length} participant IDs`);
    return validatedIds;
  } catch (error) {
    logger.error(`Error validating participant IDs: ${error.message}`);
    // Return original IDs as fallback
    return participantIds;
  }
};

module.exports = {
  adobeSignConfig,
  createAdobeSignClient,
  getAccessToken,
  fetchApiAccessPoints,
  uploadTransientDocument,
  getAgreementInfo,
  getComprehensiveAgreementInfo,
  getActualSigningStatus,
  sendReminder,
  createWebhook,
  getSigningUrl,
  downloadSignedDocument,
  validateAdobeSignConfig,
  getAgreementEvents,
  getAgreementAuditTrail,
  validateParticipantIds
};
