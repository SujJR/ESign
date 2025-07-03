# Postman & Swagger Testing Guide

## 🎯 Quick Overview

This guide provides step-by-step instructions for testing the E-Signature API using both Postman and Swagger UI.

---

## 🔧 Setup (One-Time)

### 1. Generate API Key
```bash
node generate-api-keys.js
```
Copy the **Document Management API Key** (you'll use this for testing)

### 2. Start Server
```bash
npm start
```
Server runs on: `http://localhost:3000`

---

## 📋 Testing with Swagger UI

### Access Swagger
🌐 **URL**: `http://localhost:3000/api/docs`

### Authenticate
1. Click **🔒 Authorize** button (top right)
2. Paste your API key in **X-API-Key** field
3. Click **Authorize**

### Essential Tests

#### 1. Server Info Check
```
GET /
```
- Click **Try it out** → **Execute**
- ✅ Should return: API info with version and endpoints

#### 2. Adobe Sign Health Check
```
GET /api/enhanced/adobe-sign/health
```
- Click **Try it out** → **Execute**
- ✅ Should return: Adobe Sign integration status

#### 2. List Documents
```
GET /api/documents
```
- Click **Try it out** → **Execute**
- ✅ Should return: Empty array `[]` (if no documents)

#### 3. Upload and Send Document
```
POST /api/documents/upload-and-send
```
1. Click **Try it out**
2. **Choose file**: Select a PDF/DOCX file
3. **Recipients**: 
```json
[{"name": "John Doe", "email": "test@example.com"}]
```
4. Click **Execute**
5. ✅ Should return: Document with `_id` and `status: "sent_for_signature"`

#### 4. Check Status
```
GET /api/documents/{id}/status
```
1. Use the `_id` from step 3
2. Click **Try it out** → **Execute**
3. ✅ Should return: Status and recipient details

---

## 📬 Testing with Postman

### Import Collection
1. Open Postman
2. **Import** → Select `final-postman-collection.json`
3. Collection appears in sidebar

### Set Variables
1. Click collection name
2. **Variables** tab
3. Set:
   - `baseUrl`: `http://localhost:3000`
   - `apiKey`: Your generated API key
   - `recipientEmail`: `test@example.com`

### Essential Tests

#### 1. Test Authentication
```
📁 API Key Management > Test API Key Authentication
```
- Click **Send**
- ✅ Status: `200 OK`

#### 2. Upload and Send Document (File Method)
```
📁 Document Management > Method 1: File Upload + JSON File
```
1. **Body** tab → **form-data**
2. **document**: Choose file
3. **data**: Upload JSON file with:
```json
{
  "recipients": [
    {"name": "John Doe", "email": "test@example.com"}
  ]
}
```
4. Click **Send**
5. ✅ Status: `201 Created`

#### 3. Uploadand Send Document (URL Method)
```
📁 Document Management > Method 2: Document URL + Inline JSON
```
1. **Body** tab → **raw** → **JSON**
2. Use the pre-filled sample data
3. Change recipient email to yours
4. Click **Send**
5. ✅ Status: `201 Created`

#### 4. Check Status
```
📁 Signature Workflow > Check Status
```
- `documentId` auto-populated from previous response
- Click **Send**
- ✅ Should show signing progress

#### 5. Send Reminder
```
📁 Signature Workflow > Send Reminder
```
- Click **Send**
- ✅ Should confirm reminder sent

---

## 🔗 Key Endpoints Summary

| Test | Method | Endpoint | What it does |
|------|---------|----------|-------------|
| Server Info | `GET` | `/` | Check if server is running |
| Adobe Health | `GET` | `/api/enhanced/adobe-sign/health` | Check Adobe Sign integration |
| Auth | `GET` | `/api/documents` | Test API key works |
| Upload | `POST` | `/api/documents/upload` | Upload & send document |
| Status | `GET` | `/api/documents/{id}/status` | Check signing progress |
| Reminder | `POST` | `/api/documents/{id}/remind` | Send reminder email |

---

## ✅ Expected Results

### Successful Upload
```json
{
  "success": true,
  "data": {
    "document": {
      "_id": "doc_123...",
      "status": "sent_for_signature",
      "recipients": [
        {
          "email": "test@example.com",
          "status": "waiting_for_signature",
          "signingUrl": "https://secure.adobesign.com/..."
        }
      ]
    }
  }
}
```

### Status Check
```json
{
  "success": true,
  "data": {
    "status": "sent_for_signature",
    "progress": {
      "totalRecipients": 1,
      "signedRecipients": 0,
      "percentComplete": 0
    }
  }
}
```

---

## ❌ Common Issues

### 401 Unauthorized
```json
{"success": false, "message": "Invalid API key"}
```
**Fix**: Check your API key in headers

### 413 File Too Large
```json
{"success": false, "message": "File size exceeds limit"}
```
**Fix**: Use files smaller than 25MB

### 400 Adobe Sign Error
```json
{"success": false, "message": "Adobe Sign integration failed"}
```
**Fix**: Check Adobe Sign credentials in `.env`

---

## 🚀 5-Minute Test Workflow

**Goal**: Upload document → Send for signature → Check status

1. **Start server**: `npm start`
2. **Swagger**: `http://localhost:3000/api/docs`
3. **Authorize** with API key
4. **Server check**: `GET /`
5. **Upload**: `POST /api/documents/upload`
6. **Status**: `GET /api/documents/{id}/status`

**Success**: Document shows `"status": "in_progress"` with signing URLs

---

## 📱 Pro Tips

### Swagger UI
- ✅ **Best for**: Quick API exploration
- ✅ **Pros**: Built-in, always up-to-date
- ⚠️ **Note**: File uploads easier in Postman

### Postman
- ✅ **Best for**: Comprehensive testing
- ✅ **Pros**: File handling, variables, collections
- ⚠️ **Note**: Requires importing collection

### Which to Use?
- **Swagger**: First-time exploration
- **Postman**: Regular testing & development
- **Both**: Swagger for docs, Postman for workflows

---

## 🎉 Next Steps

After successful testing:
1. Try with real recipient emails
2. Test different file types (PDF, DOCX)
3. Explore webhook endpoints
4. Set up production environment

**You're ready to integrate the E-Signature API! 🚀**
