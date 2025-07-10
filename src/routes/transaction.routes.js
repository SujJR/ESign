const express = require('express');
const transactionController = require('../controllers/transaction.controller');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// Apply API key authentication to all routes
router.use(authenticateApiKey);

/**
 * @swagger
 * components:
 *   schemas:
 *     Transaction:
 *       type: object
 *       required:
 *         - transactionId
 *         - documentId
 *       properties:
 *         transactionId:
 *           type: string
 *           description: Unique identifier for the transaction
 *         documentId:
 *           type: string
 *           description: Reference to the document
 *         adobeAgreementId:
 *           type: string
 *           description: Adobe Sign agreement ID
 *         transactionDetails:
 *           type: object
 *           description: Additional transaction details
 *         status:
 *           type: string
 *           enum: [initiated, sent_for_signature, out_for_signature, partially_signed, completed, cancelled, expired, failed]
 *         participants:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [sender, signer, approver, reviewer]
 *               status:
 *                 type: string
 *                 enum: [pending, sent, viewed, signed, declined, expired, waiting]
 *         reminderSettings:
 *           type: object
 *           properties:
 *             enabled:
 *               type: boolean
 *             frequency:
 *               type: string
 *               enum: [daily, weekly, custom]
 *             maxReminders:
 *               type: integer
 *         deadlines:
 *           type: object
 *           properties:
 *             signatureDeadline:
 *               type: string
 *               format: date-time
 *         notes:
 *           type: string
 *         tags:
 *           type: array
 *           items:
 *             type: string
 */

/**
 * @swagger
 * /api/transactions:
 *   post:
 *     summary: Create a new transaction
 *     tags: [Transactions]
 *     description: Create a new transaction record for tracking document signature workflow
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Transaction'
 *           example:
 *             transactionId: "TXN-2025-001"
 *             documentId: "60f1b2b4c8f1234567890abc"
 *             transactionDetails:
 *               type: "contract"
 *               value: 50000
 *               department: "Sales"
 *             participants:
 *               - name: "John Doe"
 *                 email: "john@example.com"
 *                 role: "signer"
 *                 order: 1
 *               - name: "Jane Smith"
 *                 email: "jane@example.com"
 *                 role: "approver"
 *                 order: 2
 *             reminderSettings:
 *               enabled: true
 *               frequency: "weekly"
 *               maxReminders: 3
 *             notes: "Important contract for Q1 2025"
 *             tags: ["contract", "sales", "q1-2025"]
 *     responses:
 *       201:
 *         description: Transaction created successfully
 *       400:
 *         description: Invalid input data
 *       409:
 *         description: Transaction ID already exists
 */
router.post('/', transactionController.createTransaction);

/**
 * @swagger
 * /api/transactions:
 *   get:
 *     summary: Get all transactions with filtering
 *     tags: [Transactions]
 *     description: Retrieve transactions with optional filtering and pagination
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by transaction status
 *       - in: query
 *         name: participantEmail
 *         schema:
 *           type: string
 *         description: Filter by participant email
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Filter by tags (comma-separated)
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
 *         description: Number of items per page
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: createdAt
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Transactions retrieved successfully
 */
router.get('/', transactionController.getTransactions);

/**
 * @swagger
 * /api/transactions/{transactionId}:
 *   get:
 *     summary: Get transaction details by ID
 *     tags: [Transactions]
 *     description: Retrieve detailed information about a specific transaction including current Adobe Sign status
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique transaction identifier
 *         example: "TXN-2025-001"
 *     responses:
 *       200:
 *         description: Transaction details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     transaction:
 *                       $ref: '#/components/schemas/Transaction'
 *                     adobeSignStatus:
 *                       type: object
 *                       description: Current status from Adobe Sign
 *       404:
 *         description: Transaction not found
 */
router.get('/:transactionId', transactionController.getTransactionDetails);

/**
 * @swagger
 * /api/transactions/{transactionId}/status:
 *   get:
 *     summary: Check transaction status
 *     tags: [Transactions]
 *     description: Get the current status of a transaction with real-time Adobe Sign data
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique transaction identifier
 *     responses:
 *       200:
 *         description: Transaction status retrieved successfully
 *       404:
 *         description: Transaction not found
 */
router.get('/:transactionId/status', transactionController.checkTransactionStatus);

/**
 * @swagger
 * /api/transactions/{transactionId}/reminder:
 *   post:
 *     summary: Send reminder for transaction
 *     tags: [Transactions]
 *     description: Send a reminder to participants for pending signatures
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique transaction identifier
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               participantEmail:
 *                 type: string
 *                 description: Email of specific participant (optional, sends to all if not provided)
 *               customMessage:
 *                 type: string
 *                 description: Custom reminder message
 *           example:
 *             participantEmail: "john@example.com"
 *             customMessage: "Please sign the contract by end of week"
 *     responses:
 *       200:
 *         description: Reminder sent successfully
 *       400:
 *         description: Cannot send reminder (disabled, max reached, etc.)
 *       404:
 *         description: Transaction not found
 */
router.post('/:transactionId/reminder', transactionController.sendTransactionReminder);

/**
 * @swagger
 * /api/transactions/{transactionId}/download:
 *   get:
 *     summary: Download signed document
 *     tags: [Transactions]
 *     description: Download the signed document for a completed transaction
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique transaction identifier
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [pdf, original]
 *           default: pdf
 *         description: Download format
 *     responses:
 *       200:
 *         description: Document file
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Document not ready for download
 *       404:
 *         description: Transaction not found
 */
router.get('/:transactionId/download', transactionController.downloadTransactionDocument);

/**
 * @swagger
 * /api/transactions/{transactionId}:
 *   put:
 *     summary: Update transaction details
 *     tags: [Transactions]
 *     description: Update transaction information (excluding core fields like transactionId, documentId)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique transaction identifier
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               transactionDetails:
 *                 type: object
 *               participants:
 *                 type: array
 *                 items:
 *                   type: object
 *               reminderSettings:
 *                 type: object
 *               notes:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *           example:
 *             notes: "Updated contract terms discussed"
 *             tags: ["contract", "sales", "q1-2025", "updated"]
 *             reminderSettings:
 *               maxReminders: 5
 *     responses:
 *       200:
 *         description: Transaction updated successfully
 *       404:
 *         description: Transaction not found
 */
router.put('/:transactionId', transactionController.updateTransaction);

/**
 * @swagger
 * /api/transactions/{transactionId}:
 *   delete:
 *     summary: Delete transaction
 *     tags: [Transactions]
 *     description: Soft delete a transaction (sets isActive to false)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique transaction identifier
 *     responses:
 *       200:
 *         description: Transaction deleted successfully
 *       404:
 *         description: Transaction not found
 */
router.delete('/:transactionId', transactionController.deleteTransaction);

/**
 * @swagger
 * /api/transactions/from-document:
 *   post:
 *     summary: Create transaction from existing document
 *     tags: [Transactions]
 *     description: Create a new transaction based on an existing document record
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentId
 *             properties:
 *               documentId:
 *                 type: string
 *                 description: ID of the existing document
 *               transactionId:
 *                 type: string
 *                 description: Custom transaction ID (auto-generated if not provided)
 *               transactionDetails:
 *                 type: object
 *                 description: Additional transaction details
 *               reminderSettings:
 *                 type: object
 *                 description: Reminder configuration
 *               notes:
 *                 type: string
 *                 description: Transaction notes
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Transaction tags
 *           example:
 *             documentId: "60f1b2b4c8f1234567890abc"
 *             transactionId: "CONTRACT-2025-001"
 *             transactionDetails:
 *               contractType: "Service Agreement"
 *               department: "Sales"
 *             notes: "Converted from existing document"
 *             tags: ["contract", "converted"]
 *     responses:
 *       201:
 *         description: Transaction created successfully from document
 *       400:
 *         description: Invalid input or document not found
 */
router.post('/from-document', transactionController.createTransactionFromDocument);

/**
 * @swagger
 * /api/transactions/bulk/reminders:
 *   post:
 *     summary: Send bulk reminders
 *     tags: [Transactions]
 *     description: Send reminders for multiple transactions at once
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionIds
 *             properties:
 *               transactionIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of transaction IDs
 *               customMessage:
 *                 type: string
 *                 description: Custom reminder message
 *           example:
 *             transactionIds: ["TXN-001", "TXN-002", "TXN-003"]
 *             customMessage: "Please complete your signature by end of week"
 *     responses:
 *       200:
 *         description: Bulk reminders sent with results
 */
router.post('/bulk/reminders', transactionController.bulkSendReminders);

/**
 * @swagger
 * /api/transactions/bulk/sync-adobe:
 *   post:
 *     summary: Bulk sync with Adobe Sign
 *     tags: [Transactions]
 *     description: Update multiple transaction statuses from Adobe Sign
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionIds
 *             properties:
 *               transactionIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of transaction IDs to sync
 *           example:
 *             transactionIds: ["TXN-001", "TXN-002", "TXN-003"]
 *     responses:
 *       200:
 *         description: Bulk sync completed with results
 */
router.post('/bulk/sync-adobe', transactionController.bulkUpdateFromAdobe);

/**
 * @swagger
 * /api/transactions/analytics:
 *   get:
 *     summary: Get transaction analytics
 *     tags: [Transactions]
 *     description: Retrieve analytics and statistics for transactions
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for analytics range
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for analytics range
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by transaction status
 *       - in: query
 *         name: creatorId
 *         schema:
 *           type: string
 *         description: Filter by creator ID
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalTransactions:
 *                           type: integer
 *                         completedTransactions:
 *                           type: integer
 *                         pendingTransactions:
 *                           type: integer
 *                         averageCompletionTime:
 *                           type: number
 *                     statusBreakdown:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           count:
 *                             type: integer
 */
router.get('/analytics', transactionController.getTransactionAnalytics);

module.exports = router;
