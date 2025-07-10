const Transaction = require('../models/transaction.model');
const Document = require('../models/document.model');
const Log = require('../models/log.model');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');

// Import Adobe Sign functions
const { 
  getAccessToken, 
  getAgreementInfo, 
  getComprehensiveAgreementInfo,
  getActualSigningStatus,
  sendReminder, 
  downloadSignedDocument,
  getSigningUrl
} = require('../config/adobeSign');

const fs = require('fs');
const path = require('path');

// Import transaction utilities
const transactionUtils = require('../utils/transactionUtils');

/**
 * Create a new transaction
 */
const createTransaction = async (req, res) => {
  try {
    const { transactionId, documentId, transactionDetails, participants, metadata, reminderSettings, deadlines, notes, tags } = req.body;

    // Validate required fields
    if (!transactionId || !documentId) {
      return res.status(400).json(formatResponse(false, 'Transaction ID and Document ID are required', null));
    }

    // Check if transaction ID already exists
    const existingTransaction = await Transaction.findOne({ transactionId });
    if (existingTransaction) {
      return res.status(400).json(formatResponse(false, 'Transaction ID already exists', null));
    }

    // Verify document exists
    const document = await Document.findById(documentId);
    if (!document) {
      return res.status(404).json(formatResponse(false, 'Document not found', null));
    }

    // Create transaction
    const transaction = new Transaction({
      transactionId,
      documentId,
      adobeAgreementId: document.adobeAgreementId,
      transactionDetails: transactionDetails || {},
      participants: participants || [],
      creator: req.user?.id,
      metadata: metadata || {},
      reminderSettings: reminderSettings || {},
      deadlines: deadlines || {},
      notes: notes || '',
      tags: tags || []
    });

    await transaction.save();

    // Log transaction creation
    await Log.create({
      action: 'transaction_created',
      documentId: documentId,
      transactionId: transactionId,
      details: { transactionId, documentId },
      userId: req.user?.id
    });

    logger.info(`Transaction created: ${transactionId} for document: ${documentId}`);

    const populatedTransaction = await Transaction.findById(transaction._id)
      .populate('documentId')
      .populate('creator', 'name email');

    res.status(201).json(formatResponse(true, 'Transaction created successfully', populatedTransaction));
  } catch (error) {
    logger.error('Error creating transaction:', error);
    res.status(500).json(formatResponse(false, 'Failed to create transaction', null, error.message));
  }
};

/**
 * Create transaction from existing document
 */
const createTransactionFromDocument = async (req, res) => {
  try {
    const { documentId, transactionId, transactionDetails, reminderSettings, notes, tags } = req.body;

    if (!documentId) {
      return res.status(400).json(formatResponse(false, 'Document ID is required', null));
    }

    const additionalData = {
      transactionDetails: transactionDetails || {},
      reminderSettings: reminderSettings || {},
      notes: notes || '',
      tags: tags || []
    };

    const transaction = await transactionUtils.createTransactionFromDocument(
      documentId, 
      transactionId, 
      additionalData
    );

    // Log transaction creation
    await Log.create({
      action: 'transaction_created_from_document',
      documentId: documentId,
      transactionId: transaction.transactionId,
      details: { documentId, transactionId: transaction.transactionId },
      userId: req.user?.id
    });

    logger.info(`Transaction ${transaction.transactionId} created from document ${documentId}`);

    res.status(201).json(formatResponse(true, 'Transaction created from document successfully', transaction));
  } catch (error) {
    logger.error('Error creating transaction from document:', error);
    res.status(500).json(formatResponse(false, 'Failed to create transaction from document', null, error.message));
  }
};

/**
 * Get transaction details by transaction ID
 */
const getTransactionDetails = async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await Transaction.findByTransactionId(transactionId);
    if (!transaction) {
      return res.status(404).json(formatResponse(false, 'Transaction not found', null));
    }

    // Get fresh Adobe Sign status if agreement exists
    let adobeStatus = null;
    if (transaction.adobeAgreementId) {
      try {
        const accessToken = await getAccessToken();
        adobeStatus = await getComprehensiveAgreementInfo(accessToken, transaction.adobeAgreementId);
        
        // Update transaction status based on Adobe Sign status
        if (adobeStatus && adobeStatus.status) {
          transaction.status = adobeStatus.status.toLowerCase().replace(/_/g, '_');
          await transaction.save();
        }
      } catch (adobeError) {
        logger.warn(`Failed to get Adobe Sign status for transaction ${transactionId}:`, adobeError.message);
      }
    }

    // Log transaction view
    await Log.create({
      action: 'transaction_viewed',
      documentId: transaction.documentId._id,
      transactionId: transactionId,
      details: { transactionId },
      userId: req.user?.id
    });

    const response = {
      transaction,
      adobeSignStatus: adobeStatus
    };

    res.json(formatResponse(true, 'Transaction details retrieved successfully', response));
  } catch (error) {
    logger.error('Error getting transaction details:', error);
    res.status(500).json(formatResponse(false, 'Failed to get transaction details', null, error.message));
  }
};

/**
 * Get all transactions with optional filtering
 */
const getTransactions = async (req, res) => {
  try {
    const { 
      status, 
      page = 1, 
      limit = 10, 
      sortBy = 'createdAt', 
      sortOrder = 'desc',
      participantEmail,
      tags 
    } = req.query;

    const filter = { isActive: true };
    
    // Add filters
    if (status) filter.status = status;
    if (participantEmail) filter['participants.email'] = { $regex: participantEmail, $options: 'i' };
    if (tags) filter.tags = { $in: tags.split(',') };
    if (req.user?.id) filter.creator = req.user.id;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 },
      populate: [
        { path: 'documentId', select: 'filename originalName status' },
        { path: 'creator', select: 'name email' }
      ]
    };

    const transactions = await Transaction.paginate(filter, options);

    res.json(formatResponse(true, 'Transactions retrieved successfully', transactions));
  } catch (error) {
    logger.error('Error getting transactions:', error);
    res.status(500).json(formatResponse(false, 'Failed to get transactions', null, error.message));
  }
};

/**
 * Send reminder for a transaction
 */
const sendTransactionReminder = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { participantEmail, customMessage } = req.body;

    const transaction = await Transaction.findByTransactionId(transactionId);
    if (!transaction) {
      return res.status(404).json(formatResponse(false, 'Transaction not found', null));
    }

    if (!transaction.adobeAgreementId) {
      return res.status(400).json(formatResponse(false, 'No Adobe Sign agreement found for this transaction', null));
    }

    // Check reminder settings
    if (!transaction.reminderSettings.enabled) {
      return res.status(400).json(formatResponse(false, 'Reminders are disabled for this transaction', null));
    }

    if (transaction.reminderSettings.totalRemindersSent >= transaction.reminderSettings.maxReminders) {
      return res.status(400).json(formatResponse(false, 'Maximum number of reminders already sent', null));
    }

    try {
      const accessToken = await getAccessToken();
      const reminderResult = await sendReminder(accessToken, transaction.adobeAgreementId, participantEmail, customMessage);

      // Update reminder tracking
      transaction.reminderSettings.lastReminderSent = new Date();
      transaction.reminderSettings.totalRemindersSent += 1;

      // Update participant reminder tracking
      if (participantEmail) {
        const participant = transaction.participants.find(p => p.email === participantEmail);
        if (participant) {
          participant.lastReminderSent = new Date();
          participant.reminderCount += 1;
        }
      }

      await transaction.save();

      // Log reminder
      await Log.create({
        action: 'reminder_sent',
        documentId: transaction.documentId._id,
        transactionId: transactionId,
        details: { 
          participantEmail, 
          reminderCount: transaction.reminderSettings.totalRemindersSent,
          customMessage: customMessage || null
        },
        userId: req.user?.id
      });

      logger.info(`Reminder sent for transaction ${transactionId} to ${participantEmail || 'all participants'}`);

      res.json(formatResponse(true, 'Reminder sent successfully', {
        transactionId,
        participantEmail,
        totalRemindersSent: transaction.reminderSettings.totalRemindersSent,
        reminderResult
      }));
    } catch (adobeError) {
      logger.error(`Adobe Sign reminder failed for transaction ${transactionId}:`, adobeError);
      res.status(500).json(formatResponse(false, 'Failed to send reminder through Adobe Sign', null, adobeError.message));
    }
  } catch (error) {
    logger.error('Error sending transaction reminder:', error);
    res.status(500).json(formatResponse(false, 'Failed to send reminder', null, error.message));
  }
};

/**
 * Bulk send reminders for multiple transactions
 */
const bulkSendReminders = async (req, res) => {
  try {
    const { transactionIds, customMessage } = req.body;

    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json(formatResponse(false, 'Transaction IDs array is required', null));
    }

    const results = [];
    const errors = [];

    for (const transactionId of transactionIds) {
      try {
        const transaction = await Transaction.findByTransactionId(transactionId);
        if (!transaction) {
          errors.push({ transactionId, error: 'Transaction not found' });
          continue;
        }

        if (!transaction.adobeAgreementId) {
          errors.push({ transactionId, error: 'No Adobe Sign agreement found' });
          continue;
        }

        if (!transaction.reminderSettings.enabled) {
          errors.push({ transactionId, error: 'Reminders disabled' });
          continue;
        }

        if (transaction.reminderSettings.totalRemindersSent >= transaction.reminderSettings.maxReminders) {
          errors.push({ transactionId, error: 'Maximum reminders reached' });
          continue;
        }

        const accessToken = await getAccessToken();
        await sendReminder(accessToken, transaction.adobeAgreementId, null, customMessage);

        // Update reminder tracking
        transaction.reminderSettings.lastReminderSent = new Date();
        transaction.reminderSettings.totalRemindersSent += 1;
        await transaction.save();

        results.push({ transactionId, success: true });

        // Log reminder
        await Log.create({
          action: 'bulk_reminder_sent',
          documentId: transaction.documentId._id,
          transactionId: transactionId,
          details: { transactionId, customMessage: customMessage || null },
          userId: req.user?.id
        });
      } catch (error) {
        errors.push({ transactionId, error: error.message });
      }
    }

    logger.info(`Bulk reminders sent: ${results.length} successful, ${errors.length} failed`);

    res.json(formatResponse(true, 'Bulk reminder operation completed', {
      successful: results,
      failed: errors,
      summary: {
        total: transactionIds.length,
        successful: results.length,
        failed: errors.length
      }
    }));
  } catch (error) {
    logger.error('Error sending bulk reminders:', error);
    res.status(500).json(formatResponse(false, 'Failed to send bulk reminders', null, error.message));
  }
};

/**
 * Check transaction status
 */
const checkTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await Transaction.findByTransactionId(transactionId);
    if (!transaction) {
      return res.status(404).json(formatResponse(false, 'Transaction not found', null));
    }

    let statusInfo = {
      transactionId,
      currentStatus: transaction.status,
      lastUpdated: transaction.updatedAt,
      participants: transaction.participants.map(p => ({
        name: p.name,
        email: p.email,
        status: p.status,
        signedAt: p.signedAt,
        lastReminderSent: p.lastReminderSent
      }))
    };

    // Get fresh status from Adobe Sign if agreement exists
    if (transaction.adobeAgreementId) {
      try {
        const accessToken = await getAccessToken();
        const adobeStatus = await getActualSigningStatus(accessToken, transaction.adobeAgreementId);
        
        statusInfo.adobeSignStatus = adobeStatus;
        
        // Update local status if different
        if (adobeStatus.status && adobeStatus.status !== transaction.status) {
          transaction.status = adobeStatus.status;
          await transaction.save();
          statusInfo.currentStatus = adobeStatus.status;
          statusInfo.statusUpdated = true;
        }
      } catch (adobeError) {
        logger.warn(`Failed to get Adobe Sign status for transaction ${transactionId}:`, adobeError.message);
        statusInfo.adobeSignError = adobeError.message;
      }
    }

    // Log status check
    await Log.create({
      action: 'status_checked',
      documentId: transaction.documentId._id,
      transactionId: transactionId,
      details: { transactionId, status: statusInfo.currentStatus },
      userId: req.user?.id
    });

    res.json(formatResponse(true, 'Transaction status retrieved successfully', statusInfo));
  } catch (error) {
    logger.error('Error checking transaction status:', error);
    res.status(500).json(formatResponse(false, 'Failed to check transaction status', null, error.message));
  }
};

/**
 * Download signed document for a transaction
 */
const downloadTransactionDocument = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { format = 'pdf' } = req.query;

    const transaction = await Transaction.findByTransactionId(transactionId);
    if (!transaction) {
      return res.status(404).json(formatResponse(false, 'Transaction not found', null));
    }

    if (!transaction.adobeAgreementId) {
      return res.status(400).json(formatResponse(false, 'No Adobe Sign agreement found for this transaction', null));
    }

    // Check if document is ready for download
    if (!['completed', 'signed'].includes(transaction.status.toLowerCase())) {
      return res.status(400).json(formatResponse(false, 'Document is not yet signed and ready for download', null));
    }

    try {
      const accessToken = await getAccessToken();
      const downloadResult = await downloadSignedDocument(accessToken, transaction.adobeAgreementId, format);

      if (!downloadResult || !downloadResult.filePath) {
        return res.status(500).json(formatResponse(false, 'Failed to download signed document', null));
      }

      // Log download
      await Log.create({
        action: 'document_downloaded',
        documentId: transaction.documentId._id,
        transactionId: transactionId,
        details: { transactionId, format, downloadPath: downloadResult.filePath },
        userId: req.user?.id
      });

      // Set appropriate headers for file download
      const filename = `${transaction.transactionId}_signed.${format}`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/octet-stream');

      // Stream the file
      const fileStream = fs.createReadStream(downloadResult.filePath);
      fileStream.pipe(res);

      logger.info(`Document downloaded for transaction ${transactionId} in ${format} format`);
    } catch (adobeError) {
      logger.error(`Adobe Sign download failed for transaction ${transactionId}:`, adobeError);
      res.status(500).json(formatResponse(false, 'Failed to download document from Adobe Sign', null, adobeError.message));
    }
  } catch (error) {
    logger.error('Error downloading transaction document:', error);
    res.status(500).json(formatResponse(false, 'Failed to download document', null, error.message));
  }
};

/**
 * Update transaction details
 */
const updateTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const updates = req.body;

    const transaction = await Transaction.findByTransactionId(transactionId);
    if (!transaction) {
      return res.status(404).json(formatResponse(false, 'Transaction not found', null));
    }

    // Prevent updating certain fields
    const restrictedFields = ['transactionId', 'documentId', 'adobeAgreementId', 'creator'];
    restrictedFields.forEach(field => delete updates[field]);

    // Update transaction
    Object.assign(transaction, updates);
    await transaction.save();

    // Log update
    await Log.create({
      action: 'transaction_updated',
      documentId: transaction.documentId._id,
      transactionId: transactionId,
      details: { transactionId, updates: Object.keys(updates) },
      userId: req.user?.id
    });

    const updatedTransaction = await Transaction.findByTransactionId(transactionId);

    res.json(formatResponse(true, 'Transaction updated successfully', updatedTransaction));
  } catch (error) {
    logger.error('Error updating transaction:', error);
    res.status(500).json(formatResponse(false, 'Failed to update transaction', null, error.message));
  }
};

/**
 * Delete (deactivate) a transaction
 */
const deleteTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await Transaction.findByTransactionId(transactionId);
    if (!transaction) {
      return res.status(404).json(formatResponse(false, 'Transaction not found', null));
    }

    // Soft delete by setting isActive to false
    transaction.isActive = false;
    await transaction.save();

    // Log deletion
    await Log.create({
      action: 'transaction_deleted',
      documentId: transaction.documentId._id,
      transactionId: transactionId,
      details: { transactionId },
      userId: req.user?.id
    });

    logger.info(`Transaction deleted: ${transactionId}`);

    res.json(formatResponse(true, 'Transaction deleted successfully', null));
  } catch (error) {
    logger.error('Error deleting transaction:', error);
    res.status(500).json(formatResponse(false, 'Failed to delete transaction', null, error.message));
  }
};

/**
 * Get transaction analytics
 */
const getTransactionAnalytics = async (req, res) => {
  try {
    const { startDate, endDate, status, creatorId } = req.query;

    const filters = {};
    
    // Add date range filter
    if (startDate || endDate) {
      filters.createdAt = {};
      if (startDate) filters.createdAt.$gte = new Date(startDate);
      if (endDate) filters.createdAt.$lte = new Date(endDate);
    }

    // Add status filter
    if (status) filters.status = status;

    // Add creator filter
    if (creatorId) filters.creator = creatorId;
    else if (req.user?.id) filters.creator = req.user.id;

    const analytics = await transactionUtils.getTransactionAnalytics(filters);

    res.json(formatResponse(true, 'Transaction analytics retrieved successfully', analytics));
  } catch (error) {
    logger.error('Error getting transaction analytics:', error);
    res.status(500).json(formatResponse(false, 'Failed to get transaction analytics', null, error.message));
  }
};

/**
 * Bulk update transaction statuses from Adobe Sign
 */
const bulkUpdateFromAdobe = async (req, res) => {
  try {
    const { transactionIds } = req.body;

    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json(formatResponse(false, 'Transaction IDs array is required', null));
    }

    const results = [];
    const errors = [];

    for (const transactionId of transactionIds) {
      try {
        const transaction = await Transaction.findByTransactionId(transactionId);
        if (!transaction) {
          errors.push({ transactionId, error: 'Transaction not found' });
          continue;
        }

        if (!transaction.adobeAgreementId) {
          errors.push({ transactionId, error: 'No Adobe Sign agreement found' });
          continue;
        }

        const accessToken = await getAccessToken();
        const adobeStatus = await getComprehensiveAgreementInfo(accessToken, transaction.adobeAgreementId);
        
        const updatedTransaction = await transactionUtils.updateTransactionStatusFromAdobe(
          transactionId, 
          adobeStatus
        );

        results.push({ 
          transactionId, 
          oldStatus: transaction.status,
          newStatus: updatedTransaction.status,
          success: true 
        });
      } catch (error) {
        errors.push({ transactionId, error: error.message });
      }
    }

    logger.info(`Bulk Adobe status update: ${results.length} successful, ${errors.length} failed`);

    res.json(formatResponse(true, 'Bulk Adobe status update completed', {
      successful: results,
      failed: errors,
      summary: {
        total: transactionIds.length,
        successful: results.length,
        failed: errors.length
      }
    }));
  } catch (error) {
    logger.error('Error bulk updating from Adobe:', error);
    res.status(500).json(formatResponse(false, 'Failed to bulk update from Adobe', null, error.message));
  }
};

module.exports = {
  createTransaction,
  createTransactionFromDocument,
  getTransactionDetails,
  getTransactions,
  sendTransactionReminder,
  bulkSendReminders,
  checkTransactionStatus,
  downloadTransactionDocument,
  updateTransaction,
  deleteTransaction,
  getTransactionAnalytics,
  bulkUpdateFromAdobe
};
