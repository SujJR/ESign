const fs = require('fs');
const path = require('path');
const multer = require('multer');

describe('Upload Middleware - 100% Coverage Tests', () => {
  let originalExistsSync;
  let originalMkdirSync;
  
  beforeAll(() => {
    // Mock fs functions to test directory creation
    originalExistsSync = fs.existsSync;
    originalMkdirSync = fs.mkdirSync;
  });

  afterAll(() => {
    // Restore original functions
    fs.existsSync = originalExistsSync;
    fs.mkdirSync = originalMkdirSync;
  });

  test('should create uploads directory if it does not exist', () => {
    // Mock fs.existsSync to return false (directory doesn't exist)
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.mkdirSync = jest.fn();

    // Clear require cache and re-require the module to trigger directory creation
    delete require.cache[require.resolve('../src/middleware/upload')];
    require('../src/middleware/upload');

    expect(fs.existsSync).toHaveBeenCalled();
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('uploads'),
      { recursive: true }
    );
  });

  test('should handle LIMIT_FILE_SIZE multer error', () => {
    const { handleMulterErrors } = require('../src/middleware/upload');
    const { ApiError } = require('../src/utils/apiUtils');
    
    const fileSizeError = new multer.MulterError('LIMIT_FILE_SIZE');
    fileSizeError.code = 'LIMIT_FILE_SIZE';
    
    const next = jest.fn();
    
    handleMulterErrors(fileSizeError, {}, {}, next);
    
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'File too large. Maximum size is 10MB'
      })
    );
  });
});
