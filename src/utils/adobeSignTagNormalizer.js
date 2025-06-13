/**
 * Adobe Sign Tag Normalization Utility
 * Provides functionality to convert between different Adobe Sign tag formats
 */

const logger = require('./logger');

/**
 * Normalizes Adobe Sign tags in document content
 * Preserves double braces format for Adobe Sign tags and keeps them unchanged
 * @param {string} content - Document content with Adobe Sign tags
 * @returns {string} - Content with preserved Adobe Sign tags
 */
const normalizeAdobeSignTags = (content) => {
  if (!content) return content;
  
  logger.info('Normalizing Adobe Sign tags to double braces format');
  
  try {
    // Use the validation function to convert single braces to double braces
    const validation = validateAdobeSignTagFormat(content);
    
    if (validation.hasMixedFormats) {
      logger.info('Found mixed format Adobe Sign tags, normalizing to double braces');
    }
    
    return validation.content;
  } catch (error) {
    logger.error(`Error processing Adobe Sign tags: ${error.message}`);
    // Return original content on error to avoid data loss
    return content;
  }
};

/**
 * Validates Adobe Sign tags in content and provides format consistency
 * @param {string} content - Document content with Adobe Sign tags
 * @returns {Object} - Validation result and normalized content
 */
const validateAdobeSignTagFormat = (content) => {
  if (!content) return { isValid: false, content };
  
  // Check for double braces first (they take precedence)
  const doubleBracePatterns = [
    /\{\{sig_es_:signer\d+:signature\}\}/g,  // Double braces signature
    /\{\{date_es_:signer\d+:date\}\}/g,      // Double braces date
    /\{\{\*ES_:signer\d+:signature\}\}/g,    // Double braces alternative
    /\{\{signer\d+:signature\}\}/g,          // Double braces simplified
    /\{\{signer\d+:date\}\}/g                // Double braces date simplified
  ];
  
  let hasAdobeSignTags = false;
  let hasDoubleFormat = false;
  let hasSingleFormat = false;
  
  // Check for double braces first
  doubleBracePatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      hasAdobeSignTags = true;
      hasDoubleFormat = true;
    }
  });
  
  // If we found double braces, don't check for single braces (avoid confusion)
  let normalizedContent = content;
  
  if (!hasDoubleFormat) {
    // Only check for single braces if no double braces were found
    const singleBracePatterns = [
      /\{sig_es_:signer\d+:signature\}/g,      // Single braces signature
      /\{date_es_:signer\d+:date\}/g,          // Single braces date
      /\{\*ES_:signer\d+:signature\}/g,        // Single braces alternative
      /\{signer\d+:signature\}/g,              // Single braces simplified
      /\{signer\d+:date\}/g                    // Single braces date simplified
    ];
    
    singleBracePatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        hasAdobeSignTags = true;
        hasSingleFormat = true;
      }
    });
    
    // Convert single braces to double braces
    if (hasSingleFormat) {
      normalizedContent = normalizedContent
        .replace(/\{sig_es_:signer(\d+):signature\}/g, '{{sig_es_:signer$1:signature}}')
        .replace(/\{date_es_:signer(\d+):date\}/g, '{{date_es_:signer$1:date}}')
        .replace(/\{signer(\d+):signature\}/g, '{{signer$1:signature}}')
        .replace(/\{signer(\d+):date\}/g, '{{signer$1:date}}')
        .replace(/\{\*ES_:signer(\d+):signature\}/g, '{{*ES_:signer$1:signature}}');
      
      logger.info('Converted single-brace Adobe Sign tags to double-brace format');
    }
  } else {
    logger.info('Double-brace Adobe Sign tags already present, no conversion needed');
  }
  
  return {
    isValid: hasAdobeSignTags,
    hasMixedFormats: false, // We handle this properly now
    preferredFormat: 'double-braces',
    content: normalizedContent
  };
};

module.exports = {
  normalizeAdobeSignTags,
  validateAdobeSignTagFormat
};
