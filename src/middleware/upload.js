const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ApiError } = require('../utils/apiUtils');
const logger = require('../utils/logger');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Create unique filename using timestamp and original name
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// Filter files to allow PDFs, DOCX, and DOC files
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
    'application/json' // for JSON data files
  ];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Only PDF, DOCX, DOC, and JSON files are allowed'), false);
  }
};

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  }
});

// Middleware for single file upload
exports.uploadDocument = upload.single('document');

// Middleware for document with optional JSON data
exports.uploadDocumentWithData = upload.fields([
  { name: 'document', maxCount: 1 },
  { name: 'documents', maxCount: 1 }, // Support both singular and plural
  { name: 'data', maxCount: 1 }
]);

// Middleware for document with multiple JSON data files
exports.uploadDocumentWithMultipleData = upload.fields([
  { name: 'document', maxCount: 1 },
  { name: 'documents', maxCount: 1 }, // Support both singular and plural
  { name: 'data', maxCount: 10 } // Allow up to 10 JSON files
]);

// Configure multer for document upload from URL with JSON data
const uploadFromUrl = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Only allow JSON files for this endpoint
    if (file.mimetype === 'application/json') {
      cb(null, true);
    } else {
      cb(new ApiError(400, 'Only JSON files are allowed for this endpoint'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB for JSON files
  }
}).fields([
  { name: 'jsonData', maxCount: 10 } // Allow up to 10 JSON files
]);

// Middleware for document upload from URL with JSON data
exports.uploadDocumentFromUrl = uploadFromUrl;

// Validate URL middleware
exports.validateUrl = (req, res, next) => {
  const { documentUrl } = req.body;
  
  if (!documentUrl) {
    return next(new ApiError(400, 'Document URL is required'));
  }
  
  try {
    const url = new URL(documentUrl);
    // Check for http or https protocol
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return next(new ApiError(400, 'Invalid URL protocol. Only HTTP and HTTPS are supported'));
    }
    
    // Store validated URL in request
    req.documentUrl = documentUrl;
    next();
  } catch (error) {
    logger.error(`Invalid URL provided: ${error.message}`);
    return next(new ApiError(400, 'Invalid URL format'));
  }
};

// Middleware for handling multer errors
exports.handleMulterErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(400, 'File too large. Maximum size is 10MB'));
    }
    return next(new ApiError(400, `Upload error: ${err.message}`));
  }
  next(err);
};
