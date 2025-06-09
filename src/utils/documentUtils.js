const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Read a PDF file and extract information
 * @param {string} filePath - Path to the PDF file
 * @returns {Promise<object>} - PDF document information
 */
const analyzePdf = async (filePath) => {
  try {
    const pdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    
    const pageCount = pdfDoc.getPageCount();
    const pages = [];
    
    for (let i = 0; i < pageCount; i++) {
      const page = pdfDoc.getPage(i);
      pages.push({
        index: i,
        width: page.getSize().width,
        height: page.getSize().height
      });
    }
    
    return {
      pageCount,
      pages,
      filename: path.basename(filePath),
      fileSize: pdfBytes.length,
    };
  } catch (error) {
    logger.error(`Error analyzing PDF: ${error.message}`);
    throw error;
  }
};

/**
 * Save a file buffer to disk
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Filename to save as
 * @returns {Promise<string>} - Path to the saved file
 */
const saveFile = async (buffer, filename) => {
  try {
    const uploadsDir = path.join(__dirname, '../uploads');
    
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, buffer);
    
    return filePath;
  } catch (error) {
    logger.error(`Error saving file: ${error.message}`);
    throw error;
  }
};

module.exports = {
  analyzePdf,
  saveFile
};
