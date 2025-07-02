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

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get user profile

### Documents
- `POST /api/documents/upload-and-send` - Upload document
- `GET /api/documents` - List user documents
- `GET /api/documents/:id` - Get document details
- `GET /api/documents/:id/status` - Check signature status
- `GET /api/documents/:id/download` - Download signed document

### Webhooks
- `POST /api/webhooks/adobe-sign` - Adobe Sign status updates

## Usage Workflow

1. **Register/Login**: Create account or authenticate
2. **Upload Document**: Upload PDF or DOCX file
3. **Configure Recipients**: Add signer email addresses
4. **Send for Signature**: Submit to Adobe Sign
5. **Track Progress**: Monitor signature status
6. **Download Completed**: Get signed document

## Testing

The application includes various test scripts:

```bash
# Test authentication
npm run test-auth

# Test webhook functionality
npm run test-webhook

# Test comprehensive features
npm run test-enhanced-features
```

## Support

For support and questions, please refer to the Adobe Sign API documentation or create an issue in this repository.

## License

This project is licensed under the ISC License.