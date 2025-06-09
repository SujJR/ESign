<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# E-Signature Application with Adobe Sign API

This project is a Node.js Express application that integrates with Adobe Sign API for electronic signatures. It uses MongoDB Atlas for data storage and provides a RESTful API for document management and e-signature workflows.

## Project Structure

- `src/config/`: Configuration files for database and Adobe Sign API
- `src/controllers/`: Request handlers for each route
- `src/middleware/`: Express middleware for authentication, error handling, etc.
- `src/models/`: MongoDB schemas for users, documents, and logs
- `src/routes/`: Express routes for the API
- `src/utils/`: Utility functions for common tasks
- `src/uploads/`: Directory for storing uploaded documents

## Technologies Used

- Node.js and Express for the backend
- MongoDB Atlas for database
- Adobe Sign API for e-signatures
- JWT for authentication
- Multer for file uploads
- Morgan and Winston for logging

## Important Concepts

- Authentication with JWT
- Document management and processing
- Integration with Adobe Sign API
- Error handling and logging
- RESTful API design

## API Flow

1. User authentication (register/login)
2. Document upload
3. Document preparation for signature
4. Sending document for signature
5. Checking signature status
6. Downloading signed document
