/**
 * Real-time Document Status Monitor for Adobe Sign Integration
 */

const logger = require('../utils/logger');
const Document = require('../models/document.model');
const { getEnhancedAgreementInfo, getAccessToken } = require('../config/adobeSign');
const { reminderScheduler } = require('./reminderScheduler');

/**
 * Advanced document status monitoring with real-time updates and intelligent notifications
 */
class DocumentStatusMonitor {
  constructor() {
    this.monitoringIntervals = new Map();
    this.statusCache = new Map();
    this.eventListeners = new Map();
    this.defaultCheckInterval = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Start monitoring a document for status changes
   * @param {string} documentId - Document ID to monitor
   * @param {object} options - Monitoring options
   */
  async startMonitoring(documentId, options = {}) {
    try {
      const document = await Document.findById(documentId);
      if (!document || !document.adobeAgreementId) {
        throw new Error('Document not found or not sent for signature');
      }

      // Stop existing monitoring if any
      this.stopMonitoring(documentId);

      logger.info(`👁️ Starting status monitoring for document: ${documentId}`);

      const monitoringConfig = {
        documentId,
        agreementId: document.adobeAgreementId,
        checkInterval: options.checkInterval || this.defaultCheckInterval,
        alertOnChange: options.alertOnChange !== false,
        autoReminders: options.autoReminders !== false,
        lastChecked: null,
        consecutiveErrors: 0
      };

      // Perform initial status check
      await this.checkDocumentStatus(monitoringConfig);

      // Schedule periodic checks
      const intervalId = setInterval(async () => {
        await this.checkDocumentStatus(monitoringConfig);
      }, monitoringConfig.checkInterval);

      this.monitoringIntervals.set(documentId, {
        intervalId,
        config: monitoringConfig
      });

      logger.info(`✅ Started monitoring document ${documentId} (check every ${Math.round(monitoringConfig.checkInterval / 60000)} minutes)`);

    } catch (error) {
      logger.error(`❌ Error starting monitoring for document ${documentId}:`, error.message);
    }
  }

  /**
   * Check document status and handle changes
   */
  async checkDocumentStatus(config) {
    try {
      const accessToken = await getAccessToken();
      const agreementInfo = await getEnhancedAgreementInfo(accessToken, config.agreementId);
      
      config.lastChecked = new Date();
      config.consecutiveErrors = 0;

      // Get current status snapshot
      const currentStatus = this.createStatusSnapshot(agreementInfo);
      const previousStatus = this.statusCache.get(config.documentId);

      // Store current status
      this.statusCache.set(config.documentId, currentStatus);

      // Check for changes
      if (previousStatus) {
        const changes = this.detectStatusChanges(previousStatus, currentStatus);
        
        if (changes.length > 0) {
          logger.info(`📊 Status changes detected for document ${config.documentId}:`);
          changes.forEach(change => {
            logger.info(`  • ${change.type}: ${change.description}`);
          });

          // Handle status changes
          await this.handleStatusChanges(config.documentId, changes, currentStatus);

          // Emit events for listeners
          this.emitStatusChangeEvents(config.documentId, changes, currentStatus);
        }
      }

      // Update document in database if needed
      await this.updateDocumentStatus(config.documentId, currentStatus);

      // Handle auto-reminders
      if (config.autoReminders) {
        await this.handleAutoReminders(config.documentId, currentStatus);
      }

      logger.debug(`🔍 Status check completed for document ${config.documentId}`);

    } catch (error) {
      config.consecutiveErrors++;
      logger.error(`❌ Error checking status for document ${config.documentId} (error #${config.consecutiveErrors}):`, error.message);

      // Stop monitoring if too many consecutive errors
      if (config.consecutiveErrors >= 5) {
        logger.error(`🛑 Stopping monitoring for document ${config.documentId} due to consecutive errors`);
        this.stopMonitoring(config.documentId);
      }
    }
  }

  /**
   * Create a status snapshot from agreement info
   */
  createStatusSnapshot(agreementInfo) {
    const snapshot = {
      timestamp: new Date(),
      agreementStatus: agreementInfo.status,
      participants: [],
      completed: 0,
      pending: 0,
      signed: 0,
      currentSigner: null,
      isComplete: false
    };

    // Process participant information
    if (agreementInfo.participantSets) {
      for (const participantSet of agreementInfo.participantSets) {
        if (participantSet.role === 'SIGNER') {
          for (const participant of participantSet.memberInfos) {
            const participantInfo = {
              email: participant.email,
              name: participant.name || participant.email.split('@')[0],
              status: participant.status,
              order: participantSet.order,
              hasActionRequired: this.requiresAction(participant.status),
              hasCompleted: this.isCompleted(participant.status)
            };

            snapshot.participants.push(participantInfo);

            if (participantInfo.hasCompleted) {
              snapshot.completed++;
              if (participant.status === 'SIGNED') {
                snapshot.signed++;
              }
            } else if (participantInfo.hasActionRequired) {
              snapshot.pending++;
            }
          }
        }
      }
    }

    // Use enhanced signing status if available
    if (agreementInfo.actualSigningStatus) {
      snapshot.currentSigner = agreementInfo.actualSigningStatus.currentSigner;
      snapshot.pending = agreementInfo.actualSigningStatus.pendingParticipants?.length || 0;
      snapshot.signed = agreementInfo.actualSigningStatus.signedParticipants?.length || 0;
    }

    // Determine if document is complete
    snapshot.isComplete = this.isDocumentComplete(agreementInfo.status);

    return snapshot;
  }

  /**
   * Detect changes between status snapshots
   */
  detectStatusChanges(previous, current) {
    const changes = [];

    // Check agreement status change
    if (previous.agreementStatus !== current.agreementStatus) {
      changes.push({
        type: 'agreement_status',
        description: `Agreement status changed from ${previous.agreementStatus} to ${current.agreementStatus}`,
        previous: previous.agreementStatus,
        current: current.agreementStatus
      });
    }

    // Check for new signatures
    if (current.signed > previous.signed) {
      changes.push({
        type: 'new_signature',
        description: `${current.signed - previous.signed} new signature(s) added`,
        previous: previous.signed,
        current: current.signed
      });
    }

    // Check for completion
    if (!previous.isComplete && current.isComplete) {
      changes.push({
        type: 'document_completed',
        description: 'Document signing process completed',
        previous: false,
        current: true
      });
    }

    // Check for current signer changes
    if (previous.currentSigner?.email !== current.currentSigner?.email) {
      changes.push({
        type: 'current_signer_changed',
        description: `Current signer changed from ${previous.currentSigner?.email || 'none'} to ${current.currentSigner?.email || 'none'}`,
        previous: previous.currentSigner,
        current: current.currentSigner
      });
    }

    // Check individual participant status changes
    for (const currentParticipant of current.participants) {
      const previousParticipant = previous.participants.find(p => p.email === currentParticipant.email);
      
      if (previousParticipant && previousParticipant.status !== currentParticipant.status) {
        changes.push({
          type: 'participant_status_changed',
          description: `${currentParticipant.email} status changed from ${previousParticipant.status} to ${currentParticipant.status}`,
          participant: currentParticipant.email,
          previous: previousParticipant.status,
          current: currentParticipant.status
        });
      }
    }

    return changes;
  }

  /**
   * Handle status changes with appropriate actions
   */
  async handleStatusChanges(documentId, changes, currentStatus) {
    for (const change of changes) {
      switch (change.type) {
        case 'new_signature':
          logger.info(`🎉 New signature detected for document ${documentId}`);
          await this.handleNewSignature(documentId, change, currentStatus);
          break;

        case 'document_completed':
          logger.info(`🏁 Document ${documentId} completed!`);
          await this.handleDocumentCompleted(documentId);
          break;

        case 'current_signer_changed':
          logger.info(`🔄 Current signer changed for document ${documentId}`);
          await this.handleCurrentSignerChanged(documentId, change, currentStatus);
          break;

        case 'agreement_status':
          logger.info(`📋 Agreement status changed for document ${documentId}`);
          await this.handleAgreementStatusChanged(documentId, change);
          break;
      }
    }
  }

  /**
   * Handle new signature event
   */
  async handleNewSignature(documentId, change, currentStatus) {
    try {
      // Update database
      await Document.findByIdAndUpdate(documentId, {
        $set: {
          lastSignatureDate: new Date(),
          signedCount: currentStatus.signed,
          completedCount: currentStatus.completed
        }
      });

      // If there's a new current signer, schedule reminders
      if (currentStatus.currentSigner && !currentStatus.isComplete) {
        await reminderScheduler.scheduleDocumentReminders(documentId, {
          urgency: 'normal'
        });
        logger.info(`📅 Scheduled reminders for new current signer: ${currentStatus.currentSigner.email}`);
      }

    } catch (error) {
      logger.error(`❌ Error handling new signature for document ${documentId}:`, error.message);
    }
  }

  /**
   * Handle document completion
   */
  async handleDocumentCompleted(documentId) {
    try {
      // Clear any scheduled reminders
      reminderScheduler.clearDocumentReminders(documentId);

      // Update database
      await Document.findByIdAndUpdate(documentId, {
        $set: {
          status: 'completed',
          completedAt: new Date()
        }
      });

      // Stop monitoring
      this.stopMonitoring(documentId);

      logger.info(`🎉 Document ${documentId} processing completed and monitoring stopped`);

    } catch (error) {
      logger.error(`❌ Error handling document completion for ${documentId}:`, error.message);
    }
  }

  /**
   * Handle current signer change
   */
  async handleCurrentSignerChanged(documentId, change, currentStatus) {
    try {
      if (currentStatus.currentSigner && !currentStatus.isComplete) {
        // Schedule reminders for new current signer
        await reminderScheduler.scheduleDocumentReminders(documentId, {
          urgency: 'normal'
        });
        
        logger.info(`📬 New current signer: ${currentStatus.currentSigner.email} - reminders scheduled`);
      }
    } catch (error) {
      logger.error(`❌ Error handling current signer change for document ${documentId}:`, error.message);
    }
  }

  /**
   * Handle agreement status change
   */
  async handleAgreementStatusChanged(documentId, change) {
    try {
      await Document.findByIdAndUpdate(documentId, {
        $set: {
          adobeSignStatus: change.current,
          lastStatusUpdate: new Date()
        }
      });

      // Stop monitoring if document is in final state
      if (this.isFinalStatus(change.current)) {
        this.stopMonitoring(documentId);
        reminderScheduler.clearDocumentReminders(documentId);
        logger.info(`📋 Document ${documentId} reached final status: ${change.current} - monitoring stopped`);
      }

    } catch (error) {
      logger.error(`❌ Error handling agreement status change for document ${documentId}:`, error.message);
    }
  }

  /**
   * Handle auto-reminders based on current status
   */
  async handleAutoReminders(documentId, currentStatus) {
    // Only schedule reminders if document is not complete and has pending signers
    if (!currentStatus.isComplete && currentStatus.pending > 0) {
      const reminderStatus = reminderScheduler.getReminderStatus(documentId);
      
      if (!reminderStatus.scheduled) {
        await reminderScheduler.scheduleDocumentReminders(documentId, {
          urgency: 'normal'
        });
        logger.info(`🔔 Auto-scheduled reminders for document ${documentId}`);
      }
    }
  }

  /**
   * Update document status in database
   */
  async updateDocumentStatus(documentId, statusSnapshot) {
    try {
      const updateData = {
        lastStatusCheck: statusSnapshot.timestamp,
        signedCount: statusSnapshot.signed,
        completedCount: statusSnapshot.completed,
        pendingCount: statusSnapshot.pending,
        adobeSignStatus: statusSnapshot.agreementStatus
      };

      if (statusSnapshot.currentSigner) {
        updateData.currentSigner = statusSnapshot.currentSigner.email;
      }

      await Document.findByIdAndUpdate(documentId, {
        $set: updateData
      });

    } catch (error) {
      logger.error(`❌ Error updating document status in database for ${documentId}:`, error.message);
    }
  }

  /**
   * Stop monitoring a document
   */
  stopMonitoring(documentId) {
    const monitoring = this.monitoringIntervals.get(documentId);
    if (monitoring) {
      clearInterval(monitoring.intervalId);
      this.monitoringIntervals.delete(documentId);
      this.statusCache.delete(documentId);
      logger.info(`🛑 Stopped monitoring document: ${documentId}`);
    }
  }

  /**
   * Get monitoring status for a document
   */
  getMonitoringStatus(documentId) {
    const monitoring = this.monitoringIntervals.get(documentId);
    const status = this.statusCache.get(documentId);
    
    return {
      isMonitoring: !!monitoring,
      lastChecked: monitoring?.config?.lastChecked,
      checkInterval: monitoring?.config?.checkInterval,
      currentStatus: status,
      consecutiveErrors: monitoring?.config?.consecutiveErrors || 0
    };
  }

  /**
   * List all monitored documents
   */
  listMonitoredDocuments() {
    const documents = [];
    
    for (const [documentId, monitoring] of this.monitoringIntervals.entries()) {
      const status = this.statusCache.get(documentId);
      
      documents.push({
        documentId,
        agreementId: monitoring.config.agreementId,
        lastChecked: monitoring.config.lastChecked,
        checkInterval: monitoring.config.checkInterval,
        consecutiveErrors: monitoring.config.consecutiveErrors,
        currentStatus: status ? {
          agreementStatus: status.agreementStatus,
          signed: status.signed,
          pending: status.pending,
          isComplete: status.isComplete,
          currentSigner: status.currentSigner?.email
        } : null
      });
    }

    return documents;
  }

  /**
   * Add event listener for status changes
   */
  addEventListener(documentId, eventType, callback) {
    if (!this.eventListeners.has(documentId)) {
      this.eventListeners.set(documentId, new Map());
    }
    
    const docListeners = this.eventListeners.get(documentId);
    if (!docListeners.has(eventType)) {
      docListeners.set(eventType, []);
    }
    
    docListeners.get(eventType).push(callback);
  }

  /**
   * Emit status change events to listeners
   */
  emitStatusChangeEvents(documentId, changes, currentStatus) {
    const docListeners = this.eventListeners.get(documentId);
    if (!docListeners) return;

    for (const change of changes) {
      const listeners = docListeners.get(change.type);
      if (listeners) {
        listeners.forEach(callback => {
          try {
            callback(change, currentStatus);
          } catch (error) {
            logger.error(`❌ Error in event listener for ${change.type}:`, error.message);
          }
        });
      }
    }
  }

  /**
   * Helper methods
   */
  requiresAction(status) {
    return [
      'WAITING_FOR_MY_SIGNATURE',
      'WAITING_FOR_MY_APPROVAL',
      'WAITING_FOR_MY_DELEGATION',
      'WAITING_FOR_MY_ACCEPTANCE',
      'WAITING_FOR_MY_FORM_FILLING',
      'ACTIVE'
    ].includes(status);
  }

  isCompleted(status) {
    return [
      'SIGNED',
      'APPROVED',
      'ACCEPTED',
      'FORM_FILLED',
      'DELEGATED',
      'COMPLETED'
    ].includes(status);
  }

  isDocumentComplete(agreementStatus) {
    return [
      'SIGNED',
      'APPROVED',
      'COMPLETED'
    ].includes(agreementStatus);
  }

  isFinalStatus(status) {
    return [
      'SIGNED',
      'APPROVED', 
      'COMPLETED',
      'CANCELLED',
      'EXPIRED',
      'RECALLED'
    ].includes(status);
  }
}

// Create singleton instance
const documentStatusMonitor = new DocumentStatusMonitor();

module.exports = {
  DocumentStatusMonitor,
  documentStatusMonitor
};
