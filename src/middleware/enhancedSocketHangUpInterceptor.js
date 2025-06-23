/**
 * Enhanced socket hang-up interceptor middleware
 * Provides comprehensive error handling for socket hang-up and network errors
 * when interacting with Adobe Sign API
 */

const { ApiError } = require('../utils/apiUtils');
const logger = require('../utils/logger');
const { verifyAgreementCreation } = require('../utils/agreementVerifier');
const Document = require('../models/document.model');

/**
 * Detects socket hang-up errors in responses and attempts recovery
 */
const socketHangUpInterceptor = async (err, req, res, next) => {
  // Only intercept errors
  if (!err) {
    return next();
  }

  // Check if it's a socket hang-up or network error
  const isSocketHangUp = err.message && (
    err.message.includes('socket hang up') ||
    err.message.includes('ECONNRESET') ||
    err.message.includes('ETIMEDOUT') ||
    err.message.includes('network error') ||
    err.message.includes('Network Error') ||
    err.message.includes('timeout')
  );

  // Check if it's a document signature request
  const isSignatureRequest = req.originalUrl && (
    req.originalUrl.includes('/api/documents') && 
    req.originalUrl.includes('/send')
  );

  // If not a socket hang-up or not a signature request, pass through
  if (!isSocketHangUp || !isSignatureRequest) {
    return next(err);
  }

  try {
    logger.warn(`Socket hang-up intercepted for ${req.originalUrl}: ${err.message}`);
    
    // Extract document ID from URL
    const match = req.originalUrl.match(/\/api\/documents\/([a-zA-Z0-9]+)\/send/);
    if (!match || !match[1]) {
      logger.error('Could not extract document ID from URL for socket hang-up recovery');
      return next(err);
    }
    
    const documentId = match[1];
    logger.info(`Attempting recovery for document ${documentId}`);
    
    // Find the document
    const document = await Document.findById(documentId);
    
    if (!document) {
      logger.error(`Document not found for socket hang-up recovery: ${documentId}`);
      return next(err);
    }
    
    // Check if the agreement was actually created despite the error
    const agreementInfo = await verifyAgreementCreation(document);
    
    if (agreementInfo) {
      // Document was successfully sent despite the error
      logger.info(`Agreement was created despite socket hang-up: ${agreementInfo.id}`);
      
      // Update document with agreement ID
      document.status = 'sent_for_signature';
      document.adobeAgreementId = agreementInfo.id;
      document.adobeMetadata = document.adobeMetadata || {};
      document.adobeMetadata.agreementId = agreementInfo.id;
      document.adobeMetadata.verifiedRecovery = true;
      document.adobeMetadata.recoveryTimestamp = new Date();
      
      // Update recipients status
      if (document.recipients && document.recipients.length > 0) {
        document.recipients.forEach(recipient => {
          recipient.status = 'sent';
        });
      }
      
      await document.save();
      
      // Respond with success message
      return res.status(200).json({
        success: true,
        message: 'Document sent for signature successfully (recovered from network error)',
        data: {
          document: {
            id: document._id,
            status: document.status,
            adobeAgreementId: document.adobeAgreementId
          }
        }
      });
    }
    
    // If agreement was not found, pass through to normal error handling
    logger.error(`Could not verify agreement creation after socket hang-up: ${documentId}`);
    return next(err);
  } catch (interceptError) {
    logger.error(`Error in socket hang-up interceptor: ${interceptError.message}`);
    return next(err); // Pass through the original error
  }
};

module.exports = socketHangUpInterceptor;
