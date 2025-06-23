/**
 * Comprehensive document recovery for Adobe Sign socket hang up issues
 * This utility integrates various recovery approaches into a single function
 */

const logger = require('./logger');
const Document = require('../models/document.model');
const { verifyAgreementCreation } = require('./agreementVerifier');

/**
 * Attempt to recover a document that may have been sent despite a socket hang up error
 * @param {string} documentId - The ID of the document to recover
 * @returns {Promise<Object>} - Recovery result
 */
async function recoverDocument(documentId) {
  try {
    logger.info(`Starting document recovery for ${documentId}`);
    
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
    if (document.status === 'sent_for_signature' || 
        document.adobeAgreementId || 
        (document.adobeMetadata && document.adobeMetadata.agreementId)) {
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
      
      // Check if agreement exists in Adobe Sign
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
        await document.save();
        
        return {
          success: true,
          message: 'Document verified as sent through Adobe Sign API',
          document,
          adobeAgreementId: agreementInfo.id,
          verifiedRecovery: true
        };
      }
      
      // Apply aggressive recovery if verification failed
      logger.info(`Document ${documentId} couldn't be verified but likely sent - applying recovery`);
      
      // Update document status
      document.status = 'sent_for_signature';
      document.adobeMetadata = document.adobeMetadata || {};
      document.adobeMetadata.recoveryApplied = true;
      document.adobeMetadata.recoveryTimestamp = new Date();
      document.adobeMetadata.recoveryMethod = 'comprehensive-recovery';
      
      await document.save();
      
      return {
        success: true,
        message: 'Document recovery applied (unverified)',
        document,
        recoveryApplied: true,
        aggressive: true
      };
    }
    
    // Document is not in a state that can be recovered
    return {
      success: false,
      message: 'Document is not in a state that can be recovered',
      document
    };
  } catch (error) {
    logger.error(`Error recovering document: ${error.message}`);
    return {
      success: false,
      message: `Error recovering document: ${error.message}`
    };
  }
}

module.exports = {
  recoverDocument
};
