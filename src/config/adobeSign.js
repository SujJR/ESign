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
    
    if (!participantIds || participantIds.length === 0) {
      logger.info('No participant IDs provided, fetching agreement info to extract pending participants');
      
      try {
        const agreementInfo = await getComprehensiveAgreementInfo(accessToken, agreementId);
        
        if (agreementInfo && agreementInfo.participants && agreementInfo.participants.participantSets) {
          for (const participantSet of agreementInfo.participants.participantSets) {
            if (participantSet.role === 'SIGNER') {
              for (const participant of participantSet.memberInfos) {
                // Only include participants who need to take action
                const needsAction = 
                  participant.status === 'WAITING_FOR_MY_SIGNATURE' ||
                  participant.status === 'WAITING_FOR_MY_APPROVAL' ||
                  participant.status === 'WAITING_FOR_MY_DELEGATION' ||
                  participant.status === 'WAITING_FOR_MY_ACCEPTANCE' ||
                  participant.status === 'WAITING_FOR_MY_FORM_FILLING';
                
                if (needsAction && participant.id) {
                  targetParticipantIds.push(participant.id);
                  logger.info(`Added participant ID for reminder: ${participant.id} (${participant.email})`);
                }
              }
            }
          }
        }
        
        logger.info(`Extracted ${targetParticipantIds.length} participant IDs for reminder`);
      } catch (infoError) {
        logger.warn(`Could not get agreement info for participant extraction: ${infoError.message}`);
        // Continue with empty array - Adobe Sign may handle this gracefully
      }
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

    // Log the request we're about to make
    logger.info(`Sending reminder request to: ${adobeSignConfig.baseURL}api/rest/v6/agreements/${agreementId}/reminders`);

    // Prepare reminder data
    const reminderData = {
      status: 'ACTIVE',
      recipientParticipantIds: targetParticipantIds,
      note: message
    };

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
const getActualSigningStatus = async (accessToken, agreementId) => {
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
    if (!agreementInfo || !agreementInfo.participantSets) {
      logger.warn('No participant sets found in agreement info');
      return status;
    }

    // Extract all participants with their order and current status
    const participants = [];
    for (const participantSet of agreementInfo.participantSets) {
      if (participantSet.role === 'SIGNER') {
        for (const participant of participantSet.memberInfos) {
          participants.push({
            email: participant.email,
            name: participant.name,
            id: participant.id,
            order: participantSet.order,
            status: participant.status,
            originalStatus: participant.status // Keep original for debugging
          });
        }
      }
    }

    logger.info(`Found ${participants.length} participants to analyze`);

    // Method 1: Analyze participant status from Adobe Sign directly
    const participantSigningStatus = [];
    
    for (const participant of participants) {
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
      
      logger.info(`📋 Analyzing participant: ${participant.email} - Status: ${participant.status} (Order: ${participant.order})`);
      
      if (completedStatuses.includes(participant.status)) {
        actualStatus = 'SIGNED';
        canSign = false;
        signedDetectedBy = 'status_analysis';
        logger.info(`✅ ${participant.email} COMPLETED via status: ${participant.status} (order: ${participant.order})`);
      } else if (pendingActionStatuses.includes(participant.status)) {
        actualStatus = 'PENDING';
        canSign = true;
        logger.info(`⏳ ${participant.email} CAN TAKE ACTION: ${participant.status} (order: ${participant.order})`);
      } else if (waitingStatuses.includes(participant.status)) {
        actualStatus = 'WAITING';
        canSign = false;
        logger.info(`⏸️ ${participant.email} WAITING FOR OTHERS: ${participant.status} (order: ${participant.order})`);
      } else {
        logger.warn(`❓ ${participant.email} has UNKNOWN STATUS: ${participant.status} (order: ${participant.order})`);
        // For unknown status, try to be conservative and assume they can sign unless proven otherwise
        actualStatus = 'PENDING';
        canSign = true;
      }
      
      participantSigningStatus.push({
        ...participant,
        actualStatus,
        canSign,
        signedDetectedBy
      });
    }

    // Method 2: Try to get signing URLs for each participant to double-check
    // If we can't get a signing URL, it might mean they've already signed
    for (const participant of participantSigningStatus) {
      if (participant.actualStatus === 'PENDING' || participant.actualStatus === 'UNKNOWN') {
        try {
          const signingUrl = await getSigningUrl(accessToken, agreementId, participant.email);
          
          if (signingUrl && signingUrl.signingUrls && signingUrl.signingUrls.length > 0) {
            // Participant can still sign - confirms pending status
            participant.canSign = true;
            participant.actualStatus = 'PENDING';
            participant.signingUrl = signingUrl.signingUrls[0].esignUrl;
            logger.info(`🔗 ${participant.email} has valid signing URL - confirmed pending`);
          } else {
            // No signing URL available - might have signed
            logger.info(`🚫 ${participant.email} has no signing URL - might have already signed`);
            participant.canSign = false;
            participant.actualStatus = 'SIGNED';
            participant.signedDetectedBy = 'no_signing_url';
          }
        } catch (error) {
          // If getting signing URL fails, analyze the error
          if (error.message.includes('ALREADY_SIGNED') || 
              error.message.includes('PARTICIPANT_NOT_FOUND') ||
              error.message.includes('404')) {
            participant.canSign = false;
            participant.actualStatus = 'SIGNED';
            participant.signedDetectedBy = 'signing_url_error';
            logger.info(`✅ ${participant.email} confirmed signed via URL error: ${error.message.substring(0, 100)}`);
          } else {
            logger.warn(`⚠️ Error getting signing URL for ${participant.email}: ${error.message.substring(0, 100)}`);
            // Keep original status determination
          }
        }
      }
    }

    // Method 3: Get agreement events for additional confirmation
    try {
      const events = await getAgreementEvents(accessToken, agreementId);
      if (events && events.events) {
        logger.info(`📋 Found ${events.events.length} agreement events for additional validation`);
        
        // Look for signing completion events
        for (const event of events.events) {
          if (event.participantEmail && 
              (event.type.includes('ESIGNED') || 
               event.type.includes('SIGNED') || 
               event.type.includes('COMPLETED'))) {
            
            // Find this participant and confirm they've signed
            const participant = participantSigningStatus.find(p => p.email === event.participantEmail);
            if (participant) {
              participant.actualStatus = 'SIGNED';
              participant.canSign = false;
              participant.signedDetectedBy = 'events';
              participant.signedDate = event.date;
              logger.info(`✅ ${event.participantEmail} confirmed signed via events: ${event.type} on ${event.date}`);
            }
          }
        }
        status.detectionMethod = 'comprehensive';
      }
    } catch (eventsError) {
      logger.warn(`Could not get agreement events: ${eventsError.message}`);
      status.detectionMethod = 'status_and_urls';
    }

    // Sort participants by order for sequential analysis
    const sortedParticipants = participantSigningStatus.sort((a, b) => (a.order || 999) - (b.order || 999));

    // Separate signed and pending participants based on our analysis
    for (const participant of sortedParticipants) {
      if (participant.actualStatus === 'SIGNED') {
        status.signedParticipants.push(participant);
      } else if (participant.actualStatus === 'PENDING' || participant.canSign) {
        status.pendingParticipants.push(participant);
      } else {
        // Waiting participants - add to pending but mark as not able to sign yet
        status.pendingParticipants.push({
          ...participant,
          canSign: false,
          waitingForOthers: true
        });
      }
    }

    // Determine current signer (first pending participant who can sign)
    const canSignNow = status.pendingParticipants.filter(p => p.canSign !== false && p.actualStatus !== 'WAITING');
    
    logger.info(`📊 Analysis for current signer determination:`);
    logger.info(`  - Total pending participants: ${status.pendingParticipants.length}`);
    logger.info(`  - Participants who can sign now: ${canSignNow.length}`);
    
    if (canSignNow.length > 0) {
      // Sort by order to get the first one who should sign
      const sortedCanSignNow = canSignNow.sort((a, b) => (a.order || 999) - (b.order || 999));
      status.currentSigner = sortedCanSignNow[0];
      status.nextSigner = sortedCanSignNow[1] || null;
      
      logger.info(`🎯 CURRENT SIGNER IDENTIFIED: ${status.currentSigner.email} (order: ${status.currentSigner.order})`);
      if (status.nextSigner) {
        logger.info(`⏭️ NEXT SIGNER: ${status.nextSigner.email} (order: ${status.nextSigner.order})`);
      }
    } else if (status.pendingParticipants.length > 0) {
      logger.info(`⏸️ All ${status.pendingParticipants.length} pending participants are waiting for others`);
      logger.info(`   Pending participants details:`);
      status.pendingParticipants.forEach(p => {
        logger.info(`     - ${p.email} (order: ${p.order}) - Status: ${p.actualStatus}, Can sign: ${p.canSign}`);
      });
    } else {
      logger.info(`✅ No pending participants - all have completed signing`);
    }

    logger.info(`📊 Final signing status: ${status.signedParticipants.length} signed, ${status.pendingParticipants.length} pending`);
    
    if (status.signedParticipants.length > 0) {
      logger.info('✅ Confirmed signed participants:');
      status.signedParticipants.forEach(p => {
        logger.info(`   - ${p.email} (order: ${p.order}) - detected by: ${p.signedDetectedBy || 'status'}`);
      });
    }

    if (status.pendingParticipants.length > 0) {
      logger.info('⏳ Pending participants:');
      status.pendingParticipants.forEach(p => {
        const canSignText = p.canSign !== false ? 'can sign now' : 'waiting for others';
        logger.info(`   - ${p.email} (order: ${p.order}) - ${canSignText}`);
      });
    }

    return status;

  } catch (error) {
    logger.error(`Error getting actual signing status: ${error.message}`);
    return status;
  }
};

/**
 * Get agreement events from Adobe Sign
 * @param {string} accessToken - Adobe Sign access token
 * @param {string} agreementId - Agreement ID
 * @returns {Promise<Object>} - Agreement events
 */
const getAgreementEvents = async (accessToken, agreementId) => {
  try {
    logger.info(`Getting agreement events for: ${agreementId}`);
    
    const client = await createAdobeSignClient();
    const response = await client.get(`/agreements/${agreementId}/events`);
    
    logger.info(`Retrieved ${response.data.events?.length || 0} events`);
    return response.data;
  } catch (error) {
    logger.error(`Error getting agreement events: ${error.message}`);
    throw error;
  }
};

/**
 * Get agreement audit trail from Adobe Sign
 * @param {string} accessToken - Adobe Sign access token
 * @param {string} agreementId - Agreement ID
 * @returns {Promise<Object>} - Agreement audit trail
 */
const getAgreementAuditTrail = async (accessToken, agreementId) => {
  try {
    logger.info(`Getting agreement audit trail for: ${agreementId}`);
    
    const client = await createAdobeSignClient();
    const response = await client.get(`/agreements/${agreementId}/auditTrail`);
    
    logger.info('Retrieved agreement audit trail');
    return response.data;
  } catch (error) {
    logger.error(`Error getting agreement audit trail: ${error.message}`);
    throw error;
  }
};

/**
 * Get agreement form data from Adobe Sign
 * @param {string} accessToken - Adobe Sign access token
 * @param {string} agreementId - Agreement ID
 * @returns {Promise<Object>} - Agreement form data
 */
const getAgreementFormData = async (accessToken, agreementId) => {
  try {
    logger.info(`Getting agreement form data for: ${agreementId}`);
    
    const client = await createAdobeSignClient();
    const response = await client.get(`/agreements/${agreementId}/formData`);
    
    logger.info('Retrieved agreement form data');
    return response.data;
  } catch (error) {
    logger.error(`Error getting agreement form data: ${error.message}`);
    throw error;
  }
};

/**
 * Get enhanced agreement info with additional data
 * @param {string} accessToken - Adobe Sign access token
 * @param {string} agreementId - Agreement ID
 * @returns {Promise<Object>} - Enhanced agreement info
 */
const getEnhancedAgreementInfo = async (accessToken, agreementId) => {
  try {
    logger.info(`Getting enhanced agreement info for: ${agreementId}`);
    
    // Get basic agreement info
    const agreementInfo = await getComprehensiveAgreementInfo(accessToken, agreementId);
    
    // Get additional data to determine actual signing status
    let events = null;
    let auditTrail = null;
    let formData = null;
    
    try {
      events = await getAgreementEvents(accessToken, agreementId);
      logger.info('Successfully retrieved agreement events');
    } catch (error) {
      logger.warn(`Could not get agreement events: ${error.message}`);
    }
    
    try {
      auditTrail = await getAgreementAuditTrail(accessToken, agreementId);
      logger.info('Successfully retrieved agreement audit trail');
    } catch (error) {
      logger.warn(`Could not get agreement audit trail: ${error.message}`);
    }
    
    try {
      formData = await getAgreementFormData(accessToken, agreementId);
      if (formData) {
        logger.info('Successfully retrieved agreement form data');
      }
    } catch (error) {
      logger.warn(`Could not get agreement form data: ${error.message}`);
    }
    
    // Enhance participant status with actual signing information
    if (agreementInfo && (events || auditTrail || formData)) {
      agreementInfo.events = events;
      agreementInfo.auditTrail = auditTrail;
      agreementInfo.formData = formData;
      
      // Analyze actual signing status
      const actualSigningStatus = analyzeActualSigningStatus(agreementInfo, events, auditTrail, formData);
      agreementInfo.actualSigningStatus = actualSigningStatus;
      
      logger.info(`Enhanced agreement info with actual signing status: ${JSON.stringify(actualSigningStatus, null, 2)}`);
    }
    
    return agreementInfo;
  } catch (error) {
    logger.error(`Error getting enhanced agreement info: ${error.message}`);
    throw error;
  }
};

/**
 * Analyze actual signing status from events, audit trail, and form data
 * @param {object} agreementInfo - Basic agreement info
 * @param {object} events - Agreement events
 * @param {object} auditTrail - Agreement audit trail
 * @param {object} formData - Agreement form data
 * @returns {object} - Analysis of actual signing status
 */
const analyzeActualSigningStatus = (agreementInfo, events, auditTrail, formData) => {
  const analysis = {
    signedParticipants: [],
    pendingParticipants: [],
    currentSigner: null,
    nextSigner: null
  };
  
  try {
    // Get participant emails from agreement info
    const participantEmails = [];
    if (agreementInfo && agreementInfo.participantSets) {
      for (const participantSet of agreementInfo.participantSets) {
        if (participantSet.role === 'SIGNER') {
          for (const participant of participantSet.memberInfos) {
            participantEmails.push({
              email: participant.email,
              order: participantSet.order,
              participantId: participant.id
            });
          }
        }
      }
    }
    
    logger.info(`Found ${participantEmails.length} signer participants to analyze`);
    
    // Analyze events for signing actions
    const signingEvents = [];
    if (events && events.events) {
      for (const event of events.events) {
        if (event.type && event.type.includes('SIGNATURE') && event.participantEmail) {
          signingEvents.push({
            email: event.participantEmail,
            type: event.type,
            date: event.date,
            description: event.description
          });
          logger.info(`Found signing event: ${event.participantEmail} - ${event.type} at ${event.date}`);
        }
      }
    }
    
    // Analyze audit trail for completion status
    const completedSigners = [];
    if (auditTrail && typeof auditTrail === 'string') {
      // Audit trail is often returned as a string/PDF content
      // Look for signature completion patterns
      for (const participant of participantEmails) {
        if (auditTrail.includes(participant.email) && 
            (auditTrail.includes('Signed') || auditTrail.includes('completed'))) {
          completedSigners.push(participant.email);
          logger.info(`Found completed signature in audit trail: ${participant.email}`);
        }
      }
    }
    
    // Determine current status for each participant
    for (const participant of participantEmails) {
      const hasSigned = signingEvents.some(event => 
        event.email === participant.email && 
        (event.type.includes('SIGNED') || event.type.includes('COMPLETED'))
      ) || completedSigners.includes(participant.email);
      
      if (hasSigned) {
        analysis.signedParticipants.push(participant);
        logger.info(`Participant ${participant.email} has signed (order: ${participant.order})`);
      } else {
        analysis.pendingParticipants.push(participant);
        logger.info(`Participant ${participant.email} is pending (order: ${participant.order})`);
      }
    }
    
    // Determine current signer (lowest order among pending)
    if (analysis.pendingParticipants.length > 0) {
      const sortedPending = analysis.pendingParticipants.sort((a, b) => (a.order || 999) - (b.order || 999));
      analysis.currentSigner = sortedPending[0];
      analysis.nextSigner = sortedPending[1] || null;
      
      logger.info(`Current signer: ${analysis.currentSigner?.email} (order: ${analysis.currentSigner?.order})`);
      if (analysis.nextSigner) {
        logger.info(`Next signer: ${analysis.nextSigner?.email} (order: ${analysis.nextSigner?.order})`);
      }
    }
    
    logger.info(`Signing analysis complete: ${analysis.signedParticipants.length} signed, ${analysis.pendingParticipants.length} pending`);
    
  } catch (error) {
    logger.error(`Error analyzing signing status: ${error.message}`);
  }
  
  return analysis;
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
  createWebhook,
  validateAdobeSignConfig,
  getComprehensiveAgreementInfo,
  getAgreementEvents,
  getAgreementAuditTrail,
  getAgreementFormData,
  getEnhancedAgreementInfo,
  analyzeActualSigningStatus,
  getActualSigningStatus
};
