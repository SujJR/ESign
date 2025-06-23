/**
 * Extended document controller with enhanced Adobe Sign integration
 * and robust error handling for network issues
 */

const Document = require('../models/document.model');
const Log = require('../models/log.model');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');
const { recoverDocument } = require('../utils/enhancedDocumentRecovery');
const { createAgreementWithResilience, verifyAgreementExists } = require('../utils/enhancedAgreementCreation');
const { uploadTransientDocument, getAccessToken } = require('../config/adobeSign');
const createEnhancedAdobeSignClient = require('../config/enhancedAdobeSignClient');
const fs = require('fs');
const path = require('path');

/**
 * Enhanced implementation for sending document for signature
 * with robust error handling and recovery
 * @route POST /api/documents/:id/send-enhanced
 */
exports.sendForSignatureEnhanced = async (req, res, next) => {
  const documentId = req.params.id;
  let retryCount = 0;
  let maxRetries = 3;
  
  try {
    // First validate that document exists and is ready
    const document = await Document.findOne({
      _id: documentId,
      status: 'ready_for_signature'
    });
    
    if (!document) {
      return next(new ApiError(404, 'Document not found or not ready for signature'));
    }

    if (!document.recipients || document.recipients.length === 0) {
      return next(new ApiError(400, 'Document has no recipients'));
    }
    
    // Validate recipient emails
    const invalidRecipients = document.recipients.filter(recipient => {
      const email = recipient.email;
      return !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    });
    
    if (invalidRecipients.length > 0) {
      return next(new ApiError(400, `Invalid recipient email addresses: ${invalidRecipients.map(r => r.email || 'missing email').join(', ')}`));
    }

    // Determine which file to use for Adobe Sign
    let fileToUpload = document.filePath;
    
    // If document was processed from DOCX/DOC, use the PDF version
    if (document.pdfFilePath && fs.existsSync(document.pdfFilePath)) {
      fileToUpload = document.pdfFilePath;
      logger.info(`Using converted PDF file: ${document.pdfFilePath}`);
    }
    
    // Check if file exists
    if (!fs.existsSync(fileToUpload)) {
      logger.error(`File not found at path: ${fileToUpload}`);
      return next(new ApiError(404, 'Document file not found on server'));
    }
    
    // Create a transient document ID - this has retry logic built in
    let transientDocumentId;
    let uploadSuccess = false;
    
    // Retry loop for transient document upload
    while (!uploadSuccess && retryCount < maxRetries) {
      try {
        transientDocumentId = await uploadTransientDocument(fileToUpload);
        uploadSuccess = true;
        logger.info(`Document uploaded as transient document: ${transientDocumentId}`);
      } catch (uploadError) {
        retryCount++;
        logger.warn(`Transient document upload failed (attempt ${retryCount}): ${uploadError.message}`);
        
        if (retryCount >= maxRetries) {
          return next(new ApiError(500, `Failed to upload document after ${maxRetries} attempts: ${uploadError.message}`));
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
      }
    }
    
    // Reset retry counter for agreement creation
    retryCount = 0;
    
    // Use the resilient agreement creation method
    const result = await createAgreementWithResilience(
      transientDocumentId,
      document.recipients,
      document.originalName,
      {
        autoDetectedSignatureFields: document.autoDetectedSignatureFields || [],
        signingFlow: document.signingFlow || 'SEQUENTIAL'
      }
    );
    
    // Update document with Adobe Sign agreement ID
    document.adobeAgreementId = result.agreementId;
    document.status = 'sent_for_signature';
    document.adobeMetadata = document.adobeMetadata || {};
    document.adobeMetadata.agreementId = result.agreementId;
    document.adobeMetadata.method = result.method;
    document.adobeMetadata.createdAt = new Date();
    
    // Update recipients status
    if (document.recipients && document.recipients.length > 0) {
      document.recipients.forEach(recipient => {
        recipient.status = 'sent';
      });
    }
    
    await document.save();
    
    // Log document sent for signature
    await Log.create({
      level: 'info',
      message: `Document sent for signature using ${result.method} approach: ${document.originalName}`,
      documentId: document._id,
      ipAddress: req.ip,
      requestPath: req.originalUrl,
      requestMethod: req.method,
      metadata: {
        adobeAgreementId: result.agreementId,
        method: result.method,
        recipientCount: document.recipients ? document.recipients.length : 0
      }
    });
    
    // Return success response
    return res.status(200).json(formatResponse({
      document: {
        id: document._id,
        name: document.originalName,
        status: document.status,
        adobeAgreementId: document.adobeAgreementId
      },
      message: `Document sent for signature using ${result.method} approach`
    }));
  } catch (error) {
    logger.error(`Error sending document for signature: ${error.message}`, { documentId, stack: error.stack });
    
    // If we have a document ID, try to verify if the agreement was created despite error
    if (documentId) {
      try {
        // Check if agreement exists
        const exists = await verifyAgreementExists(documentId);
        
        if (exists) {
          // Agreement exists, update document status
          const document = await Document.findById(documentId);
          if (document) {
            document.status = 'sent_for_signature';
            document.adobeMetadata = document.adobeMetadata || {};
            document.adobeMetadata.recoveryApplied = true;
            document.adobeMetadata.recoveryTimestamp = new Date();
            document.adobeMetadata.recoveryMethod = 'automatic_verification';
            
            await document.save();
            
            return res.status(200).json(formatResponse({
              document: {
                id: document._id,
                status: document.status,
                recoveryApplied: true
              },
              message: 'Document sent for signature (recovered from error)'
            }));
          }
        }
      } catch (verifyError) {
        logger.error(`Verification after error failed: ${verifyError.message}`);
      }
    }
    
    return next(new ApiError(500, `Error sending document for signature: ${error.message}`));
  }
};

/**
 * Enhanced recovery of document from socket hang up or network error
 * @route POST /api/documents/:id/recover-enhanced
 */
exports.recoverDocumentEnhanced = async (req, res, next) => {
  try {
    const documentId = req.params.id;
    
    // Check if ID is provided
    if (!documentId) {
      return next(new ApiError(400, 'Document ID is required'));
    }
    
    // Get recovery options
    const options = {
      aggressive: req.body.aggressive !== false, // Default to true
      forceCheck: req.body.forceCheck === true // Default to false
    };
    
    // Attempt recovery
    const result = await recoverDocument(documentId, options);
    
    if (result.success) {
      // Log recovery
      await Log.create({
        level: 'info',
        message: `Document recovered successfully: ${result.message}`,
        documentId: documentId,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
        requestMethod: req.method,
        metadata: {
          adobeAgreementId: result.adobeAgreementId || 'unknown',
          recoveryMethod: result.recoveryStrategy || 'unknown',
          aggressive: !!result.aggressive
        }
      });
      
      return res.status(200).json(formatResponse({
        message: result.message,
        document: {
          id: result.document._id,
          status: result.document.status,
          agreementId: result.adobeAgreementId || (result.document.adobeMetadata && result.document.adobeMetadata.agreementId)
        },
        recoveryDetails: {
          verified: !!result.verifiedRecovery,
          method: result.recoveryStrategy || (result.aggressive ? 'aggressive' : 'standard'),
          timestamp: new Date()
        }
      }));
    } else {
      return res.status(400).json(formatResponse({
        message: result.message,
        document: result.document ? {
          id: result.document._id,
          status: result.document.status
        } : null
      }, false));
    }
  } catch (error) {
    logger.error(`Error in enhanced document recovery: ${error.message}`);
    return next(new ApiError(500, `Error recovering document: ${error.message}`));
  }
};

/**
 * Get detailed status of a document including Adobe Sign status
 * @route GET /api/documents/:id/enhanced-status
 */
exports.getEnhancedDocumentStatus = async (req, res, next) => {
  try {
    const documentId = req.params.id;
    
    // Find document
    const document = await Document.findById(documentId);
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    // Basic status
    const statusResponse = {
      document: {
        id: document._id,
        name: document.originalName,
        status: document.status,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt
      }
    };
    
    // If document is sent for signature and has agreement ID, get Adobe Sign status
    if (document.status === 'sent_for_signature' && 
        (document.adobeAgreementId || (document.adobeMetadata && document.adobeMetadata.agreementId))) {
      try {
        const agreementId = document.adobeAgreementId || document.adobeMetadata.agreementId;
        const token = await getAccessToken();
        const client = await createEnhancedAdobeSignClient();
        
        const response = await client.get(`/api/rest/v6/agreements/${agreementId}`);
        
        if (response.data) {
          statusResponse.adobeSign = {
            agreementId: agreementId,
            status: response.data.status,
            name: response.data.name,
            createdDate: response.data.createdDate,
            expirationDate: response.data.expirationDate,
            displayDate: response.data.displayDate,
            events: response.data.events || []
          };
          
          // Include participant info
          if (response.data.participantSetsInfo) {
            statusResponse.participants = response.data.participantSetsInfo.map(participant => ({
              email: participant.memberInfos?.[0]?.email || 'unknown',
              status: participant.status || 'unknown',
              role: participant.role || 'SIGNER'
            }));
          }
        }
      } catch (adobeError) {
        logger.warn(`Error getting Adobe Sign status: ${adobeError.message}`);
        statusResponse.adobeSign = {
          error: `Error retrieving Adobe Sign status: ${adobeError.message}`,
          agreementId: document.adobeAgreementId || (document.adobeMetadata && document.adobeMetadata.agreementId)
        };
      }
    }
    
    // Return response
    return res.status(200).json(formatResponse(statusResponse));
  } catch (error) {
    logger.error(`Error getting document status: ${error.message}`);
    return next(new ApiError(500, `Error getting document status: ${error.message}`));
  }
};

module.exports = exports;
