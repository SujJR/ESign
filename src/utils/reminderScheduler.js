/**
 * Advanced Reminder Scheduling System for Adobe Sign Documents
 */

const logger = require('../utils/logger');
const Document = require('../models/document.model');
const { getEnhancedAgreementInfo, getAccessToken, sendReminder } = require('../config/adobeSign');

/**
 * Intelligent reminder scheduler that respects signing workflows and timing
 */
class ReminderScheduler {
  constructor() {
    this.scheduledReminders = new Map();
    this.reminderIntervals = {
      initial: 24 * 60 * 60 * 1000,      // 24 hours
      followUp: 72 * 60 * 60 * 1000,     // 72 hours (3 days)
      urgent: 168 * 60 * 60 * 1000,      // 168 hours (7 days)
      final: 336 * 60 * 60 * 1000        // 336 hours (14 days)
    };
  }

  /**
   * Schedule intelligent reminders for a document
   * @param {string} documentId - Document ID
   * @param {object} options - Reminder options
   */
  async scheduleDocumentReminders(documentId, options = {}) {
    try {
      const document = await Document.findById(documentId);
      if (!document || !document.adobeAgreementId) {
        throw new Error('Document not found or not sent for signature');
      }

      logger.info(`📅 Scheduling intelligent reminders for document: ${documentId}`);

      // Clear any existing reminders for this document
      this.clearDocumentReminders(documentId);

      // Get current agreement status
      const accessToken = await getAccessToken();
      const agreementInfo = await getEnhancedAgreementInfo(accessToken, document.adobeAgreementId);

      if (!agreementInfo || !this.isReminderEligible(agreementInfo.status)) {
        logger.info(`📋 Document ${documentId} not eligible for reminders (status: ${agreementInfo?.status})`);
        return;
      }

      // Determine reminder strategy based on signing workflow
      const strategy = this.determineReminderStrategy(agreementInfo, options);
      logger.info(`🎯 Using reminder strategy: ${strategy.type} for document ${documentId}`);

      // Schedule reminders based on strategy
      await this.scheduleRemindersWithStrategy(documentId, strategy);

    } catch (error) {
      logger.error(`❌ Error scheduling reminders for document ${documentId}:`, error.message);
    }
  }

  /**
   * Determine the best reminder strategy based on document characteristics
   */
  determineReminderStrategy(agreementInfo, options) {
    const actualSigningStatus = agreementInfo.actualSigningStatus;
    const isSequential = this.isSequentialSigning(agreementInfo);
    const urgency = options.urgency || 'normal';
    const customSchedule = options.customSchedule;

    if (customSchedule) {
      return {
        type: 'custom',
        intervals: customSchedule,
        isSequential
      };
    }

    if (isSequential) {
      return {
        type: 'sequential',
        intervals: this.getSequentialIntervals(urgency),
        currentSigner: actualSigningStatus?.currentSigner,
        pendingCount: actualSigningStatus?.pendingParticipants?.length || 0
      };
    } else {
      return {
        type: 'parallel',
        intervals: this.getParallelIntervals(urgency),
        pendingSigners: actualSigningStatus?.pendingParticipants || []
      };
    }
  }

  /**
   * Schedule reminders based on determined strategy
   */
  async scheduleRemindersWithStrategy(documentId, strategy) {
    const reminders = [];

    strategy.intervals.forEach((interval, index) => {
      const reminderTime = Date.now() + interval;
      const reminderType = this.getReminderType(index, strategy.intervals.length);

      const reminder = {
        documentId,
        scheduledTime: reminderTime,
        type: reminderType,
        strategy: strategy.type,
        message: this.generateReminderMessage(reminderType, strategy)
      };

      reminders.push(reminder);

      // Schedule the actual reminder
      const timeoutId = setTimeout(() => {
        this.executeReminder(reminder);
      }, interval);

      logger.info(`⏰ Scheduled ${reminderType} reminder for document ${documentId} in ${Math.round(interval / (60 * 60 * 1000))} hours`);
    });

    // Store scheduled reminders
    this.scheduledReminders.set(documentId, {
      reminders,
      strategy
    });

    logger.info(`📅 Successfully scheduled ${reminders.length} reminders for document ${documentId}`);
  }

  /**
   * Execute a scheduled reminder
   */
  async executeReminder(reminder) {
    try {
      logger.info(`🔔 Executing ${reminder.type} reminder for document ${reminder.documentId}`);

      const document = await Document.findById(reminder.documentId);
      if (!document || !document.adobeAgreementId) {
        logger.warn(`⚠️ Document ${reminder.documentId} no longer exists or valid for reminders`);
        return;
      }

      // Check if document still needs reminders
      const accessToken = await getAccessToken();
      const agreementInfo = await getEnhancedAgreementInfo(accessToken, document.adobeAgreementId);

      if (!this.isReminderEligible(agreementInfo.status)) {
        logger.info(`📋 Document ${reminder.documentId} no longer needs reminders (status: ${agreementInfo.status})`);
        this.clearDocumentReminders(reminder.documentId);
        return;
      }

      // Send reminder using existing logic
      const actualSigningStatus = agreementInfo.actualSigningStatus;
      let recipientsToRemind = [];

      if (actualSigningStatus && actualSigningStatus.currentSigner) {
        // Sequential: remind current signer
        recipientsToRemind = [actualSigningStatus.currentSigner];
      } else if (actualSigningStatus && actualSigningStatus.pendingParticipants) {
        // Parallel: remind all pending
        recipientsToRemind = actualSigningStatus.pendingParticipants;
      }

      if (recipientsToRemind.length > 0) {
        const participantIds = recipientsToRemind
          .map(p => p.participantId)
          .filter(id => id);

        await sendReminder(
          accessToken,
          document.adobeAgreementId,
          reminder.message,
          participantIds
        );

        logger.info(`✅ Successfully sent ${reminder.type} reminder to ${recipientsToRemind.length} recipient(s)`);
      } else {
        logger.info(`📭 No recipients currently need reminders for document ${reminder.documentId}`);
      }

    } catch (error) {
      logger.error(`❌ Error executing reminder for document ${reminder.documentId}:`, error.message);
    }
  }

  /**
   * Check if document status is eligible for reminders
   */
  isReminderEligible(status) {
    const eligibleStatuses = [
      'OUT_FOR_SIGNATURE',
      'OUT_FOR_APPROVAL', 
      'IN_PROCESS',
      'WAITING_FOR_MY_SIGNATURE',
      'WAITING_FOR_OTHERS'
    ];
    return eligibleStatuses.includes(status);
  }

  /**
   * Determine if signing workflow is sequential
   */
  isSequentialSigning(agreementInfo) {
    if (!agreementInfo.participantSets) return false;

    const signerOrders = agreementInfo.participantSets
      .filter(set => set.role === 'SIGNER')
      .map(set => set.order)
      .filter(order => order !== undefined);

    // If all signers have different orders, it's sequential
    const uniqueOrders = [...new Set(signerOrders)];
    return uniqueOrders.length === signerOrders.length && uniqueOrders.length > 1;
  }

  /**
   * Get reminder intervals for sequential signing
   */
  getSequentialIntervals(urgency) {
    const base = this.reminderIntervals;
    
    switch (urgency) {
      case 'low':
        return [base.followUp, base.urgent];
      case 'high':
        return [base.initial / 2, base.initial, base.followUp];
      case 'critical':
        return [4 * 60 * 60 * 1000, base.initial / 2, base.initial]; // 4 hours, 12 hours, 24 hours
      default: // normal
        return [base.initial, base.followUp];
    }
  }

  /**
   * Get reminder intervals for parallel signing
   */
  getParallelIntervals(urgency) {
    const base = this.reminderIntervals;
    
    switch (urgency) {
      case 'low':
        return [base.followUp, base.urgent, base.final];
      case 'high':
        return [base.initial, base.followUp, base.urgent];
      case 'critical':
        return [8 * 60 * 60 * 1000, base.initial, base.followUp]; // 8 hours, 24 hours, 72 hours
      default: // normal
        return [base.initial, base.followUp, base.urgent];
    }
  }

  /**
   * Get reminder type based on sequence
   */
  getReminderType(index, total) {
    if (index === 0) return 'initial';
    if (index === total - 1) return 'final';
    if (index === 1) return 'followUp';
    return 'reminder';
  }

  /**
   * Generate contextual reminder message
   */
  generateReminderMessage(type, strategy) {
    const messages = {
      initial: 'This is a friendly reminder that your signature is needed on an important document.',
      followUp: 'We noticed you haven\'t had a chance to sign the document yet. Please take a moment to review and sign when convenient.',
      reminder: 'Your signature is still needed to complete this document. Please sign at your earliest convenience.',
      final: 'This is the final reminder - your signature is urgently needed to complete this important document.'
    };

    let message = messages[type] || messages.reminder;

    // Add context based on strategy
    if (strategy.type === 'sequential' && strategy.currentSigner) {
      message += ` You are currently the next person in the signing sequence.`;
    } else if (strategy.type === 'parallel') {
      message += ` Multiple signatures are being collected simultaneously.`;
    }

    return message;
  }

  /**
   * Clear all scheduled reminders for a document
   */
  clearDocumentReminders(documentId) {
    const existing = this.scheduledReminders.get(documentId);
    if (existing) {
      logger.info(`🗑️ Clearing ${existing.reminders.length} scheduled reminders for document ${documentId}`);
      this.scheduledReminders.delete(documentId);
    }
  }

  /**
   * Get status of scheduled reminders
   */
  getReminderStatus(documentId) {
    const reminders = this.scheduledReminders.get(documentId);
    if (!reminders) {
      return { scheduled: false, count: 0 };
    }

    return {
      scheduled: true,
      count: reminders.reminders.length,
      strategy: reminders.strategy.type,
      nextReminder: Math.min(...reminders.reminders.map(r => r.scheduledTime))
    };
  }

  /**
   * List all scheduled reminders
   */
  listAllScheduledReminders() {
    const summary = [];
    
    for (const [documentId, data] of this.scheduledReminders.entries()) {
      summary.push({
        documentId,
        strategy: data.strategy.type,
        reminderCount: data.reminders.length,
        nextReminder: Math.min(...data.reminders.map(r => r.scheduledTime)),
        reminders: data.reminders.map(r => ({
          type: r.type,
          scheduledTime: new Date(r.scheduledTime).toISOString()
        }))
      });
    }

    return summary;
  }
}

// Create singleton instance
const reminderScheduler = new ReminderScheduler();

module.exports = {
  ReminderScheduler,
  reminderScheduler
};
