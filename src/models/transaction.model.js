const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const transactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true
    },
    adobeAgreementId: {
      type: String,
      required: false,
      default: null
    },
    transactionDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    status: {
      type: String,
      enum: ['initiated', 'sent_for_signature', 'out_for_signature', 'partially_signed', 'completed', 'cancelled', 'expired', 'failed'],
      default: 'initiated'
    },
    participants: [
      {
        name: { type: String, required: true },
        email: { type: String, required: true },
        role: { type: String, enum: ['sender', 'signer', 'approver', 'reviewer'], default: 'signer' },
        order: { type: Number, default: 1 },
        status: { 
          type: String, 
          enum: ['pending', 'sent', 'viewed', 'signed', 'declined', 'expired', 'waiting'],
          default: 'pending'
        },
        signedAt: { type: Date, default: null },
        lastReminderSent: { type: Date, default: null },
        reminderCount: { type: Number, default: 0 },
        signingUrl: { type: String, default: null }
      }
    ],
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    reminderSettings: {
      enabled: { type: Boolean, default: true },
      frequency: { type: String, enum: ['daily', 'weekly', 'custom'], default: 'weekly' },
      maxReminders: { type: Number, default: 3 },
      lastReminderSent: { type: Date, default: null },
      totalRemindersSent: { type: Number, default: 0 }
    },
    deadlines: {
      signatureDeadline: { type: Date, default: null },
      reminderDeadline: { type: Date, default: null }
    },
    notes: {
      type: String,
      default: ''
    },
    tags: [
      {
        type: String,
        trim: true
      }
    ],
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes for better query performance
transactionSchema.index({ documentId: 1 });
transactionSchema.index({ adobeAgreementId: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ 'participants.email': 1 });
transactionSchema.index({ creator: 1 });
transactionSchema.index({ isActive: 1 });

// Virtual for getting active participants
transactionSchema.virtual('activeParticipants').get(function() {
  return this.participants.filter(p => p.status !== 'declined' && p.status !== 'expired');
});

// Instance method to check if transaction is complete
transactionSchema.methods.isComplete = function() {
  return this.status === 'completed' && 
         this.participants.every(p => p.status === 'signed' || p.role !== 'signer');
};

// Instance method to get pending signers
transactionSchema.methods.getPendingSigners = function() {
  return this.participants.filter(p => 
    p.role === 'signer' && 
    ['pending', 'sent', 'viewed'].includes(p.status)
  );
};

// Static method to find by transaction ID
transactionSchema.statics.findByTransactionId = function(transactionId) {
  return this.findOne({ transactionId, isActive: true })
    .populate('documentId')
    .populate('creator', 'name email');
};

// Add pagination plugin
transactionSchema.plugin(mongoosePaginate);

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
