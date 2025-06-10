/**
 * Utility functions for Adobe Sign integration
 */

const { createAdobeSignClient } = require('../config/adobeSign');
const logger = require('./logger');

/**
 * Adds form fields to an existing Adobe Sign agreement
 * @param {string} agreementId - The ID of the agreement
 * @param {Array} recipients - Array of recipient objects with email and name
 * @param {number} pageCount - Number of pages in the document
 * @returns {Promise<Object>} - Response from Adobe Sign API
 */
const addFormFieldsToAgreement = async (agreementId, recipients, pageCount = 1) => {
  try {
    logger.info(`Adding form fields to agreement: ${agreementId}`);
    
    // Get Adobe Sign client
    const adobeSignClient = await createAdobeSignClient();
    
    // Create form fields for each recipient
    const formFields = [];
    
    // Add signature and date fields for each recipient
    recipients.forEach((recipient, index) => {
      // Add signature field
      formFields.push({
        fieldName: `Signature_${index + 1}`,
        displayName: `Signature (${recipient.name})`,
        defaultValue: "",
        fieldType: "SIGNATURE",
        visible: true,
        required: true,
        documentPageNumber: pageCount, // Place on the last page
        location: {
          x: 70,
          y: 650 + (index * 60) // Stack vertically with some spacing
        },
        size: {
          width: 200,
          height: 50
        },
        assignedToRecipient: recipient.email
      });
      
      // Add date field
      formFields.push({
        fieldName: `Date_${index + 1}`,
        displayName: `Date (${recipient.name})`,
        defaultValue: "",
        fieldType: "DATE",
        visible: true,
        required: true,
        documentPageNumber: pageCount,
        location: {
          x: 300,
          y: 650 + (index * 60)
        },
        size: {
          width: 100,
          height: 40
        },
        assignedToRecipient: recipient.email
      });
    });
    
    logger.info(`Adding ${formFields.length} form fields to agreement ${agreementId}`);
    
    // Add form fields to the agreement
    const response = await adobeSignClient.post(
      `api/rest/v6/agreements/${agreementId}/formFields`, 
      { formFields }
    );
    
    logger.info(`Successfully added form fields to agreement ${agreementId}`);
    return response.data;
  } catch (error) {
    logger.error(`Error adding form fields to agreement ${agreementId}: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
};

module.exports = {
  addFormFieldsToAgreement
};
