const Document = require('../models/document.model');
const Log = require('../models/log.model');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');
const documentUtils = require('../utils/documentUtils');
const documentProcessor = require('../utils/documentProcessor');
const rateLimitProtection = require('../utils/rateLimitProtection');

// Import enhanced Adobe Sign client
const { 
  getAccessToken, 
  uploadTransientDocument, 
  getAgreementInfo, 
  getSigningUrl
} = require('../config/adobeSign');

const fs = require('fs');
const path = require('path');
const { createAgreementWithBestApproach, verifyAdobeSignTextTags } = require('../utils/adobeSignFormFields');
const adobeSignTagHandler = require('../utils/adobeSignTagHandler');
const urlUtils = require('../utils/urlUtils');

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
      if (recipient.email && recipient.name && !emailSet.has(recipient.email.toLowerCase())) {
        emailSet.add(recipient.email.toLowerCase());
        recipients.push({
          name: recipient.name,
          email: recipient.email,
          title: recipient.title || '',
          signatureField: recipient.signatureField || `signature_${index + 1}`
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
    ];
    
    // Extract recipients based on field patterns
    recipientFields.forEach((fieldSet, index) => {
      const name = templateData[fieldSet.nameField];
      const email = templateData[fieldSet.emailField];
      const title = templateData[fieldSet.titleField] || '';
      
      if (name && email && !emailSet.has(email.toLowerCase())) {
        emailSet.add(email.toLowerCase());
        recipients.push({
          name,
          email,
          title,
          signatureField: `signature_${index + 1}`
        });
      }
    });
  }
  
  logger.info(`Extracted ${recipients.length} unique recipients for signature from template data`);
  return recipients;
};

/**
 * Combined endpoint: Upload document with data, prepare, and send for signature
 * Supports all three upload methods:
 * 1. File upload with JSON data file
 * 2. Document URL with JSON data file(s)
 * 3. Document URL with inline JSON data
 * @route POST /api/documents/upload-and-send
 */
exports.uploadPrepareAndSend = async (req, res, next) => {
  try {
    // Step 1: Upload and process document - support all three upload methods
    let filePath = null;
    let filename = null;
    let originalname = null;
    let mimetype = null;
    let size = null;
    
    // Method 1: File upload (original uploadDocumentWithData)
    if (req.files && (req.files.document || req.files.documents)) {
      // Support both 'document' and 'documents' field names
      const documentFile = req.files.document ? req.files.document[0] : req.files.documents[0];
      ({ filename, originalname, mimetype, size, path: filePath } = documentFile);
      logger.info(`Method 1: File upload - ${originalname}`);
    }
    // Method 2 & 3: Document URL (from uploadDocumentFromUrl)
    else if (req.body.documentUrl) {
      const documentUrl = req.body.documentUrl;
      
      if (!documentUrl) {
        return next(new ApiError(400, 'Document URL is required when not uploading a file'));
      }
      
      // Download document from URL
      try {
        const downloadResult = await urlUtils.downloadDocumentFromUrl(documentUrl);
        
        filePath = downloadResult.filePath;
        originalname = downloadResult.originalName;
        filename = downloadResult.filename;
        mimetype = downloadResult.mimeType;
        size = downloadResult.size;
        
        logger.info(`Method 2/3: URL download - ${documentUrl} -> ${originalname}`);
      } catch (downloadError) {
        logger.error(`Error downloading document from URL: ${downloadError.message}`);
        return next(new ApiError(400, `Failed to download document from URL: ${downloadError.message}`));
      }
    }
    else {
      return next(new ApiError(400, 'No document uploaded or document URL provided. Please provide either a file upload or documentUrl in request body.'));
    }

    // Parse JSON data - support multiple sources
    let templateData = {};
    
    // Method 1: JSON data from uploaded file
    const dataFile = req.files && req.files.data ? req.files.data[0] : null;
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
    
    // Method 2: Multiple JSON files (from uploadDocumentFromUrl with files)
    if (!dataFile && req.files && req.files.jsonData) {
      try {
        const jsonFiles = Array.isArray(req.files.jsonData) ? req.files.jsonData : [req.files.jsonData];
        let combinedData = {};
        
        for (const file of jsonFiles) {
          const jsonContent = fs.readFileSync(file.path, 'utf8');
          const parsedData = JSON.parse(jsonContent);
          combinedData = { ...combinedData, ...parsedData };
          
          // Clean up the temporary JSON file
          fs.unlinkSync(file.path);
        }
        
        templateData = combinedData;
        logger.info(`Combined JSON data from ${jsonFiles.length} files with ${Object.keys(templateData).length} total variables`);
      } catch (jsonError) {
        logger.error(`Error processing JSON files: ${jsonError.message}`);
        return next(new ApiError(400, 'Invalid JSON data files'));
      }
    }
    
    // Method 3: JSON data from request body (templateData or jsonData field)
    if (!dataFile && !templateData && (req.body.templateData || req.body.jsonData)) {
      try {
        const jsonSource = req.body.templateData || req.body.jsonData;
        templateData = typeof jsonSource === 'string' 
          ? JSON.parse(jsonSource) 
          : jsonSource;
        logger.info(`Inline JSON data processed with ${Object.keys(templateData).length} variables`);
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

    // Process document based on file type
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
        return next(new ApiError(400, `Error processing document: ${processingError.message}`));
      }
    } else {
      return next(new ApiError(400, 'Unsupported file format. Please upload PDF, DOCX, or DOC files.'));
    }
    
    // Set page count and final status
    documentData.pageCount = pageCount;
    documentData.status = 'uploaded';
    
    // Create document record
    const document = new Document(documentData);
    await document.save();
    
    logger.info(`Document uploaded successfully: ${document.originalName}`);
    
    // Step 2: Prepare for signature (reuse prepareForSignature logic)
    let { recipients, signatureFieldMapping, signingFlow } = req.body;
    
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
      : 'SEQUENTIAL'; // Default to sequential
    
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
    
    logger.info(`Document prepared for signature: ${document.originalName}`);
    
    // Step 3: Send for signature (reuse sendForSignature logic)
    // First check if we're currently rate limited by Adobe Sign
    if (rateLimitProtection.isRateLimited()) {
      const timeRemaining = rateLimitProtection.getTimeRemaining();
      const status = rateLimitProtection.getRateLimitStatus();
      
      logger.warn(`Rate limit check failed: ${status}`);
      return next(new ApiError(429, `Adobe Sign rate limit in effect. Please try again after ${Math.ceil(timeRemaining / 60)} minutes.`));
    }
    
    // Validate Adobe Sign configuration
    const { validateAdobeSignConfig } = require('../config/adobeSign');
    const configValidation = validateAdobeSignConfig();
    
    if (!configValidation.isValid) {
      logger.error('Adobe Sign configuration validation failed:', configValidation.errors);
      return next(new ApiError(500, `Adobe Sign configuration error: ${configValidation.errors.join(', ')}`));
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
      
      // Priority 1: Use processed DOCX file if template variables were processed (KEEP IT EDITABLE)
      if (document.processedFilePath && fs.existsSync(document.processedFilePath)) {
        fileToUpload = document.processedFilePath;
        logger.info(`Using processed DOCX file with template variables: ${document.processedFilePath}`);
        logger.info(`This keeps the document editable in Adobe Sign for form fields and signatures`);
      }
      // Priority 2: Use converted PDF file only if no processed DOCX exists
      else if (document.pdfFilePath && fs.existsSync(document.pdfFilePath)) {
        fileToUpload = document.pdfFilePath;
        logger.info(`Using converted PDF file: ${document.pdfFilePath}`);
      }
      // Priority 3: Use original file
      else {
        logger.info(`Using original file: ${fileToUpload}`);
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
        const accessToken = await getAccessToken();
        const webhookUrl = process.env.ADOBE_WEBHOOK_URL || `${req.protocol}://${req.get('host')}/api/webhooks/adobe-sign`;
        const isHttps = webhookUrl.startsWith('https://');
        
        if (!isHttps && process.env.NODE_ENV === 'production') {
          logger.warn(`Skipping webhook setup as Adobe Sign requires HTTPS URLs in production: ${webhookUrl}`);
        } else if (webhookUrl) {
          try {
            const createWebhookLocal = require('../config/createWebhook');
            const webhookResult = await createWebhookLocal(accessToken, webhookUrl);
            
            if (webhookResult._mockImplementation) {
              logger.info(`Mock webhook setup for Adobe Sign: ${webhookUrl} (reason: ${webhookResult._mockReason || 'mock'})`);
            } else {
              logger.info(`Real webhook setup for Adobe Sign: ${webhookUrl}`);
            }
          } catch (innerWebhookError) {
            logger.error(`Inner webhook error: ${innerWebhookError.message}`);
          }
        } else {
          logger.warn('No webhook URL configured for Adobe Sign updates');
        }
      } catch (webhookError) {
        logger.error(`Error setting up webhook: ${webhookError.message}`);
      }
      
      // Use the comprehensive approach from adobeSignFormFields utility
      logger.info(`Using comprehensive approach to create agreement: ${document.originalName}`);
      const result = await createAgreementWithBestApproach(
        transientDocumentId,
        document.recipients,
        document.originalName,
        {
          templateId: document.templateId,
          autoDetectedSignatureFields: document.autoDetectedSignatureFields || [],
          signingFlow: document.signingFlow || 'SEQUENTIAL'
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
      
      // Step 4: Get and store signing URLs for all recipients
      try {
        const accessToken = await getAccessToken();
        const agreementInfo = await getAgreementInfo(accessToken, document.adobeAgreementId);
        
        if (agreementInfo.participantSets) {
          // Map recipients to participant sets and get their signing URLs
          for (const recipient of document.recipients) {
            for (const participantSet of agreementInfo.participantSets) {
              for (const participant of participantSet.memberInfos) {
                if (participant.email.toLowerCase() === recipient.email.toLowerCase()) {
                  try {
                    // Get signing URL for this participant
                    const signingUrlResponse = await getSigningUrl(
                      accessToken, 
                      document.adobeAgreementId,
                      participant.participantId
                    );
                    
                    if (signingUrlResponse.signingUrlSetInfos && 
                        signingUrlResponse.signingUrlSetInfos[0] && 
                        signingUrlResponse.signingUrlSetInfos[0].signingUrls && 
                        signingUrlResponse.signingUrlSetInfos[0].signingUrls[0]) {
                      
                      recipient.signingUrl = signingUrlResponse.signingUrlSetInfos[0].signingUrls[0].esignUrl;
                      logger.info(`Stored signing URL for ${recipient.email}`);
                    }
                  } catch (signingUrlError) {
                    logger.error(`Error getting signing URL for ${recipient.email}: ${signingUrlError.message}`);
                    // Continue with other recipients even if one fails
                  }
                  break;
                }
              }
            }
          }
          
          // Save the document with updated signing URLs
          await document.save();
        }
      } catch (signingUrlError) {
        logger.error(`Error retrieving signing URLs: ${signingUrlError.message}`);
        // Continue anyway - signing URLs can be retrieved later if needed
      }
      
      // Log document sent for signature
      await Log.create({
        level: 'info',
        message: `Document uploaded, prepared, and sent for signature using ${result.method} approach: ${document.originalName}`,
        documentId: document._id,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
        requestMethod: req.method,
        metadata: {
          adobeAgreementId: result.agreementId,
          method: result.method,
          recipientCount: document.recipients.length,
          combined_operation: true,
          upload_method: req.body.documentUrl ? 'url_download' : 'file_upload',
          template_variables_count: Object.keys(templateData).length
        }
      });
      
      logger.info(`Document uploaded, prepared, and sent for signature using ${result.method} approach: ${document.originalName}`);
      
      res.status(201).json(formatResponse(
        201,
        `Document uploaded, prepared, and sent for signature successfully using ${result.method} approach`,
        { 
          document,
          adobeAgreementId: result.agreementId,
          method: result.method,
          uploadMethod: req.body.documentUrl ? 'url_download' : 'file_upload',
          templateVariablesProcessed: Object.keys(templateData).length,
          signingUrls: document.recipients.map(r => ({
            email: r.email,
            name: r.name,
            signingUrl: r.signingUrl
          })).filter(r => r.signingUrl)
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
