# E-Signature Application with Adobe Sign API Integration

This project is a Node.js Express application that integrates with Adobe Sign API for electronic signatures. It uses MongoDB Atlas for data storage and provides a RESTful API for document management and e-signature workflows.

## Features

- User authentication with JWT and API Key support
- Document upload and processing
- Integration with Adobe Sign API for e-signatures
- Email notifications
- Signature status tracking
- Webhook support for signature status updates

## Socket Hang Up Error Fix

This project includes a comprehensive fix for the "socket hang up" error that can occur when sending documents for signature via the Adobe Sign API. This error occurs when the API request times out or the connection is reset after the document has been successfully sent to Adobe Sign.

### Fix Implementation

The fix is implemented in multiple layers:

1. **Enhanced Axios Client**
   - Increased timeout settings
   - Added retry logic for network-related errors
   - Custom error handling for socket hang up and similar errors

2. **Document Controller Patch**
   - Safety timer to check document status after a delay
   - Aggressive recovery for network errors
   - Smart detection of successful document submissions despite network errors

3. **Recovery Utilities**
   - `verify-document-status.js`: Checks documents with errors against Adobe Sign
   - `recover-documents.js`: Automatically recovers documents that were sent but had network errors

### Usage

To verify documents with potential errors:

```bash
npm run verify-documents
```

To automatically recover documents that were sent but had network errors:

```bash
npm run recover-documents
```

To test the socket hang up fix:

```bash
npm run test-fix
```

## API Flow

1. User authentication (register/login)
2. Document upload
3. Document preparation for signature
4. Sending document for signature
5. Checking signature status
6. Downloading signed document

## Technologies Used

- Node.js and Express for the backend
- MongoDB Atlas for database
- Adobe Sign API for e-signatures
- JWT for authentication
- Multer for file uploads
- Morgan and Winston for logging
- Axios for HTTP requests

## Project Structure

- `src/config/`: Configuration files for database and Adobe Sign API
- `src/controllers/`: Request handlers for each route
- `src/middleware/`: Express middleware for authentication, error handling, etc.
- `src/models/`: MongoDB schemas for users, documents, and logs
- `src/routes/`: Express routes for the API
- `src/utils/`: Utility functions for common tasks
- `src/uploads/`: Directory for storing uploaded documents