const express = require('express');
const apiKeyController = require('../controllers/apiKey.controller');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// All routes require admin permissions
router.use(authenticateApiKey);
router.use(requirePermissions('admin:all'));

/**
 * @swagger
 * /api/auth/api-keys:
 *   post:
 *     summary: Create new API key (Admin only)
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: API key name
 *               description:
 *                 type: string
 *                 description: API key description
 *               assignedTo:
 *                 type: string
 *                 description: Person or product this key is assigned to
 *               environment:
 *                 type: string
 *                 enum: [development, staging, production]
 *                 default: production
 *               permissions:
 *                 type: array
 *                 items:
 *                   type: string
 *               expiresIn:
 *                 type: string
 *                 description: Expiration time (e.g., "30d", "1y", "6m")
 *     responses:
 *       201:
 *         description: API key created successfully
 */
router.post('/', apiKeyController.createApiKey);

/**
 * @swagger
 * /api/auth/api-keys:
 *   get:
 *     summary: Get all API keys (Admin only)
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: assignedTo
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API keys retrieved successfully
 */
router.get('/', apiKeyController.getApiKeys);

/**
 * @swagger
 * /api/auth/api-keys/{keyId}:
 *   get:
 *     summary: Get API key details (Admin only)
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: keyId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API key details retrieved successfully
 */
router.get('/:keyId', apiKeyController.getApiKey);

/**
 * @swagger
 * /api/auth/api-keys/{keyId}:
 *   put:
 *     summary: Update API key (Admin only)
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: keyId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               assignedTo:
 *                 type: string
 *               permissions:
 *                 type: array
 *                 items:
 *                   type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: API key updated successfully
 */
router.put('/:keyId', apiKeyController.updateApiKey);

/**
 * @swagger
 * /api/auth/api-keys/{keyId}:
 *   delete:
 *     summary: Delete API key (Admin only)
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: keyId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API key deleted successfully
 */
router.delete('/:keyId', apiKeyController.deleteApiKey);

/**
 * @swagger
 * /api/auth/api-keys/{keyId}/rotate:
 *   post:
 *     summary: Rotate API key (Admin only)
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: keyId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API key rotated successfully
 */
router.post('/:keyId/rotate', apiKeyController.rotateApiKey);

/**
 * @swagger
 * /api/auth/api-keys/{keyId}/stats:
 *   get:
 *     summary: Get API key statistics (Admin only)
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: keyId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API key statistics retrieved successfully
 */
router.get('/:keyId/stats', apiKeyController.getApiKeyStats);

module.exports = router;
