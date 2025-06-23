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
      // Custom parser to preserve Adobe Sign tags and process regular template variables
      parser: function customParser(tag) {
        // Check if this is an Adobe Sign tag
        const isAdobeSignTag = (tag) => {
          // Remove any surrounding braces for checking
          const cleanTag = tag.replace(/^\{+|\}+$/g, '');
          return cleanTag.includes('sig_es_:signer') || 
                 cleanTag.includes('*ES_:signer') ||
                 cleanTag.includes('Sig_es_:signer') ||
                 cleanTag.includes('esig_') ||
                 cleanTag.includes('_es_:signer') ||
                 cleanTag.includes('signature_es') ||
                 cleanTag.includes('initial_es') ||
                 cleanTag.includes('date_es_:signer') ||
                 cleanTag.includes('signer') && cleanTag.includes(':signature') ||
                 cleanTag.includes('signer') && cleanTag.includes(':initial') ||
                 cleanTag.includes('signer') && cleanTag.includes(':date');
        };
        
        // Check if any Adobe Sign pattern is found in the tag
        if (isAdobeSignTag(tag)) {
          logger.info(`Preserving Adobe Sign tag: {{${tag}}}`);
          // For Adobe Sign tags, return exactly what we want in the document
          const adobeSignTag = `{{${tag}}}`;
          return {
            get: function() { return ''; },
            render: function() { 
              // Return the complete Adobe Sign tag without any additional processing
              return adobeSignTag;
            }
          };
        }
        
        // Log regular template variables for debugging
        logger.debug(`Processing template variable: {${tag}}`);
        
        // Default parser for regular template variables
        return {
          get: function() { return tag; }
        };
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
        
        // If it might be an Adobe Sign tag related error
        if (error.properties.id === 'unopened_tag' || 
            error.properties.id === 'unclosed_tag' || 
            (error.properties.xtag && (
              error.properties.xtag.includes('sig_es_') || 
              error.properties.xtag.includes('*ES_') ||
              error.properties.xtag.includes('signer')
            ))) {
          logger.warn('This appears to be an Adobe Sign tag related error. Trying fallback processing...');
          
          // Import and use the bypass processor
          const adobeSignBypass = require('./adobeSignBypass');
          return await adobeSignBypass.bypassTemplateProcessing(filePath, data);
        }
        
        // If it's a duplicate tag error, provide helpful message
        if (error.properties.id === 'duplicate_open_tag' || error.properties.id === 'duplicate_close_tag') {
          throw new Error(`Template format error: The template contains malformed variables. Please ensure all template variables are properly formatted without spaces or line breaks within the curly braces. Adobe Sign tags should use single curly braces like {sig_es_:signer1:signature}. Problematic tag: ${error.properties.xtag}`);
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
 * Convert Office document (DOCX/DOC) to PDF
 * @param {string} filePath - Path to the document file
 * @param {string} [outputPath] - Optional output path for the PDF file
 * @returns {Promise<string>} - Path to the converted PDF file
 */
const convertOfficeDocToPdf = async (filePath, outputPath = null) => {
  try {
    const fileExtension = path.extname(filePath).toLowerCase();
    let docBuffer = fs.readFileSync(filePath);
    
    // Create output path if not provided
    if (!outputPath) {
      const baseName = path.basename(filePath, fileExtension);
      outputPath = path.join(path.dirname(filePath), `${baseName}_converted_${Date.now()}.pdf`);
    }
    
    // Log details for debugging
    logger.info(`Converting Office document to PDF: ${filePath} -> ${outputPath}`);
    logger.info(`File extension: ${fileExtension}, Size: ${docBuffer.length} bytes`);
    
    // Convert to PDF using LibreOffice
    try {
      const pdfBuffer = await libreConvert(docBuffer, '.pdf', undefined);
      
      // Write the PDF file
      fs.writeFileSync(outputPath, pdfBuffer);
      
      logger.info(`Office document converted to PDF: ${outputPath} (${pdfBuffer.length} bytes)`);
      return outputPath;
    } catch (convertError) {
      logger.error(`LibreOffice conversion error: ${convertError.message}`);
      
      // If direct conversion fails and it's a DOC file, try DOCX conversion first
      if (fileExtension === '.doc') {
        logger.info('Attempting DOC -> DOCX -> PDF conversion path');
        const docxPath = await convertDocToDocx(filePath);
        const docxBuffer = fs.readFileSync(docxPath);
        
        const pdfBuffer = await libreConvert(docxBuffer, '.pdf', undefined);
        fs.writeFileSync(outputPath, pdfBuffer);
        
        // Clean up temporary DOCX file
        try { fs.unlinkSync(docxPath); } catch (e) { /* ignore */ }
        
        logger.info(`DOC file converted to PDF via DOCX: ${outputPath}`);
        return outputPath;
      } else {
        throw convertError;
      }
    }
  } catch (error) {
    logger.error(`Error converting Office document to PDF: ${error.message}`);
    throw new Error(`Failed to convert document to PDF: ${error.message}`);
  }
};

/**
 * Main conversion function that handles both DOCX and DOC files
 * @param {string} filePath - Path to the document file
 * @returns {Promise<string>} - Path to the converted PDF file
 */
/**
 * Convert a document to PDF
 * @param {string} filePath - Path to document file
 * @param {string} [outputPath] - Optional output path for the PDF
 * @returns {Promise<string>} - Path to converted PDF file
 */
const convertToPdf = async (filePath, outputPath = null) => {
  try {
    const fileExtension = path.extname(filePath).toLowerCase();
    
    logger.info(`Converting document to PDF: ${filePath} (${fileExtension})`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    // Log file size for debugging
    const stats = fs.statSync(filePath);
    logger.info(`File size: ${stats.size} bytes`);
    
    if (['.docx', '.doc'].includes(fileExtension)) {
      // Use the unified office document conversion function
      return await convertOfficeDocToPdf(filePath, outputPath);
    } else if (fileExtension === '.pdf') {
      // No conversion needed, return original file path or copy to output path if specified
      if (outputPath && outputPath !== filePath) {
        fs.copyFileSync(filePath, outputPath);
        logger.info(`PDF already, copied to: ${outputPath}`);
        return outputPath;
      }
      logger.info(`File is already PDF, no conversion needed: ${filePath}`);
      return filePath;
    } else {
      // For unrecognized extensions, try the office conversion anyway as a fallback
      logger.warn(`Unrecognized file extension: ${fileExtension}, attempting conversion with LibreOffice`);
      try {
        return await convertOfficeDocToPdf(filePath, outputPath);
      } catch (conversionError) {
        logger.error(`Conversion failed for unknown file type: ${conversionError.message}`);
        throw new Error(`Unsupported file format for conversion: ${fileExtension}`);
      }
    }
  } catch (error) {
    logger.error(`Error in convertToPdf: ${error.message}`);
    throw error;
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
    const adobeSignTags = [];
    let match;
    
    while ((match = variableRegex.exec(content)) !== null) {
      const variableName = match[1].trim();
      // Check for Adobe Sign signature tags (expanded patterns)
      if ((variableName.includes('sig_es_:signer') || 
           variableName.includes('*ES_:signer') || 
           variableName.includes('Sig_es_:signer') || 
           (variableName.includes('esig_') && variableName.includes(':signer')) || 
           variableName.includes('_es_:signer')) && 
          (variableName.includes(':signature') || variableName.match(/signer\d+$/i))) {
        // This is an Adobe Sign signature tag, preserve it as is
        adobeSignTags.push(match[0]); // Keep the full tag with braces
      } 
      // Filter out common non-template patterns for regular variables
      else if (!variableName.includes('*') && !variableName.includes(':') && variableName.length > 0) {
        if (!variables.includes(variableName)) {
          variables.push(variableName);
        }
      }
    }
    
    logger.info(`Found ${variables.length} template variables: ${variables.join(', ')}`);
    if (adobeSignTags.length > 0) {
      logger.info(`Found ${adobeSignTags.length} Adobe Sign signature tags: ${adobeSignTags.join(', ')}`);
    }
    
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
  
  // First check for Adobe Sign text tags in both double and single braces
  const adobeSignPatterns = [
    // Double braces format (preferred)
    /\{\{sig_es_:signer\d+:signature\}\}/g,
    /\{\{\*ES_:signer\d+:signature\}\}/g,
    /\{\{Sig_es_:signer\d+:signature\}\}/g,
    /\{\{signer\d+:signature\}\}/g,
    /\{\{date_es_:signer\d+:date\}\}/g,
    /\{\{signer\d+:date\}\}/g,
    // Single braces format (legacy)
    /\{sig_es_:signer\d+:signature\}/g,
    /\{\*ES_:signer\d+:signature\}/g,
    /\{Sig_es_:signer\d+:signature\}/g,
    /\{signer\d+:signature\}/g,
    /\{date_es_:signer\d+:date\}/g,
    /\{signer\d+:date\}/g,
    // Other patterns
    /\{esig_.*?:signer\d+\}/g,
    /\{_es_:signer\d+.*?\}/g,
    /\{signature_es.*?\}/g,
    /\{initial_es.*?\}/g,
    /\{signer\d+:initial\}/g
  ];
  
  // Look for Adobe Sign tags and extract them
  let adobeSignFields = [];
  adobeSignPatterns.forEach(pattern => {
    const matches = contentText.match(pattern);
    if (matches && matches.length > 0) {
      matches.forEach(match => {
        // Extract signer number and field type
        let signerNum = 1;
        let fieldType = 'SIGNATURE';
        
        if (match.includes('signer')) {
          const signerMatch = match.match(/signer(\d+)/);
          if (signerMatch) signerNum = parseInt(signerMatch[1], 10);
        }
        
        if (match.includes('date')) fieldType = 'DATE';
        if (match.includes('initial')) fieldType = 'INITIAL';
        
        adobeSignFields.push({
          name: `AdobeSign_${fieldType}_${signerNum}`,
          type: fieldType,
          detected: true,
          adobeSignTag: match,
          signer: signerNum,
          matchText: match,  // Add matchText for compatibility with detection logic
          isAdobeSignTag: true  // Flag to explicitly identify this as an Adobe Sign tag
        });
      });
    }
  });
  
  // If Adobe Sign tags were found, return them as signature fields
  if (adobeSignFields.length > 0) {
    logger.info(`Detected ${adobeSignFields.length} Adobe Sign tags in document`);
    adobeSignFields.forEach(field => {
      logger.info(`  - ${field.adobeSignTag} (Signer ${field.signer}, Type: ${field.type})`);
    });
    return adobeSignFields;
  }

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
    // Adobe Sign text tags (double braces format - preferred)
    /\{\{sig_es_:signer\d+:signature\}\}/gi,
    /\{\{\*ES_:signer\d+:signature\}\}/gi,
    /\{\{Sig_es_:signer\d+\}\}/gi, 
    /\{\{Sig\d*_es_:signer\d+:signature\}\}/gi,
    /\{\{esig_\w+:signer\d+\}\}/gi,
    /\{\{signer\d+:signature\}\}/gi,
    // Adobe Sign text tags (single braces format - legacy)
    /\{sig_es_:signer\d+:signature\}/gi,
    /\{\*ES_:signer\d+:signature\}/gi,
    /\{Sig_es_:signer\d+\}/gi, 
    /\{Sig\d*_es_:signer\d+:signature\}/gi,
    /\{esig_\w+:signer\d+\}/gi,
    /\{signer\d+:signature\}/gi,
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
    // Adobe Sign date tags (double braces format - preferred)
    /\{\{date_es_:signer\d+:date\}\}/gi,
    /\{\{signer\d+:date\}\}/gi,
    // Adobe Sign date tags (single braces format - legacy)
    /\{date_es_:signer\d+:date\}/gi,
    /\{signer\d+:date\}/gi,
    // Regular date patterns
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
      let fieldName = `ExistingSignature_${fieldCounter}`;
      let recipientIndex = 0;
      
      // Check if this is an Adobe Sign tag with signature format
      if (match[0].includes('sig_es_:signer') || 
          match[0].includes('*ES_:signer') || 
          match[0].includes('Sig_es_:signer') || 
          match[0].includes('esig_') || 
          match[0].includes('_es_:signer')) {
        
        // Extract signer number from Adobe tag
        const signerMatch = match[0].match(/signer(\d+)/i);
        if (signerMatch && signerMatch[1]) {
          recipientIndex = parseInt(signerMatch[1], 10) - 1; // Zero-based index
          fieldName = `AdobeSignTag_Signer${recipientIndex + 1}`;
        }
      }
      
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

  // Check HTML content for additional clues if available
  if (htmlText) {
    // Look for underlined text, which might indicate signature lines
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
      
      // First, check specifically for Adobe Sign text tags
      const adobeSignTagRegex = /\{sig_es_:signer\d+:signature\}|\{\*ES_:signer\d+:signature\}|\{signer\d+:signature\}/g;
      const hasAdobeSignTags = adobeSignTagRegex.test(textContent);
      
      if (hasAdobeSignTags) {
        // If Adobe Sign tags are found, prioritize them over other detection methods
        logger.info('Adobe Sign text tags found in document - using text tag approach');
        // Reset regex state
        adobeSignTagRegex.lastIndex = 0;
        
        // Extract all Adobe Sign tags
        signatureFields = detectSignatureFields(textContent, htmlContent);
        
        // Log each detected tag
        const tags = Array.from(textContent.matchAll(/\{sig_es_:signer\d+:signature\}|\{\*ES_:signer\d+:signature\}|\{signer\d+:signature\}/g));
        if (tags.length > 0) {
          logger.info(`Found ${tags.length} Adobe Sign text tags in document`);
          tags.forEach(tag => {
            logger.info(`  - ${tag[0]}`);
          });
        }
      } else {
        // If no Adobe Sign tags, use standard detection methods
        // Detect potential signature fields using enhanced detection
        signatureFields = detectExistingSignatureFields(textContent, htmlContent);
        
        // Fallback to basic detection if no existing fields found
        if (signatureFields.length === 0) {
          signatureFields = detectSignatureFields(textContent, htmlContent);
        }
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

/**
 * Detects Adobe Sign tags in document content
 * @param {string} content - Text content of the document
 * @returns {Array<string>} - Array of detected Adobe Sign tags
 */
const detectAdobeSignTags = (content) => {
  const tags = [];
  
  // Patterns for double braces format (correct format)
  const doubleAdobeSignPatterns = [
    /\{\{sig_es_:signer\d+:signature\}\}/g,
    /\{\{\*ES_:signer\d+:signature\}\}/g,
    /\{\{Sig_es_:signer\d+\}\}/g, 
    /\{\{Sig\d*_es_:signer\d+:signature\}\}/g,
    /\{\{esig_\w+:signer\d+\}\}/g,
    /\{\{date_es_:signer\d+:date\}\}/g,
    /\{\{text_es_:signer\d+:\w+\}\}/g,
    /\{\{check_es_:signer\d+:\w+\}\}/g
  ];
  
  // Patterns for single braces format (legacy/alternative)
  const singleAdobeSignPatterns = [
    /\{sig_es_:signer\d+:signature\}/g,
    /\{\*ES_:signer\d+:signature\}/g,
    /\{Sig_es_:signer\d+\}/g, 
    /\{Sig\d*_es_:signer\d+:signature\}/g,
    /\{esig_\w+:signer\d+\}/g,
    /\{date_es_:signer\d+:date\}/g,
    /\{text_es_:signer\d+:\w+\}/g,
    /\{check_es_:signer\d+:\w+\}/g
  ];
  
  // Check for both formats, but prioritize double braces (the correct format)
  const allPatterns = [...doubleAdobeSignPatterns, ...singleAdobeSignPatterns];
  
  allPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (!tags.includes(match[0])) {
        tags.push(match[0]);
      }
    }
  });
  
  return tags;
};

/**
 * Process document with Adobe Sign tags - Direct approach
 * This method skips docxtemplater for documents with Adobe Sign tags
 * @param {string} filePath - Path to the document file
 * @param {Object} data - JSON data for template variables
 * @returns {Promise<string>} - Path to processed document
 */
const processDocumentWithAdobeSignTags = async (filePath, data = {}) => {
  try {
    logger.info('Processing document with Adobe Sign text tags');
    
    const ext = path.extname(filePath).toLowerCase();
    
    // Import the tag normalizer
    const { normalizeAdobeSignTags } = require('./adobeSignTagNormalizer');
    
    // Use the specialized adobeSignTemplateHandler for proper tag handling
    if (['.docx', '.doc'].includes(ext)) {
      // First, check if we need to normalize the tags
      if (['.docx'].includes(ext)) {
        try {
          // Read the document XML
          const docContent = await extractTextFromDocx(filePath);
          
          // Check if it contains double-brace Adobe Sign tags
          const doubleTagPattern = /\{\{(sig_es_|date_es_|\*ES_|signer\d+:)/i;
          if (doubleTagPattern.test(docContent)) {
            logger.info('Detected double-brace Adobe Sign tags, normalizing to single-brace format');
            
            // This will be handled by the specialized template handler
            // which now incorporates tag normalization
          }
        } catch (docReadError) {
          logger.warn(`Could not pre-check document for tag format: ${docReadError.message}`);
        }
      }
      
      // Import the specialized handler
      const adobeSignTemplateHandler = require('./adobeSignTemplateHandler');
      return await adobeSignTemplateHandler.processAdobeSignTemplate(filePath, data);
    } else if (ext === '.pdf') {
      // PDF files don't support template processing, return as-is
      logger.info('PDF file provided, no template processing needed');
      return filePath;
    }
    
    throw new Error(`Unsupported file format for Adobe Sign tags: ${ext}`);
  } catch (error) {
    logger.error(`Error processing document with Adobe Sign tags: ${error.message}`);
    throw error;
  }
};

// Function to detect if a document contains Adobe Sign tags
const containsAdobeSignTags = async (filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.docx') {
      // Read the docx file
      const content = fs.readFileSync(filePath, 'binary');
      const zip = new PizZip(content);
      const docXml = zip.files['word/document.xml'].asText();
      
      // Define patterns for Adobe Sign tags
      const adobeSignPatterns = [
        /\{sig_es_:signer\d+:signature\}/g,
        /\{\*ES_:signer\d+:signature\}/g,
        /\{Sig_es_:signer\d+:signature\}/g,
        /\{esig_.*?:signer\d+\}/g,
        /\{_es_:signer\d+.*?\}/g,
        /\{signature_es.*?\}/g,
        /\{initial_es.*?\}/g,
        /\{signer\d+:signature\}/g,
        /\{signer\d+:initial\}/g,
        /\{signer\d+:date\}/g,
        // Additional patterns for more flexibility
        /\{[^{}]*es_[^{}]*\}/gi,     // Any tag containing 'es_'
        /\{[^{}]*ES_[^{}]*\}/g,      // Any tag containing 'ES_'
        /\{[^{}]*signature[^{}]*\}/gi, // Any tag containing 'signature'
        /\{[^{}]*:signer\d+:[^{}]*\}/g // Any tag with signer format
      ];
      
      // Check if any Adobe Sign pattern is found in the document
      const foundTags = [];
      let isAdobeSignDoc = false;
      
      for (const pattern of adobeSignPatterns) {
        const matches = docXml.match(pattern);
        if (matches && matches.length > 0) {
          isAdobeSignDoc = true;
          foundTags.push(...matches);
        }
      }
      
      if (isAdobeSignDoc && foundTags.length > 0) {
        logger.info(`Found ${foundTags.length} Adobe Sign tags in document: ${foundTags.slice(0, 5).join(', ')}${foundTags.length > 5 ? '...' : ''}`);
      }
      
      return isAdobeSignDoc;
    } else if (ext === '.pdf') {
      // For PDFs, check text content for tag patterns
      // This is a simplistic approach - a more robust solution would use PDF parsing
      try {
        const pdfText = await extractTextFromPdf(filePath);
        return pdfText.includes('{sig_es_:signer') || 
               pdfText.includes('{*ES_:signer') ||
               pdfText.includes('{signer:');
      } catch (pdfError) {
        logger.warn(`Error extracting text from PDF: ${pdfError.message}`);
        // For PDF files, just return false as we can't detect tags reliably
        return false;
      }
    }
    
    return false;
  } catch (error) {
    logger.warn(`Error checking for Adobe Sign tags: ${error.message}`);
    return false;
  }
};

/**
 * Extract text from PDF for analysis
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<string>} - Extracted text content
 */
const extractTextFromPdf = async (filePath) => {
  try {
    // This is a placeholder - in production, you would use a proper PDF parsing library
    // such as pdf-parse or pdf.js
    logger.info(`Extracting text from PDF: ${filePath}`);
    
    // For now, return empty string - in production implementation, this would extract actual text
    return ''; 
  } catch (error) {
    logger.error(`Error extracting text from PDF: ${error.message}`);
    return '';
  }
};

/**
 * Normalizes Adobe Sign tags in a document content
 * Preserves double braces format for Adobe Sign tags ({{sig_es_:signer1:signature}})
 * @param {string} content - The document content with Adobe Sign tags
 * @returns {string} - Content with preserved Adobe Sign tags in double braces format
 */
const normalizeAdobeSignTags = (content) => {
  if (!content || typeof content !== 'string') {
    return content;
  }
  
  // Convert single-brace Adobe Sign tags to double-brace format
  const singleToDoubleMappings = [
    // Signature fields
    { pattern: /\{sig_es_:signer(\d+):signature\}/g, replacement: '{{sig_es_:signer$1:signature}}' },
    { pattern: /\{\*ES_:signer(\d+):signature\}/g, replacement: '{{*ES_:signer$1:signature}}' },
    { pattern: /\{Sig_es_:signer(\d+):signature\}/g, replacement: '{{Sig_es_:signer$1:signature}}' },
    { pattern: /\{Sig_es_:signer(\d+)\}/g, replacement: '{{Sig_es_:signer$1}}' },
    { pattern: /\{signer(\d+):signature\}/g, replacement: '{{signer$1:signature}}' },
    
    // Date fields
    { pattern: /\{date_es_:signer(\d+):date\}/g, replacement: '{{date_es_:signer$1:date}}' },
    
    // Other common field types
    { pattern: /\{text_es_:signer(\d+):(.*?)\}/g, replacement: '{{text_es_:signer$1:$2}}' },
    { pattern: /\{initial_es_:signer(\d+):initials\}/g, replacement: '{{initial_es_:signer$1:initials}}' },
    { pattern: /\{check_es_:signer(\d+):(.*?)\}/g, replacement: '{{check_es_:signer$1:$2}}' }
  ];
  
  // Convert single-brace Adobe Sign tags to double-brace format
  let normalizedContent = content;
  
  singleToDoubleMappings.forEach(mapping => {
    normalizedContent = normalizedContent.replace(mapping.pattern, mapping.replacement);
  });
  
  return normalizedContent;
};

/**
 * Identifies DOCX files even if they have incorrect extensions or mime types
 * Uses magic numbers and file signatures to detect actual file formats
 * @param {string} filePath - Path to the file to check
 * @returns {Promise<{detected: string, confidence: number}>} - Detected file type and confidence level
 */
const identifyFileFormat = async (filePath) => {
  try {
    // Read first 8 bytes of file to check signature
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);
    
    // DOCX files start with "PK" (zip file signature)
    if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
      // This is likely a ZIP-based format like DOCX, XLSX, PPTX
      try {
        // Check if it has the right structure for a DOCX file
        const zip = new PizZip(fs.readFileSync(filePath));
        
        // DOCX files have specific files in their structure
        if (zip.files['word/document.xml']) {
          return { detected: '.docx', confidence: 0.9 };
        } else if (zip.files['xl/workbook.xml']) {
          return { detected: '.xlsx', confidence: 0.9 };
        } else if (zip.files['ppt/presentation.xml']) {
          return { detected: '.pptx', confidence: 0.9 };
        }
        
        return { detected: '.zip', confidence: 0.7 };
      } catch (zipError) {
        logger.warn(`ZIP structure check failed: ${zipError.message}`);
        return { detected: '.zip', confidence: 0.5 };
      }
    }
    
    // PDF signature (%PDF-)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return { detected: '.pdf', confidence: 0.9 };
    }
    
    // DOC files (old MS Word format) often start with D0 CF 11 E0
    if (buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0) {
      return { detected: '.doc', confidence: 0.8 };
    }
    
    // Return unknown if no match
    return { detected: 'unknown', confidence: 0 };
  } catch (error) {
    logger.error(`Error identifying file format: ${error.message}`);
    return { detected: 'unknown', confidence: 0 };
  }
};

module.exports = {
  processDocumentTemplate,
  processDocxTemplate,
  convertDocToDocx,
  convertDocxToPdf,
  convertDocToPdf,
  convertOfficeDocToPdf,
  convertToPdf,
  extractTextContent,
  extractTemplateVariables,
  analyzeDocumentForSignatureFields,
  detectSignatureFields,
  detectExistingSignatureFields,
  validateTemplateData,
  processDocumentWithAdobeSignTags,
  containsAdobeSignTags,
  detectAdobeSignTags,
  extractTextFromPdf,
  normalizeAdobeSignTags,
  identifyFileFormat
};
