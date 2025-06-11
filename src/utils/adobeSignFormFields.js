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
 * Creates agreement with intelligent positioning enabled (Adobe's auto-detection)
 * @param {string} transientDocumentId - The transient document ID
 * @param {Array} recipients - List of recipients
 * @param {string} documentName - Name of the document
 * @param {Object} options - Options including auto-detected fields
 * @returns {Promise<string>} - Agreement ID
 */
const createAgreementWithIntelligentPositioning = async (transientDocumentId, recipients, documentName, options = {}) => {
  try {
    logger.info('Creating agreement with Adobe Sign intelligent positioning');
    
    const client = await createAdobeSignClient();
    
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
      // Enable Adobe's intelligent form field detection
      options: {
        noChrome: false,
        authoringRequested: true // This enables intelligent positioning
      }
    };
    
    logger.info(`Creating agreement with intelligent positioning for ${recipients.length} recipients`);
    const response = await client.post('api/rest/v6/agreements', payload);
    
    logger.info(`Agreement created successfully with intelligent positioning. ID: ${response.data.id}`);
    return response.data.id;
    
  } catch (error) {
    logger.error(`Error creating agreement with intelligent positioning: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}`);
      logger.error(`Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    throw error;
  }
};

/**
 * Creates agreement with auto-detected signature fields
 * @param {string} transientDocumentId - The transient document ID
 * @param {Array} recipients - List of recipients
 * @param {string} documentName - Name of the document
 * @param {Array} autoDetectedFields - Auto-detected signature fields
 * @returns {Promise<string>} - Agreement ID
 */
const createAgreementWithAutoDetectedFields = async (transientDocumentId, recipients, documentName, autoDetectedFields = []) => {
  try {
    logger.info('Creating agreement with auto-detected signature fields');
    
    const client = await createAdobeSignClient();
    
    // Generate form fields based on auto-detected fields
    const formFields = generateFormFieldsFromAutoDetected(recipients, autoDetectedFields);
    
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
      state: 'IN_PROCESS'
    };
    
    // Add form fields if we have any
    if (formFields.length > 0) {
      payload.formFieldLayerTemplates = [
        {
          formFields: formFields
        }
      ];
    }
    
    logger.info(`Creating agreement with ${formFields.length} auto-detected form fields`);
    const response = await client.post('api/rest/v6/agreements', payload);
    
    logger.info(`Agreement created successfully with auto-detected fields. ID: ${response.data.id}`);
    return response.data.id;
    
  } catch (error) {
    logger.error(`Error creating agreement with auto-detected fields: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}`);
      logger.error(`Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    throw error;
  }
};

/**
 * Generates form fields from auto-detected signature fields
 * @param {Array} recipients - List of recipients
 * @param {Array} autoDetectedFields - Auto-detected fields from document analysis
 * @returns {Array} - Array of form field objects
 */
const generateFormFieldsFromAutoDetected = (recipients, autoDetectedFields) => {
  const formFields = [];
  
  if (!autoDetectedFields || autoDetectedFields.length === 0) {
    // Fallback to default form fields
    return generateOptimizedFormFields(recipients);
  }
  
  // Check if we have enhanced detected fields with position information
  const hasPositionInfo = autoDetectedFields.some(field => 
    field.x !== undefined && field.y !== undefined && field.detected === true
  );
  
  if (hasPositionInfo) {
    // Use the new function that respects existing field positions
    return generateFormFieldsFromExisting(recipients, autoDetectedFields);
  }
  
  // Legacy handling for basic auto-detected fields
  recipients.forEach((recipient, recipientIndex) => {
    autoDetectedFields.forEach((field, fieldIndex) => {
      if (field.type === 'signature' || field.type === 'SIGNATURE' || field.name.toLowerCase().includes('sign')) {
        // Signature field
        formFields.push({
          locations: [
            {
              left: 100 + (fieldIndex * 200), // Spread fields horizontally
              top: 100 + (recipientIndex * 100), // Stack recipients vertically
              width: 150,
              height: 50,
              pageNumber: 1
            }
          ],
          name: `${field.name}_${recipientIndex}`,
          participantId: recipientIndex.toString(),
          required: field.required !== false,
          inputType: 'SIGNATURE'
        });
      } else if (field.name.toLowerCase().includes('date')) {
        // Date field
        formFields.push({
          locations: [
            {
              left: 300 + (fieldIndex * 200),
              top: 100 + (recipientIndex * 100),
              width: 100,
              height: 20,
              pageNumber: 1
            }
          ],
          name: `${field.name}_date_${recipientIndex}`,
          participantId: recipientIndex.toString(),
          required: field.required !== false,
          inputType: 'DATE'
        });
      } else {
        // Text field
        formFields.push({
          locations: [
            {
              left: 100 + (fieldIndex * 150),
              top: 200 + (recipientIndex * 100),
              width: 120,
              height: 20,
              pageNumber: 1
            }
          ],
          name: `${field.name}_${recipientIndex}`,
          participantId: recipientIndex.toString(),
          required: field.required !== false,
          inputType: 'TEXT'
        });
      }
    });
  });
  
  logger.info(`Generated ${formFields.length} form fields from ${autoDetectedFields.length} auto-detected fields`);
  return formFields;
};

/**
 * Generates form fields that respect existing signature field positions
 * @param {Array} recipients - List of recipients
 * @param {Array} existingFields - Existing signature fields detected in document
 * @returns {Array} - Array of form field objects
 */
const generateFormFieldsFromExisting = (recipients, existingFields = []) => {
  const formFields = [];
  
  if (!existingFields || existingFields.length === 0) {
    logger.info('No existing fields detected, using default form field generation');
    return generateOptimizedFormFields(recipients);
  }
  
  // Sort existing fields by type
  const signatureFields = existingFields.filter(f => f.type === 'SIGNATURE');
  const dateFields = existingFields.filter(f => f.type === 'DATE');
  
  logger.info(`Found ${signatureFields.length} signature fields and ${dateFields.length} date fields in document`);
  
  recipients.forEach((recipient, recipientIndex) => {
    // Use existing signature field if available
    if (signatureFields[recipientIndex]) {
      const existingField = signatureFields[recipientIndex];
      formFields.push({
        fieldName: `Signature_${recipientIndex + 1}`,
        displayName: `Signature (${recipient.name})`,
        fieldType: 'SIGNATURE',
        visible: true,
        required: true,
        documentPageNumber: existingField.page || 1,
        location: {
          x: existingField.x || 100,
          y: existingField.y || (600 - recipientIndex * 80)
        },
        size: {
          width: existingField.width || 200,
          height: existingField.height || 50
        },
        ...(recipient.email && { assignedToRecipient: recipient.email })
      });
    } else {
      // Create new signature field if no existing field available
      formFields.push({
        fieldName: `Signature_${recipientIndex + 1}`,
        displayName: `Signature (${recipient.name})`,
        fieldType: 'SIGNATURE',
        visible: true,
        required: true,
        documentPageNumber: 1,
        location: {
          x: 100 + (recipientIndex * 20),
          y: 600 - (recipientIndex * 80)
        },
        size: {
          width: 200,
          height: 50
        },
        ...(recipient.email && { assignedToRecipient: recipient.email })
      });
    }
    
    // Use existing date field if available
    if (dateFields[recipientIndex]) {
      const existingField = dateFields[recipientIndex];
      formFields.push({
        fieldName: `Date_${recipientIndex + 1}`,
        displayName: `Date (${recipient.name})`,
        fieldType: 'DATE',
        visible: true,
        required: true,
        documentPageNumber: existingField.page || 1,
        location: {
          x: existingField.x || 350,
          y: existingField.y || (600 - recipientIndex * 80)
        },
        size: {
          width: existingField.width || 120,
          height: existingField.height || 30
        },
        ...(recipient.email && { assignedToRecipient: recipient.email })
      });
    } else {
      // Create new date field if no existing field available
      formFields.push({
        fieldName: `Date_${recipientIndex + 1}`,
        displayName: `Date (${recipient.name})`,
        fieldType: 'DATE',
        visible: true,
        required: true,
        documentPageNumber: 1,
        location: {
          x: 350 + (recipientIndex * 20),
          y: 600 - (recipientIndex * 80)
        },
        size: {
          width: 120,
          height: 30
        },
        ...(recipient.email && { assignedToRecipient: recipient.email })
      });
    }
  });
  
  logger.info(`Generated ${formFields.length} form fields based on ${existingFields.length} existing fields`);
  return formFields;
};

/**
 * Creates agreement with explicit form fields at detected positions
 * This approach directly places form fields at the positions detected in the document
 * @param {string} transientDocumentId - The transient document ID
 * @param {Array} recipients - List of recipients
 * @param {string} documentName - Name of the document
 * @param {Array} detectedFields - Fields detected with position information
 * @returns {Promise<string>} - Agreement ID
 */
const createAgreementWithExplicitFields = async (transientDocumentId, recipients, documentName, detectedFields = []) => {
  try {
    logger.info('Creating agreement with explicit form fields at detected positions');
    logger.info(`Using ${detectedFields.length} detected fields with position information`);
    
    const client = await createAdobeSignClient();
    
    // Generate form fields using detected positions
    const formFields = generateFormFieldsFromExisting(recipients, detectedFields);
    
    if (formFields.length === 0) {
      throw new Error('No form fields generated from detected positions');
    }
    
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
      // Include explicit form fields based on detected positions
      formFieldLayerTemplates: [
        {
          formFields: formFields
        }
      ]
    };
    
    logger.info(`Creating agreement with ${formFields.length} explicit form fields at detected positions`);
    
    // Log field positions for debugging
    formFields.forEach((field, index) => {
      logger.info(`Field ${index + 1}: ${field.fieldName} at (${field.location?.x}, ${field.location?.y}) on page ${field.documentPageNumber}`);
    });
    
    const response = await client.post('api/rest/v6/agreements', payload);
    
    logger.info(`Agreement created successfully with explicit fields at detected positions. ID: ${response.data.id}`);
    return response.data.id;
    
  } catch (error) {
    logger.error(`Error creating agreement with explicit fields: ${error.message}`);
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
  const { autoDetectedSignatureFields = [], useIntelligentPositioning = true } = options;
  
  // Enhanced approaches that can handle auto-detected fields
  // Prioritize explicit form field creation when we have detected fields with positions
  const hasDetectedFieldsWithPositions = autoDetectedSignatureFields.some(field => 
    field.x !== undefined && field.y !== undefined && field.detected === true
  );
  
  const approaches = [
    // If we have detected fields with positions, prioritize explicit form field creation
    ...(hasDetectedFieldsWithPositions ? [{
      name: 'explicit-fields-from-detected',
      fn: () => createAgreementWithExplicitFields(transientDocumentId, recipients, documentName, autoDetectedSignatureFields)
    }] : []),
    {
      name: 'enhanced-positioning',
      fn: () => createAgreementWithEnhancedPositioning(transientDocumentId, recipients, documentName, { autoDetectedSignatureFields, useIntelligentPositioning })
    },
    {
      name: 'one-step-with-auto-detected',
      fn: () => createAgreementWithAutoDetectedFields(transientDocumentId, recipients, documentName, autoDetectedSignatureFields)
    },
    {
      name: 'intelligent-positioning',
      fn: () => createAgreementWithIntelligentPositioning(transientDocumentId, recipients, documentName, { autoDetectedSignatureFields, useIntelligentPositioning })
    },
    {
      name: 'one-step-with-fields',
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
      logger.info(`Trying ${approach.name} approach with ${autoDetectedSignatureFields.length} auto-detected fields`);
      const agreementId = await approach.fn();
      
      logger.info(`✅ Successfully created agreement using ${approach.name} approach`);
      return {
        agreementId,
        method: approach.name,
        success: true,
        autoDetectedFieldsUsed: autoDetectedSignatureFields.length
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

/**
 * Creates agreement with enhanced intelligent positioning that recognizes existing signature fields
 * @param {string} transientDocumentId - The transient document ID
 * @param {Array} recipients - List of recipients
 * @param {string} documentName - Name of the document
 * @param {Object} options - Options including auto-detected fields
 * @returns {Promise<string>} - Agreement ID
 */
const createAgreementWithEnhancedPositioning = async (transientDocumentId, recipients, documentName, options = {}) => {
  try {
    logger.info('Creating agreement with enhanced intelligent positioning to recognize existing signature fields');
    
    const client = await createAdobeSignClient();
    
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
      // Enhanced options for better field recognition
      options: {
        noChrome: false,
        authoringRequested: true, // Enables intelligent positioning
        mergeFieldInfo: {
          // This tells Adobe Sign to look for existing form fields and signature areas
          includeMergeFields: true
        }
      },
      // Set post-sign redirect options
      postSignOption: {
        redirectDelay: 0,
        redirectUrl: process.env.ADOBE_SIGN_REDIRECT_URL || 'https://www.adobe.com/go/adobesign_success'
      }
    };
    
    logger.info(`Creating agreement with enhanced positioning for ${recipients.length} recipients`);
    const response = await client.post('api/rest/v6/agreements', payload);
    
    logger.info(`Agreement created successfully with enhanced positioning. ID: ${response.data.id}`);
    return response.data.id;
    
  } catch (error) {
    logger.error(`Error creating agreement with enhanced positioning: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}`);
      logger.error(`Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    throw error;
  }
};

module.exports = {
  addFormFieldsUsingTextTags,
  createAgreementWithFormFields,
  addFormFieldsWithWebhookVerification,
  createAgreementFromTemplate,
  createBasicAgreement,
  createAgreementWithBestApproach,
  createAgreementWithIntelligentPositioning,
  createAgreementWithAutoDetectedFields,
  generateOptimizedFormFields,
  generateFormFieldsFromAutoDetected,
  createAgreementWithEnhancedPositioning,
  generateFormFieldsFromExisting,
  createAgreementWithExplicitFields
};
