const Document = require('../models/document.model');
const Log = require('../models/log.model');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');
const documentUtils = require('../utils/documentUtils');
const documentProcessor = require('../utils/documentProcessor');
const rateLimitProtection = require('../utils/rateLimitProtection');

// Import enhanced Adobe Sign client instead of regular client
const { 
  createAdobeSignClient: originalCreateAdobeSignClient, 
  getAccessToken, 
  uploadTransientDocument, 
  getAgreementInfo, 
  getComprehensiveAgreementInfo,
  getActualSigningStatus,
  sendReminder, 
  createWebhook, 
  getSigningUrl, 
  downloadSignedDocument 
} = require('../config/adobeSign');

// Import enhanced Adobe Sign client
const createEnhancedAdobeSignClient = require('../config/enhancedAdobeSignClient');

// Create wrapper function to always use the enhanced client
const createAdobeSignClient = async () => {
  try {
    return await createEnhancedAdobeSignClient();
  } catch (error) {
    logger.warn(`Error creating enhanced client, falling back to original: ${error.message}`);
    return await originalCreateAdobeSignClient();
  }
};
const fs = require('fs');
const path = require('path');
const mime = require('mime');
const { createAgreementWithBestApproach, verifyAdobeSignTextTags } = require('../utils/adobeSignFormFields');
const adobeSignTemplateHandler = require('../utils/adobeSignTemplateHandler');
const adobeSignTagHandler = require('../utils/adobeSignTagHandler');
const adobeSignBypass = require('../utils/adobeSignBypass');
const emailService = require('../services/emailService');
const urlUtils = require('../utils/urlUtils');
const { recoverDocument: recoverDocumentUtil } = require('../utils/documentRecovery');

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
 * Upload a document from a URL with optional JSON data for template processing
 * @route POST /api/documents/upload-from-url
 */
exports.uploadDocumentFromUrl = async (req, res, next) => {
  try {
    const { documentUrl } = req.body;
    
    if (!documentUrl) {
      return next(new ApiError(400, 'Document URL is required'));
    }
    
    // Download document from URL
    let documentFile;
    try {
      documentFile = await urlUtils.validateAndDownloadUrl(documentUrl);
    } catch (downloadError) {
      logger.error(`Error downloading document: ${downloadError.message}`);
      
      // Determine type of error for more specific error messages
      if (downloadError.message.includes('socket hang up') || 
          downloadError.message.includes('Socket error') || 
          downloadError.message.includes('ECONNRESET') || 
          downloadError.message.includes('No response received')) {
        return next(new ApiError(502, 'Connection to document server was lost. The server might have dropped the connection or had a network error. Please try again or use a different URL.'));
      } else if (downloadError.message.includes('ENOTFOUND')) {
        return next(new ApiError(400, 'Server not found. Please check the URL and your network connection.'));
      } else if (downloadError.message.includes('timed out') || downloadError.message.includes('timeout')) {
        return next(new ApiError(408, 'Request timed out while downloading the document. The server might be slow or the file might be too large. Try a more responsive server or upload the file directly.'));
      } else if (downloadError.message.includes('Invalid URL') || downloadError.message.includes('could not parse URL')) {
        return next(new ApiError(400, 'Invalid URL format. Please provide a valid HTTP or HTTPS URL.'));
      } else if (downloadError.message.includes('socket timeout')) {
        return next(new ApiError(504, 'Gateway timeout. The connection was idle for too long. Try again or use a different server.'));
      } else if (downloadError.message.includes('maxContentLength') || downloadError.message.includes('maxBodyLength')) {
        return next(new ApiError(413, 'Document is too large. Maximum file size is 25MB. Please upload a smaller document or use the direct upload method.'));
      }
      
      return next(new ApiError(500, `Error downloading document: ${downloadError.message}`));
    }
    
    // Initialize document data
    let documentData = {
      filename: documentFile.filename,
      originalName: documentFile.originalName,
      fileSize: documentFile.size,
      filePath: documentFile.path,
      mimeType: documentFile.mimetype,
      status: 'uploaded'
    };
    
    // Check if JSON files were uploaded
    let templateData = {};
    if (req.files && req.files.jsonData) {
      // Process and combine all JSON files
      try {
        templateData = await urlUtils.processJsonFiles(req.files.jsonData);
        documentData.hasTemplateData = true;
      } catch (jsonError) {
        logger.error(`Error processing JSON files: ${jsonError.message}`);
        return next(new ApiError(400, `Error processing JSON data: ${jsonError.message}`));
      }
    } else if (req.body.jsonData) {
      // If JSON data was provided in the request body as a string
      try {
        templateData = typeof req.body.jsonData === 'string' 
          ? JSON.parse(req.body.jsonData) 
          : req.body.jsonData;
        documentData.hasTemplateData = true;
      } catch (error) {
        logger.error(`Error parsing JSON data: ${error.message}`);
        return next(new ApiError(400, 'Invalid JSON data format'));
      }
    }
    
    // Check if it's a PDF or needs processing
    const fileExtension = path.extname(documentFile.originalName).toLowerCase();
    let finalPdfPath = documentFile.path;
    let pageCount = 0;
    
    logger.info(`Processing uploaded document: ${documentFile.originalName} (${fileExtension}) from URL: ${documentUrl}`);
    logger.info(`File mime type: ${documentFile.mimetype}, size: ${documentFile.size} bytes`);
    
    // Validate the file exists and is readable
    try {
      const fileStats = fs.statSync(documentFile.path);
      logger.info(`File stats: size=${fileStats.size}, isFile=${fileStats.isFile()}`);
      
      if (fileStats.size === 0) {
        logger.error('Downloaded file is empty (0 bytes)');
        return next(new ApiError(400, 'Downloaded file is empty. The URL may not point to a valid document or access might be restricted.'));
      }
      
      // Identify the actual file format using file signatures
      const formatInfo = await documentProcessor.identifyFileFormat(documentFile.path);
      logger.info(`File format detection: ${formatInfo.detected} (confidence: ${formatInfo.confidence})`);
      
      // If detected format is different from extension with high confidence, use the detected format
      if (formatInfo.confidence >= 0.8 && formatInfo.detected !== fileExtension) {
        logger.warn(`File extension mismatch: Extension is ${fileExtension} but detected format is ${formatInfo.detected}`);
        
        // Rename the file with the correct extension if needed
        if (['.docx', '.doc', '.pdf'].includes(formatInfo.detected)) {
          const newPath = documentFile.path + formatInfo.detected;
          fs.renameSync(documentFile.path, newPath);
          documentFile.path = newPath;
          documentFile.originalName = path.basename(documentFile.originalName, fileExtension) + formatInfo.detected;
          documentData.filename = path.basename(newPath);
          documentData.originalName = documentFile.originalName;
          documentData.filePath = newPath;
          
          logger.info(`Renamed file with correct extension: ${newPath}`);
        }
      }
    } catch (statError) {
      logger.error(`Error accessing downloaded file: ${statError.message}`);
      return next(new ApiError(500, `Error accessing downloaded file: ${statError.message}`));
    }
    
    // Get the possibly updated extension
    const updatedExtension = path.extname(documentFile.path).toLowerCase();
    
    // Handle file based on detected extension
    if (updatedExtension === '.pdf' || fileExtension === '.pdf') {
      // For PDFs, extract page count
      try {
        pageCount = await documentUtils.getPdfPageCount(documentFile.path);
        documentData.pageCount = pageCount;
        logger.info(`PDF page count: ${pageCount}`);
      } catch (error) {
        logger.error(`Error getting PDF page count: ${error.message}`);
        // Continue with pageCount=0 instead of failing the whole request
        pageCount = 0;
        documentData.pageCount = 0;
        documentData.pageCountError = error.message;
      }
    } else if (['.docx', '.doc'].includes(updatedExtension) || ['.docx', '.doc'].includes(fileExtension)) {
      // For Word documents, process with template data if available
      if (Object.keys(templateData).length > 0) {
        try {
          logger.info('Processing Word document with template data');
          let processedFilePath;
          
          try {
            // First try normal template processing
            processedFilePath = await documentProcessor.processDocumentTemplate(documentFile.path, templateData);
          } catch (templateError) {
            // If we get "Multi error" or other template-related errors, it might be due to Adobe Sign tags
            if (templateError.message.includes('Multi error') || 
                templateError.message.includes('Template Error') ||
                templateError.message.includes('unopened tag') ||
                templateError.message.includes('unclosed tag')) {
              
              logger.info('Template processing failed, checking for Adobe Sign tags');
              
              // Check if document contains Adobe Sign tags
              const hasAdobeSignTags = await documentProcessor.containsAdobeSignTags(documentFile.path);
              
              if (hasAdobeSignTags) {
                logger.info('Adobe Sign tags detected, using specialized processing');
                processedFilePath = await documentProcessor.processDocumentWithAdobeSignTags(documentFile.path, templateData);
              } else {
                // If no Adobe Sign tags found, try direct conversion without template processing
                logger.warn('No Adobe Sign tags found but template processing failed. Using direct conversion without processing.');
                processedFilePath = documentFile.path;
              }
            } else {
              // For other errors, re-throw
              throw templateError;
            }
          }
          
          documentData.processedFilePath = processedFilePath;
          
          // Convert to PDF
          const convertedFilePath = processedFilePath.replace(/\.(docx|doc)$/, '_converted.pdf');
          await documentProcessor.convertToPdf(processedFilePath, convertedFilePath);
          finalPdfPath = convertedFilePath;
          
          // Get PDF page count
          try {
            pageCount = await documentUtils.getPdfPageCount(finalPdfPath);
            documentData.pageCount = pageCount;
            documentData.convertedFilePath = finalPdfPath;
            
            logger.info(`Document processed and converted to PDF with ${pageCount} pages`);
          } catch (pageCountError) {
            logger.error(`Error getting PDF page count: ${pageCountError.message}`);
            // Continue with pageCount=0 instead of failing
            pageCount = 0;
            documentData.pageCount = 0;
            documentData.pageCountError = pageCountError.message;
            documentData.convertedFilePath = finalPdfPath;
            
            logger.info(`Document processed and converted to PDF, but couldn't determine page count`);
          }
        } catch (error) {
          logger.error(`Error processing document: ${error.message}`);
          
          // Provide more detailed error information for debugging
          if (error.properties) {
            logger.error(`Error details: ${JSON.stringify(error.properties)}`);
          }
          
          // Check if it's a template-related error that we might be able to recover from
          if (error.message.includes('Multi error') || 
              error.message.includes('Template Error') ||
              error.message.includes('unopened tag') ||
              error.message.includes('unclosed tag')) {
            
            try {
              // Try direct conversion without template processing as a fallback
              logger.info('Attempting direct PDF conversion without template processing');
              const convertedFilePath = documentFile.path.replace(/\.(docx|doc)$/, '_fallback_converted.pdf');
              await documentProcessor.convertToPdf(documentFile.path, convertedFilePath);
              finalPdfPath = convertedFilePath;
              
              // Get PDF page count
              try {
                pageCount = await documentUtils.getPdfPageCount(finalPdfPath);
                documentData.pageCount = pageCount;
                documentData.convertedFilePath = finalPdfPath;
                documentData.processingError = error.message;
                documentData.usedFallbackConversion = true;
                
                logger.info(`Fallback conversion successful: ${pageCount} pages`);
                
                // Continue with document creation instead of returning error
              } catch (pageCountError) {
                logger.error(`Error getting PDF page count for fallback: ${pageCountError.message}`);
                // Continue with pageCount=0 instead of failing
                pageCount = 0;
                documentData.pageCount = 0;
                documentData.pageCountError = pageCountError.message;
                documentData.convertedFilePath = finalPdfPath;
                documentData.processingError = error.message;
                documentData.usedFallbackConversion = true;
                
                logger.info(`Fallback conversion successful, but couldn't determine page count`);
              }
            } catch (fallbackError) {
              logger.error(`Fallback conversion also failed: ${fallbackError.message}`);
              return next(new ApiError(500, `Document processing failed and fallback conversion also failed. Original error: ${error.message}, Fallback error: ${fallbackError.message}`));
            }
          } else {
            return next(new ApiError(500, `Error processing document: ${error.message}`));
          }
        }
      } else {
        // Convert to PDF without processing
        try {
          logger.info(`Converting ${fileExtension} document to PDF without template processing`);
          
          // First check if it has Adobe Sign tags that might need special handling
          const hasAdobeSignTags = await documentProcessor.containsAdobeSignTags(documentFile.path);
          
          if (hasAdobeSignTags) {
            logger.info('Document contains Adobe Sign tags, using optimized conversion');
          }
          
          const convertedFilePath = documentFile.path.replace(/\.(docx|doc)$/, '_converted.pdf');
          await documentProcessor.convertToPdf(documentFile.path, convertedFilePath);
          finalPdfPath = convertedFilePath;
          
          // Get PDF page count
          try {
            pageCount = await documentUtils.getPdfPageCount(finalPdfPath);
            documentData.pageCount = pageCount;
            documentData.convertedFilePath = finalPdfPath;
            
            logger.info(`Document converted to PDF with ${pageCount} pages`);
          } catch (pageCountError) {
            logger.error(`Error getting PDF page count: ${pageCountError.message}`);
            // Continue with pageCount=0 instead of failing
            pageCount = 0;
            documentData.pageCount = 0;
            documentData.pageCountError = pageCountError.message;
            documentData.convertedFilePath = finalPdfPath;
            
            logger.info(`Document converted to PDF, but couldn't determine page count`);
          }
        } catch (error) {
          logger.error(`Error converting document to PDF: ${error.message}`);
          return next(new ApiError(500, `Error converting document to PDF: ${error.message}`));
        }
      }
    } else {
      // For any other format, attempt conversion to PDF
      try {
        logger.info(`Attempting to convert unknown format document (${fileExtension}) to PDF`);
        const convertedFilePath = documentFile.path + '_converted.pdf';
        await documentProcessor.convertToPdf(documentFile.path, convertedFilePath);
        finalPdfPath = convertedFilePath;
        
        // Get PDF page count
        try {
          pageCount = await documentUtils.getPdfPageCount(finalPdfPath);
          documentData.pageCount = pageCount;
          documentData.convertedFilePath = finalPdfPath;
          
          logger.info(`Document converted to PDF with ${pageCount} pages`);
        } catch (pageCountError) {
          logger.error(`Error getting PDF page count: ${pageCountError.message}`);
          // Continue with pageCount=0 instead of failing
          pageCount = 0;
          documentData.pageCount = 0;
          documentData.pageCountError = pageCountError.message;
          documentData.convertedFilePath = finalPdfPath;
          
          logger.info(`Document converted to PDF, but couldn't determine page count`);
        }
      } catch (error) {
        logger.error(`Error converting document to PDF: ${error.message}`);
        return next(new ApiError(400, `Unsupported file format (${fileExtension}). Only PDF, DOCX, and DOC files are allowed. Conversion failed: ${error.message}`));
      }
    }
    
    // Create document in database
    const document = new Document({
      ...documentData,
      templateData: Object.keys(templateData).length > 0 ? templateData : undefined,
      createdBy: req.apiKey.userId || req.apiKey._id
    });
    
    await document.save();
    
    // Create log entry
    const logEntry = new Log({
      level: 'info',
      message: `Document uploaded from URL: ${documentUrl}`,
      metadata: {
        action: 'document_upload_from_url',
        filename: document.filename,
        originalName: document.originalName,
        fileSize: document.fileSize,
        source: 'url',
        url: documentUrl
      },
      documentId: document._id,
      userId: req.apiKey.userId || req.apiKey._id
    });
    
    await logEntry.save();
    
    res.status(201).json(formatResponse(
      201,
      'Document uploaded successfully from URL',
      {
        document: {
          id: document._id,
          filename: document.filename,
          originalName: document.originalName,
          status: document.status,
          pageCount: document.pageCount || 0,
          hasTemplateData: !!document.templateData
        }
      }
    ));
  } catch (error) {
    logger.error(`Error uploading document from URL: ${error.message}`);
    next(new ApiError(500, `Error uploading document from URL: ${error.message}`));
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
    // First check if we're currently rate limited by Adobe Sign
    if (rateLimitProtection.isRateLimited()) {
      const timeRemaining = rateLimitProtection.getTimeRemaining();
      const status = rateLimitProtection.getRateLimitStatus();
      
      logger.warn(`Rate limit check failed: ${status}`);
      return next(new ApiError(429, `Adobe Sign rate limit in effect. Please try again after ${Math.ceil(timeRemaining / 60)} minutes.`));
    }
    
    // First validate Adobe Sign configuration
    const { validateAdobeSignConfig } = require('../config/adobeSign');
    const configValidation = validateAdobeSignConfig();
    
    if (!configValidation.isValid) {
      logger.error('Adobe Sign configuration validation failed:', configValidation.errors);
      return next(new ApiError(500, `Adobe Sign configuration error: ${configValidation.errors.join(', ')}`));
    }
    
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
    
    // Validate recipient emails
    const invalidRecipients = document.recipients.filter(recipient => {
      const email = recipient.email;
      return !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    });
    
    if (invalidRecipients.length > 0) {
      return next(new ApiError(400, `Invalid recipient email addresses: ${invalidRecipients.map(r => r.email || 'missing email').join(', ')}`));
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
      
      // Ensure we have a webhook setup for status updates
      try {
        // Get access token
        const accessToken = await getAccessToken();
        
        // Setup webhook URL
        const webhookUrl = process.env.ADOBE_WEBHOOK_URL || `${req.protocol}://${req.get('host')}/api/webhooks/adobe-sign`;
        
        // Check if webhook URL is HTTPS, which Adobe Sign requires
        const isHttps = webhookUrl.startsWith('https://');
        const isLocalhost = webhookUrl.includes('localhost') || webhookUrl.includes('127.0.0.1');
        const isDevEnvironment = process.env.NODE_ENV === 'development';
        
        if (!isHttps && process.env.NODE_ENV === 'production') {
          logger.warn(`Skipping webhook setup as Adobe Sign requires HTTPS URLs in production: ${webhookUrl}`);
        } 
        // Use mock implementation for development or non-HTTPS environments
        else if (webhookUrl) {
          try {
            // Import our improved webhook creator that handles non-HTTPS URLs
            const createWebhookLocal = require('../config/createWebhook');
            const webhookResult = await createWebhookLocal(accessToken, webhookUrl);
            
            if (webhookResult._mockImplementation) {
              logger.info(`Mock webhook setup for Adobe Sign: ${webhookUrl} (reason: ${webhookResult._mockReason || 'mock'})`);
            } else {
              logger.info(`Real webhook setup for Adobe Sign: ${webhookUrl}`);
            }
          } catch (innerWebhookError) {
            // Log the error but continue with document sending
            logger.error(`Inner webhook error: ${innerWebhookError.message}`);
          }
        } else {
          logger.warn('No webhook URL configured for Adobe Sign updates');
        }
      } catch (webhookError) {
        // Log the error but continue with document sending
        logger.error(`Error setting up webhook: ${webhookError.message}`);
      }
      
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
      
      // Special handling for rate limiting
      if (result.rateLimited) {
        logger.warn(`Adobe Sign rate limit reached. Retry after ${result.retryAfter} seconds.`);
        document.status = 'signature_error';
        document.errorMessage = `Rate limit reached. Please try again later (after ${Math.ceil(result.retryAfter / 60)} minutes).`;
        document.adobeMetadata.rateLimited = true;
        document.adobeMetadata.retryAfter = result.retryAfter;
        document.adobeMetadata.retryAfterDate = new Date(Date.now() + (result.retryAfter * 1000));
        
        await document.save();
        
        return next(new ApiError(429, `Adobe Sign rate limit reached. Please try again after ${Math.ceil(result.retryAfter / 60)} minutes.`));
      }
      
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
    
    // Helper function to get actual signing timestamp from agreement events
    const getActualSigningTimestamp = (participantEmail, agreementEvents) => {
      if (!agreementEvents || !agreementEvents.events) {
        return null;
      }
      
      // Look for various signing-related events
      const signingEvents = agreementEvents.events.filter(event => {
        const eventType = event.type?.toLowerCase() || '';
        const matchesParticipant = event.participantEmail === participantEmail;
        
        // Check for various signing completion events
        return matchesParticipant && (
          event.type === 'ESIGNED' || 
          event.type === 'ACTION_COMPLETED' ||
          event.type === 'SIGNED' ||
          eventType.includes('signed') || 
          eventType.includes('completed') || 
          eventType.includes('approved') ||
          eventType.includes('accepted')
        );
      });
      
      if (signingEvents.length > 0) {
        // Use the most recent signing event
        const mostRecentSigningEvent = signingEvents.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
        logger.info(`Found signing timestamp for ${participantEmail}: ${mostRecentSigningEvent.date} (event: ${mostRecentSigningEvent.type})`);
        return new Date(mostRecentSigningEvent.date);
      }
      
      return null;
    };

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
      
      // Get signing URLs for all recipients
      let signingUrls = {};
      try {
        const signingUrlResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/signingUrls`);
        const signingUrlSets = signingUrlResponse.data.signingUrlSetInfos || [];
        
        // Flatten the signing URLs by recipient email
        signingUrlSets.forEach(urlSet => {
          (urlSet.signingUrls || []).forEach(urlInfo => {
            if (urlInfo.email && urlInfo.esignUrl) {
              signingUrls[urlInfo.email.toLowerCase()] = urlInfo.esignUrl;
            }
          });
        });
        
        logger.info(`Retrieved signing URLs for ${Object.keys(signingUrls).length} recipients`);
        
        // Store signing URLs in database for future reference and use stored URLs as fallback
        let documentUpdated = false;
        document.recipients.forEach(recipient => {
          const currentSigningUrl = signingUrls[recipient.email.toLowerCase()];
          
          if (currentSigningUrl && (!recipient.signingUrl || recipient.signingUrl !== currentSigningUrl)) {
            // Store the signing URL in database for future reference
            recipient.signingUrl = currentSigningUrl;
            documentUpdated = true;
            logger.info(`Stored signing URL for ${recipient.email} in database`);
          } else if (!currentSigningUrl && recipient.signingUrl) {
            // Use stored signing URL from database if current one is not available
            signingUrls[recipient.email.toLowerCase()] = recipient.signingUrl;
            logger.info(`Using stored signing URL for ${recipient.email} (current URL not available - normal for signed recipients in sequential signing)`);
          } else if (!currentSigningUrl && !recipient.signingUrl) {
            logger.info(`No signing URL available for ${recipient.email} (status: ${recipient.status}) - this is normal for signed recipients in sequential signing`);
          }
        });
        
        // Save document if signing URLs were updated
        if (documentUpdated) {
          await document.save();
          logger.info('Updated document with new signing URLs');
        }
      } catch (urlError) {
        logger.warn(`Could not retrieve signing URLs: ${urlError.message}`);
        
        // If we can't get current signing URLs, try to use stored ones
        document.recipients.forEach(recipient => {
          if (recipient.signingUrl) {
            signingUrls[recipient.email.toLowerCase()] = recipient.signingUrl;
            logger.info(`Using stored signing URL for ${recipient.email} (current URLs not available)`);
          }
        });
      }
      
      // Update recipients status using multiple data sources
      if (agreementResponse.data.participantSetsInfo) {
        // First, check if Adobe Sign overall status is SIGNED/COMPLETED but participants still show as ACTIVE
        const overallStatus = agreementResponse.data.status;
        const isAgreementCompleted = overallStatus === 'SIGNED' || overallStatus === 'COMPLETED';
        
        agreementResponse.data.participantSetsInfo.forEach(participantSet => {
          participantSet.memberInfos.forEach(member => {
            const recipient = document.recipients.find(r => r.email === member.email);
            
            if (recipient) {
              // Log the member status for debugging
              logger.info(`Checking recipient ${member.email} - Adobe Sign status: ${member.status}, Overall agreement status: ${overallStatus}`);
              
              // Store the previous status to detect changes
              const previousStatus = recipient.status;
              
              // SPECIAL HANDLING: If agreement is completed but participant shows as ACTIVE
              // This is a common Adobe Sign timing issue
              let effectiveMemberStatus = member.status;
              if (isAgreementCompleted && member.status === 'ACTIVE') {
                logger.info(`⚠️ Agreement is ${overallStatus} but ${member.email} shows ACTIVE - treating as SIGNED`);
                effectiveMemberStatus = 'SIGNED';
              }
              
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
                const actualSigningDate = getActualSigningTimestamp(member.email, agreementEvents);
                
                if (actualSigningDate) {
                  hasActuallySigned = true;
                  logger.info(`Recipient ${member.email} has signing event in agreement events`);
                  
                  // Update signedAt timestamp from the event - use the actual signing date
                  if (!recipient.signedAt) {
                    recipient.signedAt = actualSigningDate;
                    logger.info(`Updated signedAt timestamp for ${member.email} from event data: ${actualSigningDate}`);
                  }
                }
                
                // Also check for document access events to update lastSigningUrlAccessed
                if (!recipient.lastSigningUrlAccessed) {
                  const accessEvents = agreementEvents.events.filter(event => 
                    (event.type === 'ACTION_REQUESTED' || 
                     event.type === 'VIEWED' || 
                     event.type === 'AGREEMENT_ACTION_REQUESTED' ||
                     event.type?.toLowerCase().includes('viewed') ||
                     event.type?.toLowerCase().includes('accessed')) && 
                    event.participantEmail === member.email
                  );
                  
                  if (accessEvents.length > 0) {
                    // Use the first access event (when they first viewed the document)
                    const firstAccessEvent = accessEvents.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
                    recipient.lastSigningUrlAccessed = new Date(firstAccessEvent.date);
                    logger.info(`Updated lastSigningUrlAccessed for ${member.email} from event data: ${firstAccessEvent.date}`);
                  } else if (actualSigningDate) {
                    // If no specific access event, but they signed, assume they accessed it shortly before signing
                    const estimatedAccessTime = new Date(actualSigningDate.getTime() - (5 * 60 * 1000)); // 5 minutes before signing
                    recipient.lastSigningUrlAccessed = estimatedAccessTime;
                    logger.info(`Estimated lastSigningUrlAccessed for ${member.email}: ${estimatedAccessTime}`);
                  }
                }
                
                // Check for reminder events to update lastReminderSent
                if (!recipient.lastReminderSent) {
                  const reminderEvents = agreementEvents.events.filter(event => {
                    const eventType = event.type?.toLowerCase() || '';
                    const participantEmail = event.participantEmail;
                    
                    // Check for various reminder-related event types
                    return participantEmail === member.email && (
                      event.type === 'AGREEMENT_REMINDER_SENT' ||
                      event.type === 'REMINDER_SENT' ||
                      event.type === 'REMINDER_EMAIL_SENT' ||
                      event.type === 'NOTIFICATION_SENT' ||
                      event.type === 'EMAIL_SENT' ||
                      eventType.includes('reminder') ||
                      eventType.includes('notification') ||
                      (eventType.includes('email') && eventType.includes('sent')) ||
                      (eventType.includes('sent') && event.description?.toLowerCase().includes('reminder'))
                    );
                  });
                  
                  if (reminderEvents.length > 0) {
                    // Use the most recent reminder event
                    const mostRecentReminder = reminderEvents.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
                    recipient.lastReminderSent = new Date(mostRecentReminder.date);
                    logger.info(`Updated lastReminderSent for ${member.email} from event data: ${mostRecentReminder.date} (event type: ${mostRecentReminder.type})`);
                  }
                }
              }
              
              // Method 3: Check Adobe Sign status directly (using effective status)
              // IMPORTANT: This is a critical check for the "stays active" issue
              if (effectiveMemberStatus === 'SIGNED') {
                hasActuallySigned = true;
                logger.info(`Recipient ${member.email} has SIGNED status in Adobe Sign (effective: ${effectiveMemberStatus}, actual: ${member.status})`);
                
                // Update signedAt if we don't have it yet
                if (!recipient.signedAt) {
                  // Try to get the actual signing date from agreement events first
                  const actualSigningDate = getActualSigningTimestamp(member.email, agreementEvents);
                  
                  // If we found an actual signing date, use it; otherwise use current time as fallback
                  recipient.signedAt = actualSigningDate || new Date();
                  logger.info(`Set signedAt timestamp for ${member.email}: ${recipient.signedAt} (${actualSigningDate ? 'from events' : 'current time fallback'})`);
                }
              }
              
              // Method 4: Check if already marked as signed locally
              if (recipient.signedAt) {
                hasActuallySigned = true;
                logger.info(`Recipient ${member.email} has local signedAt timestamp`);
              }
              
              // Now update the status based on actual signature detection
              if (hasActuallySigned) {
                recipient.status = 'signed';
                if (!recipient.signedAt) {
                  // Try to get the actual signing date from agreement events
                  const actualSigningDate = getActualSigningTimestamp(member.email, agreementEvents);
                  recipient.signedAt = actualSigningDate || new Date();
                }
                logger.info(`✅ Recipient ${member.email} confirmed as SIGNED at ${recipient.signedAt}`);
              } else {
                // They haven't actually signed yet - use effective status for decision making
                switch (effectiveMemberStatus) {
                  case 'SIGNED':
                    // Adobe says signed (or we determined it should be signed)
                    logger.info(`Setting ${member.email} as signed based on effective status (actual: ${member.status}, effective: ${effectiveMemberStatus})`);
                    recipient.status = 'signed';
                    if (!recipient.signedAt) {
                      // Try to get the actual signing date from agreement events
                      const actualSigningDate = getActualSigningTimestamp(member.email, agreementEvents);
                      recipient.signedAt = actualSigningDate || new Date();
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
                    // Fix for "active" even after signing issue
                    // Double-check against other data sources
                    if (hasActuallySigned) {
                      recipient.status = 'signed';
                      if (!recipient.signedAt) {
                        const actualSigningDate = getActualSigningTimestamp(member.email, agreementEvents);
                        recipient.signedAt = actualSigningDate || new Date();
                      }
                      logger.info(`⚠️ Recipient ${member.email} shows ACTIVE but evidence indicates SIGNED - correcting status, signed at: ${recipient.signedAt}`);
                    } else {
                      // Check if we have a form field signature but Adobe Sign doesn't know yet
                      if (formFieldData && Array.isArray(formFieldData)) {
                        const recipientSignatures = formFieldData.filter(field => 
                          field.fieldType === 'SIGNATURE' && 
                          field.value && 
                          field.value.trim() !== '' &&
                          (field.assignedToRecipient === member.email || field.name.includes(`signer${participantSet.order}`))
                        );
                        
                        if (recipientSignatures.length > 0) {
                          // They actually signed based on form data
                          recipient.status = 'signed';
                          if (!recipient.signedAt) {
                            const actualSigningDate = getActualSigningTimestamp(member.email, agreementEvents);
                            recipient.signedAt = actualSigningDate || new Date();
                          }
                          logger.info(`⚠️ Recipient ${member.email} shows ACTIVE but form field evidence indicates SIGNED - correcting status, signed at: ${recipient.signedAt}`);
                        } else {
                          recipient.status = 'sent';
                          logger.info(`📝 Recipient ${member.email} is ACTIVE and ready to sign`);
                        }
                      } else {
                        recipient.status = 'sent';
                        logger.info(`📝 Recipient ${member.email} is ACTIVE and ready to sign`);
                      }
                    }
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
                    logger.warn(`Unknown Adobe Sign status for ${member.email}: ${effectiveMemberStatus} (actual: ${member.status})`);
                    recipient.status = 'sent'; // Default to sent for unknown statuses
                    break;
                }
              }
              
              // Add signing URL if available (current or stored)
              const currentSigningUrl = signingUrls[recipient.email.toLowerCase()];
              const storedSigningUrl = document.recipients.find(r => r.email.toLowerCase() === recipient.email.toLowerCase())?.signingUrl;
              
              if (currentSigningUrl) {
                recipient.signingUrl = currentSigningUrl;
                logger.info(`Added current signing URL for ${recipient.email}`);
              } else if (storedSigningUrl) {
                recipient.signingUrl = storedSigningUrl;
                logger.info(`Added stored signing URL for ${recipient.email} (current URL not available - normal for signed recipients)`);
              } else {
                recipient.signingUrl = null;
                if (recipient.status === 'signed') {
                  logger.info(`No signing URL available for ${recipient.email} (status: ${recipient.status}) - signed recipient's URL was not preserved (this is normal for early signed recipients in sequential signing)`);
                } else {
                  logger.info(`No signing URL available for ${recipient.email} (status: ${recipient.status})`);
                }
              }
              
              logger.info(`Final status for ${member.email}: ${recipient.status} (was: ${previousStatus})`);
            }
          });
        });
      }
      
      // Update document-level reminder information from events
      if (agreementEvents && agreementEvents.events && !document.lastReminderSent) {
        const documentReminderEvents = agreementEvents.events.filter(event => {
          const eventType = event.type?.toLowerCase() || '';
          
          // Look for any reminder-related events at document level
          return (
            event.type === 'AGREEMENT_REMINDER_SENT' ||
            event.type === 'REMINDER_SENT' ||
            event.type === 'REMINDER_EMAIL_SENT' ||
            event.type === 'NOTIFICATION_SENT' ||
            event.type === 'EMAIL_SENT' ||
            eventType.includes('reminder') ||
            eventType.includes('notification') ||
            (eventType.includes('email') && eventType.includes('sent')) ||
            (eventType.includes('sent') && event.description?.toLowerCase().includes('reminder'))
          );
        });
        
        if (documentReminderEvents.length > 0) {
          const mostRecentDocumentReminder = documentReminderEvents.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
          document.lastReminderSent = new Date(mostRecentDocumentReminder.date);
          
          // Also estimate reminder count based on number of reminder events
          document.reminderCount = documentReminderEvents.length;
          
          logger.info(`Updated document lastReminderSent from event data: ${mostRecentDocumentReminder.date} (event type: ${mostRecentDocumentReminder.type})`);
          logger.info(`Estimated reminder count from events: ${document.reminderCount}`);
        }
      }
      
      // Now update document status based on Adobe Sign status and recipient statuses
      const adobeStatus = agreementResponse.data.status;
      
      // Count signed recipients to properly determine document completion
      const signedCount = document.recipients.filter(r => r.status === 'signed').length;
      const totalRecipients = document.recipients.length;
      
      // Improve document status determination
      const previousDocStatus = document.status;
      
      // First determine status based on Adobe Sign status
      switch (adobeStatus) {
        case 'SIGNED':
          // For SIGNED status, assume completed but verify all recipients have signed
          document.status = 'completed';
          logger.info(`Adobe Sign reports agreement is SIGNED`);
          break;
        case 'CANCELLED':
          document.status = 'cancelled';
          break;
        case 'EXPIRED':
          document.status = 'expired';
          break;
        case 'OUT_FOR_SIGNATURE':
          // Check recipient statuses to determine actual state
          if (signedCount === totalRecipients) {
            // All recipients have signed according to our records
            document.status = 'completed';
            logger.info(`All recipients signed (${signedCount}/${totalRecipients}) but Adobe still shows OUT_FOR_SIGNATURE - marking as completed`);
          } else if (signedCount > 0) {
            document.status = 'partially_signed';
            logger.info(`Document partially signed: ${signedCount}/${totalRecipients} recipients have signed`);
          } else {
            document.status = 'sent_for_signature';
          }
          break;
        case 'COMPLETED':
          document.status = 'completed';
          logger.info(`Adobe Sign reports agreement is COMPLETED`);
          break;
        default:
          // For unknown statuses, use recipient count logic
          if (signedCount === totalRecipients && totalRecipients > 0) {
            document.status = 'completed';
            logger.info(`All recipients signed despite unknown Adobe status (${adobeStatus}) - marking as completed`);
          } else if (signedCount > 0) {
            document.status = 'partially_signed';
            logger.info(`Partially signed with unknown Adobe status (${adobeStatus}): ${signedCount}/${totalRecipients}`);
          }
          logger.info(`Unknown Adobe Sign status: ${adobeStatus}, determined document status: ${document.status}`);
          break;
      }
      
      // ADDITIONAL check specifically for the "still says out for signature" issue
      // If all recipients have signed, the document should be marked as completed
      if (signedCount === totalRecipients && totalRecipients > 0 && document.status !== 'completed') {
        logger.info(`Status override: All recipients (${signedCount}/${totalRecipients}) have signed - marking as completed`);
        document.status = 'completed';
      }
      
      // Track status change for logging
      if (previousDocStatus !== document.status) {
        logger.info(`Document status changed: ${previousDocStatus} -> ${document.status}`);
      }
      
      // Save the updated document
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
          adobeStatus,
          signedCount,
          totalRecipients,
          documentStatus: document.status
        }
      });
      
      logger.info(`Document status checked: ${document.originalName}`);
      
      // Prepare response - include signing URLs for each recipient
      const recipientData = document.recipients.map(recipient => {
        // Find matching recipient in templateData for title
        let recipientTitle = recipient.title;
        if (!recipientTitle && document.templateData && document.templateData.recipients) {
          const templateRecipient = document.templateData.recipients.find(
            tr => tr.email === recipient.email
          );
          if (templateRecipient) {
            recipientTitle = templateRecipient.title;
          }
        }
        
        // Keep signing URL even for signed recipients (they might need to access for reference)
        // Only set to null if truly not available
        let signingUrl = recipient.signingUrl || null;
        
        return {
          name: recipient.name,
          email: recipient.email,
          status: recipient.status,
          signedAt: recipient.signedAt,
          signingUrl: signingUrl,
          order: recipient.order,
          title: recipientTitle || null,
          lastReminderSent: recipient.lastReminderSent,
          lastSigningUrlAccessed: recipient.lastSigningUrlAccessed
        };
      });
      
      // Clean up document object for response
      const cleanedDocument = {
        ...document.toObject(),
        creator: document.creator || 'System', // Default creator if null
        pdfFilePath: document.pdfFilePath || null, // Keep null if no PDF generated
      };

      res.status(200).json(formatResponse(
        200,
        'Document status retrieved successfully',
        { 
          document: cleanedDocument,
          recipients: recipientData,
          signingProgress: {
            totalRecipients,
            signedCount,
            pendingCount: totalRecipients - signedCount,
            completionPercentage: totalRecipients > 0 ? Math.round((signedCount / totalRecipients) * 100) : 0
          },
          adobeStatus
        }
      ));
    } catch (error) {
      // Handle Adobe Sign API errors
      logger.error(`Error checking document status: ${error.message}`);
      if (error.response) {
        logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
      }
      
      return next(new ApiError(500, `Error checking document status: ${error.message}`));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Send reminder to recipients who haven't signed yet
 * @route POST /api/documents/:id/send-reminder
 */
exports.sendReminder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    // Find document
    const document = await Document.findById(id);
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }

    // Check if document has Adobe Sign agreement ID
    if (!document.adobeAgreementId) {
      return next(new ApiError(400, 'Document has not been sent for signature yet'));
    }

    // Get the Adobe Sign access token
    const accessToken = await getAccessToken();
    
    // Get agreement details from Adobe Sign using enhanced method to get actual signing status
    let agreementInfo;
    try {
      // Try enhanced method first for better participant data and actual signing status
      agreementInfo = await getComprehensiveAgreementInfo(accessToken, document.adobeAgreementId);
      
      // Log the full agreement info for debugging
      logger.info(`Enhanced agreement info structure: ${JSON.stringify(agreementInfo, null, 2)}`);
      
      // Check if the agreement is in a state where reminders can be sent
      if (agreementInfo.status !== 'OUT_FOR_SIGNATURE' && 
          agreementInfo.status !== 'OUT_FOR_APPROVAL' && 
          agreementInfo.status !== 'IN_PROCESS') {
        logger.warn(`Agreement is in status ${agreementInfo.status} which may not support reminders`);
        
        if (agreementInfo.status === 'SIGNED' || agreementInfo.status === 'APPROVED') {
          return next(new ApiError(400, 'Document has already been fully signed'));
        } else if (agreementInfo.status === 'CANCELLED') {
          return next(new ApiError(400, 'Document has been cancelled'));
        } else if (agreementInfo.status === 'EXPIRED') {
          return next(new ApiError(400, 'Document has expired'));
        } else if (agreementInfo.status === 'DRAFT') {
          return next(new ApiError(400, 'Document is still in draft state and has not been sent'));
        }
      }
    } catch (error) {
      logger.error(`Error getting enhanced agreement info: ${error.message}`);
      
      // Fallback to comprehensive agreement info
      try {
        logger.info('Falling back to comprehensive agreement info...');
        agreementInfo = await getComprehensiveAgreementInfo(accessToken, document.adobeAgreementId);
        logger.info(`Fallback agreement info keys: ${Object.keys(agreementInfo || {}).join(', ')}`);
      } catch (fallbackError) {
        logger.error(`Fallback also failed: ${fallbackError.message}`);
        return next(new ApiError(500, `Failed to get agreement info from Adobe Sign: ${error.message}`));
      }
    }

    // NEW: Get actual signing status using dynamic detection
    logger.info('🔍 Getting actual signing status using dynamic detection...');
    let actualSigningStatus = null;
    
    try {
      actualSigningStatus = await getActualSigningStatus(accessToken, document.adobeAgreementId, document.recipients);
      
      logger.info(`✅ Dynamic signing status obtained successfully:`);
      logger.info(`   - Detection method: ${actualSigningStatus.detectionMethod}`);
      logger.info(`   - Signed participants: ${actualSigningStatus.signedParticipants.length}`);
      logger.info(`   - Pending participants: ${actualSigningStatus.pendingParticipants.length}`);
      logger.info(`   - Current signer: ${actualSigningStatus.currentSigner ? actualSigningStatus.currentSigner.email : 'NONE'}`);
      logger.info(`   - Next signer: ${actualSigningStatus.nextSigner ? actualSigningStatus.nextSigner.email : 'NONE'}`);
      
      if (actualSigningStatus.currentSigner) {
        logger.info(`🎯 Current signer details: ${actualSigningStatus.currentSigner.email} (order: ${actualSigningStatus.currentSigner.order})`);
      } else {
        logger.warn(`⚠️ No current signer identified by dynamic detection`);
        if (actualSigningStatus.pendingParticipants.length > 0) {
          logger.info(`   Available pending participants:`);
          actualSigningStatus.pendingParticipants.forEach((p, index) => {
            logger.info(`     ${index + 1}. ${p.email} (order: ${p.order}) - canSign: ${p.canSign}, status: ${p.actualStatus}`);
          });
        }
      }
      
    } catch (error) {
      logger.error(`⚠️ Dynamic signing status detection failed: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      // Continue with fallback logic
    }

    // Find recipients who haven't signed yet
    const pendingRecipients = [];
    const participantIds = []; // Store participant IDs for Adobe Sign reminder API
    let participantFound = false;
    
    // Check for evidence of sequential signing
    let hasSequentialSigning = false;
    let totalSigners = 0;
    
    if (document.recipients && document.recipients.length > 0) {
      // Count total signers
      totalSigners = document.recipients.length;
      
      // Count recipients with different orders as indicator of sequential signing
      const uniqueOrders = new Set(document.recipients.filter(r => r.order).map(r => r.order));
      hasSequentialSigning = uniqueOrders.size > 1;
      logger.info(`Sequential signing detected: ${hasSequentialSigning ? 'YES' : 'NO'} (unique orders: ${uniqueOrders.size})`);
    }

    // Update the pending recipients list based on our dynamic detection
    // This is critical for when all participants show as ACTIVE
    if (actualSigningStatus) {
      logger.info(`🔄 Updating pending recipients list based on dynamic detection results`);
      
      // First check if all participants have been detected as signed
      if (actualSigningStatus.signedParticipants.length > 0 && 
          actualSigningStatus.pendingParticipants.length === 0) {
        logger.info(`✅ All participants detected as SIGNED - no reminders needed`);
        
        // Return success but with no reminders sent
        return res.status(200).json(formatResponse(
          200,
          'All participants have completed their actions - no reminders needed',
          { 
            recipientsToRemind: [],
            allPendingRecipients: [],
            participantCounts: {
              total: actualSigningStatus.signedParticipants.length,
              pending: 0,
              actionRequired: 0,
              waiting: 0,
              completed: actualSigningStatus.signedParticipants.length
            },
            reminderSent: false,
            reminderError: null,
            signingFlow: hasSequentialSigning ? 'SEQUENTIAL' : 'PARALLEL',
            adobeSignInfo: {
              agreementId: document.adobeAgreementId,
              status: agreementInfo?.status || 'UNKNOWN',
              participantCount: totalSigners,
              participantStatuses: []
            },
            documentInfo: {
              id: document._id,
              status: document.status,
              recipientCount: document.recipients?.length || 0,
              recipientStatuses: document.recipients?.map(r => ({ 
                email: r.email, 
                status: r.status 
              })) || []
            },
            dynamicDetection: {
              detectionMethod: actualSigningStatus.detectionMethod,
              signedParticipants: actualSigningStatus.signedParticipants.map(p => ({
                email: p.email,
                order: p.order,
                detectedBy: p.signedDetectedBy
              })),
              currentSigner: null,
              nextSigner: null
            }
          }
        ));
      }
      
      // Otherwise, ensure our pending recipients list accurately reflects the dynamic detection
      const actualPendingRecipients = [];
      
      for (const participant of document.recipients || []) {
        // Check if this participant is marked as signed in our dynamic detection
        const isSignedInDynamicDetection = actualSigningStatus.signedParticipants.some(
          p => p.email.toLowerCase() === participant.email.toLowerCase()
        );
        
        // Check if this participant is the current signer
        const isCurrentSigner = actualSigningStatus.currentSigner && 
          actualSigningStatus.currentSigner.email.toLowerCase() === participant.email.toLowerCase();
        
        if (isSignedInDynamicDetection) {
          logger.info(`✅ ${participant.email} detected as SIGNED - not adding to pending recipients`);
          continue;
        }
        
        // For participants not marked as signed, add them to our pending list
        // with actionRequired=true only for the current signer
        actualPendingRecipients.push({
          email: participant.email,
          name: participant.name,
          status: isCurrentSigner ? 'ACTIVE' : 'WAITING',
          actionRequired: isCurrentSigner,
          participantId: participant.participantId || null,
          order: participant.order,
          source: 'dynamic_detection_updated'
        });
      }
      
      // Replace our original pending recipients list with the updated one
      pendingRecipients.length = 0;
      pendingRecipients.push(...actualPendingRecipients);
      
      logger.info(`🔄 Updated pending recipients list now has ${pendingRecipients.length} entries`);
      pendingRecipients.forEach((r, i) => {
        logger.info(`  ${i+1}. ${r.email} - Status: ${r.status}, Action Required: ${r.actionRequired}, Order: ${r.order || 'N/A'}`);
      });
    }
    
    // Debug: Log the full agreement info structure to understand what we're working with
    logger.info(`=== DEBUGGING AGREEMENT INFO STRUCTURE ===`);
    logger.info(`Agreement Info Keys: ${Object.keys(agreementInfo || {}).join(', ')}`);
    logger.info(`Agreement Status: ${agreementInfo?.status}`);
    
    // Log all possible participant-related fields
    if (agreementInfo?.participantSets) {
      logger.info(`Found participantSets with ${agreementInfo.participantSets.length} sets`);
    }
    if (agreementInfo?.participants) {
      logger.info(`Found participants field with keys: ${Object.keys(agreementInfo.participants).join(', ')}`);
      if (agreementInfo.participants.participantSets) {
        logger.info(`Found nested participants.participantSets with ${agreementInfo.participants.participantSets.length} sets`);
      }
    }
    if (agreementInfo?.participantSetInfos) {
      logger.info(`Found participantSetInfos with ${agreementInfo.participantSetInfos.length} sets`);
    }
    if (agreementInfo?.participantSetsInfo) {
      logger.info(`Found participantSetsInfo with ${agreementInfo.participantSetsInfo.length} sets`);
    }
    
    // Log the full structure (truncated for readability)
    logger.info(`Full Agreement Info Structure: ${JSON.stringify(agreementInfo, null, 2).substring(0, 2000)}...`);
    
    // Check if we have participant data from Adobe Sign
    // Try multiple possible data structures that Adobe Sign might return
    let participantSets = null;
    let participantDataSource = 'none';
    
    // First, try the direct participantSets field
    if (agreementInfo && agreementInfo.participantSets && agreementInfo.participantSets.length > 0) {
      participantSets = agreementInfo.participantSets;
      participantDataSource = 'direct_participantSets';
      logger.info('Using direct participantSets from agreement info');
    }
    // Second, try the nested participants.participantSets field
    else if (agreementInfo && agreementInfo.participants && agreementInfo.participants.participantSets && agreementInfo.participants.participantSets.length > 0) {
      participantSets = agreementInfo.participants.participantSets;
      participantDataSource = 'nested_participants_participantSets';
      logger.info('Using nested participants.participantSets from agreement info');
    }
    // Third, try participantSetInfos field (alternative structure)
    else if (agreementInfo && agreementInfo.participantSetInfos && agreementInfo.participantSetInfos.length > 0) {
      participantSets = agreementInfo.participantSetInfos;
      participantDataSource = 'participantSetInfos';
      logger.info('Using participantSetInfos from agreement info');
    }
    // Fourth, try participantSetsInfo field (another alternative)
    else if (agreementInfo && agreementInfo.participantSetsInfo && agreementInfo.participantSetsInfo.length > 0) {
      participantSets = agreementInfo.participantSetsInfo;
      participantDataSource = 'participantSetsInfo';
      logger.info('Using participantSetsInfo from agreement info');
    }
    
    logger.info(`Participant data source: ${participantDataSource}`);
    if (!participantSets) {
      logger.error('❌ NO PARTICIPANT SETS FOUND IN ANY EXPECTED LOCATION');
      logger.error('Available agreement info keys:', Object.keys(agreementInfo || {}));
    }

    // Check if we have enhanced signing status analysis from basic agreement info (fallback)
    if (!actualSigningStatus && agreementInfo && agreementInfo.actualSigningStatus) {
      logger.info(`📋 Using enhanced signing status from agreement info as fallback`);
      actualSigningStatus = agreementInfo.actualSigningStatus;
      logger.info(`✅ Found actual signing status analysis:`);
      logger.info(`  - Signed participants: ${actualSigningStatus.signedParticipants?.length || 0}`);
      logger.info(`  - Pending participants: ${actualSigningStatus.pendingParticipants?.length || 0}`);
      logger.info(`  - Current signer: ${actualSigningStatus.currentSigner?.email || 'None'}`);
      logger.info(`  - Next signer: ${actualSigningStatus.nextSigner?.email || 'None'}`);
    }
    
    if (participantSets && participantSets.length > 0) {
      // Debug: Log the entire participant structure
      logger.info(`Agreement participant structure (${participantDataSource}): ${JSON.stringify(participantSets, null, 2)}`);
      
      for (const participantSet of participantSets) {
        // Only process SIGNER participant sets (not CC, etc.)
        if (participantSet.role !== 'SIGNER') {
          logger.info(`Skipping non-signer participant set with role: ${participantSet.role}`);
          continue;
        }
        
        for (const participant of participantSet.memberInfos) {
          participantFound = true;
          // Debug: Log individual participant status
          logger.info(`Participant ${participant.email} has status: ${participant.status}, ID: ${participant.id}, Order: ${participantSet.order}`);
          
          // Adobe Sign status meanings:
          // - WAITING_FOR_MY_SIGNATURE: This participant needs to sign
          // - WAITING_FOR_MY_APPROVAL: This participant needs to approve
          // - WAITING_FOR_MY_DELEGATION: This participant needs to delegate
          // - WAITING_FOR_MY_ACCEPTANCE: This participant needs to accept
          // - WAITING_FOR_MY_FORM_FILLING: This participant needs to fill form
          // - WAITING_FOR_OTHERS: This participant is waiting for others to complete
          // - SIGNED: This participant has signed
          // - APPROVED: This participant has approved
          // - ACCEPTED: This participant has accepted
          // - FORM_FILLED: This participant has filled the form
          // - DELEGATED: This participant has delegated to someone else
          // - NOT_YET_VISIBLE: Agreement is not yet visible to this participant
          // - COMPLETED: Agreement is completed for this participant
          // - ACTIVE: This participant is active and can take action (Adobe Sign alternate status)
          // - INACTIVE: This participant is inactive
          
          // Consider a recipient pending if they still need to take action or are waiting
          const isPending = 
            participant.status === 'WAITING_FOR_MY_SIGNATURE' || 
            participant.status === 'WAITING_FOR_MY_APPROVAL' ||
            participant.status === 'WAITING_FOR_MY_DELEGATION' ||
            participant.status === 'WAITING_FOR_MY_ACCEPTANCE' ||
            participant.status === 'WAITING_FOR_MY_FORM_FILLING' ||
            participant.status === 'NOT_YET_VISIBLE' ||
            participant.status === 'WAITING_FOR_OTHERS' ||
            participant.status === 'ACTIVE'; // Adobe Sign uses ACTIVE for participants who can take action
          
          // Consider a recipient completed if they've taken their required action
          const participantIsCompleted = 
            participant.status === 'SIGNED' ||
            participant.status === 'APPROVED' ||
            participant.status === 'ACCEPTED' ||
            participant.status === 'FORM_FILLED' ||
            participant.status === 'DELEGATED' ||
            participant.status === 'COMPLETED' ||
            participant.status === 'DECLINED' ||
            participant.status === 'EXPIRED' ||
            participant.status === 'INACTIVE';
          
          // Add to pending list if the participant still needs to take action
          if (isPending) {
            logger.info(`Found pending recipient: ${participant.email} with status: ${participant.status} (order: ${participantSet.order})`);
            
            // For ACTIVE status, determine if action is required based on sequential order
            let actionRequired = true;
            if (participant.status === 'ACTIVE') {
              // In sequential signing, we need to check if this is the current signer
              // For now, we'll assume ACTIVE means they can take action and let the later logic
              // filter based on sequential order
              actionRequired = true;
            } else {
              actionRequired = participant.status !== 'WAITING_FOR_OTHERS' && 
                             participant.status !== 'NOT_YET_VISIBLE';
            }
            
            pendingRecipients.push({
              email: participant.email,
              name: participant.name || participant.email.split('@')[0],
              status: participant.status,
              actionRequired: actionRequired,
              participantId: participant.id,
              order: participantSet.order
            });
            
            // Add participant ID for reminder API if they need to take action
            if (participant.id && actionRequired) {
              participantIds.push(participant.id);
              logger.info(`Added participant ID for reminder: ${participant.id} (${participant.email}) with status: ${participant.status}`);
            }
          } else if (!participantIsCompleted) {
            // Log warning for unexpected status values
            logger.warn(`Participant ${participant.email} has unexpected status: ${participant.status}`);
          } else {
            logger.info(`Participant ${participant.email} has completed status: ${participant.status}`);
          }
        }
      }
      
      // If we found participants but none are pending, check if we need to include WAITING_FOR_OTHERS
      if (participantFound && pendingRecipients.length === 0) {
        logger.warn('Found participants but none are in pending status - checking for waiting participants');
        
        // Second pass to include waiting participants if needed
        for (const participantSet of participantSets) {
          if (participantSet.role === 'SIGNER') {
            for (const participant of participantSet.memberInfos) {
              if (participant.status === 'WAITING_FOR_OTHERS') {
                logger.info(`Including waiting participant in pending list: ${participant.email}`);
                pendingRecipients.push({
                  email: participant.email,
                  name: participant.name || participant.email.split('@')[0],
                  status: participant.status,
                  actionRequired: false,
                  participantId: participant.id,
                  order: participantSet.order
                });
              }
            }
          }
        }
      }
    } else {
      // ENHANCED FALLBACK: If Adobe Sign doesn't return participant data in expected locations, try alternative approaches
      logger.warn(`No participant sets found in Adobe Sign response, trying alternative approaches...`);
      
      // Try to find participant data in any field that might contain it
      let alternativeParticipants = null;
      
      // Check if there's a 'members' field or similar
      if (agreementInfo?.members && Array.isArray(agreementInfo.members)) {
        logger.info(`Found 'members' field with ${agreementInfo.members.length} members`);
        alternativeParticipants = agreementInfo.members;
      }
      // Check if there's a 'signers' field
      else if (agreementInfo?.signers && Array.isArray(agreementInfo.signers)) {
        logger.info(`Found 'signers' field with ${agreementInfo.signers.length} signers`);
        alternativeParticipants = agreementInfo.signers;
      }
      // Check if there's a 'recipients' field
      else if (agreementInfo?.recipients && Array.isArray(agreementInfo.recipients)) {
        logger.info(`Found 'recipients' field with ${agreementInfo.recipients.length} recipients`);
        alternativeParticipants = agreementInfo.recipients;
      }
      // Check for any array field that might contain participant info
      else {
        logger.info('Looking for any array fields that might contain participant data...');
        for (const [key, value] of Object.entries(agreementInfo || {})) {
          if (Array.isArray(value) && value.length > 0) {
            logger.info(`Found array field '${key}' with ${value.length} items:`, JSON.stringify(value[0], null, 2));
            // Check if this looks like participant data
            if (value[0] && (value[0].email || value[0].memberInfos || value[0].participantEmail)) {
              logger.info(`Field '${key}' appears to contain participant data`);
              alternativeParticipants = value;
              break;
            }
          }
        }
      }
      
      if (alternativeParticipants && alternativeParticipants.length > 0) {
        logger.info(`Processing ${alternativeParticipants.length} alternative participants`);
        participantFound = true;
        
        for (const participant of alternativeParticipants) {
          // Handle different possible structures
          const email = participant.email || participant.participantEmail || participant.memberEmail;
          const status = participant.status || participant.participantStatus || 'UNKNOWN';
          const name = participant.name || participant.participantName || (email ? email.split('@')[0] : 'Unknown');
          const id = participant.id || participant.participantId || participant.memberId;
          
          if (email) {
            logger.info(`Found alternative participant: ${email} with status: ${status}`);
            
            // Consider them pending if they haven't completed
            const altParticipantIsCompleted = ['SIGNED', 'APPROVED', 'ACCEPTED', 'FORM_FILLED', 
              'DELEGATED', 'COMPLETED', 'DECLINED', 'EXPIRED'].includes(status);
            
            if (!altParticipantIsCompleted) {
              const actionRequired = !['WAITING_FOR_OTHERS', 'NOT_YET_VISIBLE'].includes(status);
              
              pendingRecipients.push({
                email: email,
                name: name,
                status: status,
                actionRequired: actionRequired,
                participantId: id,
                source: 'alternative_extraction'
              });
              
              logger.info(`Added alternative participant to pending list: ${email} (action required: ${actionRequired})`);
            }
          }
        }
      } else {
        // FINAL FALLBACK: Use our document's recipient list
        logger.warn(`No alternative participant data found, using document recipients as final fallback`);
        logger.info(`Document recipients: ${JSON.stringify(document.recipients, null, 2)}`);
        
        if (document.recipients && document.recipients.length > 0) {
          participantFound = true;
          
          for (const recipient of document.recipients) {
            // If recipient hasn't signed yet (status is not 'signed'), consider them pending
            if (recipient.status !== 'signed' && recipient.status !== 'completed') {
              logger.info(`Found pending recipient from document data: ${recipient.email} with status: ${recipient.status}`);
              
              pendingRecipients.push({
                email: recipient.email,
                name: recipient.name || recipient.email.split('@')[0],
                status: recipient.status || 'WAITING_FOR_MY_SIGNATURE',
                actionRequired: true,
                source: 'document_fallback'
              });
            }
          }
        } else {
          logger.error(`No recipients found in document ${document._id} and no participants from Adobe Sign`);
        }
      }
    }
    
    // Log detailed information for debugging
    logger.info(`Agreement ID: ${document.adobeAgreementId}, Status: ${agreementInfo?.status}`);
    logger.info(`Participant data source: ${participantDataSource}`);
    logger.info(`Total participants: ${participantSets ? participantSets.reduce((total, set) => total + set.memberInfos.length, 0) : 0}`);
    logger.info(`Pending recipients found: ${pendingRecipients.length}`);
    
    // Override pending recipients with actual signing status if available
    if (actualSigningStatus && actualSigningStatus.pendingParticipants && actualSigningStatus.pendingParticipants.length > 0) {
      logger.info(`🔄 Overriding pending recipients with actual signing status analysis`);
      
      // Clear the current pending recipients and rebuild based on actual status
      pendingRecipients.length = 0;
      
      for (const pendingParticipant of actualSigningStatus.pendingParticipants) {
        pendingRecipients.push({
          email: pendingParticipant.email,
          name: pendingParticipant.email.split('@')[0],
          status: 'PENDING_SIGNATURE', // Use a clear status
          actionRequired: true,
          participantId: pendingParticipant.participantId,
          order: pendingParticipant.order,
          source: 'actual_signing_analysis'
        });
        
        logger.info(`✅ Added actually pending recipient: ${pendingParticipant.email} (order: ${pendingParticipant.order})`);
      }
      
      // Log signed participants for reference
      if (actualSigningStatus.signedParticipants && actualSigningStatus.signedParticipants.length > 0) {
        logger.info(`📝 Participants who have already signed:`);
        for (const signedParticipant of actualSigningStatus.signedParticipants) {
          logger.info(`  ✅ ${signedParticipant.email} (order: ${signedParticipant.order})`);
        }
      }
      
      logger.info(`🔄 Updated pending recipients count: ${pendingRecipients.length}`);
    }
    
    // If no participants at all, something might be wrong with the agreement
    if (!participantSets || participantSets.length === 0) {
      logger.warn(`No participant sets found in agreement ${document.adobeAgreementId}`);
      logger.warn(`Available agreement info keys: ${Object.keys(agreementInfo || {}).join(', ')}`);
    }

    // Calculate total participants who are signers (update existing count)
    totalSigners = 0;
    
    if (participantSets && participantSets.length > 0) {
      // Use Adobe Sign data if available
      totalSigners = participantSets.reduce((total, set) => 
        set.role === 'SIGNER' ? total + set.memberInfos.length : total, 0) || 0;
      logger.info(`Calculated total signers from Adobe Sign data: ${totalSigners}`);
    } else if (document.recipients && document.recipients.length > 0) {
      // Fallback to document recipients
      totalSigners = document.recipients.length;
      logger.info(`Using document recipients count as fallback: ${totalSigners}`);
    }
    
    // If we still have no participants but status is OUT_FOR_SIGNATURE, there's likely an issue
    if (totalSigners === 0 && agreementInfo?.status === 'OUT_FOR_SIGNATURE') {
      logger.error(`Agreement ${document.adobeAgreementId} has status OUT_FOR_SIGNATURE but no participants found`);
      logger.error(`Agreement info keys: ${Object.keys(agreementInfo || {}).join(', ')}`);
      
      // Check if participants are in a different field
      if (agreementInfo?.participants) {
        logger.info(`Found participants in different field: ${JSON.stringify(agreementInfo.participants, null, 2)}`);
      }
      if (agreementInfo?.recipientSetInfos) {
        logger.info(`Found recipientSetInfos: ${JSON.stringify(agreementInfo.recipientSetInfos, null, 2)}`);
      }
    }
    
    // Count participants by status
    const participantCounts = {
      total: totalSigners,
      pending: pendingRecipients.length,
      actionRequired: pendingRecipients.filter(r => r.actionRequired).length,
      waiting: pendingRecipients.filter(r => !r.actionRequired).length,
      completed: 0
    };
    
    // Count completed participants by checking all participants in the sets
    if (participantSets && participantSets.length > 0) {
      for (const participantSet of participantSets) {
        if (participantSet.role === 'SIGNER') {
          for (const participant of participantSet.memberInfos) {
          const memberIsCompleted = 
            participant.status === 'SIGNED' ||
            participant.status === 'APPROVED' ||
            participant.status === 'ACCEPTED' ||
            participant.status === 'FORM_FILLED' ||
            participant.status === 'DELEGATED' ||
            participant.status === 'COMPLETED';
          
          if (memberIsCompleted) {
            participantCounts.completed++;
          }
        }
        }
      }
    }
    
    logger.info(`Participant counts: ${JSON.stringify(participantCounts)}`);
    
    // Additional logging for sequential signing analysis
    if (pendingRecipients.length > 0) {
      logger.info('Pending recipients details:');
      pendingRecipients.forEach((recipient, index) => {
        logger.info(`  ${index + 1}. ${recipient.email} - Status: ${recipient.status}, Action Required: ${recipient.actionRequired}, Order: ${recipient.order || 'N/A'}`);
      });
    }
    
    // For sequential signing, identify the current signer and filter to only send reminders to them
    // For parallel signing, send reminders to all who can currently sign
    let recipientsToRemind = [];
    
    // Sort pending recipients by order for analysis (needed in multiple code paths)
    const sortedPendingRecipients = pendingRecipients.sort((a, b) => 
      (a.order || 999) - (b.order || 999)
    );
    
    if (pendingRecipients.length > 0) {
      // PRIORITY 1: Use dynamic actual signing status if available (most accurate)
      if (actualSigningStatus && actualSigningStatus.currentSigner) {
        logger.info(`🎯 Using DYNAMIC signing status to determine current signer: ${actualSigningStatus.currentSigner.email} (order: ${actualSigningStatus.currentSigner.order})`);
        logger.info(`📊 Dynamic status: ${actualSigningStatus.signedParticipants.length} signed, ${actualSigningStatus.pendingParticipants.length} pending`);
        
        // The actualSigningStatus already contains the correct current signer
        // We just need to format it properly for the reminder system
        const currentSigner = {
          email: actualSigningStatus.currentSigner.email,
          name: actualSigningStatus.currentSigner.name || actualSigningStatus.currentSigner.email.split('@')[0],
          status: actualSigningStatus.currentSigner.status || 'PENDING',
          actionRequired: true,
          participantId: actualSigningStatus.currentSigner.id,
          order: actualSigningStatus.currentSigner.order,
          source: 'dynamic_detection'
        };
        
        // CRITICAL CHECK: Make sure we're not sending a reminder to someone who has already signed
        const isAlreadySigned = actualSigningStatus.signedParticipants.some(
          p => p.email.toLowerCase() === currentSigner.email.toLowerCase()
        );
        
        if (isAlreadySigned) {
          logger.warn(`⚠️ Current signer ${currentSigner.email} is actually detected as SIGNED in signedParticipants list - skipping reminder`);
          recipientsToRemind = [];
        } else {
          recipientsToRemind = [currentSigner];
          logger.info(`✅ Dynamic detection - will only send reminder to current signer: ${currentSigner.email}`);
        }
        
        // Log signed participants for reference
        if (actualSigningStatus.signedParticipants.length > 0) {
          logger.info(`📝 Participants who have already signed (${actualSigningStatus.signedParticipants.length}):`);
          actualSigningStatus.signedParticipants.forEach((signed, index) => {
            logger.info(`  ${index + 1}. ✅ ${signed.email} (order: ${signed.order}) - detected by: ${signed.signedDetectedBy || 'dynamic'}`);
          });
        }
        
        // Update pending recipients list to reflect actual status
        pendingRecipients.length = 0; // Clear the array
        pendingRecipients.push(...actualSigningStatus.pendingParticipants.map(p => ({
          email: p.email,
          name: p.name || p.email.split('@')[0],
          status: p.actualStatus || 'PENDING',
          actionRequired: p.canSign !== false,
          participantId: p.id,
          order: p.order,
          source: 'dynamic_detection'
        })));
      } else {
          // Fallback logic with improved sequential signing detection
          logger.info(`📋 Using fallback logic to determine current signer (actualSigningStatus not available or no currentSigner)`);
          
          // Debug: log the actualSigningStatus if it exists but has no currentSigner
          if (actualSigningStatus) {
            logger.info(`⚠️ actualSigningStatus exists but currentSigner is null:`);
            logger.info(`   - Signed participants: ${actualSigningStatus.signedParticipants?.length || 0}`);
            logger.info(`   - Pending participants: ${actualSigningStatus.pendingParticipants?.length || 0}`);
            logger.info(`   - Detection method: ${actualSigningStatus.detectionMethod}`);
          }
          
          // First, try to identify signed vs pending participants more accurately
          const signedParticipants = [];
          const actuallyPendingParticipants = [];
          
          logger.info(`🔍 Analyzing ${sortedPendingRecipients.length} recipients from Adobe Sign data:`);
          
          // Enhanced status analysis - consider more statuses that indicate completion
          for (const recipient of sortedPendingRecipients) {
          const recipientIsCompleted = [
            'SIGNED', 'APPROVED', 'ACCEPTED', 'FORM_FILLED', 
            'DELEGATED', 'COMPLETED', 'DECLINED', 'EXPIRED'
          ].includes(recipient.status);
          
          const recipientIsWaiting = [
            'WAITING_FOR_OTHERS', 'NOT_YET_VISIBLE'
          ].includes(recipient.status);
          
          const recipientCanTakeAction = [
            'WAITING_FOR_MY_SIGNATURE', 'WAITING_FOR_MY_APPROVAL',
              'WAITING_FOR_MY_DELEGATION', 'WAITING_FOR_MY_ACCEPTANCE',
              'WAITING_FOR_MY_FORM_FILLING', 'ACTIVE'
            ].includes(recipient.status);
            
            logger.info(`  � ${recipient.email} (order: ${recipient.order}) - Status: ${recipient.status}`);
            logger.info(`      Completed: ${recipientIsCompleted}, Waiting: ${recipientIsWaiting}, Can Act: ${recipientCanTakeAction}`);
            
            if (recipientIsCompleted) {
              signedParticipants.push(recipient);
              logger.info(`      ✅ Added to signed participants`);
            } else if (recipientCanTakeAction || (!recipientIsWaiting && !recipientIsCompleted)) {
              // Include participants who can take action OR have unknown status (safer approach)
              actuallyPendingParticipants.push({
                ...recipient,
                canTakeActionNow: recipientCanTakeAction,
                statusUncertain: !recipientCanTakeAction && !recipientIsWaiting && !recipientIsCompleted
              });
              logger.info(`      ⏳ Added to pending participants (can act: ${recipientCanTakeAction})`);
            } else {
              logger.info(`      ⏸️ Participant is waiting for others`);
            }
          }
          
          // Determine signing pattern
          const hasMultipleOrders = new Set(sortedPendingRecipients.map(p => p.order).filter(o => o !== undefined)).size > 1;
          const hasSignedAndPending = signedParticipants.length > 0 && actuallyPendingParticipants.length > 0;
          const isSequentialPattern = hasMultipleOrders || hasSignedAndPending;
          
          logger.info(`🔄 Signing pattern analysis:`);
          logger.info(`   - Multiple orders: ${hasMultipleOrders}`);
          logger.info(`   - Has signed and pending: ${hasSignedAndPending}`);
          logger.info(`   - Sequential pattern detected: ${isSequentialPattern}`);
          logger.info(`   - Signed: ${signedParticipants.length}, Pending: ${actuallyPendingParticipants.length}`);
          
          if (isSequentialPattern && actuallyPendingParticipants.length > 0) {
            logger.info(`🔄 Sequential signing detected - finding next signer`);
            
            // In sequential signing, find participants who can take action now
            const canActNow = actuallyPendingParticipants.filter(p => p.canTakeActionNow || p.statusUncertain);
            
            if (canActNow.length > 0) {
              // Sort by order and take the first one
              const nextSigner = canActNow.sort((a, b) => (a.order || 999) - (b.order || 999))[0];
              
              logger.info(`🎯 Next signer identified: ${nextSigner.email} (order: ${nextSigner.order})`);
              logger.info(`   Status: ${nextSigner.status}, Can act now: ${nextSigner.canTakeActionNow}`);
              
              recipientsToRemind = [nextSigner];
            } else {
              logger.info(`⏸️ All pending participants are waiting for others to complete first`);
              
              // In some cases, we might still want to remind the first pending participant
              // This handles edge cases where Adobe Sign status might be inconsistent
              if (actuallyPendingParticipants.length > 0) {
                const firstPending = actuallyPendingParticipants[0];
                logger.info(`🤔 Edge case: Will remind first pending participant: ${firstPending.email}`);
                recipientsToRemind = [firstPending];
              }
            }
            
          } else {
            // Parallel signing or unclear structure
            logger.info(`📊 Parallel signing or unclear pattern detected`);
            
            // For parallel signing, send reminders to all who can take action
            const activeParticipants = actuallyPendingParticipants.filter(r => 
              r.canTakeActionNow || r.statusUncertain
            );
            
            if (activeParticipants.length > 0) {
              logger.info(`📬 Sending reminders to ${activeParticipants.length} active participants`);
              recipientsToRemind = activeParticipants;
              logger.info(`Recipients: ${activeParticipants.map(p => `${p.email} (${p.status})`).join(', ')}`);
            } else {
              logger.info(`⏳ No participants ready to take action right now`);
              
              // Fallback: if we have any pending participants, remind the first one
              if (actuallyPendingParticipants.length > 0) {
                const fallbackRecipient = actuallyPendingParticipants[0];
                logger.info(`🚨 Fallback: Will remind first pending participant: ${fallbackRecipient.email}`);
                recipientsToRemind = [fallbackRecipient];
              }
            }
          }
        }
    
    logger.info(`Participant counts: ${JSON.stringify(participantCounts)}`);
    
    if (recipientsToRemind.length === 0) {
      // Check if there are actually participants
      if (totalSigners === 0) {
        return res.status(200).json(formatResponse(
          200,
          'No participants found in this agreement',
          { 
            pendingRecipients: [],
            agreementStatus: agreementInfo?.status || 'UNKNOWN',
            totalParticipants: 0,
            participantCounts
          }
        ));
      }
      
      return res.status(200).json(formatResponse(
        200,
        'No recipients currently need reminders - either all have completed their actions or are waiting for others to complete first',
        { 
          pendingRecipients: pendingRecipients,
          recipientsToRemind: [],
          agreementStatus: agreementInfo?.status || 'UNKNOWN',
          totalParticipants: totalSigners,
          participantCounts
        }
      ));
    }

    // Build participant IDs list for only those we want to remind
    const reminderParticipantIds = [];
    for (const recipient of recipientsToRemind) {
      if (recipient.participantId && recipient.actionRequired) {
        reminderParticipantIds.push(recipient.participantId);
        logger.info(`Added participant ID for reminder: ${recipient.participantId} (${recipient.email}) with status: ${recipient.status}`);
      }
    }

    // Try to send reminder via Adobe Sign API
    let reminderSent = false;
    let reminderError = null;
    
    try {
      logger.info(`Attempting to send reminder for agreement ${document.adobeAgreementId} to ${recipientsToRemind.length} recipients`);
      
      // Log the access token (partially masked for security)
      const maskedToken = accessToken ? `${accessToken.substring(0, 8)}...${accessToken.substring(accessToken.length - 8)}` : 'null';
      logger.info(`Using access token: ${maskedToken}`);
      
      // Log participant IDs that will be used for the reminder
      logger.info(`Participant IDs for reminder: ${JSON.stringify(reminderParticipantIds)}`);
      
      try {
        // Send the reminder via Adobe Sign API (without specifying participant IDs if none available)
        // This will send to all participants or let Adobe Sign decide based on agreement state
        await sendReminder(
          accessToken, 
          document.adobeAgreementId,
          message || 'Please complete your signature for this important document. Your prompt attention is appreciated.',
          reminderParticipantIds.length > 0 ? reminderParticipantIds : null
        );
        
        logger.info(`Successfully sent reminder via Adobe Sign API for agreement ${document.adobeAgreementId} to ${recipientsToRemind.length} recipients`);
        reminderSent = true;
        
        // Update lastReminderSent timestamps for the recipients who received reminders
        const currentTime = new Date();
        
        // Update recipients who received reminders
        for (const recipient of recipientsToRemind) {
          const dbRecipient = document.recipients.find(r => r.email === recipient.email);
          if (dbRecipient) {
            dbRecipient.lastReminderSent = currentTime;
            logger.info(`Updated lastReminderSent for ${recipient.email} to ${currentTime}`);
          }
        }
        
        // Update document-level reminder info
        document.lastReminderSent = currentTime;
        document.reminderCount = (document.reminderCount || 0) + 1;
        
        // Save the document with updated reminder timestamps
        await document.save();
        logger.info(`Updated document with reminder timestamps and count: ${document.reminderCount}`);
      } catch (error) {
        logger.error(`Error sending reminder via Adobe Sign API: ${error.message}`);
        
        // Log more detailed error information if available
        if (error.response) {
          logger.error(`Adobe Sign API error status: ${error.response.status}`);
          logger.error(`Adobe Sign API error data: ${JSON.stringify(error.response.data || {})}`);
        }
        
        reminderError = `${error.message}`;
        // We'll continue anyway to send backup emails
      }
    } catch (error) {
      logger.error(`Error sending reminder via Adobe Sign API: ${error.message}`);
      
      // Log more detailed error information if available
      if (error.response) {
        logger.error(`Adobe Sign API error status: ${error.response.status}`);
        logger.error(`Adobe Sign API error data: ${JSON.stringify(error.response.data || {})}`);
      }
      
      reminderError = `Unable to send reminder: ${error.message}`;
      // We'll continue anyway to return the list of pending recipients
    }

    // Create log entry
    const logEntry = new Log({
      level: 'info',
      message: `Reminder sent for document ${document._id}`,
      action: 'send_reminder',
      documentId: document._id,
      userId: req.apiKey.userId || req.apiKey._id,
      details: {
        pendingRecipients: pendingRecipients.map(r => r.email),
        recipientsToRemind: recipientsToRemind.map(r => r.email),
        reminderSent,
        reminderError,
        message: message || 'Default reminder message'
      }
    });
    
    await logEntry.save();
    
    // Send emails directly as a backup if Adobe Sign API failed
    if (!reminderSent && recipientsToRemind.length > 0) {
      try {
        for (const recipient of recipientsToRemind) {
          await emailService.sendReminderEmail({
            to: recipient.email,
            name: recipient.name,
            documentName: document.originalName,
            message: message || 'Please sign this document at your earliest convenience.',
            documentId: document._id
          });
        }
        logger.info(`Sent backup reminder emails to ${recipientsToRemind.length} recipients`);
        
        // Update lastReminderSent timestamps for backup email reminders too
        if (recipientsToRemind.length > 0) {
          const currentTime = new Date();
          
          // Update recipients who received backup email reminders
          for (const recipient of recipientsToRemind) {
            const dbRecipient = document.recipients.find(r => r.email === recipient.email);
            if (dbRecipient && !dbRecipient.lastReminderSent) {
              dbRecipient.lastReminderSent = currentTime;
              logger.info(`Updated lastReminderSent for ${recipient.email} via backup email to ${currentTime}`);
            }
          }
          
          // Update document-level reminder info if not already updated
          if (!reminderSent) {
            document.lastReminderSent = currentTime;
            document.reminderCount = (document.reminderCount || 0) + 1;
            await document.save();
            logger.info(`Updated document with backup email reminder timestamps`);
          }
        }
      } catch (emailError) {
        logger.error(`Error sending backup reminder emails: ${emailError.message}`);
      }
    }
    
    // Return response
    res.status(200).json(formatResponse(
      200,
      reminderSent 
        ? `Reminder sent successfully to ${recipientsToRemind.length} recipient(s) who currently need to take action` 
        : recipientsToRemind.length > 0 
          ? `Found ${recipientsToRemind.length} recipient(s) who need reminders, but reminder could not be sent via Adobe Sign`
          : `No recipients currently need reminders - ${pendingRecipients.length} recipient(s) are waiting for others to complete first`,
      {
        recipientsToRemind: recipientsToRemind.map(r => ({
          email: r.email,
          name: r.name,
          status: r.status,
          actionRequired: r.actionRequired
        })),
        allPendingRecipients: pendingRecipients.map(r => ({
          email: r.email,
          name: r.name,
          status: r.status,
          actionRequired: r.actionRequired
        })),
        participantCounts,
        reminderSent,
        reminderError,
        signingFlow: document.signingFlow || 'SEQUENTIAL',
        adobeSignInfo: {
          agreementId: document.adobeAgreementId,
          status: agreementInfo?.status || 'UNKNOWN',
          participantCount: totalSigners,
          participantStatuses: agreementInfo?.participantSets?.flatMap(set => 
            set.memberInfos.map(p => ({ 
              email: p.email, 
              status: p.status,
              role: set.role,
              order: set.order,
              isWaiting: p.status === 'WAITING_FOR_OTHERS',
              requiresAction: ['WAITING_FOR_MY_SIGNATURE', 'WAITING_FOR_MY_APPROVAL', 
                'WAITING_FOR_MY_DELEGATION', 'WAITING_FOR_MY_ACCEPTANCE', 
                'WAITING_FOR_MY_FORM_FILLING'].includes(p.status),
              isComplete: ['SIGNED', 'APPROVED', 'ACCEPTED', 'FORM_FILLED', 
                'DELEGATED', 'COMPLETED'].includes(p.status)
            }))
          ) || []
        },
        documentInfo: {
          id: document._id,
          status: document.status,
          recipientCount: document.recipients.length,
          recipientStatuses: document.recipients.map(r => ({ email: r.email, status: r.status }))
        },
        dynamicDetection: actualSigningStatus ? {
          detectionMethod: actualSigningStatus.detectionMethod,
          signedParticipants: actualSigningStatus.signedParticipants.map(p => ({
            email: p.email,
            order: p.order,
            detectedBy: p.signedDetectedBy || 'unknown'
          })),
          currentSigner: actualSigningStatus.currentSigner ? {
            email: actualSigningStatus.currentSigner.email,
            order: actualSigningStatus.currentSigner.order
          } : null,
          nextSigner: actualSigningStatus.nextSigner ? {
            email: actualSigningStatus.nextSigner.email,
            order: actualSigningStatus.nextSigner.order
          } : null
        } : null,
        alternativeMethod: !reminderSent ? 'Use Adobe Sign web interface to send reminders: https://echosign.adobe.com/' : null
      }
    ));
  }
    
  } catch (error) {
    logger.error(`Error sending reminder: ${error.message}`);
    next(new ApiError(500, `Error sending reminder: ${error.message}`));
  }
};

/**
 * Get signing URL for embedding in iframe
 * @route GET /api/documents/:id/signing-url
 */
exports.getSigningUrl = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    // Find document
    const document = await Document.findById(id);
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }

    // Check if document has Adobe Sign agreement ID
    if (!document.adobeAgreementId) {
      return next(new ApiError(400, 'Document has not been sent for signature yet'));
    }

    // Get access token for Adobe Sign API
    const accessToken = await getAccessToken();
    
    try {
      // Get agreement info to check status and participants
      const agreementInfo = await getAgreementInfo(accessToken, document.adobeAgreementId);
      
      if (agreementInfo.status === 'CANCELLED' || agreementInfo.status === 'EXPIRED') {
        return next(new ApiError(400, `Agreement is ${agreementInfo.status.toLowerCase()}`));
      }
      
      // If specific email is provided, get URL for that participant
      if (email) {
        let participantFound = false;
        let signingUrl = null;
        
        // Check each participant set for the specified email
        if (agreementInfo.participantSets) {
          for (const participantSet of agreementInfo.participantSets) {
            for (const participant of participantSet.memberInfos) {
              if (participant.email.toLowerCase() === email.toLowerCase()) {
                participantFound = true;
                
                // If already signed, return message
                if (participant.status === 'SIGNED') {
                  return res.status(200).json(formatResponse(
                    200,
                    'Participant has already signed this document',
                    {
                      status: 'SIGNED',
                      email: participant.email
                    }
                  ));
                }
                
                // Get signing URL for this participant
                const response = await getSigningUrl(
                  accessToken, 
                  document.adobeAgreementId,
                  participant.participantId
                );
                
                signingUrl = response.signingUrlSetInfos[0].signingUrls[0].esignUrl;
                break;
              }
            }
            if (participantFound) break;
          }
        }
        
        if (!participantFound) {
          return next(new ApiError(404, `Participant with email ${email} not found in this agreement`));
        }
        
        if (!signingUrl) {
          return next(new ApiError(500, 'Failed to retrieve signing URL'));
        }
        
        // Create log entry
        const logEntry = new Log({
          level: 'info',
          message: `Retrieved signing URL for ${email}`,
          action: 'get_signing_url',
          documentId: document._id,
          userId: req.apiKey.userId || req.apiKey._id,
          details: {
            email,
            agreementId: document.adobeAgreementId
          }
        });
        
        await logEntry.save();
        
        return res.status(200).json(formatResponse(
          200,
          'Signing URL retrieved successfully',
          {
            signingUrl,
            recipient: {
              email,
              status: 'PENDING'
            },
            document: {
              id: document._id,
              name: document.originalName,
              agreementId: document.adobeAgreementId
            }
          }
        ));
      } else {
        // If no email specified, get first available signer URL
        let signingUrl = null;
        let recipientEmail = null;
        let recipientStatus = null;
        
        // Find first pending recipient
        if (agreementInfo.participantSets) {
          for (const participantSet of agreementInfo.participantSets) {
            for (const participant of participantSet.memberInfos) {
              if (participant.status !== 'SIGNED') {
                // Get signing URL for this participant
                const response = await getSigningUrl(
                  accessToken, 
                  document.adobeAgreementId,
                  participant.participantId
                );
                
                signingUrl = response.signingUrlSetInfos[0].signingUrls[0].esignUrl;
                recipientEmail = participant.email;
                recipientStatus = participant.status;
                break;
              }
            }
            if (signingUrl) break;
          }
        }
        
        if (!signingUrl) {
          return res.status(200).json(formatResponse(
            200,
            'No pending signers found. All participants have signed the document.',
            {
              status: 'COMPLETED',
              document: {
                id: document._id,
                name: document.originalName,
                agreementId: document.adobeAgreementId
              }
            }
          ));
        }
        
        // Create log entry
        const logEntry = new Log({
          level: 'info',
          message: `Retrieved signing URL for ${recipientEmail}`,
          action: 'get_signing_url',
          documentId: document._id,
          userId: req.apiKey.userId || req.apiKey._id,
          details: {
            email: recipientEmail,
            agreementId: document.adobeAgreementId
          }
        });
        
        await logEntry.save();
        
        return res.status(200).json(formatResponse(
          200,
          'Signing URL retrieved successfully',
          {
            signingUrl,
            recipient: {
              email: recipientEmail,
              status: recipientStatus
            },
            document: {
              id: document._id,
              name: document.originalName,
              agreementId: document.adobeAgreementId
            }
          }
        ));
      }
    } catch (error) {
      logger.error(`Error getting signing URL: ${error.message}`);
      return next(new ApiError(500, `Error getting signing URL: ${error.message}`));
    }
  } catch (error) {
    logger.error(`Error getting signing URL: ${error.message}`);
    next(new ApiError(500, `Error getting signing URL: ${error.message}`));
  }
};

/**
 * Get signing URLs for all recipients
 * @route GET /api/documents/:id/signing-urls
 */
exports.getAllSigningUrls = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Find document
    const document = await Document.findById(id);
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }

    // Check if document has Adobe Sign agreement ID
    if (!document.adobeAgreementId) {
      return next(new ApiError(400, 'Document has not been sent for signature yet'));
    }

    // Get access token for Adobe Sign API
    const accessToken = await getAccessToken();
    
    try {
      // Get agreement info to check status and participants
      const agreementInfo = await getAgreementInfo(accessToken, document.adobeAgreementId);
      
      if (agreementInfo.status === 'CANCELLED' || agreementInfo.status === 'EXPIRED') {
        return next(new ApiError(400, `Agreement is ${agreementInfo.status.toLowerCase()}`));
      }
      
      const recipients = [];
      
      // Process each participant
      if (agreementInfo.participantSets) {
        for (const participantSet of agreementInfo.participantSets) {
          for (const participant of participantSet.memberInfos) {
            const recipientInfo = {
              email: participant.email,
              name: participant.name || participant.email.split('@')[0],
              status: participant.status,
              participantId: participant.participantId
            };
            
            // Skip if already signed
            if (participant.status === 'SIGNED') {
              recipientInfo.signingUrl = null;
              recipientInfo.message = 'Participant has already signed';
            } else {
              try {
                // Get signing URL for this participant
                const response = await getSigningUrl(
                  accessToken, 
                  document.adobeAgreementId,
                  participant.participantId
                );
                
                recipientInfo.signingUrl = response.signingUrlSetInfos[0].signingUrls[0].esignUrl;
              } catch (urlError) {
                logger.error(`Error getting signing URL for ${participant.email}: ${urlError.message}`);
                recipientInfo.signingUrl = null;
                recipientInfo.error = 'Failed to retrieve signing URL';
              }
            }
            
            recipients.push(recipientInfo);
          }
        }
      }
      
      // Create log entry
      const logEntry = new Log({
        level: 'info',
        message: `Retrieved signing URLs for document ${document._id}`,
        action: 'get_all_signing_urls',
        documentId: document._id,
        userId: req.apiKey.userId || req.apiKey._id,
        details: {
          agreementId: document.adobeAgreementId,
          recipientCount: recipients.length
        }
      });
      
      await logEntry.save();
      
      return res.status(200).json(formatResponse(
        200,
        'Signing URLs retrieved successfully',
        {
          recipients,
          document: {
            id: document._id,
            name: document.originalName,
            agreementId: document.adobeAgreementId,
            status: agreementInfo.status
          }
        }
      ));
    } catch (error) {
      logger.error(`Error getting signing URLs: ${error.message}`);
      return next(new ApiError(500, `Error getting signing URLs: ${error.message}`));
    }
  } catch (error) {
    logger.error(`Error getting signing URLs: ${error.message}`);
    next(new ApiError(500, `Error getting signing URLs: ${error.message}`));
  }
};

/**
 * Download document
 * @route GET /api/documents/:id/download
 */
exports.downloadDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { format } = req.query;

    // Find document
    const document = await Document.findById(id);
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }

    // Determine which file to download
    let filePath;
    let fileName;
    
    if (document.status === 'signed' && document.signedDocumentPath) {
      // Return the signed document if available
      filePath = document.signedDocumentPath;
      fileName = `${path.basename(document.originalName, path.extname(document.originalName))}_signed${path.extname(document.signedDocumentPath)}`;
    } else if (document.convertedFilePath) {
      // Return the converted PDF
      filePath = document.convertedFilePath;
      fileName = `${path.basename(document.originalName, path.extname(document.originalName))}_converted.pdf`;
    } else if (document.processedFilePath) {
      // Return the processed file
      filePath = document.processedFilePath;
      fileName = `${path.basename(document.originalName, path.extname(document.originalName))}_processed${path.extname(document.processedFilePath)}`;
    } else {
      // Return the original file
      filePath = document.filePath;
      fileName = document.originalName;
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return next(new ApiError(404, 'File not found on server'));
    }

    // Create log entry
    const logEntry = new Log({
      level: 'info',
      message: `Document ${document._id} downloaded`,
      action: 'download_document',
      documentId: document._id,
      userId: req.apiKey.userId || req.apiKey._id,
      details: {
        fileName,
        documentStatus: document.status
      }
    });
    
    await logEntry.save();

    // If document is signed but we don't have a local copy, try to download from Adobe Sign
    if (document.status === 'signed' && document.adobeAgreementId && !document.signedDocumentPath) {
      try {
        // Get access token for Adobe Sign API
        const accessToken = await getAccessToken();
        
        // Download the document
        const tempFilePath = path.join(
          path.dirname(document.filePath), 
          `${path.basename(document.filePath, path.extname(document.filePath))}_signed.pdf`
        );
        
        // Download signed agreement from Adobe Sign
        const fileBuffer = await downloadSignedDocument(accessToken, document.adobeAgreementId);
        
        // Save the file
        fs.writeFileSync(tempFilePath, fileBuffer);
        
        // Update document record
        document.signedDocumentPath = tempFilePath;
        await document.save();
        
        // Update the file path to download
        filePath = tempFilePath;
        fileName = `${path.basename(document.originalName, path.extname(document.originalName))}_signed.pdf`;
        
        logger.info(`Downloaded signed document from Adobe Sign for ${document._id}`);
      } catch (error) {
        logger.error(`Error downloading signed document from Adobe Sign: ${error.message}`);
        // Continue with what we have locally
      }
    }

    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', mime.lookup(filePath) || 'application/octet-stream');
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    logger.error(`Error downloading document: ${error.message}`);
    next(new ApiError(500, `Error downloading document: ${error.message}`));
  }
};

/**
 * Check and update the signature status of a document
 * @route POST /api/documents/:id/update-status
 */
exports.updateSignatureStatus = async (req, res, next) => {
  try {
    const documentId = req.params.id;
    
    // Find document
    const document = await Document.findById(documentId);
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    // Check if document has an Adobe agreement ID
    if (!document.adobeAgreementId) {
      return next(new ApiError(400, 'Document has not been sent for signature yet'));
    }
    
    // Get access token
    const accessToken = await getAccessToken();
    
    // Get agreement info
    const agreementInfo = await getAgreementInfo(accessToken, document.adobeAgreementId);
    
    logger.info(`Retrieved agreement info for ${documentId}, status: ${agreementInfo.status}`);
    
    // Update document status based on agreement status
    switch (agreementInfo.status) {
      case 'SIGNED':
        document.status = 'completed';
        break;
      case 'CANCELLED':
        document.status = 'cancelled';
        break;
      case 'EXPIRED':
        document.status = 'expired';
        break;
      case 'OUT_FOR_SIGNATURE':
      case 'OUT_FOR_APPROVAL':
        // Check if partially signed
        if (document.recipients.some(r => r.status === 'signed')) {
          document.status = 'partially_signed';
        } else {
          document.status = 'sent_for_signature';
        }
        break;
      default:
        document.status = 'sent_for_signature';
    }
    
    // Update recipient status
    if (agreementInfo.participantSets && agreementInfo.participantSets.length > 0) {
      for (const participantSet of agreementInfo.participantSets) {
        for (const participant of participantSet.memberInfos) {
          // Find matching recipient by email
          const recipientIndex = document.recipients.findIndex(
            r => r.email.toLowerCase() === participant.email.toLowerCase()
          );
          
          if (recipientIndex !== -1) {
            // Update recipient status
            const recipient = document.recipients[recipientIndex];
            
            switch (participant.status) {
              case 'SIGNED':
                recipient.status = 'signed';
                // Only update signedAt if not already set
                if (!recipient.signedAt) {
                  recipient.signedAt = new Date();
                }
                break;
              case 'APPROVED':
                recipient.status = 'signed';
                // Only update signedAt if not already set
                if (!recipient.signedAt) {
                  recipient.signedAt = new Date();
                }
                break;
              case 'WAITING_FOR_MY_SIGNATURE':
              case 'WAITING_FOR_MY_APPROVAL':
                recipient.status = 'pending';
                break;
              case 'WAITING_FOR_OTHERS':
                recipient.status = 'waiting';
                break;
              case 'DECLINED':
                recipient.status = 'declined';
                break;
              case 'EXPIRED':
                recipient.status = 'expired';
                break;
              case 'NOT_YET_VISIBLE':
                recipient.status = 'pending';
                break;
              default:
                // Keep existing status if unknown
                break;
            }
            
            logger.info(`Updated recipient ${recipient.email} status to ${recipient.status}`);
          }
        }
      }
    }
    
    // Save updated document
    await document.save();
    
    // Return updated document
    return res.status(200).json(formatResponse('Document signature status updated successfully', {
      document: documentUtils.sanitizeDocument(document)
    }));
  } catch (error) {
    logger.error(`Error updating signature status: ${error.message}`);
    return next(new ApiError(500, `Failed to update signature status: ${error.message}`));
  }
};

/**
 * Recover document from socket hang up error
 * @route POST /api/documents/:id/recover
 */
