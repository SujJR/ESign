const mongoose = require('mongoose');
const crypto = require('crypto');

const apiKeySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    keyId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    keyHash: {
      type: String,
      required: true,
      select: false
    },
    prefix: {
      type: String,
      required: true,
      length: 8
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500
    },
    assignedTo: {
      type: String,
      trim: true,
      maxlength: 100,
      description: 'Person or product this key is assigned to'
    },
    environment: {
      type: String,
      enum: ['development', 'staging', 'production'],
      default: 'production'
    },
    isActive: {
      type: Boolean,
      default: true
    },
    permissions: [{
      type: String,
      enum: [
        'documents:read',
        'documents:write',
        'documents:delete',
        'documents:send',
        'documents:status',
        'documents:download',
        'webhooks:receive',
        'logs:read',
        'analytics:read',
        'admin:all'
      ]
    }],
    scopes: [{
      type: String,
      enum: [
        'document_management',
        'signature_workflow',
        'webhook_notifications',
        'reporting',
        'user_management',
        'full_access'
      ]
    }],
    lastUsed: {
      type: Date,
      default: null
    },
    usageCount: {
      type: Number,
      default: 0
    },
    rateLimit: {
      requestsPerMinute: {
        type: Number,
        default: 100
      },
      requestsPerHour: {
        type: Number,
        default: 1000
      },
      requestsPerDay: {
        type: Number,
        default: 10000
      }
    },
    allowedIPs: [{
      type: String,
      validate: {
        validator: function(v) {
          // Allow empty array or valid IP addresses
          return v === '' || /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(v);
        },
        message: 'Invalid IP address format'
      }
    }],
    allowedDomains: [{
      type: String,
      validate: {
        validator: function(v) {
          // Allow empty array or valid domain names
          return v === '' || /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$/.test(v);
        },
        message: 'Invalid domain format'
      }
    }],
    expiresAt: {
      type: Date,
      default: null // null means never expires
    },
    createdBy: {
      type: String,
      required: true,
      default: 'system'
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

// Index for efficient queries
apiKeySchema.index({ keyId: 1, isActive: 1 });
apiKeySchema.index({ environment: 1 });
apiKeySchema.index({ expiresAt: 1 });
apiKeySchema.index({ lastUsed: 1 });
apiKeySchema.index({ assignedTo: 1 });

// Static method to generate a new API key
apiKeySchema.statics.generateApiKey = function(suffix = 'default') {
  // Sanitize suffix to create URL-safe identifier
  const sanitizedSuffix = suffix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')  // Replace non-alphanumeric with hyphens
    .replace(/-+/g, '-')         // Replace multiple hyphens with single
    .replace(/^-|-$/g, '');      // Remove leading/trailing hyphens
  
  // Generate a random API key
  const apiKey = crypto.randomBytes(32).toString('hex');
  const prefix = apiKey.substring(0, 8);
  // Include sanitized suffix in keyId for better identification
  const keyId = `ak_${sanitizedSuffix}_${prefix}`;
  
  return {
    apiKey: `${keyId}_${apiKey}`,
    keyId,
    prefix,
    keyHash: crypto.createHash('sha256').update(apiKey).digest('hex')
  };
};

// Method to verify API key
apiKeySchema.methods.verifyKey = function(providedKey) {
  // Extract the actual key part (after the keyId prefix)
  const keyPart = providedKey.replace(`${this.keyId}_`, '');
  const hash = crypto.createHash('sha256').update(keyPart).digest('hex');
  return hash === this.keyHash;
};

// Method to check if API key is valid
apiKeySchema.methods.isValid = function() {
  if (!this.isActive) return false;
  if (this.expiresAt && this.expiresAt < new Date()) return false;
  return true;
};

// Method to check permissions
apiKeySchema.methods.hasPermission = function(permission) {
  return this.permissions.includes(permission) || this.permissions.includes('admin:all');
};

// Method to check scopes
apiKeySchema.methods.hasScope = function(scope) {
  return this.scopes.includes(scope) || this.scopes.includes('full_access');
};

// Method to update usage statistics
apiKeySchema.methods.updateUsage = async function() {
  this.lastUsed = new Date();
  this.usageCount += 1;
  await this.save();
};

// Pre-save middleware to handle expiration
apiKeySchema.pre('save', function(next) {
  // Auto-deactivate expired keys
  if (this.expiresAt && this.expiresAt < new Date()) {
    this.isActive = false;
  }
  next();
});

const ApiKey = mongoose.model('ApiKey', apiKeySchema);

module.exports = ApiKey;
