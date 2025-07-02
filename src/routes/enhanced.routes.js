/**
 * Enhanced Document Management Routes with Advanced Features
 */

const express = require('express');
const router = express.Router();
const { performAdobeSignHealthCheck } = require('../utils/adobeSignHealthCheck');
const { reminderScheduler } = require('../utils/reminderScheduler');
const { documentStatusMonitor } = require('../utils/documentStatusMonitor');
const { formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');
const { authenticateApiKey } = require('../middleware/apiKeyAuth');

/**
 * Health check endpoint for Adobe Sign integration
 * @route GET /api/documents/adobe-sign/health
 */
router.get('/adobe-sign/health', authenticateApiKey, async (req, res, next) => {
  try {
    logger.info('🔍 Performing Adobe Sign health check...');
    
    const healthCheck = await performAdobeSignHealthCheck();
    
    res.status(healthCheck.isHealthy ? 200 : 503).json(formatResponse(
      healthCheck.isHealthy ? 200 : 503,
      healthCheck.summary,
      {
        ...healthCheck,
        timestamp: new Date().toISOString()
      }
    ));
    
  } catch (error) {
    logger.error('❌ Health check failed:', error.message);
    next(error);
  }
});

/**
 * Schedule intelligent reminders for a document
 * @route POST /api/documents/:id/schedule-reminders
 */
router.post('/:id/schedule-reminders', authenticateApiKey, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { 
      urgency = 'normal', 
      customSchedule, 
      autoReminders = true 
    } = req.body;

    logger.info(`📅 Scheduling reminders for document ${id} with urgency: ${urgency}`);

    await reminderScheduler.scheduleDocumentReminders(id, {
      urgency,
      customSchedule,
      autoReminders
    });

    const status = reminderScheduler.getReminderStatus(id);

    res.status(200).json(formatResponse(
      200,
      'Reminders scheduled successfully',
      {
        documentId: id,
        ...status,
        scheduledAt: new Date().toISOString()
      }
    ));

  } catch (error) {
    logger.error(`❌ Error scheduling reminders for document ${req.params.id}:`, error.message);
    next(error);
  }
});

/**
 * Get reminder status for a document
 * @route GET /api/documents/:id/reminder-status
 */
router.get('/:id/reminder-status', authenticateApiKey, async (req, res, next) => {
  try {
    const { id } = req.params;
    const status = reminderScheduler.getReminderStatus(id);

    res.status(200).json(formatResponse(
      200,
      'Reminder status retrieved successfully',
      {
        documentId: id,
        ...status
      }
    ));

  } catch (error) {
    logger.error(`❌ Error getting reminder status for document ${req.params.id}:`, error.message);
    next(error);
  }
});

/**
 * Clear scheduled reminders for a document
 * @route DELETE /api/documents/:id/reminders
 */
router.delete('/:id/reminders', authenticateApiKey, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    reminderScheduler.clearDocumentReminders(id);

    res.status(200).json(formatResponse(
      200,
      'Reminders cleared successfully',
      {
        documentId: id,
        clearedAt: new Date().toISOString()
      }
    ));

  } catch (error) {
    logger.error(`❌ Error clearing reminders for document ${req.params.id}:`, error.message);
    next(error);
  }
});

/**
 * List all scheduled reminders
 * @route GET /api/documents/reminders
 */
router.get('/reminders', authenticateApiKey, async (req, res, next) => {
  try {
    const reminders = reminderScheduler.listAllScheduledReminders();

    res.status(200).json(formatResponse(
      200,
      'Scheduled reminders retrieved successfully',
      {
        totalDocuments: reminders.length,
        reminders
      }
    ));

  } catch (error) {
    logger.error('❌ Error listing scheduled reminders:', error.message);
    next(error);
  }
});

/**
 * Start monitoring a document for status changes
 * @route POST /api/documents/:id/start-monitoring
 */
router.post('/:id/start-monitoring', authenticateApiKey, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { 
      checkInterval = 5 * 60 * 1000, // 5 minutes default
      alertOnChange = true,
      autoReminders = true
    } = req.body;

    logger.info(`👁️ Starting monitoring for document ${id}`);

    await documentStatusMonitor.startMonitoring(id, {
      checkInterval,
      alertOnChange,
      autoReminders
    });

    const status = documentStatusMonitor.getMonitoringStatus(id);

    res.status(200).json(formatResponse(
      200,
      'Document monitoring started successfully',
      {
        documentId: id,
        ...status,
        startedAt: new Date().toISOString()
      }
    ));

  } catch (error) {
    logger.error(`❌ Error starting monitoring for document ${req.params.id}:`, error.message);
    next(error);
  }
});

/**
 * Stop monitoring a document
 * @route POST /api/documents/:id/stop-monitoring
 */
router.post('/:id/stop-monitoring', authenticateApiKey, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    documentStatusMonitor.stopMonitoring(id);

    res.status(200).json(formatResponse(
      200,
      'Document monitoring stopped successfully',
      {
        documentId: id,
        stoppedAt: new Date().toISOString()
      }
    ));

  } catch (error) {
    logger.error(`❌ Error stopping monitoring for document ${req.params.id}:`, error.message);
    next(error);
  }
});

/**
 * Get monitoring status for a document
 * @route GET /api/documents/:id/monitoring-status
 */
router.get('/:id/monitoring-status', authenticateApiKey, async (req, res, next) => {
  try {
    const { id } = req.params;
    const status = documentStatusMonitor.getMonitoringStatus(id);

    res.status(200).json(formatResponse(
      200,
      'Monitoring status retrieved successfully',
      {
        documentId: id,
        ...status
      }
    ));

  } catch (error) {
    logger.error(`❌ Error getting monitoring status for document ${req.params.id}:`, error.message);
    next(error);
  }
});

/**
 * List all monitored documents
 * @route GET /api/documents/monitoring
 */
router.get('/monitoring', authenticateApiKey, async (req, res, next) => {
  try {
    const documents = documentStatusMonitor.listMonitoredDocuments();

    res.status(200).json(formatResponse(
      200,
      'Monitored documents retrieved successfully',
      {
        totalDocuments: documents.length,
        documents
      }
    ));

  } catch (error) {
    logger.error('❌ Error listing monitored documents:', error.message);
    next(error);
  }
});

/**
 * Get comprehensive document analytics
 * @route GET /api/documents/:id/analytics
 */
router.get('/:id/analytics', authenticateApiKey, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Get monitoring status
    const monitoringStatus = documentStatusMonitor.getMonitoringStatus(id);
    
    // Get reminder status
    const reminderStatus = reminderScheduler.getReminderStatus(id);

    // Combine analytics
    const analytics = {
      documentId: id,
      monitoring: monitoringStatus,
      reminders: reminderStatus,
      lastUpdated: new Date().toISOString()
    };

    // Add status insights if available
    if (monitoringStatus.currentStatus) {
      analytics.insights = {
        signingProgress: `${monitoringStatus.currentStatus.signed}/${monitoringStatus.currentStatus.signed + monitoringStatus.currentStatus.pending}`,
        progressPercentage: Math.round(
          (monitoringStatus.currentStatus.signed / 
           (monitoringStatus.currentStatus.signed + monitoringStatus.currentStatus.pending)) * 100
        ),
        currentSigner: monitoringStatus.currentStatus.currentSigner?.email,
        isComplete: monitoringStatus.currentStatus.isComplete,
        agreementStatus: monitoringStatus.currentStatus.agreementStatus
      };
    }

    res.status(200).json(formatResponse(
      200,
      'Document analytics retrieved successfully',
      analytics
    ));

  } catch (error) {
    logger.error(`❌ Error getting analytics for document ${req.params.id}:`, error.message);
    next(error);
  }
});

/**
 * Bulk operations for multiple documents
 * @route POST /api/documents/bulk/start-monitoring
 */
router.post('/bulk/start-monitoring', authenticateApiKey, async (req, res, next) => {
  try {
    const { documentIds, options = {} } = req.body;

    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json(formatResponse(
        400,
        'documentIds must be a non-empty array'
      ));
    }

    logger.info(`🔄 Starting bulk monitoring for ${documentIds.length} documents`);

    const results = [];
    
    for (const documentId of documentIds) {
      try {
        await documentStatusMonitor.startMonitoring(documentId, options);
        results.push({
          documentId,
          success: true,
          status: documentStatusMonitor.getMonitoringStatus(documentId)
        });
      } catch (error) {
        results.push({
          documentId,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    res.status(200).json(formatResponse(
      200,
      `Bulk monitoring operation completed: ${successCount}/${documentIds.length} successful`,
      {
        totalRequested: documentIds.length,
        successful: successCount,
        failed: documentIds.length - successCount,
        results
      }
    ));

  } catch (error) {
    logger.error('❌ Error in bulk monitoring operation:', error.message);
    next(error);
  }
});

/**
 * System status overview
 * @route GET /api/documents/system/status
 */
router.get('/system/status', authenticateApiKey, async (req, res, next) => {
  try {
    // Get overall system status
    const monitoredDocs = documentStatusMonitor.listMonitoredDocuments();
    const scheduledReminders = reminderScheduler.listAllScheduledReminders();
    
    // Perform health check
    const healthCheck = await performAdobeSignHealthCheck();

    const systemStatus = {
      timestamp: new Date().toISOString(),
      adobeSignHealth: {
        isHealthy: healthCheck.isHealthy,
        summary: healthCheck.summary
      },
      monitoring: {
        activeDocuments: monitoredDocs.length,
        totalChecks: monitoredDocs.reduce((sum, doc) => sum + (doc.consecutiveErrors || 0), 0),
        documentsWithErrors: monitoredDocs.filter(doc => doc.consecutiveErrors > 0).length
      },
      reminders: {
        scheduledDocuments: scheduledReminders.length,
        totalReminders: scheduledReminders.reduce((sum, doc) => sum + doc.reminderCount, 0)
      },
      performance: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        nodeVersion: process.version
      }
    };

    res.status(200).json(formatResponse(
      200,
      'System status retrieved successfully',
      systemStatus
    ));

  } catch (error) {
    logger.error('❌ Error getting system status:', error.message);
    next(error);
  }
});

/**
 * Force refresh document status from Adobe Sign
 * @route POST /api/documents/:id/force-refresh
 */
router.post('/:id/force-refresh', authenticateApiKey, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    logger.info(`🔄 Force refreshing status for document: ${id}`);
    
    const refreshedDocument = await reminderScheduler.forceStatusRefresh(id);
    
    if (!refreshedDocument) {
      return res.status(404).json(formatResponse(
        404,
        'Document not found or could not refresh status'
      ));
    }
    
    // Also run verification
    const verification = await reminderScheduler.verifyDocumentStatuses(id);
    
    res.status(200).json(formatResponse(
      200,
      'Document status refreshed successfully',
      {
        documentId: id,
        refreshedAt: new Date().toISOString(),
        document: {
          status: refreshedDocument.status,
          recipients: refreshedDocument.recipients.map(r => ({
            email: r.email,
            name: r.name,
            status: r.status,
            order: r.order,
            signedAt: r.signedAt,
            lastReminderSent: r.lastReminderSent,
            lastSigningUrlAccessed: r.lastSigningUrlAccessed
          }))
        },
        verification: verification
      }
    ));

  } catch (error) {
    logger.error(`❌ Error force refreshing document ${req.params.id}:`, error.message);
    next(error);
  }
});

/**
 * Test reminder execution without scheduling
 * @route POST /api/documents/:id/test-reminder
 */
router.post('/:id/test-reminder', authenticateApiKey, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { message = 'Test reminder' } = req.body;
    
    logger.info(`🧪 Testing reminder execution for document: ${id}`);
    
    // Create a mock reminder
    const mockReminder = {
      documentId: id,
      type: 'test',
      message: message
    };
    
    const result = await reminderScheduler.executeReminder(mockReminder);
    
    res.status(200).json(formatResponse(
      200,
      'Reminder test completed',
      {
        documentId: id,
        testedAt: new Date().toISOString(),
        result: result
      }
    ));

  } catch (error) {
    logger.error(`❌ Error testing reminder for document ${req.params.id}:`, error.message);
    next(error);
  }
});

module.exports = router;
