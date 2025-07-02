/**
 * Advanced Reminder Scheduling System for Adobe Sign Documents
 */

const logger = require('../utils/logger');
const Document = require('../models/document.model');
const { getComprehensiveAgreementInfo, getAccessToken, sendReminder } = require('../config/adobeSign');

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
      // First, force comprehensive refresh of the document status from Adobe Sign
      const document = await this.forceStatusRefresh(documentId);
      if (!document || !document.adobeAgreementId) {
        logger.error(`❌ Document ${documentId} not found or has no agreement ID`);
        throw new Error('Document not found or not sent for signature');
      }

      logger.info(`📅 Scheduling intelligent reminders for document: ${documentId}`);

      // Clear any existing reminders for this document
      this.clearDocumentReminders(documentId);

      // Get current agreement status
      const accessToken = await getAccessToken();
      const agreementInfo = await getComprehensiveAgreementInfo(accessToken, document.adobeAgreementId);

      if (!agreementInfo || !this.isReminderEligible(agreementInfo.status)) {
        logger.info(`📋 Document ${documentId} not eligible for reminders (status: ${agreementInfo?.status})`);
        return;
      }
      
      // Get verification report to check for any status issues
      const verificationReport = await this.verifyDocumentStatuses(documentId);
      
      if (verificationReport.success) {
        // Log status discrepancies if any
        if (verificationReport.discrepancies && verificationReport.discrepancies.length > 0) {
          logger.warn(`⚠️ Found ${verificationReport.discrepancies.length} status discrepancies - will fix before scheduling reminders`);
          
          // Force another status update
          await this.updateDocumentRecipientStatuses(document, agreementInfo);
        }
        
        // If sequential, log current signer
        if (verificationReport.signingFlow === 'SEQUENTIAL' && verificationReport.currentSigner) {
          logger.info(`Current signer: ${verificationReport.currentSigner.name} <${verificationReport.currentSigner.email}> (status: ${verificationReport.currentSigner.status})`);
        }
      } else {
        logger.warn(`⚠️ Verification failed: ${verificationReport.error}`);
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
   * Execute a scheduled reminder with improved status checking
   */
  async executeReminder(reminder) {
    try {
      logger.info(`🔔 Executing ${reminder.type} reminder for document ${reminder.documentId}`);

      // First, force a comprehensive status refresh from Adobe Sign
      const updatedDocument = await this.forceStatusRefresh(reminder.documentId);
      if (!updatedDocument) {
        logger.error(`❌ Document not found or failed to refresh status: ${reminder.documentId}`);
        return { success: false, error: 'Document not found' };
      }
      
      // Get fresh Adobe Sign data
      const accessToken = await getAccessToken();
      const agreementInfo = await getComprehensiveAgreementInfo(accessToken, updatedDocument.adobeAgreementId);
      
      if (!agreementInfo || !agreementInfo.status) {
        logger.error(`❌ Failed to get valid agreement info for document ${reminder.documentId}`);
        return { success: false, error: 'Failed to get agreement info' };
      }
      
      // Check if document still needs reminders
      if (!this.isReminderEligible(agreementInfo.status)) {
        logger.info(`📋 Document ${reminder.documentId} no longer needs reminders (status: ${agreementInfo.status})`);
        this.clearDocumentReminders(reminder.documentId);
        return { success: true, reminderSent: false, reason: 'Document no longer eligible for reminders' };
      }
      
      // Define who needs reminders
      let recipientsToRemind = [];
      const isSequential = this.isSequentialSigning(agreementInfo);
      
      logger.info(`Document uses ${isSequential ? 'SEQUENTIAL' : 'PARALLEL'} signing flow`);
      
      if (isSequential) {
        // SEQUENTIAL FLOW: Only remind the current active signer
        logger.info(`📋 Sequential signing flow detected`);
        
        // Get participant sets from Adobe Sign (this is the source of truth)
        const participantSets = agreementInfo.participants?.participantSets || 
                               agreementInfo.participantSets || 
                               [];
        
        if (!participantSets || participantSets.length === 0) {
          logger.warn(`⚠️ No participant sets found in Adobe Sign response`);
          return { success: false, error: 'No participant sets found' };
        }
        
        // Sort participant sets by order
        const sortedSets = [...participantSets]
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        
        logger.info(`📋 Adobe Sign participant sets by order:`);
        sortedSets.forEach((set, i) => {
          const memberEmails = set.memberInfos?.map(m => m.email).join(', ') || 'No members';
          logger.info(`  ${i+1}. Order ${set.order}, Status: ${set.status}, Members: ${memberEmails}`);
        });
        
        // Find the current active signer based on Adobe Sign status
        let currentActiveSet = null;
        
        for (const participantSet of sortedSets) {
          const setStatus = participantSet.status;
          const setOrder = participantSet.order || 0;
          
          logger.info(`Checking set order ${setOrder} with status: ${setStatus}`);
          
          // In sequential signing, the current active signer has WAITING_FOR_MY_SIGNATURE status
          if (['WAITING_FOR_MY_SIGNATURE', 'WAITING_FOR_MY_APPROVAL', 'OUT_FOR_SIGNATURE'].includes(setStatus)) {
            // This is the current active set
            currentActiveSet = participantSet;
            logger.info(`  🎯 Current active set identified: order ${setOrder}, status ${setStatus}`);
            break;
          } else if (['WAITING_FOR_OTHERS', 'SIGNED', 'COMPLETED'].includes(setStatus)) {
            // This set has completed signing, continue to next
            logger.info(`  ✅ Set order ${setOrder} has completed (${setStatus})`);
            continue;
          } else if (['NOT_YET_VISIBLE', 'WAITING'].includes(setStatus)) {
            // This set is waiting for previous sets to complete
            logger.info(`  ⏳ Set order ${setOrder} is waiting for previous sets (${setStatus})`);
            continue;
          } else {
            // Unknown status, log and continue
            logger.warn(`  ❓ Unknown set status: ${setStatus} for order ${setOrder}`);
            continue;
          }
        }
        
        if (currentActiveSet && currentActiveSet.memberInfos) {
          logger.info(`Current active set: order ${currentActiveSet.order}, status ${currentActiveSet.status}`);
          
          // Get all members from the current active set
          for (const member of currentActiveSet.memberInfos) {
            if (!member.email) continue;
            
            const memberStatus = member.status;
            logger.info(`Checking member ${member.email} with status: ${memberStatus}`);
            
            // Check if this member actually needs a reminder
            if (['WAITING_FOR_MY_SIGNATURE', 'WAITING_FOR_MY_APPROVAL', 'OUT_FOR_SIGNATURE', 'ACTION_REQUESTED', 'SENT', 'ACTIVE', 'WAITING_FOR_VERIFICATION', 'WAITING_FOR_FAXING', 'WAITING_FOR_COUNTER_SIGNATURE', 'WAITING_FOR_MY_REVIEW', 'WAITING_FOR_MY_ACKNOWLEDGEMENT', 'DELEGATED'].includes(memberStatus)) {
              // Add the member info with participant set data
              const participantToRemind = {
                ...member,
                participantSetId: currentActiveSet.id,
                setOrder: currentActiveSet.order,
                setStatus: currentActiveSet.status
              };
              
              recipientsToRemind.push(participantToRemind);
              logger.info(`✅ Will send reminder to: ${member.email} (Adobe status: ${memberStatus})`);
            } else if (['SIGNED', 'COMPLETED'].includes(memberStatus)) {
              logger.info(`  ✅ ${member.email} has already signed (${memberStatus})`);
            } else {
              logger.info(`  ⏸️ ${member.email} is not ready for reminder (${memberStatus})`);
            }
          }
        } else {
          logger.info(`📋 No current active set found - all may have signed or document is complete`);
        }
      } else {
        // PARALLEL FLOW: Remind all unsigned recipients based on Adobe Sign status
        logger.info(`📋 Parallel signing flow detected`);
        
        // Get participant sets from Adobe Sign
        const participantSets = agreementInfo.participants?.participantSets || 
                               agreementInfo.participantSets || 
                               [];
        
        if (!participantSets || participantSets.length === 0) {
          logger.warn(`⚠️ No participant sets found in Adobe Sign response`);
          return { success: false, error: 'No participant sets found' };
        }
        
        logger.info(`Found ${participantSets.length} participant sets in parallel flow`);
        
        // Check each participant set for members who need reminders
        for (const participantSet of participantSets) {
          if (!participantSet.memberInfos) continue;
          
          for (const member of participantSet.memberInfos) {
            if (!member.email) continue;
            
            const memberStatus = member.status;
            const setStatus = participantSet.status;
            
            logger.info(`Checking ${member.email}: member status=${memberStatus}, set status=${setStatus}`);
            
            // Check if this member needs a reminder based on Adobe Sign status
            if (['WAITING_FOR_MY_SIGNATURE', 'WAITING_FOR_MY_APPROVAL', 'OUT_FOR_SIGNATURE', 'ACTION_REQUESTED', 'SENT', 'ACTIVE', 'WAITING_FOR_VERIFICATION', 'WAITING_FOR_FAXING', 'WAITING_FOR_COUNTER_SIGNATURE', 'WAITING_FOR_MY_REVIEW', 'WAITING_FOR_MY_ACKNOWLEDGEMENT', 'DELEGATED'].includes(memberStatus)) {
              // Add the member info with participant set data
              const participantToRemind = {
                ...member,
                participantSetId: participantSet.id,
                setOrder: participantSet.order,
                setStatus: participantSet.status
              };
              
              recipientsToRemind.push(participantToRemind);
              logger.info(`✅ Will send reminder to: ${member.email} (Adobe status: ${memberStatus})`);
            } else if (['SIGNED', 'COMPLETED'].includes(memberStatus)) {
              logger.info(`  ✅ ${member.email} has already signed (${memberStatus})`);
            } else {
              logger.info(`  ⏸️ ${member.email} is not ready for reminder (${memberStatus})`);
            }
          }
        }
      }
      
      // Send reminders if we have recipients
      if (recipientsToRemind.length > 0) {
        // Extract participant IDs - try multiple possible ID fields
        const participantIds = [];
        
        for (const participant of recipientsToRemind) {
          // Use the member ID (participant.id) which is the correct ID for reminders
          // NOT the participantSetId which is the ID of the set
          const participantId = participant.id;              // member ID (correct for reminders)
          
          if (participantId) {
            participantIds.push(participantId);
            logger.info(`✅ Adding member ID for ${participant.email}: ${participantId}`);
          } else {
            logger.warn(`⚠️ No member ID found for ${participant.email}`);
            logger.warn(`Available fields:`, Object.keys(participant));
            
            // Fall back to other possible ID fields as backup
            const fallbackId = participant.participantId ||     // legacy participant ID
                              participant.userId;              // user ID
            
            if (fallbackId) {
              participantIds.push(fallbackId);
              logger.info(`⚠️ Using fallback ID for ${participant.email}: ${fallbackId}`);
            }
          }
        }
        
        logger.info(`🔍 Extracted ${participantIds.length} member IDs for reminders: ${participantIds.join(', ')}`);
        
        if (participantIds.length > 0) {
          try {
            logger.info(`🔔 Sending ${reminder.type} reminder to ${participantIds.length} recipients with IDs: ${participantIds.join(', ')}`);
            
            await sendReminder(
              accessToken,
              updatedDocument.adobeAgreementId,
              reminder.message,
              participantIds
            );
            
            logger.info(`✅ Successfully sent ${reminder.type} reminder to ${recipientsToRemind.length} recipient(s)`);
            
            // Update lastReminderSent timestamps
            const now = new Date();
            let updatedCount = 0;
            
            // Update lastReminderSent for each recipient based on email match
            for (const adobeParticipant of recipientsToRemind) {
              if (!adobeParticipant.email) continue;
              
              const recipient = updatedDocument.recipients.find(r => 
                r.email && r.email.toLowerCase() === adobeParticipant.email.toLowerCase()
              );
              
              if (recipient) {
                recipient.lastReminderSent = now;
                updatedCount++;
                logger.info(`📝 Updated lastReminderSent for ${recipient.email} to ${now.toISOString()}`);
              } else {
                logger.warn(`⚠️ Could not find local recipient for ${adobeParticipant.email} to update reminder timestamp`);
              }
            }
            
            // Update document lastReminderSent
            updatedDocument.lastReminderSent = now;
            updatedDocument.reminderCount = (updatedDocument.reminderCount || 0) + 1;
            
            // Save changes
            await updatedDocument.save();
            logger.info(`✅ Saved document with ${updatedCount} updated reminder timestamps`);
            
            return { 
              success: true, 
              reminderSent: true, 
              recipientCount: recipientsToRemind.length,
              recipientEmails: recipientsToRemind.map(p => p.email)
            };
            
          } catch (error) {
            logger.error(`❌ Error sending reminder: ${error.message}`);
            return { success: false, error: error.message };
          }
        } else {
          logger.warn(`⚠️ No valid participant IDs found for reminders`);
          return { success: false, error: 'No valid participant IDs' };
        }
      } else {
        logger.info(`📭 No recipients currently need reminders for document ${reminder.documentId}`);
        return { success: true, reminderSent: false, reason: 'No recipients need reminders' };
      }
      
    } catch (error) {
      logger.error(`❌ Error executing reminder for document ${reminder.documentId}:`, error.message);
      logger.error(error.stack);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Helper method to find a matching Adobe Sign participant by email
   */
  findMatchingAdobeParticipant(agreementInfo, email) {
    if (!email || !agreementInfo) return null;
    
    // Handle different possible locations of participant sets
    const participantSets = agreementInfo.participantSets || 
                           (agreementInfo.participants && agreementInfo.participants.participantSets) ||
                           [];
    
    logger.info(`🔍 Looking for participant with email: ${email} in ${participantSets.length} participant sets`);
    
    for (const set of participantSets) {
      logger.info(`🔍 Checking set with ${set.memberInfos?.length || 0} members`);
      if (set.memberInfos && Array.isArray(set.memberInfos)) {
        const match = set.memberInfos.find(member => 
          member.email && member.email.toLowerCase() === email.toLowerCase()
        );
        
        if (match) {
          logger.info(`✅ Found matching participant for ${email}:`, {
            email: match.email,
            status: match.status,
            id: match.id,
            participantId: match.participantId,
            userId: match.userId,
            setId: set.participantSetId
          });
          
          // Ensure we have a usable ID for reminders
          match.participantSetId = set.participantSetId;
          return match;
        }
      }
    }
    
    logger.info(`❌ No matching participant found for ${email}`);
    return null;
  }
  
  /**
   * Update recipient statuses in document based on Adobe Sign data
   * @param {Object} document - The document object to update
   * @param {Object} agreementInfo - Agreement information from Adobe Sign
   * @private
   */
  async updateDocumentRecipientStatuses(document, agreementInfo) {
    try {
      if (!document || !document._id) {
        logger.warn(`⚠️ Invalid document provided to updateDocumentRecipientStatuses`);
        return;
      }
      
      if (!agreementInfo) {
        logger.warn(`⚠️ Invalid agreement info provided to updateDocumentRecipientStatuses for document ${document._id}`);
        return;
      }
      
      logger.info(`🔄 Updating recipient statuses for document ${document._id}`);
      
      // Debug the agreement info structure to understand what we're working with
      logger.info(`Agreement status: ${agreementInfo.status}`);
      logger.info(`Agreement keys: ${Object.keys(agreementInfo).join(', ')}`);
      
      // Handle different versions of Adobe Sign API responses
      let participantSets = [];
      
      // Try to find participant sets from various possible locations in the API response
      if (agreementInfo.participantSets && Array.isArray(agreementInfo.participantSets)) {
        participantSets = agreementInfo.participantSets;
        logger.info(`Found ${participantSets.length} participant sets directly in agreementInfo.participantSets`);
      } else if (agreementInfo.participants && agreementInfo.participants.participantSets) {
        participantSets = agreementInfo.participants.participantSets;
        logger.info(`Found ${participantSets.length} participant sets in agreementInfo.participants.participantSets`);
      } else if (agreementInfo.participants && Array.isArray(agreementInfo.participants)) {
        // Handle the case where we get flat participants array instead of sets
        participantSets = [{
          role: 'SIGNER',
          memberInfos: agreementInfo.participants
        }];
        logger.info(`Created participant set from ${agreementInfo.participants.length} flat participants`);
      } else if (agreementInfo.participantSet) {
        // Handle singular participantSet
        participantSets = [agreementInfo.participantSet];
        logger.info(`Using singular participant set`);
      }
      
      if (!participantSets || participantSets.length === 0) {
        logger.warn(`⚠️ No participant sets found in agreement info for document ${document._id}`);
        
        // Try to get data from members endpoint as a last resort
        if (agreementInfo.participants && agreementInfo.participants.members) {
          logger.info(`Falling back to members data from separate endpoint`);
          const members = agreementInfo.participants.members;
          
          // Create a synthetic participant set
          participantSets = [{
            role: 'SIGNER',
            memberInfos: members
          }];
        } else {
          logger.error(`❌ No participant data available - cannot update statuses`);
          return;
        }
      }
      
      // Track changes made
      let updatedCount = 0;
      const statusUpdates = [];
      
      // Process each participant set
      participantSets.forEach((participantSet, setIndex) => {
        if (!participantSet) {
          logger.warn(`⚠️ Found null or undefined participant set at index ${setIndex}`);
          return;
        }
        
        const setRole = participantSet.role || 'SIGNER';
        const setOrder = participantSet.order !== undefined ? participantSet.order : setIndex;
        const setStatus = participantSet.status || 'UNKNOWN';
        
        logger.info(`Processing participant set ${setIndex}: role=${setRole}, order=${setOrder}, status=${setStatus}`);
        
        // Find memberInfos in the correct location
        let memberInfos = [];
        if (participantSet.memberInfos && Array.isArray(participantSet.memberInfos)) {
          memberInfos = participantSet.memberInfos;
        } else if (participantSet.members && Array.isArray(participantSet.members)) {
          memberInfos = participantSet.members;
        } else if (participantSet.participantIds && Array.isArray(participantSet.participantIds)) {
          // Handle case where we just have IDs
          memberInfos = participantSet.participantIds.map(id => ({ 
            id, 
            email: null,
            status: setStatus 
          }));
        }
        
        if (!memberInfos || memberInfos.length === 0) {
          logger.warn(`⚠️ No members found in participant set ${setIndex}`);
          return;
        }
        
        logger.info(`Found ${memberInfos.length} members in set ${setIndex}`);
        
        // Process each member in the set
        memberInfos.forEach((member, memberIndex) => {
          if (!member) {
            logger.warn(`⚠️ Found null or undefined member at index ${memberIndex}`);
            return;
          }
          
          // Try to find the recipient by email or by participantId
          let recipient = null;
          
          if (member.email) {
            recipient = document.recipients.find(r => 
              r.email && r.email.toLowerCase() === member.email.toLowerCase()
            );
            
            if (recipient) {
              logger.info(`Found recipient by email: ${member.email}`);
            }
          }
          
          // If we couldn't find by email, try by order/index (last resort)
          if (!recipient && setRole === 'SIGNER') {
            // In sequential signing, try to match by order
            const matchByOrderOrIndex = document.recipients.find(r => 
              r.order === setOrder || (!r.order && memberIndex === setIndex)
            );
            
            if (matchByOrderOrIndex) {
              recipient = matchByOrderOrIndex;
              logger.info(`Found recipient by order/index: ${recipient.email}`);
            }
          }
          
          if (!recipient) {
            logger.warn(`⚠️ No matching recipient found for member at index ${memberIndex}`);
            return;
          }
          
          // Update recipient order if needed
          if (setOrder !== undefined && setOrder !== null && recipient.order !== setOrder) {
            recipient.order = setOrder;
            updatedCount++;
            logger.info(`📝 Updated order for ${recipient.email} to ${recipient.order}`);
          }
          
          // Get the member status - first try the member's own status, fallback to set status
          const memberStatus = member.status || setStatus;
          
          // Update recipient status based on Adobe Sign status
          const oldStatus = recipient.status;
          let newStatus = oldStatus;
          
          // Map Adobe Sign statuses to our enum values with detailed logging
          logger.info(`Mapping Adobe status '${memberStatus}' for ${recipient.email}`);
          
          // Enhanced status mapping with proper timestamp handling
          if (['SIGNED', 'COMPLETED', 'APPROVED', 'ACCEPTED', 'FORM_FILLED', 'ACKNOWLEDGED', 'DELIVERED'].includes(memberStatus)) {
            newStatus = 'signed';
            logger.info(`✅ Member has SIGNED`);
            
            // Update signedAt timestamp if not already set or if we have a newer timestamp
            const possibleSigningDates = [
              member.completedDate,
              member.statusUpdateDate,
              member.signedDate,
              member.lastModified,
              member.dateCompleted,
              member.dateSigned,
              setStatus === 'SIGNED' ? new Date() : null
            ].filter(date => date); // Remove null/undefined values
            
            if (possibleSigningDates.length > 0) {
              // Use the most recent valid date
              const latestDate = new Date(Math.max(...possibleSigningDates.map(d => new Date(d).getTime())));
              
              if (!recipient.signedAt || latestDate > recipient.signedAt) {
                recipient.signedAt = latestDate;
                updatedCount++;
                logger.info(`📝 Set signedAt for ${recipient.email} to ${recipient.signedAt}`);
              }
            } else if (!recipient.signedAt) {
              // Fallback to current time if no timestamp available
              recipient.signedAt = new Date();
              updatedCount++;
              logger.info(`📝 Set signedAt for ${recipient.email} to current time (no timestamp available)`);
            }
            
          } else if (['DECLINED', 'REJECTED', 'RECALLED', 'CANCELLED', 'CANCELED'].includes(memberStatus)) {
            newStatus = 'declined';
            logger.info(`❌ Member has DECLINED`);
          } else if (['EXPIRED'].includes(memberStatus)) {
            newStatus = 'expired';
            logger.info(`⏱️ Status is EXPIRED`);
          } else if (['NOT_YET_VISIBLE', 'WAITING_FOR_OTHERS', 'WAITING_FOR_MY_PREREQUISITES', 'WAITING_FOR_PREREQUISITE'].includes(memberStatus)) {
            newStatus = 'waiting';
            logger.info(`⏳ Member is WAITING (${memberStatus})`);
          } else if (['WAITING_FOR_MY_SIGNATURE', 'WAITING_FOR_MY_APPROVAL', 'OUT_FOR_SIGNATURE', 'ACTION_REQUESTED', 'WAITING_FOR_SIGNATURE', 'ACTIVE', 'WAITING_FOR_VERIFICATION', 'WAITING_FOR_FAXING', 'WAITING_FOR_COUNTER_SIGNATURE', 'WAITING_FOR_MY_REVIEW', 'WAITING_FOR_MY_ACKNOWLEDGEMENT', 'DELEGATED'].includes(memberStatus)) {
            newStatus = 'sent';
            logger.info(`📤 Member is ready to sign (${memberStatus})`);
          } else if (['VIEWED', 'EMAIL_VIEWED', 'DOCUMENT_VIEWED'].includes(memberStatus)) {
            newStatus = 'viewed';
            logger.info(`👀 Member has VIEWED the document`);
          } else if (['DELEGATION_PENDING'].includes(memberStatus)) {
            newStatus = 'pending';
            logger.info(`🔄 DELEGATION_PENDING for member`);
          } else if (['CREATED', 'DRAFT', 'AUTHORING'].includes(memberStatus)) {
            newStatus = 'pending';
            logger.info(`📝 Document is in AUTHORING/DRAFT state`);
          } else {
            // For any unrecognized status, map based on the overall agreement status
            if (agreementInfo.status === 'SIGNED' || agreementInfo.status === 'COMPLETED') {
              newStatus = 'signed';
              logger.info(`🔄 Mapped unknown status '${memberStatus}' to 'signed' based on agreement status`);
            } else {
              newStatus = 'sent'; // Default for active agreements
              logger.info(`⚠️ Unknown Adobe Sign status: ${memberStatus}, defaulting to 'sent'`);
            }
          }
          
          // Update status if changed
          if (oldStatus !== newStatus) {
            recipient.status = newStatus;
            updatedCount++;
            statusUpdates.push({
              email: recipient.email,
              oldStatus,
              newStatus,
              adobeStatus: memberStatus
            });
            logger.info(`📝 Updated status for ${recipient.email} from ${oldStatus} to ${newStatus} (Adobe status: ${memberStatus})`);
            
            // If status is changing to 'signed' but signedAt is not set, set it now
            if (newStatus === 'signed' && !recipient.signedAt) {
              recipient.signedAt = new Date();
              updatedCount++;
              logger.info(`📝 Set signedAt for ${recipient.email} to current time during status update`);
            }
          }
          
          // Update lastSigningUrlAccessed timestamp with enhanced date handling
          const possibleAccessDates = [
            member.accessDate,
            member.lastViewedDate,
            member.viewDate,
            member.lastAccessDate,
            member.dateViewed,
            member.dateAccessed,
            member.emailDate,
            member.statusUpdateDate
          ].filter(date => date); // Remove null/undefined values
          
          if (possibleAccessDates.length > 0) {
            // Use the most recent valid date
            const latestAccessDate = new Date(Math.max(...possibleAccessDates.map(d => new Date(d).getTime())));
            
            if (!recipient.lastSigningUrlAccessed || latestAccessDate > recipient.lastSigningUrlAccessed) {
              recipient.lastSigningUrlAccessed = latestAccessDate;
              updatedCount++;
              logger.info(`📝 Updated lastSigningUrlAccessed for ${recipient.email} to ${recipient.lastSigningUrlAccessed}`);
            }
          }
        });
      });
      
      // Also check overall agreement status for additional clues
      if (agreementInfo.status === 'SIGNED' || agreementInfo.status === 'COMPLETED') {
        // If agreement is complete but some recipients don't show as signed, force them to signed
        const unsignedRecipients = document.recipients.filter(r => r.status !== 'signed');
        if (unsignedRecipients.length > 0) {
          logger.info(`Agreement status is ${agreementInfo.status} but ${unsignedRecipients.length} recipients are not marked as signed - fixing`);
          
          unsignedRecipients.forEach(recipient => {
            recipient.status = 'signed';
            recipient.signedAt = recipient.signedAt || new Date();
            updatedCount++;
            statusUpdates.push({
              email: recipient.email,
              oldStatus: recipient.status,
              newStatus: 'signed',
              adobeStatus: agreementInfo.status
            });
            logger.info(`📝 Force updated status for ${recipient.email} to signed based on agreement status`);
          });
        }
      }
      
      // Update document overall status
      if (statusUpdates.length > 0) {
        this.updateDocumentOverallStatus(document, statusUpdates);
      }
      
      if (updatedCount > 0) {
        logger.info(`✅ Updated ${updatedCount} recipient details - saving document`);
        await document.save();
        
        // Verify the changes were saved
        logger.info(`🔍 Verifying ${statusUpdates.length} status updates were saved:`);
        statusUpdates.forEach(update => {
          const recipient = document.recipients.find(r => 
            r.email && r.email.toLowerCase() === update.email.toLowerCase()
          );
          
          if (recipient && recipient.status === update.newStatus) {
            logger.info(`✅ Verified status update for ${update.email}: ${update.oldStatus} → ${update.newStatus}`);
          } else if (recipient) {
            logger.warn(`⚠️ Status update verification failed for ${update.email}: expected ${update.newStatus}, got ${recipient.status}`);
          }
        });
      } else {
        logger.info(`ℹ️ No recipient updates needed`);
      }
      
      return updatedCount;
    } catch (error) {
      logger.error(`❌ Error updating recipient statuses: ${error.message}`);
      logger.error(error.stack);
      return 0;
    }
  }
  
  /**
   * Update the overall document status based on recipient statuses
   * @param {Object} document - The document object to update
   * @param {Array} statusUpdates - List of status updates that were made
   * @private
   */
  updateDocumentOverallStatus(document, statusUpdates) {
    // Count recipients by status
    const statusCounts = document.recipients.reduce((counts, recipient) => {
      counts[recipient.status] = (counts[recipient.status] || 0) + 1;
      return counts;
    }, {});
    
    const totalRecipients = document.recipients.length;
    const signedCount = statusCounts.signed || 0;
    const declinedCount = statusCounts.declined || 0;
    const expiredCount = statusCounts.expired || 0;
    const waitingCount = statusCounts.waiting || 0;
    const viewedCount = statusCounts.viewed || 0;
    const sentCount = statusCounts.sent || 0;
    
    const oldStatus = document.status;
    let newStatus = oldStatus;
    
    logger.info(`📊 Document status analysis for ${document._id}:`);
    logger.info(`  Total recipients: ${totalRecipients}`);
    logger.info(`  Signed: ${signedCount}, Declined: ${declinedCount}, Expired: ${expiredCount}`);
    logger.info(`  Waiting: ${waitingCount}, Viewed: ${viewedCount}, Sent: ${sentCount}`);
    
    // Update document status based on recipient statuses with comprehensive logic
    if (declinedCount > 0) {
      newStatus = 'cancelled';
      logger.info(`📝 Setting status to 'cancelled' due to ${declinedCount} declined recipients`);
    } else if (expiredCount > 0) {
      newStatus = 'expired';
      logger.info(`📝 Setting status to 'expired' due to ${expiredCount} expired recipients`);
    } else if (signedCount === totalRecipients) {
      newStatus = 'completed';
      logger.info(`📝 Setting status to 'completed' - all ${signedCount} recipients have signed`);
      
      // Set completion timestamp if not already set
      if (!document.completedAt) {
        document.completedAt = new Date();
        logger.info(`📝 Set document completedAt timestamp: ${document.completedAt}`);
      }
    } else if (signedCount > 0 && signedCount < totalRecipients) {
      newStatus = 'partially_signed';
      logger.info(`📝 Setting status to 'partially_signed' - ${signedCount}/${totalRecipients} have signed`);
    } else if (sentCount > 0 || viewedCount > 0) {
      newStatus = 'out_for_signature';
      logger.info(`📝 Setting status to 'out_for_signature' - active signatures needed`);
    } else if (waitingCount === totalRecipients) {
      newStatus = 'pending';
      logger.info(`📝 Setting status to 'pending' - all recipients waiting`);
    } else {
      // Default to out_for_signature if we have any activity
      newStatus = 'out_for_signature';
      logger.info(`📝 Defaulting to 'out_for_signature' status`);
    }
    
    if (oldStatus !== newStatus) {
      document.status = newStatus;
      logger.info(`📝 Updated document ${document._id} status from ${oldStatus} to ${newStatus}`);
    } else {
      logger.info(`📝 Document status remains: ${newStatus}`);
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
    // Check both possible paths for participant sets
    const participantSets = agreementInfo.participantSets || 
                           agreementInfo.participants?.participantSets;
    
    if (!participantSets) return false;

    const signerOrders = participantSets
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

  /**
   * Force a comprehensive status refresh from Adobe Sign
   * This method ensures we have the latest status before making reminder decisions
   * @param {string} documentId - Document ID to refresh
   * @returns {Promise<Object>} - Updated document with fresh statuses
   */
  async forceStatusRefresh(documentId) {
    try {
      logger.info(`🔄 Forcing comprehensive status refresh for document: ${documentId}`);
      
      const document = await Document.findById(documentId);
      if (!document || !document.adobeAgreementId) {
        logger.warn(`⚠️ Document ${documentId} not found or has no agreement ID`);
        return null;
      }
      
      // Get fresh Adobe Sign data with retry logic
      let agreementInfo = null;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (!agreementInfo && retryCount < maxRetries) {
        try {
          const accessToken = await getAccessToken();
          agreementInfo = await getComprehensiveAgreementInfo(accessToken, document.adobeAgreementId);
          
          if (agreementInfo) {
            logger.info(`📊 Successfully got agreement status: ${agreementInfo.status} (attempt ${retryCount + 1})`);
            break;
          }
        } catch (error) {
          retryCount++;
          logger.warn(`⚠️ Attempt ${retryCount} failed: ${error.message}`);
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
          }
        }
      }
      
      if (!agreementInfo) {
        logger.error(`❌ Failed to get agreement info after ${maxRetries} attempts`);
        return document;
      }
      
      // Update recipient statuses with comprehensive mapping
      const updateCount = await this.updateDocumentRecipientStatuses(document, agreementInfo);
      
      // Log final status after update
      logger.info(`🔍 Status refresh complete - updated ${updateCount} recipient details`);
      
      return document;
    } catch (error) {
      logger.error(`❌ Error in forceStatusRefresh: ${error.message}`);
      return null;
    }
  }

  /**
   * Refresh signing status from Adobe Sign and update document recipient statuses
   * Use this function to force a refresh of recipient statuses from Adobe Sign
   * @param {string} documentId - The document ID to refresh
   * @returns {Promise<Object>} - The updated document
   */
  async refreshSigningStatus(documentId) {
    try {
      logger.info(`🔄 Forcing refresh of signing status for document: ${documentId}`);
      
      const document = await Document.findById(documentId);
      if (!document || !document.adobeAgreementId) {
        logger.warn(`⚠️ Document ${documentId} not found or has no agreement ID`);
        return null;
      }
      
      // Get fresh Adobe Sign data
      const accessToken = await getAccessToken();
      const agreementInfo = await getComprehensiveAgreementInfo(accessToken, document.adobeAgreementId);
      
      if (!agreementInfo) {
        logger.error(`❌ Failed to get agreement info for document ${documentId}`);
        return document;
      }
      
      logger.info(`📊 Got agreement status: ${agreementInfo.status}`);
      
      // Log detailed participant info for debugging
      if (agreementInfo.participantSets) {
        logger.info(`Found ${agreementInfo.participantSets.length} participant sets`);
        
        agreementInfo.participantSets.forEach((set, i) => {
          logger.info(`Set ${i+1} (order: ${set.order}, role: ${set.role}, status: ${set.status})`);
          
          if (set.memberInfos && Array.isArray(set.memberInfos)) {
            set.memberInfos.forEach(member => {
              logger.info(`  - ${member.email}: status=${member.status}, id=${member.id}`);
            });
          }
        });
      }
      
      // Update recipient statuses based on Adobe Sign data
      await this.updateDocumentRecipientStatuses(document, agreementInfo);
      
      return document;
    } catch (error) {
      logger.error(`❌ Error refreshing signing status: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Diagnostic method to verify document and recipient statuses
   * @param {string} documentId - Document ID to verify
   * @returns {Promise<object>} Diagnostic report
   */
  async verifyDocumentStatuses(documentId) {
    try {
      logger.info(`🔍 Running verification check for document ${documentId}`);
      
      // Get document from database
      const document = await Document.findById(documentId);
      if (!document || !document.adobeAgreementId) {
        logger.error(`❌ Document ${documentId} not found or has no agreement ID`);
        return { 
          success: false, 
          error: 'Document not found or not sent for signature' 
        };
      }
      
      // Get latest Adobe Sign data
      const accessToken = await getAccessToken();
      const agreementInfo = await getComprehensiveAgreementInfo(accessToken, document.adobeAgreementId);
      
      if (!agreementInfo) {
        logger.error(`❌ Failed to get agreement info for document ${documentId}`);
        return { 
          success: false, 
          error: 'Failed to get Adobe Sign agreement info' 
        };
      }
      
      // Create diagnostic report
      const report = {
        success: true,
        documentId: document._id.toString(),
        documentName: document.originalName,
        documentStatus: document.status,
        adobeStatus: agreementInfo.status,
        signingFlow: document.signingFlow || (this.isSequentialSigning(agreementInfo) ? 'SEQUENTIAL' : 'PARALLEL'),
        lastUpdated: document.updatedAt,
        recipients: []
      };
      
      // Get all participant data from Adobe Sign
      const adobeParticipants = [];
      const participantSets = agreementInfo.participantSets || 
                              (agreementInfo.participants && agreementInfo.participants.participantSets) ||
                              [];
      
      for (const set of participantSets) {
        if (set.memberInfos && Array.isArray(set.memberInfos)) {
          for (const member of set.memberInfos) {
            if (member && member.email) {
              adobeParticipants.push({
                email: member.email,
                name: member.name,
                status: member.status,
                order: set.order,
                id: member.id || member.participantId
              });
            }
          }
        }
      }
      
      // Compare document recipients with Adobe Sign data
      for (const recipient of document.recipients) {
        // Find matching Adobe participant
        const adobeMatch = adobeParticipants.find(p => 
          p.email && p.email.toLowerCase() === recipient.email.toLowerCase()
        );
        
        report.recipients.push({
          email: recipient.email,
          name: recipient.name,
          dbStatus: recipient.status,
          adobeStatus: adobeMatch ? adobeMatch.status : 'UNKNOWN',
          order: recipient.order,
          signedAt: recipient.signedAt,
          lastReminderSent: recipient.lastReminderSent,
          statusMatch: adobeMatch ? this.statusesMatch(recipient.status, adobeMatch.status) : false,
          needsUpdate: adobeMatch ? !this.statusesMatch(recipient.status, adobeMatch.status) : true
        });
      }
      
      // Identify discrepancies and current signer
      report.discrepancies = report.recipients.filter(r => !r.statusMatch);
      
      if (report.signingFlow === 'SEQUENTIAL') {
        const sortedRecipients = [...document.recipients]
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        
        const currentSigner = sortedRecipients.find(r => 
          r.status !== 'signed' && r.status !== 'declined' && r.status !== 'expired'
        );
        
        if (currentSigner) {
          report.currentSigner = {
            email: currentSigner.email,
            name: currentSigner.name,
            status: currentSigner.status,
            order: currentSigner.order
          };
        }
      }
      
      return report;
    } catch (error) {
      logger.error(`❌ Error verifying document statuses: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Check if our status matches Adobe Sign status
   */
  statusesMatch(ourStatus, adobeStatus) {
    if (!adobeStatus) return false;
    
    // Map of our statuses to possible Adobe Sign statuses (comprehensive mapping)
    const statusMap = {
      'signed': ['SIGNED', 'COMPLETED', 'APPROVED', 'ACCEPTED', 'FORM_FILLED'],
      'declined': ['DECLINED', 'REJECTED', 'RECALLED', 'CANCELLED', 'CANCELED'],
      'expired': ['EXPIRED'],
      'waiting': ['NOT_YET_VISIBLE', 'WAITING_FOR_OTHERS', 'WAITING_FOR_MY_PREREQUISITES', 'WAITING_FOR_PREREQUISITE', 'WAITING_FOR_AUTHORING'],
      'sent': ['WAITING_FOR_MY_SIGNATURE', 'WAITING_FOR_MY_APPROVAL', 'OUT_FOR_SIGNATURE', 'ACTION_REQUESTED', 'WAITING_FOR_SIGNATURE', 'ACTIVE', 'WAITING_FOR_VERIFICATION', 'WAITING_FOR_FAXING', 'WAITING_FOR_COUNTER_SIGNATURE', 'WAITING_FOR_MY_REVIEW', 'WAITING_FOR_MY_ACKNOWLEDGEMENT', 'DELEGATED'],
      'viewed': ['VIEWED', 'EMAIL_VIEWED', 'DOCUMENT_VIEWED'],
      'pending': ['DELEGATION_PENDING', 'CREATED', 'DRAFT', 'AUTHORING']
    };
    
    return statusMap[ourStatus] && statusMap[ourStatus].includes(adobeStatus);
  }
}

// Create singleton instance
const reminderScheduler = new ReminderScheduler();

module.exports = {
  ReminderScheduler,
  reminderScheduler
};
