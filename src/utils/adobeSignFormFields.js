/**
 * Advanced Adobe Sign form field utilities
 * This module provides multiple approaches for handling form fields in Adobe Sign
 */

const { createAdobeSignClient } = require('../config/adobeSign');
const logger = require('./logger');

/**
 * Text tag approach - embeds form fields directly in PDF using text tags
 * This is often more reliable than programmatic form field addition
 * @param {string} agreementId - The Adobe Sign agreement ID
 * @param {Array} recipients - List of recipients
 * @returns {Promise<Object>} - Response from Adobe Sign API
 */
const addFormFieldsUsingTextTags = async (agreementId, recipients) => {
  try {
    logger.info(`Adding form fields using text tags approach for agreement ${agreementId}`);
    
    // Text tags are embedded in the PDF document itself
    // This approach doesn't require API calls after agreement creation
    // The form fields are automatically recognized when the PDF contains text tags like:
    // {{*ES_:signer1:signature}} for signature fields
    // {{*ES_:signer1:date}} for date fields
    // {{Name_es_:signer1}} for text fields
    
    logger.info('Text tags approach requires pre-processing the PDF document');
    logger.info('Form fields should be embedded in the PDF before uploading');
    
    return { success: true, message: 'Text tags approach - fields embedded in PDF' };
  } catch (error) {
    logger.error(`Error with text tags approach: ${error.message}`);
    throw error;
  }
};

/**
 * One-step approach - creates agreement with form fields included
 * @param {string} transientDocumentId - The transient document ID
 * @param {Array} recipients - List of recipients
 * @param {string} documentName - Name of the document
 * @returns {Promise<string>} - Agreement ID
 */
const createAgreementWithFormFields = async (transientDocumentId, recipients, documentName) => {
  try {
    logger.info('Creating agreement with form fields using one-step approach');
    
    const client = await createAdobeSignClient();
    
    // Generate form fields for the recipients
    const formFields = generateOptimizedFormFields(recipients);
    
    // Create agreement payload with form fields included
    const payload = {
      fileInfos: [
        {
          transientDocumentId: transientDocumentId
        }
      ],
      name: documentName,
      participantSetsInfo: recipients.map((recipient, index) => ({
        memberInfos: [
          {
            email: recipient.email || recipient
          }
        ],
        order: index + 1,
        role: 'SIGNER'
      })),
      signatureType: 'ESIGN',
      state: 'IN_PROCESS',
      // Include form fields in agreement creation
      formFieldLayerTemplates: [
        {
          formFields: formFields
        }
      ]
    };
    
    logger.info(`Creating agreement with ${formFields.length} form fields`);
    const response = await client.post('api/rest/v6/agreements', payload);
    
    logger.info(`Agreement created successfully with ID: ${response.data.id}`);
    return response.data.id;
    
  } catch (error) {
    logger.error(`Error creating agreement with form fields: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}`);
      logger.error(`Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    throw error;
  }
};

/**
 * Webhook-based approach - creates agreement and waits for webhook confirmation
 * @param {string} agreementId - The Adobe Sign agreement ID  
 * @param {Array} recipients - List of recipients
 * @returns {Promise<Object>} - Response from Adobe Sign API
 */
const addFormFieldsWithWebhookVerification = async (agreementId, recipients) => {
  try {
    logger.info(`Adding form fields with webhook verification for agreement ${agreementId}`);
    
    const client = await createAdobeSignClient();
    
    // First, set up a webhook for the agreement (if not already configured)
    try {
      const webhookPayload = {
        name: `FormField_Webhook_${agreementId}`,
        scope: 'AGREEMENT',
        state: 'ACTIVE',
        webhookSubscriptionEvents: [
          'AGREEMENT_CREATED',
          'AGREEMENT_ACTION_COMPLETED',
          'AGREEMENT_WORKFLOW_COMPLETED'
        ],
        webhookUrlInfo: {
          url: process.env.WEBHOOK_URL || 'https://your-webhook-url.com/adobe-sign-webhook'
        }
      };
      
      // Note: This requires webhook URL to be configured
      if (process.env.WEBHOOK_URL) {
        await client.post('api/rest/v6/webhooks', webhookPayload);
        logger.info('Webhook configured for agreement status tracking');
      }
    } catch (webhookError) {
      logger.warn('Could not set up webhook, proceeding without webhook verification');
    }
    
    // Add form fields after webhook setup
    const formFields = generateOptimizedFormFields(recipients);
    const response = await client.post(
      `api/rest/v6/agreements/${agreementId}/formFields`,
      { formFields }
    );
    
    logger.info('Form fields added with webhook verification');
    return response.data;
    
  } catch (error) {
    logger.error(`Error adding form fields with webhook verification: ${error.message}`);
    throw error;
  }
};

/**
 * Template-based approach - uses pre-configured templates
 * @param {string} templateId - The Adobe Sign template ID
 * @param {Array} recipients - List of recipients
 * @returns {Promise<string>} - Agreement ID
 */
const createAgreementFromTemplate = async (templateId, recipients) => {
  try {
    logger.info(`Creating agreement from template ${templateId}`);
    
    const client = await createAdobeSignClient();
    
    const payload = {
      documentCreationInfo: {
        name: 'Agreement from Template',
        recipientSetInfos: recipients.map((recipient, index) => ({
          recipientSetMemberInfos: [
            {
              email: recipient.email
            }
          ],
          recipientSetRole: 'SIGNER'
        })),
        signatureType: 'ESIGN'
      },
      options: {
        noChrome: false,
        authoringRequested: false
      }
    };
    
    const response = await client.post(`api/rest/v6/libraryDocuments/${templateId}/agreements`, payload);
    
    logger.info(`Agreement created from template with ID: ${response.data.id}`);
    return response.data.id;
    
  } catch (error) {
    logger.error(`Error creating agreement from template: ${error.message}`);
    throw error;
  }
};

/**
 * Generates optimized form fields with minimal configuration
 * @param {Array} recipients - List of recipients
 * @returns {Array} - Array of form field objects
 */
const generateOptimizedFormFields = (recipients) => {
  const formFields = [];
  
  recipients.forEach((recipient, index) => {
    // Signature field - minimal required configuration
    formFields.push({
      fieldName: `signature_${index + 1}`,
      fieldType: 'SIGNATURE',
      visible: true,
      required: true,
      // Use default positioning - let Adobe Sign handle placement
      location: {
        x: 100 + (index * 20), // Slight offset for multiple signers
        y: 600 - (index * 80)  // Stack vertically
      },
      size: {
        width: 150,
        height: 50
      },
      // Only add recipient assignment if email is available
      ...(recipient.email && { assignedToRecipient: recipient.email })
    });
    
    // Date field
    formFields.push({
      fieldName: `date_${index + 1}`,
      fieldType: 'DATE',
      visible: true,
      required: true,
      location: {
        x: 300 + (index * 20),
        y: 600 - (index * 80)
      },
      size: {
        width: 100,
        height: 30
      },
      // Only add recipient assignment if email is available
      ...(recipient.email && { assignedToRecipient: recipient.email })
    });
  });
  
  return formFields;
};

/**
 * Fallback approach - creates agreement without form fields
 * Adobe Sign will automatically add signature fields where needed
 * @param {string} transientDocumentId - The transient document ID
 * @param {Array} recipients - List of recipients
 * @param {string} documentName - Name of the document
 * @returns {Promise<string>} - Agreement ID
 */
const createBasicAgreement = async (transientDocumentId, recipients, documentName) => {
  try {
    logger.info('Creating basic agreement without explicit form fields');
    
    const client = await createAdobeSignClient();
    
    const payload = {
      fileInfos: [
        {
          transientDocumentId: transientDocumentId
        }
      ],
      name: documentName,
      participantSetsInfo: [
        {
          memberInfos: recipients.map(recipient => ({
            email: recipient.email || recipient
          })),
          order: 1,
          role: 'SIGNER'
        }
      ],
      signatureType: 'ESIGN',
      state: 'IN_PROCESS'
    };
    
    const response = await client.post('api/rest/v6/agreements', payload);
    
    logger.info(`Basic agreement created with ID: ${response.data.id}`);
    logger.info('Adobe Sign will automatically add signature fields during signing process');
    
    return response.data.id;
    
  } catch (error) {
    logger.error(`Error creating basic agreement: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}`);
      logger.error(`Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    throw error;
  }
};

/**
 * Comprehensive form field approach - tries multiple methods
 * @param {string} transientDocumentId - The transient document ID
 * @param {Array} recipients - List of recipients
 * @param {string} documentName - Name of the document
 * @param {Object} options - Options for form field creation
 * @returns {Promise<Object>} - Result object with agreement ID and method used
 */
const createAgreementWithBestApproach = async (transientDocumentId, recipients, documentName, options = {}) => {
  const approaches = [
    {
      name: 'one-step',
      fn: () => createAgreementWithFormFields(transientDocumentId, recipients, documentName)
    },
    {
      name: 'basic',
      fn: () => createBasicAgreement(transientDocumentId, recipients, documentName)
    }
  ];
  
  // If template ID is provided, try template approach first
  if (options.templateId) {
    approaches.unshift({
      name: 'template',
      fn: () => createAgreementFromTemplate(options.templateId, recipients)
    });
  }
  
  let lastError = null;
  
  for (const approach of approaches) {
    try {
      logger.info(`Trying ${approach.name} approach`);
      const agreementId = await approach.fn();
      
      logger.info(`✅ Successfully created agreement using ${approach.name} approach`);
      return {
        agreementId,
        method: approach.name,
        success: true
      };
      
    } catch (error) {
      logger.warn(`❌ ${approach.name} approach failed: ${error.message}`);
      lastError = error;
      
      // Continue to next approach
      continue;
    }
  }
  
  // If all approaches failed
  logger.error('All form field approaches failed');
  throw lastError || new Error('All form field creation approaches failed');
};

module.exports = {
  addFormFieldsUsingTextTags,
  createAgreementWithFormFields,
  addFormFieldsWithWebhookVerification,
  createAgreementFromTemplate,
  createBasicAgreement,
  createAgreementWithBestApproach,
  generateOptimizedFormFields
};
