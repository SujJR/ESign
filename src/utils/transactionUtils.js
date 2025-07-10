const Transaction = require('../models/transaction.model');
const Document = require('../models/document.model');
const logger = require('./logger');

/**
 * Create a transaction from an existing document
 * @param {string} documentId - The document ID
 * @param {string} customTransactionId - Optional custom transaction ID
 * @param {Object} additionalData - Additional transaction data
 * @returns {Promise<Object>} Created transaction
 */
const createTransactionFromDocument = async (documentId, customTransactionId = null, additionalData = {}) => {
  try {
    // Find the document
    const document = await Document.findById(documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    // Generate transaction ID if not provided
    const transactionId = customTransactionId || `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Check if transaction already exists
    const existingTransaction = await Transaction.findOne({ transactionId });
    if (existingTransaction) {
      throw new Error('Transaction ID already exists');
    }

    // Map document recipients to transaction participants
    const participants = document.recipients.map(recipient => ({
      name: recipient.name,
      email: recipient.email,
      role: 'signer',
      order: recipient.order || 1,
      status: recipient.status || 'pending',
      signedAt: recipient.signedAt,
      lastReminderSent: recipient.lastReminderSent,
      reminderCount: 0,
      signingUrl: recipient.signingUrl
    }));

    // Create transaction data
    const transactionData = {
      transactionId,
      documentId: document._id,
      adobeAgreementId: document.adobeAgreementId,
      status: mapDocumentStatusToTransactionStatus(document.status),
      participants,
      transactionDetails: {
        originalFilename: document.originalName,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        pageCount: document.pageCount,
        templateData: document.templateData,
        createdFromDocument: true,
        ...additionalData.transactionDetails
      },
      creator: document.creator,
      metadata: {
        documentAnalysis: document.documentAnalysis,
        signatureFieldMapping: document.signatureFieldMapping,
        ...additionalData.metadata
      },
      reminderSettings: {
        enabled: true,
        frequency: 'weekly',
        maxReminders: 3,
        totalRemindersSent: document.reminderCount || 0,
        lastReminderSent: document.lastReminderSent,
        ...additionalData.reminderSettings
      },
      notes: additionalData.notes || '',
      tags: additionalData.tags || []
    };

    // Create the transaction
    const transaction = new Transaction(transactionData);
    await transaction.save();

    logger.info(`Transaction ${transactionId} created from document ${documentId}`);

    return await Transaction.findByTransactionId(transactionId);
  } catch (error) {
    logger.error('Error creating transaction from document:', error);
    throw error;
  }
};

/**
 * Map document status to transaction status
 * @param {string} documentStatus - Document status
 * @returns {string} Transaction status
 */
const mapDocumentStatusToTransactionStatus = (documentStatus) => {
  const statusMap = {
    'uploaded': 'initiated',
    'processing': 'initiated',
    'ready_for_signature': 'initiated',
    'sent_for_signature': 'sent_for_signature',
    'sent': 'sent_for_signature',
    'out_for_signature': 'out_for_signature',
    'partially_signed': 'partially_signed',
    'completed': 'completed',
    'cancelled': 'cancelled',
    'expired': 'expired',
    'failed': 'failed',
    'signature_error': 'failed'
  };

  return statusMap[documentStatus] || 'initiated';
};

/**
 * Update transaction status based on Adobe Sign agreement status
 * @param {string} transactionId - Transaction ID
 * @param {Object} adobeStatus - Adobe Sign status object
 * @returns {Promise<Object>} Updated transaction
 */
const updateTransactionStatusFromAdobe = async (transactionId, adobeStatus) => {
  try {
    const transaction = await Transaction.findByTransactionId(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Update transaction status
    if (adobeStatus.status) {
      const newStatus = mapAdobeStatusToTransactionStatus(adobeStatus.status);
      if (newStatus !== transaction.status) {
        transaction.status = newStatus;
        logger.info(`Transaction ${transactionId} status updated from ${transaction.status} to ${newStatus}`);
      }
    }

    // Update participant statuses if available
    if (adobeStatus.participantSets && Array.isArray(adobeStatus.participantSets)) {
      adobeStatus.participantSets.forEach(participantSet => {
        if (participantSet.memberInfos && Array.isArray(participantSet.memberInfos)) {
          participantSet.memberInfos.forEach(memberInfo => {
            const participant = transaction.participants.find(p => p.email === memberInfo.email);
            if (participant && memberInfo.status) {
              const newParticipantStatus = mapAdobeParticipantStatusToTransactionStatus(memberInfo.status);
              if (newParticipantStatus !== participant.status) {
                participant.status = newParticipantStatus;
                if (newParticipantStatus === 'signed' && memberInfo.signedDate) {
                  participant.signedAt = new Date(memberInfo.signedDate);
                }
              }
            }
          });
        }
      });
    }

    await transaction.save();
    return transaction;
  } catch (error) {
    logger.error('Error updating transaction status from Adobe:', error);
    throw error;
  }
};

/**
 * Map Adobe Sign status to transaction status
 * @param {string} adobeStatus - Adobe Sign status
 * @returns {string} Transaction status
 */
const mapAdobeStatusToTransactionStatus = (adobeStatus) => {
  const statusMap = {
    'OUT_FOR_SIGNATURE': 'out_for_signature',
    'WAITING_FOR_MY_SIGNATURE': 'out_for_signature',
    'WAITING_FOR_COUNTER_SIGNATURE': 'partially_signed',
    'SIGNED': 'completed',
    'APPROVED': 'completed',
    'DELIVERED': 'completed',
    'CANCELLED': 'cancelled',
    'DECLINED': 'cancelled',
    'EXPIRED': 'expired',
    'PREFILL': 'initiated',
    'AUTHORING': 'initiated'
  };

  return statusMap[adobeStatus] || 'initiated';
};

/**
 * Map Adobe Sign participant status to transaction participant status
 * @param {string} adobeParticipantStatus - Adobe Sign participant status
 * @returns {string} Transaction participant status
 */
const mapAdobeParticipantStatusToTransactionStatus = (adobeParticipantStatus) => {
  const statusMap = {
    'WAITING_FOR_MY_SIGNATURE': 'sent',
    'WAITING_FOR_COUNTER_SIGNATURE': 'signed',
    'SIGNED': 'signed',
    'DECLINED': 'declined',
    'EXPIRED': 'expired',
    'NOT_YET_VISIBLE': 'waiting'
  };

  return statusMap[adobeParticipantStatus] || 'pending';
};

/**
 * Generate a unique transaction ID
 * @param {string} prefix - Optional prefix for the transaction ID
 * @returns {string} Unique transaction ID
 */
const generateTransactionId = (prefix = 'TXN') => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

/**
 * Get transaction analytics/statistics
 * @param {Object} filters - Optional filters
 * @returns {Promise<Object>} Transaction statistics
 */
const getTransactionAnalytics = async (filters = {}) => {
  try {
    const matchStage = { isActive: true, ...filters };

    const analytics = await Transaction.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          completedTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          pendingTransactions: {
            $sum: { $cond: [{ $in: ['$status', ['initiated', 'sent_for_signature', 'out_for_signature']] }, 1, 0] }
          },
          expiredTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] }
          },
          cancelledTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          },
          averageCompletionTime: {
            $avg: {
              $cond: [
                { $eq: ['$status', 'completed'] },
                { $subtract: ['$updatedAt', '$createdAt'] },
                null
              ]
            }
          }
        }
      }
    ]);

    const statusBreakdown = await Transaction.aggregate([
      { $match: matchStage },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    return {
      summary: analytics[0] || {
        totalTransactions: 0,
        completedTransactions: 0,
        pendingTransactions: 0,
        expiredTransactions: 0,
        cancelledTransactions: 0,
        averageCompletionTime: 0
      },
      statusBreakdown
    };
  } catch (error) {
    logger.error('Error getting transaction analytics:', error);
    throw error;
  }
};

module.exports = {
  createTransactionFromDocument,
  updateTransactionStatusFromAdobe,
  mapDocumentStatusToTransactionStatus,
  mapAdobeStatusToTransactionStatus,
  mapAdobeParticipantStatusToTransactionStatus,
  generateTransactionId,
  getTransactionAnalytics
};
