# E-Signature Application with Adobe Sign API

A comprehensive Node.js Express application that integrates with Adobe Sign API for electronic signatures. This application provides a complete document management and e-signature workflow with MongoDB Atlas for data storage.

## Features

### Core Features
- **User Authentication**: JWT-based authentication with API key support
- **Document Management**: Upload, process, and manage documents for signing
- **Adobe Sign Integration**: Full integration with Adobe Sign API for e-signatures
- **Multi-format Support**: Supports PDF, DOCX, and other document formats
- **Email Notifications**: Automated email notifications for signature requests
- **Signature Tracking**: Real-time signature status monitoring
- **Webhook Support**: Adobe Sign webhook integration for status updates

### Advanced Features
- **Template Processing**: DOCX template processing with dynamic data
- **Bulk Operations**: Handle multiple documents and signers
- **Sequential Signing**: Support for multi-step signature workflows
- **Document Conversion**: Automatic DOCX to PDF conversion
- **Reminder System**: Automated signature reminders
- **Audit Trail**: Complete logging and audit trail for all operations

## Technologies Used

- **Backend**: Node.js with Express.js
- **Database**: MongoDB Atlas
- **Authentication**: JWT tokens
- **File Processing**: Multer, PDF-lib, Docxtemplater
- **API Integration**: Adobe Sign REST API
- **Email**: Nodemailer with SMTP
- **Logging**: Winston and Morgan
- **Document Processing**: LibreOffice, Mammoth, PDF2Pic

## Project Structure

```
src/
├── config/          # Configuration files (database, Adobe Sign)
├── controllers/     # Request handlers for API routes
├── middleware/      # Express middleware (auth, error handling)
├── models/          # MongoDB schemas (users, documents, logs)
├── routes/          # Express API routes
├── services/        # Business logic and external API services
├── utils/           # Utility functions and helpers
└── uploads/         # Temporary file storage
```

## Prerequisites

Before running this application, make sure you have:

- Node.js (v16 or higher)
- MongoDB Atlas account
- Adobe Sign Developer account
- SMTP email service (Gmail recommended)

## Environment Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd ESign
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create environment file**
   ```bash
   cp .env.example .env
   ```

4. **Configure environment variables**
   
   Open `.env` and update the following:

   ```env
   # Server Configuration
   PORT=3000
   NODE_ENV=development

   # MongoDB Atlas Configuration
   MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>

   # Adobe Sign API Configuration
   ADOBE_CLIENT_ID=your_adobe_client_id
   ADOBE_CLIENT_SECRET=your_adobe_client_secret
   ADOBE_API_BASE_URL=https://api.na1.adobesign.com/
   ADOBE_INTEGRATION_KEY=your_adobe_integration_key
   ADOBE_API_USER_EMAIL=your_adobe_sign_email
   ADOBE_WEBHOOK_URL=https://your-app-domain.com/api/webhooks/adobe-sign

   # Email Configuration (Gmail)
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   SMTP_SECURE=false
   EMAIL_FROM=your-email@gmail.com
   ```

## Adobe Sign Setup

1. **Create Adobe Sign Developer Account**
   - Go to [Adobe Sign Developer Portal](https://secure.na1.adobesign.com/public/developer_tools)
   - Create a new application
   - Note down your Integration Key, Client ID, and Client Secret

2. **Configure OAuth**
   - Set up OAuth 2.0 for your application
   - Configure redirect URIs if needed
   - Enable required scopes for document management

3. **Set up Webhooks**
   - Configure webhook URL in Adobe Sign
   - Enable events for signature status updates

## MongoDB Atlas Setup

1. **Create MongoDB Atlas Account**
   - Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
   - Create a new cluster

2. **Configure Database Access**
   - Create a database user
   - Whitelist your IP address
   - Get the connection string

3. **Database Structure**
   The application will automatically create the following collections:
   - `users` - User accounts and authentication
   - `documents` - Document metadata and status
   - `logs` - Audit trail and system logs

## How to Run

### Development Mode
```bash
npm run dev
```
This starts the server with nodemon for automatic restarts on file changes.

### Production Mode
```bash
npm start
```

### Generate API Keys
```bash
npm run generate-keys
```

## API Endpoints

### Health Check
- `GET /` - Server health and basic information
- `GET /api/enhanced/adobe-sign/health` - Adobe Sign integration health check

### Authentication & API Keys
- `POST /api/auth/api-keys` - Create new API key (requires admin key)
- `GET /api/auth/api-keys` - List all API keys (admin only)

### Documents
- `POST /api/documents/upload-and-send` - Upload and send document for signature (unified endpoint)
- `GET /api/documents` - List user documents
- `GET /api/documents/:id` - Get document details
- `GET /api/documents/:id/status` - Check signature status
- `GET /api/documents/:id/download` - Download signed document
- `POST /api/documents/:id/send-reminder` - Send reminder to unsigned recipients

### Enhanced Document Management
- `POST /api/enhanced/:id/schedule-reminders` - Schedule automated reminders
- `GET /api/enhanced/:id/reminder-status` - Check reminder status
- `DELETE /api/enhanced/:id/reminders` - Cancel scheduled reminders
- `GET /api/enhanced/reminders` - List all active reminders
- `POST /api/enhanced/:id/start-monitoring` - Start document monitoring
- `POST /api/enhanced/:id/stop-monitoring` - Stop document monitoring
- `GET /api/enhanced/:id/monitoring-status` - Check monitoring status
- `GET /api/enhanced/monitoring` - List all monitored documents
- `GET /api/enhanced/:id/analytics` - Get document analytics
- `POST /api/enhanced/bulk/start-monitoring` - Start bulk monitoring
- `GET /api/enhanced/system/status` - System status overview
- `POST /api/enhanced/:id/force-refresh` - Force refresh document status
- `POST /api/enhanced/:id/test-reminder` - Test reminder functionality

### Webhooks
- `POST /api/webhooks/setup` - Setup Adobe Sign webhook
- `POST /api/webhooks/adobe-sign` - Adobe Sign webhook handler (for Adobe Sign)

### Logs
- `GET /api/logs` - Get system logs (admin only)
- `GET /api/logs/summary` - Get logs summary (admin only)

### API Documentation
- `GET /api-docs` - Swagger API documentation

## Authentication

This API uses **API Key authentication exclusively**. Include your API key in requests using one of these methods:

### Header (Recommended)
```bash
X-API-Key: your_api_key
```

### Authorization Header
```bash
Authorization: Bearer your_api_key
```

### Query Parameter
```bash
?api_key=your_api_key
```

### Getting an API Key

1. **Generate Initial API Key**
   ```bash
   node generate-api-keys.js
   ```

2. **Create Additional API Keys** (requires admin key)
   ```bash
   curl -X POST http://localhost:3000/api/auth/api-keys \
     -H "X-API-Key: your_admin_key" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "My Application Key",
       "description": "API key for document management",
       "permissions": ["documents:read", "documents:write", "documents:send"]
     }'
   ```

### API Key Permissions

- `documents:read` - View documents and their status
- `documents:write` - Upload and modify documents
- `documents:send` - Send documents for signature
- `logs:read` - View system logs
- `admin:all` - Full administrative access

## Usage Workflow

### 1. Setup and Authentication
```bash
# Generate your first API key
node generate-api-keys.js

# Test server health
curl http://localhost:3000/

# Test Adobe Sign integration
curl -H "X-API-Key: your_api_key" http://localhost:3000/api/enhanced/adobe-sign/health
```

### 2. Upload and Send Document
```bash
# Method 1: File Upload + JSON File (multipart/form-data)
curl -X POST http://localhost:3000/api/documents/upload-and-send \
  -H "X-API-Key: your_api_key" \
  -F "document=@/path/to/document.pdf" \
  -F "data=@/path/to/template-data.json"

# Method 2: Document URL + Inline JSON (application/json)
curl -X POST http://localhost:3000/api/documents/upload-and-send \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "documentUrl": "https://example.com/document.pdf",
    "jsonData": {
      "recipients": [
        {"name": "John Doe", "email": "john@example.com", "title": "Client"}
      ],
      "templateVariable": "value"
    }
  }'
```

### 3. Track Document Status
```bash
# Check document status
curl -H "X-API-Key: your_api_key" \
  http://localhost:3000/api/documents/DOCUMENT_ID/status

# Get all documents
curl -H "X-API-Key: your_api_key" \
  http://localhost:3000/api/documents
```

### 4. Send Reminders
```bash
# Send reminder to unsigned recipients
curl -X POST http://localhost:3000/api/documents/DOCUMENT_ID/send-reminder \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"message": "Please sign this document."}'
```

### 5. Download Signed Document
```bash
# Download completed document
curl -H "X-API-Key: your_api_key" \
  http://localhost:3000/api/documents/DOCUMENT_ID/download \
  -o signed-document.pdf
```

### 6. Setup Webhooks (Optional)
```bash
# Configure Adobe Sign webhooks for real-time updates
curl -X POST http://localhost:3000/api/webhooks/setup \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl": "https://your-domain.com/api/webhooks/adobe-sign"}'
```

## Testing with Postman

1. **Import Collection**: Import `final-postman-collection.json` into Postman
2. **Set Variables**: Configure `baseUrl` and `apiKey` in collection variables
3. **Run Health Checks**: Test both server and Adobe Sign health endpoints
4. **Upload Document**: Use the unified upload endpoint with your preferred method
5. **Monitor Progress**: Check status and send reminders as needed

## Key Features

### Unified Upload Endpoint
The `/api/documents/upload-and-send` endpoint supports multiple upload methods:
- **File Upload**: Traditional file upload with form data
- **URL Download**: Download documents from URLs (Google Docs, etc.)
- **Template Processing**: Automatic DOCX template variable replacement
- **Multi-recipient Support**: Sequential or parallel signing workflows

### Enhanced Monitoring
- **Real-time Status**: Automatic document status updates
- **Reminder System**: Automated and manual reminder capabilities
- **Analytics**: Document interaction tracking and analytics
- **Bulk Operations**: Handle multiple documents simultaneously

### Integration Features
- **Adobe Sign API**: Full integration with Adobe Sign services
- **Webhook Support**: Real-time event notifications
- **Template Processing**: Dynamic document generation
- **Multi-format Support**: PDF, DOCX, DOC file handling

## Support

For support and questions, please refer to the Adobe Sign API documentation or create an issue in this repository.