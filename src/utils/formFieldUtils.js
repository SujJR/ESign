/**
 * Utility functions for handling form fields in Adobe Sign
 */

const { createAdobeSignClient } = require('../config/adobeSign');
const logger = require('./logger');

/**
 * Adds form fields to an agreement with retry logic and proper waiting
 * @param {string} agreementId - The Adobe Sign agreement ID
 * @param {Array} recipients - List of recipients with email and name
 * @param {number} pageCount - Number of pages in the document
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} initialDelay - Initial delay in ms before first attempt (default: 5000)
 * @param {number} retryDelay - Delay in ms between retries (default: 3000)
 * @returns {Promise<Object>} - Response from Adobe Sign API or null if failed
 */
const addFormFieldsWithRetry = async (
  agreementId, 
  recipients, 
  pageCount = 1, 
  maxRetries = 5,
  initialDelay = 10000,
  retryDelay = 5000
) => {
  // Initial delay to allow the agreement to be processed
  logger.info(`Waiting ${initialDelay}ms for agreement ${agreementId} to be ready...`);
  await new Promise(resolve => setTimeout(resolve, initialDelay));
  
  let lastError = null;
  let client = null;
  
  // Retry loop
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Attempt ${attempt}/${maxRetries} to add form fields to agreement ${agreementId}`);
      
      // Get Adobe Sign client
      if (!client) {
        client = await createAdobeSignClient();
      }
      
      // Verify the agreement exists and is in a valid state
      logger.info(`Verifying agreement ${agreementId} exists...`);
      const agreementCheckResponse = await client.get(
        `api/rest/v6/agreements/${agreementId}`
      );
      
      const agreementStatus = agreementCheckResponse.data.status;
      logger.info(`Agreement verification successful. Status: ${agreementStatus}`);
      
      // Check if the agreement is in a valid state to add form fields
      const validStates = ['IN_PROCESS', 'OUT_FOR_SIGNATURE', 'OUT_FOR_DELIVERY', 'OUT_FOR_FORM_FILLING'];
      if (!validStates.includes(agreementStatus)) {
        logger.warn(`Agreement ${agreementId} is in state ${agreementStatus}, which may not support adding form fields`);
        // Continue anyway since some states might still work
      }
      
      // Create form fields for each recipient
      const formFields = generateFormFields(recipients, pageCount);
      
      // Add form fields to the agreement
      logger.info(`Adding ${formFields.length} form fields to agreement ${agreementId}`);
      const response = await client.post(
        `api/rest/v6/agreements/${agreementId}/formFields`, 
        { formFields }
      );
      
      logger.info(`Successfully added form fields to agreement ${agreementId}`);
      return response.data;
    } catch (error) {
      lastError = error;
      logger.error(`Error adding form fields to agreement ${agreementId} (attempt ${attempt}/${maxRetries}): ${error.message}`);
      
      if (error.response) {
        logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
        
        // Check if this is a recoverable error
        const isRecoverable = isRecoverableError(error);
        if (!isRecoverable && attempt < maxRetries) {
          logger.warn(`Error is not recoverable, stopping retry attempts`);
          break;
        }
      }
      
      // If we have more retries, wait before the next attempt
      if (attempt < maxRetries) {
        const delay = retryDelay * attempt; // Increase delay with each retry
        logger.info(`Waiting ${delay}ms before next attempt...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // If we get here, all retries failed
  logger.error(`All attempts to add form fields failed for agreement ${agreementId}`);
  throw lastError || new Error('Failed to add form fields to agreement');
};

/**
 * Generates form fields based on recipients and document properties
 * @param {Array} recipients - List of recipients with email and name
 * @param {number} pageCount - Number of pages in the document
 * @returns {Array} - Array of form field objects
 */
const generateFormFields = (recipients, pageCount = 1) => {
  const formFields = [];
  
  // Add a signature field for each recipient
  recipients.forEach((recipient, index) => {
    // Add signature field
    formFields.push({
      fieldName: `Signature_${index + 1}`,
      displayName: `Signature (${recipient.name})`,
      defaultValue: "",
      fieldType: "SIGNATURE",
      visible: true,
      required: true,
      documentPageNumber: pageCount, // Place on the last page
      location: {
        x: 70,
        y: 650 + (index * 60) // Stack vertically with some spacing
      },
      size: {
        width: 200,
        height: 50
      },
      assignedToRecipient: recipient.email
    });
    
    // Add date field
    formFields.push({
      fieldName: `Date_${index + 1}`,
      displayName: `Date (${recipient.name})`,
      defaultValue: "",
      fieldType: "DATE",
      visible: true,
      required: true,
      documentPageNumber: pageCount,
      location: {
        x: 300,
        y: 650 + (index * 60)
      },
      size: {
        width: 100,
        height: 40
      },
      assignedToRecipient: recipient.email
    });
    
    // Add name field
    formFields.push({
      fieldName: `Name_${index + 1}`,
      displayName: `Name (${recipient.name})`,
      defaultValue: recipient.name,
      fieldType: "TEXT",
      visible: true,
      required: true,
      documentPageNumber: pageCount,
      location: {
        x: 70,
        y: 600 + (index * 60)
      },
      size: {
        width: 200,
        height: 30
      },
      assignedToRecipient: recipient.email
    });
  });
  
  return formFields;
};

/**
 * Determines if an error is recoverable (can be retried)
 * @param {Error} error - The error object
 * @returns {boolean} - True if the error is recoverable
 */
const isRecoverableError = (error) => {
  if (!error.response) {
    // Network errors are usually recoverable
    return true;
  }
  
  // Check specific error codes that might be recoverable
  if (error.response.data && error.response.data.code) {
    const nonRecoverableCodes = [
      'INVALID_AGREEMENT_ID', // Agreement doesn't exist or user doesn't have access
      'INVALID_ACCESS_TOKEN', // Authentication issue
      'NO_PERMISSION_TO_ADD_FORM_FIELDS', // Permission issue
    ];
    
    return !nonRecoverableCodes.includes(error.response.data.code);
  }
  
  // Status codes in the 5xx range are generally recoverable (server errors)
  // Status codes in the 4xx range are generally not recoverable (client errors)
  return error.response.status >= 500;
};

/**
 * Generates intelligent form field positions based on document analysis
 * @param {Object} document - Document object with pageCount, recipients, etc.
 * @returns {Array} - Array of form field objects
 */
const generateIntelligentFormFields = (document) => {
  const { recipients, pageCount, originalName } = document;
  const formFields = [];
  
  // Different positioning based on document type
  let positioningType = 'default';
  
  // Determine document type based on filename or content (simplified example)
  if (originalName.includes('contract') || originalName.includes('agreement')) {
    positioningType = 'contract';
  } else if (originalName.includes('application') || originalName.includes('form')) {
    positioningType = 'form';
  } else if (originalName.includes('nda') || originalName.includes('disclosure')) {
    positioningType = 'nda';
  }
  
  // Add form fields based on document type
  recipients.forEach((recipient, index) => {
    let signatureY = 0;
    let dateY = 0;
    let nameY = 0;
    
    // Different positioning based on document type
    switch (positioningType) {
      case 'contract':
        // For contracts, place signatures at the bottom of the last page
        signatureY = 650 + (index * 60);
        dateY = signatureY;
        nameY = signatureY - 50;
        break;
        
      case 'form':
        // For forms, place signatures based on recipient order
        signatureY = 200 + (index * 150);
        dateY = signatureY;
        nameY = signatureY - 50;
        break;
        
      case 'nda':
        // For NDAs, place signatures in the middle of the last page
        signatureY = 400 + (index * 80);
        dateY = signatureY;
        nameY = signatureY - 50;
        break;
        
      default:
        // Default positioning at the bottom of the last page
        signatureY = 650 + (index * 60);
        dateY = signatureY;
        nameY = signatureY - 50;
        break;
    }
    
    // Add signature field
    formFields.push({
      fieldName: `Signature_${index + 1}`,
      displayName: `Signature (${recipient.name})`,
      defaultValue: "",
      fieldType: "SIGNATURE",
      visible: true,
      required: true,
      documentPageNumber: pageCount, // Place on the last page
      location: {
        x: 70,
        y: signatureY
      },
      size: {
        width: 200,
        height: 50
      },
      assignedToRecipient: recipient.email
    });
    
    // Add date field
    formFields.push({
      fieldName: `Date_${index + 1}`,
      displayName: `Date (${recipient.name})`,
      defaultValue: "",
      fieldType: "DATE",
      visible: true,
      required: true,
      documentPageNumber: pageCount,
      location: {
        x: 300,
        y: dateY
      },
      size: {
        width: 100,
        height: 40
      },
      assignedToRecipient: recipient.email
    });
    
    // Add name field
    formFields.push({
      fieldName: `Name_${index + 1}`,
      displayName: `Name (${recipient.name})`,
      defaultValue: recipient.name,
      fieldType: "TEXT",
      visible: true,
      required: true,
      documentPageNumber: pageCount,
      location: {
        x: 70,
        y: nameY
      },
      size: {
        width: 200,
        height: 30
      },
      assignedToRecipient: recipient.email
    });
  });
  
  return formFields;
};

module.exports = {
  addFormFieldsWithRetry,
  generateFormFields,
  generateIntelligentFormFields
};
