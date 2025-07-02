const Document = require('../models/document.model');
const Log = require('../models/log.model');
const logger = require('../utils/logger');
const { formatResponse } = require('../utils/apiUtils');
const { getAccessToken, createWebhook } = require('../config/adobeSign');

/**
 * Handle Adobe Sign webhook events
 * @route POST /api/webhooks/adobe-sign
 */
exports.handleAdobeSignWebhook = async (req, res) => {
  try {
    logger.info('Received Adobe Sign webhook event');
    
    // Extract event data
    const eventData = req.body;
    logger.info(`Event type: ${eventData.event}`);
    
    // Log the webhook event
    await Log.create({
      level: 'info',
      message: `Adobe Sign webhook event received: ${eventData.event}`,
      action: 'ADOBE_SIGN_WEBHOOK',
      details: {
        event: eventData.event,
        data: eventData
      }
    });
    
    // Handle different event types
    switch (eventData.event) {
      case 'AGREEMENT_ACTION_COMPLETED':
      case 'AGREEMENT_SIGNED':
        await handleSigningComplete(eventData);
        break;
      
      case 'AGREEMENT_ACTION_DELEGATED':
        await handleSigningDelegated(eventData);
        break;
      
      case 'AGREEMENT_ACTION_DECLINED':
        await handleSigningDeclined(eventData);
        break;
      
      case 'AGREEMENT_EMAIL_VIEWED':
      case 'AGREEMENT_ACTION_VIEWED':
        await handleDocumentViewed(eventData);
        break;
      
      default:
        logger.info(`Unhandled event type: ${eventData.event}`);
    }
    
    // Return success response
    return res.status(200).json(formatResponse('Webhook received successfully'));
  } catch (error) {
    logger.error(`Error handling Adobe Sign webhook: ${error.message}`);
    
    // Always return 200 to Adobe Sign to acknowledge receipt
    return res.status(200).json(formatResponse('Webhook received with errors', null, true));
  }
};

/**
 * Handle signing complete event
 * @param {Object} eventData - Event data from Adobe Sign
 */
const handleSigningComplete = async (eventData) => {
  try {
    // Extract agreement ID
    const agreementId = eventData.agreement?.id;
    if (!agreementId) {
      logger.error('No agreement ID found in webhook event data');
      return;
    }
    
    logger.info(`🔔 Processing signing complete event for agreement: ${agreementId}`);
    
    // Find document by Adobe agreement ID
    const document = await Document.findOne({ adobeAgreementId: agreementId });
    if (!document) {
      logger.error(`No document found with Adobe agreement ID: ${agreementId}`);
      return;
    }
    
    logger.info(`Found document: ${document.originalName} (${document._id})`);
    
    // Extract participant information
    const participantEmail = eventData.participant?.email;
    const participantName = eventData.participant?.name;
    
    logger.info(`Participant email: ${participantEmail}, name: ${participantName}`);
    
    if (participantEmail) {
      // Find the recipient in the document
      const recipientIndex = document.recipients.findIndex(
        recipient => recipient.email.toLowerCase() === participantEmail.toLowerCase()
      );
      
      if (recipientIndex !== -1) {
        const recipient = document.recipients[recipientIndex];
        // Update recipient status to signed using enhanced mapping
        const oldStatus = recipient.status;
        recipient.status = 'signed';
        
        // Enhanced timestamp handling - set both signedAt and lastSigningUrlAccessed
        const signedTimestamp = new Date();
        
        // Set signedAt timestamp with enhanced date handling
        if (!recipient.signedAt) {
          // Check if the webhook provides more specific timing information
          const possibleSigningDates = [
            eventData.agreement?.completedDate,
            eventData.agreement?.statusUpdateDate,
            eventData.participant?.signedDate,
            eventData.participant?.completedDate,
            signedTimestamp
          ].filter(date => date);
          
          if (possibleSigningDates.length > 0) {
            // Use the most recent valid date
            const latestDate = new Date(Math.max(...possibleSigningDates.map(d => new Date(d).getTime())));
            recipient.signedAt = latestDate;
            logger.info(`✅ Set signedAt timestamp for ${participantEmail} to ${recipient.signedAt.toISOString()}`);
          } else {
            recipient.signedAt = signedTimestamp;
            logger.info(`✅ Set signedAt timestamp for ${participantEmail} to ${signedTimestamp.toISOString()}`);
          }
        } else {
          logger.info(`signedAt already set for ${participantEmail}: ${recipient.signedAt.toISOString()}`);
        }
        
        // Update lastSigningUrlAccessed timestamp - they accessed the document to sign
        const possibleAccessDates = [
          eventData.participant?.accessDate,
          eventData.participant?.lastViewedDate,
          eventData.participant?.viewDate,
          signedTimestamp
        ].filter(date => date);
        
        if (possibleAccessDates.length > 0) {
          const latestAccessDate = new Date(Math.max(...possibleAccessDates.map(d => new Date(d).getTime())));
          recipient.lastSigningUrlAccessed = latestAccessDate;
          logger.info(`✅ Updated lastSigningUrlAccessed for ${participantEmail} to ${recipient.lastSigningUrlAccessed.toISOString()}`);
        } else {
          recipient.lastSigningUrlAccessed = signedTimestamp;
          logger.info(`✅ Set lastSigningUrlAccessed for ${participantEmail} to ${signedTimestamp.toISOString()}`);
        }
        
        logger.info(`✅ Updated signing status for ${participantEmail}: ${oldStatus} → ${recipient.status}`);
        logger.info(`✅ Updated timestamps - signedAt: ${recipient.signedAt?.toISOString()}, lastAccessed: ${recipient.lastSigningUrlAccessed?.toISOString()}`);
        
        // Update overall document status based on all recipient statuses
        updateDocumentOverallStatus(document);
        
        // Force save immediately to ensure data persistence
        await document.save();
        logger.info(`✅ Saved document after updating ${participantEmail} status`);
        
        // Verify the save worked
        const verifyDoc = await Document.findById(document._id);
        const verifyRecipient = verifyDoc.recipients.find(r => 
          r.email.toLowerCase() === participantEmail.toLowerCase()
        );
        
        if (verifyRecipient && verifyRecipient.status === 'signed') {
          logger.info(`✅ Verified: ${participantEmail} status successfully saved as 'signed'`);
        } else {
          logger.error(`❌ Verification failed: ${participantEmail} status not properly saved`);
        }
        
      } else {
        logger.warn(`⚠️ Recipient ${participantEmail} not found in document recipients`);
        
        // Log all recipients for debugging
        logger.info(`Document recipients:`);
        document.recipients.forEach((r, i) => {
          logger.info(`  ${i+1}. ${r.name} <${r.email}> (status: ${r.status})`);
        });
      }
    } else if (eventData.agreement?.status === 'SIGNED' || eventData.agreement?.status === 'COMPLETED') {
      // If it's a completed agreement event without specific participant, mark document as completed
      logger.info(`Agreement marked as ${eventData.agreement.status} - updating document status`);
      
      // Mark any remaining unsigned recipients as signed (edge case handling)
      let updatedAny = false;
      document.recipients.forEach(recipient => {
        if (recipient.status !== 'signed' && recipient.status !== 'declined') {
          logger.info(`Force-updating ${recipient.email} to signed status based on agreement completion`);
          recipient.status = 'signed';
          recipient.signedAt = recipient.signedAt || new Date();
          updatedAny = true;
        }
      });
      
      if (updatedAny) {
        await document.save();
        logger.info(`✅ Force-updated remaining recipients and saved document`);
      }
    }
    
    // Update overall document status based on recipients
    updateDocumentStatus(document);
    
    // Save the document again to persist status changes
    await document.save();
    
    logger.info(`✅ Successfully processed signing complete event for agreement: ${agreementId}`);
  } catch (error) {
    logger.error(`❌ Error handling signing complete event: ${error.message}`);
    logger.error(error.stack);
  }
};

/**
 * Handle document viewed event
 * @param {Object} eventData - Event data from Adobe Sign
 */
const handleDocumentViewed = async (eventData) => {
  try {
    // Extract agreement ID
    const agreementId = eventData.agreement?.id;
    if (!agreementId) {
      logger.error('No agreement ID found in webhook event data');
      return;
    }
    
    logger.info(`👁️ Processing document viewed event for agreement: ${agreementId}`);
    
    // Find document by Adobe agreement ID
    const document = await Document.findOne({ adobeAgreementId: agreementId });
    if (!document) {
      logger.error(`No document found with Adobe agreement ID: ${agreementId}`);
      return;
    }
    
    // Extract participant information
    const participantEmail = eventData.participant?.email;
    
    logger.info(`Participant email: ${participantEmail}`);
    
    if (participantEmail) {
      // Find the recipient in the document
      const recipientIndex = document.recipients.findIndex(
        recipient => recipient.email.toLowerCase() === participantEmail.toLowerCase()
      );
      
      if (recipientIndex !== -1) {
        const recipient = document.recipients[recipientIndex];
        const oldStatus = recipient.status;
        
        // Update recipient status to viewed if currently pending or sent (but not if already signed)
        if (['pending', 'sent'].includes(recipient.status)) {
          recipient.status = 'viewed';
          recipient.lastSigningUrlAccessed = new Date();
          
          logger.info(`✅ Updated status for ${participantEmail}: ${oldStatus} → ${recipient.status}`);
          logger.info(`✅ Updated lastSigningUrlAccessed for ${participantEmail} to ${recipient.lastSigningUrlAccessed.toISOString()}`);
          
          // Save the document
          await document.save();
          logger.info(`✅ Saved document after updating ${participantEmail} view status`);
        } else {
          logger.info(`ℹ️ No status update needed for ${participantEmail} (current status: ${recipient.status})`);
          
          // Still update lastSigningUrlAccessed even if status doesn't change
          if (!recipient.lastSigningUrlAccessed) {
            recipient.lastSigningUrlAccessed = new Date();
            await document.save();
            logger.info(`✅ Updated lastSigningUrlAccessed for ${participantEmail}`);
          }
        }
      } else {
        logger.warn(`⚠️ Recipient ${participantEmail} not found in document`);
      }
    }
    
    logger.info(`✅ Successfully processed document viewed event for agreement: ${agreementId}`);
  } catch (error) {
    logger.error(`❌ Error handling document viewed event: ${error.message}`);
    logger.error(error.stack);
  }
};

/**
 * Handle signing declined event
 * @param {Object} eventData - Event data from Adobe Sign
 */
const handleSigningDeclined = async (eventData) => {
  try {
    // Extract agreement ID
    const agreementId = eventData.agreement?.id;
    if (!agreementId) {
      logger.error('No agreement ID found in webhook event data');
      return;
    }
    
    // Find document by Adobe agreement ID
    const document = await Document.findOne({ adobeAgreementId: agreementId });
    if (!document) {
      logger.error(`No document found with Adobe agreement ID: ${agreementId}`);
      return;
    }
    
    // Extract participant information
    const participantEmail = eventData.participant?.email;
    
    if (participantEmail) {
      // Find the recipient in the document
      const recipientIndex = document.recipients.findIndex(
        recipient => recipient.email.toLowerCase() === participantEmail.toLowerCase()
      );
      
      if (recipientIndex !== -1) {
        // Update recipient status
        document.recipients[recipientIndex].status = 'declined';
        
        logger.info(`Updated status for ${participantEmail} to declined`);
        
        // Update overall document status based on all recipient statuses
        updateDocumentOverallStatus(document);
        
        // Save the document
        await document.save();
      } else {
        logger.warn(`Recipient ${participantEmail} not found in document`);
      }
    }
    
    logger.info(`Successfully processed signing declined event for agreement: ${agreementId}`);
  } catch (error) {
    logger.error(`Error handling signing declined event: ${error.message}`);
  }
};

/**
 * Handle signing delegated event
 * @param {Object} eventData - Event data from Adobe Sign
 */
const handleSigningDelegated = async (eventData) => {
  try {
    // Extract agreement ID
    const agreementId = eventData.agreement?.id;
    if (!agreementId) {
      logger.error('No agreement ID found in webhook event data');
      return;
    }
    
    // Find document by Adobe agreement ID
    const document = await Document.findOne({ adobeAgreementId: agreementId });
    if (!document) {
      logger.error(`No document found with Adobe agreement ID: ${agreementId}`);
      return;
    }
    
    // Extract participant information
    const participantEmail = eventData.participant?.email;
    const delegateeEmail = eventData.delegatee?.email;
    const delegateeName = eventData.delegatee?.name;
    
    if (participantEmail && delegateeEmail) {
      // Find the recipient in the document
      const recipientIndex = document.recipients.findIndex(
        recipient => recipient.email.toLowerCase() === participantEmail.toLowerCase()
      );
      
      if (recipientIndex !== -1) {
        // Create a new recipient for the delegatee
        const delegatee = {
          name: delegateeName || 'Delegated Signer',
          email: delegateeEmail,
          order: document.recipients[recipientIndex].order,
          status: 'pending',
          signedAt: null,
          lastReminderSent: null,
          lastSigningUrlAccessed: null,
          signatureField: document.recipients[recipientIndex].signatureField,
          title: document.recipients[recipientIndex].title || 'Delegated Signer'
        };
        
        // Update original recipient status
        document.recipients[recipientIndex].status = 'waiting';
        
        // Add the delegatee to the recipients array
        document.recipients.push(delegatee);
        
        logger.info(`Added delegated signer ${delegateeEmail} to document`);
        
        // Save the document
        await document.save();
      } else {
        logger.warn(`Recipient ${participantEmail} not found in document`);
      }
    }
    
    logger.info(`Successfully processed signing delegated event for agreement: ${agreementId}`);
  } catch (error) {
    logger.error(`Error handling signing delegated event: ${error.message}`);
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
  const expiredCount = statusCounts.expired || 0;
  
  const oldStatus = document.status;
  let newStatus = oldStatus;
  
  logger.info(`📊 Document status calculation: ${signedCount}/${totalRecipients} signed, ${declinedCount} declined, ${expiredCount} expired`);
  
  // Update document status based on recipient statuses
  if (declinedCount > 0) {
    newStatus = 'cancelled';
    logger.info(`Document cancelled due to ${declinedCount} declined recipient(s)`);
  } else if (expiredCount > 0) {
    newStatus = 'expired';
    logger.info(`Document expired due to ${expiredCount} expired recipient(s)`);
  } else if (signedCount === totalRecipients) {
    newStatus = 'completed';
    logger.info(`Document completed - all ${totalRecipients} recipients have signed`);
  } else if (signedCount > 0 && signedCount < totalRecipients) {
    newStatus = 'partially_signed';
    logger.info(`Document partially signed - ${signedCount}/${totalRecipients} recipients have signed`);
  } else if (signedCount === 0) {
    // No one has signed yet, keep it as out_for_signature or sent_for_signature
    if (['uploaded', 'processing', 'ready_for_signature'].includes(oldStatus)) {
      newStatus = 'sent_for_signature';
    } else {
      newStatus = 'out_for_signature';
    }
    logger.info(`Document waiting for signatures - 0/${totalRecipients} recipients have signed`);
  }
  
  if (oldStatus !== newStatus) {
    document.status = newStatus;
    logger.info(`📝 Updated document ${document._id} status: ${oldStatus} → ${newStatus}`);
  } else {
    logger.info(`📋 Document ${document._id} status unchanged: ${newStatus}`);
  }
  
  return document.status;
};

/**
 * Update document overall status based on recipient statuses
 * @param {Object} document - The document to update
 */
const updateDocumentOverallStatus = (document) => {
  try {
    const recipients = document.recipients || [];
    if (recipients.length === 0) return;
    
    const signedCount = recipients.filter(r => r.status === 'signed').length;
    const declinedCount = recipients.filter(r => r.status === 'declined').length;
    const expiredCount = recipients.filter(r => r.status === 'expired').length;
    
    // Determine overall document status
    if (signedCount === recipients.length) {
      document.status = 'completed';
      logger.info(`✅ Document marked as completed - all ${recipients.length} recipients have signed`);
    } else if (declinedCount > 0) {
      document.status = 'cancelled';
      logger.info(`❌ Document marked as cancelled - ${declinedCount} recipient(s) declined`);
    } else if (expiredCount > 0) {
      document.status = 'expired';
      logger.info(`⏱️ Document marked as expired - ${expiredCount} recipient(s) expired`);
    } else if (signedCount > 0) {
      document.status = 'partially_signed';
      logger.info(`🔄 Document marked as partially signed - ${signedCount}/${recipients.length} recipients have signed`);
    } else {
      document.status = 'sent_for_signature';
      logger.info(`📤 Document status: sent for signature`);
    }
  } catch (error) {
    logger.error(`❌ Error updating document overall status: ${error.message}`);
  }
};

/**
 * Setup webhook with Adobe Sign
 * @route POST /api/webhooks/setup
 */
exports.setupWebhook = async (req, res) => {
  try {
    const { webhookUrl } = req.body;
    
    if (!webhookUrl) {
      return res.status(400).json(formatResponse('Webhook URL is required', null, true));
    }
    
    // Get access token
    const accessToken = await getAccessToken();
    
    // Create webhook
    const webhookInfo = await createWebhook(accessToken, webhookUrl);
    
    // Log webhook creation
    await Log.create({
      level: 'info',
      message: `Adobe Sign webhook configured: ${webhookUrl}`,
      action: 'WEBHOOK_SETUP',
      details: {
        webhookId: webhookInfo.id,
        webhookUrl: webhookUrl
      }
    });
    
    return res.status(200).json(formatResponse('Webhook setup successful', { webhookInfo }));
  } catch (error) {
    logger.error(`Error setting up webhook: ${error.message}`);
    return res.status(500).json(formatResponse('Failed to setup webhook', null, true));
  }
};
