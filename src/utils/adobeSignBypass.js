/**
 * Direct Adobe Sign Tag Bypass
 * 
 * This module provides a very direct approach to handling documents with Adobe Sign tags
 * by completely bypassing the template engine and preserving all Adobe Sign tags.
 */

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const logger = require('./logger');
const libre = require('libreoffice-convert');
const util = require('util');

// Promisify the libre convert function
const libreConvert = util.promisify(libre.convert);

/**
 * Direct bypass processor for documents with Adobe Sign tags
 * This function skips template processing entirely and just handles the basic variable substitution
 * @param {string} filePath - Path to the document file
 * @param {Object} data - Template data
 * @returns {Promise<string>} - Path to processed document
 */
const bypassTemplateProcessing = async (filePath, data = {}) => {
  try {
    logger.info('Using direct bypass processing for Adobe Sign tags');
    
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.docx') {
      throw new Error(`Unsupported file format for direct bypass: ${ext}`);
    }
    
    // Read the DOCX file
    const content = fs.readFileSync(filePath, 'binary');
    const zip = new PizZip(content);
    
    // Get document XML
    const documentXml = zip.files['word/document.xml'].asText();
    
    // Log Adobe Sign tags for diagnostics
    const adobeSignTags = extractAdobeSignTags(documentXml);
    if (adobeSignTags.length > 0) {
      logger.info(`Found ${adobeSignTags.length} Adobe Sign tags in document before processing`);
      adobeSignTags.slice(0, 5).forEach(tag => {
        logger.info(`  - ${tag}`);
      });
      if (adobeSignTags.length > 5) {
        logger.info(`  ... and ${adobeSignTags.length - 5} more`);
      }
    }
    
    // Apply only simple variable substitution with careful handling
    let processedXml = documentXml;
    
    // Process each template variable
    Object.entries(data).forEach(([key, value]) => {
      // Look for the template pattern with exact matching to avoid affecting Adobe Sign tags
      // This handles only single curly brace patterns like {key}
      // Avoid replacing any tags that look like Adobe Sign tags
      const searchPattern = new RegExp(`\\{${key}\\}`, 'g');
      
      // Skip if this looks like an Adobe Sign tag key
      if (key.includes('signer') || 
          key.includes('sig_es') || 
          key.includes('_es_') ||
          key.includes('signature') ||
          key.includes('date_es')) {
        logger.info(`Skipping template variable that looks like Adobe Sign tag: ${key}`);
        return;
      }
      
      const replaceValue = value !== null && value !== undefined ? String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;') : '';
      
      processedXml = processedXml.replace(searchPattern, replaceValue);
    });
    
    // Verify Adobe Sign tags are still present
    const finalTags = extractAdobeSignTags(processedXml);
    if (finalTags.length !== adobeSignTags.length) {
      logger.warn(`WARNING: Adobe Sign tag count changed during processing. Before: ${adobeSignTags.length}, After: ${finalTags.length}`);
    } else {
      logger.info(`All ${finalTags.length} Adobe Sign tags preserved during processing`);
    }
    
    // Update document.xml
    zip.file('word/document.xml', processedXml);
    
    // Write the processed file
    const outputPath = path.join(
      path.dirname(filePath),
      `${path.basename(filePath, '.docx')}_bypass_processed_${Date.now()}.docx`
    );
    
    fs.writeFileSync(outputPath, zip.generate({ type: 'nodebuffer' }));
    logger.info(`Document processed with direct bypass approach: ${outputPath}`);
    
    return outputPath;
  } catch (error) {
    logger.error(`Error in bypass template processing: ${error.message}`);
    throw error;
  }
};

/**
 * Extract all Adobe Sign tags from document XML
 * @param {string} documentXml - The document XML content
 * @returns {Array<string>} - Array of Adobe Sign tags
 */
const extractAdobeSignTags = (documentXml) => {
  const tagPattern = /\{[^{}]+\}/g;
  const tags = [];
  let match;
  
  while ((match = tagPattern.exec(documentXml)) !== null) {
    tags.push(match[0]);
  }
  
  return tags;
};

/**
 * Convert DOCX to PDF
 * @param {string} docxPath - Path to DOCX file
 * @returns {Promise<string>} - Path to PDF file
 */
const convertToPdf = async (docxPath) => {
  try {
    const docxBuffer = fs.readFileSync(docxPath);
    const pdfBuffer = await libreConvert(docxBuffer, '.pdf', undefined);
    
    const outputPath = path.join(
      path.dirname(docxPath),
      `${path.basename(docxPath, '.docx')}_converted_${Date.now()}.pdf`
    );
    
    fs.writeFileSync(outputPath, pdfBuffer);
    logger.info(`Document converted to PDF: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`Error converting to PDF: ${error.message}`);
    throw error;
  }
};

module.exports = {
  bypassTemplateProcessing,
  extractAdobeSignTags,
  convertToPdf
};
