#!/usr/bin/env node

/**
 * Adobe Sign Native Reminder Helper
 * This script provides instructions and direct links to send reminders via Adobe Sign's web interface
 */

const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:3000/api';
const API_KEY = process.env.API_KEY || 'ak_8e5b295f_8e5b295f5cb6d02a1c4b1f741ae7e8aba6451ee363ac7cf563f171513fa3700f';

function log(message, color = 'reset') {
  const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    reset: '\x1b[0m'
  };
  console.log(colors[color] + message + colors.reset);
}

async function generateReminderInstructions() {
  log('📧 ADOBE SIGN NATIVE REMINDER HELPER', 'cyan');
  log('='.repeat(60), 'cyan');
  
  try {
    // Get documents that need reminders
    log('\n1️⃣ Retrieving documents that need reminders...', 'yellow');
    const documentsResponse = await axios.get(`${BASE_URL}/documents`, {
      headers: { 'X-API-Key': API_KEY }
    });
    
    const documents = documentsResponse.data.data.documents;
    const reminderableDocuments = documents.filter(doc => 
      doc.adobeAgreementId && 
      ['sent_for_signature', 'partially_signed'].includes(doc.status) &&
      doc.recipients && doc.recipients.some(r => !r.signedAt)
    );
    
    if (reminderableDocuments.length === 0) {
      log('✅ No documents need reminders - all recipients have signed!', 'green');
      return;
    }
    
    log(`📄 Found ${reminderableDocuments.length} document(s) that need reminders`, 'blue');
    
    // Generate instructions for each document
    log('\n2️⃣ REMINDER INSTRUCTIONS:', 'cyan');
    log('=' * 40, 'cyan');
    
    reminderableDocuments.forEach((doc, index) => {
      log(`\n📋 Document ${index + 1}: ${doc.originalName}`, 'magenta');
      log(`   Status: ${doc.status}`, 'blue');
      log(`   Adobe Agreement ID: ${doc.adobeAgreementId}`, 'blue');
      
      // Show unsigned recipients
      const unsignedRecipients = doc.recipients.filter(r => !r.signedAt);
      log(`   📧 Unsigned recipients (${unsignedRecipients.length}):`, 'yellow');
      unsignedRecipients.forEach((recipient, i) => {
        log(`      ${i + 1}. ${recipient.email}`, 'yellow');
      });
      
      log('\n   🔗 REMINDER METHODS:', 'green');
      log('   ─'.repeat(30), 'green');
      
      // Method 1: Adobe Sign Web Interface
      log('   📱 METHOD 1: Adobe Sign Web Interface (RECOMMENDED)', 'green');
      log('      1. Go to: https://echosign.adobe.com/', 'blue');
      log('      2. Click "Manage" tab', 'blue');
      log('      3. Find this agreement:', 'blue');
      log(`         "${doc.originalName}"`, 'blue');
      log(`         ID: ${doc.adobeAgreementId}`, 'blue');
      log('      4. Click "Send Reminder"', 'blue');
      log('      5. Adobe will email all unsigned recipients automatically', 'blue');
      
      // Method 2: Direct Adobe Sign URL (if possible)
      log('\n   🌐 METHOD 2: Direct Link (if available)', 'green');
      log(`      https://echosign.adobe.com/agreements/${doc.adobeAgreementId}`, 'blue');
      
      // Method 3: Manual Email Template
      log('\n   ✉️  METHOD 3: Manual Email Template', 'green');
      log('      Copy and send this email to unsigned recipients:', 'blue');
      
      const emailTemplate = `
Subject: Reminder: Please sign "${doc.originalName}"

Dear Recipient,

This is a friendly reminder that you have a document waiting for your signature.

Document: ${doc.originalName}
Status: Pending your signature

Please check your previous emails from Adobe Sign for the signing link, or contact the sender if you need assistance.

Thank you for your prompt attention.

Best regards,
Document Management System`;
      
      log(emailTemplate, 'cyan');
      
      log('\n   ' + '─'.repeat(50), 'green');
    });
    
    // Summary instructions
    log('\n3️⃣ SUMMARY - BEST PRACTICES:', 'cyan');
    log('=' * 40, 'cyan');
    log('✅ Use Adobe Sign web interface for reliable reminders', 'green');
    log('✅ Adobe handles email delivery, tracking, and formatting', 'green');
    log('✅ Recipients get professional emails with direct signing links', 'green');
    log('✅ No risk of emails going to spam (Adobe\'s verified servers)', 'green');
    log('✅ Automatic retry logic if emails bounce', 'green');
    
    log('\n📞 Need help? Contact Adobe Sign support:', 'yellow');
    log('   https://helpx.adobe.com/sign/help/contact-support.html', 'blue');
    
  } catch (error) {
    log(`❌ Error: ${error.message}`, 'red');
    if (error.response) {
      log(`Status: ${error.response.status}`, 'red');
    }
  }
}

async function showQuickReminderGuide() {
  log('\n🚀 QUICK REMINDER GUIDE', 'cyan');
  log('=' * 30, 'cyan');
  log('1. Open Adobe Sign: https://echosign.adobe.com/', 'blue');
  log('2. Go to "Manage" tab', 'blue');
  log('3. Find documents with "Out for Signature" status', 'blue');
  log('4. Click on document → "Send Reminder"', 'blue');
  log('5. Adobe automatically emails unsigned recipients', 'blue');
  
  log('\n💡 Why this works better than API:', 'yellow');
  log('• Adobe Sign web interface is always up-to-date', 'green');
  log('• No API rate limits or authentication issues', 'green');
  log('• Better email deliverability through Adobe\'s servers', 'green');
  log('• Automatic handling of edge cases and errors', 'green');
  log('• Professional email templates and branding', 'green');
}

// Run the helper
if (require.main === module) {
  showQuickReminderGuide();
  
  setTimeout(() => {
    generateReminderInstructions()
      .then(() => {
        log('\n🎉 Reminder instructions generated successfully!', 'green');
        log('💡 Use Adobe Sign\'s web interface for the most reliable reminders.', 'blue');
        process.exit(0);
      })
      .catch(error => {
        log(`❌ Error: ${error.message}`, 'red');
        process.exit(1);
      });
  }, 1000);
}

module.exports = { generateReminderInstructions };
