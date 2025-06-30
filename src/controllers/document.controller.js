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
  getComprehensiveAgreementInfo,
  getActualSigningStatus,
  sendReminder, 
  createWebhook, 
  getSigningUrl, 
  downloadSignedDocument 
} = require('../config/adobeSign');

const fs = require('fs');
const path = require('path');
const mime = require('mime');
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
  
  // Add debug logging to see what template data we're working with
  logger.info('Template data structure:', JSON.stringify(templateData, null, 2));
  
  // PRIORITY 1: Check for explicit recipients array first
  if (templateData.recipients && Array.isArray(templateData.recipients) && templateData.recipients.length > 0) {
    logger.info(`Using explicit recipients array from template data (${templateData.recipients.length} recipients found)`);
    templateData.recipients.forEach((recipient, index) => {
      logger.info(`Processing recipient ${index + 1}:`, JSON.stringify(recipient, null, 2));
      if (recipient.email && recipient.name && !emailSet.has(recipient.email.toLowerCase())) {
        emailSet.add(recipient.email.toLowerCase());
        recipients.push({
          name: recipient.name,
          email: recipient.email,
          title: recipient.title || '',
          signatureField: recipient.signatureField || `signature_${index + 1}`
        });
        logger.info(`Added recipient: ${recipient.name} (${recipient.email}) with signature field: ${recipient.signatureField || `signature_${index + 1}`}`);
      } else {
        if (!recipient.email || !recipient.name) {
          logger.warn(`Skipping invalid recipient ${index + 1}: missing email (${recipient.email}) or name (${recipient.name})`);
        } else {
          logger.warn(`Skipping duplicate recipient ${index + 1}: email ${recipient.email} already processed`);
        }
      }
    });
  } else {
    // PRIORITY 2: Fall back to individual field patterns only if no recipients array
    logger.info('No recipients array found, extracting from individual fields');
    logger.info('Available template data keys:', Object.keys(templateData));
    const recipientFields = [
      { nameField: 'signerName', emailField: 'signerEmail', titleField: 'signerTitle' },
      { nameField: 'clientName', emailField: 'clientEmail', titleField: 'clientTitle' },
      { nameField: 'witnessName', emailField: 'witnessEmail', titleField: 'witnessTitle' },
      { nameField: 'recipientName', emailField: 'recipientEmail', titleField: 'recipientTitle' },
      { nameField: 'name', emailField: 'email', titleField: 'title' },
      { nameField: 'signer_name', emailField: 'signer_email', titleField: 'signer_title' },
      { nameField: 'client_name', emailField: 'client_email', titleField: 'client_title' }
    ];
    
    // Extract recipients based on field patterns
    recipientFields.forEach((fieldSet, index) => {
      const name = templateData[fieldSet.nameField];
      const email = templateData[fieldSet.emailField];
      const title = templateData[fieldSet.titleField] || '';
      
      logger.info(`Checking field set ${index + 1}: ${fieldSet.nameField}=${name}, ${fieldSet.emailField}=${email}, ${fieldSet.titleField}=${title}`);
      
      if (name && email && !emailSet.has(email.toLowerCase())) {
        emailSet.add(email.toLowerCase());
        recipients.push({
          name,
          email,
          title,
          signatureField: `signature_${index + 1}`
        });
        logger.info(`Added recipient from individual fields: ${name} (${email})`);
      } else {
        if (!name || !email) {
          logger.warn(`Skipping field set ${index + 1}: missing name (${name}) or email (${email})`);
        } else {
          logger.warn(`Skipping field set ${index + 1}: duplicate email (${email})`);
        }
      }
    });
    
    // PRIORITY 3: Try to find any email-like fields if still no recipients found
    if (recipients.length === 0) {
      logger.info('No recipients found from standard patterns, trying flexible extraction');
      
      // Look for any fields that contain "email" and try to find corresponding name fields
      const allKeys = Object.keys(templateData);
      const emailKeys = allKeys.filter(key => 
        key.toLowerCase().includes('email') && 
        templateData[key] && 
        typeof templateData[key] === 'string' &&
        templateData[key].includes('@')
      );
      
      logger.info(`Found potential email fields: ${emailKeys.join(', ')}`);
      
      emailKeys.forEach((emailKey, index) => {
        const email = templateData[emailKey];
        if (!emailSet.has(email.toLowerCase())) {
          // Try to find a corresponding name field
          const possibleNameKeys = [
            emailKey.replace(/email/i, 'name'),
            emailKey.replace(/email/i, 'Name'),
            emailKey.replace(/Email/i, 'Name'),
            emailKey.replace(/_email/i, '_name'),
            emailKey.replace(/Email/i, ''),
            'name',
            'Name',
            'full_name',
            'fullName'
          ];
          
          let name = null;
          for (const nameKey of possibleNameKeys) {
            if (templateData[nameKey] && typeof templateData[nameKey] === 'string') {
              name = templateData[nameKey];
              break;
            }
          }
          
          // If no name found, generate one from email
          if (!name) {
            name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          }
          
          emailSet.add(email.toLowerCase());
          recipients.push({
            name,
            email,
            title: '',
            signatureField: `signature_${recipients.length + 1}`
          });
          logger.info(`Added recipient from flexible extraction: ${name} (${email})`);
        }
      });
    }
  }
  
  logger.info(`Final result: Extracted ${recipients.length} unique recipients for signature from template data`);
  return recipients;
};

/**
 * Helper function to retry signing URL generation
 * @param {string} agreementId - Adobe Sign agreement ID
 * @param {string} documentId - MongoDB document ID
 */
const retrySigningUrlGeneration = async (agreementId, documentId) => {
  try {
    logger.info(`Retrying signing URL generation for agreement: ${agreementId}`);
    
    const accessToken = await getAccessToken();
    const agreementInfo = await getAgreementInfo(accessToken, agreementId);
    const document = await Document.findById(documentId);
    
    if (!document) {
      throw new Error('Document not found for retry');
    }
    
    // Check for participant sets
    const participantSets = agreementInfo.participantSets || 
                           agreementInfo.participantSetsInfo || 
                           agreementInfo.participants ||
                           [];
    
    if (participantSets && participantSets.length > 0) {
      logger.info(`Retry: Found ${participantSets.length} participant sets`);
      
      for (const recipient of document.recipients) {
        if (recipient.signingUrl) {
          continue; // Skip if already has URL
        }
        
        for (const participantSet of participantSets) {
          const memberInfos = participantSet.memberInfos || 
                            participantSet.members || 
                            participantSet.participantSetMemberInfos ||
                            [];
          
          for (const participant of memberInfos) {
            if (participant.email && participant.email.toLowerCase() === recipient.email.toLowerCase()) {
              try {
                const signingUrlResponse = await getSigningUrl(accessToken, agreementId, recipient.email);
                
                if (signingUrlResponse.signingUrlSetInfos && 
                    signingUrlResponse.signingUrlSetInfos[0] && 
                    signingUrlResponse.signingUrlSetInfos[0].signingUrls && 
                    signingUrlResponse.signingUrlSetInfos[0].signingUrls[0]) {
                  
                  recipient.signingUrl = signingUrlResponse.signingUrlSetInfos[0].signingUrls[0].esignUrl;
                  logger.info(`✅ Retry success: Got signing URL for ${recipient.email}`);
                }
              } catch (urlError) {
                logger.error(`Retry URL error for ${recipient.email}: ${urlError.message}`);
              }
              break;
            }
          }
        }
      }
      
      await document.save();
      const urlCount = document.recipients.filter(r => r.signingUrl).length;
      logger.info(`Retry completed: ${urlCount}/${document.recipients.length} recipients now have signing URLs`);
    } else {
      logger.warn('Retry: Still no participant sets found');
    }
  } catch (error) {
    logger.error(`Retry signing URL generation failed: ${error.message}`);
    throw error;
  }
};

/**
 * Get all documents for user
 * @route GET /api/documents
 */
exports.getDocuments = async (req, res, next) => {
  try {
    const documents = await Document.find().sort({ createdAt: -1 });
    
    res.json(formatResponse(
      200,
      'Documents retrieved successfully',
      { documents, count: documents.length }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Get specific document by ID
 * @route GET /api/documents/:id
 */
exports.getDocument = async (req, res, next) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    res.json(formatResponse(
      200,
      'Document retrieved successfully',
      { document }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Check document status and sync with Adobe Sign
 * @route GET /api/documents/:id/status
 */
exports.checkDocumentStatus = async (req, res, next) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    let updatedDocument = document;
    
    // If document has Adobe agreement ID, check status
    if (document.adobeAgreementId) {
      try {
        logger.info(`Starting Adobe Sign status check for agreement: ${document.adobeAgreementId}`);
        const accessToken = await getAccessToken();
        logger.info(`Got access token: ${accessToken.substring(0, 20)}...`);
        
        const agreementInfo = await getComprehensiveAgreementInfo(accessToken, document.adobeAgreementId);
        logger.info(`Successfully retrieved agreement info from Adobe Sign`);
        
        // Log the Adobe Sign response for debugging
        logger.info(`Adobe Sign agreement info for ${document.adobeAgreementId}:`, {
          status: agreementInfo.status,
          participantSetsCount: agreementInfo.participantSets?.length || 0,
          participantSetsData: JSON.stringify(agreementInfo.participantSets, null, 2)
        });
        
        // Also log the entire response structure for debugging
        logger.debug(`Complete Adobe Sign response structure:`, JSON.stringify(agreementInfo, null, 2));
        
        // Update document status based on Adobe Sign status
        if (agreementInfo.status) {
          const oldStatus = document.status;
          // Convert Adobe Sign status to our format
          const newStatus = agreementInfo.status.toLowerCase().replace(/\s+/g, '_');
          
          if (oldStatus !== newStatus) {
            document.status = newStatus;
            logger.info(`Document status updated from ${oldStatus} to ${document.status} (Adobe: ${agreementInfo.status})`);
          } else {
            logger.debug(`Document status unchanged: ${document.status}`);
          }
        }
        
        // Update recipient statuses - check both possible locations for participant sets
        let participantSets = agreementInfo.participantSets || 
                              (agreementInfo.participants && agreementInfo.participants.participantSets) ||
                              [];
        
        if (participantSets && participantSets.length > 0) {
          logger.info(`Processing ${participantSets.length} participant sets for status update`);
          
          let recipientUpdatesCount = 0;
          
          participantSets.forEach((participantSet, setIndex) => {
            logger.info(`Participant set ${setIndex}:`, {
              order: participantSet.order,
              role: participantSet.role,
              status: participantSet.status,
              memberInfosCount: participantSet.memberInfos?.length || 0
            });
            
            if (participantSet.memberInfos) {
              participantSet.memberInfos.forEach((member, memberIndex) => {
                logger.info(`Member ${memberIndex} in set ${setIndex}:`, {
                  email: member.email,
                  status: member.status,
                  completedDate: member.completedDate,
                  userId: member.userId,
                  accessDate: member.accessDate,
                  lastViewedDate: member.lastViewedDate
                });
                
                const recipient = document.recipients.find(r => 
                  r.email.toLowerCase() === member.email.toLowerCase()
                );
                
                if (recipient) {
                  logger.info(`Found matching recipient for ${member.email}: ${recipient.name}`);
                  
                  const oldStatus = recipient.status;
                  const oldOrder = recipient.order;
                  
                  let changesMade = false;
                  
                  // Update order from Adobe Sign participant set (for proper sequential signing)
                  if (participantSet.order !== undefined && participantSet.order !== null) {
                    if (recipient.order !== participantSet.order) {
                      recipient.order = participantSet.order;
                      logger.info(`Recipient ${recipient.email} order updated from ${oldOrder} to ${recipient.order}`);
                      changesMade = true;
                    }
                  }
                  
                  // Map Adobe Sign statuses to our enum values
                  const statusMapping = {
                    'ACTIVE': 'sent',
                    'OUT_FOR_SIGNATURE': 'sent', 
                    'WAITING_FOR_VERIFICATION': 'sent',
                    'WAITING_FOR_FAXING': 'sent',
                    'WAITING_FOR_MY_SIGNATURE': 'sent',
                    'WAITING_FOR_COUNTER_SIGNATURE': 'sent',
                    'WAITING_FOR_MY_REVIEW': 'sent',
                    'WAITING_FOR_MY_ACKNOWLEDGEMENT': 'sent',
                    'DELEGATED': 'sent',
                    'COMPLETED': 'signed',
                    'SIGNED': 'signed',
                    'FORM_FILLED': 'signed',
                    'APPROVED': 'signed',
                    'ACKNOWLEDGED': 'signed',
                    'ACCEPTED': 'signed',
                    'DELIVERED': 'signed',
                    'DECLINED': 'declined',
                    'CANCELLED': 'declined',
                    'REJECTED': 'declined',
                    'EXPIRED': 'expired',
                    'RECALLED': 'expired',
                    'WAITING_FOR_AUTHORING': 'waiting',
                    'WAITING_FOR_MY_APPROVAL': 'waiting',
                    'AUTHORING': 'waiting',
                    'NOT_YET_VISIBLE': 'pending'
                  };
                  
                  const adobeStatus = member.status?.toUpperCase();
                  const newStatus = statusMapping[adobeStatus] || member.status?.toLowerCase() || 'pending';
                  
                  // Only update status if it has actually changed
                  if (oldStatus !== newStatus) {
                    recipient.status = newStatus;
                    logger.info(`Recipient ${recipient.email} status updated from ${oldStatus} to ${recipient.status} (Adobe status: ${adobeStatus})`);
                    changesMade = true;
                  } else {
                    logger.debug(`No status change for ${recipient.email}: remains ${recipient.status} (Adobe status: ${adobeStatus})`);
                  }
                  
                  // Update signedAt timestamp when status becomes 'signed'
                  if (recipient.status === 'signed' && member.completedDate && !recipient.signedAt) {
                    recipient.signedAt = new Date(member.completedDate);
                    logger.info(`Updated signedAt for ${recipient.email}: ${recipient.signedAt}`);
                    changesMade = true;
                  } else if (recipient.status === 'signed' && !member.completedDate && !recipient.signedAt) {
                    // Fallback: use current timestamp if Adobe doesn't provide completedDate
                    recipient.signedAt = new Date();
                    logger.info(`Set signedAt to current time for ${recipient.email} (no completedDate from Adobe)`);
                    changesMade = true;
                  }
                  
                  // Update lastSigningUrlAccessed if member has accessDate or similar
                  if (member.accessDate || member.lastViewedDate) {
                    const lastAccessed = new Date(member.accessDate || member.lastViewedDate);
                    if (!recipient.lastSigningUrlAccessed || recipient.lastSigningUrlAccessed.getTime() !== lastAccessed.getTime()) {
                      recipient.lastSigningUrlAccessed = lastAccessed;
                      logger.info(`Updated lastSigningUrlAccessed for ${recipient.email}: ${recipient.lastSigningUrlAccessed}`);
                      changesMade = true;
                    }
                  }
                  
                  if (changesMade) {
                    recipientUpdatesCount++;
                  }
                  
                  // Log detailed member data for debugging
                  logger.debug(`Adobe member data for ${recipient.email}:`, {
                    status: member.status,
                    completedDate: member.completedDate,
                    accessDate: member.accessDate,
                    lastViewedDate: member.lastViewedDate,
                    participantSetOrder: participantSet.order,
                    participantSetStatus: participantSet.status
                  });
                } else {
                  logger.warn(`No matching recipient found for Adobe Sign member: ${member.email}`);
                }
              });
            }
          });
          
          logger.info(`Total recipient updates made: ${recipientUpdatesCount}`);
        } else {
          logger.info('No participant sets found in Adobe Sign response');
          
          // Log available keys for debugging
          logger.info(`Available Adobe Sign response keys: ${Object.keys(agreementInfo).join(', ')}`);
          
          // Check for alternative participant info structures
          if (agreementInfo.participantSetsInfo) {
            logger.info('Found participantSetsInfo in response, but using participantSets for consistency');
          }
          if (agreementInfo.participants) {
            logger.info('Found participants array in response');
          }
        }
        
        await document.save();
        updatedDocument = document;
        
        // Log final recipient statuses after update
        logger.info('Final recipient statuses after Adobe Sign sync:');
        document.recipients.forEach((recipient, index) => {
          logger.info(`  ${index + 1}. ${recipient.name} (${recipient.email}): order=${recipient.order}, status=${recipient.status}, signedAt=${recipient.signedAt}`);
        });
        
      } catch (adobeError) {
        logger.error(`Error checking Adobe Sign status: ${adobeError.message}`);
        logger.error(`Adobe Sign error details:`, adobeError);
        
        // Log the full error for debugging
        if (adobeError.response) {
          logger.error(`Adobe Sign API Response Status: ${adobeError.response.status}`);
          logger.error(`Adobe Sign API Response Data:`, adobeError.response.data);
        }
        
        // Add helpful guidance for common issues
        let errorGuidance = '';
        if (adobeError.message.includes('integration key not configured')) {
          errorGuidance = 'Adobe Sign integration not configured. Set ADOBE_SIGN_CLIENT_ID and other credentials in .env file.';
        } else if (adobeError.message.includes('401') || adobeError.message.includes('unauthorized')) {
          errorGuidance = 'Adobe Sign authentication failed. Check API credentials.';
        } else if (adobeError.message.includes('404') || adobeError.message.includes('not found')) {
          errorGuidance = 'Adobe Sign agreement not found. It may have been deleted or expired.';
        }
        
        // Continue with existing document data but include error info in response
        updatedDocument.adobeSyncError = {
          message: adobeError.message,
          guidance: errorGuidance,
          lastAttempt: new Date()
        };
      }
    }
    
    res.json(formatResponse(
      200,
      'Document status retrieved successfully',
      { 
        document: updatedDocument,
        lastChecked: new Date()
      }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Get signing URL for a specific recipient
 * @route GET /api/documents/:id/signing-url
 */
exports.getSigningUrl = async (req, res, next) => {
  try {
    const { recipientEmail } = req.query;
    
    if (!recipientEmail) {
      return next(new ApiError(400, 'Recipient email is required'));
    }
    
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    if (!document.adobeAgreementId) {
      return next(new ApiError(400, 'Document has not been sent for signature yet'));
    }
    
    try {
      const accessToken = await getAccessToken();
      
      // Use email address directly to get signing URL
      const signingUrlResponse = await getSigningUrl(accessToken, document.adobeAgreementId, recipientEmail);
      
      if (signingUrlResponse.signingUrlSetInfos && 
          signingUrlResponse.signingUrlSetInfos[0] && 
          signingUrlResponse.signingUrlSetInfos[0].signingUrls && 
          signingUrlResponse.signingUrlSetInfos[0].signingUrls[0]) {
        
        const signingUrl = signingUrlResponse.signingUrlSetInfos[0].signingUrls[0].esignUrl;
        
        // Update the stored signing URL for this recipient
        const recipient = document.recipients.find(r => 
          r.email.toLowerCase() === recipientEmail.toLowerCase()
        );
        if (recipient) {
          recipient.signingUrl = signingUrl;
          await document.save();
        }
        
        res.json(formatResponse(
          200,
          'Signing URL retrieved successfully',
          { 
            signingUrl,
            recipientEmail,
            documentId: document._id,
            documentName: document.originalName
          }
        ));
      } else {
        return next(new ApiError(500, 'Unable to retrieve signing URL from Adobe Sign'));
      }
      
    } catch (adobeError) {
      logger.error(`Adobe Sign API Error: ${adobeError.message}`);
      return next(new ApiError(500, `Failed to get signing URL: ${adobeError.message}`));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Get signing URLs for all recipients
 * @route GET /api/documents/:id/signing-urls
 */
exports.getAllSigningUrls = async (req, res, next) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    if (!document.adobeAgreementId) {
      return next(new ApiError(400, 'Document has not been sent for signature yet'));
    }
    
    try {
      const accessToken = await getAccessToken();
      const signingUrls = [];
      
      // Process each recipient directly using their email
      for (const recipient of document.recipients) {
        try {
          // Get signing URL for this recipient using email
          const signingUrlResponse = await getSigningUrl(accessToken, document.adobeAgreementId, recipient.email);
          
          if (signingUrlResponse.signingUrlSetInfos && 
              signingUrlResponse.signingUrlSetInfos[0] && 
              signingUrlResponse.signingUrlSetInfos[0].signingUrls && 
              signingUrlResponse.signingUrlSetInfos[0].signingUrls[0]) {
            
            const signingUrl = signingUrlResponse.signingUrlSetInfos[0].signingUrls[0].esignUrl;
            recipient.signingUrl = signingUrl;
            
            signingUrls.push({
              name: recipient.name,
              email: recipient.email,
              status: recipient.status,
              signingUrl: signingUrl
            });
          } else {
            signingUrls.push({
              name: recipient.name,
              email: recipient.email,
              status: recipient.status,
              error: 'No signing URL available (may not be ready to sign)'
            });
          }
        } catch (urlError) {
          logger.error(`Error getting signing URL for ${recipient.email}: ${urlError.message}`);
          signingUrls.push({
            name: recipient.name,
            email: recipient.email,
            status: recipient.status,
            error: 'Unable to retrieve signing URL'
          });
        }
      }
      
      // Save updated signing URLs
      await document.save();
      
      res.json(formatResponse(
        200,
        'Signing URLs retrieved successfully',
        { 
          documentId: document._id,
          documentName: document.originalName,
          signingUrls
        }
      ));
      
    } catch (adobeError) {
      logger.error(`Adobe Sign API Error: ${adobeError.message}`);
      return next(new ApiError(500, `Failed to get signing URLs: ${adobeError.message}`));
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
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    if (!document.adobeAgreementId) {
      return next(new ApiError(400, 'Document has not been sent for signature yet'));
    }
    
    const accessToken = await getAccessToken();
    
    // Track whether Adobe Sign sync succeeded for accurate reminder targeting
    let adobeSyncSucceeded = false;
    let participantSets = [];
    
    // First, update document status from Adobe Sign to ensure accurate recipient statuses before filtering
    try {
      const agreementInfo = await getComprehensiveAgreementInfo(accessToken, document.adobeAgreementId);
      
      logger.info('=== REMINDER: Updating recipient statuses from Adobe Sign ===');
      logger.info(`Agreement status: ${agreementInfo.status}`);
      
      // Update recipient statuses - check both possible locations for participant sets
      participantSets = agreementInfo.participantSets || 
                        (agreementInfo.participants && agreementInfo.participants.participantSets) ||
                        [];
      
      if (participantSets && participantSets.length > 0) {
        adobeSyncSucceeded = true;
      }
      
      logger.info(`Participant sets count: ${participantSets.length || 0}`);
      
      // Use the same logic as checkDocumentStatus for consistency
      if (participantSets && participantSets.length > 0) {
        logger.info(`Processing ${participantSets.length} participant sets for reminder status update`);
        
        participantSets.forEach((participantSet, setIndex) => {
          logger.info(`Participant set ${setIndex}:`, {
            order: participantSet.order,
            role: participantSet.role,
            status: participantSet.status,
            memberInfosCount: participantSet.memberInfos?.length || 0
          });
          
          if (participantSet.memberInfos) {
            participantSet.memberInfos.forEach((member, memberIndex) => {
              logger.info(`Member ${memberIndex} in set ${setIndex}:`, {
                email: member.email,
                status: member.status,
                completedDate: member.completedDate,
                userId: member.userId
              });
              
              const recipient = document.recipients.find(r => 
                r.email.toLowerCase() === member.email.toLowerCase()
              );
              
              if (recipient) {
                const oldStatus = recipient.status;
                const oldOrder = recipient.order;
                
                // Update order from Adobe Sign participant set (for proper sequential signing)
                if (participantSet.order !== undefined && participantSet.order !== null) {
                  recipient.order = participantSet.order;
                  if (oldOrder !== recipient.order) {
                    logger.info(`REMINDER: Recipient ${recipient.email} order updated from ${oldOrder} to ${recipient.order}`);
                  }
                }
                
                // Map Adobe Sign statuses to our enum values (same as checkDocumentStatus)
                const statusMapping = {
                  'ACTIVE': 'sent',
                  'OUT_FOR_SIGNATURE': 'sent', 
                  'WAITING_FOR_VERIFICATION': 'sent',
                  'WAITING_FOR_FAXING': 'sent',
                  'WAITING_FOR_MY_SIGNATURE': 'sent',
                  'WAITING_FOR_COUNTER_SIGNATURE': 'sent',
                  'WAITING_FOR_MY_REVIEW': 'sent',
                  'WAITING_FOR_MY_ACKNOWLEDGEMENT': 'sent',
                  'DELEGATED': 'sent',
                  'COMPLETED': 'signed',
                  'SIGNED': 'signed',
                  'FORM_FILLED': 'signed',
                  'APPROVED': 'signed',
                  'ACKNOWLEDGED': 'signed',
                  'ACCEPTED': 'signed',
                  'DELIVERED': 'signed',
                  'DECLINED': 'declined',
                  'CANCELLED': 'declined',
                  'REJECTED': 'declined',
                  'EXPIRED': 'expired',
                  'RECALLED': 'expired',
                  'WAITING_FOR_AUTHORING': 'waiting',
                  'WAITING_FOR_MY_APPROVAL': 'waiting',
                  'AUTHORING': 'waiting',
                  'NOT_YET_VISIBLE': 'pending'
                };
                
                const adobeStatus = member.status?.toUpperCase();
                const newStatus = statusMapping[adobeStatus] || member.status?.toLowerCase() || 'pending';
                
                // Only update status if it has actually changed
                if (oldStatus !== newStatus) {
                  recipient.status = newStatus;
                  logger.info(`REMINDER: Recipient ${recipient.email} status updated from ${oldStatus} to ${recipient.status} (Adobe status: ${adobeStatus})`);
                } else {
                  logger.debug(`REMINDER: No status change for ${recipient.email}: remains ${recipient.status} (Adobe status: ${adobeStatus})`);
                }
                
                // Update signedAt timestamp when status becomes 'signed'
                if (recipient.status === 'signed' && member.completedDate && !recipient.signedAt) {
                  recipient.signedAt = new Date(member.completedDate);
                  logger.info(`REMINDER: Updated signedAt for ${recipient.email}: ${recipient.signedAt}`);
                } else if (recipient.status === 'signed' && !member.completedDate && !recipient.signedAt) {
                  // Fallback: use current timestamp if Adobe doesn't provide completedDate
                  recipient.signedAt = new Date();
                  logger.info(`REMINDER: Set signedAt to current time for ${recipient.email} (no completedDate from Adobe)`);
                }
                
                // Update lastSigningUrlAccessed if member has accessDate or similar
                if (member.accessDate || member.lastViewedDate) {
                  recipient.lastSigningUrlAccessed = new Date(member.accessDate || member.lastViewedDate);
                  logger.info(`REMINDER: Updated lastSigningUrlAccessed for ${recipient.email}: ${recipient.lastSigningUrlAccessed}`);
                }
              } else {
                logger.warn(`REMINDER: Member ${member.email} not found in local recipients`);
              }
            });
          }
        });
        
        await document.save();
        
        // Log final recipient statuses after update
        logger.info('REMINDER: Final recipient statuses after Adobe Sign sync:');
        document.recipients.forEach((recipient, index) => {
          logger.info(`  ${index + 1}. ${recipient.name} (${recipient.email}): order=${recipient.order}, status=${recipient.status}, signedAt=${recipient.signedAt}`);
        });
        
        logger.info('Updated recipient statuses from Adobe Sign before sending reminders');
      } else {
        logger.warn('REMINDER: No participant sets found in Adobe Sign response');
      }
    } catch (statusError) {
      logger.error(`Error updating status before reminder: ${statusError.message}`);
      
      // Check if this is an agreement access issue
      if (statusError.message.includes('not found') || 
          statusError.message.includes('permission') ||
          statusError.message.includes('404') ||
          statusError.message.includes('403') ||
          statusError.message.includes('401') ||
          statusError.message.includes('Failed to get agreement info via any method')) {
        
        // Update document status to indicate the agreement is no longer accessible
        document.status = 'expired';
        document.errorMessage = `Agreement no longer accessible: ${statusError.message}`;
        await document.save();
        
        // Log this as a warning
        await Log.create({
          level: 'warn',
          message: `Agreement no longer accessible - marked as expired: ${document.originalName}`,
          documentId: document._id,
          ipAddress: req.ip,
          requestPath: req.originalUrl,
          requestMethod: req.method,
          metadata: {
            agreementId: document.adobeAgreementId,
            error: statusError.message
          }
        });
        
        return res.json(formatResponse(
          200,
          'Document agreement is no longer accessible and has been marked as expired',
          { 
            documentId: document._id,
            documentName: document.originalName,
            status: 'expired',
            reason: 'Agreement not found or expired in Adobe Sign'
          }
        ));
      }
      
      // For other errors, check if this is a configuration issue that would affect reminder accuracy
      if (statusError.message.includes('integration key not configured') || 
          statusError.message.includes('authentication') ||
          statusError.message.includes('credentials')) {
        
        logger.error(`Adobe Sign not configured - cannot sync statuses before reminder: ${statusError.message}`);
        
        // Return an informative error instead of sending potentially incorrect reminders
        return res.status(400).json(formatResponse(
          400,
          'Cannot send reminders: Adobe Sign integration is not configured, so recipient statuses cannot be verified',
          { 
            documentId: document._id,
            documentName: document.originalName,
            error: 'Adobe Sign integration required for accurate reminder targeting',
            suggestion: 'Configure Adobe Sign integration or manually check recipient statuses before sending reminders'
          }
        ));
      }
      
      // For other errors, continue but log the warning with emphasis on potential inaccuracy
      logger.warn(`⚠️  Could not update status from Adobe Sign - reminders may be sent to recipients who have already signed: ${statusError.message}`);
      logger.warn(`⚠️  Database shows recipients with potentially stale statuses. Manual verification recommended.`);
    }
    
    // Find recipients who haven't signed yet (WARNING: may use stale statuses if Adobe sync failed)
    const unsignedRecipients = document.recipients.filter(recipient => 
      !['signed', 'completed', 'delivered', 'declined'].includes(recipient.status?.toLowerCase())
    );
    
    // Log warning if Adobe sync failed and we're using potentially stale data
    if (!adobeSyncSucceeded) {
      logger.warn(`⚠️  REMINDER WARNING: Adobe Sign status sync failed. Using database statuses which may be outdated.`);
      logger.warn(`⚠️  This may result in sending reminders to recipients who have already signed.`);
      logger.warn(`⚠️  Found ${unsignedRecipients.length} 'unsigned' recipients based on database data:`);
      unsignedRecipients.forEach((r, i) => {
        logger.warn(`⚠️    ${i+1}. ${r.email} (status: ${r.status}, last updated: ${r.updatedAt || 'unknown'})`);
      });
    }
    
    if (unsignedRecipients.length === 0) {
      return res.json(formatResponse(
        200,
        'All recipients have already signed the document',
        { 
          documentId: document._id,
          documentName: document.originalName,
          allRecipientsSigned: true
        }
      ));
    }
    
    // Get agreement info to extract participant IDs for unsigned recipients
    let unsignedParticipantIds = [];
    try {
      const agreementInfo = await getComprehensiveAgreementInfo(accessToken, document.adobeAgreementId);
      
      // Use participantSets which contains the proper structure (consistent with status update)
      const participantSets = agreementInfo.participantSets || 
                              (agreementInfo.participants && agreementInfo.participants.participantSets) ||
                              [];
      
      // Extract participant IDs for unsigned recipients only
      // IMPORTANT: Only send reminders to recipients whose turn it is to sign (based on signing order)
      if (participantSets.length > 0) {
        logger.info(`REMINDER: Processing ${participantSets.length} participant sets for reminder targeting`);
        
        // Sort participant sets by order to handle sequential signing correctly
        const sortedParticipantSets = participantSets
          .map((set, index) => ({ ...set, originalIndex: index }))
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        
        // Determine if this is sequential or parallel signing
        const orders = sortedParticipantSets.map(set => set.order || 0);
        const uniqueOrders = [...new Set(orders)];
        const isSequentialSigning = uniqueOrders.length === sortedParticipantSets.length;
        
        logger.info(`REMINDER: Signing type: ${isSequentialSigning ? 'Sequential' : 'Parallel/Mixed'} (Orders: ${orders.join(', ')})`);
        
        let activeParticipantSets = [];
        
        if (isSequentialSigning) {
          // Sequential signing: Find the first incomplete participant set
          // A set is complete if ALL its members are signed/completed/declined
          const firstIncompleteSet = sortedParticipantSets.find(set => {
            // Check if the set status indicates completion
            if (["SIGNED", "COMPLETED", "DECLINED"].includes(set.status)) {
              logger.info(`REMINDER: Skipping completed set with order ${set.order} (status: ${set.status})`);
              return false; // Set is complete
            }
            // If set status is undefined/unknown, check member statuses
            if (set.memberInfos && set.memberInfos.length > 0) {
              // Only return true if at least one member is unsigned
              const hasUnsignedMembers = set.memberInfos.some(member => !["SIGNED", "COMPLETED", "DECLINED"].includes(member.status));
              if (hasUnsignedMembers) {
                logger.info(`REMINDER: Found incomplete set with order ${set.order} - has unsigned members`);
              } else {
                logger.info(`REMINDER: Skipping set with order ${set.order} - all members are signed`);
              }
              return hasUnsignedMembers;
            }
            return true; // If no member info, assume incomplete
          });

          if (firstIncompleteSet) {
            // Only include unsigned members whose turn it is
            activeParticipantSets = [firstIncompleteSet];
            logger.info(`REMINDER: Sequential signing: Next to sign is order ${firstIncompleteSet.order} (set status: ${firstIncompleteSet.status || 'undefined'})`);
            // Log member statuses for debugging
            if (firstIncompleteSet.memberInfos) {
              firstIncompleteSet.memberInfos.forEach(member => {
                logger.info(`  REMINDER: Member: ${member.email} (status: ${member.status})`);
              });
            }
          } else {
            logger.info('REMINDER: Sequential signing: All participant sets are complete');
          }
        } else {
          // Parallel/Mixed signing: Find all active participant sets
          // A set is active if it has at least one unsigned member
          activeParticipantSets = sortedParticipantSets.filter(set => {
            // Check if the set status indicates completion
            if (["SIGNED", "COMPLETED", "DECLINED"].includes(set.status)) {
              return false; // Set is complete
            }
            // If set status is undefined/unknown, check member statuses
            if (set.memberInfos && set.memberInfos.length > 0) {
              return set.memberInfos.some(member => !["SIGNED", "COMPLETED", "DECLINED"].includes(member.status));
            }
            return true; // If no member info, assume active
          });
          logger.info(`REMINDER: Parallel/Mixed signing: ${activeParticipantSets.length} active participant sets`);
        }

        // Extract participant IDs from active participant sets only, and only for unsigned members
        activeParticipantSets.forEach(participantSet => {
          logger.info(`REMINDER: Processing active participant set with order ${participantSet.order}, role: ${participantSet.role}`);
          if (participantSet.role === 'SIGNER' || participantSet.role === 'FORM_FILLER') {
            participantSet.memberInfos.forEach(member => {
              // Find matching unsigned recipient in our database
              const unsignedRecipient = unsignedRecipients.find(r => r.email.toLowerCase() === member.email.toLowerCase());
              // Only include if this member is unsigned
              const isUnsigned = !["SIGNED", "COMPLETED", "DECLINED"].includes(member.status);
              if (unsignedRecipient && member.id && isUnsigned) {
                unsignedParticipantIds.push(member.id);
                logger.info(`REMINDER: Found participant whose turn it is to sign: ${member.id} for ${member.email} (status: ${member.status}, order: ${participantSet.order})`);
              } else {
                if (!unsignedRecipient) {
                  logger.info(`REMINDER: Member ${member.email} not found in unsigned recipients list`);
                } else if (!isUnsigned) {
                  logger.info(`REMINDER: Member ${member.email} is already signed (status: ${member.status})`);
                } else if (!member.id) {
                  logger.info(`REMINDER: Member ${member.email} has no participant ID`);
                }
              }
            });
          }
        });

        // For sequential signing, filter unsignedRecipients to only those whose turn it is (and are unsigned)
        if (isSequentialSigning && activeParticipantSets.length > 0) {
          const activeEmails = [];
          activeParticipantSets.forEach(set => {
            set.memberInfos?.forEach(member => {
              if (!["SIGNED", "COMPLETED", "DECLINED"].includes(member.status)) {
                activeEmails.push(member.email.toLowerCase());
                logger.info(`REMINDER: Adding ${member.email} to active emails list (status: ${member.status})`);
              }
            });
          });
          // Only keep unsigned recipients whose turn it is
          const filteredRecipients = unsignedRecipients.filter(r => activeEmails.includes(r.email.toLowerCase()));
          logger.info(`REMINDER: Filtering unsignedRecipients from ${unsignedRecipients.length} to ${filteredRecipients.length} recipients whose turn it is`);
          unsignedRecipients.splice(0, unsignedRecipients.length, ...filteredRecipients);
        }
      } else {
        logger.warn('REMINDER: No participant sets found for reminder targeting');
      }
    } catch (participantError) {
      logger.error(`Error extracting participant IDs: ${participantError.message}`);
      
      // Check if this is an agreement access issue
      if (participantError.message.includes('not found') || 
          participantError.message.includes('permission') ||
          participantError.message.includes('404') ||
          participantError.message.includes('403') ||
          participantError.message.includes('401') ||
          participantError.message.includes('Failed to get agreement info via any method')) {
        
        // Update document status to indicate the agreement is no longer accessible
        document.status = 'expired';
        document.errorMessage = `Agreement no longer accessible: ${participantError.message}`;
        await document.save();
        
        // Log this as a warning
        await Log.create({
          level: 'warn',
          message: `Agreement no longer accessible - marked as expired: ${document.originalName}`,
          documentId: document._id,
          ipAddress: req.ip,
          requestPath: req.originalUrl,
          requestMethod: req.method,
          metadata: {
            agreementId: document.adobeAgreementId,
            error: participantError.message,
            unsignedRecipientsCount: unsignedRecipients.length
          }
        });
          
        return res.json(formatResponse(
          200,
          'Document agreement is no longer accessible and has been marked as expired',
          { 
            documentId: document._id,
            documentName: document.originalName,
            status: 'expired',
            reason: 'Agreement not found or expired in Adobe Sign',
            unsignedRecipients: unsignedRecipients.map(r => ({
              name: r.name,
              email: r.email,
              status: r.status
            }))
          }
        ));
      }
      
      // For other errors, throw the original error
      throw new ApiError(500, 'Failed to extract recipient information for reminders');
    }
    
    if (unsignedParticipantIds.length === 0) {
      throw new ApiError(400, 'No valid unsigned participants found for reminder');
    }
    
    // Send Adobe Sign API reminder to unsigned recipients only
    try {
      const message = req.body.message || 'Please sign this document at your earliest convenience.';
      await sendReminder(accessToken, document.adobeAgreementId, message, unsignedParticipantIds);
      
      // Update reminder timestamps for all unsigned recipients
      const currentTime = new Date();
      unsignedRecipients.forEach(recipient => {
        recipient.lastReminderSent = currentTime;
      });
      
      // Update document-level reminder info
      document.lastReminderSent = currentTime;
      document.reminderCount = (document.reminderCount || 0) + 1;
      
      await document.save();
      
      logger.info(`Adobe Sign reminder sent successfully to ${unsignedRecipients.length} unsigned recipient${unsignedRecipients.length === 1 ? '' : 's'} for document: ${document.originalName}`);
      
    } catch (adobeError) {
      logger.error(`Adobe Sign reminder failed: ${adobeError.message}`);
      
      // Check if the agreement is no longer accessible (expired, deleted, etc.)
      if (adobeError.message.includes('not found') || 
          adobeError.message.includes('permission') ||
          adobeError.message.includes('404') ||
          adobeError.message.includes('403') ||
          adobeError.message.includes('401') ||
          adobeError.message.includes('Failed to get agreement info via any method')) {
        
        // Update document status to indicate the agreement is no longer accessible
        document.status = 'expired';
        document.errorMessage = `Agreement no longer accessible: ${adobeError.message}`;
        await document.save();
        
        // Log this as a warning rather than an error
        await Log.create({
          level: 'warn',
          message: `Agreement no longer accessible for reminder - marked as expired: ${document.originalName}`,
          documentId: document._id,
          ipAddress: req.ip,
          requestPath: req.originalUrl,
          requestMethod: req.method,
          metadata: {
            agreementId: document.adobeAgreementId,
            error: adobeError.message,
            unsignedRecipientsCount: unsignedRecipients.length
          }
        });
        
        return res.json(formatResponse(
          200,
          'Document agreement is no longer accessible and has been marked as expired',
          { 
            documentId: document._id,
            documentName: document.originalName,
            status: 'expired',
            reason: 'Agreement not found or expired in Adobe Sign',
            unsignedRecipients: unsignedRecipients.map(r => ({
              name: r.name,
              email: r.email,
              status: r.status
            }))
          }
        ));
      }
      
      // For other errors, still throw the error
      throw new ApiError(500, `Failed to send reminder via Adobe Sign: ${adobeError.message}`);
    }
    
    // Log the reminder activity
    await Log.create({
      level: 'info',
      message: `Reminders sent successfully to ${unsignedRecipients.length} unsigned recipient${unsignedRecipients.length === 1 ? '' : 's'} for document: ${document.originalName}`,
      documentId: document._id,
      ipAddress: req.ip,
      requestPath: req.originalUrl,
      requestMethod: req.method,
      metadata: {
        unsignedRecipientsCount: unsignedRecipients.length,
        reminderMethod: 'adobe_sign_api',
        participantIds: unsignedParticipantIds,
        reminderCount: document.reminderCount
      }
    });
    
    // Build the response data
    const responseData = { 
      documentId: document._id,
      documentName: document.originalName,
      unsignedRecipients: unsignedRecipients.map(r => ({
        name: r.name,
        email: r.email,
        status: r.status,
        statusDescription: r.status === 'sent' ? 'Sent for signature but not yet signed' : 
                         r.status === 'pending' ? 'Pending to be sent' :
                         r.status === 'viewed' ? 'Viewed but not signed' :
                         r.status,
        lastReminderSent: r.lastReminderSent
      })),
      reminderMethod: 'adobe_sign_api',
      totalReminderCount: document.reminderCount,
      note: 'Reminders are sent only to recipients whose turn it is to sign based on the signing order. Recipients with status "sent" have received the document but have not signed it yet.'
    };

    // Add warning if Adobe Sign sync failed
    if (!adobeSyncSucceeded) {
      responseData.warning = 'Adobe Sign status synchronization failed. Reminders were sent based on database statuses which may be outdated. Some recipients who have already signed in Adobe Sign may have received unnecessary reminders.';
      responseData.recommendation = 'Configure Adobe Sign integration for accurate reminder targeting, or manually verify recipient statuses before sending reminders.';
    }

    res.json(formatResponse(
      200,
      `Reminders sent successfully to ${unsignedRecipients.length} unsigned recipient${unsignedRecipients.length === 1 ? '' : 's'}`,
      responseData
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Update signature status manually
 * @route POST /api/documents/:id/update-status
 */
exports.updateSignatureStatus = async (req, res, next) => {
  try {
    const { recipientEmail, status, signedAt } = req.body;
    
    if (!recipientEmail || !status) {
      return next(new ApiError(400, 'Recipient email and status are required'));
    }
    
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    // Find and update recipient
    const recipient = document.recipients.find(r => 
      r.email.toLowerCase() === recipientEmail.toLowerCase()
    );
    
    if (!recipient) {
      return next(new ApiError(404, 'Recipient not found in document'));
    }
    
    const oldStatus = recipient.status;
    recipient.status = status;
    
    if (signedAt) {
      recipient.signedAt = new Date(signedAt);
    } else if (status === 'signed' && !recipient.signedAt) {
      recipient.signedAt = new Date();
    }
    
    // Check if all recipients have signed
    const allSigned = document.recipients.every(r => 
      ['signed', 'completed', 'delivered'].includes(r.status?.toLowerCase())
    );
    
    if (allSigned && document.status !== 'completed') {
      document.status = 'completed';
    }
    
    await document.save();
    
    // Log the status update
    await Log.create({
      level: 'info',
      message: `Status updated for ${recipientEmail} from ${oldStatus} to ${status}`,
      documentId: document._id,
      ipAddress: req.ip,
      requestPath: req.originalUrl,
      requestMethod: req.method,
      metadata: {
        recipientEmail,
        oldStatus,
        newStatus: status,
        allSigned
      }
    });
    
    res.json(formatResponse(
      200,
      'Signature status updated successfully',
      { 
        document,
        updatedRecipient: {
          email: recipient.email,
          name: recipient.name,
          oldStatus,
          newStatus: status,
          signedAt: recipient.signedAt
        },
        allSigned
      }
    ));
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
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    let fileToDownload = null;
    
    // If document has been signed and we have Adobe agreement ID, try to download signed version
    if (document.adobeAgreementId && ['completed', 'signed'].includes(document.status)) {
      try {
        const accessToken = await getAccessToken();
        const signedDocumentBuffer = await downloadSignedDocument(accessToken, document.adobeAgreementId);
        
        // Save signed document to file system for future downloads
        const signedFileName = `signed_${document.filename}`;
        const signedFilePath = path.join(path.dirname(document.filePath), signedFileName);
        
        fs.writeFileSync(signedFilePath, signedDocumentBuffer);
        fileToDownload = signedFilePath;
        
        logger.info(`Downloaded signed document from Adobe Sign: ${document.originalName}`);
      } catch (downloadError) {
        logger.error(`Error downloading signed document: ${downloadError.message}`);
        // Fall back to original file
        fileToDownload = document.pdfFilePath || document.filePath;
      }
    } else {
      // Use the PDF version if available, otherwise original
      fileToDownload = document.pdfFilePath || document.filePath;
    }
    
    // Check if file exists
    if (!fs.existsSync(fileToDownload)) {
      return next(new ApiError(404, 'Document file not found on server'));
    }
    
    // Get file stats
    const stats = fs.statSync(fileToDownload);
    const mimeType = mime.getType(fileToDownload) || 'application/octet-stream';
    
    // Set response headers
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${document.originalName}"`);
    
    // Stream the file
    const fileStream = fs.createReadStream(fileToDownload);
    fileStream.pipe(res);
    
    // Log the download
    await Log.create({
      level: 'info',
      message: `Document downloaded: ${document.originalName}`,
      documentId: document._id,
      ipAddress: req.ip,
      requestPath: req.originalUrl,
      requestMethod: req.method,
      metadata: {
        fileSize: stats.size,
        mimeType,
        isSigned: fileToDownload.includes('signed_')
      }
    });
    
  } catch (error) {
    next(error);
  }
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
        
        filePath = downloadResult.path;
        originalname = downloadResult.originalName;
        filename = downloadResult.filename;
        mimetype = downloadResult.mimetype;
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
    
    // Add debug logging to see which method is being used
    logger.info('=== JSON DATA METHOD DETECTION ===');
    logger.info('Has dataFile (Method 1):', !!dataFile);
    logger.info('Has req.body.templateData:', !!req.body.templateData);
    logger.info('Has req.body.jsonData:', !!req.body.jsonData);
    logger.info('=====================================');
    
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
    if (!dataFile && Object.keys(templateData).length === 0 && (req.body.templateData || req.body.jsonData)) {
      try {
        const jsonSource = req.body.templateData || req.body.jsonData;
        templateData = typeof jsonSource === 'string' 
          ? JSON.parse(jsonSource) 
          : jsonSource;
        logger.info(`Inline JSON data processed with ${Object.keys(templateData).length} variables`);
        logger.info('Method 3: JSON data extracted from request body:', JSON.stringify(templateData, null, 2));
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
    
    // Validate that filePath is properly set
    if (!filePath) {
      logger.error('File path is undefined or null');
      return next(new ApiError(500, 'File path not properly initialized'));
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      logger.error(`File does not exist at path: ${filePath}`);
      return next(new ApiError(500, 'File not found at expected location'));
    }
    
    // Get file information and validate
    let fileInfo;
    try {
      fileInfo = documentUtils.getFileInfo(filePath);
      logger.info(`File info for ${originalname}:`, fileInfo);
    } catch (error) {
      logger.error(`Failed to get file info: ${error.message}`);
      return next(new ApiError(500, `Failed to analyze file: ${error.message}`));
    }
    
    if (fileExtension === '.pdf') {
      // Only analyze if it's actually a PDF file
      if (fileInfo.isPdf) {
        try {
          const pdfInfo = await documentUtils.analyzePdf(filePath);
          pageCount = pdfInfo.pageCount;
          
          // Analyze PDF for template variables and signature fields
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
            
            // IMPORTANT: For PDF files with template variables, warn about formatting limitations
            if (Object.keys(templateData).length > 0 && analysis.templateVariables.length > 0) {
              logger.warn(`PDF has ${analysis.templateVariables.length} template variables and JSON data provided.`);
              logger.warn('WARNING: PDF template processing uses text extraction which may lose formatting and alignment.');
              logger.warn('For best results, use DOCX templates instead of PDF templates.');
              logger.warn('Skipping PDF template processing to preserve formatting. Use DOCX format for template variable replacement.');
              
              // Store template variables for reference but don't process them to preserve formatting
              documentData.skippedPdfProcessing = true;
              documentData.formatPreservationNote = 'PDF template processing skipped to preserve formatting. Use DOCX format for template variables.';
              
              // DO NOT PROCESS PDF TEMPLATES - this causes "all in one line" formatting issues
              // If user needs template variables in PDF, they should convert their template to DOCX format first
            } else if (Object.keys(templateData).length > 0 && analysis.templateVariables.length === 0) {
              logger.info('JSON data provided but no template variables found in PDF');
            } else if (Object.keys(templateData).length === 0 && analysis.templateVariables.length > 0) {
              logger.info(`PDF has ${analysis.templateVariables.length} template variables but no JSON data provided`);
            }
            
          } catch (analysisError) {
            logger.warn(`Could not analyze PDF for template variables: ${analysisError.message}`);
          }
        } catch (pdfError) {
          logger.error(`Failed to analyze PDF: ${pdfError.message}`);
          // Continue with document processing even if PDF analysis fails
          pageCount = 1; // Default to 1 page
        }
      } else {
        logger.warn(`File extension is .pdf but file doesn't have PDF header. File info:`, fileInfo);
        // Treat as regular file, don't attempt PDF analysis
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
        try {
          const pdfInfo = await documentUtils.analyzePdf(finalPdfPath);
          pageCount = pdfInfo.pageCount;
        } catch (pdfAnalysisError) {
          logger.error(`Failed to analyze converted PDF: ${pdfAnalysisError.message}`);
          // Default to 1 page if analysis fails
          pageCount = 1;
        }
        
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
    
    // Debug: Log the saved document's template data
    logger.info('Document saved with templateData:', JSON.stringify(document.templateData, null, 2));
    logger.info('DocumentData templateData before save:', JSON.stringify(documentData.templateData, null, 2));
    
    logger.info(`Document uploaded successfully: ${document.originalName}`);
    
    // Step 2: Prepare for signature (reuse prepareForSignature logic)
    let { recipients, signatureFieldMapping, signingFlow, defaultRecipients } = req.body;
    
    // DEBUG: Log what we have at this point
    logger.info('=== RECIPIENT EXTRACTION DEBUG ===');
    logger.info('Recipients from req.body:', recipients);
    logger.info('templateData variable exists:', !!templateData);
    logger.info('document.templateData exists:', !!document.templateData);
    if (templateData) {
      logger.info('templateData keys:', Object.keys(templateData));
      logger.info('templateData.recipients:', templateData.recipients);
    }
    if (document.templateData) {
      logger.info('document.templateData keys:', Object.keys(document.templateData));
      logger.info('document.templateData.recipients:', document.templateData.recipients);
    }
    logger.info('===================================');
    
    // If no recipients provided, try to extract from JSON template data
    if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
      // Use the templateData we already have in memory instead of from the saved document
      const sourceTemplateData = templateData || document.templateData;
      
      if (sourceTemplateData) {
        logger.info('No recipients provided, extracting from template data');
        logger.info('Source template data keys:', Object.keys(sourceTemplateData));
        logger.info('Source template data recipients:', sourceTemplateData.recipients);
        recipients = extractRecipientsFromTemplateData(sourceTemplateData);
        
        if (!recipients || recipients.length === 0) {
          // Try to use default recipients if provided
          if (defaultRecipients && Array.isArray(defaultRecipients) && defaultRecipients.length > 0) {
            logger.info('No recipients found in template data, using provided default recipients');
            recipients = defaultRecipients;
          } else {
            logger.error('No recipients found in template data');
            logger.error('Template data structure:', JSON.stringify(sourceTemplateData, null, 2));
            
            // Provide detailed error message with suggestions
            const errorMessage = 'Recipients are required either in request body or template data. ' +
              'No recipients found in template data. ' +
              'Expected structure: {"recipients": [{"name": "John Doe", "email": "john@example.com", "signatureField": "signature1"}]} ' +
              'or individual fields like: {"signerName": "John Doe", "signerEmail": "john@example.com"}. ' +
              'Alternatively, provide "defaultRecipients" in the request body as a fallback.';
            
            return next(new ApiError(400, errorMessage));
          }
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
        // Try to use default recipients if provided
        if (defaultRecipients && Array.isArray(defaultRecipients) && defaultRecipients.length > 0) {
          logger.info('No template data available, using provided default recipients');
          recipients = defaultRecipients;
        } else {
          return next(new ApiError(400, 'Recipients are required either in request body, template data, or as defaultRecipients'));
        }
      }
    } else if (!Array.isArray(recipients)) {
      return next(new ApiError(400, 'Recipients must be an array'));
    }
    
    // Validate signing flow option
    const validSigningFlows = ['SEQUENTIAL', 'PARALLEL'];
    const selectedSigningFlow = signingFlow && validSigningFlows.includes(signingFlow.toUpperCase()) 
      ? signingFlow.toUpperCase() 
      : 'PARALLEL'; // Default to parallel so reminders go to all unsigned recipients
    
    // Validate and format recipients
    const formattedRecipients = recipients.map((recipient, index) => {
      if (!recipient.name || !recipient.email) {
        throw new ApiError(400, 'Each recipient must have a name and email');
      }
      
      return {
        name: recipient.name,
        email: recipient.email,
        title: recipient.title || recipient.position || null, // Include title from templateData
        order: selectedSigningFlow === 'SEQUENTIAL' ? index + 1 : 1, // Sequential: 1,2,3... Parallel: all 1
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
      
      // Step 4: Get and store signing URLs for all recipients (with retry logic)
      try {
        const accessToken = await getAccessToken();
        
        // Wait a moment for the agreement to be fully processed
        logger.info('Waiting 3 seconds for agreement to be processed before retrieving signing URLs...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const agreementInfo = await getAgreementInfo(accessToken, document.adobeAgreementId);
        
        // Log the complete agreement structure for debugging
        logger.info('Complete agreement info structure:', JSON.stringify(agreementInfo, null, 2));
        
        // Check for participant sets in different possible locations with more detailed analysis
        const participantSets = agreementInfo.participantSets || 
                               agreementInfo.participantSetsInfo || 
                               agreementInfo.participants ||
                               [];
        
        if (participantSets && participantSets.length > 0) {
          logger.info(`Found ${participantSets.length} participant sets for signing URL retrieval`);
          logger.info('Participant sets structure:', JSON.stringify(participantSets, null, 2));
          
          // Map recipients to participant sets and get their signing URLs
          for (const recipient of document.recipients) {
            let participantFound = false;
            
            for (const participantSet of participantSets) {
              logger.info(`Processing participant set:`, JSON.stringify(participantSet, null, 2));
              
              // Check for member info in different possible structures
              const memberInfos = participantSet.memberInfos || 
                                participantSet.members || 
                                participantSet.participantSetMemberInfos ||
                                (participantSet.participantSetInfo ? participantSet.participantSetInfo.memberInfos : null) ||
                                [];
              
              logger.info(`Found ${memberInfos.length} member infos in participant set`);
              
              for (const participant of memberInfos) {
                logger.info(`Checking participant:`, JSON.stringify(participant, null, 2));
                
                if (participant.email && participant.email.toLowerCase() === recipient.email.toLowerCase()) {
                  try {
                    logger.info(`Getting signing URL for ${recipient.email} using email address`);
                    
                    // Use email address directly instead of participant ID
                    const signingUrlResponse = await getSigningUrl(
                      accessToken, 
                      document.adobeAgreementId,
                      recipient.email
                    );
                    
                    logger.info(`Signing URL response for ${recipient.email}:`, JSON.stringify(signingUrlResponse, null, 2));
                    
                    if (signingUrlResponse.signingUrlSetInfos && 
                        signingUrlResponse.signingUrlSetInfos[0] && 
                        signingUrlResponse.signingUrlSetInfos[0].signingUrls && 
                        signingUrlResponse.signingUrlSetInfos[0].signingUrls[0]) {
                      
                      recipient.signingUrl = signingUrlResponse.signingUrlSetInfos[0].signingUrls[0].esignUrl;
                      logger.info(`✅ Stored signing URL for ${recipient.email}: ${recipient.signingUrl}`);
                      participantFound = true;
                    } else {
                      logger.warn(`Invalid signing URL response structure for ${recipient.email}:`, signingUrlResponse);
                    }
                  } catch (signingUrlError) {
                    logger.error(`Error getting signing URL for ${recipient.email}: ${signingUrlError.message}`);
                    if (signingUrlError.response) {
                      logger.error(`Adobe Sign URL error response:`, signingUrlError.response.data);
                    }
                    // Continue with other recipients even if one fails
                  }
                  break;
                }
              }
              if (participantFound) break;
            }
            
            if (!participantFound) {
              logger.warn(`No participant found for recipient ${recipient.email} in Adobe Sign agreement`);
            }
          }
          
          // Save the document with updated signing URLs
          await document.save();
          const urlCount = document.recipients.filter(r => r.signingUrl).length;
          logger.info(`Updated document with signing URLs for ${urlCount}/${document.recipients.length} recipients`);
          
          // If no URLs were generated, try an alternative approach
          if (urlCount === 0) {
            logger.warn('No signing URLs generated, trying alternative approach...');
            
            // Try getting URLs immediately after a shorter delay
            setTimeout(async () => {
              try {
                await retrySigningUrlGeneration(document.adobeAgreementId, document._id);
              } catch (retryError) {
                logger.error(`Retry URL generation failed: ${retryError.message}`);
              }
            }, 5000); // Try again after 5 seconds
          }
          
        } else {
          logger.warn(`No participant sets found in agreement response. Available keys: ${Object.keys(agreementInfo).join(', ')}`);
          
          // Log specific fields that might contain participant info
          if (agreementInfo.participantSetsInfo) {
            logger.info('participantSetsInfo content:', JSON.stringify(agreementInfo.participantSetsInfo, null, 2));
          }
          if (agreementInfo.participantSets) {
            logger.info('participantSets content:', JSON.stringify(agreementInfo.participantSets, null, 2));
          }
          
          // Schedule a retry for later
          setTimeout(async () => {
            try {
              logger.info('Retrying signing URL generation after delay...');
              await retrySigningUrlGeneration(document.adobeAgreementId, document._id);
            } catch (retryError) {
              logger.error(`Delayed retry failed: ${retryError.message}`);
            }
          }, 10000); // Try again after 10 seconds
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
            title: r.title,
            signingUrl: r.signingUrl || null,
            status: r.status
          }))
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
 * Update document status based on recipients' statuses
 * @param {Object} document - Document object
 */
const updateDocumentStatus = (document) => {
  // Count recipients by status
  const statusCounts = document.recipients.reduce((counts, recipient) => {
    counts[recipient.status] = (counts[recipient.status] || 0) + 1;
    return counts;
  }, {});
  
  const totalRecipients = document.recipients.length;
  const signedCount = statusCounts.signed || 0;
  const declinedCount = statusCounts.declined || 0;
  
  // Update document status
  if (declinedCount > 0) {
    document.status = 'cancelled';
  } else if (signedCount === totalRecipients) {
    document.status = 'completed';
  } else if (signedCount > 0 && signedCount < totalRecipients) {
    document.status = 'partially_signed';
  }
  
  logger.info(`Updated document status to ${document.status} (${signedCount}/${totalRecipients} signed)`);
};

/**
 * Manually update recipient timestamps (fallback when Adobe Sign sync fails)
 * @route POST /api/documents/:id/update-timestamps
 */
exports.updateRecipientTimestamps = async (req, res, next) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }

    const { recipientUpdates } = req.body;
    
    if (!recipientUpdates || !Array.isArray(recipientUpdates)) {
      return next(new ApiError(400, 'recipientUpdates array is required'));
    }

    logger.info(`Manual timestamp update requested for document: ${document.originalName}`);
    
    let updatesApplied = 0;
    const updateResults = [];

    recipientUpdates.forEach(update => {
      const { email, status, signedAt, lastSigningUrlAccessed } = update;
      
      if (!email) {
        updateResults.push({ email: 'unknown', error: 'Email is required' });
        return;
      }

      const recipient = document.recipients.find(r => 
        r.email.toLowerCase() === email.toLowerCase()
      );

      if (!recipient) {
        updateResults.push({ email, error: 'Recipient not found' });
        return;
      }

      const changes = [];

      // Update status if provided
      if (status && status !== recipient.status) {
        const oldStatus = recipient.status;
        recipient.status = status;
        changes.push(`status: ${oldStatus} → ${status}`);
      }

      // Update signedAt timestamp
      if (signedAt) {
        const signedDate = new Date(signedAt);
        if (isNaN(signedDate.getTime())) {
          updateResults.push({ email, error: 'Invalid signedAt date format' });
          return;
        }
        recipient.signedAt = signedDate;
        changes.push(`signedAt: ${signedDate.toISOString()}`);
      } else if (status === 'signed' && !recipient.signedAt) {
        // Auto-set signedAt if marking as signed without timestamp
        recipient.signedAt = new Date();
        changes.push(`signedAt: ${recipient.signedAt.toISOString()} (auto-set)`);
      }

      // Update lastSigningUrlAccessed timestamp
      if (lastSigningUrlAccessed) {
        const accessDate = new Date(lastSigningUrlAccessed);
        if (isNaN(accessDate.getTime())) {
          updateResults.push({ email, error: 'Invalid lastSigningUrlAccessed date format' });
          return;
        }
        recipient.lastSigningUrlAccessed = accessDate;
        changes.push(`lastSigningUrlAccessed: ${accessDate.toISOString()}`);
      } else if ((status === 'viewed' || status === 'signed') && !recipient.lastSigningUrlAccessed) {
        // Auto-set access time if marking as viewed/signed without timestamp
        recipient.lastSigningUrlAccessed = recipient.signedAt || new Date();
        changes.push(`lastSigningUrlAccessed: ${recipient.lastSigningUrlAccessed.toISOString()} (auto-set)`);
      }

      if (changes.length > 0) {
        updateResults.push({
          email,
          success: true,
          changes: changes.join(', ')
        });
        updatesApplied++;
        logger.info(`Updated ${email}: ${changes.join(', ')}`);
      } else {
        updateResults.push({
          email,
          success: true,
          changes: 'No changes needed'
        });
      }
    });

    // Update overall document status if needed
    updateDocumentStatus(document);

    await document.save();

    logger.info(`Manual timestamp update completed: ${updatesApplied} recipients updated`);

    // Create log entry
    await Log.create({
      level: 'info',
      message: `Manual timestamp update completed for document: ${document.originalName}`,
      documentId: document._id,
      ipAddress: req.ip,
      requestPath: req.originalUrl,
      requestMethod: req.method,
      metadata: {
        updatesApplied,
        results: updateResults
      }
    });

    return res.json(formatResponse(
      200,
      'Recipient timestamps updated successfully',
      {
        documentId: document._id,
        documentName: document.originalName,
        updatesApplied,
        results: updateResults,
        currentRecipients: document.recipients.map(r => ({
          name: r.name,
          email: r.email,
          status: r.status,
          signedAt: r.signedAt,
          lastSigningUrlAccessed: r.lastSigningUrlAccessed
        }))
      }
    ));

  } catch (error) {
    logger.error(`Error updating recipient timestamps: ${error.message}`);
    return next(new ApiError(500, 'Failed to update recipient timestamps'));
  }
};
