// Fallback handler for Adobe Sign templates
// This specialized utility can be used to directly process templates with Adobe Sign tags

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const PizZip = require('pizzip');
const libre = require('libreoffice-convert');
const util = require('util');

// Promisify libre convert
const libreConvert = util.promisify(libre.convert);

/**
 * Direct document processing for Adobe Sign templates
 * This is a simple string replacement approach that avoids template engines
 * @param {string} filePath - Path to the document 
 * @param {object} data - Template data
 * @returns {Promise<string>} - Path to processed document
 */
const processAdobeSignTemplate = async (filePath, data) => {
  try {
    logger.info('Using fallback handler for Adobe Sign template');
    
    // Check file extension
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.docx') {
      return await processDocxDirect(filePath, data);
    } else if (ext === '.doc') {
      // For .doc files, convert to .docx first
      const docxPath = await convertDocToDocx(filePath);
      return await processDocxDirect(docxPath, data);
    } else {
      throw new Error(`Unsupported file format for Adobe Sign template: ${ext}`);
    }
  } catch (error) {
    logger.error(`Error in fallback Adobe Sign template processing: ${error.message}`);
    throw error;
  }
};

/**
 * Process DOCX file with direct string replacement
 * This avoids any template engine that might struggle with double braces
 * @param {string} filePath - Path to DOCX file
 * @param {object} data - Template data
 * @returns {Promise<string>} - Path to processed file
 */
const processDocxDirect = async (filePath, data) => {
  try {
    // Read DOCX as binary
    const content = fs.readFileSync(filePath, 'binary');
    const zip = new PizZip(content);
    
    // Get document XML
    const documentXml = zip.files['word/document.xml'].asText();
    
    // Process the XML with simple replacements - avoiding regex for reliability
    let processedXml = documentXml;
    
    // Import the normalizeAdobeSignTags function from the normalizer
    const { normalizeAdobeSignTags } = require('./adobeSignTagNormalizer');
    
    // Ensure Adobe Sign tags are in double braces format for consistency
    processedXml = normalizeAdobeSignTags(processedXml);
    
    // Pre-process to find and temporarily protect Adobe Sign tags (double braces format)
    const adobeSignTagPattern = /\{\{[^{}]+\}\}/g;
    const adobeSignTags = [];
    let match;
    
    // Extract all Adobe Sign tags (double braces format)
    while ((match = adobeSignTagPattern.exec(processedXml)) !== null) {
      const tag = match[0];
      // Check if it's an Adobe Sign tag - using a more inclusive approach
      if (tag.toLowerCase().includes('signer') || 
          tag.toLowerCase().includes('sig_es') || 
          tag.toLowerCase().includes('*es_') ||
          tag.toLowerCase().includes('signature') ||
          tag.toLowerCase().includes('initial') ||
          tag.toLowerCase().includes('date_es')) {
        adobeSignTags.push({ 
          tag, 
          index: match.index, 
          placeholder: `__ADOBESIGN_TAG_${adobeSignTags.length}__`
        });
      }
    }
    
    // Replace Adobe Sign tags with placeholders
    adobeSignTags.forEach(item => {
      processedXml = processedXml.split(item.tag).join(item.placeholder);
    });
    
    // For each template variable, do a simple string replace (single braces only)
    Object.entries(data).forEach(([key, value]) => {
      const searchValue = `{${key}}`;
      const replaceValue = String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
      
      // Simple string replacement for regular template variables only
      processedXml = processedXml.split(searchValue).join(replaceValue);
    });
    
    // Restore Adobe Sign tags from placeholders (keeping double braces format)
    adobeSignTags.forEach(item => {
      processedXml = processedXml.split(item.placeholder).join(item.tag);
    });
    
    // Log any Adobe Sign tags found
    const tagCount = adobeSignTags.length;
    if (tagCount > 0) {
      logger.info(`Protected ${tagCount} Adobe Sign tags during processing`);
      adobeSignTags.forEach(item => {
        logger.info(`  - ${item.tag}`);
      });
    } else {
      logger.warn('No Adobe Sign tags were identified for protection in this document. If tags should be present, check format and encoding.');
    }
    
    // Update document.xml
    zip.file('word/document.xml', processedXml);
    
    // Create output file
    const outputPath = path.join(
      path.dirname(filePath),
      `${path.basename(filePath, '.docx')}_direct_processed_${Date.now()}.docx`
    );
    
    // Write processed file
    fs.writeFileSync(outputPath, zip.generate({ type: 'nodebuffer' }));
    
    logger.info(`DOCX processed directly for Adobe Sign template: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`Error in direct DOCX processing: ${error.message}`);
    throw error;
  }
};

/**
 * Convert DOC to DOCX
 * @param {string} docPath - Path to DOC file
 * @returns {Promise<string>} - Path to converted DOCX
 */
const convertDocToDocx = async (docPath) => {
  try {
    const docBuffer = fs.readFileSync(docPath);
    const docxBuffer = await libreConvert(docBuffer, '.docx', undefined);
    
    const outputPath = path.join(
      path.dirname(docPath),
      `${path.basename(docPath, '.doc')}_converted_${Date.now()}.docx`
    );
    
    fs.writeFileSync(outputPath, docxBuffer);
    logger.info(`DOC converted to DOCX: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`Error converting DOC to DOCX: ${error.message}`);
    throw error;
  }
};

/**
 * Convert DOCX to PDF
 * @param {string} docxPath - Path to DOCX file
 * @returns {Promise<string>} - Path to PDF file
 */
const convertDocxToPdf = async (docxPath) => {
  try {
    const docxBuffer = fs.readFileSync(docxPath);
    const pdfBuffer = await libreConvert(docxBuffer, '.pdf', undefined);
    
    const outputPath = path.join(
      path.dirname(docxPath),
      `${path.basename(docxPath, '.docx')}_converted_${Date.now()}.pdf`
    );
    
    fs.writeFileSync(outputPath, pdfBuffer);
    logger.info(`DOCX converted to PDF: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`Error converting DOCX to PDF: ${error.message}`);
    throw error;
  }
};

module.exports = {
  processAdobeSignTemplate,
  processDocxDirect,
  convertDocToDocx,
  convertDocxToPdf
};
