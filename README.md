# E-Signature Application

A Node.js REST API for electronic signatures using Adobe Sign API. This application allows users to upload documents, prepare them for e-signatures, send them to recipients, and track the status of signatures.

**🔐 API Key Authentication Required** - This API now uses secure API key authentication for all endpoints.

## 🆕 Enhanced Features

- **🚀 Dynamic signature field mapping** - Auto-generates field mapping from JSON recipients
- **👥 Smart recipient extraction** - Prioritizes explicit recipients array over individual fields
- **📧 Duplicate email prevention** - Intelligent deduplication for clean recipient lists
- **🎯 Auto-extract recipients from JSON template data** - No manual recipient entry needed!
- **🔗 Signature field mapping** - Map specific signature fields to users by email
- **📊 Bulk signing URL retrieval** - Get URLs for all recipients at once
- **🧠 Enhanced template processing** - Intelligent DOCX template processing with error guidance
- **⚡ Comprehensive workflow management** - Streamlined multi-recipient document workflows

## Features

- **🔐 API Key Authentication** - Secure access with API key management
- **📊 Permission-based Access Control** - Granular permissions for different operations
- **⚡ Rate Limiting** - Configurable rate limits per API key
- **🌐 IP Restrictions** - Optional IP-based access control
- Document upload and management with template processing
- **🆕 Dynamic auto-extraction of recipients from JSON template data**
- **🆕 Intelligent signature field mapping with auto-generation**
- **🆕 Smart recipient prioritization (explicit recipients > individual fields)**
- **🆕 Duplicate email prevention and deduplication**
- Adobe Sign API integration for e-signatures
- Bulk signing URL management for multiple recipients
- Enhanced reminder system for unsigned recipients
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
ADOBE_API_USER_EMAIL=your_adobe_sign_email
```

## API Key Setup

After setting up your environment and database connection, you need to generate API keys:

### Generate Initial API Keys
```bash
node generate-api-keys.js
```

This will create three initial API keys:
- **Admin API Key** - Full administrative access (`admin:all`)
- **Document Management Key** - Document operations (`documents:read`, `documents:write`, `documents:send`)
- **Read-Only Key** - Monitoring access (`documents:read`, `logs:read`)

### API Key Permissions

Available permissions:
- `documents:read` - View documents and their status
- `documents:write` - Upload and modify documents
- `documents:send` - Send documents for signature
- `documents:delete` - Delete documents
- `logs:read` - Access system logs
- `admin:all` - Full administrative access (includes all permissions)

### Using API Keys

Include your API key in requests using one of these methods:

**Method 1: X-API-Key Header (Recommended)**
```bash
curl -H "X-API-Key: ak_12345678_your_api_key_here" http://localhost:3000/api/documents
```

**Method 2: Authorization Header**
```bash
curl -H "Authorization: Bearer ak_12345678_your_api_key_here" http://localhost:3000/api/documents
```

**Method 3: Query Parameter**
```bash
curl "http://localhost:3000/api/documents?api_key=ak_12345678_your_api_key_here"
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

**🔐 All endpoints require API key authentication**

### Documents (Requires API Key with appropriate permissions)
- `POST /api/documents/upload` - Upload a document *(requires `documents:write`)*
- `POST /api/documents/upload-with-data` - Upload document with template data *(requires `documents:write`)*
- `GET /api/documents` - Get all documents *(requires `documents:read`)*
- `GET /api/documents/:id` - Get a specific document *(requires `documents:read`)*
- `POST /api/documents/:id/prepare` - **🆕 ENHANCED** Prepare document with auto-mapping *(requires `documents:write`)*
- `POST /api/documents/:id/send` - Send document for signature *(requires `documents:send`)*
- `POST /api/documents/:id/send-reminder` - **NEW** Send reminder to unsigned recipients *(requires `documents:send`)*
- `GET /api/documents/:id/signing-url` - **NEW** Get signing URL for iframe embedding *(requires `documents:read`)*
- `GET /api/documents/:id/signing-urls` - **🆕 NEW** Get all signing URLs at once *(requires `documents:read`)*
- `GET /api/documents/:id/status` - Check document status *(requires `documents:read`)*
- `GET /api/documents/:id/download` - Download document *(requires `documents:read`)*

### API Key Management (Requires Admin Access)
- `POST /api/auth/api-keys` - Create new API key *(requires `admin:all`)*
- `GET /api/auth/api-keys` - List all API keys *(requires `admin:all`)*
- `GET /api/auth/api-keys/:keyId` - Get specific API key details *(requires `admin:all`)*
- `PUT /api/auth/api-keys/:keyId` - Update API key *(requires `admin:all`)*
- `DELETE /api/auth/api-keys/:keyId` - Deactivate API key *(requires `admin:all`)*
- `GET /api/auth/api-keys/:keyId/stats` - Get API key usage statistics *(requires `admin:all`)*
- `POST /api/auth/api-keys/:keyId/regenerate` - Regenerate API key *(requires `admin:all`)*

### Logs (Requires Log Access)
- `GET /api/logs` - Get logs with pagination and filtering *(requires `logs:read`)*
- `GET /api/logs/summary` - Get logs summary statistics *(requires `logs:read`)*

## ✨ New Endpoints for Enhanced Workflow Management

### 🚀 Prepare Document with Auto-Mapping (Enhanced)
```http
POST /api/documents/:id/prepare
Content-Type: application/json

{
  "useIntelligentPositioning": true,
  "signingFlow": "SEQUENTIAL"
}
```

**🆕 Dynamic Features:**
- **Auto-extracts recipients from JSON template data** - No manual entry needed!
- **Auto-generates signature field mapping** - Uses recipient emails and signatureField properties
- **Smart recipient prioritization** - Uses explicit `recipients` array when available
- **Duplicate prevention** - Intelligent email deduplication
- **Only signature recipients** - Ignores project managers, approvers, etc.
- **🆕 Sequential Signing Control** - Choose between PARALLEL (default) or SEQUENTIAL signing

**Signing Flow Options:**
- `"signingFlow": "SEQUENTIAL"` - Recipients receive emails one by one in order (default)
- `"signingFlow": "PARALLEL"` - All recipients receive emails simultaneously

**Expected JSON structure:**
```json
{
  "recipients": [
    {
      "name": "John Smith",
      "email": "john.smith@example.com",
      "title": "CEO", 
      "signatureField": "clientSignature"
    },
    {
      "name": "Sarah Johnson",
      "email": "sarah.johnson@example.com",
      "title": "CTO",
      "signatureField": "providerSignature"
    }
  ]
}
```

### 🆕 Get All Signing URLs
```http
GET /api/documents/:id/signing-urls
```

**Features:**
- Returns signing URLs for all recipients at once
- Includes status, signature field mapping, and recipient details
- Bulk operation for multi-recipient workflows
- iframe-compatible URLs with embedding guidance

### Send Reminder to Unsigned Recipients
```http
POST /api/documents/:id/send-reminder
Content-Type: application/json

{
  "message": "Please complete your signature for this important document."
}
```

**Features:**
- Automatically identifies recipients who haven't signed yet
- Sends reminder only to pending recipients
- Tracks reminder history with timestamps
- Custom message support (optional)

### Get Signing URL for iframe Embedding
```http
GET /api/documents/:id/signing-url?recipientEmail=recipient@example.com
```

**Features:**
- Returns iframe-compatible signing URL
- Unique URL per recipient
- Includes embedding guidance and URL behavior information
- Validates recipient email against document recipients

**⚠️ Important**: Signing URLs change after each signature in multi-recipient workflows. Always fetch fresh URLs before embedding.

## API Testing with Postman

1. Import the provided Postman collection (if available)
2. Set up environment variables in Postman:
   - `base_url`: http://localhost:3000

3. Start making API requests directly (no authentication required)

## Flow for E-Signature Process

### 🚀 **Enhanced Workflow (Recommended)**
1. **Upload document with JSON data** using `/api/documents/upload-with-data`
   - Upload DOCX template + JSON file with recipients
2. **Auto-prepare for signature** using `/api/documents/:id/prepare`
   - Just send `{"useIntelligentPositioning": true}`
   - System auto-extracts recipients and generates field mapping
4. **Send for signature** using `/api/documents/:id/send`
5. **Get all signing URLs** using `/api/documents/:id/signing-urls`
6. **Send reminders if needed** using `/api/documents/:id/send-reminder`
7. **Check status** using `/api/documents/:id/status`
8. **Download signed document** once completed

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

## 🎉 Latest Enhancements - Dynamic Signature Field Mapping

### 🚀 What's New (June 2025)

**1. 🧠 Smart Recipient Extraction**
- Prioritizes explicit `recipients` array in JSON over individual fields
- Automatically excludes non-signers (project managers, approvers, etc.)
- Only extracts people intended for signatures

**2. ⚡ Dynamic Field Mapping Generation**
- Auto-generates signature field mapping from JSON recipients
- Uses `signatureField` property from each recipient
- No manual mapping configuration required

**3. 📧 Duplicate Email Prevention** 
- Intelligent deduplication prevents Adobe Sign API errors
- Case-insensitive email matching
- Clean recipient lists without duplicates

**4. 🎯 Enhanced Prepare Endpoint**
- Simply call with `{"useIntelligentPositioning": true}`
- System handles everything automatically
- Works with any JSON structure containing recipients array

### 📊 Before vs After

**Before (Manual Process):**
```json
{
  "recipients": [...], // Manual entry required
  "signatureFieldMapping": { // Manual mapping required
    "john@example.com": "clientSignature",
    "sarah@example.com": "providerSignature"
  }
}
```

**After (Automatic Process):**
```json
{
  "useIntelligentPositioning": true
  // System auto-extracts recipients and generates mapping!
}
```

### 🔧 How It Works

1. **Upload** DOCX template + JSON with recipients array
2. **Call prepare endpoint** with minimal config
3. **System automatically:**
   - Extracts only signature recipients
   - Generates email → signatureField mapping
   - Deduplicates any duplicate emails
   - Prepares document for signature

### 📈 Benefits

- **90% less configuration** - Minimal request body needed
- **Zero duplicates** - Intelligent deduplication
- **Only signers included** - Ignores non-signing personnel
- **Error-free** - Prevents Adobe Sign API rejections
- **Future-proof** - Works with any JSON structure

## ✨ Previous Updates - Enhanced Signature Field Recognition

### 🎯 Key Improvements

1. **Enhanced Pattern Recognition**
   - Detects 20+ signature field patterns including `Signature: ___`, `[SIGNATURE]`, `sign here: ___`
   - Recognizes date fields: `Date: ___`, `dated this ___ day`
   - Identifies HTML form elements and underlined signature areas
   - Smart categorization of signature vs. date vs. text fields

2. **Position-Aware Field Placement**
   - Estimates field positions based on document content analysis
   - Places Adobe Sign form fields at detected signature locations
   - Respects existing document layout and formatting
   - Fallback to intelligent positioning when needed

3. **Multi-Approach Integration**
   - Enhanced positioning with existing field recognition
   - Adobe Sign intelligent positioning as fallback
   - Auto-detected field mapping
   - Basic agreement creation for maximum compatibility

4. **Improved Success Rate**
   - Comprehensive fallback system ensures document processing succeeds
   - Better Adobe Sign API integration
   - Reduced manual field positioning requirements

### 🚀 How It Works

1. **Document Analysis**: System analyzes uploaded documents for signature patterns
2. **Field Detection**: Identifies existing signature blanks and their approximate positions  
3. **Smart Positioning**: Places interactive form fields at detected locations
4. **Adobe Sign Integration**: Uses enhanced API options for better field recognition
5. **Fallback System**: Multiple approaches ensure compatibility


### 💡 Best Practices for Documents

Create signature areas using these patterns for best recognition:
- `Signature: ___________________________`
- `Client Signature: ____________________`
- `[SIGNATURE]` or `[SIGN HERE]`
- `Date: ___________`
- HTML: `<input type="signature">`

### 🔧 Configuration

Enable enhanced positioning (default):
```javascript
{
  "useIntelligentPositioning": true,
  "useAutoDetectedFields": true
}
```

## License

MIT
