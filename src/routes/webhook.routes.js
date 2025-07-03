const express = require('express');
const webhookController = require('../controllers/webhook.controller');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

/**
 * @swagger
 * /api/webhooks/setup:
 *   post:
 *     summary: Setup webhook with Adobe Sign
 *     tags: [Webhooks]
 *     description: |
 *       🔧 **Setup Adobe Sign Webhook**
 *       
 *       Configure Adobe Sign to send events to your application when documents are signed, viewed, or declined.
 *       
 *       **Key Features:**
 *       - Registers your webhook URL with Adobe Sign
 *       - Configures event types to be received (signing, viewing, declining)
 *       - Activates the webhook immediately
 *       
 *       **Important:** Your server must be publicly accessible for webhooks to work. If testing locally, use a service like ngrok to create a secure tunnel.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - webhookUrl
 *             properties:
 *               webhookUrl:
 *                 type: string
 *                 format: uri
 *                 description: The full URL where Adobe Sign should send events (must be publicly accessible)
 *                 example: https://your-domain.com/api/webhooks/adobe-sign
 *     responses:
 *       200:
 *         description: Webhook setup successfully
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
 *                         webhookId:
 *                           type: string
 *                           description: Adobe Sign webhook ID
 *                         webhookUrl:
 *                           type: string
 *                           description: Webhook URL
 *                         events:
 *                           type: array
 *                           items:
 *                             type: string
 *                           description: Subscribed events
 *       400:
 *         description: Bad request - Invalid webhook configuration
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Admin access required
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
// Setup webhook (requires authentication)
router.post('/setup', authenticateApiKey, requirePermissions(['admin:all']), webhookController.setupWebhook);

/**
 * @swagger
 * /api/webhooks/adobe-sign:
 *   post:
 *     summary: Handle Adobe Sign webhook notifications (Test endpoint)
 *     tags: [Webhooks]
 *     description: |
 *       🧪 **Test Webhook Reception**
 *       
 *       Send a simulated Adobe Sign event to test your webhook handling.
 *       
 *       **Key Features:**
 *       - Simulates a document signing event
 *       - Tests your webhook handler's response
 *       - No authentication required (Adobe Sign doesn't authenticate)
 *       
 *       **Note:** This endpoint is for testing only. In production, Adobe Sign will call this endpoint automatically when events occur.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: string
 *                 description: The type of event
 *                 example: AGREEMENT_ACTION_COMPLETED
 *               agreement:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     description: Adobe Sign agreement ID
 *                     example: test-agreement-id
 *                   name:
 *                     type: string
 *                     description: Agreement name
 *                     example: Test Agreement
 *                   status:
 *                     type: string
 *                     description: Agreement status
 *                     example: SIGNED
 *                 description: Information about the signed document
 *               participant:
 *                 type: object
 *                 properties:
 *                   email:
 *                     type: string
 *                     format: email
 *                     description: Participant email
 *                     example: john.smith@example.com
 *                   name:
 *                     type: string
 *                     description: Participant name
 *                     example: Test User
 *                   status:
 *                     type: string
 *                     description: Participant status
 *                     example: SIGNED
 *                 description: Information about the signer
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Webhook processed successfully
 *       400:
 *         description: Bad request - Invalid webhook data
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
// Webhook from Adobe Sign (no authentication - Adobe Sign calls this endpoint)
router.post('/adobe-sign', webhookController.handleAdobeSignWebhook);

module.exports = router;
