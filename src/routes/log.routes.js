const express = require('express');
const logController = require('../controllers/log.controller');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// Apply API key authentication to all routes
router.use(authenticateApiKey);

/**
 * @swagger
 * /api/logs:
 *   get:
 *     summary: Get logs with pagination and filtering
 *     tags: [Logs]
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
 *           default: 50
 *         description: Number of logs per page
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *           enum: [error, warn, info, debug]
 *         description: Filter by log level
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action type
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for log filtering (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for log filtering (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Logs retrieved successfully
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
 *                         logs:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string }
 *                               level: { type: string }
 *                               message: { type: string }
 *                               action: { type: string }
 *                               userId: { type: string }
 *                               documentId: { type: string }
 *                               timestamp: { type: string, format: date-time }
 *                               metadata: { type: object }
 *                         pagination:
 *                           type: object
 *                           properties:
 *                             page: { type: integer }
 *                             limit: { type: integer }
 *                             total: { type: integer }
 *                             pages: { type: integer }
 *       401:
 *         description: Unauthorized - Invalid API key or insufficient permissions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get logs with pagination and filtering
router.get('/', requirePermissions(['logs:read', 'admin:all']), logController.getLogs);

/**
 * @swagger
 * /api/logs/summary:
 *   get:
 *     summary: Get logs summary statistics
 *     tags: [Logs]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [today, week, month, year]
 *           default: today
 *         description: Time period for summary
 *     responses:
 *       200:
 *         description: Logs summary retrieved successfully
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
 *                         totalLogs: { type: number }
 *                         errorCount: { type: number }
 *                         warningCount: { type: number }
 *                         infoCount: { type: number }
 *                         debugCount: { type: number }
 *                         topActions:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               action: { type: string }
 *                               count: { type: number }
 *                         period: { type: string }
 *       401:
 *         description: Unauthorized - Invalid API key or insufficient permissions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get logs summary
router.get('/summary', requirePermissions(['logs:read', 'admin:all']), logController.getLogsSummary);

module.exports = router;
