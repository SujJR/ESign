/**
 * Enhanced Adobe Sign form fields and agreement creation utility
 * Implements advanced error handling and retry logic specifically for agreement creation
 */

const logger = require('./logger');
const createEnhancedAdobeSignClient = require('../config/enhancedAdobeSignClient');
const { getAccessToken } = require('../config/adobeSign');
const fs = require('fs');
const path = require('path');
const Document = require('../models/document.model');

/**
 * Create an agreement with retry and best practices
 * @param {string} transientDocumentId - The transient document ID 
 * @param {Array} recipients - Recipients for the agreement
 * @param {string} documentName - Name of the agreement document
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Creation result
 */
const createAgreementWithResilience = async (transientDocumentId, recipients, documentName, options = {}) => {
  logger.info(`Creating agreement with resilience for ${documentName}`);
  
  // Attempt multiple strategies for creating the agreement
  try {
    // APPROACH 1: Enhanced strategy with multiple retries and advanced error handling
    const result = await createAgreementWithEnhancedRetry(transientDocumentId, recipients, documentName, options);
    
    logger.info(`Successfully created agreement using enhanced retry approach: ${result.agreementId}`);
    return {
      agreementId: result.agreementId,
      method: 'enhanced_resilient_approach',
      success: true
    };
  } catch (enhancedError) {
    logger.warn(`Enhanced resilient approach failed: ${enhancedError.message}, trying backup method...`);
    
    try {
      // APPROACH 2: Backup strategy with basic formatting
      const backupResult = await createAgreementWithBackupStrategy(transientDocumentId, recipients, documentName, options);
      
      logger.info(`Successfully created agreement using backup strategy: ${backupResult.agreementId}`);
      return {
        agreementId: backupResult.agreementId,
        method: 'backup_strategy',
        success: true
      };
    } catch (backupError) {
      logger.error(`Backup strategy failed: ${backupError.message}, trying last resort method...`);
      
      try {
        // APPROACH 3: Last resort with minimal configuration
        const lastResortResult = await createAgreementWithMinimalConfig(transientDocumentId, recipients, documentName);
        
        logger.info(`Successfully created agreement using last resort method: ${lastResortResult.agreementId}`);
        return {
          agreementId: lastResortResult.agreementId,
          method: 'last_resort',
          success: true
        };
      } catch (lastError) {
        logger.error(`All agreement creation strategies failed: ${lastError.message}`);
        throw new Error(`Failed to create agreement after all attempts: ${lastError.message}`);
      }
    }
  }
};

/**
 * Create agreement with enhanced retry logic
 * @private
 */
const createAgreementWithEnhancedRetry = async (transientDocumentId, recipients, documentName, options = {}) => {
  const maxRetries = 5;
  const initialBackoff = 2000; // 2 seconds
  
  // Create recipients in Adobe Sign format
  const formattedRecipients = recipients.map((recipient, index) => ({
    email: recipient.email,
    role: options.role || 'SIGNER',
    order: index + 1
  }));
  
  // Create form fields if available
  let formFields = [];
  if (options.autoDetectedSignatureFields && options.autoDetectedSignatureFields.length > 0) {
    formFields = options.autoDetectedSignatureFields.map(field => ({
      name: field.name,
      fieldType: field.type || 'SIGNATURE',
      isRequired: field.required !== false,
      ...(field.x && field.y ? {
        positionX: field.x,
        positionY: field.y,
        width: field.width || 200,
        height: field.height || 50,
        pageNumber: field.page || 1
      } : {})
    }));
  }
  
  // Basic agreement structure
  const agreementPayload = {
    fileInfos: [{
      transientDocumentId: transientDocumentId
    }],
    name: documentName,
    participantSetsInfo: formattedRecipients.map((recipient, index) => ({
      memberInfos: [{
        email: recipient.email
      }],
      order: recipient.order,
      role: recipient.role
    })),
    signatureType: 'ESIGN',
    state: 'IN_PROCESS'
  };
  
  // Add form fields if available
  if (formFields.length > 0) {
    agreementPayload.formFieldLayerTemplates = [{
      formFields: formFields
    }];
  }
  
  // Add signing flow option
  if (options.signingFlow === 'PARALLEL') {
    agreementPayload.signatureFlow = 'PARALLEL';
  } else {
    agreementPayload.signatureFlow = 'SEQUENTIAL';
  }
  
  // Implement exponential backoff retry
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount < maxRetries) {
    try {
      const client = await createEnhancedAdobeSignClient();
      
      // Create unique request ID for tracking
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      
      // Add special headers to minimize socket hang-up
      const headers = {
        'X-Request-ID': requestId,
        'Connection': 'close',
        'Content-Type': 'application/json'
      };
      
      // Send request with timeout options
      const response = await client.post('/api/rest/v6/agreements', agreementPayload, { 
        headers,
        timeout: 120000 // 2 minute timeout
      });
      
      if (response.data && response.data.id) {
        return {
          agreementId: response.data.id,
          method: 'enhanced_retry',
          attempts: retryCount + 1
        };
      }
      
      throw new Error('Invalid response from Adobe Sign API');
    } catch (error) {
      lastError = error;
      retryCount++;
      
      if (retryCount >= maxRetries) {
        break;
      }
      
      // Log the retry
      logger.warn(`Retry ${retryCount}/${maxRetries} for creating agreement: ${error.message}`);
      
      // Exponential backoff
      const backoff = initialBackoff * Math.pow(2, retryCount - 1);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  
  throw lastError;
};

/**
 * Create agreement with backup strategy
 * @private
 */
const createAgreementWithBackupStrategy = async (transientDocumentId, recipients, documentName, options = {}) => {
  const client = await createEnhancedAdobeSignClient();
  
  // Simplified payload to reduce error potential
  const agreementPayload = {
    fileInfos: [{
      transientDocumentId: transientDocumentId
    }],
    name: documentName,
    participantSetsInfo: recipients.map((recipient, index) => ({
      memberInfos: [{
        email: recipient.email
      }],
      order: index + 1,
      role: 'SIGNER'
    })),
    signatureType: 'ESIGN',
    state: 'IN_PROCESS'
  };
  
  const response = await client.post('/api/rest/v6/agreements', agreementPayload, {
    headers: {
      'Connection': 'close'
    }
  });
  
  if (response.data && response.data.id) {
    return {
      agreementId: response.data.id,
      method: 'backup_strategy'
    };
  }
  
  throw new Error('Invalid response from backup strategy');
};

/**
 * Create agreement with minimal configuration
 * @private
 */
const createAgreementWithMinimalConfig = async (transientDocumentId, recipients, documentName) => {
  const client = await createEnhancedAdobeSignClient();
  
  // Absolute minimal payload
  const minimalPayload = {
    fileInfos: [{
      transientDocumentId: transientDocumentId
    }],
    name: documentName,
    participantSetsInfo: [{
      memberInfos: [{
        email: recipients[0].email
      }],
      role: 'SIGNER'
    }],
    state: 'IN_PROCESS'
  };
  
  const response = await client.post('/api/rest/v6/agreements', minimalPayload);
  
  if (response.data && response.data.id) {
    return {
      agreementId: response.data.id,
      method: 'minimal_config'
    };
  }
  
  throw new Error('Invalid response from minimal configuration');
};

/**
 * Verify if an agreement exists despite network errors
 * @param {string} documentId - The document ID to check
 * @returns {Promise<boolean>} - Whether the agreement exists
 */
const verifyAgreementExists = async (documentId) => {
  try {
    const document = await Document.findById(documentId);
    
    if (!document) {
      return false;
    }
    
    // If document has agreementId, verify with Adobe Sign
    if (document.adobeAgreementId) {
      const token = await getAccessToken();
      const client = await createEnhancedAdobeSignClient();
      
      try {
        const response = await client.get(`/api/rest/v6/agreements/${document.adobeAgreementId}`);
        return !!(response && response.data && response.data.id);
      } catch (error) {
        return false;
      }
    }
    
    return false;
  } catch (error) {
    logger.error(`Error verifying agreement: ${error.message}`);
    return false;
  }
};

module.exports = {
  createAgreementWithResilience,
  verifyAgreementExists
};
