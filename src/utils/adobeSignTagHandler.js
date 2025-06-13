/**
 * Adobe Sign Tag Handling Functions
 * 
 * This module provides specialized functions for processing documents with Adobe Sign tags
 * and recovering from template errors related to Adobe Sign tag formatting.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const documentProcessor = require('../utils/documentProcessor');
const adobeSignTemplateHandler = require('../utils/adobeSignTemplateHandler');
const documentUtils = require('../utils/documentUtils');

/**
 * Process a document template that may contain Adobe Sign tags
 * @param {string} filePath - Path to the document file
 * @param {Object} templateData - Template data for variables
 * @returns {Promise<Object>} - Result object with paths and processing info
 */
const processDocumentWithTags = async (filePath, templateData = {}) => {
  try {
    // Check file extension
    const ext = path.extname(filePath).toLowerCase();
    if (!['.docx', '.doc'].includes(ext)) {
      throw new Error(`Unsupported file format for Adobe Sign tag processing: ${ext}`);
    }
    
    // First check if document contains Adobe Sign tags
    const hasAdobeSignTags = await documentProcessor.containsAdobeSignTags(filePath);
    
    let processedFilePath;
    let pdfFilePath;
    let usedSpecializedHandler = false;
    
    if (hasAdobeSignTags) {
      logger.info('Document contains Adobe Sign tags, using specialized processing');
      // Use specialized handler to preserve tags
      processedFilePath = await documentProcessor.processDocumentWithAdobeSignTags(filePath, templateData);
      usedSpecializedHandler = true;
    } else {
      try {
        // Try standard processing first
        logger.info('No Adobe Sign tags detected, using standard processing');
        processedFilePath = await documentProcessor.processDocumentTemplate(filePath, templateData);
      } catch (standardError) {
        // If standard processing fails, check if it might be due to undetected Adobe Sign tags
        logger.warn(`Standard processing failed: ${standardError.message}`);
        
        if (standardError.message.includes('Multi error') || 
            standardError.message.includes('Template Error') ||
            standardError.message.includes('unopened tag') ||
            standardError.message.includes('unclosed tag')) {
          
          logger.info('Trying specialized processing as fallback for possible Adobe Sign tags');
          // Try specialized handler as fallback
          processedFilePath = await documentProcessor.processDocumentWithAdobeSignTags(filePath, templateData);
          usedSpecializedHandler = true;
        } else {
          // Not an Adobe Sign tag related error, rethrow
          throw standardError;
        }
      }
    }
    
    // Convert processed document to PDF
    pdfFilePath = await documentProcessor.convertDocxToPdf(processedFilePath);
    
    return {
      originalFilePath: filePath,
      processedFilePath: processedFilePath,
      pdfFilePath: pdfFilePath,
      hasAdobeSignTags: hasAdobeSignTags || usedSpecializedHandler,
      usedSpecializedHandler: usedSpecializedHandler
    };
  } catch (error) {
    logger.error(`Error in processDocumentWithTags: ${error.message}`);
    throw error;
  }
};

/**
 * Recovery function for handling template errors that might be related to Adobe Sign tags
 * @param {string} filePath - Path to the document file
 * @param {Object} templateData - Template data for variables
 * @param {Object} documentData - Current document data object
 * @returns {Promise<Object>} - Updated document data
 */
const recoverFromTemplateError = async (filePath, templateData, documentData) => {
  try {
    logger.info('Attempting to recover from template error');
    
    // Try specialized Adobe Sign tag processing
    const processResult = await processDocumentWithTags(filePath, templateData);
    
    // Update document data
    documentData.processedFilePath = processResult.processedFilePath;
    documentData.pdfFilePath = processResult.pdfFilePath;
    documentData.hasAdobeSignTags = processResult.hasAdobeSignTags;
    
    // Analyze the converted PDF
    const pdfInfo = await documentUtils.analyzePdf(processResult.pdfFilePath);
    documentData.pageCount = pdfInfo.pageCount;
    
    logger.info('Successfully recovered from template error');
    
    return documentData;
  } catch (recoveryError) {
    logger.error(`Recovery attempt failed: ${recoveryError.message}`);
    throw recoveryError;
  }
};

module.exports = {
  processDocumentWithTags,
  recoverFromTemplateError
};
