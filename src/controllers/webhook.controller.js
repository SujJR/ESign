const Document = require('../models/document.model');
const Log = require('../models/log.model');
const logger = require('../utils/logger');
const { formatResponse } = require('../utils/apiUtils');
const { getAccessToken } = require('../config/adobeSign');

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
      action: 'ADOBE_SIGN_WEBHOOK',
      details: {
        event: eventData.event,
        data: eventData
      },
      level: 'info'
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
    
    // Find document by Adobe agreement ID
    const document = await Document.findOne({ adobeAgreementId: agreementId });
    if (!document) {
      logger.error(`No document found with Adobe agreement ID: ${agreementId}`);
      return;
    }
    
    // Extract participant information
    const participantEmail = eventData.participant?.email;
    const participantName = eventData.participant?.name;
    
    if (participantEmail) {
      // Find the recipient in the document
      const recipientIndex = document.recipients.findIndex(
        recipient => recipient.email.toLowerCase() === participantEmail.toLowerCase()
      );
      
      if (recipientIndex !== -1) {
        // Update recipient status
        document.recipients[recipientIndex].status = 'signed';
        document.recipients[recipientIndex].signedAt = new Date();
        
        logger.info(`Updated signing status for ${participantEmail} to signed`);
      } else {
        logger.warn(`Recipient ${participantEmail} not found in document`);
      }
    } else if (eventData.agreement?.status === 'SIGNED') {
      // If it's a completed agreement event, update the document status
      document.status = 'completed';
      logger.info(`Document ${document._id} marked as completed`);
    }
    
    // Update overall document status based on recipients
    updateDocumentStatus(document);
    
    // Save the document
    await document.save();
    
    logger.info(`Successfully processed signing complete event for agreement: ${agreementId}`);
  } catch (error) {
    logger.error(`Error handling signing complete event: ${error.message}`);
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
        // Update recipient status to viewed if currently pending or sent
        if (['pending', 'sent'].includes(document.recipients[recipientIndex].status)) {
          document.recipients[recipientIndex].status = 'viewed';
          document.recipients[recipientIndex].lastSigningUrlAccessed = new Date();
          
          logger.info(`Updated status for ${participantEmail} to viewed`);
          
          // Save the document
          await document.save();
        }
      } else {
        logger.warn(`Recipient ${participantEmail} not found in document`);
      }
    }
    
    logger.info(`Successfully processed document viewed event for agreement: ${agreementId}`);
  } catch (error) {
    logger.error(`Error handling document viewed event: ${error.message}`);
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
        
        // Update document status
        document.status = 'cancelled';
        
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
  
  // Update document status
  if (declinedCount > 0) {
    document.status = 'cancelled';
  } else if (signedCount === totalRecipients) {
    document.status = 'completed';
  } else if (signedCount > 0 && signedCount < totalRecipients) {
    document.status = 'partially_signed';
  }
  
  logger.info(`Updated document status to ${document.status}`);
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
    
    // Create Adobe Sign client
    const adobeSign = require('../config/adobeSign');
    
    // Create webhook
    const webhookInfo = await adobeSign.createWebhook(accessToken, webhookUrl);
    
    // Log webhook creation
    await Log.create({
      action: 'WEBHOOK_SETUP',
      details: {
        webhookId: webhookInfo.id,
        webhookUrl: webhookUrl
      },
      level: 'info'
    });
    
    return res.status(200).json(formatResponse('Webhook setup successful', { webhookInfo }));
  } catch (error) {
    logger.error(`Error setting up webhook: ${error.message}`);
    return res.status(500).json(formatResponse('Failed to setup webhook', null, true));
  }
};
