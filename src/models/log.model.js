const mongoose = require('mongoose');

const logSchema = new mongoose.Schema(
  {
    level: {
      type: String,
      enum: ['error', 'warn', 'info', 'http', 'debug'],
      required: true
    },
    message: {
      type: String,
      required: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null
    },
    apiKeyId: {
      type: String,
      default: null
    },
    apiKeyName: {
      type: String,
      default: null
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      default: null
    },
    ipAddress: {
      type: String,
      default: null
    },
    userAgent: {
      type: String,
      default: null
    },
    requestPath: {
      type: String,
      default: null
    },
    requestMethod: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Index for faster queries
logSchema.index({ level: 1, createdAt: -1 });
logSchema.index({ userId: 1, createdAt: -1 });
logSchema.index({ organization: 1, createdAt: -1 });
logSchema.index({ apiKeyId: 1, createdAt: -1 });
logSchema.index({ documentId: 1, createdAt: -1 });
logSchema.index({ organization: 1, level: 1, createdAt: -1 });

const Log = mongoose.model('Log', logSchema);

module.exports = Log;
