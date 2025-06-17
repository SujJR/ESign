// Utility for handling Adobe Sign reminders
const logger = require('./logger');
const { createAdobeSignClient } = require('../config/adobeSign');

/**
 * Enhanced helper to send reminders through Adobe Sign API
 * This utility handles multiple retry approaches and error handling
 * @param {string} agreementId - Adobe Sign agreement ID
 * @param {Array} recipients - Array of recipient objects with email properties
 * @param {string} message - Reminder message
 * @returns {Promise<Object>} - Results of reminder attempts
 */
async function sendAdobeSignReminders(agreementId, recipients, message) {
  if (!agreementId) {
    logger.error('Cannot send reminders: No agreement ID provided');
    return { success: false, error: 'No agreement ID provided' };
  }

  if (!recipients || recipients.length === 0) {
    logger.error('Cannot send reminders: No recipients provided');
    return { success: false, error: 'No recipients provided' };
  }

  try {
    // Get Adobe Sign client
    const adobeSignClient = await createAdobeSignClient();
    
    // Track results
    const results = {
      success: false,
      methodsAttempted: [],
      successfulMethod: null,
      recipientResults: [],
      error: null
    };
    
    // Approach 1: Standard reminder endpoint (PUT)
    try {
      results.methodsAttempted.push('PUT_AGREEMENT_REMINDER');
      
      const reminderPayload = {
        agreementId: agreementId,
        comment: message || 'Please complete your signature for this important document. Your prompt attention is appreciated.'
      };
      
      await adobeSignClient.put(`api/rest/v6/agreements/${agreementId}/reminders`, reminderPayload);
      logger.info(`✅ Adobe Sign reminder sent successfully (PUT method) for agreement ${agreementId}`);
      
      results.success = true;
      results.successfulMethod = 'PUT_AGREEMENT_REMINDER';
      
      return results;
    } catch (putError) {
      logger.warn(`PUT reminder failed: ${putError.message}`);
      
      // Track error details
      if (putError.response) {
        logger.warn(`Status: ${putError.response.status}, Data: ${JSON.stringify(putError.response.data)}`);
      }
      
      // Continue to next approach
    }
    
    // Approach 2: Try POST method
    try {
      results.methodsAttempted.push('POST_AGREEMENT_REMINDER');
      
      const reminderPayload = {
        agreementId: agreementId,
        comment: message || 'Please complete your signature for this important document. Your prompt attention is appreciated.'
      };
      
      await adobeSignClient.post(`api/rest/v6/agreements/${agreementId}/reminders`, reminderPayload);
      logger.info(`✅ Adobe Sign reminder sent successfully (POST method) for agreement ${agreementId}`);
      
      results.success = true;
      results.successfulMethod = 'POST_AGREEMENT_REMINDER';
      
      return results;
    } catch (postError) {
      logger.warn(`POST reminder failed: ${postError.message}`);
      
      // Track error details
      if (postError.response) {
        logger.warn(`Status: ${postError.response.status}, Data: ${JSON.stringify(postError.response.data)}`);
      }
      
      // Continue to next approach
    }
    
    // Approach 3: Try getting agreement data and then use participant-specific reminders
    try {
      results.methodsAttempted.push('PARTICIPANT_SPECIFIC_REMINDERS');
      
      // Get agreement details
      const agreementResponse = await adobeSignClient.get(`api/rest/v6/agreements/${agreementId}`);
      const agreementData = agreementResponse.data;
      
      if (agreementData && agreementData.participantSetsInfo) {
        logger.info('Trying participant-specific reminders...');
        
        // Keep track of all participant reminder attempts
        const participantResults = [];
        let anySuccessful = false;
        
        // Try to send reminders to each participant who hasn't signed
        for (const participantSet of agreementData.participantSetsInfo) {
          for (const member of participantSet.memberInfos) {
            if (member.status !== 'SIGNED') {
              // Check if this member is in our recipients list
              const isTargetRecipient = recipients.some(r => 
                r.email && r.email.toLowerCase() === member.email.toLowerCase()
              );
              
              if (isTargetRecipient) {
                try {
                  const participantPayload = {
                    participantEmail: member.email,
                    note: message || 'Please complete your signature for this important document.'
                  };
                  
                  await adobeSignClient.post(`api/rest/v6/agreements/${agreementId}/members/remind`, participantPayload);
                  logger.info(`✅ Participant reminder sent to ${member.email}`);
                  
                  participantResults.push({
                    email: member.email,
                    success: true,
                    status: member.status
                  });
                  
                  anySuccessful = true;
                } catch (participantError) {
                  logger.warn(`Failed to send participant reminder to ${member.email}: ${participantError.message}`);
                  
                  participantResults.push({
                    email: member.email,
                    success: false,
                    error: participantError.message,
                    status: member.status
                  });
                }
              }
            }
          }
        }
        
        results.recipientResults = participantResults;
        
        if (anySuccessful) {
          results.success = true;
          results.successfulMethod = 'PARTICIPANT_SPECIFIC_REMINDERS';
          return results;
        }
      }
    } catch (agreementError) {
      logger.warn(`Failed to get agreement data for participant reminders: ${agreementError.message}`);
      
      // Continue to next approach
    }
    
    // If we reach here, all approaches failed
    results.success = false;
    results.error = 'All Adobe Sign reminder methods failed';
    
    return results;
    
  } catch (error) {
    logger.error(`Error sending Adobe Sign reminders: ${error.message}`);
    return { 
      success: false, 
      error: error.message,
      methodsAttempted: ['INITIAL_CONNECTION_FAILED']
    };
  }
}

/**
 * Gets signing URLs for all recipients of an agreement
 * 
 * @param {Object} adobeSignClient - Adobe Sign API client
 * @param {String} agreementId - Adobe Sign agreement ID
 * @returns {Object} - Map of email addresses to signing URLs
 */
async function getAllSigningUrls(adobeSignClient, agreementId) {
  const signingUrls = {};
  
  try {
    const signingUrlResponse = await adobeSignClient.get(`api/rest/v6/agreements/${agreementId}/signingUrls`);
    const signingUrlSets = signingUrlResponse.data.signingUrlSetInfos || [];
    
    // Flatten the signing URLs by recipient email
    signingUrlSets.forEach(urlSet => {
      (urlSet.signingUrls || []).forEach(urlInfo => {
        if (urlInfo.email && urlInfo.esignUrl) {
          signingUrls[urlInfo.email.toLowerCase()] = urlInfo.esignUrl;
          logger.info(`Signing URL found for ${urlInfo.email}`);
        }
      });
    });
    
    logger.info(`Retrieved ${Object.keys(signingUrls).length} signing URLs for agreement ${agreementId}`);
    return signingUrls;
  } catch (urlError) {
    logger.warn(`Could not retrieve signing URLs for agreement ${agreementId}: ${urlError.message}`);
    return {};
  }
}

/**
 * Gets the signing URL for a specific recipient
 * 
 * @param {Object} adobeSignClient - Adobe Sign API client
 * @param {String} agreementId - Adobe Sign agreement ID
 * @param {String} recipientEmail - Recipient email address
 * @returns {String|null} - Signing URL or null if not found
 */
async function getSigningUrl(adobeSignClient, agreementId, recipientEmail) {
  try {
    const signingUrls = await getAllSigningUrls(adobeSignClient, agreementId);
    return signingUrls[recipientEmail.toLowerCase()] || null;
  } catch (error) {
    logger.warn(`Error getting signing URL for ${recipientEmail}: ${error.message}`);
    return null;
  }
}

/**
 * Checks if a recipient has actually signed using multiple data sources
 * 
 * @param {Object} member - Adobe Sign member info
 * @param {Object} formFieldData - Form field data from Adobe Sign
 * @param {Object} agreementEvents - Agreement events from Adobe Sign
 * @param {Object} recipient - Document recipient object
 * @param {Number} participantOrder - Participant order number
 * @returns {Boolean} - True if the recipient has signed
 */
function hasRecipientSigned(member, formFieldData, agreementEvents, recipient, participantOrder) {
  let hasSignature = false;
  
  // Method 1: Check Adobe Sign status directly
  if (member.status === 'SIGNED') {
    logger.info(`Recipient ${member.email} has SIGNED status in Adobe Sign`);
    hasSignature = true;
  }
  
  // Method 2: Check form field data for signatures
  if (formFieldData) {
    if (Array.isArray(formFieldData)) {
      // Standard format
      const recipientSignatures = formFieldData.filter(field => 
        field.fieldType === 'SIGNATURE' && 
        field.value && 
        field.value.trim() !== '' &&
        (field.assignedToRecipient === member.email || field.name.includes(`signer${participantOrder}`))
      );
      
      if (recipientSignatures.length > 0) {
        logger.info(`Recipient ${member.email} has signature in form field data`);
        hasSignature = true;
      }
    } else if (formFieldData.fields && Array.isArray(formFieldData.fields)) {
      // Alternative API response format
      const recipientSignatures = formFieldData.fields.filter(field => 
        field.fieldType === 'SIGNATURE' && 
        field.value && 
        field.value.trim() !== '' &&
        (field.assignedToRecipient === member.email || field.name.includes(`signer${participantOrder}`))
      );
      
      if (recipientSignatures.length > 0) {
        logger.info(`Recipient ${member.email} has signature in form field data (fields format)`);
        hasSignature = true;
      }
    }
  }
  
  // Method 3: Check agreement events for ESIGNED events
  if (agreementEvents && agreementEvents.events) {
    const signatureEvents = agreementEvents.events.filter(event => 
      event.type === 'ESIGNED' && 
      event.participantEmail === member.email
    );
    
    if (signatureEvents.length > 0) {
      logger.info(`Recipient ${member.email} has ESIGNED event in agreement events`);
      hasSignature = true;
    }
  }
  
  // Method 4: Check if already marked as signed locally
  if (recipient.signedAt || recipient.status === 'signed') {
    logger.info(`Recipient ${member.email} already marked as signed in local database`);
    hasSignature = true;
  }
  
  return hasSignature;
}

/**
 * Gets the timestamp when a recipient signed from events
 * 
 * @param {Object} agreementEvents - Agreement events from Adobe Sign
 * @param {String} recipientEmail - Recipient email address
 * @returns {Date|null} - Date when signed or null if not found
 */
function getSignedAtTimestamp(agreementEvents, recipientEmail) {
  if (!agreementEvents || !agreementEvents.events) {
    return null;
  }
  
  const signatureEvents = agreementEvents.events.filter(event => 
    event.type === 'ESIGNED' && 
    event.participantEmail === recipientEmail
  );
  
  if (signatureEvents.length > 0 && signatureEvents[0].date) {
    return new Date(signatureEvents[0].date);
  }
  
  return null;
}

module.exports = {
  sendAdobeSignReminders,
  getAllSigningUrls,
  getSigningUrl,
  hasRecipientSigned,
  getSignedAtTimestamp
};
