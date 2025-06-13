const Document = require('../models/document.model');
const Log = require('../models/log.model');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');
const documentUtils = require('../utils/documentUtils');
const documentProcessor = require('../utils/documentProcessor');
const { createAdobeSignClient, getAccessToken, uploadTransientDocument } = require('../config/adobeSign');
const fs = require('fs');
const path = require('path');
const { createAgreementWithBestApproach, verifyAdobeSignTextTags } = require('../utils/adobeSignFormFields');
const adobeSignTemplateHandler = require('../utils/adobeSignTemplateHandler');
const adobeSignTagHandler = require('../utils/adobeSignTagHandler');
const adobeSignBypass = require('../utils/adobeSignBypass');
const emailService = require('../services/emailService');

/**
 * Helper function to extract recipients from template data
 * @param {Object} templateData - Template data containing recipient information
 * @returns {Array} - Array of recipient objects
 */
const extractRecipientsFromTemplateData = (templateData) => {
  const recipients = [];
  const emailSet = new Set(); // Track emails to prevent duplicates
  
  // PRIORITY 1: Check for explicit recipients array first
  if (templateData.recipients && Array.isArray(templateData.recipients) && templateData.recipients.length > 0) {
    logger.info('Using explicit recipients array from template data');
    templateData.recipients.forEach((recipient, index) => {
      if (recipient.name && recipient.email && !emailSet.has(recipient.email.toLowerCase())) {
        emailSet.add(recipient.email.toLowerCase());
        recipients.push({
          name: recipient.name,
          email: recipient.email,
          title: recipient.title || '',
          signatureField: recipient.signatureField || `signature_recipient_${index + 1}`
        });
      }
    });
  } else {
    // PRIORITY 2: Fall back to individual field patterns only if no recipients array
    logger.info('No recipients array found, extracting from individual fields');
    const recipientFields = [
      { nameField: 'signerName', emailField: 'signerEmail', titleField: 'signerTitle' },
      { nameField: 'clientName', emailField: 'clientEmail', titleField: 'clientTitle' },
      { nameField: 'witnessName', emailField: 'witnessEmail', titleField: 'witnessTitle' }
      // Note: Removed projectManager and approverName as they are typically not signers
    ];
    
    // Extract recipients based on field patterns
    recipientFields.forEach((fieldSet, index) => {
      const name = templateData[fieldSet.nameField];
      const email = templateData[fieldSet.emailField];
      const title = templateData[fieldSet.titleField];
      
      if (name && email && !emailSet.has(email.toLowerCase())) {
        emailSet.add(email.toLowerCase());
        recipients.push({
          name: name,
          email: email,
          title: title || '',
          signatureField: `signature_${fieldSet.nameField.toLowerCase().replace('name', '')}`
        });
      }
    });
  }
  
  logger.info(`Extracted ${recipients.length} unique recipients for signature from template data`);
  return recipients;
};

/**
 * Upload a document for e-signature with optional JSON data for template processing
 * @route POST /api/documents/upload
 */
exports.uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new ApiError(400, 'No document uploaded'));
    }
    
    // Extract file information
    const { filename, originalname, mimetype, size, path: filePath } = req.file;
    
    // Initialize document data
    let documentData = {
      filename,
      originalName: originalname,
      fileSize: size,
      filePath,
      mimeType: mimetype,
      status: 'uploaded'
    };
    
    // Check if it's a PDF or needs processing
    const fileExtension = path.extname(originalname).toLowerCase();
    let finalPdfPath = filePath;
    let pageCount = 0;
    
    if (fileExtension === '.pdf') {
      // Analyze PDF to get page count
      const pdfInfo = await documentUtils.analyzePdf(filePath);
      pageCount = pdfInfo.pageCount;
    } else if (['.docx', '.doc'].includes(fileExtension)) {
      // Process DOCX/DOC file
      try {
        // Analysis and processing logic for DOCX/DOC
        const analysis = await documentProcessor.analyzeDocumentForSignatureFields(filePath);
        
        documentData.templateVariables = analysis.templateVariables;
        documentData.documentAnalysis = analysis;
        
        // Check for Adobe Sign tags before attempting standard processing
        const hasAdobeSignTags = await documentProcessor.containsAdobeSignTags(filePath);
        
        if (hasAdobeSignTags) {
          logger.info('Detected Adobe Sign tags in document, using direct bypass processing');
          documentData.containsAdobeSignTags = true;
          
          if (Object.keys(templateData).length > 0) {
            // Use the direct bypass approach for maximum tag preservation
            try {
              logger.info('Using direct bypass approach for Adobe Sign tags');
              processedFilePath = await adobeSignBypass.bypassTemplateProcessing(filePath, templateData);
              documentData.processedFilePath = processedFilePath;
              finalPdfPath = await adobeSignBypass.convertToPdf(processedFilePath);
            } catch (bypassError) {
              logger.warn(`Direct bypass failed: ${bypassError.message}, trying specialized handler...`);
              // Fall back to the specialized handler
              processedFilePath = await documentProcessor.processDocumentWithAdobeSignTags(filePath, templateData);
              documentData.processedFilePath = processedFilePath;
              finalPdfPath = await documentProcessor.convertDocxToPdf(processedFilePath);
            }
          } else {
            // No template data, just convert to PDF
            finalPdfPath = await documentProcessor.convertDocxToPdf(filePath);
          }
        } else {
          // Standard template processing path (no Adobe Sign tags)
          if (Object.keys(templateData).length > 0) {
            processedFilePath = await documentProcessor.processDocumentTemplate(filePath, templateData);
            documentData.processedFilePath = processedFilePath;
            finalPdfPath = await documentProcessor.convertDocxToPdf(processedFilePath);
          } else {
            finalPdfPath = await documentProcessor.convertDocxToPdf(filePath);
          }
        }
        
        documentData.pdfFilePath = finalPdfPath;
        documentData.autoDetectedSignatureFields = (analysis.signatureFields || []).map(field => {
          if (typeof field === 'object' && field.name) {
            // Field is an object with positioning data - extract the proper structure for Adobe Sign
            return {
              name: field.name,
              type: field.type.toLowerCase(),
              required: true,
              x: field.x,
              y: field.y,
              width: field.width,
              height: field.height,
              page: field.page,
              detected: true
            };
          } else {
            // Fallback for string-based fields
            return {
              name: field,
              type: 'signature',
              required: true
            };
          }
        });
        
        // Analyze the converted PDF
        const pdfInfo = await documentUtils.analyzePdf(finalPdfPath);
        pageCount = pdfInfo.pageCount;
        
        // Check if the document has Adobe Sign text tags and verify their format
        if (documentData.autoDetectedSignatureFields && documentData.autoDetectedSignatureFields.length > 0) {
          const verificationResult = verifyAdobeSignTextTags(documentData.autoDetectedSignatureFields);
          if (verificationResult.hasTags) {
            logger.info('Adobe Sign text tags detected in document');
            
            if (!verificationResult.correctFormat) {
              logger.warn('Issues found with Adobe Sign text tags:');
              verificationResult.issuesFound.forEach(issue => logger.warn(`- ${issue}`));
              logger.warn('Recommendations:');
              verificationResult.recommendations.forEach(rec => logger.warn(`- ${rec}`));
              
              // If there are issues, add a message to the response
              documentData.textTagIssues = verificationResult.issuesFound;
              documentData.textTagRecommendations = verificationResult.recommendations;
            } else {
              logger.info('Adobe Sign text tags verification passed - signatures should appear at tag positions');
            }
            
            documentData.hasAdobeSignTags = true;
          }
        }
        
        logger.info(`Document processed successfully. Found ${analysis.templateVariables.length} template variables`);
      } catch (processingError) {
        logger.error(`Error processing document: ${processingError.message}`);
        
        // Check if this might be an Adobe Sign tag related error
        // The specific error you're seeing is "Template Error: Multi error"
        if (processingError.message.includes('Multi error') || 
            processingError.message.includes('Template Error') ||
            processingError.message.includes('unopened tag') ||
            processingError.message.includes('unclosed tag') ||
            processingError.message.includes('Error: {')) {
          
          try {
            logger.info('Detected potential Adobe Sign tag related error, checking document');
            // Check for Adobe Sign tags in the document
            const hasAdobeSignTags = await documentProcessor.containsAdobeSignTags(filePath);
            
            if (hasAdobeSignTags) {
              logger.info('Adobe Sign tags detected, using specialized processing instead');
              
              // Use the specialized handler for Adobe Sign tags
              processedFilePath = await documentProcessor.processDocumentWithAdobeSignTags(filePath, templateData);
              documentData.processedFilePath = processedFilePath;
              documentData.hasAdobeSignTags = true;
              
              // Convert processed document to PDF
              finalPdfPath = await documentProcessor.convertDocxToPdf(processedFilePath);
              documentData.pdfFilePath = finalPdfPath;
              
              // Analyze the converted PDF
              const pdfInfo = await documentUtils.analyzePdf(finalPdfPath);
              pageCount = pdfInfo.pageCount;
              
              logger.info('Successfully recovered from template error using Adobe Sign handler');
            } else {
              // If not Adobe Sign tags, re-throw original error
              throw processingError;
            }
          } catch (recoveryError) {
            if (recoveryError !== processingError) {
              logger.error(`Recovery attempt failed: ${recoveryError.message}`);
            }
            return next(new ApiError(400, `Error processing document template: ${processingError.message}`));
          }
        } else {
          return next(new ApiError(400, `Error processing document: ${processingError.message}`));
        }
      }
    } else {
      return next(new ApiError(400, 'Unsupported file format. Only PDF, DOCX, and DOC files are allowed'));
    }
    
    documentData.pageCount = pageCount;
    
    // Create document record in database
    const document = await Document.create(documentData);
    
    // Log document upload
    await Log.create({
      level: 'info',
      message: `Document uploaded: ${originalname}`,
      documentId: document._id,
      ipAddress: req.ip,
      requestPath: req.originalUrl,
      requestMethod: req.method,
      metadata: {
        fileSize: size,
        mimeType: mimetype,
        templateVariables: documentData.templateVariables || [],
        autoDetectedFields: documentData.autoDetectedSignatureFields?.length || 0
      }
    });
    
    logger.info(`Document uploaded: ${originalname}`);
    
    res.status(201).json(formatResponse(
      201,
      'Document uploaded successfully',
      { 
        document,
        templateVariables: documentData.templateVariables || [],
        autoDetectedSignatureFields: documentData.autoDetectedSignatureFields || []
      }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Upload a document with JSON data for template processing
 * @route POST /api/documents/upload-with-data
 */
exports.uploadDocumentWithData = async (req, res, next) => {
  try {
    if (!req.files || (!req.files.document && !req.files.documents)) {
      return next(new ApiError(400, 'No document uploaded'));
    }
    
    // Support both 'document' and 'documents' field names
    const documentFile = req.files.document ? req.files.document[0] : req.files.documents[0];
    const dataFile = req.files.data ? req.files.data[0] : null;
    
    // Extract file information
    const { filename, originalname, mimetype, size, path: filePath } = documentFile;
    
    // Parse JSON data if provided
    let templateData = {};
    if (dataFile) {
      try {
        const jsonContent = fs.readFileSync(dataFile.path, 'utf8');
        templateData = JSON.parse(jsonContent);
        
        // Clean up the temporary JSON file
        fs.unlinkSync(dataFile.path);
        
        logger.info(`JSON data file processed with ${Object.keys(templateData).length} variables`);
      } catch (jsonError) {
        logger.error(`Error parsing JSON data: ${jsonError.message}`);
        return next(new ApiError(400, 'Invalid JSON data file'));
      }
    }
    
    // Parse JSON data from request body if provided instead of file
    if (!dataFile && req.body.templateData) {
      try {
        templateData = typeof req.body.templateData === 'string' 
          ? JSON.parse(req.body.templateData) 
          : req.body.templateData;
      } catch (jsonError) {
        logger.error(`Error parsing JSON data from body: ${jsonError.message}`);
        return next(new ApiError(400, 'Invalid JSON data in request body'));
      }
    }
    
    // Initialize document data
    let documentData = {
      filename,
      originalName: originalname,
      fileSize: size,
      filePath,
      mimeType: mimetype,
      status: 'uploaded',
      templateData
    };
    
    // Check if it's a PDF or needs processing
    const fileExtension = path.extname(originalname).toLowerCase();
    let finalPdfPath = filePath;
    let pageCount = 0;
    let processedFilePath = null;
    
    if (fileExtension === '.pdf') {
      // Analyze PDF to get page count
      const pdfInfo = await documentUtils.analyzePdf(filePath);
      pageCount = pdfInfo.pageCount;
      
      // Even PDFs can have template variables in text layers
      try {
        const analysis = await documentProcessor.analyzeDocumentForSignatureFields(filePath);
        documentData.templateVariables = analysis.templateVariables;
        documentData.documentAnalysis = analysis;
        documentData.autoDetectedSignatureFields = (analysis.signatureFields || []).map(field => {
          if (typeof field === 'object' && field.name) {
            return {
              name: field.name,
              type: field.type.toLowerCase(),
              required: true,
              x: field.x,
              y: field.y,
              width: field.width,
              height: field.height,
              page: field.page,
              detected: true
            };
          } else {
            return {
              name: field,
              type: 'signature',
              required: true
            };
          }
        });
      } catch (analysisError) {
        logger.warn(`Could not analyze PDF for template variables: ${analysisError.message}`);
      }
    } else if (['.docx', '.doc'].includes(fileExtension)) {
      // Process DOCX/DOC file with template data
      try {
        // First analyze the document
        const analysis = await documentProcessor.analyzeDocumentForSignatureFields(filePath);
        
        // Process template with data if provided
        if (Object.keys(templateData).length > 0) {
          try {
            // Use our specialized Adobe Sign tag handler to process the document
            const processResult = await adobeSignTagHandler.processDocumentWithTags(filePath, templateData);
            
            // Update document data with paths and processing info
            processedFilePath = processResult.processedFilePath;
            finalPdfPath = processResult.pdfFilePath;
            documentData.processedFilePath = processedFilePath;
            documentData.pdfFilePath = finalPdfPath;
            documentData.hasAdobeSignTags = processResult.hasAdobeSignTags;
          } catch (processingError) {
            logger.error(`Error processing document with tags: ${processingError.message}`);
            return next(new ApiError(400, `Error processing document template: ${processingError.message}`));
          }
        } else {
          // No template data, just convert the original document to PDF
          finalPdfPath = await documentProcessor.convertDocxToPdf(filePath);
          documentData.pdfFilePath = finalPdfPath;
        }
        
        documentData.templateVariables = analysis.templateVariables;
        documentData.documentAnalysis = analysis;
        
        // Analyze the converted PDF
        const pdfInfo = await documentUtils.analyzePdf(finalPdfPath);
        pageCount = pdfInfo.pageCount;
        
        // Check if the document has Adobe Sign text tags and verify their format
        if (documentData.autoDetectedSignatureFields && documentData.autoDetectedSignatureFields.length > 0) {
          const verificationResult = verifyAdobeSignTextTags(documentData.autoDetectedSignatureFields);
          if (verificationResult.hasTags) {
            logger.info('Adobe Sign text tags detected in document');
            
            if (!verificationResult.correctFormat) {
              logger.warn('Issues found with Adobe Sign text tags:');
              verificationResult.issuesFound.forEach(issue => logger.warn(`- ${issue}`));
              logger.warn('Recommendations:');
              verificationResult.recommendations.forEach(rec => logger.warn(`- ${rec}`));
              
              // If there are issues, add a message to the response
              documentData.textTagIssues = verificationResult.issuesFound;
              documentData.textTagRecommendations = verificationResult.recommendations;
            } else {
              logger.info('Adobe Sign text tags verification passed - signatures should appear at tag positions');
            }
            
            documentData.hasAdobeSignTags = true;
          }
        }
        
        logger.info(`Document processed successfully. Found ${analysis.templateVariables.length} template variables`);
      } catch (processingError) {
        logger.error(`Error processing document: ${processingError.message}`);
        
        // Check if this might be an Adobe Sign tag related error
        // The specific error you're seeing is "Template Error: Multi error"
        if (processingError.message.includes('Multi error') || 
            processingError.message.includes('Template Error') ||
            processingError.message.includes('unopened tag') ||
            processingError.message.includes('unclosed tag') ||
            processingError.message.includes('Error: {')) {
          
          try {
            logger.info('Detected potential Adobe Sign tag related error, checking document');
            // Check for Adobe Sign tags in the document
            const hasAdobeSignTags = await documentProcessor.containsAdobeSignTags(filePath);
            
            if (hasAdobeSignTags) {
              logger.info('Adobe Sign tags detected, using specialized processing instead');
              
              // Use the specialized handler for Adobe Sign tags
              processedFilePath = await documentProcessor.processDocumentWithAdobeSignTags(filePath, templateData);
              documentData.processedFilePath = processedFilePath;
              documentData.hasAdobeSignTags = true;
              
              // Convert processed document to PDF
              finalPdfPath = await documentProcessor.convertDocxToPdf(processedFilePath);
              documentData.pdfFilePath = finalPdfPath;
              
              // Analyze the converted PDF
              const pdfInfo = await documentUtils.analyzePdf(finalPdfPath);
              pageCount = pdfInfo.pageCount;
              
              logger.info('Successfully recovered from template error using Adobe Sign handler');
            } else {
              // If not Adobe Sign tags, re-throw original error
              throw processingError;
            }
          } catch (recoveryError) {
            if (recoveryError !== processingError) {
              logger.error(`Recovery attempt failed: ${recoveryError.message}`);
            }
            return next(new ApiError(400, `Error processing document template: ${processingError.message}`));
          }
        } else {
          return next(new ApiError(400, `Error processing document: ${processingError.message}`));
        }
      }
    } else {
      return next(new ApiError(400, 'Unsupported file format. Only PDF, DOCX, and DOC files are allowed'));
    }
    
    documentData.pageCount = pageCount;
    
    // Create document record in database
    const document = await Document.create(documentData);
    
    // Log document upload
    await Log.create({
      level: 'info',
      message: `Document uploaded with template data: ${originalname}`,
      documentId: document._id,
      ipAddress: req.ip,
      requestPath: req.originalUrl,
      requestMethod: req.method,
      metadata: {
        fileSize: size,
        mimeType: mimetype,
        templateVariables: documentData.templateVariables || [],
        templateDataKeys: Object.keys(templateData),
        autoDetectedFields: documentData.autoDetectedSignatureFields?.length || 0,
        hasProcessedFile: !!processedFilePath,
        containsAdobeSignTags: true
      }
    });
    
    logger.info(`Document uploaded with template data: ${originalname}`);
    
    res.status(201).json(formatResponse(
      201,
      'Document uploaded and processed successfully (with Adobe Sign tags)',
      { 
        document,
        templateVariables: documentData.templateVariables || [],
        templateDataApplied: Object.keys(templateData),
        autoDetectedSignatureFields: documentData.autoDetectedSignatureFields || [],
        processedWithTemplateData: Object.keys(templateData).length > 0,
        containsAdobeSignTags: true
      }
    ));
    
    return; // End function execution here - we've sent the response
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
    const documents = await Document.find({})
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
      _id: req.params.id
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
    let { recipients, signatureFieldMapping, signingFlow } = req.body;
    
    const document = await Document.findOne({
      _id: req.params.id
    });
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }

    // If no recipients provided, try to extract from JSON template data
    if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
      if (document.templateData) {
        logger.info('No recipients provided, extracting from template data');
        recipients = extractRecipientsFromTemplateData(document.templateData);
        
        if (!recipients || recipients.length === 0) {
          return next(new ApiError(400, 'Recipients are required either in request body or template data. No recipients found in template data.'));
        }
        logger.info(`Extracted ${recipients.length} recipients from template data`);
        
        // Auto-generate signature field mapping from extracted recipients
        if (!signatureFieldMapping) {
          signatureFieldMapping = {};
          recipients.forEach(recipient => {
            if (recipient.signatureField) {
              signatureFieldMapping[recipient.email] = recipient.signatureField;
            }
          });
          logger.info(`Auto-generated signature field mapping for ${Object.keys(signatureFieldMapping).length} recipients`);
        }
      } else {
        return next(new ApiError(400, 'Recipients are required either in request body or template data'));
      }
    } else if (!Array.isArray(recipients)) {
      return next(new ApiError(400, 'Recipients must be an array'));
    }
    
    // Validate signing flow option
    const validSigningFlows = ['SEQUENTIAL', 'PARALLEL'];
    const selectedSigningFlow = signingFlow && validSigningFlows.includes(signingFlow.toUpperCase()) 
      ? signingFlow.toUpperCase() 
      : 'SEQUENTIAL'; // Default to sequential (updated default)
    
    // Validate and format recipients
    const formattedRecipients = recipients.map((recipient, index) => {
      if (!recipient.name || !recipient.email) {
        throw new ApiError(400, 'Each recipient must have a name and email');
      }
      
      return {
        name: recipient.name,
        email: recipient.email,
        order: index + 1,
        status: 'pending',
        signatureField: recipient.signatureField || signatureFieldMapping?.[recipient.email] || `signature_${index + 1}`
      };
    });
    
    // Update document with recipients and signature field mapping
    document.recipients = formattedRecipients;
    document.status = 'ready_for_signature';
    document.signatureFieldMapping = signatureFieldMapping || {};
    document.signingFlow = selectedSigningFlow;
    await document.save();
    
    // Log document preparation
    await Log.create({
      level: 'info',
      message: `Document prepared for signature: ${document.originalName}`,
      documentId: document._id,
      ipAddress: req.ip,
      requestPath: req.originalUrl,
      requestMethod: req.method,
      metadata: {
        recipientCount: recipients.length
      }
    });
    
    logger.info(`Document prepared for signature: ${document.originalName}`);
    
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
      status: 'ready_for_signature'
    });
    
    if (!document) {
      return next(new ApiError(404, 'Document not found or not ready for signature'));
    }

    if (!document.recipients || document.recipients.length === 0) {
      return next(new ApiError(400, 'Document has no recipients'));
    }

    try {
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
      
      // Get file stats to ensure it's not empty
      const fileStats = fs.statSync(fileToUpload);
      if (fileStats.size === 0) {
        logger.error(`File is empty: ${fileToUpload}`);
        return next(new ApiError(400, 'Document file is empty'));
      }
      
      // Upload as transient document
      logger.info(`Uploading document as transient document: ${document.originalName}`);
      const transientDocumentId = await uploadTransientDocument(fileToUpload);
      logger.info(`Document uploaded as transient document: ${transientDocumentId}`);
      
      // Use the comprehensive approach from adobeSignFormFields utility
      logger.info(`Using comprehensive approach to create agreement: ${document.originalName}`);
      const result = await createAgreementWithBestApproach(
        transientDocumentId,
        document.recipients,
        document.originalName,
        {
          templateId: document.templateId, // If using templates
          autoDetectedSignatureFields: document.autoDetectedSignatureFields || [],
          signingFlow: document.signingFlow || 'SEQUENTIAL' // Pass the signing flow option (default to sequential)
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
      
      logger.info(`Document sent for signature using ${result.method} approach: ${document.originalName} `);
      
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
      
      // Determine participant set structure based on signing flow
      let participantSetsInfo;
      const signingFlow = document.signingFlow || 'SEQUENTIAL';
      
      if (signingFlow === 'SEQUENTIAL') {
        // For sequential signing, each recipient gets their own participant set with increasing order
        participantSetsInfo = adobeRecipients.map((recipient, index) => ({
          memberInfos: [recipient],
          order: index + 1, // Sequential order
          role: 'SIGNER'
        }));
        logger.info(`Setting up sequential signing flow with ${adobeRecipients.length} participant sets`);
      } else {
        // For parallel signing (default), all recipients in one participant set
        participantSetsInfo = [
          {
            memberInfos: adobeRecipients,
            order: 1,
            role: 'SIGNER'
          }
        ];
        logger.info(`Setting up parallel signing flow with 1 participant set containing ${adobeRecipients.length} members`);
      }
      
      const payload = {
        fileInfos: [
          {
            transientDocumentId: transientDocumentId
          }
        ],
        name: document.originalName,
        participantSetsInfo,
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
        
        documentId: document._id,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
        requestMethod: req.method,
        metadata: {
          adobeAgreementId: document.adobeAgreementId
        }
      });
      
      logger.info(`Document sent for signature (two-step): ${document.originalName} `);
      
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
          templateId: document.templateId, // If using templates
          autoDetectedSignatureFields: document.autoDetectedSignatureFields || [],
          signingFlow: document.signingFlow || 'SEQUENTIAL' // Pass the signing flow option (default to sequential)
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
      
      logger.info(`Document sent for signature using ${result.method} approach: ${document.originalName} `);
      
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
      _id: req.params.id
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
      
      // Try to get form field data to check for actual signatures
      let formFieldData = null;
      try {
        const formFieldResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/formData`);
        formFieldData = formFieldResponse.data;
        logger.info(`Retrieved form field data for agreement ${document.adobeAgreementId}`);
      } catch (formFieldError) {
        logger.warn(`Could not retrieve form field data: ${formFieldError.message}`);
      }
      
      // Try to get agreement events to check for signature events
      let agreementEvents = null;
      try {
        const eventsResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/events`);
        agreementEvents = eventsResponse.data;
        logger.info(`Retrieved agreement events for agreement ${document.adobeAgreementId}`);
      } catch (eventsError) {
        logger.warn(`Could not retrieve agreement events: ${eventsError.message}`);
      }
      
      // Update recipients status using multiple data sources
      if (agreementResponse.data.participantSetsInfo) {
        agreementResponse.data.participantSetsInfo.forEach(participantSet => {
          participantSet.memberInfos.forEach(member => {
            const recipient = document.recipients.find(r => r.email === member.email);
            
            if (recipient) {
              // Log the member status for debugging
              logger.info(`Checking recipient ${member.email} - Adobe Sign status: ${member.status}`);
              
              // Store the previous status to detect changes
              const previousStatus = recipient.status;
              
              // Check if this recipient has actually signed by looking at different data sources
              let hasActuallySigned = false;
              
              // Method 1: Check form field data for signatures
              if (formFieldData && Array.isArray(formFieldData)) {
                const recipientSignatures = formFieldData.filter(field => 
                  field.fieldType === 'SIGNATURE' && 
                  field.value && 
                  field.value.trim() !== '' &&
                  (field.assignedToRecipient === member.email || field.name.includes(`signer${participantSet.order}`))
                );
                
                if (recipientSignatures.length > 0) {
                  hasActuallySigned = true;
                  logger.info(`Recipient ${member.email} has signature in form field data`);
                }
              } else if (formFieldData && formFieldData.fields && Array.isArray(formFieldData.fields)) {
                // Handle different API response format
                const recipientSignatures = formFieldData.fields.filter(field => 
                  field.fieldType === 'SIGNATURE' && 
                  field.value && 
                  field.value.trim() !== '' &&
                  (field.assignedToRecipient === member.email || field.name.includes(`signer${participantSet.order}`))
                );
                
                if (recipientSignatures.length > 0) {
                  hasActuallySigned = true;
                  logger.info(`Recipient ${member.email} has signature in form field data (fields format)`);
                }
              } else if (formFieldData) {
                // Log the structure for debugging
                logger.info(`CheckStatus - Form field data structure: ${JSON.stringify(Object.keys(formFieldData), null, 2)}`);
              }
              
              // Method 2: Check agreement events for ESIGNED events
              if (agreementEvents && agreementEvents.events) {
                const signatureEvents = agreementEvents.events.filter(event => 
                  event.type === 'ESIGNED' && 
                  event.participantEmail === member.email
                );
                
                if (signatureEvents.length > 0) {
                  hasActuallySigned = true;
                  logger.info(`Recipient ${member.email} has ESIGNED event in agreement events`);
                  
                  // Update signedAt timestamp from the event
                  if (!recipient.signedAt && signatureEvents[0].date) {
                    recipient.signedAt = new Date(signatureEvents[0].date);
                    logger.info(`Updated signedAt timestamp for ${member.email} from event data`);
                  }
                }
              }
              
              // Method 3: Check if already marked as signed locally
              if (recipient.signedAt) {
                hasActuallySigned = true;
                logger.info(`Recipient ${member.email} has local signedAt timestamp`);
              }
              
              // Now update the status based on actual signature detection
              if (hasActuallySigned) {
                recipient.status = 'signed';
                if (!recipient.signedAt) {
                  recipient.signedAt = new Date();
                }
                logger.info(`✅ Recipient ${member.email} confirmed as SIGNED`);
              } else {
                // They haven't actually signed yet
                switch (member.status) {
                  case 'SIGNED':
                    // Adobe says signed but we found no evidence - this shouldn't happen
                    logger.warn(`⚠️ Adobe Sign says ${member.email} is SIGNED but no signature evidence found`);
                    recipient.status = 'signed';
                    if (!recipient.signedAt) {
                      recipient.signedAt = new Date();
                    }
                    break;
                  case 'REJECTED':
                  case 'DECLINED':
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
                  case 'ACTIVE':
                    recipient.status = 'sent';
                    logger.info(`📝 Recipient ${member.email} is ACTIVE and ready to sign`);
                    break;
                  case 'WAITING_FOR_OTHERS':
                    recipient.status = 'waiting';
                    logger.info(`⏳ Recipient ${member.email} is waiting for others to sign first`);
                    break;
                  case 'WAITING_FOR_MY_SIGNATURE':
                  case 'WAITING_FOR_VERIFICATION':
                  case 'WAITING_FOR_FAXING':
                    recipient.status = 'waiting';
                    break;
                  case 'OUT_FOR_SIGNATURE':
                    recipient.status = 'sent';
                    break;
                  default:
                    logger.warn(`Unknown Adobe Sign status for ${member.email}: ${member.status}`);
                    recipient.status = 'sent'; // Default to sent for unknown statuses
                    break;
                }
              }
              
              logger.info(`Final status for ${member.email}: ${recipient.status} (was: ${previousStatus})`);
            }
          });
        });
      }
      
      // Now update document status based on Adobe Sign status and recipient statuses
      const adobeStatus = agreementResponse.data.status;
      
      // Count signed recipients to properly determine document completion
      const signedCount = document.recipients.filter(r => r.status === 'signed').length;
      const totalRecipients = document.recipients.length;
      
      switch (adobeStatus) {
        case 'SIGNED':
          // For SIGNED status, double-check that ALL recipients have actually signed
          // This is crucial for parallel signing where Adobe might report SIGNED after one signature
          if (signedCount === totalRecipients) {
            document.status = 'completed';
            logger.info(`Document completed: all ${totalRecipients} recipients have signed`);
          } else {
            // Adobe reports SIGNED but not all recipients have signed - keep as partially signed
            document.status = 'partially_signed';
            logger.warn(`Adobe reports SIGNED but only ${signedCount}/${totalRecipients} have signed - keeping as partially_signed`);
          }
          break;
        case 'CANCELLED':
          document.status = 'cancelled';
          break;
        case 'EXPIRED':
          document.status = 'expired';
          break;
        case 'OUT_FOR_SIGNATURE':
          // Check recipient statuses to determine if partially signed
          if (signedCount === totalRecipients) {
            // All have signed but Adobe still shows OUT_FOR_SIGNATURE - mark as completed
            document.status = 'completed';
            logger.info(`All recipients signed: ${signedCount}/${totalRecipients} - marking as completed`);
          } else if (signedCount > 0) {
            document.status = 'partially_signed';
            logger.info(`Document partially signed: ${signedCount}/${totalRecipients} recipients have signed`);
          } else {
            document.status = 'sent_for_signature';
          }
          break;
        default:
          // For unknown statuses, use recipient count logic
          if (signedCount === totalRecipients && totalRecipients > 0) {
            document.status = 'completed';
            logger.info(`All recipients signed despite unknown Adobe status (${adobeStatus}) - marking as completed`);
          } else if (signedCount > 0) {
            document.status = 'partially_signed';
            logger.info(`Partially signed despite unknown Adobe status (${adobeStatus}): ${signedCount}/${totalRecipients}`);
          }
          logger.info(`Unknown Adobe Sign status: ${adobeStatus}, determined document status: ${document.status}`);
          break;
      }
      
      await document.save();
      
      // Log status check
      await Log.create({
        level: 'info',
        message: `Document status checked: ${document.originalName}`,
        
        documentId: document._id,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
        requestMethod: req.method,
        metadata: {
          adobeStatus
        }
      });
      
      logger.info(`Document status checked: ${document.originalName} `);
      
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
      _id: req.params.id
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
          
          documentId: document._id,
          ipAddress: req.ip,
          requestPath: req.originalUrl,
          requestMethod: req.method
        });
        
        logger.info(`Signed document downloaded: ${document.originalName} `);
        
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
          
          documentId: document._id,
          ipAddress: req.ip,
          requestPath: req.originalUrl,
          requestMethod: req.method
        });
        
        logger.info(`Original document downloaded: ${document.originalName} `);
        
        return res.download(document.filePath, document.originalName);
      } else {
        return next(new ApiError(404, 'Document file not found'));
      }
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Send reminder email to recipients who haven't signed yet
 * @route POST /api/documents/:id/send-reminder
 */
exports.sendReminder = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id
    });

    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }

    if (!document.adobeAgreementId) {
      return next(new ApiError(400, 'Document has not been sent for signature yet'));
    }

    // Check if document is still in progress
    if (!['sent_for_signature', 'partially_signed'].includes(document.status)) {
      return next(new ApiError(400, 'Document is not in a state where reminders can be sent'));
    }

    // Get Adobe Sign client
    const adobeSignClient = await createAdobeSignClient();

    let agreementData = null;
    let useLocalDataOnly = false;

    // Try to get agreement details from Adobe Sign
    try {
      logger.info(`Fetching Adobe Sign agreement: ${document.adobeAgreementId}`);
      const agreementResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}`);
      agreementData = agreementResponse.data;
      
      logger.info(`Adobe Sign agreement found: ${agreementData.status}`);
      logger.info(`Participant sets count: ${agreementData.participantSetsInfo ? agreementData.participantSetsInfo.length : 0}`);
      
      if (agreementData.participantSetsInfo) {
        agreementData.participantSetsInfo.forEach((participantSet, setIndex) => {
          logger.info(`Participant Set ${setIndex + 1} - Status: ${participantSet.status}, Role: ${participantSet.role}`);
          participantSet.memberInfos.forEach((member, memberIndex) => {
            logger.info(`  Member ${memberIndex + 1} - Email: ${member.email}, Status: ${member.status}`);
          });
        });
      }
    } catch (agreementError) {
      logger.warn(`Failed to fetch Adobe Sign agreement ${document.adobeAgreementId}: ${agreementError.message}`);
      
      if (agreementError.response) {
        logger.warn(`Adobe Sign API Status: ${agreementError.response.status}`);
        logger.warn(`Adobe Sign API Response: ${JSON.stringify(agreementError.response.data)}`);
        
        if (agreementError.response.status === 404) {
          logger.warn('Adobe Sign agreement not found (404) - will use local recipient data only');
          useLocalDataOnly = true;
        } else if (agreementError.response.status === 403) {
          logger.warn('Adobe Sign agreement access forbidden (403) - will use local recipient data only');
          useLocalDataOnly = true;
        } else {
          // For other API errors, still try to use local data but log the error
          logger.error(`Adobe Sign API error (${agreementError.response.status}): ${JSON.stringify(agreementError.response.data)}`);
          logger.warn('Will fallback to local recipient data due to Adobe Sign API error');
          useLocalDataOnly = true;
        }
      } else {
        // Network or other non-HTTP errors
        logger.error(`Adobe Sign network/connection error: ${agreementError.message}`);
        logger.warn('Will fallback to local recipient data due to connection error');
        useLocalDataOnly = true;
      }
    }

    // Find recipients who haven't signed yet
    const pendingRecipients = [];
      
      if (useLocalDataOnly) {
        logger.info('Using local recipient data only due to Adobe Sign agreement not found');
        
        // Use only local document recipient data
        document.recipients.forEach(recipient => {
          if (!recipient.signedAt && recipient.status !== 'signed') {
            pendingRecipients.push({
              email: recipient.email,
              name: recipient.name || recipient.email,
              status: recipient.status,
              localStatus: recipient.status,
              source: 'local_only'
            });
          }
        });
        
        if (pendingRecipients.length === 0) {
          return res.status(200).json(formatResponse(
            200,
            'No pending recipients found based on local data - all appear to have signed',
            { 
              document,
              pendingRecipients: [],
              source: 'local_data_only'
            }
          ));
        }
        
        logger.info(`Found ${pendingRecipients.length} pending recipients based on local data`);
        
      } else {
        // Use Adobe Sign data (original logic)
        
        // First, check overall agreement status - if it's completed, no one is pending
        if (agreementData.status === 'SIGNED') {
          return res.status(200).json(formatResponse(
            200,
            'No pending recipients found - agreement is fully signed',
            { 
              document,
              pendingRecipients: [],
              agreementStatus: agreementData.status
            }
          ));
        }
      
      // For active agreements, check each recipient's status
      if (agreementData.participantSetsInfo && agreementData.participantSetsInfo.length > 0) {
        // Check if this is a sequential signing flow
        const isSequentialFlow = document.signingFlow === 'SEQUENTIAL' || 
                                 agreementData.participantSetsInfo.length > 1;
        
        if (isSequentialFlow) {
          logger.info('Processing sequential signing flow - checking for next signer');
          
          // Get enhanced signature detection data
          let formFieldData = null;
          let agreementEvents = null;
          
          try {
            const formFieldResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/formData`);
            formFieldData = formFieldResponse.data;
            logger.info(`Retrieved form field data for enhanced signature detection`);
          } catch (formFieldError) {
            logger.warn(`Could not retrieve form field data for signature detection: ${formFieldError.message}`);
          }
          
          try {
            const eventsResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/events`);
            agreementEvents = eventsResponse.data;
            logger.info(`Retrieved agreement events for enhanced signature detection`);
          } catch (eventsError) {
            logger.warn(`Could not retrieve agreement events for signature detection: ${eventsError.message}`);
          }
          
          // In sequential flow, find the first participant set that hasn't been completed
          for (const participantSet of agreementData.participantSetsInfo) {
            const hasUnsignedMember = participantSet.memberInfos.some(member => {
              const localRecipient = document.recipients.find(r => r.email === member.email);
              
              // Enhanced signature detection using multiple data sources
              let hasActuallySigned = false;
              
              // Method 1: Check form field data for actual signatures
              if (formFieldData && Array.isArray(formFieldData)) {
                const recipientSignatures = formFieldData.filter(field => 
                  field.fieldType === 'SIGNATURE' && 
                  field.value && 
                  field.value.trim() !== '' &&
                  (field.assignedToRecipient === member.email || 
                   field.name.includes(`signer${participantSet.order}`) ||
                   field.participantId === member.id)
                );
                
                if (recipientSignatures.length > 0) {
                  hasActuallySigned = true;
                  logger.info(`🔍 Recipient ${member.email} has actual signature in form field data (sequential flow)`);
                }
              } else if (formFieldData && formFieldData.fields && Array.isArray(formFieldData.fields)) {
                // Handle different API response format
                const recipientSignatures = formFieldData.fields.filter(field => 
                  field.fieldType === 'SIGNATURE' && 
                  field.value && 
                  field.value.trim() !== '' &&
                  (field.assignedToRecipient === member.email || 
                   field.name.includes(`signer${participantSet.order}`) ||
                   field.participantId === member.id)
                );
                
                if (recipientSignatures.length > 0) {
                  hasActuallySigned = true;
                  logger.info(`🔍 Recipient ${member.email} has actual signature in form field data (sequential flow - fields format)`);
                }
              } else if (formFieldData) {
                // Log the structure for debugging
                logger.info(`Sequential flow - Form field data structure: ${JSON.stringify(Object.keys(formFieldData), null, 2)}`);
              }
              
              // Method 2: Check agreement events for ESIGNED events
              if (agreementEvents && agreementEvents.events) {
                const signatureEvents = agreementEvents.events.filter(event => 
                  event.type === 'ESIGNED' && 
                  event.participantEmail === member.email
                );
                
                if (signatureEvents.length > 0) {
                  hasActuallySigned = true;
                }
              }
              
              // Method 3: Check local timestamp (most reliable)
              if (localRecipient && localRecipient.signedAt) {
                hasActuallySigned = true;
              }
              
              // Method 4: Check local status (backup)
              if (localRecipient && localRecipient.status === 'signed') {
                hasActuallySigned = true;
              }
              
              // Return true if they haven't signed (participant set needs attention)
              return !hasActuallySigned;
            });
            
            if (hasUnsignedMember) {
              // Add all unsigned members from this participant set
              participantSet.memberInfos.forEach(member => {
                const localRecipient = document.recipients.find(r => r.email === member.email);
                
                // Enhanced signature detection using multiple data sources
                let hasActuallySigned = false;
                
                // Method 1: Check form field data for actual signatures
                if (formFieldData && Array.isArray(formFieldData)) {
                  const recipientSignatures = formFieldData.filter(field => 
                    field.fieldType === 'SIGNATURE' && 
                    field.value && 
                    field.value.trim() !== '' &&
                    (field.assignedToRecipient === member.email || 
                     field.name.includes(`signer${participantSet.order}`) ||
                     field.participantId === member.id)
                  );
                  
                  if (recipientSignatures.length > 0) {
                    hasActuallySigned = true;
                    logger.info(`🔍 Sequential: ${member.email} has actual signature in form field data`);
                  }
                } else if (formFieldData && formFieldData.fields && Array.isArray(formFieldData.fields)) {
                  // Handle different API response format
                  const recipientSignatures = formFieldData.fields.filter(field => 
                    field.fieldType === 'SIGNATURE' && 
                    field.value && 
                    field.value.trim() !== '' &&
                    (field.assignedToRecipient === member.email || 
                     field.name.includes(`signer${participantSet.order}`) ||
                     field.participantId === member.id)
                  );
                  
                  if (recipientSignatures.length > 0) {
                    hasActuallySigned = true;
                    logger.info(`🔍 Sequential: ${member.email} has actual signature in form field data (fields format)`);
                  }
                } else if (formFieldData) {
                  // Log the structure for debugging
                  logger.info(`Sequential - Form field data structure: ${JSON.stringify(Object.keys(formFieldData), null, 2)}`);
                }
                
                // Method 2: Check agreement events for ESIGNED events
                if (agreementEvents && agreementEvents.events) {
                  const signatureEvents = agreementEvents.events.filter(event => 
                    event.type === 'ESIGNED' && 
                    event.participantEmail === member.email
                  );
                  
                  if (signatureEvents.length > 0) {
                    hasActuallySigned = true;
                    logger.info(`🔍 Sequential: ${member.email} has ESIGNED event in agreement events`);
                  }
                }
                
                // Method 3: Check local timestamp (most reliable)
                if (localRecipient && localRecipient.signedAt) {
                  hasActuallySigned = true;
                  logger.info(`🔍 Sequential: ${member.email} has local signedAt timestamp - most reliable indicator`);
                }
                
                // Method 4: Check local status (backup)
                if (localRecipient && localRecipient.status === 'signed') {
                  hasActuallySigned = true;
                  logger.info(`🔍 Sequential: ${member.email} has local status as signed`);
                }
                
                // Final determination: Only include if they definitely haven't signed
                if (!hasActuallySigned) {
                  logger.info(`📧 Sequential: Adding ${member.email} to pending recipients - no signature evidence found`);
                  logger.info(`   Adobe Status: ${member.status}`);
                  logger.info(`   Local Status: ${localRecipient?.status || 'none'}`);
                  logger.info(`   Local SignedAt: ${localRecipient?.signedAt || 'none'}`);
                  
                  pendingRecipients.push({
                    email: member.email,
                    name: member.name || member.email,
                    status: member.status,
                    localStatus: localRecipient ? localRecipient.status : 'unknown',
                    participantSetOrder: participantSet.order,
                    signatureDetectionMethod: 'enhanced'
                  });
                } else {
                  logger.info(`⏭️  Sequential: Skipping ${member.email} - signature evidence found, not pending`);
                }
              });
              break; // Stop at first incomplete participant set in sequential flow
            }
          }
        } else {
          // Parallel flow - check all participants
          logger.info('Processing parallel signing flow - checking all participants');
          
          // Get enhanced signature detection data
          let formFieldData = null;
          let agreementEvents = null;
          
          try {
            const formFieldResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/formData`);
            formFieldData = formFieldResponse.data;
            logger.info(`Retrieved form field data for enhanced signature detection`);
          } catch (formFieldError) {
            logger.warn(`Could not retrieve form field data for signature detection: ${formFieldError.message}`);
          }
          
          try {
            const eventsResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/events`);
            agreementEvents = eventsResponse.data;
            logger.info(`Retrieved agreement events for enhanced signature detection`);
          } catch (eventsError) {
            logger.warn(`Could not retrieve agreement events for signature detection: ${eventsError.message}`);
          }
          
          agreementData.participantSetsInfo.forEach(participantSet => {
            participantSet.memberInfos.forEach(member => {
              const localRecipient = document.recipients.find(r => r.email === member.email);
              
              // Enhanced signature detection using multiple data sources
              let hasActuallySigned = false;
              
              // Method 1: Check form field data for actual signatures
              if (formFieldData && Array.isArray(formFieldData)) {
                const recipientSignatures = formFieldData.filter(field => 
                  field.fieldType === 'SIGNATURE' && 
                  field.value && 
                  field.value.trim() !== '' &&
                  (field.assignedToRecipient === member.email || 
                   field.name.includes(`signer${participantSet.order}`) ||
                   field.participantId === member.id)
                );
                
                if (recipientSignatures.length > 0) {
                  hasActuallySigned = true;
                  logger.info(`🔍 Recipient ${member.email} has actual signature in form field data`);
                }
              } else if (formFieldData && formFieldData.fields && Array.isArray(formFieldData.fields)) {
                // Handle different API response format
                const recipientSignatures = formFieldData.fields.filter(field => 
                  field.fieldType === 'SIGNATURE' && 
                  field.value && 
                  field.value.trim() !== '' &&
                  (field.assignedToRecipient === member.email || 
                   field.name.includes(`signer${participantSet.order}`) ||
                   field.participantId === member.id)
                );
                
                if (recipientSignatures.length > 0) {
                  hasActuallySigned = true;
                  logger.info(`🔍 Recipient ${member.email} has actual signature in form field data (fields format)`);
                }
              } else if (formFieldData) {
                // Log the structure for debugging
                logger.info(`Form field data structure: ${JSON.stringify(Object.keys(formFieldData), null, 2)}`);
              }
              
              // Method 2: Check agreement events for ESIGNED events
              if (agreementEvents && agreementEvents.events) {
                const signatureEvents = agreementEvents.events.filter(event => 
                  event.type === 'ESIGNED' && 
                  event.participantEmail === member.email
                );
                
                if (signatureEvents.length > 0) {
                  hasActuallySigned = true;
                  logger.info(`🔍 Recipient ${member.email} has ESIGNED event in agreement events`);
                }
              }
              
              // Method 3: Check local timestamp (most reliable)
              if (localRecipient && localRecipient.signedAt) {
                hasActuallySigned = true;
                logger.info(`🔍 Recipient ${member.email} has local signedAt timestamp - most reliable indicator`);
              }
              
              // Method 4: Check local status (backup)
              if (localRecipient && localRecipient.status === 'signed') {
                hasActuallySigned = true;
                logger.info(`🔍 Recipient ${member.email} has local status as signed`);
              }
              
              // Final determination: Only include if they definitely haven't signed
              if (!hasActuallySigned) {
                logger.info(`📧 Adding ${member.email} to pending recipients - no signature evidence found`);
                logger.info(`   Adobe Status: ${member.status}`);
                logger.info(`   Local Status: ${localRecipient?.status || 'none'}`);
                logger.info(`   Local SignedAt: ${localRecipient?.signedAt || 'none'}`);
                
                pendingRecipients.push({
                  email: member.email,
                  name: member.name || member.email,
                  status: member.status,
                  localStatus: localRecipient ? localRecipient.status : 'unknown',
                  participantSetOrder: participantSet.order,
                  signatureDetectionMethod: 'enhanced'
                });
              } else {
                logger.info(`⏭️  Skipping ${member.email} - signature evidence found, not pending`);
              }
            });
          });
        }
      } else {
        // Fallback: If no participantSetsInfo, check our local recipients
        logger.warn('No participantSetsInfo in Adobe Sign response, checking local recipients');
        document.recipients.forEach(recipient => {
          if (!recipient.signedAt && recipient.status !== 'signed') {
            pendingRecipients.push({
              email: recipient.email,
              name: recipient.name,
              status: recipient.status,
              localStatus: recipient.status
            });
          }
        });
      }
      
        // Additional check: make sure we include any recipients who are locally marked as not signed
        // but might not appear in the Adobe Sign data
        document.recipients.forEach(localRecipient => {
          if (!localRecipient.signedAt && localRecipient.status !== 'signed') {
            const alreadyPending = pendingRecipients.find(p => p.email === localRecipient.email);
            if (!alreadyPending) {
              logger.info(`Adding locally unsigned recipient ${localRecipient.email} to pending list`);
              pendingRecipients.push({
                email: localRecipient.email,
                name: localRecipient.name,
                status: 'locally_pending',
                localStatus: localRecipient.status
              });
            }
          }
        });

        if (pendingRecipients.length === 0) {
          return res.status(200).json(formatResponse(
            200,
            'No pending recipients found - all have already signed or taken action',
            { 
              document,
              pendingRecipients: [],
              agreementStatus: agreementData.status
            }
          ));
        }
      }

      // Send reminder using Adobe Sign API (only if we have valid agreement data)
      if (!useLocalDataOnly && document.adobeAgreementId) {
        try {
          logger.info(`Attempting to send Adobe Sign reminder for agreement: ${document.adobeAgreementId}`);
          
          // Try different Adobe Sign reminder approaches
          let reminderSent = false;
          
          // Approach 1: Standard reminder endpoint (PUT)
          try {
            const reminderPayload = {
              agreementId: document.adobeAgreementId,
              comment: req.body.message || 'Please complete your signature for this important document. Your prompt attention is appreciated.'
            };
            
            await adobeSignClient.put(`api/rest/v6/agreements/${document.adobeAgreementId}/reminders`, reminderPayload);
            logger.info(`✅ Adobe Sign reminder sent successfully (PUT method) for agreement ${document.adobeAgreementId}`);
            reminderSent = true;
            
          } catch (putError) {
            logger.warn(`PUT reminder failed: ${putError.message}`);
            
            // Approach 2: Try POST method
            try {
              const reminderPayload = {
                agreementId: document.adobeAgreementId,
                comment: req.body.message || 'Please complete your signature for this important document. Your prompt attention is appreciated.'
              };
              
              await adobeSignClient.post(`api/rest/v6/agreements/${document.adobeAgreementId}/reminders`, reminderPayload);
              logger.info(`✅ Adobe Sign reminder sent successfully (POST method) for agreement ${document.adobeAgreementId}`);
              reminderSent = true;
              
            } catch (postError) {
              logger.warn(`POST reminder failed: ${postError.message}`);
              
              // Approach 3: Try participant-specific reminders
              if (agreementData && agreementData.participantSetsInfo) {
                logger.info('Trying participant-specific reminders...');
                
                for (const participantSet of agreementData.participantSetsInfo) {
                  for (const member of participantSet.memberInfos) {
                    if (member.status !== 'SIGNED') {
                      try {
                        const participantPayload = {
                          participantEmail: member.email,
                          note: req.body.message || 'Please complete your signature for this important document.'
                        };
                        
                        await adobeSignClient.post(`api/rest/v6/agreements/${document.adobeAgreementId}/members/remind`, participantPayload);
                        logger.info(`✅ Participant reminder sent to ${member.email}`);
                        reminderSent = true;
                        
                      } catch (participantError) {
                        logger.warn(`Failed to send participant reminder to ${member.email}: ${participantError.message}`);
                      }
                    }
                  }
                }
              }
            }
          }
          
          if (!reminderSent) {
            logger.warn('All Adobe Sign reminder methods failed - continuing with local processing');
          }
          
        } catch (adobeReminderError) {
          logger.warn(`⚠️ Adobe Sign reminder API failed: ${adobeReminderError.message}`);
          
          if (adobeReminderError.response) {
            logger.warn(`Adobe Sign reminder error status: ${adobeReminderError.response.status}`);
            logger.warn(`Adobe Sign reminder error data: ${JSON.stringify(adobeReminderError.response.data)}`);
            
            // Common Adobe Sign reminder API errors
            if (adobeReminderError.response.status === 404) {
              logger.warn('Adobe Sign reminder endpoint not found (404) - agreement may not support reminders or endpoint may have changed');
            } else if (adobeReminderError.response.status === 400) {
              logger.warn('Adobe Sign reminder bad request (400) - agreement may not be in a state that allows reminders');
            } else if (adobeReminderError.response.status === 403) {
              logger.warn('Adobe Sign reminder forbidden (403) - insufficient permissions or agreement access issue');
            }
          }
          
          // Continue with local reminder processing even if Adobe Sign reminder fails
          logger.info('Continuing with local reminder processing despite Adobe Sign API failure');
        }
      } else {
        logger.info('Skipping Adobe Sign reminder due to agreement not found - will rely on local notification if implemented');
      }

      // Update document recipients status and last reminder date
      document.recipients.forEach(recipient => {
        const pendingRecipient = pendingRecipients.find(pr => pr.email === recipient.email);
        if (pendingRecipient) {
          recipient.lastReminderSent = new Date();
        }
      });

      // Update document metadata
      document.lastReminderSent = new Date();
      await document.save();

      // Send email notifications to unsigned recipients
      let emailResults = [];
      if (pendingRecipients.length > 0) {
        try {
          logger.info(`📧 Sending email reminders to ${pendingRecipients.length} unsigned recipients`);
          
          // Get signing URLs for recipients if possible
          const recipientsWithUrls = await Promise.all(pendingRecipients.map(async (recipient) => {
            try {
              // Try to get signing URL for this recipient
              if (!useLocalDataOnly && document.adobeAgreementId) {
                const adobeSignClient = await createAdobeSignClient();
                const signingUrlResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/signingUrls`);
                const signingUrls = signingUrlResponse.data.signingUrlSetInfos;
                
                // Find URL for this recipient
                let recipientSigningUrl = null;
                for (const urlSet of signingUrls) {
                  for (const urlInfo of urlSet.signingUrls) {
                    if (urlInfo.email && urlInfo.email.toLowerCase() === recipient.email.toLowerCase()) {
                      recipientSigningUrl = urlInfo.esignUrl;
                      break;
                    }
                  }
                  if (recipientSigningUrl) break;
                }
                
                return {
                  ...recipient,
                  signingUrl: recipientSigningUrl
                };
              }
              
              return recipient;
            } catch (urlError) {
              logger.warn(`Could not get signing URL for ${recipient.email}: ${urlError.message}`);
              return recipient;
            }
          }));

          // Send email reminders
          emailResults = await emailService.sendReminderEmails(
            recipientsWithUrls,
            document.originalName,
            req.body.message
          );

          const successfulEmails = emailResults.filter(result => result.success).length;
          if (successfulEmails > 0) {
            logger.info(`✅ Email reminders sent successfully to ${successfulEmails}/${pendingRecipients.length} recipients`);
          } else if (emailResults.length > 0 && emailResults[0].fallback) {
            logger.info(`ℹ️  Email service not configured - relying on Adobe Sign API reminders`);
          }

        } catch (emailError) {
          logger.error(`Failed to send email reminders: ${emailError.message}`);
          emailResults = pendingRecipients.map(recipient => ({
            success: false,
            error: emailError.message,
            recipient: recipient.email
          }));
        }
      }

      // Log reminder sent
      await Log.create({
        level: 'info',
        message: `Reminder sent for document: ${document.originalName} to ${pendingRecipients.length} recipients`,
        
        documentId: document._id,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
        requestMethod: req.method,
        metadata: {
          adobeAgreementId: document.adobeAgreementId,
          pendingRecipients: pendingRecipients.map(r => r.email),
          reminderMessage: req.body.message,
          emailResults: emailResults.map(r => ({
            recipient: r.recipient,
            success: r.success,
            error: r.error || null
          }))
        }
      });

      logger.info(`Reminder sent for document: ${document.originalName}  to ${pendingRecipients.length} recipients`);

      // Prepare response data
      const responseData = { 
        document,
        pendingRecipients,
        reminderSent: true,
        sentAt: new Date(),
        emailNotifications: {
          total: emailResults.length,
          successful: emailResults.filter(r => r.success).length,
          failed: emailResults.filter(r => !r.success).length,
          details: emailResults
        }
      };

      // Add preview URLs for development
      if (process.env.NODE_ENV === 'development') {
        const previewUrls = emailResults
          .filter(r => r.success && r.previewUrl)
          .map(r => ({ recipient: r.recipient, previewUrl: r.previewUrl }));
        
        if (previewUrls.length > 0) {
          responseData.emailPreviews = previewUrls;
        }
      }

      res.status(200).json(formatResponse(
        200,
        `Reminder sent successfully to ${pendingRecipients.length} pending recipient(s)`,
        responseData
      ));

  } catch (error) {
    logger.error(`Unexpected error in sendReminder: ${error.message}`);
    next(error);
  }
};

/**
 * Get signing URL for embedding in iframe or direct access
 * @route GET /api/documents/:id/signing-url
 */
exports.getSigningUrl = async (req, res, next) => {
  try {
    const { recipientEmail } = req.query;

    if (!recipientEmail) {
      return next(new ApiError(400, 'recipientEmail query parameter is required'));
    }

    const document = await Document.findOne({
      _id: req.params.id
    });

    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }

    if (!document.adobeAgreementId) {
      return next(new ApiError(400, 'Document has not been sent for signature yet'));
    }

    // Verify the recipient email is valid for this document
    const isValidRecipient = document.recipients.some(recipient => recipient.email === recipientEmail);
    if (!isValidRecipient) {
      return next(new ApiError(400, 'Invalid recipient email for this document'));
    }

    try {
      // Get Adobe Sign client
      const adobeSignClient = await createAdobeSignClient();

      // Get signing URLs for the agreement
      const signingUrlResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/signingUrls`);
      const signingUrls = signingUrlResponse.data.signingUrlSetInfos;      // Find the signing URL for the specific recipient
      let recipientSigningUrl = null;
      let recipientInfo = null;
      
      for (const urlSet of signingUrls) {
        for (const urlInfo of urlSet.signingUrls) {
          if (urlInfo.email && urlInfo.email.toLowerCase() === recipientEmail.toLowerCase()) {
            recipientSigningUrl = urlInfo.esignUrl;
            recipientInfo = {
              email: urlInfo.email,
              status: urlSet.status,
              urlValidation: urlInfo.urlValidation
            };
            break;
          }
        }
        if (recipientSigningUrl) break;
      }

      // Check if recipient has signed (even if no URL found)
      const localRecipient = document.recipients.find(r => r.email.toLowerCase() === recipientEmail.toLowerCase());
      
      // Get agreement details for additional context
      const agreementResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}`);
      const agreementData = agreementResponse.data;
      
      // Check Adobe Sign data for this recipient
      let adobeSignStatus = null;
      if (agreementData.participantSetsInfo) {
        agreementData.participantSetsInfo.forEach(participantSet => {
          participantSet.memberInfos.forEach(member => {
            if (member.email && member.email.toLowerCase() === recipientEmail.toLowerCase()) {
              adobeSignStatus = member.status;
            }
          });
        });
      }

      // If no signing URL found, provide status information anyway
      if (!recipientSigningUrl) {
        // Check if they've already signed
        if (localRecipient && localRecipient.signedAt) {
          recipientInfo = {
            email: recipientEmail,
            status: 'SIGNED',
            hasAlreadySigned: true,
            signedAt: localRecipient.signedAt,
            localStatus: localRecipient.status,
            adobeStatus: adobeSignStatus
          };
        } else if (adobeSignStatus === 'SIGNED') {
          recipientInfo = {
            email: recipientEmail,
            status: 'SIGNED',
            hasAlreadySigned: true,
            adobeStatus: adobeSignStatus
          };
        } else {
          // Recipient not found or no URL available
          return next(new ApiError(404, `Signing URL not found for recipient ${recipientEmail}. They may have already signed or the document may not be in a signing state.`));
        }
      }

      // Update recipient information
      if (localRecipient) {
        localRecipient.lastSigningUrlAccessed = new Date();
      }
      await document.save();

      // Log signing URL access
      await Log.create({
        level: 'info',
        message: `Signing URL requested for document: ${document.originalName}`,
        
        documentId: document._id,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
        requestMethod: req.method,
        metadata: {
          adobeAgreementId: document.adobeAgreementId,
          recipientEmail,
          agreementStatus: agreementData.status
        }
      });

      logger.info(`Signing URL requested for document: ${document.originalName}  for recipient ${recipientEmail}`);

      res.status(200).json(formatResponse(
        200,
        'Signing URL retrieved successfully',
        { 
          signingUrl: recipientSigningUrl,
          recipient: recipientInfo,
          document: {
            id: document._id,
            name: document.originalName,
            status: document.status
          },
          agreement: {
            id: document.adobeAgreementId,
            status: agreementData.status,
            name: agreementData.name
          },
          embedding: {
            canEmbed: true,
            iframeCompatible: true,
            notes: 'This URL can be embedded in an iframe for seamless user experience'
          },
          urlBehavior: {
            changesAfterSigning: true,
            description: 'The signing URL may change or become invalid after the recipient signs, especially in multi-recipient workflows',
            recommendation: 'Refresh the signing URL before each use for multi-recipient documents'
          }
        }
      ));

    } catch (adobeError) {
      logger.error(`Adobe Sign API Error getting signing URL: ${adobeError.message}`);
      
      let errorMessage = 'Failed to get signing URL';
      if (adobeError.response) {
        logger.error(`Status: ${adobeError.response.status}, Data: ${JSON.stringify(adobeError.response.data)}`);
        
        // Handle specific Adobe Sign errors
        if (adobeError.response.status === 404) {
          errorMessage = 'Agreement or signing URL not found in Adobe Sign';
        } else if (adobeError.response.status === 400) {
          errorMessage = 'Invalid request - document may not be in signing state';
        }
      }
      
      return next(new ApiError(500, errorMessage));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Get signing URLs for all recipients of a document
 * @route GET /api/documents/:id/signing-urls
 */
exports.getAllSigningUrls = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id
    });

    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }

    if (!document.adobeAgreementId) {
      return next(new ApiError(400, 'Document has not been sent for signature yet'));
    }

    if (!document.recipients || document.recipients.length === 0) {
      return next(new ApiError(400, 'Document has no recipients'));
    }

    try {
      // Get Adobe Sign client
      const adobeSignClient = await createAdobeSignClient();

      // Get signing URLs for the agreement
      const signingUrlResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/signingUrls`);
      const signingUrls = signingUrlResponse.data.signingUrlSetInfos;

      // Get agreement details for additional context
      const agreementResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}`);
      const agreementData = agreementResponse.data;

      // Map signing URLs to recipients
      const recipientSigningUrls = [];

      document.recipients.forEach(recipient => {
        let recipientSigningUrl = null;
        let recipientStatus = 'unknown';

        // Find the signing URL for this recipient (if available)
        for (const urlSet of signingUrls) {
          for (const urlInfo of urlSet.signingUrls) {
            if (urlInfo.email && urlInfo.email.toLowerCase() === recipient.email.toLowerCase()) {
              recipientSigningUrl = urlInfo.esignUrl;
              recipientStatus = urlSet.status;
              break;
            }
          }
          if (recipientSigningUrl) break;
        }

        // Get additional recipient status from agreement data
        let detailedStatus = recipientStatus;
        if (agreementData.participantSetsInfo) {
          agreementData.participantSetsInfo.forEach(participantSet => {
            participantSet.memberInfos.forEach(member => {
              if (member.email && member.email.toLowerCase() === recipient.email.toLowerCase()) {
                detailedStatus = member.status;
              }
            });
          });
        }

        // Use our local status if it's more accurate (especially for signed recipients)
        let finalStatus = detailedStatus;
        if (recipient.status === 'signed' && recipient.signedAt) {
          finalStatus = 'SIGNED';
        } else if (recipient.status === 'declined') {
          finalStatus = 'DECLINED';
        } else if (recipient.status === 'expired') {
          finalStatus = 'EXPIRED';
        }

        // Determine if they can sign based on status and URL availability
        let canSign = false;
        if (recipientSigningUrl && !['SIGNED', 'DECLINED', 'EXPIRED'].includes(finalStatus)) {
          canSign = true;
        }

        recipientSigningUrls.push({
          recipient: {
            name: recipient.name,
            email: recipient.email,
            signatureField: recipient.signatureField,
            order: recipient.order
          },
          signingUrl: recipientSigningUrl, // Will be null if they've signed or URL not available
          status: finalStatus,
          canSign: canSign,
          lastAccessed: recipient.lastSigningUrlAccessed || null,
          signedAt: recipient.signedAt || null, // Include signed timestamp
          localStatus: recipient.status // Include our local status for debugging
        });
      });

      // Update last access time for all recipients
      document.recipients.forEach(recipient => {
        recipient.lastSigningUrlAccessed = new Date();
      });
      await document.save();

      // Log bulk signing URL access
      await Log.create({
        level: 'info',
        message: `All signing URLs requested for document: ${document.originalName}`,
        
        documentId: document._id,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
        requestMethod: req.method,
        metadata: {
          adobeAgreementId: document.adobeAgreementId,
          recipientCount: document.recipients.length,
          agreementStatus: agreementData.status
        }
      });

      logger.info(`All signing URLs requested for document: ${document.originalName} `);

      res.status(200).json(formatResponse(
        200,
        'Signing URLs retrieved successfully for all recipients',
        { 
          document: {
            id: document._id,
            name: document.originalName,
            status: document.status
          },
          agreement: {
            id: document.adobeAgreementId,
            status: agreementData.status,
            name: agreementData.name
          },
          recipients: recipientSigningUrls,
          embedding: {
            canEmbed: true,
            iframeCompatible: true,
            notes: 'These URLs can be embedded in iframes for seamless user experience'
          },
          urlBehavior: {
            changesAfterSigning: true,
            description: 'Signing URLs may change or become invalid after recipients sign, especially in multi-recipient workflows',
            recommendation: 'Refresh signing URLs before each use for multi-recipient documents'
          },
          totalRecipients: document.recipients.length,
          activeUrls: recipientSigningUrls.filter(r => r.canSign).length
        }
      ));

    } catch (adobeError) {
      logger.error(`Adobe Sign API Error getting all signing URLs: ${adobeError.message}`);
      
      let errorMessage = 'Failed to get signing URLs';
      if (adobeError.response) {
        logger.error(`Status: ${adobeError.response.status}, Data: ${JSON.stringify(adobeError.response.data)}`);
        
        // Handle specific Adobe Sign errors
        if (adobeError.response.status === 404) {
          errorMessage = 'Agreement or signing URLs not found in Adobe Sign';
        } else if (adobeError.response.status === 400) {
          errorMessage = 'Invalid request - document may not be in signing state';
        }
      }
      
      return next(new ApiError(500, errorMessage));
    }
  } catch (error) {
    next(error);
  }
};
