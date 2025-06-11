const Document = require('../models/document.model');
const Log = require('../models/log.model');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');
const documentUtils = require('../utils/documentUtils');
const documentProcessor = require('../utils/documentProcessor');
const { createAdobeSignClient, getAccessToken, uploadTransientDocument } = require('../config/adobeSign');
const fs = require('fs');
const path = require('path');
const { createAgreementWithBestApproach } = require('../utils/adobeSignFormFields');

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
      status: 'uploaded',
      creator: req.user._id
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
        // Analyze document for template variables and signature fields
        const analysis = await documentProcessor.analyzeDocumentForSignatureFields(filePath);
        
        documentData.templateVariables = analysis.templateVariables;
        documentData.documentAnalysis = analysis;
        documentData.autoDetectedSignatureFields = analysis.signatureFields.map(field => {
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
        
        // Convert to PDF for Adobe Sign
        finalPdfPath = await documentProcessor.convertDocxToPdf(filePath);
        documentData.pdfFilePath = finalPdfPath;
        
        // Analyze the converted PDF
        const pdfInfo = await documentUtils.analyzePdf(finalPdfPath);
        pageCount = pdfInfo.pageCount;
        
        logger.info(`Document processed successfully. Found ${analysis.templateVariables.length} template variables`);
      } catch (processingError) {
        logger.error(`Error processing document: ${processingError.message}`);
        
        // Provide specific guidance for template errors
        if (processingError.message.includes('Template format error') || 
            processingError.message.includes('duplicate') ||
            processingError.message.includes('Duplicate') ||
            processingError.message.includes('Multi error')) {
          return next(new ApiError(400, `Template Error: ${processingError.message}. Please ensure your DOCX template uses single curly braces {variableName} and that template variables are not split across lines or formatting in your Word document. Try recreating the template with simpler formatting.`));
        }
        
        return next(new ApiError(500, `Error processing document: ${processingError.message}`));
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
      userId: req.user._id,
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
    
    logger.info(`Document uploaded: ${originalname} by user ${req.user.email}`);
    
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
      creator: req.user._id,
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
        documentData.autoDetectedSignatureFields = analysis.signatureFields.map(field => {
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
          processedFilePath = await documentProcessor.processDocumentTemplate(filePath, templateData);
          documentData.processedFilePath = processedFilePath;
          
          // Convert processed document to PDF
          finalPdfPath = await documentProcessor.convertDocxToPdf(processedFilePath);
        } else {
          // Convert original document to PDF
          finalPdfPath = await documentProcessor.convertDocxToPdf(filePath);
        }
        
        documentData.pdfFilePath = finalPdfPath;
        documentData.templateVariables = analysis.templateVariables;
        documentData.documentAnalysis = analysis;
        documentData.autoDetectedSignatureFields = analysis.signatureFields.map(field => {
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
        
        // Analyze the converted PDF
        const pdfInfo = await documentUtils.analyzePdf(finalPdfPath);
        pageCount = pdfInfo.pageCount;
        
        logger.info(`Document processed successfully. Found ${analysis.templateVariables.length} template variables`);
      } catch (processingError) {
        logger.error(`Error processing document: ${processingError.message}`);
        
        // Provide specific guidance for template errors
        if (processingError.message.includes('Template format error') || 
            processingError.message.includes('duplicate') ||
            processingError.message.includes('Duplicate') ||
            processingError.message.includes('Multi error')) {
          return next(new ApiError(400, `Template Error: ${processingError.message}. Please ensure your DOCX template uses single curly braces {variableName} and that template variables are not split across lines or formatting in your Word document. Try recreating the template with simpler formatting.`));
        }
        
        return next(new ApiError(500, `Error processing document: ${processingError.message}`));
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
      userId: req.user._id,
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
        hasProcessedFile: !!processedFilePath
      }
    });
    
    logger.info(`Document uploaded with template data: ${originalname} by user ${req.user.email}`);
    
    res.status(201).json(formatResponse(
      201,
      'Document uploaded and processed successfully',
      { 
        document,
        templateVariables: documentData.templateVariables || [],
        templateDataApplied: Object.keys(templateData),
        autoDetectedSignatureFields: documentData.autoDetectedSignatureFields || [],
        processedWithTemplateData: Object.keys(templateData).length > 0
      }
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
    let { recipients, useIntelligentPositioning = true, signatureFieldMapping } = req.body;
    
    const document = await Document.findOne({
      _id: req.params.id,
      creator: req.user._id
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
    
    // Update document with recipients, signature field mapping, and intelligent positioning flag
    document.recipients = formattedRecipients;
    document.status = 'ready_for_signature';
    document.useIntelligentPositioning = useIntelligentPositioning;
    document.signatureFieldMapping = signatureFieldMapping || {};
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
          useIntelligentPositioning: document.useIntelligentPositioning
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

/**
 * Send reminder email to recipients who haven't signed yet
 * @route POST /api/documents/:id/send-reminder
 */
exports.sendReminder = async (req, res, next) => {
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

    // Check if document is still in progress
    if (!['sent_for_signature', 'partially_signed'].includes(document.status)) {
      return next(new ApiError(400, 'Document is not in a state where reminders can be sent'));
    }

    try {
      // Get Adobe Sign client
      const adobeSignClient = await createAdobeSignClient();

      // Get agreement details to check current status
      const agreementResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}`);
      const agreementData = agreementResponse.data;

      // Find recipients who haven't signed yet
      const pendingRecipients = [];
      if (agreementData.participantSetsInfo) {
        agreementData.participantSetsInfo.forEach(participantSet => {
          participantSet.memberInfos.forEach(member => {
            if (member.status === 'NOT_YET_ACTED' || member.status === 'WAITING_FOR_OTHERS') {
              pendingRecipients.push({
                email: member.email,
                name: member.name || member.email,
                status: member.status
              });
            }
          });
        });
      }

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

      // Send reminder using Adobe Sign API
      const reminderPayload = {
        agreementId: document.adobeAgreementId,
        comment: req.body.message || 'Please complete your signature for this document.'
      };

      // Adobe Sign API endpoint for sending reminders
      await adobeSignClient.put(`api/rest/v6/agreements/${document.adobeAgreementId}/reminders`, reminderPayload);

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

      // Log reminder sent
      await Log.create({
        level: 'info',
        message: `Reminder sent for document: ${document.originalName} to ${pendingRecipients.length} recipients`,
        userId: req.user._id,
        documentId: document._id,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
        requestMethod: req.method,
        metadata: {
          adobeAgreementId: document.adobeAgreementId,
          pendingRecipients: pendingRecipients.map(r => r.email),
          reminderMessage: req.body.message
        }
      });

      logger.info(`Reminder sent for document: ${document.originalName} by user ${req.user.email} to ${pendingRecipients.length} recipients`);

      res.status(200).json(formatResponse(
        200,
        `Reminder sent successfully to ${pendingRecipients.length} pending recipient(s)`,
        { 
          document,
          pendingRecipients,
          reminderSent: true,
          sentAt: new Date()
        }
      ));

    } catch (adobeError) {
      logger.error(`Adobe Sign API Error sending reminder: ${adobeError.message}`);
      
      let errorMessage = 'Failed to send reminder';
      if (adobeError.response) {
        logger.error(`Status: ${adobeError.response.status}, Data: ${JSON.stringify(adobeError.response.data)}`);
        
        // Handle specific Adobe Sign errors
        if (adobeError.response.status === 404) {
          errorMessage = 'Agreement not found in Adobe Sign';
        } else if (adobeError.response.status === 400) {
          errorMessage = 'Invalid request to Adobe Sign - document may not be in a state that allows reminders';
        }
      }
      
      return next(new ApiError(500, errorMessage));
    }
  } catch (error) {
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
      _id: req.params.id,
      creator: req.user._id
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
      const signingUrls = signingUrlResponse.data.signingUrlSetInfos;

      // Find the signing URL for the specific recipient
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

      if (!recipientSigningUrl) {
        return next(new ApiError(404, 'Signing URL not found for the specified recipient'));
      }

      // Get agreement details for additional context
      const agreementResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}`);
      const agreementData = agreementResponse.data;

      // Update recipient information
      const recipient = document.recipients.find(r => r.email === recipientEmail);
      if (recipient) {
        recipient.lastSigningUrlAccessed = new Date();
      }
      await document.save();

      // Log signing URL access
      await Log.create({
        level: 'info',
        message: `Signing URL requested for document: ${document.originalName}`,
        userId: req.user._id,
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

      logger.info(`Signing URL requested for document: ${document.originalName} by user ${req.user.email} for recipient ${recipientEmail}`);

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
      _id: req.params.id,
      creator: req.user._id
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

        // Find the signing URL for this recipient
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

        recipientSigningUrls.push({
          recipient: {
            name: recipient.name,
            email: recipient.email,
            signatureField: recipient.signatureField,
            order: recipient.order
          },
          signingUrl: recipientSigningUrl,
          status: detailedStatus,
          canSign: recipientSigningUrl ? true : false,
          lastAccessed: recipient.lastSigningUrlAccessed || null
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
        userId: req.user._id,
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

      logger.info(`All signing URLs requested for document: ${document.originalName} by user ${req.user.email}`);

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
