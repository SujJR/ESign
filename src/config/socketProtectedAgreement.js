/**
 * Specialized module for creating Adobe Sign agreements with enhanced error handling
 * This directly handles socket hang up issues when creating agreements
 */

const logger = require('../utils/logger');
const createEnhancedAdobeSignClient = require('./enhancedAdobeSignClient');
const { getAccessToken } = require('./adobeSign');
const rateLimitProtection = require('../utils/rateLimitProtection');

/**
 * Create an agreement with the best possible error handling for socket hang up issues
 * @param {string} transientDocumentId - Adobe Sign transient document ID
 * @param {Array} recipients - Array of recipients
 * @param {string} documentName - Name of the document
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Agreement information
 */
const createAgreementWithSocketProtection = async (
  transientDocumentId, 
  recipients, 
  documentName, 
  options = {}
) => {
  try {
    logger.info(`Creating agreement with socket protection: ${documentName}`);
    
    // Get access token
    const token = await getAccessToken();
    
    // Create enhanced client with better socket handling
    const client = await createEnhancedAdobeSignClient();
    
    // Set up agreement creation data
    const agreementCreationRequest = {
      fileInfos: [
        {
          transientDocumentId: transientDocumentId
        }
      ],
      name: documentName,
      participantSetsInfo: [],
      signatureType: 'ESIGN',
      state: 'IN_PROCESS',
      message: options.message || 'Please sign this document'
    };
    
    // Add signature workflow (sequential or parallel)
    const signingFlow = options.signingFlow || 'SEQUENTIAL';
    
    // Set up participants in the correct order
    if (recipients && recipients.length > 0) {
      logger.info(`Setting up ${signingFlow} signing flow with ${recipients.length} participant sets`);
      
      // Sort recipients by order if it's sequential
      let sortedRecipients = recipients;
      if (signingFlow === 'SEQUENTIAL' && recipients.some(r => r.order)) {
        sortedRecipients = [...recipients].sort((a, b) => (a.order || 999) - (b.order || 999));
      }
      
      // Create participant sets
      sortedRecipients.forEach((recipient, index) => {
        agreementCreationRequest.participantSetsInfo.push({
          memberInfos: [
            {
              email: recipient.email,
              name: recipient.name
            }
          ],
          order: signingFlow === 'SEQUENTIAL' ? (index + 1) : 1,
          role: 'SIGNER'
        });
      });
    } else {
      throw new Error('No recipients provided for agreement creation');
    }
    
    // Implement specialized chunked request approach to avoid socket hang up
    logger.info('Creating agreement with specialized socket protection');
    
    // Generate a unique transaction ID
    const transactionId = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    
    // Try multiple approaches to create the agreement
    let response;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      attempts++;
      try {
        // Convert request to string and set proper headers
        const requestData = JSON.stringify(agreementCreationRequest);
        
        // Use direct axios request with enhanced options
        response = await client.post('/api/rest/v6/agreements', requestData, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Connection': 'close',
            'X-Transaction-ID': transactionId,
            'X-Socket-Protection': 'true',
            'X-Attempt-Number': attempts.toString()
          },
          timeout: 180000 + (attempts * 30000), // Add 30 seconds for each attempt
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        });
        
        // If successful, break out of retry loop
        break;
      } catch (retryError) {
        // Check for rate limiting (429) error
        if (retryError.response && retryError.response.status === 429) {
          const retryAfter = retryError.response.data?.retryAfter || 60;
          logger.error(`Rate limit error (429) detected. Retry suggested after ${retryAfter} seconds.`);
          
          // Set the rate limit in our protection system
          rateLimitProtection.setRateLimit(retryAfter);
          
          // Return a special response for rate limiting
          return {
            status: 'RATE_LIMITED',
            message: `Adobe Sign rate limit reached. Please try again later.`,
            errorMessage: retryError.response.data?.message || 'Rate limit exceeded',
            retryAfter: retryAfter,
            timestamp: new Date().toISOString(),
            rateLimited: true
          };
        }
        
        // If this is the last attempt, throw the error
        if (attempts >= maxAttempts) {
          throw retryError;
        }
        
        // For socket hang up errors, wait before retrying
        if (retryError.message && retryError.message.includes('socket hang up')) {
          logger.warn(`Socket hang up detected on attempt ${attempts}/${maxAttempts}, waiting before retry...`);
          await new Promise(resolve => setTimeout(resolve, 5000 * attempts)); // Increase wait time with each attempt
        } else {
          // For other errors, wait a shorter time
          logger.warn(`Error on attempt ${attempts}/${maxAttempts}: ${retryError.message}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    logger.info(`Successfully created agreement with ID: ${response.data.id}`);
    return response.data;
    
  } catch (error) {
    // Handle rate limiting specifically
    if (error.response && error.response.status === 429) {
      const retryAfter = error.response.data?.retryAfter || 60;
      logger.error(`Rate limit error (429) detected during agreement creation. Retry after ${retryAfter} seconds.`);
      
      // Set the rate limit in our protection system
      rateLimitProtection.setRateLimit(retryAfter);
      
      return {
        status: 'RATE_LIMITED',
        message: `Adobe Sign rate limit reached. Please try again later.`,
        errorMessage: error.response.data?.message || 'Rate limit exceeded',
        retryAfter: retryAfter,
        timestamp: new Date().toISOString(),
        documentName,
        transientDocumentId,
        rateLimited: true
      };
    }
    
    // Implement specialized error handling for socket hang up
    if (error.message && error.message.includes('socket hang up')) {
      logger.error(`Socket hang up detected during agreement creation for ${documentName}`);
      
      // Wait a short time before returning, as the agreement might have been created
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Return a special response that can be used by recovery mechanisms
      return {
        status: 'PENDING_VERIFICATION',
        message: 'Socket hang up detected, agreement may have been created',
        errorMessage: error.message,
        timestamp: new Date().toISOString(),
        documentName,
        transientDocumentId,
        recipientCount: recipients.length,
        needsVerification: true,
        recipientEmails: recipients.map(r => r.email).join(', ')
      };
    }
    
    // Network error handling - might have been created successfully despite the error
    if (error.code && !error.response && ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(error.code)) {
      logger.error(`Network error during agreement creation for ${documentName}: ${error.code}`);
      
      // Wait a short time before returning
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Return a special response for recovery
      return {
        status: 'PENDING_VERIFICATION',
        message: `Network error detected (${error.code}), agreement may have been created`,
        errorMessage: error.message,
        errorCode: error.code,
        timestamp: new Date().toISOString(),
        documentName,
        transientDocumentId,
        recipientCount: recipients.length,
        needsVerification: true,
        recipientEmails: recipients.map(r => r.email).join(', ')
      };
    }
    
    // For other errors, throw normally
    logger.error(`Error in agreement creation with socket protection: ${error.message}`);
    throw new Error(`Agreement creation failed: ${error.message}`);
  }
};

module.exports = {
  createAgreementWithSocketProtection
};
