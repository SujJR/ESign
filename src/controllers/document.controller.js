const Document = require('../models/document.model');
const Log = require('../models/log.model');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');
const documentUtils = require('../utils/documentUtils');
const { createAdobeSignClient, getAccessToken, uploadTransientDocument } = require('../config/adobeSign');
const fs = require('fs');
const path = require('path');
const { createAgreementWithBestApproach } = require('../utils/adobeSignFormFields');

/**
 * Upload a document for e-signature
 * @route POST /api/documents/upload
 */
exports.uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new ApiError(400, 'No document uploaded'));
    }
    
    // Extract file information
    const { filename, originalname, mimetype, size, path: filePath } = req.file;
    
    // Analyze PDF to get page count
    const pdfInfo = await documentUtils.analyzePdf(filePath);
    
    // Create document record in database
    const document = await Document.create({
      filename,
      originalName: originalname,
      fileSize: size,
      filePath,
      mimeType: mimetype,
      pageCount: pdfInfo.pageCount,
      status: 'uploaded',
      creator: req.user._id
    });
    
    // Log document upload
    await Log.create({
      level: 'info',
      message: `Document uploaded: ${originalname}`,
      userId: req.user._id,
      documentId: document._id,
      ipAddress: req.ip,
      requestPath: req.originalUrl,
      requestMethod: req.method,
      metadata: {
        fileSize: size,
        mimeType: mimetype
      }
    });
    
    logger.info(`Document uploaded: ${originalname} by user ${req.user.email}`);
    
    res.status(201).json(formatResponse(
      201,
      'Document uploaded successfully',
      { document }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Get all documents for a user
 * @route GET /api/documents
 */
exports.getDocuments = async (req, res, next) => {
  try {
    const documents = await Document.find({ creator: req.user._id })
      .sort({ createdAt: -1 });
    
    res.status(200).json(formatResponse(
      200,
      'Documents retrieved successfully',
      { documents }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific document
 * @route GET /api/documents/:id
 */
exports.getDocument = async (req, res, next) => {
  try {
    const document = await Document.findOne({ 
      _id: req.params.id,
      creator: req.user._id
    });
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    res.status(200).json(formatResponse(
      200,
      'Document retrieved successfully',
      { document }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Prepare document for e-signature
 * @route POST /api/documents/:id/prepare
 */
exports.prepareForSignature = async (req, res, next) => {
  try {
    const { recipients, useIntelligentPositioning = true } = req.body;
    
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return next(new ApiError(400, 'Recipients are required'));
    }
    
    const document = await Document.findOne({
      _id: req.params.id,
      creator: req.user._id
    });
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    // Validate and format recipients
    const formattedRecipients = recipients.map((recipient, index) => {
      if (!recipient.name || !recipient.email) {
        throw new ApiError(400, 'Each recipient must have a name and email');
      }
      
      return {
        name: recipient.name,
        email: recipient.email,
        order: index + 1,
        status: 'pending'
      };
    });
    
    // Update document with recipients and intelligent positioning flag
    document.recipients = formattedRecipients;
    document.status = 'ready_for_signature';
    document.useIntelligentPositioning = useIntelligentPositioning;
    await document.save();
    
    // Log document preparation
    await Log.create({
      level: 'info',
      message: `Document prepared for signature: ${document.originalName}`,
      userId: req.user._id,
      documentId: document._id,
      ipAddress: req.ip,
      requestPath: req.originalUrl,
      requestMethod: req.method,
      metadata: {
        recipientCount: recipients.length
      }
    });
    
    logger.info(`Document prepared for signature: ${document.originalName} by user ${req.user.email}`);
    
    res.status(200).json(formatResponse(
      200,
      'Document prepared for signature successfully',
      { document }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Send document for e-signature using the best approach
 * @route POST /api/documents/:id/send
 */
exports.sendForSignature = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      creator: req.user._id,
      status: 'ready_for_signature'
    });
    
    if (!document) {
      return next(new ApiError(404, 'Document not found or not ready for signature'));
    }

    if (!document.recipients || document.recipients.length === 0) {
      return next(new ApiError(400, 'Document has no recipients'));
    }

    try {
      // Check if file exists
      if (!fs.existsSync(document.filePath)) {
        logger.error(`File not found at path: ${document.filePath}`);
        return next(new ApiError(404, 'Document file not found on server'));
      }
      
      // Get file stats to ensure it's not empty
      const fileStats = fs.statSync(document.filePath);
      if (fileStats.size === 0) {
        logger.error(`File is empty: ${document.filePath}`);
        return next(new ApiError(400, 'Document file is empty'));
      }
      
      // Upload as transient document
      logger.info(`Uploading document as transient document: ${document.originalName}`);
      const transientDocumentId = await uploadTransientDocument(document.filePath);
      logger.info(`Document uploaded as transient document: ${transientDocumentId}`);
      
      // Use the comprehensive approach from adobeSignFormFields utility
      logger.info(`Using comprehensive approach to create agreement: ${document.originalName}`);
      const result = await createAgreementWithBestApproach(
        transientDocumentId,
        document.recipients,
        document.originalName,
        {
          templateId: document.templateId // If using templates
        }
      );
      
      // Update document with Adobe Sign agreement ID
      document.adobeAgreementId = result.agreementId;
      document.status = 'sent_for_signature';
      document.adobeMetadata = {
        agreementId: result.agreementId,
        method: result.method,
        createdAt: new Date()
      };
      
      // Update recipients status
      document.recipients.forEach(recipient => {
        recipient.status = 'sent';
      });
      
      await document.save();
      
      // Log document sent for signature
      await Log.create({
        level: 'info',
        message: `Document sent for signature using ${result.method} approach: ${document.originalName}`,
        userId: req.user._id,
        documentId: document._id,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
        requestMethod: req.method,
        metadata: {
          adobeAgreementId: result.agreementId,
          method: result.method,
          recipientCount: document.recipients.length
        }
      });
      
      logger.info(`Document sent for signature using ${result.method} approach: ${document.originalName} by user ${req.user.email}`);
      
      res.status(200).json(formatResponse(
        200,
        `Document sent for signature successfully using ${result.method} approach`,
        { 
          document,
          adobeAgreementId: result.agreementId,
          method: result.method
        }
      ));
    } catch (adobeError) {
      logger.error(`Adobe Sign API Error: ${adobeError.message}`);
      if (adobeError.response) {
        logger.error(`Status: ${adobeError.response.status}, Data: ${JSON.stringify(adobeError.response.data)}`);
      }
      
      // Update document status to indicate error
      document.status = 'signature_error';
      document.errorMessage = adobeError.message;
      await document.save();
      
      return next(new ApiError(500, `Failed to send document for signature: ${adobeError.message}`));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Send document for e-signature using a two-step approach
 * First create the agreement, then add form fields
 * @route POST /api/documents/:id/send-two-step
 */
exports.sendForSignatureTwoStep = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      creator: req.user._id,
      status: 'ready_for_signature'
    });
    
    if (!document) {
      return next(new ApiError(404, 'Document not found or not ready for signature'));
    }
    
    if (!document.recipients || document.recipients.length === 0) {
      return next(new ApiError(400, 'Document has no recipients'));
    }
    
    try {
      // Get Adobe Sign client
      const adobeSignClient = await createAdobeSignClient();
      
      // Check file existence
      if (!fs.existsSync(document.filePath)) {
        logger.error(`File not found at path: ${document.filePath}`);
        return next(new ApiError(404, 'Document file not found on server'));
      }
      
      // Get file stats to ensure it's not empty
      const fileStats = fs.statSync(document.filePath);
      if (fileStats.size === 0) {
        logger.error(`File is empty: ${document.filePath}`);
        return next(new ApiError(400, 'Document file is empty'));
      }
      
      // Upload as transient document
      logger.info(`Uploading document as transient document: ${document.originalName}`);
      const transientDocumentId = await uploadTransientDocument(document.filePath);
      logger.info(`Document uploaded as transient document: ${transientDocumentId}`);
      
      // Prepare recipients in Adobe Sign format
      const adobeRecipients = document.recipients.map(recipient => ({
        email: recipient.email,
        role: 'SIGNER'
      }));
      
      // STEP 1: Create agreement WITHOUT form fields
      logger.info(`Creating agreement without form fields: ${document.originalName}`);
      
      const payload = {
        fileInfos: [
          {
            transientDocumentId: transientDocumentId
          }
        ],
        name: document.originalName,
        participantSetsInfo: [
          {
            memberInfos: adobeRecipients,
            order: 1,
            role: 'SIGNER'
          }
        ],
        signatureType: 'ESIGN',
        state: 'IN_PROCESS'
      };
      
      // Log request headers and payload for debugging
      logger.info(`Adobe Sign API Headers: ${JSON.stringify(adobeSignClient.defaults.headers)}`);
      logger.info(`Adobe Sign API URL: ${adobeSignClient.defaults.baseURL}`);
      logger.info(`Request payload: ${JSON.stringify(payload)}`);
      
      // Create agreement
      const agreementResponse = await adobeSignClient.post('api/rest/v6/agreements', payload);
      logger.info(`Agreement created with ID: ${agreementResponse.data.id}`);
      
      // Update document with Adobe Sign agreement ID
      document.adobeAgreementId = agreementResponse.data.id;
      document.status = 'sent_for_signature';
      document.adobeMetadata = agreementResponse.data;
      
      // STEP 2: Add form fields to the agreement
      try {
        // Use the enhanced formFieldUtils with retry logic
        const { addFormFieldsWithRetry, generateIntelligentFormFields } = require('../utils/formFieldUtils');
        
        // Add form fields with retry logic
        logger.info(`Adding form fields to agreement ${document.adobeAgreementId} with retry logic...`);
        
        // Use intelligent form field positioning based on document properties
        if (document.useIntelligentPositioning) {
          // Generate intelligent form fields
          const formFields = generateIntelligentFormFields(document);
          
          // Add the intelligent form fields to the agreement
          const formFieldsResponse = await addFormFieldsWithRetry(
            document.adobeAgreementId,
            document.recipients,
            document.pageCount || 1,
            3,  // maxRetries
            5000, // initialDelay
            3000  // retryDelay
          );
          
          logger.info(`Intelligent form fields added to agreement: ${JSON.stringify(formFieldsResponse)}`);
        } else {
          // Use standard form fields with retry logic
          const formFieldsResponse = await addFormFieldsWithRetry(
            document.adobeAgreementId,
            document.recipients,
            document.pageCount || 1,
            3,  // maxRetries
            5000, // initialDelay
            3000  // retryDelay
          );
          
          logger.info(`Form fields added to agreement: ${JSON.stringify(formFieldsResponse)}`);
        }
      } catch (formFieldError) {
        // Log error but continue since the agreement was created successfully
        logger.error(`Error adding form fields: ${formFieldError.message}`);
        if (formFieldError.response) {
          logger.error(`Status: ${formFieldError.response.status}, Data: ${JSON.stringify(formFieldError.response.data)}`);
        }
      }
      
      // Update recipients status
      document.recipients.forEach(recipient => {
        recipient.status = 'sent';
      });
      
      await document.save();
      
      // Log document sent for signature
      await Log.create({
        level: 'info',
        message: `Document sent for signature (two-step): ${document.originalName}`,
        userId: req.user._id,
        documentId: document._id,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
        requestMethod: req.method,
        metadata: {
          adobeAgreementId: document.adobeAgreementId
        }
      });
      
      logger.info(`Document sent for signature (two-step): ${document.originalName} by user ${req.user.email}`);
      
      res.status(200).json(formatResponse(
        200,
        'Document sent for signature successfully',
        { document }
      ));
    } catch (apiError) {
      // Detailed error handling for Adobe Sign API errors
      logger.error(`Adobe Sign API Error: ${apiError.message}`);
      let errorMessage = 'Error sending document for signature';
      
      if (apiError.response) {
        logger.error(`Status: ${apiError.response.status}, Data: ${JSON.stringify(apiError.response.data)}`);
        
        // Parse specific error codes
        if (apiError.response.data && apiError.response.data.code === 'INVALID_API_ACCESS_POINT') {
          errorMessage = 'Adobe Sign API access point is invalid. Please run the test-adobe-sign-access-points.js script to get the correct access point.';
        } else if (apiError.response.status === 401) {
          errorMessage = 'Authentication failed with Adobe Sign API. Please check your credentials.';
        } else if (apiError.response.status === 403) {
          errorMessage = 'Permission denied accessing Adobe Sign API. Please verify API key permissions.';
        } else if (apiError.response.status === 400) {
          errorMessage = `Bad request to Adobe Sign API: ${apiError.response.data.message || 'Invalid request format'}`;
        } else {
          errorMessage = `Adobe Sign API error (${apiError.response.status}): ${apiError.response.data.message || apiError.message}`;
        }
      }
      
      // Update document status to indicate failure
      document.status = 'failed';
      await document.save();
      
      return next(new ApiError(500, errorMessage));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Send document for signature using comprehensive approach with multiple fallbacks
 * @route POST /api/documents/:id/send-comprehensive
 */
exports.sendForSignatureComprehensive = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      creator: req.user._id,
      status: 'ready_for_signature'
    });
    
    if (!document) {
      return next(new ApiError(404, 'Document not found or not ready for signature'));
    }
    
    if (!document.recipients || document.recipients.length === 0) {
      return next(new ApiError(400, 'Document has no recipients'));
    }
    
    try {
      // Check file existence
      if (!fs.existsSync(document.filePath)) {
        logger.error(`File not found at path: ${document.filePath}`);
        return next(new ApiError(404, 'Document file not found on server'));
      }
      
      // Get file stats to ensure it's not empty
      const fileStats = fs.statSync(document.filePath);
      if (fileStats.size === 0) {
        logger.error(`File is empty: ${document.filePath}`);
        return next(new ApiError(400, 'Document file is empty'));
      }
      
      // Upload as transient document
      logger.info(`Uploading document as transient document: ${document.originalName}`);
      const transientDocumentId = await uploadTransientDocument(document.filePath);
      logger.info(`Document uploaded as transient document: ${transientDocumentId}`);
      
      // Use comprehensive approach with multiple fallbacks
      logger.info(`Using comprehensive approach for document: ${document.originalName}`);
      
      const result = await createAgreementWithBestApproach(
        transientDocumentId,
        document.recipients,
        document.originalName,
        {
          templateId: document.templateId // If using templates
        }
      );
      
      // Update document with Adobe Sign agreement ID
      document.adobeAgreementId = result.agreementId;
      document.status = 'sent_for_signature';
      document.adobeMetadata = {
        agreementId: result.agreementId,
        method: result.method,
        createdAt: new Date()
      };
      
      // Update recipients status
      document.recipients.forEach(recipient => {
        recipient.status = 'sent';
      });
      
      await document.save();
      
      // Log document sent for signature
      await Log.create({
        level: 'info',
        message: `Document sent for signature using ${result.method} approach: ${document.originalName}`,
        userId: req.user._id,
        documentId: document._id,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
        requestMethod: req.method,
        metadata: {
          adobeAgreementId: result.agreementId,
          method: result.method,
          recipientCount: document.recipients.length
        }
      });
      
      logger.info(`Document sent for signature using ${result.method} approach: ${document.originalName} by user ${req.user.email}`);
      
      res.status(200).json(formatResponse(
        200,
        `Document sent for signature successfully using ${result.method} approach`,
        { 
          document,
          adobeAgreementId: result.agreementId,
          method: result.method
        }
      ));
    } catch (adobeError) {
      logger.error(`Adobe Sign API Error: ${adobeError.message}`);
      if (adobeError.response) {
        logger.error(`Status: ${adobeError.response.status}, Data: ${JSON.stringify(adobeError.response.data)}`);
      }
      
      // Update document status to indicate error
      document.status = 'signature_error';
      document.errorMessage = adobeError.message;
      await document.save();
      
      return next(new ApiError(500, `Failed to send document for signature: ${adobeError.message}`));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Check document status from Adobe Sign
 * @route GET /api/documents/:id/status
 */
exports.checkDocumentStatus = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      creator: req.user._id
    });
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    if (!document.adobeAgreementId) {
      return next(new ApiError(400, 'Document has not been sent for signature yet'));
    }
    
    try {
      // Get Adobe Sign client (async)
      const adobeSignClient = await createAdobeSignClient();
      
      // Get agreement status
      const agreementResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}`);
      
      // Update document metadata
      document.adobeMetadata = agreementResponse.data;
      
      // Update document status based on Adobe Sign status
      const adobeStatus = agreementResponse.data.status;
      
      switch (adobeStatus) {
        case 'SIGNED':
          document.status = 'completed';
          break;
        case 'CANCELLED':
          document.status = 'cancelled';
          break;
        case 'EXPIRED':
          document.status = 'expired';
          break;
        default:
          // Keep current status
          break;
      }
      
      // Update recipients status if available
      if (agreementResponse.data.participantSetsInfo) {
        agreementResponse.data.participantSetsInfo.forEach(participantSet => {
          participantSet.memberInfos.forEach(member => {
            const recipient = document.recipients.find(r => r.email === member.email);
            
            if (recipient) {
              switch (member.status) {
                case 'SIGNED':
                  recipient.status = 'signed';
                  recipient.signedAt = new Date();
                  break;
                case 'REJECTED':
                  recipient.status = 'declined';
                  break;
                case 'EXPIRED':
                  recipient.status = 'expired';
                  break;
                case 'NOT_YET_ACTED':
                  if (member.privateMessage === 'viewed') {
                    recipient.status = 'viewed';
                  } else {
                    recipient.status = 'sent';
                  }
                  break;
                default:
                  break;
              }
            }
          });
        });
      }
      
      await document.save();
      
      // Log status check
      await Log.create({
        level: 'info',
        message: `Document status checked: ${document.originalName}`,
        userId: req.user._id,
        documentId: document._id,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
        requestMethod: req.method,
        metadata: {
          adobeStatus
        }
      });
      
      logger.info(`Document status checked: ${document.originalName} by user ${req.user.email}`);
      
      res.status(200).json(formatResponse(
        200,
        'Document status retrieved successfully',
        { document }
      ));
    } catch (error) {
      // Handle Adobe Sign API errors
      logger.error(`Error checking document status: ${error.message}`);
      return next(new ApiError(500, `Error checking document status: ${error.message}`));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Download signed document
 * @route GET /api/documents/:id/download
 */
exports.downloadDocument = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      creator: req.user._id
    });
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    // Check if document has been completed
    if (document.status === 'completed' && document.adobeAgreementId) {
      try {
        // Get Adobe Sign client (async)
        const adobeSignClient = await createAdobeSignClient();
        
        // Get signed document
        const agreementResponse = await adobeSignClient.get(
          `api/rest/v6/agreements/${document.adobeAgreementId}/combinedDocument`,
          { responseType: 'arraybuffer' }
        );
        
        // Set response headers
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${document.originalName}"`,
          'Content-Length': agreementResponse.data.length
        });
        
        // Log download
        await Log.create({
          level: 'info',
          message: `Document downloaded: ${document.originalName}`,
          userId: req.user._id,
          documentId: document._id,
          ipAddress: req.ip,
          requestPath: req.originalUrl,
          requestMethod: req.method
        });
        
        logger.info(`Signed document downloaded: ${document.originalName} by user ${req.user.email}`);
        
        // Send file
        return res.send(agreementResponse.data);
      } catch (error) {
        // Handle Adobe Sign API errors
        logger.error(`Error downloading signed document: ${error.message}`);
        return next(new ApiError(500, `Error downloading signed document: ${error.message}`));
      }
    } else if (document.status !== 'completed') {
      return next(new ApiError(400, 'Document has not been completed yet'));
    } else {
      // Return original document if available
      if (fs.existsSync(document.filePath)) {
        // Log download
        await Log.create({
          level: 'info',
          message: `Original document downloaded: ${document.originalName}`,
          userId: req.user._id,
          documentId: document._id,
          ipAddress: req.ip,
          requestPath: req.originalUrl,
          requestMethod: req.method
        });
        
        logger.info(`Original document downloaded: ${document.originalName} by user ${req.user.email}`);
        
        return res.download(document.filePath, document.originalName);
      } else {
        return next(new ApiError(404, 'Document file not found'));
      }
    }
  } catch (error) {
    next(error);
  }
};
