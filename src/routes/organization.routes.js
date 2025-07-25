const express = require('express');
const organizationController = require('../controllers/organization.controller');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// All routes require authentication
router.use(authenticateApiKey);

/**
 * @swagger
 * /api/organizations:
 *   post:
 *     summary: Create a new organization
 *     tags: [Organizations]
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
 *               - contactEmail
 *             properties:
 *               name:
 *                 type: string
 *                 description: Organization name
 *               slug:
 *                 type: string
 *                 description: Unique slug for the organization
 *               type:
 *                 type: string
 *                 enum: [company, partner, client, internal, third_party]
 *               description:
 *                 type: string
 *               contactEmail:
 *                 type: string
 *                 format: email
 *               contactPhone:
 *                 type: string
 *               website:
 *                 type: string
 *               address:
 *                 type: object
 *                 properties:
 *                   street:
 *                     type: string
 *                   city:
 *                     type: string
 *                   state:
 *                     type: string
 *                   zipCode:
 *                     type: string
 *                   country:
 *                     type: string
 *               settings:
 *                 type: object
 *                 properties:
 *                   maxApiKeys:
 *                     type: number
 *                   defaultRateLimit:
 *                     type: object
 *                   allowedFeatures:
 *                     type: array
 *                     items:
 *                       type: string
 *     responses:
 *       201:
 *         description: Organization created successfully
 *       400:
 *         description: Invalid input data
 *       403:
 *         description: Insufficient permissions
 */
router.post('/', requirePermissions('admin:all'), organizationController.createOrganization);

/**
 * @swagger
 * /api/organizations:
 *   get:
 *     summary: Get all organizations
 *     tags: [Organizations]
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
 *         name: type
 *         schema:
 *           type: string
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Organizations retrieved successfully
 */
router.get('/', requirePermissions('admin:all'), organizationController.getOrganizations);

/**
 * @swagger
 * /api/organizations/{id}:
 *   get:
 *     summary: Get organization by ID
 *     tags: [Organizations]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Organization retrieved successfully
 *       404:
 *         description: Organization not found
 */
router.get('/:id', requirePermissions('admin:all'), organizationController.getOrganization);

/**
 * @swagger
 * /api/organizations/{id}:
 *   put:
 *     summary: Update organization
 *     tags: [Organizations]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Organization updated successfully
 *       404:
 *         description: Organization not found
 */
router.put('/:id', requirePermissions('admin:all'), organizationController.updateOrganization);

/**
 * @swagger
 * /api/organizations/{id}:
 *   delete:
 *     summary: Delete organization
 *     tags: [Organizations]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Organization deleted successfully
 *       400:
 *         description: Cannot delete organization with active API keys
 *       404:
 *         description: Organization not found
 */
router.delete('/:id', requirePermissions('admin:all'), organizationController.deleteOrganization);

/**
 * @swagger
 * /api/organizations/{id}/api-keys:
 *   get:
 *     summary: Get organization API keys
 *     tags: [Organizations]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *         name: isActive
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: environment
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API keys retrieved successfully
 */
router.get('/:id/api-keys', requirePermissions('admin:all'), organizationController.getOrganizationApiKeys);

/**
 * @swagger
 * /api/organizations/{id}/usage:
 *   get:
 *     summary: Get organization usage statistics
 *     tags: [Organizations]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Usage statistics retrieved successfully
 */
router.get('/:id/usage', requirePermissions('admin:all'), organizationController.getOrganizationUsage);

module.exports = router;
