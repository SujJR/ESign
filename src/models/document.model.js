const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    filename: {
      type: String,
      required: true,
      trim: true
    },
    originalName: {
      type: String,
      required: true,
      trim: true
    },
    fileSize: {
      type: Number,
      required: true
    },
    filePath: {
      type: String,
      required: true
    },
    mimeType: {
      type: String,
      required: true
    },
    pageCount: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['uploaded', 'processing', 'ready_for_signature', 'sent_for_signature', 'completed', 'cancelled', 'expired', 'failed'],
      default: 'uploaded'
    },
    adobeAgreementId: {
      type: String,
      default: null
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    recipients: [
      {
        name: { type: String, required: true },
        email: { type: String, required: true },
        order: { type: Number, default: 1 },
        status: { 
          type: String, 
          enum: ['pending', 'sent', 'viewed', 'signed', 'declined', 'expired'],
          default: 'pending'
        },
        signedAt: { type: Date, default: null }
      }
    ],
    adobeMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    useIntelligentPositioning: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

const Document = mongoose.model('Document', documentSchema);

module.exports = Document;
