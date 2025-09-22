const { formatResponse, ApiError } = require('../src/utils/apiUtils');

describe('API Utils - Complete Coverage Tests', () => {
  describe('formatResponse function', () => {
    test('should format response with numeric status code, message, and data', () => {
      const result = formatResponse(200, 'Success message', { id: 1, name: 'test' });
      
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.message).toBe('Success message');
      expect(result.data).toEqual({ id: 1, name: 'test' });
      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
    });

    test('should format response with string message, data, and error flag', () => {
      const result = formatResponse('Error occurred', { error: 'details' }, true);
      
      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect(result.message).toBe('Error occurred');
      expect(result.data).toEqual({ error: 'details' });
      expect(result.timestamp).toBeDefined();
    });

    test('should format response with string message and data, no error flag', () => {
      const result = formatResponse('Success message', { id: 2 }, false);
      
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.message).toBe('Success message');
      expect(result.data).toEqual({ id: 2 });
    });

    test('should format response with only message (string)', () => {
      const result = formatResponse('Simple message');
      
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.message).toBe('Simple message');
      expect(result.data).toBeNull();
    });

    test('should format response with numeric status code and message only', () => {
      const result = formatResponse(404, 'Not found');
      
      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
      expect(result.message).toBe('Not found');
      expect(result.data).toBeNull();
    });

    test('should handle success status codes correctly (200-399)', () => {
      const result201 = formatResponse(201, 'Created');
      const result299 = formatResponse(299, 'Custom success');
      const result399 = formatResponse(399, 'Edge success');
      
      expect(result201.success).toBe(true);
      expect(result299.success).toBe(true);
      expect(result399.success).toBe(true);
    });

    test('should handle error status codes correctly (400+)', () => {
      const result400 = formatResponse(400, 'Bad request');
      const result500 = formatResponse(500, 'Server error');
      
      expect(result400.success).toBe(false);
      expect(result500.success).toBe(false);
    });

    test('should handle client error status codes (100-199)', () => {
      const result100 = formatResponse(100, 'Continue');
      const result199 = formatResponse(199, 'Custom info');
      
      expect(result100.success).toBe(false);
      expect(result199.success).toBe(false);
    });

    test('should handle null and undefined values', () => {
      const resultNull = formatResponse(null, null);
      const resultUndefined = formatResponse(undefined, undefined);

      // formatResponse treats null/undefined message as truthy, so success=true with 200 status
      expect(resultNull.success).toBe(true);
      expect(resultNull.status).toBe(200);
      expect(resultNull.message).toBeNull();
      expect(resultNull.data).toBeNull();
      
      expect(resultUndefined.success).toBe(true);
      expect(resultUndefined.status).toBe(200);
      expect(resultUndefined.message).toBeUndefined();
      expect(resultUndefined.data).toBeNull(); // Second parameter becomes null when undefined
    });    test('should generate valid ISO timestamp', () => {
      const result = formatResponse(200, 'Test');
      const timestamp = new Date(result.timestamp);
      
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.toISOString()).toBe(result.timestamp);
    });

    test('should handle complex data objects', () => {
      const complexData = {
        users: [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }],
        metadata: {
          total: 2,
          page: 1,
          nested: {
            deep: {
              value: 'test'
            }
          }
        }
      };
      
      const result = formatResponse(200, 'Complex data', complexData);
      
      expect(result.data).toEqual(complexData);
      expect(result.data.users).toHaveLength(2);
      expect(result.data.metadata.nested.deep.value).toBe('test');
    });

    test('should handle array data', () => {
      const arrayData = [1, 2, 3, 'test', { id: 1 }];
      const result = formatResponse(200, 'Array data', arrayData);
      
      expect(result.data).toEqual(arrayData);
      expect(Array.isArray(result.data)).toBe(true);
    });

    test('should handle boolean data', () => {
      const result = formatResponse(200, 'Boolean data', true);
      
      expect(result.data).toBe(true);
      expect(typeof result.data).toBe('boolean');
    });

    test('should handle number data', () => {
      const result = formatResponse(200, 'Number data', 42);
      
      expect(result.data).toBe(42);
      expect(typeof result.data).toBe('number');
    });

    test('should handle zero as valid data', () => {
      const result = formatResponse(200, 'Zero data', 0);
      
      expect(result.data).toBe(0);
      expect(result.success).toBe(true);
    });

    test('should handle empty string as data', () => {
      const result = formatResponse(200, 'Empty string data', '');
      
      expect(result.data).toBe('');
      expect(result.success).toBe(true);
    });
  });

  describe('ApiError class', () => {
    test('should create ApiError with status code and message', () => {
      const error = new ApiError(404, 'Resource not found');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Resource not found');
      expect(error.isOperational).toBe(true);
      expect(error.stack).toBeDefined();
    });

    test('should create ApiError with custom operational flag', () => {
      const error = new ApiError(500, 'Internal error', false);
      
      expect(error.statusCode).toBe(500);
      expect(error.message).toBe('Internal error');
      expect(error.isOperational).toBe(false);
    });

    test('should create ApiError with custom stack trace', () => {
      const customStack = 'Custom stack trace\n  at test location';
      const error = new ApiError(400, 'Bad request', true, customStack);
      
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Bad request');
      expect(error.isOperational).toBe(true);
      expect(error.stack).toBe(customStack);
    });

    test('should create ApiError with default parameters', () => {
      const error = new ApiError(403, 'Forbidden');
      
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('Forbidden');
      expect(error.isOperational).toBe(true);
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('Error'); // Stack trace shows Error as base class
    });

    test('should inherit Error properties and methods', () => {
      const error = new ApiError(422, 'Validation error');
      
      expect(error.name).toBe('Error');
      expect(error.toString()).toBe('Error: Validation error');
      expect(typeof error.toString).toBe('function');
    });

    test('should handle empty message', () => {
      const error = new ApiError(500, '');
      
      expect(error.statusCode).toBe(500);
      expect(error.message).toBe('');
    });

    test('should handle various HTTP status codes', () => {
      const errors = [
        new ApiError(400, 'Bad Request'),
        new ApiError(401, 'Unauthorized'),
        new ApiError(403, 'Forbidden'),
        new ApiError(404, 'Not Found'),
        new ApiError(409, 'Conflict'),
        new ApiError(422, 'Unprocessable Entity'),
        new ApiError(429, 'Too Many Requests'),
        new ApiError(500, 'Internal Server Error'),
        new ApiError(502, 'Bad Gateway'),
        new ApiError(503, 'Service Unavailable')
      ];
      
      errors.forEach((error, index) => {
        expect(error).toBeInstanceOf(ApiError);
        expect(error.statusCode).toBeGreaterThanOrEqual(400);
        expect(error.message).toBeTruthy();
      });
    });

    test('should be throwable and catchable', () => {
      expect(() => {
        throw new ApiError(400, 'Test error');
      }).toThrow('Test error');

      try {
        throw new ApiError(500, 'Server error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect(error.statusCode).toBe(500);
        expect(error.message).toBe('Server error');
      }
    });

    test('should maintain stack trace in caught errors', () => {
      try {
        throw new ApiError(404, 'Not found');
      } catch (caughtError) {
        expect(caughtError).toBeInstanceOf(ApiError);
        expect(caughtError.statusCode).toBe(404);
        expect(caughtError.message).toBe('Not found');
      
        expect(caughtError.stack).toBeDefined();
        expect(caughtError.stack).toContain('Error'); // Stack trace shows Error as base class
      }
    });
  });

  describe('Integration scenarios', () => {
    test('should work together for error response formatting', () => {
      const error = new ApiError(400, 'Validation failed');
      const response = formatResponse(error.statusCode, error.message, { 
        field: 'email', 
        error: 'required' 
      });
      
      expect(response.success).toBe(false);
      expect(response.status).toBe(400);
      expect(response.message).toBe('Validation failed');
      expect(response.data.field).toBe('email');
    });

    test('should handle success response formatting', () => {
      const data = { id: 1, created: true };
      const response = formatResponse(201, 'Resource created successfully', data);
      
      expect(response.success).toBe(true);
      expect(response.status).toBe(201);
      expect(response.data).toEqual(data);
    });

    test('should handle error response with ApiError properties', () => {
      const apiError = new ApiError(422, 'Invalid input data');
      const response = formatResponse(apiError.statusCode, apiError.message);
      
      expect(response.success).toBe(false);
      expect(response.status).toBe(422);
      expect(response.message).toBe('Invalid input data');
    });
  });
});
