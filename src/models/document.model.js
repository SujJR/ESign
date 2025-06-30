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
      enum: ['uploaded', 'processing', 'ready_for_signature', 'sent_for_signature', 'out_for_signature', 'partially_signed', 'completed', 'cancelled', 'expired', 'failed', 'signature_error'],
      default: 'uploaded'
    },
    adobeAgreementId: {
      type: String,
      default: null
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null
    },
    recipients: [
      {
        name: { type: String, required: true },
        email: { type: String, required: true },
        order: { type: Number, default: 1 },
        status: { 
          type: String, 
          enum: ['pending', 'sent', 'viewed', 'signed', 'declined', 'expired', 'waiting'],
          default: 'pending'
        },
        signedAt: { type: Date, default: null },
        lastReminderSent: { type: Date, default: null },
        lastSigningUrlAccessed: { type: Date, default: null },
        signatureField: { type: String, default: null },
        title: { type: String, default: null },
        signingUrl: { type: String, default: null }
      }
    ],
    adobeMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    signatureFieldMapping: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    templateData: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    templateVariables: {
      type: [String],
      default: []
    },
    processedFilePath: {
      type: String,
      default: null
    },
    pdfFilePath: {
      type: String,
      default: null
    },
    documentAnalysis: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    autoDetectedSignatureFields: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    lastReminderSent: {
      type: Date,
      default: null
    },
    reminderCount: {
      type: Number,
      default: 0
    },
    signingFlow: {
      type: String,
      enum: ['SEQUENTIAL', 'PARALLEL'],
      default: 'SEQUENTIAL'
    },
    errorMessage: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

const Document = mongoose.model('Document', documentSchema);

module.exports = Document;
