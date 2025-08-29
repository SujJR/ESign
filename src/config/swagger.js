const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'E-Signature API - Simplified API Key Management',
      version: '2.0.0',
      description: `
# E-Signature API with Simplified API Key Management

## 🔑 Authentication
This API uses **API Key authentication exclusively**. All endpoints require a valid API key.

### Getting Started:
1. **Generate Admin Key**: Run \`node generate-api-keys.js\` in your project directory
2. **Use Admin Key**: Use the admin API key to create additional keys for different people/products
3. **Set Headers**: Include your API key in the \`X-API-Key\` header

### Authentication Methods:
- **Header**: \`X-API-Key: your_api_key\`
- **Authorization**: \`Authorization: Bearer your_api_key\`
- **Query**: \`?api_key=your_api_key\`

## 📋 API Key Management (Admin Only)
- **Create**: Generate new API keys for different users/products
- **List**: View all API keys with filtering
- **Update**: Modify key properties and permissions
- **Rotate**: Generate new key value (for security)
- **Delete**: Deactivate unused keys

## 🔐 Security Features
- **Rate Limiting**: Configurable per-key limits
- **IP Restrictions**: Limit access by IP address
- **Expiration**: Set key expiration dates
- **Permissions**: Granular permission system
- **Audit Trail**: Complete usage logging

⚠️ **Important**: Keep your API keys secure and rotate them regularly.
      `,
      contact: {
        name: 'API Support',
        email: 'support@esign-api.com'
      }
    },
    tags: [
      {
        name: 'Health Check',
        description: 'API health and status endpoints'
      },
      {
        name: 'API Keys',
        description: 'API key management operations (Admin only)'
      },
      {
        name: 'Documents',
        description: 'Document management and e-signature operations'
      },
      {
        name: 'Signature Workflow',
        description: 'Document signing workflow management'
      },
      {
        name: 'Transactions',
        description: 'Transaction tracking and management'
      },
      {
        name: 'Webhooks',
        description: 'Webhook integration for real-time updates'
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
          description: 'API Key for authentication. Admin keys can manage other keys.'
        }
      },
      schemas: {
        ApiKey: {
          type: 'object',
          properties: {
            _id: { type: 'string', description: 'Database ID' },
            keyId: { type: 'string', description: 'Unique key identifier' },
            name: { type: 'string', description: 'API key name' },
            description: { type: 'string', description: 'API key description' },
            assignedTo: { type: 'string', description: 'Person or product assigned' },
            environment: { 
              type: 'string', 
              enum: ['development', 'staging', 'production'],
              description: 'Environment the key is for' 
            },
            permissions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of permissions granted to this key'
            },
            scopes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of scopes for this key'
            },
            isActive: { type: 'boolean', description: 'Whether the key is active' },
            usageCount: { type: 'number', description: 'Total number of API calls made' },
            lastUsed: { type: 'string', format: 'date-time', description: 'Last usage timestamp' },
            expiresAt: { type: 'string', format: 'date-time', description: 'Key expiration date' },
            rateLimit: {
              type: 'object',
              properties: {
                requestsPerMinute: { type: 'number', description: 'Requests allowed per minute' },
                requestsPerHour: { type: 'number', description: 'Requests allowed per hour' },
                requestsPerDay: { type: 'number', description: 'Requests allowed per day' }
              }
            },
            allowedIPs: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of allowed IP addresses'
            },
            createdAt: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
            updatedAt: { type: 'string', format: 'date-time', description: 'Last update timestamp' }
          }
        },
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
        },
        UploadForUrlsResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Document uploaded and signing URLs generated successfully (no emails sent)' },
            statusCode: { type: 'number', example: 201 },
            data: {
              type: 'object',
              properties: {
                document: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Document ID' },
                    originalName: { type: 'string', description: 'Original filename' },
                    status: { type: 'string', example: 'prepared_for_signature' },
                    adobeAgreementId: { type: 'string', description: 'Adobe Sign agreement ID' },
                    recipients: { type: 'integer', description: 'Number of recipients' },
                    templateVariablesProcessed: { type: 'integer', description: 'Number of template variables processed' },
                    createdAt: { type: 'string', format: 'date-time' }
                  }
                },
                adobeAgreementId: { type: 'string', description: 'Adobe Sign agreement ID' },
                method: { type: 'string', description: 'Adobe Sign method used', example: 'text-tags' },
                emailNotificationsDisabled: { type: 'boolean', example: true },
                uploadMethod: { type: 'string', description: 'Upload method used', example: 'file_upload' },
                templateVariablesProcessed: { type: 'integer', description: 'Number of template variables processed' },
                signingUrls: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      email: { type: 'string', format: 'email', description: 'Recipient email' },
                      name: { type: 'string', description: 'Recipient name' },
                      title: { type: 'string', description: 'Recipient title' },
                      signingUrl: { type: 'string', format: 'uri', nullable: true, description: 'Adobe Sign signing URL' },
                      status: { type: 'string', description: 'URL generation status', example: 'url_generated' },
                      errorMessage: { type: 'string', nullable: true, description: 'Error message if URL generation failed' }
                    }
                  }
                },
                successfulUrls: { type: 'integer', description: 'Number of successfully generated URLs' },
                totalRecipients: { type: 'integer', description: 'Total number of recipients' }
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
