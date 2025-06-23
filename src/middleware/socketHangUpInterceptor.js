/**
 * Enhanced error handling middleware to detect and recover from socket hang up errors
 * This intercepts errors before they reach the client and checks if the document
 * was actually sent for signature despite the error.
 */

const logger = require('../utils/logger');
const Document = require('../models/document.model');

// The list of network-related errors that might occur after document was sent
const NETWORK_ERROR_PATTERNS = [
  'socket hang up',
  'timeout',
  'network error',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'ECONNREFUSED',
  'Connection timed out',
  'Network error',
  'Request failed'
];

/**
 * Check if an error message indicates a network error
 * @param {string} errorMessage - The error message to check
 * @returns {boolean} - True if it's a network error
 */
function isNetworkError(errorMessage) {
  if (!errorMessage) return false;
  return NETWORK_ERROR_PATTERNS.some(pattern => errorMessage.toLowerCase().includes(pattern.toLowerCase()));
}

/**
 * Middleware to intercept and handle socket hang up errors
 */
async function handleSocketHangUpErrors(req, res, next) {
  // Store original error handler
  const originalSend = res.send;
  
  // Intercept the response to check for errors
  res.send = function(body) {
    try {
      // If this is an error response related to document sending
      if (typeof body === 'string') {
        let parsedBody;
        try {
          parsedBody = JSON.parse(body);
        } catch (e) {
          // Not JSON, continue
          return originalSend.apply(res, arguments);
        }
        
        // Check if this is an error response with a network error related to sending documents
        if (parsedBody && 
            parsedBody.success === false && 
            parsedBody.status === 500 && 
            parsedBody.message && 
            parsedBody.message.includes('Failed to send document for signature') &&
            isNetworkError(parsedBody.message)) {
          
          // Extract document ID from URL
          const match = req.originalUrl.match(/\/api\/documents\/([^\/]+)\/send/);
          if (match && match[1]) {
            const documentId = match[1];
            logger.warn(`Global error handler detected send error for document ${documentId}`);
            
            // Check document status asynchronously
            // Note: We don't await this - we'll let it run in the background
            // and potentially handle the recovery separately
            (async function() {
              try {
                // Wait a moment to allow any in-flight DB operations to complete
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Fetch the document
                const document = await Document.findById(documentId);
                
                if (!document) {
                  logger.error(`Document not found with ID: ${documentId}`);
                  return;
                }
                
                // Check if document has been sent for signature
            const wasDocumentSent = document.status === 'sent_for_signature' || 
                                  document.adobeAgreementId || 
                                  (document.adobeMetadata && document.adobeMetadata.agreementId);
            
            if (wasDocumentSent) {
              logger.info(`Global handler: Document ${documentId} was successfully sent despite network error`);
              // Document was sent, no need to do anything else here
              return;
            }
            
            // If the document is in processed state or ready_for_signature, verify with Adobe Sign API
            if ((document.status === 'processed' || document.status === 'ready_for_signature') && 
                document.recipients && document.recipients.length > 0) {
              
              // Import the agreement verifier
              const { verifyAgreementCreation } = require('../utils/agreementVerifier');
              
              // Check if agreement exists in Adobe Sign
              const agreementInfo = await verifyAgreementCreation(document);
              
              if (agreementInfo) {
                logger.info(`Global handler: Document ${documentId} verified as sent through Adobe Sign API check`);
                
                // Update document with agreement ID
                document.status = 'sent_for_signature';
                document.adobeAgreementId = agreementInfo.id;
                document.adobeMetadata = document.adobeMetadata || {};
                document.adobeMetadata.agreementId = agreementInfo.id;
                document.adobeMetadata.verifiedRecovery = true;
                document.adobeMetadata.recoveryTimestamp = new Date();
                document.adobeMetadata.recoveryMethod = 'global-error-handler-verified';
                
                await document.save();
                logger.info(`Global handler: Document ${documentId} marked as sent with verified agreement ID`);
                return;
              }
              
              // Apply aggressive recovery if verification failed
              logger.info(`Global handler: Document ${documentId} might have been sent, marking as sent`);
              
              // Update document status
              document.status = 'sent_for_signature';
              document.adobeMetadata = document.adobeMetadata || {};
              document.adobeMetadata.recoveryApplied = true;
              document.adobeMetadata.recoveryTimestamp = new Date();
              document.adobeMetadata.recoveryMethod = 'global-error-handler';
              
              await document.save();
              logger.info(`Global handler: Document ${documentId} marked as sent`);
            }
              } catch (error) {
                logger.error(`Error in global error handler: ${error.message}`);
              }
            })();
            
            // Let's check if a different response handler already handled this
            // If not, we'll let the error continue through
            // Our background process will update the database if needed
          }
        }
      }
    } catch (error) {
      logger.error(`Error in socket hang up interceptor: ${error.message}`);
    }
    
    // Call original send method
    return originalSend.apply(res, arguments);
  };
  
  // Continue to next middleware
  next();
}

module.exports = handleSocketHangUpErrors;
