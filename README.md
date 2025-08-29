# E-Signature Application with Adobe Sign API

A comprehensive Node.js Express application that integrates with Adobe Sign API for electronic signatures. This application provides a complete document management and e-signature workflow with MongoDB Atlas for data storage.

## Features

### Core Features
- **User Authentication**: JWT-based authentication with API key support
- **Document Management**: Upload, process, and manage documents for signing
- **Adobe Sign Integration**: Full integration with Adobe Sign API for e-signatures
- **Transaction Management**: Comprehensive transaction tracking and workflow management
- **Multi-format Support**: Supports PDF, DOCX, and other document formats
- **Email Notifications**: Automated email notifications for signature requests
- **Signature Tracking**: Real-time signature status monitoring
- **Webhook Support**: Adobe Sign webhook integration for status updates

### Advanced Features
- **Template Processing**: DOCX template processing with dynamic data
- **Bulk Operations**: Handle multiple documents and transactions simultaneously
- **Sequential Signing**: Support for multi-step signature workflows
- **Document Conversion**: Automatic DOCX to PDF conversion
- **Reminder System**: Automated signature and transaction reminders
- **Audit Trail**: Complete logging and audit trail for all operations
- **Analytics Dashboard**: Transaction analytics and performance insights
- **Stakeholder Management**: Track multiple participants in signing workflows

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
├── models/          # MongoDB schemas (users, documents, transactions, logs)
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
   - `transactions` - Transaction tracking and stakeholder management
   - `logs` - Audit trail and system logs
   - `apikeys` - API key management and permissions

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


<img width="534" alt="Screenshot 2025-07-03 at 8 18 47 PM" src="https://github.com/user-attachments/assets/f7808b4e-5b39-4c39-b36c-744497ce7c97" />


### Health Check
- `GET /` - Server health and basic information
- `GET /api/enhanced/adobe-sign/health` - Adobe Sign integration health check

### Authentication & API Keys
- `POST /api/auth/api-keys` - Create new API key (requires admin key)
- `GET /api/auth/api-keys` - List all API keys (admin only)

### Documents
- `POST /api/documents/upload-and-send` - Upload and send document for signature (unified endpoint)
- `POST /api/documents/upload-for-urls` - Upload and get signing URLs without sending emails (for custom notification workflows)
- `GET /api/documents` - List user documents
- `GET /api/documents/:id` - Get document details
- `GET /api/documents/:id/status` - Check signature status
- `GET /api/documents/:id/download` - Download signed document
- `POST /api/documents/:id/send-reminder` - Send reminder to unsigned recipients

### Webhooks
- `POST /api/webhooks/setup` - Setup Adobe Sign webhook
- `POST /api/webhooks/adobe-sign` - Adobe Sign webhook handler (for Adobe Sign)

### Logs
- `GET /api/logs` - Get system logs (admin only)
- `GET /api/logs/summary` - Get logs summary (admin only)

### Transaction Management
- `POST /api/transactions` - Create new transaction
- `GET /api/transactions` - List transactions with pagination and filtering
- `GET /api/transactions/:id` - Get specific transaction details
- `PUT /api/transactions/:id` - Update transaction
- `DELETE /api/transactions/:id` - Delete transaction
- `POST /api/transactions/:id/send-reminder` - Send reminder for transaction
- `GET /api/transactions/analytics` - Get transaction analytics
- `GET /api/transactions/analytics/summary` - Get transaction summary analytics
- `POST /api/transactions/bulk-create` - Create multiple transactions at once
- `POST /api/transactions/bulk-update` - Update multiple transactions at once
- `POST /api/transactions/bulk-delete` - Delete multiple transactions at once

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
- `transactions:read` - View transactions and analytics
- `transactions:write` - Create and modify transactions
- `transactions:send` - Send transaction reminders
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

## Transaction Management System

The application includes a comprehensive transaction management system for tracking document signing workflows, managing stakeholders, and analyzing transaction performance.

### Transaction Features

- **CRUD Operations**: Create, read, update, and delete transactions
- **Stakeholder Management**: Track multiple participants in signing workflows
- **Status Tracking**: Monitor transaction progress through various stages
- **Analytics**: Generate insights on transaction performance and trends
- **Reminder System**: Automated and manual reminder capabilities
- **Bulk Operations**: Handle multiple transactions simultaneously

### Transaction Workflow

### 1. Create Transaction
```bash
# Create a new transaction
curl -X POST http://localhost:3000/api/transactions \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Contract Review and Signature",
    "description": "Annual service contract requires signature",
    "documentId": "your_document_id",
    "status": "pending",
    "priority": "high",
    "stakeholders": [
      {
        "name": "John Doe",
        "email": "john@example.com",
        "role": "signer",
        "status": "pending"
      },
      {
        "name": "Jane Smith",
        "email": "jane@example.com",
        "role": "reviewer",
        "status": "pending"
      }
    ],
    "metadata": {
      "department": "Legal",
      "contract_type": "service_agreement"
    }
  }'
```

### 2. Query Transactions
```bash
# Get all transactions with pagination
curl -H "X-API-Key: your_api_key" \
  "http://localhost:3000/api/transactions?page=1&limit=10"

# Filter by status
curl -H "X-API-Key: your_api_key" \
  "http://localhost:3000/api/transactions?status=pending"

# Filter by priority
curl -H "X-API-Key: your_api_key" \
  "http://localhost:3000/api/transactions?priority=high"

# Search by title
curl -H "X-API-Key: your_api_key" \
  "http://localhost:3000/api/transactions?search=contract"

# Get specific transaction
curl -H "X-API-Key: your_api_key" \
  http://localhost:3000/api/transactions/TRANSACTION_ID
```

### 3. Update Transaction
```bash
# Update transaction status
curl -X PUT http://localhost:3000/api/transactions/TRANSACTION_ID \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in_progress",
    "stakeholders": [
      {
        "name": "John Doe",
        "email": "john@example.com",
        "role": "signer",
        "status": "signed"
      }
    ]
  }'
```

### 4. Send Reminders
```bash
# Send reminder for pending transaction
curl -X POST http://localhost:3000/api/transactions/TRANSACTION_ID/send-reminder \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Please complete your signature on the contract.",
    "stakeholders": ["john@example.com"]
  }'
```

### 5. Analytics and Reporting
```bash
# Get transaction analytics
curl -H "X-API-Key: your_api_key" \
  "http://localhost:3000/api/transactions/analytics"

# Get summary analytics
curl -H "X-API-Key: your_api_key" \
  "http://localhost:3000/api/transactions/analytics/summary"

# Filter analytics by date range
curl -H "X-API-Key: your_api_key" \
  "http://localhost:3000/api/transactions/analytics?startDate=2024-01-01&endDate=2024-12-31"
```

### 6. Bulk Operations
```bash
# Create multiple transactions
curl -X POST http://localhost:3000/api/transactions/bulk-create \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "transactions": [
      {
        "title": "Contract A",
        "description": "First contract",
        "status": "pending"
      },
      {
        "title": "Contract B", 
        "description": "Second contract",
        "status": "pending"
      }
    ]
  }'

# Update multiple transactions
curl -X POST http://localhost:3000/api/transactions/bulk-update \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "transactionIds": ["id1", "id2"],
    "updates": {
      "status": "in_progress",
      "priority": "high"
    }
  }'

# Delete multiple transactions
curl -X POST http://localhost:3000/api/transactions/bulk-delete \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "transactionIds": ["id1", "id2"]
  }'
```

### Transaction Status Values

- `pending` - Transaction created but not yet started
- `in_progress` - Transaction is being processed
- `completed` - All stakeholders have completed their actions
- `cancelled` - Transaction was cancelled
- `expired` - Transaction expired without completion
- `failed` - Transaction failed due to error

### Transaction Priority Values

- `low` - Non-urgent transactions
- `medium` - Standard priority transactions
- `high` - High priority transactions
- `urgent` - Critical transactions requiring immediate attention

### Stakeholder Roles

- `signer` - Person who needs to sign the document
- `reviewer` - Person who needs to review the document
- `approver` - Person who needs to approve the document
- `observer` - Person who should be notified of progress

## Testing with Postman

1. **Import Collection**: Import `final-postman-collection.json` into Postman
2. **Set Variables**: Configure `baseUrl`, `apiKey`, and `transactionId` in collection variables
3. **Run Health Checks**: Test both server and Adobe Sign health endpoints
4. **Upload Document**: Use the unified upload endpoint with your preferred method
5. **Create Transaction**: Create a new transaction to track document workflow
6. **Monitor Progress**: Check status and send reminders as needed
7. **Analytics**: View transaction analytics and performance metrics

### Available Collections

The Postman collection includes comprehensive test suites for:
- **Authentication**: API key validation and management
- **Document Management**: Upload, status checking, and download
- **Transaction Management**: Full CRUD operations and analytics
- **Webhook Testing**: Adobe Sign webhook integration
- **Bulk Operations**: Multiple document and transaction handling

## Key Features

### Unified Upload Endpoint
The `/api/documents/upload-and-send` endpoint supports multiple upload methods:
- **File Upload**: Traditional file upload with form data
- **URL Download**: Download documents from URLs (Google Docs, etc.)
- **Template Processing**: Automatic DOCX template variable replacement
- **Multi-recipient Support**: Sequential or parallel signing workflows

### Transaction Management System
The transaction management system provides:
- **Workflow Tracking**: Track document signing workflows end-to-end
- **Stakeholder Management**: Manage multiple participants with different roles
- **Status Monitoring**: Real-time updates on transaction progress
- **Reminder Automation**: Automated reminders for pending actions
- **Analytics Dashboard**: Performance insights and trend analysis
- **Bulk Operations**: Handle multiple transactions simultaneously

### Enhanced Monitoring
- **Real-time Status**: Automatic document status updates
- **Reminder System**: Automated and manual reminder capabilities
- **Analytics**: Document interaction tracking and analytics
- **Audit Trail**: Complete transaction and document history
- **Performance Metrics**: Track completion rates and processing times

### Integration Features
- **Adobe Sign API**: Full integration with Adobe Sign services
- **Webhook Support**: Real-time event notifications
- **Template Processing**: Dynamic document generation
- **Multi-format Support**: PDF, DOCX, DOC file handling
- **Email Integration**: Automated notification system

## Support

For support and questions, please refer to the Adobe Sign API documentation or create an issue in this repository.

## Recent Updates

### Transaction Management System
- Added comprehensive transaction tracking and workflow management
- Implemented stakeholder management with role-based permissions
- Added analytics and reporting capabilities
- Integrated bulk operations for handling multiple transactions
- Enhanced reminder system for transaction follow-ups
- Added real-time status monitoring and progress tracking

### Enhanced API Features
- Expanded Swagger documentation with all new endpoints
- Updated Postman collection with comprehensive test suites
- Added API key permission system for transaction management
- Implemented advanced filtering and pagination for all endpoints
- Added robust error handling and validation

This application now provides a complete end-to-end solution for document management and electronic signatures with advanced transaction tracking capabilities.
