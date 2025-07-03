const express = require('express');
const documentController = require('../controllers/document.controller');
const documentControllerAdditions = require('../controllers/document.controller.additions');
const { uploadDocument, uploadDocumentWithData, uploadDocumentFromUrl, handleMulterErrors } = require('../middleware/upload');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// Apply API key authentication to all routes
router.use(authenticateApiKey);

/**
 * @swagger
 * /api/documents/upload-and-send:
 *   post:
 *     summary: Upload, prepare and send document for signature (Unified Endpoint)
 *     tags: [Documents]
 *     description: |
 *       🚀 **UNIFIED ENDPOINT** - All document upload, preparation, and sending operations combined into ONE powerful endpoint.
 *       
 *       **Supports 2 upload methods:**
 *       - **Method 1:** File Upload + JSON File (multipart/form-data)
 *       - **Method 2:** Document URL + Inline JSON (application/json)
 *       
 *       **Key Features:**
 *       - Single endpoint for complete document workflow
 *       - Auto-extract recipients from JSON template data
 *       - Process template variables in DOCX files
 *       - Real-time Adobe Sign integration
 *       - Generate and store signing URLs
 *       - Enhanced error handling and logging
 *       - Rate limit protection
 *       
 *       **All methods perform:**
 *       1. Upload/Download the document
 *       2. Process template variables
 *       3. Prepare for signature
 *       4. Send to Adobe Sign
 *       5. Store signing URLs
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               document:
 *                 type: string
 *                 format: binary
 *                 description: 📄 Document file to upload (PDF, DOCX, DOC)
 *               data:
 *                 type: string
 *                 format: binary
 *                 description: 📄 JSON file with template data and recipient info
 *               signingFlow:
 *                 type: string
 *                 enum: [SEQUENTIAL, PARALLEL]
 *                 default: SEQUENTIAL
 *                 description: 📋 Signing flow type
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               documentUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to document (for Method 2)
 *                 example: https://docs.google.com/document/d/1oC0q7y8_FbJmckQiU73lun4W5k1E4qmz/edit
 *               jsonData:
 *                 type: object
 *                 description: Template data with recipients
 *                 properties:
 *                   recipients:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         name: { type: string }
 *                         email: { type: string, format: email }
 *                         title: { type: string }
 *                   agreementDate: { type: string }
 *                   clientName: { type: string }
 *                   companyName: { type: string }
 *                 additionalProperties: true
 *               signingFlow:
 *                 type: string
 *                 enum: [SEQUENTIAL, PARALLEL]
 *                 default: SEQUENTIAL
 *     responses:
 *       201:
 *         description: Document uploaded and sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UploadResponse'
 *       400:
 *         description: Bad request - Invalid file or template data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Invalid API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Combined upload, prepare, and send endpoint (supports all 3 methods)
router.post('/upload-and-send', requirePermissions(['documents:send', 'documents:write', 'admin:all']), uploadDocumentWithData, handleMulterErrors, documentController.uploadPrepareAndSend);

/**
 * @swagger
 * /api/documents:
 *   get:
 *     summary: Get all documents for authenticated user (API Key Test Endpoint)
 *     tags: [Documents]
 *     description: |
 *       🔑 **API KEY TEST ENDPOINT**
 *       
 *       This endpoint serves dual purposes:
 *       1. **Test API Key Authentication** - Validates your API key is working correctly
 *       2. **Retrieve Documents** - Gets all documents associated with your API key
 *       
 *       **Perfect for testing your API key setup:**
 *       - Returns 401 if API key is invalid or missing
 *       - Returns 200 with document list if API key is valid
 *       - Includes pagination and filtering options
 *       
 *       **Use this endpoint to verify your API key before making other API calls.**
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of documents per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, in_progress, signed, cancelled, expired]
 *         description: Filter by document status
 *     responses:
 *       200:
 *         description: List of documents retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         documents:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/Document'
 *                         pagination:
 *                           type: object
 *                           properties:
 *                             page: { type: integer }
 *                             limit: { type: integer }
 *                             total: { type: integer }
 *                             pages: { type: integer }
 *       401:
 *         description: Unauthorized - Invalid API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get all documents for user
router.get('/', requirePermissions(['documents:read', 'admin:all']), documentController.getDocuments);

/**
 * @swagger
 * /api/documents/{id}:
 *   get:
 *     summary: Get specific document by ID
 *     tags: [Documents]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Document'
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Invalid API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get specific document
router.get('/:id', requirePermissions(['documents:read', 'admin:all']), documentController.getDocument);

/**
 * @swagger
 * /api/documents/{id}/status:
 *   get:
 *     summary: Check document status
 *     tags: [Documents]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           enum: [draft, in_progress, signed, cancelled, expired]
 *                         adobeSignStatus:
 *                           type: string
 *                           description: Adobe Sign specific status
 *                         recipients:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               name: { type: string }
 *                               email: { type: string }
 *                               status: { type: string }
 *                               signedAt: { type: string, format: date-time }
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Invalid API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Check document status
router.get('/:id/status', requirePermissions(['documents:read', 'admin:all']), documentController.checkDocumentStatus);

/**
 * @swagger
 * /api/documents/{id}/download:
 *   get:
 *     summary: Download document
 *     tags: [Documents]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [original, signed]
 *           default: signed
 *         description: Type of document to download
 *     responses:
 *       200:
 *         description: Document file
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *           application/vnd.openxmlformats-officedocument.wordprocessingml.document:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Invalid API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Download document
router.get('/:id/download', requirePermissions(['documents:read', 'admin:all']), documentController.downloadDocument);

/**
 * @swagger
 * /api/documents/{id}/send-reminder:
 *   post:
 *     summary: Send reminder to unsigned recipients
 *     tags: [Documents]
 *     description: |
 *       📧 **Send Reminder to Unsigned Recipients**
 *       
 *       **What this endpoint does:**
 *       - Identifies recipients who haven't signed yet using enhanced detection
 *       - Attempts to send reminders via Adobe Sign's API
 *       - Returns success response with pending recipient details
 *       - Gracefully handles Adobe Sign API failures
 *       
 *       **⚠️ IMPORTANT KNOWN ISSUE:**
 *       Adobe Sign's reminder API endpoints currently return 404 "Resource not found" errors. This is an Adobe Sign API issue, not a problem with your system.
 *       
 *       **🎯 RECOMMENDED SOLUTION:**
 *       For 100% reliable reminders, use Adobe Sign's web interface:
 *       1. Go to: https://echosign.adobe.com/
 *       2. Click "Manage" tab
 *       3. Find documents with "Out for Signature" status
 *       4. Click on document → "Send Reminder"
 *       5. Adobe automatically emails all unsigned recipients
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *                 description: Custom reminder message
 *                 example: Please complete your signature for this important document. Your prompt attention is appreciated.
 *     responses:
 *       200:
 *         description: Reminder sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         pendingRecipients:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               email: { type: string }
 *                               status: { type: string }
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Invalid API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Send reminder to recipients who haven't signed yet
router.post('/:id/send-reminder', requirePermissions(['documents:send', 'admin:all']), documentController.sendReminder);

module.exports = router;
