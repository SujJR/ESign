const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Check if a file has a valid PDF header
 * @param {Buffer} buffer - File buffer to check
 * @returns {boolean} - True if file has PDF header
 */
const isPdfFile = (buffer) => {
  // PDF files start with %PDF-
  const pdfHeader = Buffer.from('%PDF-');
  return buffer.subarray(0, 5).equals(pdfHeader);
};

/**
 * Get file type information
 * @param {string} filePath - Path to the file
 * @returns {object} - File type information
 */
const getFileInfo = (filePath) => {
  const stats = fs.statSync(filePath);
  const buffer = fs.readFileSync(filePath, { start: 0, end: 10 }); // Read first 10 bytes
  const extension = path.extname(filePath).toLowerCase();
  
  return {
    size: stats.size,
    extension,
    isPdf: isPdfFile(buffer),
    filename: path.basename(filePath)
  };
};

/**
 * Read a PDF file and extract information
 * @param {string} filePath - Path to the PDF file
 * @returns {Promise<object>} - PDF document information
 */
const analyzePdf = async (filePath) => {
  try {
    // Validate input
    if (!filePath) {
      throw new Error('File path is required');
    }
    
    if (typeof filePath !== 'string') {
      throw new Error('File path must be a string');
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    
    // Get file information
    const fileInfo = getFileInfo(filePath);
    logger.info(`Analyzing file: ${filePath}`, {
      size: fileInfo.size,
      extension: fileInfo.extension,
      isPdf: fileInfo.isPdf
    });
    
    // Validate file type
    if (!fileInfo.isPdf) {
      throw new Error(`File is not a valid PDF. Extension: ${fileInfo.extension}, Has PDF header: ${fileInfo.isPdf}`);
    }
    
    // Additional validation for file size
    if (fileInfo.size === 0) {
      throw new Error('File is empty');
    }
    
    if (fileInfo.size < 10) {
      throw new Error('File is too small to be a valid PDF');
    }
    
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

/**
 * Get the page count of a PDF file
 * @param {string} filePath - Path to the PDF file
 * @returns {Promise<number>} - Number of pages in the PDF
 */
const getPdfPageCount = async (filePath) => {
  try {
    const pdfInfo = await analyzePdf(filePath);
    return pdfInfo.pageCount;
  } catch (error) {
    logger.error(`Error getting PDF page count: ${error.message}`);
    throw error;
  }
};

module.exports = {
  analyzePdf,
  saveFile,
  getPdfPageCount,
  getFileInfo,
  isPdfFile
};
