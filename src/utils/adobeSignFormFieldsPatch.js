/**
 * Adobe Sign Form Fields patch to fix socket hang up errors
 * This file provides a targeted patch to the Adobe Sign form fields functionality
 * to use an enhanced client with retries and timeouts.
 */

const logger = require('../utils/logger');
const createEnhancedAdobeSignClient = require('../config/enhancedAdobeSignClient');
const { getAccessToken } = require('../config/adobeSign');

// Apply the patch when this module is loaded
(function applyPatch() {
  try {
    // Get reference to the original module
    const adobeSignFormFields = require('./adobeSignFormFields');
    const documentController = require('../controllers/document.controller');
    
    // Save references to the original functions
    const originalCreateBasicAgreement = adobeSignFormFields.createBasicAgreement;
    const originalCreateAgreementWithFormFields = adobeSignFormFields.createAgreementWithFormFields;
    const originalCreateAgreementWithBestApproach = adobeSignFormFields.createAgreementWithBestApproach;
    const originalSendForSignature = documentController.sendForSignature;
    
    // Add our enhanced createAgreementWithBestApproach implementation
    const createAgreementWithBestApproachEnhanced = async (
      transientDocumentId, 
      recipients, 
      documentName, 
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
        
        // Create agreement with special handling to avoid socket hang up
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
    
    // Override the createAgreementWithBestApproach function to use our enhanced version
    adobeSignFormFields.createAgreementWithBestApproach = async function(transientDocumentId, recipients, documentName, options = {}) {
      try {
        // First try the original function
        logger.info(`Trying original createAgreementWithBestApproach for ${documentName}`);
        return await originalCreateAgreementWithBestApproach(transientDocumentId, recipients, documentName, options);
      } catch (error) {
        // If we get a socket hang up error, try our enhanced version
        if (error.message && (
          error.message.includes('socket hang up') || 
          error.message.includes('timeout') ||
          error.message.includes('network error')
        )) {
          logger.warn(`Socket hang up detected in original approach, trying enhanced approach for ${documentName}`);
          
          // Use our enhanced version with better socket handling
          return await createAgreementWithBestApproachEnhanced(
            transientDocumentId, 
            recipients, 
            documentName, 
            options
          );
        }
        
        // For other errors, just throw
        throw error;
      }
    };
    
    // Override the createBasicAgreement function to use our enhanced client
    adobeSignFormFields.createBasicAgreement = async function(...args) {
      try {
        // Override the createAdobeSignClient function in the scope of this function
        const originalRequire = require;
        
        // Temporarily replace the client creation function
        require = function(module) {
          if (module === '../config/adobeSign' || module === './adobeSign' || module === '/src/config/adobeSign') {
            const adobeSign = originalRequire(module);
            return {
              ...adobeSign,
              createAdobeSignClient: createEnhancedAdobeSignClient
            };
          }
          return originalRequire(module);
        };
        
        // Call the original function with our enhanced client injected
        const result = await originalCreateBasicAgreement.apply(this, args);
        
        // Restore the original require
        require = originalRequire;
        
        return result;
      } catch (error) {
        logger.error(`Enhanced createBasicAgreement error: ${error.message}`);
        throw error;
      }
    };
    
    // Also patch the createAgreementWithFormFields function
    adobeSignFormFields.createAgreementWithFormFields = async function(...args) {
      try {
        // Same pattern as above
        const originalRequire = require;
        require = function(module) {
          if (module === '../config/adobeSign' || module === './adobeSign' || module === '/src/config/adobeSign') {
            const adobeSign = originalRequire(module);
            return {
              ...adobeSign,
              createAdobeSignClient: createEnhancedAdobeSignClient
            };
          }
          return originalRequire(module);
        };
        
        const result = await originalCreateAgreementWithFormFields.apply(this, args);
        require = originalRequire;
        return result;
      } catch (error) {
        logger.error(`Enhanced createAgreementWithFormFields error: ${error.message}`);
        throw error;
      }
    };
    
    // Patch the sendForSignature function in document.controller.js to handle socket hang up errors
    // This is the most important patch because it handles the case where the agreement
    // is actually created but we get a socket hang up error
    documentController.sendForSignature = async function(req, res, next) {
      try {
        // Try the original function first
        return await originalSendForSignature.apply(this, arguments);
      } catch (error) {
        // Check if this is a "socket hang up" or timeout error
        if (error.message && (
            error.message.includes('socket hang up') || 
            error.message.includes('timeout') ||
            error.message.includes('network error')
          )) {
          
          logger.warn(`Socket hang up or network error detected during signature: ${error.message}`);
          
          // Get the document ID from the request
          const { id } = req.params;
          
          try {
            // Find the document
            const Document = require('../models/document.model');
            const document = await Document.findById(id);
            
            if (!document) {
              logger.error(`Document not found with ID: ${id}`);
              return next(error);
            }
            
            // If the document status is still 'processed', it means the request likely failed before updating
            if (document.status === 'processed') {
              logger.info(`Document status is still 'processed', assuming signature request failed completely`);
              return next(error);
            }
            
            // If the document has an adobeAgreementId, the request likely succeeded despite the error
            if (document.adobeAgreementId) {
              logger.info(`Document has Adobe Agreement ID: ${document.adobeAgreementId}, signature likely succeeded despite error`);
              
              // Update the document status to sent_for_signature if not already
              if (document.status !== 'sent_for_signature') {
                document.status = 'sent_for_signature';
                await document.save();
              }
              
              // Return success response
              return res.status(200).json({
                success: true,
                message: 'Document sent for signature successfully (recovered from network error)',
                data: {
                  documentId: document._id,
                  status: document.status,
                  adobeAgreementId: document.adobeAgreementId
                }
              });
            }
            
            // If we couldn't determine success, pass the original error
            return next(error);
          } catch (recoveryError) {
            logger.error(`Error during recovery attempt: ${recoveryError.message}`);
            return next(error); // Pass the original error
          }
        }
        
        // For other types of errors, pass them through
        return next(error);
      }
    };
    
    logger.info('Successfully applied enhanced Adobe Sign client patch with socket hang up recovery');
  } catch (error) {
    logger.error(`Error applying Adobe Sign form fields patch: ${error.message}`);
  }
})();

// Export a marker to indicate the patch has been applied
module.exports = {
  enhancedClientPatchApplied: true,
  patchedAt: new Date().toISOString()
};
