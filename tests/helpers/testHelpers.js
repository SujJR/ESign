const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

/**
 * Create a test PDF file
 * @param {string} filename - Name of the PDF file
 * @param {string} content - Text content for the PDF
 * @returns {Promise<string>} - Path to the created PDF file
 */
const createTestPDF = async (filename = 'test-document.pdf', content = 'This is a test PDF document for e-signature testing.') => {
  const testDir = path.join(__dirname, '../fixtures');
  const filePath = path.join(testDir, filename);
  
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(filePath);
    
    doc.pipe(stream);
    doc.fontSize(12);
    doc.text(content, 100, 100);
    
    // Add signature fields placeholder text
    doc.text('Signature: ____________________', 100, 200);
    doc.text('Date: ____________________', 100, 220);
    doc.text('Name: ____________________', 100, 240);
    
    doc.end();
    
    stream.on('finish', () => {
      resolve(filePath);
    });
    
    stream.on('error', (err) => {
      reject(err);
    });
  });
};

/**
 * Create a test DOCX file (simple text file for testing)
 * @param {string} filename - Name of the DOCX file
 * @param {string} content - Text content for the DOCX
 * @returns {Promise<string>} - Path to the created DOCX file
 */
const createTestDOCX = async (filename = 'test-document.docx', content = 'This is a test DOCX document.') => {
  const testDir = path.join(__dirname, '../fixtures');
  const filePath = path.join(testDir, filename);
  
  // For testing purposes, we'll create a simple text file with .docx extension
  // In a real scenario, you'd use a proper DOCX library
  fs.writeFileSync(filePath, content);
  return filePath;
};

/**
 * Create test template data JSON
 * @param {Object} customData - Custom data to merge
 * @returns {Object} - Template data object
 */
const createTestTemplateData = (customData = {}) => {
  const defaultData = {
    recipients: [
      {
        name: 'John Doe',
        email: 'john.doe@test.com',
        title: 'Test Signer',
        signatureField: 'signature_1'
      },
      {
        name: 'Jane Smith',
        email: 'jane.smith@test.com',
        title: 'Test Witness',
        signatureField: 'signature_2'
      }
    ],
    agreementDate: new Date().toISOString().split('T')[0],
    companyName: 'Test Company Inc.',
    clientName: 'Test Client',
    projectName: 'Test Project'
  };
  
  return { ...defaultData, ...customData };
};

/**
 * Create a test API key for authentication
 * @returns {Object} - API key data
 */
const createTestApiKey = () => {
  return {
    _id: 'test-api-key-id',
    name: 'Test API Key',
    key: 'test-api-key-12345',
    permissions: ['document:upload', 'document:send', 'document:view'],
    scopes: ['document:manage'],
    organization: null,
    isActive: true,
    domains: [],
    rateLimits: {
      requestsPerMinute: 100,
      requestsPerHour: 1000
    }
  };
};

/**
 * Get file stats for testing
 * @param {string} filePath - Path to the file
 * @returns {Object} - File statistics
 */
const getTestFileStats = (filePath) => {
  const stats = fs.statSync(filePath);
  return {
    size: stats.size,
    mimeType: filePath.endsWith('.pdf') ? 'application/pdf' : 
               filePath.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
               'application/octet-stream'
  };
};

/**
 * Clean up test files
 * @param {Array<string>} filePaths - Array of file paths to clean up
 */
const cleanupTestFiles = (filePaths) => {
  filePaths.forEach(filePath => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
};

/**
 * Mock Adobe Sign responses
 */
const mockAdobeSignResponses = {
  uploadSuccess: {
    transientDocumentId: 'test-transient-doc-id-12345'
  },
  agreementSuccess: {
    id: 'test-agreement-id-12345',
    status: 'OUT_FOR_SIGNATURE',
    displayDate: new Date().toISOString(),
    participantSetsInfo: [
      {
        participantSetId: 'test-participant-set-1',
        participantSetMemberInfos: [
          {
            email: 'john.doe@test.com',
            participantId: 'test-participant-1'
          }
        ]
      }
    ]
  },
  signingUrlSuccess: {
    signingUrls: [
      {
        email: 'john.doe@test.com',
        esignUrl: 'https://secure.adobesign.com/public/esignWidget?wid=test-widget-id'
      }
    ]
  }
};

module.exports = {
  createTestPDF,
  createTestDOCX,
  createTestTemplateData,
  createTestApiKey,
  getTestFileStats,
  cleanupTestFiles,
  mockAdobeSignResponses
};
