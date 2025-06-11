/**
 * Document Processing Utility
 * Handles DOCX/DOC files, template variable substitution, and signature field detection
 */

const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const libre = require('libreoffice-convert');
const util = require('util');
const logger = require('./logger');

// Promisify the libre convert function
const libreConvert = util.promisify(libre.convert);

/**
 * Process document template with JSON data
 * @param {string} filePath - Path to the document file
 * @param {Object} data - JSON data for variable substitution
 * @returns {Promise<string>} - Path to the processed document
 */
const processDocumentTemplate = async (filePath, data = {}) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.docx') {
      return await processDocxTemplate(filePath, data);
    } else if (ext === '.doc') {
      // For .doc files, we'll need to convert to docx first
      const docxPath = await convertDocToDocx(filePath);
      return await processDocxTemplate(docxPath, data);
    } else if (ext === '.pdf') {
      // PDF files don't support template processing, return as-is
      logger.info('PDF file provided, no template processing needed');
      return filePath;
    }
    
    throw new Error(`Unsupported file format: ${ext}`);
  } catch (error) {
    logger.error(`Error processing document template: ${error.message}`);
    throw error;
  }
};

/**
 * Process DOCX template with data substitution
 * @param {string} filePath - Path to DOCX file
 * @param {Object} data - Data for substitution
 * @returns {Promise<string>} - Path to processed file
 */
const processDocxTemplate = async (filePath, data) => {
  try {
    // Read the docx file as a binary
    const content = fs.readFileSync(filePath, 'binary');
    
    // Create a new zip instance
    const zip = new PizZip(content);
    
    // Create docxtemplater instance
    const doc = new docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });
    
    // Set the template variables
    doc.setData(data);
    
    try {
      // Render the document (replace all variables)
      doc.render();
    } catch (error) {
      logger.error('Template rendering error:', error);
      throw new Error(`Template processing failed: ${error.message}`);
    }
    
    // Get the processed document buffer
    const buffer = doc.getZip().generate({ type: 'nodebuffer' });
    
    // Create processed file path
    const originalName = path.basename(filePath, '.docx');
    const processedPath = path.join(
      path.dirname(filePath), 
      `${originalName}_processed_${Date.now()}.docx`
    );
    
    // Write the processed document
    fs.writeFileSync(processedPath, buffer);
    
    logger.info(`Document template processed successfully: ${processedPath}`);
    return processedPath;
  } catch (error) {
    logger.error(`Error processing DOCX template: ${error.message}`);
    throw error;
  }
};

/**
 * Convert DOC to DOCX using LibreOffice
 * @param {string} docPath - Path to DOC file
 * @returns {Promise<string>} - Path to converted DOCX file
 */
const convertDocToDocx = async (docPath) => {
  try {
    const docBuffer = fs.readFileSync(docPath);
    
    // Convert DOC to DOCX
    const docxBuffer = await libreConvert(docBuffer, '.docx', undefined);
    
    // Create output path
    const baseName = path.basename(docPath, '.doc');
    const docxPath = path.join(path.dirname(docPath), `${baseName}_converted_${Date.now()}.docx`);
    
    // Write the converted file
    fs.writeFileSync(docxPath, docxBuffer);
    
    logger.info(`DOC file converted to DOCX: ${docxPath}`);
    return docxPath;
  } catch (error) {
    logger.error(`Error converting DOC to DOCX: ${error.message}`);
    throw error;
  }
};

/**
 * Convert DOCX to PDF
 * @param {string} docxPath - Path to DOCX file
 * @returns {Promise<string>} - Path to converted PDF file
 */
const convertDocxToPdf = async (docxPath) => {
  try {
    const docxBuffer = fs.readFileSync(docxPath);
    
    // Convert DOCX to PDF
    const pdfBuffer = await libreConvert(docxBuffer, '.pdf', undefined);
    
    // Create output path
    const baseName = path.basename(docxPath, path.extname(docxPath));
    const pdfPath = path.join(path.dirname(docxPath), `${baseName}_converted_${Date.now()}.pdf`);
    
    // Write the PDF file
    fs.writeFileSync(pdfPath, pdfBuffer);
    
    logger.info(`DOCX file converted to PDF: ${pdfPath}`);
    return pdfPath;
  } catch (error) {
    logger.error(`Error converting DOCX to PDF: ${error.message}`);
    throw error;
  }
};

/**
 * Converts DOC file to PDF
 * @param {string} docPath - Path to the DOC file
 * @returns {Promise<string>} - Path to the converted PDF file
 */
const convertDocToPdf = async (docPath) => {
  try {
    const docBuffer = fs.readFileSync(docPath);
    
    // Convert DOC to PDF directly
    const pdfBuffer = await libreConvert(docBuffer, '.pdf', undefined);
    
    // Create output path
    const baseName = path.basename(docPath, path.extname(docPath));
    const pdfPath = path.join(path.dirname(docPath), `${baseName}_converted_${Date.now()}.pdf`);
    
    // Write the PDF file
    fs.writeFileSync(pdfPath, pdfBuffer);
    
    logger.info(`DOC file converted to PDF: ${pdfPath}`);
    return pdfPath;
  } catch (error) {
    logger.error(`Error converting DOC to PDF: ${error.message}`);
    throw error;
  }
};

/**
 * Main conversion function that handles both DOCX and DOC files
 * @param {string} filePath - Path to the document file
 * @returns {Promise<string>} - Path to the converted PDF file
 */
const convertToPdf = async (filePath) => {
  const fileExtension = path.extname(filePath).toLowerCase();
  
  if (fileExtension === '.docx') {
    return await convertDocxToPdf(filePath);
  } else if (fileExtension === '.doc') {
    return await convertDocToPdf(filePath);
  } else {
    throw new Error(`Unsupported file format for conversion: ${fileExtension}`);
  }
};

/**
 * Extract text content from document for analysis
 * @param {string} filePath - Path to document file
 * @returns {Promise<string>} - Extracted text content
 */
const extractTextContent = async (filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } else if (ext === '.doc') {
      // Try to extract from DOC directly first
      try {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value;
      } catch (docError) {
        logger.warn(`Direct DOC extraction failed, converting to DOCX first: ${docError.message}`);
        // Convert to docx first, then extract text
        const docxPath = await convertDocToDocx(filePath);
        const result = await mammoth.extractRawText({ path: docxPath });
        return result.value;
      }
    } else if (ext === '.pdf') {
      // For PDF, return placeholder - would need pdf-parse for full implementation
      return 'PDF content extraction not implemented in this function';
    }
    
    throw new Error(`Unsupported file format for text extraction: ${ext}`);
  } catch (error) {
    logger.error(`Error extracting text content: ${error.message}`);
    throw error;
  }
};

/**
 * Extract template variables from document content
 * @param {string} content - Document text content
 * @returns {Array<string>} - Array of variable names found in the document
 */
const extractTemplateVariables = (content) => {
  try {
    // Match variables in curly braces: {variable} or {{variable}}
    const variableRegex = /\{\{?([^}]+)\}?\}/g;
    const variables = [];
    let match;
    
    while ((match = variableRegex.exec(content)) !== null) {
      const variableName = match[1].trim();
      // Filter out common non-template patterns
      if (!variableName.includes('*') && !variableName.includes(':') && variableName.length > 0) {
        if (!variables.includes(variableName)) {
          variables.push(variableName);
        }
      }
    }
    
    logger.info(`Found ${variables.length} template variables: ${variables.join(', ')}`);
    return variables;
  } catch (error) {
    logger.error(`Error extracting template variables: ${error.message}`);
    return [];
  }
};

/**
 * Detects potential signature fields in document content
 * @param {string} textContent - Plain text content
 * @param {string} htmlContent - HTML content with formatting
 * @returns {Array} - Array of detected signature field names
 */
const detectSignatureFields = (textContent, htmlContent = '') => {
  const signatureFields = [];
  
  // Common signature-related patterns
  const signaturePatterns = [
    /signature/gi,
    /sign here/gi,
    /signed by/gi,
    /signatory/gi,
    /date signed/gi,
    /date of signature/gi,
    /contractor signature/gi,
    /client signature/gi,
    /authorized signature/gi,
    /digital signature/gi,
    /electronic signature/gi,
    /___+/g, // Underscore lines often indicate signature fields
    /\.{5,}/g, // Dot lines
    /\[signature\]/gi,
    /\[sign\]/gi,
    /\[date\]/gi
  ];

  // Date patterns
  const datePatterns = [
    /date:/gi,
    /dated/gi,
    /date of/gi,
    /on this.*day/gi,
    /__\/__\/__/g, // Date format placeholders
    /mm\/dd\/yyyy/gi,
    /dd\/mm\/yyyy/gi,
    /\[date\]/gi
  ];

  let signatureCount = 0;
  let dateCount = 0;

  // Check for signature patterns
  signaturePatterns.forEach(pattern => {
    const matches = textContent.match(pattern);
    if (matches) {
      signatureCount += matches.length;
    }
  });

  // Check for date patterns
  datePatterns.forEach(pattern => {
    const matches = textContent.match(pattern);
    if (matches) {
      dateCount += matches.length;
    }
  });

  // Generate signature field names based on detected patterns
  for (let i = 0; i < Math.max(signatureCount, 1); i++) {
    signatureFields.push(i === 0 ? 'Signature' : `Signature_${i + 1}`);
  }

  for (let i = 0; i < Math.max(dateCount, 1); i++) {
    signatureFields.push(i === 0 ? 'Date' : `Date_${i + 1}`);
  }

  // Check HTML content for additional clues if available
  if (htmlContent) {
    // Look for underlined text, which might indicate signature lines
    const underlineMatches = htmlContent.match(/<u[^>]*>([^<]+)<\/u>/gi);
    if (underlineMatches) {
      underlineMatches.forEach((match, index) => {
        const text = match.replace(/<[^>]*>/g, '').trim();
        if (text.length > 10 && !signatureFields.includes(`Underlined_${index + 1}`)) {
          signatureFields.push(`Underlined_${index + 1}`);
        }
      });
    }
  }

  return signatureFields;
};

/**
 * Analyze document and determine signature fields from content analysis
 * @param {string} filePath - Path to the document file
 * @returns {Promise<Object>} - Analysis result with signature fields and template variables
 */
const analyzeDocumentForSignatureFields = async (filePath) => {
  try {
    const fileExtension = path.extname(filePath).toLowerCase();
    let textContent = '';
    let htmlContent = '';
    let templateVariables = [];
    let signatureFields = [];

    if (fileExtension === '.docx') {
      // Extract text from DOCX
      const result = await mammoth.extractRawText({ path: filePath });
      textContent = result.value;
      
      // Also extract with styles to detect formatting
      try {
        const styledResult = await mammoth.convertToHtml({ path: filePath });
        htmlContent = styledResult.value;
      } catch (htmlError) {
        logger.warn(`Could not extract HTML content: ${htmlError.message}`);
      }
      
      // Find template variables in curly braces
      templateVariables = extractTemplateVariables(textContent);
      
      // Detect potential signature fields
      signatureFields = detectSignatureFields(textContent, htmlContent);
      
      logger.info(`DOCX analysis complete: ${templateVariables.length} variables, ${signatureFields.length} signature fields`);
      
    } else if (fileExtension === '.doc') {
      try {
        // For .doc files, we'll use mammoth as well (it has limited support)
        const result = await mammoth.extractRawText({ path: filePath });
        textContent = result.value;
        
        templateVariables = extractTemplateVariables(textContent);
        signatureFields = detectSignatureFields(textContent, '');
        
        logger.info(`DOC analysis complete: ${templateVariables.length} variables, ${signatureFields.length} signature fields`);
      } catch (docError) {
        logger.warn(`Could not analyze .doc file with mammoth: ${docError.message}`);
        // Fallback: assume common signature fields
        signatureFields = ['Signature', 'Date'];
        templateVariables = [];
      }
      
    } else if (fileExtension === '.pdf') {
      // For PDF files, we can do basic text extraction
      try {
        // This is a simplified approach - in production you might want to use pdf-parse
        templateVariables = [];
        signatureFields = ['Signature', 'Date']; // Default assumption for PDFs
        logger.info('PDF analysis complete with default signature fields');
      } catch (pdfError) {
        logger.warn(`Could not analyze PDF: ${pdfError.message}`);
        signatureFields = ['Signature', 'Date'];
      }
    }

    // Categorize template variables by type
    const signatureFieldsFromVars = [];
    const dateFieldsFromVars = [];
    const textFieldsFromVars = [];
    
    templateVariables.forEach(variable => {
      const lowerVar = variable.toLowerCase();
      
      if (lowerVar.includes('sign') || lowerVar.includes('signature')) {
        signatureFieldsFromVars.push(variable);
      } else if (lowerVar.includes('date')) {
        dateFieldsFromVars.push(variable);
      } else {
        textFieldsFromVars.push(variable);
      }
    });

    return {
      templateVariables: [...new Set(templateVariables)], // Remove duplicates
      signatureFields: [...new Set([...signatureFields, ...signatureFieldsFromVars])], // Combine detected and variable-based
      dateFields: dateFieldsFromVars,
      textFields: textFieldsFromVars,
      textContent: textContent.substring(0, 500), // First 500 chars for preview
      hasTemplateVariables: templateVariables.length > 0,
      hasSignatureFields: signatureFields.length > 0
    };

  } catch (error) {
    logger.error(`Error analyzing document: ${error.message}`);
    throw error;
  }
};

/**
 * Validates template data against detected variables
 * @param {Object} templateData - The template data provided
 * @param {Array} templateVariables - Array of detected template variables
 * @returns {Object} - Validation result with missing and extra variables
 */
const validateTemplateData = (templateData, templateVariables) => {
  const providedVariables = Object.keys(templateData);
  const missingVariables = templateVariables.filter(variable => !providedVariables.includes(variable));
  const extraVariables = providedVariables.filter(variable => !templateVariables.includes(variable));
  
  return {
    isValid: missingVariables.length === 0,
    missingVariables,
    extraVariables,
    matchedVariables: templateVariables.filter(variable => providedVariables.includes(variable))
  };
};

module.exports = {
  processDocumentTemplate,
  processDocxTemplate,
  convertDocToDocx,
  convertDocxToPdf,
  convertDocToPdf,
  convertToPdf,
  extractTextContent,
  extractTemplateVariables,
  analyzeDocumentForSignatureFields,
  detectSignatureFields,
  validateTemplateData
};
