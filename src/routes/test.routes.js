/**
 * Quick test to verify the status fixes are working
 */

const express = require('express');
const router = express.Router();
const Document = require('../models/document.model');
const { getAccessToken, getComprehensiveAgreementInfo } = require('../config/adobeSign');
const { formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');

/**
 * Quick test endpoint to verify status updates
 * @route GET /api/test/status/:id
 */
router.get('/status/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    logger.info(`🧪 Testing status update for document: ${id}`);
    
    // Get document
    const document = await Document.findById(id);
    if (!document || !document.adobeAgreementId) {
      return res.status(404).json({ error: 'Document not found or no agreement ID' });
    }
    
    logger.info(`📋 Before update - Recipients:`);
    document.recipients.forEach((r, i) => {
      logger.info(`  ${i+1}. ${r.email}: status=${r.status}, signedAt=${r.signedAt}, lastAccessed=${r.lastSigningUrlAccessed}`);
    });
    
    // Get Adobe Sign data
    const accessToken = await getAccessToken();
    const agreementInfo = await getComprehensiveAgreementInfo(accessToken, document.adobeAgreementId);
    
    logger.info(`📊 Adobe agreement status: ${agreementInfo.status}`);
    
    if (agreementInfo.participantSets) {
      logger.info(`📊 Found ${agreementInfo.participantSets.length} participant sets`);
      
      let updateCount = 0;
      
      agreementInfo.participantSets.forEach((set, i) => {
        if (set.memberInfos) {
          set.memberInfos.forEach((member, j) => {
            logger.info(`📊 Adobe member: ${member.email} -> ${member.status} (completed: ${member.completedDate})`);
            
            const recipient = document.recipients.find(r => 
              r.email.toLowerCase() === member.email.toLowerCase()
            );
            
            if (recipient) {
              const oldStatus = recipient.status;
              
              // Apply our enhanced status mapping
              let newStatus = 'sent';
              const adobeStatus = member.status;
              
              if (['SIGNED', 'COMPLETED', 'APPROVED', 'ACCEPTED', 'FORM_FILLED'].includes(adobeStatus)) {
                newStatus = 'signed';
                
                // Set signedAt timestamp
                const possibleSigningDates = [
                  member.completedDate,
                  member.statusUpdateDate,
                  member.signedDate,
                  member.lastModified,
                  member.dateCompleted,
                  member.dateSigned
                ].filter(date => date);
                
                if (possibleSigningDates.length > 0) {
                  const latestDate = new Date(Math.max(...possibleSigningDates.map(d => new Date(d).getTime())));
                  if (!recipient.signedAt || latestDate > recipient.signedAt) {
                    recipient.signedAt = latestDate;
                    logger.info(`✅ Set signedAt for ${recipient.email}: ${recipient.signedAt}`);
                  }
                } else if (!recipient.signedAt) {
                  recipient.signedAt = new Date();
                  logger.info(`✅ Set signedAt for ${recipient.email} to current time`);
                }
              }
              
              // Set lastSigningUrlAccessed
              const possibleAccessDates = [
                member.accessDate,
                member.lastViewedDate,
                member.viewDate,
                member.lastAccessDate,
                member.dateViewed,
                member.dateAccessed,
                member.emailDate,
                member.statusUpdateDate
              ].filter(date => date);
              
              if (possibleAccessDates.length > 0) {
                const latestAccessDate = new Date(Math.max(...possibleAccessDates.map(d => new Date(d).getTime())));
                if (!recipient.lastSigningUrlAccessed || latestAccessDate > recipient.lastSigningUrlAccessed) {
                  recipient.lastSigningUrlAccessed = latestAccessDate;
                  logger.info(`✅ Set lastSigningUrlAccessed for ${recipient.email}: ${recipient.lastSigningUrlAccessed}`);
                }
              }
              
              if (oldStatus !== newStatus) {
                recipient.status = newStatus;
                updateCount++;
                logger.info(`✅ Updated status for ${recipient.email}: ${oldStatus} -> ${newStatus}`);
              }
            }
          });
        }
      });
      
      if (updateCount > 0) {
        await document.save();
        logger.info(`✅ Saved document with ${updateCount} updates`);
      }
    }
    
    logger.info(`📋 After update - Recipients:`);
    document.recipients.forEach((r, i) => {
      logger.info(`  ${i+1}. ${r.email}: status=${r.status}, signedAt=${r.signedAt}, lastAccessed=${r.lastSigningUrlAccessed}`);
    });
    
    res.json(formatResponse(
      200,
      'Status test completed',
      {
        documentId: id,
        adobeStatus: agreementInfo.status,
        recipients: document.recipients.map(r => ({
          email: r.email,
          status: r.status,
          signedAt: r.signedAt,
          lastSigningUrlAccessed: r.lastSigningUrlAccessed
        }))
      }
    ));
    
  } catch (error) {
    logger.error(`❌ Test failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
