const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'E-Signature API - Complete Collection with Enhanced Workflow',
      description: 'Run node generate-api-keys.js and authorize the X-API-Key header to access the API.',
    },
    tags: [
      {
        name: 'Health Check',
        description: 'API health and status endpoints'
      },
      {
        name: 'Documents',
        description: 'Document management operations'
      },
      {
        name: 'Adobe Sign',
        description: 'Adobe Sign integration operations'
      }
    ],
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API Key for authentication - manually authorized'
        }
      },
      schemas: {
        Document: {
          type: 'object',
          properties: {
            _id: { type: 'string', description: 'Document ID' },
            title: { type: 'string', description: 'Document title' },
            filename: { type: 'string', description: 'Original filename' },
            filePath: { type: 'string', description: 'Path to stored file' },
            mimeType: { type: 'string', description: 'Document MIME type' },
            size: { type: 'number', description: 'File size in bytes' },
            status: { 
              type: 'string', 
              enum: ['draft', 'in_progress', 'signed', 'cancelled', 'expired'],
              description: 'Document signing status' 
            },
            adobeSignId: { type: 'string', description: 'Adobe Sign agreement ID' },
            createdBy: { type: 'string', description: 'User ID who created the document' },
            recipients: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Recipient name' },
                  email: { type: 'string', format: 'email', description: 'Recipient email' },
                  title: { type: 'string', description: 'Recipient title/role' },
                  status: { 
                    type: 'string', 
                    enum: ['waiting_for_signature', 'signed', 'declined', 'cancelled'],
                    description: 'Recipient signing status' 
                  },
                  signedAt: { type: 'string', format: 'date-time', description: 'Signature timestamp' },
                  signingUrl: { type: 'string', description: 'URL for signing' }
                }
              }
            },
            templateData: {
              type: 'object',
              description: 'Template data for document processing',
              additionalProperties: true
            },
            createdAt: { type: 'string', format: 'date-time', description: 'Document creation timestamp' },
            updatedAt: { type: 'string', format: 'date-time', description: 'Document last update timestamp' }
          }
        },
        ApiResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', description: 'Operation success status' },
            message: { type: 'string', description: 'Response message' },
            data: { type: 'object', description: 'Response data' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', description: 'Error message' },
            error: { type: 'string', description: 'Error details' },
            statusCode: { type: 'number', description: 'HTTP status code' }
          }
        },
        UploadResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Document uploaded and sent successfully' },
            data: {
              type: 'object',
              properties: {
                document: { $ref: '#/components/schemas/Document' },
                method: { type: 'string', description: 'Adobe Sign method used' },
                uploadMethod: { type: 'string', description: 'Upload method used' },
                templateVariablesProcessed: { type: 'boolean', description: 'Whether template variables were processed' }
              }
            }
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'API key is missing or invalid',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: false },
                  message: { type: 'string', example: 'Unauthorized - Invalid or missing API key' },
                  statusCode: { type: 'number', example: 401 }
                }
              }
            }
          }
        }
      }
    },
    security: [
      {
        ApiKeyAuth: []
      }
    ]
  },
  apis: [
    './src/routes/*.js',
    './src/controllers/*.js'
  ]
};

const specs = swaggerJSDoc(options);

module.exports = {
  specs,
  swaggerUi,
  swaggerServe: swaggerUi.serve,
  swaggerSetup: swaggerUi.setup(specs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'E-Sign API Documentation'
  })
};
