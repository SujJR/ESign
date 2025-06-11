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
    
    // Create docxtemplater instance with error handling
    const doc = new docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: {
        start: '{',
        end: '}'
      }
    });
    
    // Set the template variables
    doc.setData(data);
    
    try {
      // Render the document (replace all variables)
      doc.render();
    } catch (error) {
      logger.error('Template rendering error:', error);
      
      // Provide detailed error information for template issues
      if (error.properties) {
        logger.error('Template error details:', JSON.stringify(error.properties, null, 2));
        
        // If it's a duplicate tag error, provide helpful message
        if (error.properties.id === 'duplicate_open_tag' || error.properties.id === 'duplicate_close_tag') {
          throw new Error(`Template format error: The template contains malformed variables. Please ensure all template variables are properly formatted as {variableName} without spaces or line breaks within the curly braces. Problematic tag: ${error.properties.xtag}`);
        }
      }
      
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
  
  // Ensure textContent is a string
  const contentText = typeof textContent === 'string' ? textContent : '';
  const htmlText = typeof htmlContent === 'string' ? htmlContent : '';
  
  // Common signature-related patterns (excluding date-related patterns)
  const signaturePatterns = [
    /signature/gi,
    /sign here/gi,
    /signed by/gi,
    /signatory/gi,
    /contractor signature/gi,
    /client signature/gi,
    /authorized signature/gi,
    /digital signature/gi,
    /electronic signature/gi,
    /___+/g, // Underscore lines often indicate signature fields
    /\.{5,}/g, // Dot lines
    /\[signature\]/gi,
    /\[sign\]/gi
  ];

  // Date patterns (moved date-related patterns here from signature patterns)
  const datePatterns = [
    /date:/gi,
    /dated/gi,
    /date of/gi,
    /date signed/gi, // Moved from signature patterns
    /date of signature/gi, // Moved from signature patterns
    /on this.*day/gi,
    /__\/__\/__/g, // Date format placeholders
    /mm\/dd\/yyyy/gi,
    /dd\/mm\/yyyy/gi,
    /\[date\]/gi // Moved from signature patterns
  ];

  let signatureCount = 0;
  let dateCount = 0;

  // Check for signature patterns
  signaturePatterns.forEach(pattern => {
    const matches = contentText.match(pattern);
    if (matches) {
      signatureCount += matches.length;
    }
  });

  // Check for date patterns
  datePatterns.forEach(pattern => {
    const matches = contentText.match(pattern);
    if (matches) {
      dateCount += matches.length;
    }
  });

  // Generate signature field objects based on detected patterns
  for (let i = 0; i < Math.max(signatureCount, 1); i++) {
    signatureFields.push({
      name: i === 0 ? 'Signature' : `Signature_${i + 1}`,
      type: 'SIGNATURE',
      page: 1,
      x: 100 + (i * 50), // Offset multiple signatures
      y: 600 - (i * 50),
      width: 200,
      height: 40
    });
  }

  for (let i = 0; i < Math.max(dateCount, 1); i++) {
    signatureFields.push({
      name: i === 0 ? 'Date' : `Date_${i + 1}`,
      type: 'DATE',
      page: 1,
      x: 350 + (i * 50), // Position dates to the right of signatures
      y: 600 - (i * 50),
      width: 100,
      height: 20
    });
  }

  // Check HTML content for additional clues if available
  if (htmlText) {
    // Look for underlined text, which might indicate signature lines
    const underlineMatches = htmlText.match(/<u[^>]*>([^<]+)<\/u>/gi);
    if (underlineMatches) {
      underlineMatches.forEach((match, index) => {
        const text = match.replace(/<[^>]*>/g, '').trim();
        if (text.length > 10) {
          const fieldName = `Underlined_${index + 1}`;
          if (!signatureFields.find(f => f.name === fieldName)) {
            signatureFields.push({
              name: fieldName,
              type: 'SIGNATURE',
              page: 1,
              x: 100 + (index * 50),
              y: 500 - (index * 30),
              width: 200,
              height: 40
            });
          }
        }
      });
    }
  }

  return signatureFields;
};

/**
 * Enhanced signature field detection that looks for form fields and signature blanks
 * @param {string} textContent - Plain text content
 * @param {string} htmlContent - HTML content with formatting
 * @returns {Array} - Array of detected signature field objects with positions
 */
const detectExistingSignatureFields = (textContent, htmlContent = '') => {
  const signatureFields = [];
  
  // Ensure textContent is a string
  const contentText = typeof textContent === 'string' ? textContent : '';
  const htmlText = typeof htmlContent === 'string' ? htmlContent : '';
  
  // Enhanced patterns for existing signature fields
  const signatureFieldPatterns = [
    // Common signature field indicators (NOT date-related)
    /signature:\s*_+/gi,
    /sign\s+here:\s*_+/gi,
    /signed\s+by:\s*_+/gi,
    /signatory:\s*_+/gi,
    /_+\s*\(signature\)/gi,
    /_+\s*signature/gi,
    /\[SIGNATURE\]/gi,
    /\[SIGN\s+HERE\]/gi,
    // Formal signature blocks (excluding date patterns)
    /____+\s*\n.*signature/gi,
    /____+\s*\n.*signed/gi,
    // Digital signature placeholders
    /\[DIGITAL\s+SIGNATURE\]/gi,
    /\[E-SIGNATURE\]/gi,
    // Common legal document patterns
    /witness:\s*_+/gi,
    /notary:\s*_+/gi,
    /authorized\s+signature:\s*_+/gi
  ];

  // Date field patterns - more specific and separate from signature patterns
  const dateFieldPatterns = [
    /date:\s*_+/gi,
    /date\s+signed:\s*_+/gi,
    /_+\s*\(date\)/gi,
    /\[DATE\]/gi,
    /date:\s*__\/__\/__/gi,
    /date:\s*\d*\/\d*\/\d*/gi,
    /dated\s+this\s+___+\s+day/gi,
    /on\s+this\s+___+\s+day\s+of/gi,
    /\[DATE:\s*___+\]/gi
  ];

  let fieldCounter = 1;

  // Check for signature field patterns
  signatureFieldPatterns.forEach(pattern => {
    const matches = contentText.matchAll(pattern);
    for (const match of matches) {
      const fieldName = `ExistingSignature_${fieldCounter}`;
      
      // Better position estimation based on text analysis
      const textPosition = match.index || 0;
      const textLength = contentText.length;
      const matchText = match[0];
      
      // Count lines before this match to estimate Y position
      const textBeforeMatch = contentText.substring(0, textPosition);
      const linesBefore = (textBeforeMatch.match(/\n/g) || []).length;
      const totalLines = (contentText.match(/\n/g) || []).length;
      
      // Estimate page (assuming ~50 lines per page for typical documents)
      const estimatedPage = Math.max(1, Math.ceil(linesBefore / 50));
      
      // Y position: Start from top and move down based on line position
      // Standard page height ~800 points, with margins
      const pageHeight = 800;
      const topMargin = 50;
      const bottomMargin = 50;
      const usableHeight = pageHeight - topMargin - bottomMargin;
      const lineHeight = 15; // Typical line height
      
      const yPositionOnPage = topMargin + (linesBefore % 50) * lineHeight;
      const estimatedY = Math.max(bottomMargin, Math.min(pageHeight - 60, yPositionOnPage));
      
      // X position: Try to detect if it's indented or centered
      const lineStart = textBeforeMatch.lastIndexOf('\n') + 1;
      const lineText = contentText.substring(lineStart, textPosition + matchText.length);
      const indentLevel = lineText.match(/^\s*/)[0].length;
      
      // Estimate X position based on indentation
      const leftMargin = 50;
      const estimatedX = leftMargin + (indentLevel * 8); // 8 points per space/tab
      
      signatureFields.push({
        name: fieldName,
        type: 'SIGNATURE',
        page: estimatedPage,
        x: Math.max(50, Math.min(500, estimatedX)),
        y: estimatedY,
        width: 200,
        height: 50,
        detected: true,
        pattern: pattern.toString(),
        matchText: matchText,
        confidence: 0.8, // High confidence for explicit patterns
        lineNumber: linesBefore + 1
      });
      
      fieldCounter++;
    }
  });

  // Check for date field patterns
  dateFieldPatterns.forEach(pattern => {
    const matches = contentText.matchAll(pattern);
    for (const match of matches) {
      const fieldName = `ExistingDate_${fieldCounter}`;
      
      const textPosition = match.index || 0;
      const matchText = match[0];
      
      // Similar position estimation for date fields
      const textBeforeMatch = contentText.substring(0, textPosition);
      const linesBefore = (textBeforeMatch.match(/\n/g) || []).length;
      const estimatedPage = Math.max(1, Math.ceil(linesBefore / 50));
      
      const pageHeight = 800;
      const topMargin = 50;
      const lineHeight = 15;
      const yPositionOnPage = topMargin + (linesBefore % 50) * lineHeight;
      const estimatedY = Math.max(50, Math.min(pageHeight - 60, yPositionOnPage));
      
      // Date fields are often to the right of signature fields
      const lineStart = textBeforeMatch.lastIndexOf('\n') + 1;
      const lineText = contentText.substring(lineStart, textPosition + matchText.length);
      const indentLevel = lineText.match(/^\s*/)[0].length;
      
      // Position date fields more to the right
      const estimatedX = Math.max(300, 50 + (indentLevel * 8) + 250);
      
      signatureFields.push({
        name: fieldName,
        type: 'DATE',
        page: estimatedPage,
        x: Math.max(300, Math.min(600, estimatedX)),
        y: estimatedY,
        width: 120,
        height: 30,
        detected: true,
        pattern: pattern.toString(),
        matchText: matchText,
        confidence: 0.8,
        lineNumber: linesBefore + 1
      });
      
      fieldCounter++;
    }
  });

  // Check HTML content for form elements or special formatting
  if (htmlText) {
    // Look for underlined text that might be signature lines
    const underlineMatches = htmlText.matchAll(/<u[^>]*>([^<]+)<\/u>/gi);
    for (const match of underlineMatches) {
      const text = match[1].trim();
      if (text.length > 5 && (text.includes('_') || text.toLowerCase().includes('sign'))) {
        signatureFields.push({
          name: `UnderlinedField_${fieldCounter}`,
          type: 'SIGNATURE',
          page: 1,
          x: 100,
          y: 600 - (fieldCounter * 40),
          width: 200,
          height: 40,
          detected: true,
          pattern: 'underlined',
          matchText: text
        });
        fieldCounter++;
      }
    }

    // Look for input fields in HTML
    const inputMatches = htmlText.matchAll(/<input[^>]*type=['"]?(text|signature|date)['"]?[^>]*>/gi);
    for (const match of inputMatches) {
      const inputType = match[1].toLowerCase();
      const fieldType = inputType === 'signature' ? 'SIGNATURE' : 
                       inputType === 'date' ? 'DATE' : 'TEXT';
      
      signatureFields.push({
        name: `HTMLField_${fieldCounter}`,
        type: fieldType,
        page: 1,
        x: 100,
        y: 600 - (fieldCounter * 40),
        width: fieldType === 'SIGNATURE' ? 200 : 120,
        height: fieldType === 'SIGNATURE' ? 50 : 30,
        detected: true,
        pattern: 'html-input',
        matchText: match[0]
      });
      fieldCounter++;
    }
  }

  logger.info(`Enhanced detection found ${signatureFields.length} existing signature fields`);
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
      
      // Detect potential signature fields using enhanced detection
      signatureFields = detectExistingSignatureFields(textContent, htmlContent);
      
      // Fallback to basic detection if no existing fields found
      if (signatureFields.length === 0) {
        signatureFields = detectSignatureFields(textContent, htmlContent);
      }
      
      logger.info(`DOCX analysis complete: ${templateVariables.length} variables, ${signatureFields.length} signature fields`);
      
    } else if (fileExtension === '.doc') {
      try {
        // For .doc files, we'll use mammoth as well (it has limited support)
        const result = await mammoth.extractRawText({ path: filePath });
        textContent = result.value;
        
        templateVariables = extractTemplateVariables(textContent);
        signatureFields = detectExistingSignatureFields(textContent, '');
        
        // Fallback to basic detection if no existing fields found
        if (signatureFields.length === 0) {
          signatureFields = detectSignatureFields(textContent, '');
        }
        
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
      signatureFields: signatureFields, // Only use detected signature fields, not template variables
      signatureRelatedVariables: signatureFieldsFromVars, // Template variables related to signatures (for reference)
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
  detectExistingSignatureFields,
  validateTemplateData
};
