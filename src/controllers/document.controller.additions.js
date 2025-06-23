/**
 * Check and update the signature status of a document
 * @route POST /api/documents/:id/update-status
 */
exports.updateSignatureStatus = async (req, res, next) => {
  try {
    const documentId = req.params.id;
    
    // Find document
    const document = await Document.findById(documentId);
    if (!document) {
      return next(new ApiError(404, 'Document not found'));
    }
    
    // Check if document has an Adobe agreement ID
    if (!document.adobeAgreementId) {
      return next(new ApiError(400, 'Document has not been sent for signature yet'));
    }
    
    // Get access token
    const accessToken = await getAccessToken();
    
    // No need to create Adobe Sign client anymore
    
    // Get agreement info
    const agreementInfo = await getAgreementInfo(accessToken, document.adobeAgreementId);
    
    logger.info(`Retrieved agreement info for ${documentId}, status: ${agreementInfo.status}`);
    
    // Update document status based on agreement status
    switch (agreementInfo.status) {
      case 'SIGNED':
        document.status = 'completed';
        break;
      case 'CANCELLED':
        document.status = 'cancelled';
        break;
      case 'EXPIRED':
        document.status = 'expired';
        break;
      case 'OUT_FOR_SIGNATURE':
      case 'OUT_FOR_APPROVAL':
        // Check if partially signed
        if (document.recipients.some(r => r.status === 'signed')) {
          document.status = 'partially_signed';
        } else {
          document.status = 'sent_for_signature';
        }
        break;
      default:
        document.status = 'sent_for_signature';
    }
    
    // Update recipient status
    if (agreementInfo.participantSets && agreementInfo.participantSets.length > 0) {
      for (const participantSet of agreementInfo.participantSets) {
        for (const participant of participantSet.memberInfos) {
          // Find matching recipient by email
          const recipientIndex = document.recipients.findIndex(
            r => r.email.toLowerCase() === participant.email.toLowerCase()
          );
          
          if (recipientIndex !== -1) {
            // Update recipient status
            const recipient = document.recipients[recipientIndex];
            
            switch (participant.status) {
              case 'SIGNED':
                recipient.status = 'signed';
                // Only update signedAt if not already set
                if (!recipient.signedAt) {
                  recipient.signedAt = new Date();
                }
                break;
              case 'APPROVED':
                recipient.status = 'signed';
                // Only update signedAt if not already set
                if (!recipient.signedAt) {
                  recipient.signedAt = new Date();
                }
                break;
              case 'WAITING_FOR_MY_SIGNATURE':
              case 'WAITING_FOR_MY_APPROVAL':
                recipient.status = 'pending';
                break;
              case 'WAITING_FOR_OTHERS':
                recipient.status = 'waiting';
                break;
              case 'DECLINED':
                recipient.status = 'declined';
                break;
              case 'EXPIRED':
                recipient.status = 'expired';
                break;
              case 'NOT_YET_VISIBLE':
                recipient.status = 'pending';
                break;
              default:
                // Keep existing status if unknown
                break;
            }
            
            logger.info(`Updated recipient ${recipient.email} status to ${recipient.status}`);
          }
        }
      }
    }
    
    // Save updated document
    await document.save();
    
    // Return updated document
    return res.status(200).json(formatResponse('Document signature status updated successfully', {
      document: documentUtils.sanitizeDocument(document)
    }));
  } catch (error) {
    logger.error(`Error updating signature status: ${error.message}`);
    return next(new ApiError(500, `Failed to update signature status: ${error.message}`));
  }
};

/**
 * Recover document from socket hang up error
 * @route POST /api/documents/:id/recover
 */
exports.recoverDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    logger.info(`Starting document recovery for ID: ${id}`);
    
    // Call the recovery utility
    const { recoverDocument: recoverDocumentUtil } = require('../utils/documentRecovery');
    const recoveryResult = await recoverDocumentUtil(id);
    
    if (recoveryResult.success) {
      // Log the recovery
      await Log.create({
        action: 'document_recovery',
        status: 'success',
        details: {
          documentId: id,
          method: recoveryResult.verifiedRecovery ? 'verified' : 'aggressive',
          timestamp: new Date()
        }
      });
      
      return res.status(200).json({
        success: true,
        status: 200,
        message: recoveryResult.message,
        data: {
          document: recoveryResult.document,
          agreementId: recoveryResult.adobeAgreementId || 'unknown',
          recoveryApplied: !!recoveryResult.recoveryApplied,
          verifiedRecovery: !!recoveryResult.verifiedRecovery
        }
      });
    } else {
      // Log the failed recovery attempt
      await Log.create({
        action: 'document_recovery',
        status: 'failure',
        details: {
          documentId: id,
          error: recoveryResult.message,
          timestamp: new Date()
        }
      });
      
      return res.status(400).json({
        success: false,
        status: 400,
        message: recoveryResult.message,
        data: {
          document: recoveryResult.document || null
        }
      });
    }
  } catch (error) {
    logger.error(`Error in document recovery: ${error.message}`);
    return next(new ApiError(500, `Document recovery failed: ${error.message}`));
  }
};
