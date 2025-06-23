/**
 * Enhanced document recovery utility for Adobe Sign integration
 * Provides multiple strategies for recovering from network errors
 */

const logger = require('./logger');
const Document = require('../models/document.model');
const Log = require('../models/log.model');
const { verifyAgreementCreation } = require('./agreementVerifier');
const createEnhancedAdobeSignClient = require('../config/enhancedAdobeSignClient');
const { getAccessToken, getAgreementInfo } = require('../config/adobeSign');

/**
 * Attempt to recover a document that may have been sent despite a socket hang-up error
 * @param {string} documentId - The ID of the document to recover
 * @param {Object} options - Recovery options
 * @returns {Promise<Object>} - Recovery result
 */
async function recoverDocument(documentId, options = {}) {
  try {
    logger.info(`Starting enhanced document recovery for ${documentId}`);
    
    // Find the document
    const document = await Document.findById(documentId);
    
    if (!document) {
      logger.error(`Document not found with ID: ${documentId}`);
      return {
        success: false,
        message: 'Document not found'
      };
    }
    
    // Check if document is already sent for signature
    if (document.status === 'sent_for_signature' && 
        (document.adobeAgreementId || 
         (document.adobeMetadata && document.adobeMetadata.agreementId))) {
      logger.info(`Document ${documentId} is already marked as sent`);
      return {
        success: true,
        message: 'Document already sent for signature',
        document,
        adobeAgreementId: document.adobeAgreementId || 
                          (document.adobeMetadata && document.adobeMetadata.agreementId) ||
                          'unknown'
      };
    }
    
    // If the document is in processed state or ready_for_signature, verify with Adobe Sign API
    if ((document.status === 'processed' || document.status === 'ready_for_signature') && 
        document.recipients && document.recipients.length > 0) {
      
      // STRATEGY 1: Check if agreement exists using our verification utility
      const agreementInfo = await verifyAgreementCreation(document);
      
      if (agreementInfo) {
        logger.info(`Document ${documentId} verified as sent through Adobe Sign API check`);
        
        // Update document with agreement ID
        document.status = 'sent_for_signature';
        document.adobeAgreementId = agreementInfo.id;
        document.adobeMetadata = document.adobeMetadata || {};
        document.adobeMetadata.agreementId = agreementInfo.id;
        document.adobeMetadata.verifiedRecovery = true;
        document.adobeMetadata.recoveryTimestamp = new Date();
        document.adobeMetadata.recoveryStrategy = 'verification';
        
        // Update recipients status
        if (document.recipients && document.recipients.length > 0) {
          document.recipients.forEach(recipient => {
            recipient.status = 'sent';
          });
        }
        
        await document.save();
        
        // Log recovery action
        await Log.create({
          level: 'info',
          message: `Document recovery successful: ${document.originalName}`,
          documentId: document._id,
          metadata: {
            adobeAgreementId: agreementInfo.id,
            recoveryMethod: 'verification',
            originalStatus: 'ready_for_signature'
          }
        });
        
        return {
          success: true,
          message: 'Document verified as sent through Adobe Sign API',
          document,
          adobeAgreementId: agreementInfo.id,
          verifiedRecovery: true
        };
      }
      
      // STRATEGY 2: Search for agreement by recipients and document name
      try {
        logger.info(`Attempting recipient-based recovery search for ${documentId}`);
        const token = await getAccessToken();
        const client = await createEnhancedAdobeSignClient();
        
        // Try to find by recipient email
        if (document.recipients && document.recipients.length > 0) {
          const recipientEmail = document.recipients[0].email;
          
          const response = await client.get('/api/rest/v6/agreements', {
            params: {
              recipientEmail: recipientEmail
            }
          });
          
          if (response.data && response.data.userAgreementList && response.data.userAgreementList.length > 0) {
            // Look for a recent agreement with the same name
            const oneHourAgo = new Date();
            oneHourAgo.setHours(oneHourAgo.getHours() - 1);
            
            const possibleMatches = response.data.userAgreementList.filter(agreement => {
              const createdDate = new Date(agreement.displayDate);
              return createdDate > oneHourAgo && 
                    agreement.name === (document.title || document.originalName);
            });
            
            if (possibleMatches.length > 0) {
              const match = possibleMatches[0];
              logger.info(`Found matching agreement by recipient email: ${match.id}`);
              
              // Update document
              document.status = 'sent_for_signature';
              document.adobeAgreementId = match.id;
              document.adobeMetadata = document.adobeMetadata || {};
              document.adobeMetadata.agreementId = match.id;
              document.adobeMetadata.verifiedRecovery = true;
              document.adobeMetadata.recoveryTimestamp = new Date();
              document.adobeMetadata.recoveryStrategy = 'recipient_search';
              
              // Update recipients
              if (document.recipients && document.recipients.length > 0) {
                document.recipients.forEach(recipient => {
                  recipient.status = 'sent';
                });
              }
              
              await document.save();
              
              // Log recovery action
              await Log.create({
                level: 'info',
                message: `Document recovery successful via recipient search: ${document.originalName}`,
                documentId: document._id,
                metadata: {
                  adobeAgreementId: match.id,
                  recoveryMethod: 'recipient_search',
                  originalStatus: document.status
                }
              });
              
              return {
                success: true,
                message: 'Document verified as sent through recipient search',
                document,
                adobeAgreementId: match.id,
                verifiedRecovery: true,
                recoveryStrategy: 'recipient_search'
              };
            }
          }
        }
      } catch (searchError) {
        logger.warn(`Recipient search recovery failed: ${searchError.message}`);
      }
      
      // STRATEGY 3: Apply aggressive recovery if all verification failed and option is enabled
      if (options.aggressive !== false) {
        logger.info(`Document ${documentId} couldn't be verified but likely sent - applying aggressive recovery`);
        
        // Update document status
        document.status = 'sent_for_signature';
        document.adobeMetadata = document.adobeMetadata || {};
        document.adobeMetadata.recoveryApplied = true;
        document.adobeMetadata.recoveryTimestamp = new Date();
        document.adobeMetadata.recoveryMethod = 'aggressive';
        
        // Update recipients status
        if (document.recipients && document.recipients.length > 0) {
          document.recipients.forEach(recipient => {
            recipient.status = 'sent';
          });
        }
        
        await document.save();
        
        // Log recovery action
        await Log.create({
          level: 'warn',
          message: `Aggressive document recovery applied: ${document.originalName}`,
          documentId: document._id,
          metadata: {
            recoveryMethod: 'aggressive',
            originalStatus: 'ready_for_signature'
          }
        });
        
        return {
          success: true,
          message: 'Document recovery applied (unverified)',
          document,
          recoveryApplied: true,
          aggressive: true
        };
      }
    }
    
    // Document is not in a state that can be recovered
    return {
      success: false,
      message: 'Document is not in a state that can be recovered',
      document
    };
  } catch (error) {
    logger.error(`Error in document recovery: ${error.message}`);
    return {
      success: false,
      message: `Error during recovery: ${error.message}`,
      error: error.message
    };
  }
}

module.exports = {
  recoverDocument
};
