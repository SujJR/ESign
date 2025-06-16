/**
 * Adobe Sign Text Tag Utility
 * This approach embeds form fields directly in PDF documents using text tags
 * Text tags are more reliable than programmatic form field addition
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const logger = require('./logger');

/**
 * Text tag patterns for different field types
 */
const TEXT_TAGS = {
  signature: (recipientId = 1, fieldName = 'signature') => `{{*ES_:signer${recipientId}:${fieldName}}}`,
  date: (recipientId = 1, fieldName = 'date') => `{{*ES_:signer${recipientId}:${fieldName}}}`,
  text: (recipientId = 1, fieldName = 'name') => `{{${fieldName}_es_:signer${recipientId}}}`,
  checkbox: (recipientId = 1, fieldName = 'agree') => `{{${fieldName}_es_:signer${recipientId}:checkbox}}`,
  dropdown: (recipientId = 1, fieldName = 'selection', options = ['Option1', 'Option2']) => 
    `{{${fieldName}_es_:signer${recipientId}:dropdown:${options.join('|')}}}`
};

/**
 * Generates text tags for a document based on recipients
 * @param {Array} recipients - List of recipients
 * @param {Object} options - Configuration options
 * @returns {Object} - Object containing text tags and positioning info
 */
const generateTextTags = (recipients, options = {}) => {
  const tags = [];
  const positions = [];
  
  recipients.forEach((recipient, index) => {
    const recipientId = index + 1;
    
    // Standard signature and date fields
    tags.push({
      tag: TEXT_TAGS.signature(recipientId, `signature_${recipientId}`),
      type: 'signature',
      recipient: recipient.email,
      recipientId,
      description: `Signature field for ${recipient.name || recipient.email}`
    });
    
    tags.push({
      tag: TEXT_TAGS.date(recipientId, `date_${recipientId}`),
      type: 'date',
      recipient: recipient.email,
      recipientId,
      description: `Date field for ${recipient.name || recipient.email}`
    });
    
    // Optional name field
    if (options.includeName) {
      tags.push({
        tag: TEXT_TAGS.text(recipientId, `name_${recipientId}`),
        type: 'text',
        recipient: recipient.email,
        recipientId,
        description: `Name field for ${recipient.name || recipient.email}`
      });
    }
    
    // Custom fields if specified
    if (options.customFields) {
      options.customFields.forEach(field => {
        tags.push({
          tag: TEXT_TAGS[field.type] ? TEXT_TAGS[field.type](recipientId, field.name) : `{{${field.name}_es_:signer${recipientId}}}`,
          type: field.type,
          recipient: recipient.email,
          recipientId,
          description: field.description || `${field.name} field for ${recipient.name || recipient.email}`
        });
      });
    }
  });
  
  return { tags, positions };
};

/**
 * Creates a new PDF with text tags embedded
 * @param {string} outputPath - Path for the output PDF
 * @param {Array} recipients - List of recipients
 * @param {Object} options - Configuration options
 * @returns {Promise<string>} - Path to the created PDF
 */
const createPdfWithTextTags = async (outputPath, recipients, options = {}) => {
  try {
    logger.info(`Creating PDF with text tags: ${outputPath}`);
    
    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(outputPath));
    
    // Add title
    doc.fontSize(20).text(options.title || 'Document for Electronic Signature', 100, 100);
    
    // Add document content
    doc.fontSize(12).text(options.content || 'This document requires electronic signatures from the following parties:', 100, 150);
    
    let yPosition = 200;
    
    // Generate text tags for each recipient
    const { tags } = generateTextTags(recipients, options);
    
    recipients.forEach((recipient, index) => {
      const recipientId = index + 1;
      
      // Add recipient section
      doc.fontSize(14).text(`Recipient ${recipientId}: ${recipient.name || recipient.email}`, 100, yPosition);
      yPosition += 30;
      
      // Add signature line with text tag
      doc.fontSize(10).text(`Signature: ${TEXT_TAGS.signature(recipientId)}`, 100, yPosition);
      yPosition += 25;
      
      // Add date line with text tag
      doc.fontSize(10).text(`Date: ${TEXT_TAGS.date(recipientId)}`, 100, yPosition);
      yPosition += 25;
      
      // Add name field if requested
      if (options.includeName) {
        doc.fontSize(10).text(`Name: ${TEXT_TAGS.text(recipientId, `name_${recipientId}`)}`, 100, yPosition);
        yPosition += 25;
      }
      
      yPosition += 20; // Space between recipients
    });
    
    // Add additional content if provided
    if (options.additionalContent) {
      yPosition += 30;
      doc.fontSize(12).text(options.additionalContent, 100, yPosition);
    }
    
    doc.end();
    
    // Wait for PDF to be written
    await new Promise((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
    });
    
    logger.info(`PDF with text tags created successfully: ${outputPath}`);
    return outputPath;
    
  } catch (error) {
    logger.error(`Error creating PDF with text tags: ${error.message}`);
    throw error;
  }
};

/**
 * Modifies an existing PDF to add text tags at specific positions
 * Note: This is a simplified version - in practice, you'd use a PDF manipulation library
 * @param {string} inputPath - Path to the input PDF
 * @param {string} outputPath - Path for the output PDF
 * @param {Array} recipients - List of recipients
 * @param {Array} positions - Array of position objects for placing text tags
 * @returns {Promise<string>} - Path to the modified PDF
 */
const addTextTagsToPdf = async (inputPath, outputPath, recipients, positions = []) => {
  try {
    logger.info(`Adding text tags to existing PDF: ${inputPath} -> ${outputPath}`);
    
    // For now, we'll copy the file and add a note
    // In a production environment, you'd use a PDF manipulation library like PDF-lib
    await fs.promises.copyFile(inputPath, outputPath);
    
    const { tags } = generateTextTags(recipients);
    
    logger.info(`Text tags generated for ${recipients.length} recipients:`);
    tags.forEach(tag => {
      logger.info(`  ${tag.description}: ${tag.tag}`);
    });
    
    logger.warn('Note: This is a placeholder implementation.');
    logger.warn('For production use, implement PDF modification using pdf-lib or similar library.');
    logger.warn('Text tags should be embedded at specific coordinates in the PDF.');
    
    return outputPath;
    
  } catch (error) {
    logger.error(`Error adding text tags to PDF: ${error.message}`);
    throw error;
  }
};

/**
 * Validates text tags in a PDF (checks if they follow Adobe Sign format)
 * @param {Array} tags - Array of text tag objects
 * @returns {Object} - Validation result
 */
const validateTextTags = (tags) => {
  const validation = {
    valid: true,
    errors: [],
    warnings: []
  };
  
  tags.forEach((tag, index) => {
    // Check if tag follows Adobe Sign format
    if (!tag.tag.startsWith('{{') || !tag.tag.endsWith('}}')) {
      validation.valid = false;
      validation.errors.push(`Tag ${index + 1}: Invalid format - must be wrapped in double curly braces`);
    }
    
    // Check for required fields
    if (!tag.recipient) {
      validation.warnings.push(`Tag ${index + 1}: No recipient specified`);
    }
    
    // Check for duplicate field names
    const duplicates = tags.filter(t => t.tag === tag.tag && t !== tag);
    if (duplicates.length > 0) {
      validation.warnings.push(`Tag ${index + 1}: Duplicate field name detected`);
    }
  });
  
  return validation;
};

/**
 * Generates instructions for manual text tag insertion
 * @param {Array} recipients - List of recipients
 * @param {Object} options - Configuration options
 * @returns {string} - Instructions text
 */
const generateTextTagInstructions = (recipients, options = {}) => {
  const { tags } = generateTextTags(recipients, options);
  
  let instructions = 'Adobe Sign Text Tag Instructions\n';
  instructions += '=====================================\n\n';
  instructions += 'To add form fields to your PDF, insert the following text tags at the desired locations:\n\n';
  
  recipients.forEach((recipient, index) => {
    const recipientId = index + 1;
    instructions += `Recipient ${recipientId}: ${recipient.name || recipient.email}\n`;
    instructions += '----------------------------------------\n';
    
    const recipientTags = tags.filter(tag => tag.recipientId === recipientId);
    recipientTags.forEach(tag => {
      instructions += `${tag.description}: ${tag.tag}\n`;
    });
    instructions += '\n';
  });
  
  instructions += 'Notes:\n';
  instructions += '- Place text tags exactly where you want the form fields to appear\n';
  instructions += '- Text tags will be replaced with interactive form fields when processed by Adobe Sign\n';
  instructions += '- Ensure text tags are not split across lines or pages\n';
  instructions += '- Test with a small document first to verify placement and functionality\n';
  
  return instructions;
};

module.exports = {
  TEXT_TAGS,
  generateTextTags,
  createPdfWithTextTags,
  addTextTagsToPdf,
  validateTextTags,
  generateTextTagInstructions
};
