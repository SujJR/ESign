# E-Signature Application

A Node.js REST API for electronic signatures using Adobe Sign API. This application allows users to upload documents, prepare them for e-signatures, send them to recipients, and track the status of signatures.

## Features

- User authentication with JWT
- Document upload and management
- Adobe Sign API integration for e-signatures
- Comprehensive logging and audit trail
- MongoDB Atlas for data storage
- RESTful API for easy integration

## Prerequisites

- Node.js (v14 or higher)
- MongoDB Atlas account
- Adobe Sign Developer account
- Postman (for API testing)

## Installation

1. Clone the repository
2. Install dependencies
```bash
npm install
```
3. Create a `.env` file in the root directory with the following variables (use `.env.example` as a template):
```
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>?retryWrites=true&w=majority
ADOBE_CLIENT_ID=your_adobe_client_id
ADOBE_CLIENT_SECRET=your_adobe_client_secret
ADOBE_API_BASE_URL=https://api.na1.adobesign.com/
ADOBE_INTEGRATION_KEY=your_adobe_integration_key
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=1d
```

## Setup Adobe Sign API

1. Sign up for an Adobe Sign Developer account at https://acrobat.adobe.com/us/en/sign/developer-form.html
2. Create a new application in the Adobe Sign Developer Console
3. Generate an integration key and client credentials
4. Update the `.env` file with your Adobe Sign credentials

## Setup MongoDB Atlas

1. Create a MongoDB Atlas account at https://www.mongodb.com/cloud/atlas
2. Create a new cluster
3. Create a database user with read/write privileges
4. Get your connection string and update the `.env` file

## Running the Application

### Development mode
```bash
npm run dev
```

### Production mode
```bash
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login a user
- `GET /api/auth/me` - Get current user profile

### Documents
- `POST /api/documents/upload` - Upload a document
- `GET /api/documents` - Get all documents for a user
- `GET /api/documents/:id` - Get a specific document
- `POST /api/documents/:id/prepare` - Prepare document for signature
- `POST /api/documents/:id/send` - Send document for signature
- `GET /api/documents/:id/status` - Check document status
- `GET /api/documents/:id/download` - Download document

### Logs (Admin only)
- `GET /api/logs` - Get logs with pagination and filtering
- `GET /api/logs/summary` - Get logs summary statistics

## API Testing with Postman

1. Import the provided Postman collection (if available)
2. Set up environment variables in Postman:
   - `base_url`: http://localhost:3000
   - `token`: (Will be set after login)

3. Register a user and login to get the JWT token
4. Use the token for all authenticated requests

## Flow for E-Signature Process

1. Register/Login to get JWT token
2. Upload a PDF document
3. Prepare the document for signature by adding recipients
4. Send the document for signature
5. Check the status of the document
6. Download the signed document once completed

## Error Handling

The API uses standard HTTP status codes and returns detailed error messages. All errors follow this format:
```json
{
  "success": false,
  "status": 400,
  "message": "Error message",
  "timestamp": "2023-06-10T12:34:56.789Z"
}
```

## Logging

All activities are logged both to the console and to MongoDB for audit purposes. Admin users can access logs through the API.

## License

MIT
