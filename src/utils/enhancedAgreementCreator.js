/**
 * Enhanced version of Adobe Sign form fields utility with better socket hang up handling
 * This directly patches the createAgreementWithBestApproach function to prevent socket hang up errors
 */

const logger = require('./logger');
const { createEnhancedAdobeSignClient } = require('../config/enhancedAdobeSignClient');
const { getAccessToken } = require('../config/adobeSign');

/**
 * Create an agreement with the best possible approach, with enhanced socket handling
 * @param {string} transientDocumentId - Adobe Sign transient document ID
 * @param {Array} recipients - Array of recipients
 * @param {string} documentName - Name of the document
 * @param {string} message - Optional message to recipients
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Agreement information
 */
const createAgreementWithBestApproachEnhanced = async (
  transientDocumentId, 
  recipients, 
  documentName, 
  message = 'Please sign this document', 
  options = {}
) => {
  try {
    logger.info(`Using enhanced approach to create agreement: ${documentName}`);
    
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
      message
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
    
    // Attach form fields if available (enhanced version just skips this for now)
    
    // Create agreement with chunked request to avoid socket hang up
    logger.info('Creating agreement with enhanced socket handling');
    
    // Convert request to string and set proper headers
    const requestData = JSON.stringify(agreementCreationRequest);
    
    // Use direct axios request with enhanced options
    const response = await client.post('/api/rest/v6/agreements', requestData, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Connection': 'close'
      },
      timeout: 180000, // 3 minutes timeout
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    logger.info(`Successfully created agreement with ID: ${response.data.id}`);
    return response.data;
    
  } catch (error) {
    logger.error(`Error in enhanced agreement creation: ${error.message}`);
    throw new Error(`Enhanced agreement creation failed: ${error.message}`);
  }
};

module.exports = {
  createAgreementWithBestApproachEnhanced
};
