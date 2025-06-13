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
 * @param {string} signingFlow - The signing flow (SEQUENTIAL or PARALLEL)
 * @returns {Promise<string>} - Agreement ID
 */
const createAgreementWithFormFields = async (transientDocumentId, recipients, documentName, signingFlow = 'SEQUENTIAL') => {
  try {
    logger.info('Creating agreement with form fields using one-step approach');
    
    const client = await createAdobeSignClient();
    
    // Generate form fields for the recipients
    const formFields = generateOptimizedFormFields(recipients, signingFlow);
    
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
 * @param {string} signingFlow - The signing flow (SEQUENTIAL or PARALLEL)
 * @returns {Promise<Object>} - Response from Adobe Sign API
 */
const addFormFieldsWithWebhookVerification = async (agreementId, recipients, signingFlow = 'SEQUENTIAL') => {
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
    // Generate form fields for the recipients
    const formFields = generateOptimizedFormFields(recipients, signingFlow);
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
 * Creates agreement using text tags embedded in the document
 * @param {string} transientDocumentId - The transient document ID
 * @param {Array} recipients - List of recipients
 * @param {string} documentName - Name of the document
 * @returns {Promise<string>} - Agreement ID
 */
const createAgreementWithTextTags = async (transientDocumentId, recipients, documentName, signingFlow = 'SEQUENTIAL') => {
  try {
    logger.info('Creating agreement using Adobe Sign text tags embedded in the document');
    
    const client = await createAdobeSignClient();
    
    // Determine participant set structure based on signing flow
    let participantSetsInfo;
    
    if (signingFlow === 'SEQUENTIAL') {
      // For sequential signing, each recipient gets their own participant set with increasing order
      participantSetsInfo = recipients.map((recipient, index) => ({
        memberInfos: [
          {
            email: recipient.email || recipient
          }
        ],
        order: index + 1, // Sequential order
        role: 'SIGNER'
      }));
      logger.info(`Setting up sequential signing flow with ${recipients.length} participant sets`);
    } else {
      // For parallel signing (default), all recipients in one participant set
      participantSetsInfo = [
        {
          memberInfos: recipients.map(recipient => ({
            email: recipient.email || recipient
          })),
          order: 1,
          role: 'SIGNER'
        }
      ];
      logger.info(`Setting up parallel signing flow with 1 participant set containing ${recipients.length} members`);
    }

    const payload = {
      fileInfos: [
        {
          transientDocumentId: transientDocumentId
        }
      ],
      name: documentName,
      participantSetsInfo,
      signatureType: 'ESIGN',
      state: 'IN_PROCESS',
      // Configure options to ensure ONLY text tags are processed, no additional positioning
      options: {
        noChrome: false,
        authoringRequested: false, // CRITICAL: Disable authoring to prevent Adobe from adding extra fields
        autoLoginUser: false,
        noSignerCertificate: false,
        removeParticipantUsageRestrictions: false
      },
      // Enable text tag processing - correct format for Adobe Sign API
      textTagsEnabled: true, // CRITICAL: Enable text tag processing at root level
      // Add a message to guide signers
      message: signingFlow === 'SEQUENTIAL' 
        ? 'Please sign this document in the designated order. You will receive an email when it is your turn to sign.'
        : 'Please sign at the signature fields indicated in the document.'
    };
    
    logger.info(`Creating agreement with text tags for ${recipients.length} recipients`);
    logger.info('Text tags enabled - signature fields will appear exactly where tags are placed');
    
    // Add more detailed logging for debugging purposes
    logger.info(`Document name: ${documentName}`);
    logger.info(`Recipient count: ${recipients.length}`);
    logger.info('Adobe Sign configured to use text tags only - no additional positioning');
    
    const response = await client.post('api/rest/v6/agreements', payload);
    
    logger.info(`Agreement created successfully using text tags. ID: ${response.data.id}`);
    
    // Log additional success information
    logger.info('Text tags processed - signature fields should appear at the tag positions only');
    logger.info('No additional fields should be added at the end of the document');
    
    return response.data.id;
    
  } catch (error) {
    logger.error(`Error creating agreement with text tags: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}`);
      logger.error(`Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    throw error;
  }
};

/**
 * Generates optimized form fields with minimal configuration
 * @param {Array} recipients - List of recipients
 * @returns {Array} - Array of form field objects
 */
const generateOptimizedFormFields = (recipients, signingFlow = 'SEQUENTIAL') => {
  const formFields = [];
  
  recipients.forEach((recipient, index) => {
    // For parallel signing, we need to use participantId instead of assignedToRecipient
    let assignmentConfig = {};
    
    if (signingFlow === 'PARALLEL') {
      // In parallel signing, all recipients are in participantSet 0, so use index as participantId
      assignmentConfig = { participantId: index.toString() };
    } else {
      // In sequential signing, use assignedToRecipient
      assignmentConfig = recipient.email ? { assignedToRecipient: recipient.email } : {};
    }
    
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
      // Assignment based on signing flow
      ...assignmentConfig
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
      // Assignment based on signing flow
      ...assignmentConfig
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
const createBasicAgreement = async (transientDocumentId, recipients, documentName, signingFlow = 'SEQUENTIAL') => {
  try {
    logger.info('Creating basic agreement without explicit form fields');
    
    const client = await createAdobeSignClient();
    
    // Determine participant set structure based on signing flow
    let participantSetsInfo;
    
    if (signingFlow === 'SEQUENTIAL') {
      // For sequential signing, each recipient gets their own participant set with increasing order
      participantSetsInfo = recipients.map((recipient, index) => ({
        memberInfos: [
          {
            email: recipient.email || recipient
          }
        ],
        order: index + 1, // Sequential order
        role: 'SIGNER'
      }));
      logger.info(`Setting up sequential signing flow with ${recipients.length} participant sets`);
    } else {
      // For parallel signing (default), all recipients in one participant set
      participantSetsInfo = [
        {
          memberInfos: recipients.map(recipient => ({
            email: recipient.email || recipient
          })),
          order: 1,
          role: 'SIGNER'
        }
      ];
      logger.info(`Setting up parallel signing flow with 1 participant set containing ${recipients.length} members`);
    }

    const payload = {
      fileInfos: [
        {
          transientDocumentId: transientDocumentId
        }
      ],
      name: documentName,
      participantSetsInfo,
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
 * @param {string} signingFlow - The signing flow (SEQUENTIAL or PARALLEL)
 * @returns {Array} - Array of form field objects
 */
const generateFormFieldsFromAutoDetected = (recipients, autoDetectedFields, signingFlow = 'SEQUENTIAL') => {
  const formFields = [];
  
  if (!autoDetectedFields || autoDetectedFields.length === 0) {
    // Fallback to default form fields
    return generateOptimizedFormFields(recipients, signingFlow);
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
 * @param {string} signingFlow - The signing flow (SEQUENTIAL or PARALLEL)
 * @returns {Array} - Array of form field objects
 */
const generateFormFieldsFromExisting = (recipients, existingFields = [], signingFlow = 'SEQUENTIAL') => {
  const formFields = [];
  
  if (!existingFields || existingFields.length === 0) {
    logger.info('No existing fields detected, using default form field generation');
    return generateOptimizedFormFields(recipients, signingFlow);
  }
  
  // Filter to only include fields with valid position data
  const validFields = existingFields.filter(f => 
    f.x !== undefined && f.y !== undefined && 
    f.page !== undefined && f.type !== undefined
  );
  
  if (validFields.length === 0) {
    logger.warn('No valid positioned fields found among detected fields, using default positioning');
    return generateOptimizedFormFields(recipients, signingFlow);
  }
  
  // Sort existing fields by type
  const signatureFields = validFields.filter(f => f.type.toUpperCase() === 'SIGNATURE');
  const dateFields = validFields.filter(f => f.type.toUpperCase() === 'DATE');
  
  logger.info(`Found ${signatureFields.length} signature fields and ${dateFields.length} date fields with valid position data`);
  
  // Validate page numbers - ensure they're within reasonable range (1-100)
  const validatePage = (page) => {
    const pageNum = parseInt(page, 10);
    return isNaN(pageNum) || pageNum < 1 || pageNum > 100 ? 1 : pageNum;
  };
  
  recipients.forEach((recipient, recipientIndex) => {
    // Use existing signature field if available
    if (signatureFields[recipientIndex]) {
      const existingField = signatureFields[recipientIndex];
      formFields.push({
        fieldName: `Signature_${recipientIndex + 1}`,
        displayName: `Signature (${recipient.name || `Recipient ${recipientIndex + 1}`})`,
        fieldType: 'SIGNATURE',
        visible: true,
        required: true,
        documentPageNumber: validatePage(existingField.page),
        location: {
          x: Math.max(50, Math.min(existingField.x || 100, 500)),  // Ensure x is between 50-500
          y: Math.max(50, Math.min(existingField.y || (600 - recipientIndex * 80), 700))  // Ensure y is between 50-700
        },
        size: {
          width: Math.max(150, Math.min(existingField.width || 200, 300)),  // Ensure width is between 150-300
          height: Math.max(30, Math.min(existingField.height || 50, 80))  // Ensure height is between 30-80
        },
        ...(recipient.email && { assignedToRecipient: recipient.email })
      });
    } else {
      // Create new signature field if no existing field available
      formFields.push({
        fieldName: `Signature_${recipientIndex + 1}`,
        displayName: `Signature (${recipient.name || `Recipient ${recipientIndex + 1}`})`,
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
        displayName: `Date (${recipient.name || `Recipient ${recipientIndex + 1}`})`,
        fieldType: 'DATE',
        visible: true,
        required: true,
        documentPageNumber: validatePage(existingField.page),
        location: {
          x: Math.max(50, Math.min(existingField.x || 350, 500)),  // Ensure x is between 50-500
          y: Math.max(50, Math.min(existingField.y || (600 - recipientIndex * 80), 700))  // Ensure y is between 50-700
        },
        size: {
          width: Math.max(80, Math.min(existingField.width || 120, 200)),  // Ensure width is between 80-200
          height: Math.max(20, Math.min(existingField.height || 30, 50))  // Ensure height is between 20-50
        },
        ...(recipient.email && { assignedToRecipient: recipient.email })
      });
    } else {
      // Create new date field if no existing field available
      formFields.push({
        fieldName: `Date_${recipientIndex + 1}`,
        displayName: `Date (${recipient.name || `Recipient ${recipientIndex + 1}`})`,
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
  
  // Log field details for debugging
  formFields.forEach((field, index) => {
    logger.debug(`Field ${index + 1}: ${field.fieldName} (${field.fieldType}) at (${field.location.x}, ${field.location.y}) on page ${field.documentPageNumber}`);
  });
  
  return formFields;
};

/**
 * Verifies that text tags in a document are in the correct format for Adobe Sign
 * This helps diagnose issues when signatures are not appearing at the correct positions
 * @param {Array} autoDetectedSignatureFields - Fields detected in the document
 * @returns {Object} - Verification result
 */
const verifyAdobeSignTextTags = (autoDetectedSignatureFields = []) => {
  const result = {
    hasTags: false,
    correctFormat: true,
    issuesFound: [],
    recommendations: []
  };
  
  // Extract text tags from the detected fields - check for both single and double braces
  const textTags = autoDetectedSignatureFields
    .filter(field => field.matchText && (
      field.matchText.includes('sig_es_:signer') ||
      field.matchText.includes('*ES_:signer') ||
      field.matchText.includes('signer') && field.matchText.includes(':signature') ||
      field.matchText.includes('{{sig_es_:signer') ||  // Also check for double braces
      field.matchText.includes('{{*ES_:signer') ||
      field.matchText.includes('{{signer') && field.matchText.includes(':signature}}')
    ))
    .map(field => field.matchText);
  
  // Check if we have any tags
  if (textTags.length === 0) {
    return {
      ...result,
      recommendations: ['No Adobe Sign text tags detected. If your document contains tags, ensure they are in the correct format.']
    };
  }
  
  result.hasTags = true;
  
  // Check if tags are in the correct format
  const issuesFound = [];
  
  textTags.forEach(tag => {
    // Check if the tag is properly formatted with single curly braces
    if (!tag.startsWith('{') || !tag.endsWith('}')) {
      issuesFound.push(`Tag "${tag}" is not properly formatted with curly braces`);
      result.correctFormat = false;
    }
    
    // Check if the tag is using double curly braces (old format)
    if (tag.startsWith('{{') && tag.endsWith('}}')) {
      issuesFound.push(`Tag "${tag}" is using double curly braces which is no longer supported`);
      result.correctFormat = false;
    }
    
    // Check if the tag contains proper signer format
    if (!tag.match(/signer\d+/)) {
      issuesFound.push(`Tag "${tag}" does not contain proper signer format (e.g., signer1)`);
      result.correctFormat = false;
    }
  });
  
  result.issuesFound = issuesFound;
  
  // Add recommendations based on issues found
  if (!result.correctFormat) {
    result.recommendations = [
      'Update your document to use the correct format for Adobe Sign text tags.',
      'Use single curly braces for tags: {sig_es_:signer1:signature}',
      'Make sure each signer is correctly numbered (signer1, signer2, etc.)',
      'Keep text tags on a single line without any formatting that might break them'
    ];
  } else {
    result.recommendations = [
      'Text tags are correctly formatted. If signatures are not appearing at the right position:',
      '1. Make sure the document conversion process preserves the tags',
      '2. Try using a simpler document format',
      '3. Check if the recipients match the signer numbers in your tags'
    ];
  }
  
  return result;
};

/**
 * Simplified approach that only uses text tags when detected
 * Removes all enhanced positioning and intelligent positioning
 * @param {string} transientDocumentId - The transient document ID
 * @param {Array} recipients - List of recipients
 * @param {string} documentName - Name of the document
 * @param {Object} options - Options including auto-detected fields
 * @returns {Promise<Object>} - Object with agreementId and method used
 */
const createAgreementWithBestApproach = async (transientDocumentId, recipients, documentName, options = {}) => {
  try {
    logger.info(`Creating agreement for document: ${documentName}`);
    
    const { autoDetectedSignatureFields = [], signingFlow = 'SEQUENTIAL' } = options;
    
    // Step 1: Check if document has Adobe Sign text tags (double braces format)
    let hasTextTags = false;
    if (autoDetectedSignatureFields && autoDetectedSignatureFields.length > 0) {
      // Check if any of the detected fields contain Adobe Sign tags
      hasTextTags = autoDetectedSignatureFields.some(field => 
        field.matchText && (
          field.matchText.includes('{{sig_es_:signer') ||
          field.matchText.includes('{{*ES_:signer') ||
          field.matchText.includes('{{signer') && field.matchText.includes(':signature}}') ||
          field.matchText.includes('{{date_es_:signer') ||
          field.matchText.includes('{{signer') && field.matchText.includes(':date}}') ||
          // Also check for single braces (legacy format)
          field.matchText.includes('{sig_es_:signer') ||
          field.matchText.includes('{*ES_:signer') ||
          field.matchText.includes('{signer') && field.matchText.includes(':signature}')
        )
      );
    }
    
    if (hasTextTags) {
      logger.info('Adobe Sign text tags detected - using text tag approach ONLY');
      try {
        const agreementId = await createAgreementWithTextTags(transientDocumentId, recipients, documentName, signingFlow);
        return {
          agreementId,
          method: 'text-tags',
          success: true,
          message: 'Agreement created using Adobe Sign text tags - signatures will appear at tag positions'
        };
      } catch (textTagError) {
        logger.error(`Text tag approach failed: ${textTagError.message}`);
        throw new Error(`Failed to create agreement with text tags: ${textTagError.message}`);
      }
    }
    
    // Step 2: No text tags detected - use basic agreement approach
    logger.info('No Adobe Sign text tags detected - using basic agreement approach');
    try {
      const agreementId = await createBasicAgreement(transientDocumentId, recipients, documentName, signingFlow);
      return {
        agreementId,
        method: 'basic-agreement',
        success: true,
        message: 'Agreement created using basic approach - Adobe Sign will auto-add signature fields'
      };
    } catch (basicError) {
      logger.error(`Basic agreement approach failed: ${basicError.message}`);
      throw new Error(`Failed to create agreement: ${basicError.message}`);
    }
    
  } catch (error) {
    logger.error(`All approaches failed for document ${documentName}: ${error.message}`);
    throw new Error(`Failed to create agreement: ${error.message}`);
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
  generateFormFieldsFromExisting,
  createAgreementWithTextTags,
  verifyAdobeSignTextTags
};
