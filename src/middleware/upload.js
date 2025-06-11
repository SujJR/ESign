const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ApiError } = require('../utils/apiUtils');

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
