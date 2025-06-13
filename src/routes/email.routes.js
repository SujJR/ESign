const express = require('express');
const emailService = require('../services/emailService');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const { authenticateApiKey, requirePermissions } = require('../middleware/apiKeyAuth');

const router = express.Router();

// Apply API key authentication to all routes
router.use(authenticateApiKey);

/**
 * Test email configuration
 * @route GET /api/email/test
 */
router.get('/test', requirePermissions(['admin:all']), async (req, res, next) => {
  try {
    const testResult = await emailService.testEmailConfiguration();
    
    res.status(200).json(formatResponse(
      200,
      testResult.success ? 'Email service is configured and working' : 'Email service configuration issue',
      {
        emailService: {
          configured: testResult.success,
          error: testResult.error || null,
          message: testResult.message || null
        }
      }
    ));
  } catch (error) {
    next(error);
  }
});

/**
 * Send test reminder email
 * @route POST /api/email/test-reminder
 */
router.post('/test-reminder', requirePermissions(['admin:all']), async (req, res, next) => {
  try {
    const { email, name } = req.body;
    
    if (!email) {
      return next(new ApiError(400, 'Email address is required'));
    }

    const result = await emailService.sendReminderEmail({
      to: email,
      recipientName: name || 'Test Recipient',
      documentName: 'Test Document - Email Configuration',
      message: 'This is a test reminder email to verify that the email service is working correctly.',
      signingUrl: 'https://example.com/sign/test'
    });

    res.status(200).json(formatResponse(
      200,
      result.success ? 'Test reminder email sent successfully' : 'Failed to send test reminder email',
      {
        emailTest: {
          success: result.success,
          recipient: email,
          messageId: result.messageId || null,
          previewUrl: result.previewUrl || null,
          error: result.error || null
        }
      }
    ));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
