/**
 * Utility to verify if an agreement was created despite network errors
 * This is used to handle cases where socket hang up errors occur after
 * the agreement was successfully created on Adobe's side.
 */

const logger = require('./logger');
const { createAdobeSignClient, getAccessToken, getAgreementInfo } = require('../config/enhancedAdobeSignClient');

/**
 * Check if an agreement exists for the specified document based on metadata
 * @param {Object} document - The document object from the database
 * @returns {Promise<Object|null>} - Agreement info if found, null otherwise
 */
const verifyAgreementCreation = async (document) => {
  try {
    // If we already have an agreement ID, verify it directly
    if (document.adobeAgreementId || 
        (document.adobeMetadata && document.adobeMetadata.agreementId)) {
      
      const agreementId = document.adobeAgreementId || document.adobeMetadata.agreementId;
      logger.info(`Verifying existing agreement ID: ${agreementId}`);
      
      // Get access token and client
      const token = await getAccessToken();
      
      try {
        // Check if the agreement exists
        const agreementInfo = await getAgreementInfo(token, agreementId);
        
        if (agreementInfo) {
          logger.info(`Agreement exists with ID: ${agreementId}, status: ${agreementInfo.status}`);
          return agreementInfo;
        }
      } catch (error) {
        logger.warn(`Agreement with ID ${agreementId} doesn't exist or is inaccessible: ${error.message}`);
        return null;
      }
    }
    
    // If no agreement ID but we have recipients, check agreements by name/reference
    if (document.title && document.recipients && document.recipients.length > 0) {
      logger.info(`Trying to find agreement by name: ${document.title}`);
      
      // Get access token and client
      const token = await getAccessToken();
      const client = await createAdobeSignClient();
      
      // Search for the agreement by name
      try {
        const response = await client.get('/api/rest/v6/agreements', {
          params: {
            query: document.title
          }
        });
        
        if (response.data && response.data.userAgreementList && response.data.userAgreementList.length > 0) {
          // Look for matches by name
          const possibleMatches = response.data.userAgreementList.filter(
            agreement => agreement.name === document.title
          );
          
          if (possibleMatches.length > 0) {
            // Check if the agreement was created recently (within last hour)
            const oneHourAgo = new Date();
            oneHourAgo.setHours(oneHourAgo.getHours() - 1);
            
            const recentMatches = possibleMatches.filter(agreement => {
              const createdDate = new Date(agreement.displayDate);
              return createdDate > oneHourAgo;
            });
            
            if (recentMatches.length > 0) {
              logger.info(`Found matching agreement: ${recentMatches[0].id}`);
              return recentMatches[0];
            }
          }
        }
        
        logger.info('No matching agreement found by name');
        return null;
      } catch (error) {
        logger.warn(`Error searching for agreement by name: ${error.message}`);
        return null;
      }
    }
    
    return null;
  } catch (error) {
    logger.error(`Error verifying agreement creation: ${error.message}`);
    return null;
  }
};

module.exports = {
  verifyAgreementCreation
};
