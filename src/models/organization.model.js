const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9-]+$/,
      maxlength: 50
    },
    type: {
      type: String,
      enum: ['company', 'partner', 'client', 'internal', 'third_party'],
      required: true,
      default: 'client'
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500
    },
    contactEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    contactPhone: {
      type: String,
      trim: true
    },
    website: {
      type: String,
      trim: true
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String
    },
    isActive: {
      type: Boolean,
      default: true
    },
    settings: {
      maxApiKeys: {
        type: Number,
        default: 10
      },
      defaultRateLimit: {
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
      allowedFeatures: [{
        type: String,
        enum: [
          'document_upload',
          'document_send',
          'document_status',
          'document_download',
          'webhook_notifications',
          'bulk_operations',
          'advanced_reporting',
          'custom_branding'
        ]
      }],
      webhookUrls: [{
        event: {
          type: String,
          enum: ['document_signed', 'document_viewed', 'document_declined', 'all']
        },
        url: {
          type: String,
          required: true
        },
        isActive: {
          type: Boolean,
          default: true
        }
      }]
    },
    billing: {
      plan: {
        type: String,
        enum: ['free', 'basic', 'premium', 'enterprise'],
        default: 'free'
      },
      monthlyLimit: {
        documents: {
          type: Number,
          default: 10
        },
        recipients: {
          type: Number,
          default: 50
        }
      },
      usage: {
        currentMonth: {
          documents: {
            type: Number,
            default: 0
          },
          recipients: {
            type: Number,
            default: 0
          },
          apiCalls: {
            type: Number,
            default: 0
          }
        },
        resetDate: {
          type: Date,
          default: function() {
            const now = new Date();
            return new Date(now.getFullYear(), now.getMonth() + 1, 1);
          }
        }
      }
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
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

// Indexes for efficient queries
organizationSchema.index({ slug: 1 });
organizationSchema.index({ type: 1, isActive: 1 });
organizationSchema.index({ 'billing.plan': 1 });
organizationSchema.index({ createdAt: 1 });

// Virtual for API key count
organizationSchema.virtual('apiKeyCount', {
  ref: 'ApiKey',
  localField: '_id',
  foreignField: 'organization',
  count: true
});

// Method to check if organization can create more API keys
organizationSchema.methods.canCreateApiKey = function() {
  return this.apiKeyCount < this.settings.maxApiKeys;
};

// Method to check if organization has feature access
organizationSchema.methods.hasFeature = function(feature) {
  return this.settings.allowedFeatures.includes(feature);
};

// Method to check usage limits
organizationSchema.methods.isWithinLimits = function() {
  const { documents, recipients } = this.billing.usage.currentMonth;
  const { monthlyLimit } = this.billing;
  
  return {
    documents: documents < monthlyLimit.documents,
    recipients: recipients < monthlyLimit.recipients,
    canProceed: documents < monthlyLimit.documents && recipients < monthlyLimit.recipients
  };
};

// Method to increment usage
organizationSchema.methods.incrementUsage = async function(type, amount = 1) {
  const now = new Date();
  
  // Check if we need to reset monthly usage
  if (now >= this.billing.usage.resetDate) {
    this.billing.usage.currentMonth = {
      documents: 0,
      recipients: 0,
      apiCalls: 0
    };
    // Set next reset date
    this.billing.usage.resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }
  
  // Increment the specified usage type
  if (this.billing.usage.currentMonth[type] !== undefined) {
    this.billing.usage.currentMonth[type] += amount;
  }
  
  await this.save();
};

// Pre-save middleware to generate slug if not provided
organizationSchema.pre('save', function(next) {
  if (!this.slug && this.name) {
    this.slug = this.name.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }
  next();
});

const Organization = mongoose.model('Organization', organizationSchema);

module.exports = Organization;
