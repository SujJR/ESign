#!/usr/bin/env node

/**
 * Adobe Sign Native Reminder Helper
 * This script provides instructions and direct links to send reminders via Adobe Sign's web interface
 * 
 * Enhanced with direct API calls to fix status issues and send reminders programmatically
 */

require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const fs = require('fs');

// Configuration
const BASE_URL = 'http://localhost:3000/api';
const API_KEY = process.env.API_KEY || 'ak_8e5b295f_8e5b295f5cb6d02a1c4b1f741ae7e8aba6451ee363ac7cf563f171513fa3700f';

// Detect if running in direct mode
const DIRECT_MODE = process.argv.includes('--direct');
const DOCUMENT_ID = process.argv.find((arg, index) => 
  process.argv[index - 1] === '--document-id' || process.argv[index - 1] === '-d'
);
const ACTION = process.argv.find((arg, index) => 
  process.argv[index - 1] === '--action' || process.argv[index - 1] === '-a'
);

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

/**
 * Direct API interaction to fix status issues
 */
async function directAPIFix(documentId, action) {
  try {
    log('\n🔧 DIRECT API FIX MODE', 'cyan');
    log('='.repeat(60), 'cyan');
    
    // Dynamically import required modules to avoid errors if not found
    let Document, createAdobeSignClient;
    try {
      Document = require('./src/models/document.model');
      createAdobeSignClient = require('./src/config/adobeSign').createAdobeSignClient;
      
      // Connect to MongoDB
      const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/esign';
      await mongoose.connect(MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      log('✅ Connected to MongoDB', 'green');
    } catch (importError) {
      log(`❌ Error importing required modules: ${importError.message}`, 'red');
      log('Make sure you\'re running this script from the project root directory', 'yellow');
      process.exit(1);
    }
    
    // Fetch document
    const document = await Document.findById(documentId);
    if (!document) {
      log(`❌ Document not found with ID: ${documentId}`, 'red');
      await mongoose.disconnect();
      return;
    }
    
    log(`📄 Document: ${document.originalName}`, 'blue');
    log(`📝 Status: ${document.status}`, 'blue');
    log(`🆔 Adobe Agreement ID: ${document.adobeAgreementId || 'None'}`, 'blue');
    
    if (!document.adobeAgreementId) {
      log('❌ This document has no Adobe Agreement ID', 'red');
      await mongoose.disconnect();
      return;
    }
    
    // Connect to Adobe Sign API
    const adobeSignClient = await createAdobeSignClient();
    
    // Perform the requested action
    switch (action) {
      case 'check-status':
        await checkAgreementStatus(adobeSignClient, document);
        break;
      case 'update-status':
        await updateAgreementStatus(adobeSignClient, document);
        break;
      case 'send-reminders':
        await sendReminders(adobeSignClient, document);
        break;
      case 'get-signing-urls':
        await getSigningUrls(adobeSignClient, document);
        break;
      default:
        log(`❌ Unknown action: ${action}`, 'red');
        log('Available actions: check-status, update-status, send-reminders, get-signing-urls', 'yellow');
    }
    
    // Disconnect from MongoDB
    await mongoose.disconnect();
    log('✅ Disconnected from MongoDB', 'green');
    
  } catch (error) {
    log(`❌ Error in direct API fix: ${error.message}`, 'red');
    if (error.response) {
      log(`Status: ${error.response.status}`, 'red');
      log(`Response: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
    }
    
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // Ignore disconnect errors
    }
  }
}

/**
 * Check agreement status and display details
 */
async function checkAgreementStatus(adobeSignClient, document) {
  log('\n🔍 CHECKING AGREEMENT STATUS', 'cyan');
  log('='.repeat(60), 'cyan');
  
  // Get agreement details
  const agreementResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}`);
  const agreementData = agreementResponse.data;
  
  log(`Adobe Sign Status: ${agreementData.status}`, 'blue');
  log(`Local Document Status: ${document.status}`, 'blue');
  
  // Check for status mismatch
  if (agreementData.status === 'SIGNED' && document.status !== 'completed') {
    log('⚠️ Status mismatch: Adobe says SIGNED but local status is not completed', 'yellow');
  }
  
  // Get events
  const eventsResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/events`);
  const events = eventsResponse.data.events || [];
  
  const signEvents = events.filter(event => event.type === 'ESIGNED');
  log(`\nSignature Events: ${signEvents.length}`, 'green');
  
  signEvents.forEach(event => {
    log(`• ${event.participantEmail} signed on ${new Date(event.date).toLocaleString()}`, 'green');
  });
  
  // Display recipient status
  log('\nRecipient Status:', 'cyan');
  log('-'.repeat(80));
  log('| Name                 | Email                | Adobe Status    | Local Status    | Signed At         |');
  log('-'.repeat(80));
  
  let adobeStatus = {};
  if (agreementData.participantSetsInfo) {
    agreementData.participantSetsInfo.forEach(participantSet => {
      participantSet.memberInfos.forEach(member => {
        adobeStatus[member.email.toLowerCase()] = member.status;
      });
    });
  }
  
  document.recipients.forEach(recipient => {
    const recipientAdobeStatus = adobeStatus[recipient.email.toLowerCase()] || 'UNKNOWN';
    const signedAt = recipient.signedAt ? new Date(recipient.signedAt).toLocaleString() : 'Not signed';
    
    log(`| ${recipient.name.padEnd(20)} | ${recipient.email.padEnd(20)} | ${recipientAdobeStatus.padEnd(15)} | ${recipient.status.padEnd(15)} | ${signedAt.padEnd(18)} |`);
    
    // Check for status mismatches
    if (recipientAdobeStatus === 'SIGNED' && recipient.status !== 'signed') {
      log(`⚠️ Status mismatch for ${recipient.email}: Adobe says SIGNED but local status is ${recipient.status}`, 'yellow');
    }
    
    if (recipient.status === 'signed' && !recipient.signedAt) {
      log(`⚠️ ${recipient.email} is marked as signed but has no signedAt timestamp`, 'yellow');
    }
  });
  
  log('-'.repeat(80));
}

/**
 * Update agreement status from Adobe Sign to local document
 */
async function updateAgreementStatus(adobeSignClient, document) {
  log('\n🔄 UPDATING AGREEMENT STATUS', 'cyan');
  log('='.repeat(60), 'cyan');
  
  // Get agreement details
  const agreementResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}`);
  const agreementData = agreementResponse.data;
  
  log(`Adobe Sign Status: ${agreementData.status}`, 'blue');
  log(`Current Local Status: ${document.status}`, 'blue');
  
  // Get events for signature timestamps
  let events = [];
  try {
    const eventsResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/events`);
    events = eventsResponse.data.events || [];
  } catch (error) {
    log(`⚠️ Could not retrieve events: ${error.message}`, 'yellow');
  }
  
  // Update recipient statuses
  let updatedCount = 0;
  let recipientStatusChanged = false;
  
  if (agreementData.participantSetsInfo) {
    agreementData.participantSetsInfo.forEach(participantSet => {
      participantSet.memberInfos.forEach(member => {
        const recipient = document.recipients.find(r => r.email.toLowerCase() === member.email.toLowerCase());
        
        if (recipient) {
          // Get signed timestamp from events if available
          let signedTimestamp = null;
          if (member.status === 'SIGNED') {
            const signEvent = events.find(event => 
              event.type === 'ESIGNED' && 
              event.participantEmail.toLowerCase() === member.email.toLowerCase()
            );
            
            if (signEvent && signEvent.date) {
              signedTimestamp = new Date(signEvent.date);
            } else {
              signedTimestamp = new Date(); // Use current time if no event found
            }
          }
          
          // Update status if needed
          let statusChanged = false;
          if (member.status === 'SIGNED' && recipient.status !== 'signed') {
            recipient.status = 'signed';
            recipient.signedAt = signedTimestamp || new Date();
            statusChanged = true;
            recipientStatusChanged = true;
          } else if (member.status === 'DECLINED' && recipient.status !== 'declined') {
            recipient.status = 'declined';
            statusChanged = true;
            recipientStatusChanged = true;
          }
          
          if (statusChanged) {
            updatedCount++;
            log(`✅ Updated ${recipient.email}: ${member.status} (Adobe) -> ${recipient.status} (Local)`, 'green');
          }
        }
      });
    });
  }
  
  // Update document status if needed
  let documentStatusChanged = false;
  const oldStatus = document.status;
  
  // Count signed recipients
  const signedCount = document.recipients.filter(r => r.status === 'signed').length;
  const totalRecipients = document.recipients.length;
  
  // If all recipients have signed, mark as completed
  if (signedCount === totalRecipients && totalRecipients > 0 && document.status !== 'completed') {
    document.status = 'completed';
    documentStatusChanged = true;
  }
  // If Adobe says SIGNED but we're not completed, update
  else if (agreementData.status === 'SIGNED' && document.status !== 'completed') {
    document.status = 'completed';
    documentStatusChanged = true;
  }
  // If some have signed but not all, and we're not partially_signed
  else if (signedCount > 0 && signedCount < totalRecipients && document.status !== 'partially_signed') {
    document.status = 'partially_signed';
    documentStatusChanged = true;
  }
  
  // Save changes if needed
  if (documentStatusChanged || recipientStatusChanged) {
    await document.save();
    
    if (documentStatusChanged) {
      log(`✅ Updated document status: ${oldStatus} -> ${document.status}`, 'green');
    }
    
    log(`✅ Saved ${updatedCount} recipient updates and document status changes`, 'green');
  } else {
    log('ℹ️ No status changes needed', 'blue');
  }
}

/**
 * Send reminders to unsigned recipients
 */
async function sendReminders(adobeSignClient, document) {
  log('\n📧 SENDING REMINDERS', 'cyan');
  log('='.repeat(60), 'cyan');
  
  // Find unsigned recipients
  const unsignedRecipients = document.recipients.filter(r => r.status !== 'signed');
  
  if (unsignedRecipients.length === 0) {
    log('✅ No unsigned recipients - all have signed!', 'green');
    return;
  }
  
  log(`Found ${unsignedRecipients.length} unsigned recipients:`, 'blue');
  unsignedRecipients.forEach(recipient => {
    log(`• ${recipient.name} (${recipient.email}) - Status: ${recipient.status}`, 'yellow');
  });
  
  // Try multiple reminder approaches
  let reminderSent = false;
  
  // Approach 1: Standard reminder endpoint (PUT)
  try {
    log('\nAttempting standard reminder (PUT)...', 'blue');
    
    const reminderPayload = {
      agreementId: document.adobeAgreementId,
      comment: 'Please complete your signature for this important document. Your prompt attention is appreciated.'
    };
    
    await adobeSignClient.put(`api/rest/v6/agreements/${document.adobeAgreementId}/reminders`, reminderPayload);
    log('✅ Reminder sent successfully using PUT method', 'green');
    reminderSent = true;
  } catch (putError) {
    log(`⚠️ PUT reminder failed: ${putError.message}`, 'yellow');
    
    // Approach 2: Try POST method
    try {
      log('\nAttempting standard reminder (POST)...', 'blue');
      
      const reminderPayload = {
        agreementId: document.adobeAgreementId,
        comment: 'Please complete your signature for this important document. Your prompt attention is appreciated.'
      };
      
      await adobeSignClient.post(`api/rest/v6/agreements/${document.adobeAgreementId}/reminders`, reminderPayload);
      log('✅ Reminder sent successfully using POST method', 'green');
      reminderSent = true;
    } catch (postError) {
      log(`⚠️ POST reminder failed: ${postError.message}`, 'yellow');
      
      // Approach 3: Try participant-specific reminders
      try {
        log('\nAttempting participant-specific reminders...', 'blue');
        
        // Get agreement details to get participant info
        const agreementResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}`);
        const agreementData = agreementResponse.data;
        
        if (agreementData.participantSetsInfo) {
          for (const participantSet of agreementData.participantSetsInfo) {
            for (const member of participantSet.memberInfos) {
              if (member.status !== 'SIGNED') {
                try {
                  const participantPayload = {
                    participantEmail: member.email,
                    note: 'Please complete your signature for this important document.'
                  };
                  
                  await adobeSignClient.post(`api/rest/v6/agreements/${document.adobeAgreementId}/members/remind`, participantPayload);
                  log(`✅ Reminder sent to ${member.email}`, 'green');
                  reminderSent = true;
                } catch (participantError) {
                  log(`⚠️ Failed to send reminder to ${member.email}: ${participantError.message}`, 'yellow');
                }
              }
            }
          }
        }
      } catch (agreementError) {
        log(`⚠️ Failed to get agreement data: ${agreementError.message}`, 'yellow');
      }
    }
  }
  
  if (reminderSent) {
    // Update reminder timestamps
    unsignedRecipients.forEach(recipient => {
      recipient.lastReminderSent = new Date();
    });
    
    document.lastReminderSent = new Date();
    document.reminderCount = (document.reminderCount || 0) + 1;
    await document.save();
    
    log('\n✅ Updated document with reminder information', 'green');
  } else {
    log('\n❌ All reminder methods failed', 'red');
  }
}

/**
 * Get signing URLs for all recipients
 */
async function getSigningUrls(adobeSignClient, document) {
  log('\n🔗 GETTING SIGNING URLS', 'cyan');
  log('='.repeat(60), 'cyan');
  
  try {
    const signingUrlResponse = await adobeSignClient.get(`api/rest/v6/agreements/${document.adobeAgreementId}/signingUrls`);
    const signingUrlSets = signingUrlResponse.data.signingUrlSetInfos || [];
    
    if (signingUrlSets.length === 0) {
      log('❌ No signing URLs available', 'red');
      return;
    }
    
    log('Signing URLs:', 'blue');
    log('-'.repeat(80));
    log('| Recipient              | Email                         | Signing URL                                    |');
    log('-'.repeat(80));
    
    let urlsUpdated = false;
    
    // Extract and display signing URLs
    signingUrlSets.forEach(urlSet => {
      (urlSet.signingUrls || []).forEach(urlInfo => {
        if (urlInfo.email && urlInfo.esignUrl) {
          // Find recipient in document
          const recipient = document.recipients.find(r => r.email.toLowerCase() === urlInfo.email.toLowerCase());
          
          if (recipient) {
            // Update signing URL in document
            recipient.signingUrl = urlInfo.esignUrl;
            urlsUpdated = true;
            
            // Truncate URL for display
            const displayUrl = urlInfo.esignUrl.length > 40 ? 
              urlInfo.esignUrl.substring(0, 37) + '...' : 
              urlInfo.esignUrl;
            
            log(`| ${recipient.name.padEnd(22)} | ${recipient.email.padEnd(30)} | ${displayUrl.padEnd(47)} |`);
          }
        }
      });
    });
    
    log('-'.repeat(80));
    
    // Save updated URLs
    if (urlsUpdated) {
      await document.save();
      log('✅ Updated signing URLs in document', 'green');
      
      // Ask if user wants to save URLs to file
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      readline.question('Save signing URLs to file? (y/n) ', (answer) => {
        if (answer.toLowerCase() === 'y') {
          const urlData = document.recipients.map(recipient => ({
            name: recipient.name,
            email: recipient.email,
            status: recipient.status,
            signingUrl: recipient.signingUrl || 'No URL available'
          }));
          
          const filename = `signing_urls_${document._id}.json`;
          fs.writeFileSync(filename, JSON.stringify(urlData, null, 2));
          log(`✅ Saved signing URLs to ${filename}`, 'green');
        }
        
        readline.close();
      });
    } else {
      log('ℹ️ No signing URLs found for recipients', 'blue');
    }
  } catch (error) {
    log(`❌ Error getting signing URLs: ${error.message}`, 'red');
    if (error.response) {
      log(`Status: ${error.response.status}`, 'red');
      log(`Response: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
    }
  }
}
    
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
