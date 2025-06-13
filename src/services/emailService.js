const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

/**
 * Email Service for sending notifications
 */
class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
    this.initializeTransporter();
  }

  /**
   * Initialize email transporter based on environment variables
   */
  initializeTransporter() {
    try {
      // Check if email configuration is provided
      const emailConfig = {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      };

      // If no SMTP config is provided, use a test account or disable email
      if (!emailConfig.host || !emailConfig.auth.user || !emailConfig.auth.pass) {
        logger.warn('Email service not configured - SMTP credentials missing');
        logger.info('To enable email reminders, add these environment variables:');
        logger.info('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE');
        
        // For development, you can use Ethereal Email (test email service)
        if (process.env.NODE_ENV === 'development') {
          logger.info('Using Ethereal Email for development testing');
          this.createTestAccount();
          return;
        }
        
        this.isConfigured = false;
        return;
      }

      this.transporter = nodemailer.createTransporter(emailConfig);
      this.isConfigured = true;
      
      // Verify connection
      this.transporter.verify((error, success) => {
        if (error) {
          logger.error(`Email service configuration error: ${error.message}`);
          this.isConfigured = false;
        } else {
          logger.info('Email service ready for sending reminders');
        }
      });

    } catch (error) {
      logger.error(`Failed to initialize email service: ${error.message}`);
      this.isConfigured = false;
    }
  }

  /**
   * Create test account for development (Ethereal Email)
   */
  async createTestAccount() {
    try {
      const testAccount = await nodemailer.createTestAccount();
      
      this.transporter = nodemailer.createTransporter({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      
      this.isConfigured = true;
      logger.info(`Test email account created: ${testAccount.user}`);
      logger.info('Emails will be captured at: https://ethereal.email/');
      
    } catch (error) {
      logger.error(`Failed to create test email account: ${error.message}`);
      this.isConfigured = false;
    }
  }

  /**
   * Send reminder email to a recipient
   * @param {Object} options - Email options
   * @param {string} options.to - Recipient email
   * @param {string} options.recipientName - Recipient name
   * @param {string} options.documentName - Document name
   * @param {string} options.message - Custom reminder message
   * @param {string} options.signingUrl - Direct signing URL (optional)
   * @returns {Promise<Object>} - Email sending result
   */
  async sendReminderEmail(options) {
    if (!this.isConfigured) {
      logger.warn('Email service not configured - skipping email reminder');
      return { 
        success: false, 
        error: 'Email service not configured',
        fallback: 'Adobe Sign API reminder sent instead'
      };
    }

    const { to, recipientName, documentName, message, signingUrl } = options;

    try {
      // Create email content
      const emailSubject = `Reminder: Please sign "${documentName}"`;
      
      const emailHtml = this.generateReminderEmailHtml({
        recipientName: recipientName || 'Valued Recipient',
        documentName,
        message: message || 'Please complete your signature for this important document. Your prompt attention is appreciated.',
        signingUrl
      });

      const emailText = this.generateReminderEmailText({
        recipientName: recipientName || 'Valued Recipient',
        documentName,
        message: message || 'Please complete your signature for this important document. Your prompt attention is appreciated.',
        signingUrl
      });

      // Send email
      const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@esign.com',
        to: to,
        subject: emailSubject,
        text: emailText,
        html: emailHtml
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      logger.info(`✅ Reminder email sent to ${to} for document: ${documentName}`);
      
      // For development with Ethereal, log the preview URL
      if (process.env.NODE_ENV === 'development' && result.messageId) {
        const previewUrl = nodemailer.getTestMessageUrl(result);
        if (previewUrl) {
          logger.info(`📧 Email preview: ${previewUrl}`);
        }
      }

      return {
        success: true,
        messageId: result.messageId,
        recipient: to,
        previewUrl: process.env.NODE_ENV === 'development' ? nodemailer.getTestMessageUrl(result) : null
      };

    } catch (error) {
      logger.error(`Failed to send reminder email to ${to}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        recipient: to
      };
    }
  }

  /**
   * Generate HTML email template for reminder
   */
  generateReminderEmailHtml({ recipientName, documentName, message, signingUrl }) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Document Signature Reminder</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #007bff; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background-color: #f8f9fa; padding: 30px; border-radius: 0 0 5px 5px; }
            .button { display: inline-block; background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .button:hover { background-color: #218838; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 14px; color: #6c757d; }
            .document-name { font-weight: bold; color: #007bff; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>📝 Document Signature Reminder</h1>
        </div>
        <div class="content">
            <p>Dear ${recipientName},</p>
            
            <p>${message}</p>
            
            <p><strong>Document:</strong> <span class="document-name">${documentName}</span></p>
            
            ${signingUrl ? `
            <p>You can sign the document by clicking the button below:</p>
            <p style="text-align: center;">
                <a href="${signingUrl}" class="button">Sign Document</a>
            </p>
            <p><em>If the button doesn't work, copy and paste this URL into your browser:</em><br>
            <a href="${signingUrl}" style="word-break: break-all;">${signingUrl}</a></p>
            ` : `
            <p>Please check your previous emails for the signing link, or contact the sender if you need assistance accessing the document.</p>
            `}
            
            <p>Thank you for your prompt attention to this matter.</p>
            
            <div class="footer">
                <p>This is an automated reminder from the E-Signature System.<br>
                Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>`;
  }

  /**
   * Generate plain text email for reminder
   */
  generateReminderEmailText({ recipientName, documentName, message, signingUrl }) {
    return `
Document Signature Reminder

Dear ${recipientName},

${message}

Document: ${documentName}

${signingUrl ? `
You can sign the document using this link:
${signingUrl}
` : `
Please check your previous emails for the signing link, or contact the sender if you need assistance accessing the document.
`}

Thank you for your prompt attention to this matter.

---
This is an automated reminder from the E-Signature System.
Please do not reply to this email.
    `.trim();
  }

  /**
   * Send reminder emails to multiple recipients
   * @param {Array} recipients - Array of recipient objects
   * @param {string} documentName - Document name
   * @param {string} message - Custom reminder message
   * @returns {Promise<Array>} - Array of email sending results
   */
  async sendReminderEmails(recipients, documentName, message) {
    if (!this.isConfigured) {
      logger.warn('Email service not configured - skipping bulk email reminders');
      return recipients.map(recipient => ({
        success: false,
        error: 'Email service not configured',
        recipient: recipient.email,
        fallback: 'Adobe Sign API reminder sent instead'
      }));
    }

    const results = [];

    for (const recipient of recipients) {
      try {
        const result = await this.sendReminderEmail({
          to: recipient.email,
          recipientName: recipient.name,
          documentName,
          message,
          signingUrl: recipient.signingUrl || null
        });

        results.push({
          ...result,
          recipient: recipient.email
        });

        // Add a small delay to avoid overwhelming the SMTP server
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        logger.error(`Failed to send reminder to ${recipient.email}: ${error.message}`);
        results.push({
          success: false,
          error: error.message,
          recipient: recipient.email
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    logger.info(`📧 Bulk reminder emails: ${successCount}/${recipients.length} sent successfully`);

    return results;
  }

  /**
   * Test email configuration
   * @returns {Promise<Object>} - Test result
   */
  async testEmailConfiguration() {
    if (!this.isConfigured) {
      return {
        success: false,
        error: 'Email service not configured'
      };
    }

    try {
      const testResult = await this.transporter.verify();
      return {
        success: true,
        message: 'Email service is properly configured and ready to send emails'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Export singleton instance
module.exports = new EmailService();
