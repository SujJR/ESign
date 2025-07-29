const ApiKey = require('../models/apiKey.model');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');

/**
 * Create a new API key (Admin only)
 * @route POST /api/auth/api-keys
 */
exports.createApiKey = async (req, res, next) => {
  try {
    const { 
      name, 
      description,
      assignedTo,
      environment = 'production',
      permissions = ['documents:read', 'documents:write'], 
      scopes = ['document_management'],
      expiresIn,
      allowedIPs = [],
      allowedDomains = [],
      rateLimit = {},
      metadata = {}
    } = req.body;
    
    if (!name) {
      return next(new ApiError(400, 'API key name is required'));
    }

    // Generate new API key
    const { apiKey, keyId, prefix, keyHash } = ApiKey.generateApiKey(assignedTo || 'user');
    
    // Calculate expiration date
    let expiresAt = null;
    if (expiresIn) {
      const now = new Date();
      if (typeof expiresIn === 'number') {
        // Assume days
        expiresAt = new Date(now.getTime() + (expiresIn * 24 * 60 * 60 * 1000));
      } else if (typeof expiresIn === 'string') {
        // Parse string like "30d", "1y", "6m"
        const match = expiresIn.match(/^(\d+)([dmyh])$/);
        if (match) {
          const value = parseInt(match[1]);
          const unit = match[2];
          switch (unit) {
            case 'h':
              expiresAt = new Date(now.getTime() + (value * 60 * 60 * 1000));
              break;
            case 'd':
              expiresAt = new Date(now.getTime() + (value * 24 * 60 * 60 * 1000));
              break;
            case 'm':
              expiresAt = new Date(now.getTime() + (value * 30 * 24 * 60 * 60 * 1000));
              break;
            case 'y':
              expiresAt = new Date(now.getTime() + (value * 365 * 24 * 60 * 60 * 1000));
              break;
          }
        }
      }
    }
    
    // Set default rate limits
    const finalRateLimit = {
      requestsPerMinute: rateLimit.requestsPerMinute || 100,
      requestsPerHour: rateLimit.requestsPerHour || 1000,
      requestsPerDay: rateLimit.requestsPerDay || 10000
    };

    // Create API key document
    const apiKeyDoc = await ApiKey.create({
      name,
      keyId,
      keyHash,
      prefix,
      description,
      assignedTo,
      environment,
      permissions,
      scopes,
      expiresAt,
      allowedIPs,
      allowedDomains,
      rateLimit: finalRateLimit,
      metadata,
      createdBy: req.apiKey ? req.apiKey.keyId : 'system'
    });
    
    logger.info(`API key created: ${keyId}`, {
      keyId,
      name,
      assignedTo,
      permissions,
      createdBy: req.apiKey ? req.apiKey.keyId : 'system'
    });
    
    // Return the API key (only time it's shown in full)
    res.status(201).json(formatResponse(
      {
        apiKey,
        keyId,
        name,
        description,
        assignedTo,
        permissions,
        expiresAt,
        allowedIPs,
        rateLimit: apiKeyDoc.rateLimit,
        metadata,
        warning: 'This is the only time the full API key will be shown. Please store it securely.'
      },
      'API key created successfully'
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Get all API keys (without the actual key values) - Admin only
 * @route GET /api/auth/api-keys
 */
exports.getApiKeys = async (req, res, next) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      active, 
      environment,
      assignedTo,
      search 
    } = req.query;
    
    const query = {};
    if (active !== undefined) {
      query.isActive = active === 'true';
    }
    if (environment) {
      query.environment = environment;
    }
    if (assignedTo) {
      query.assignedTo = { $regex: assignedTo, $options: 'i' };
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { keyId: { $regex: search, $options: 'i' } },
        { assignedTo: { $regex: search, $options: 'i' } }
      ];
    }
    
    const apiKeys = await ApiKey.find(query)
      .select('-keyHash')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const total = await ApiKey.countDocuments(query);
    
    res.status(200).json(formatResponse(
      {
        apiKeys,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      },
      'API keys retrieved successfully'
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Get specific API key details - Admin only
 * @route GET /api/auth/api-keys/:keyId
 */
exports.getApiKey = async (req, res, next) => {
  try {
    const { keyId } = req.params;
    
    const apiKey = await ApiKey.findOne({ keyId }).select('-keyHash');
    
    if (!apiKey) {
      return next(new ApiError(404, 'API key not found'));
    }
    
    res.status(200).json(formatResponse(
      { apiKey },
      'API key retrieved successfully'
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Update API key - Admin only
 * @route PUT /api/auth/api-keys/:keyId
 */
exports.updateApiKey = async (req, res, next) => {
  try {
    const { keyId } = req.params;
    const { 
      name, 
      description,
      assignedTo,
      permissions, 
      isActive, 
      allowedIPs, 
      rateLimit,
      metadata 
    } = req.body;
    
    const apiKey = await ApiKey.findOne({ keyId });
    
    if (!apiKey) {
      return next(new ApiError(404, 'API key not found'));
    }
    
    // Update fields
    if (name !== undefined) apiKey.name = name;
    if (description !== undefined) apiKey.description = description;
    if (assignedTo !== undefined) apiKey.assignedTo = assignedTo;
    if (permissions !== undefined) apiKey.permissions = permissions;
    if (isActive !== undefined) apiKey.isActive = isActive;
    if (allowedIPs !== undefined) apiKey.allowedIPs = allowedIPs;
    if (rateLimit !== undefined) {
      apiKey.rateLimit = {
        requestsPerMinute: rateLimit.requestsPerMinute || apiKey.rateLimit.requestsPerMinute,
        requestsPerHour: rateLimit.requestsPerHour || apiKey.rateLimit.requestsPerHour
      };
    }
    if (metadata !== undefined) apiKey.metadata = { ...apiKey.metadata, ...metadata };
    
    await apiKey.save();
    
    logger.info(`API key updated: ${keyId}`, {
      keyId,
      updatedBy: req.apiKey ? req.apiKey.keyId : 'system'
    });
    
    res.status(200).json(formatResponse(
      { apiKey },
      'API key updated successfully'
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Delete API key - Admin only
 * @route DELETE /api/auth/api-keys/:keyId
 */
exports.deleteApiKey = async (req, res, next) => {
  try {
    const { keyId } = req.params;
    
    const apiKey = await ApiKey.findOne({ keyId });
    
    if (!apiKey) {
      return next(new ApiError(404, 'API key not found'));
    }
    
    apiKey.isActive = false;
    apiKey.metadata = { 
      ...apiKey.metadata, 
      deletedAt: new Date(),
      deletedBy: req.apiKey ? req.apiKey.keyId : 'system'
    };
    await apiKey.save();
    
    logger.info(`API key deleted: ${keyId}`, {
      keyId,
      deletedBy: req.apiKey ? req.apiKey.keyId : 'system'
    });
    
    res.status(200).json(formatResponse(
      { keyId },
      'API key deleted successfully'
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Get API key usage statistics - Admin only
 * @route GET /api/auth/api-keys/:keyId/stats
 */
exports.getApiKeyStats = async (req, res, next) => {
  try {
    const { keyId } = req.params;
    
    const apiKey = await ApiKey.findOne({ keyId }).select('-keyHash');
    
    if (!apiKey) {
      return next(new ApiError(404, 'API key not found'));
    }
    
    // Get usage statistics
    const stats = {
      keyId: apiKey.keyId,
      name: apiKey.name,
      assignedTo: apiKey.assignedTo,
      usageCount: apiKey.usageCount,
      lastUsed: apiKey.lastUsed,
      createdAt: apiKey.createdAt,
      isActive: apiKey.isActive,
      permissions: apiKey.permissions,
      rateLimit: apiKey.rateLimit,
      expiresAt: apiKey.expiresAt,
      daysUntilExpiry: apiKey.expiresAt ? 
        Math.ceil((apiKey.expiresAt - new Date()) / (1000 * 60 * 60 * 24)) : 
        null
    };
    
    res.status(200).json(formatResponse(
      { stats },
      'API key statistics retrieved successfully'
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Rotate/Regenerate API key - Admin only
 * @route POST /api/auth/api-keys/:keyId/rotate
 */
exports.rotateApiKey = async (req, res, next) => {
  try {
    const { keyId } = req.params;
    
    const existingApiKey = await ApiKey.findOne({ keyId });
    
    if (!existingApiKey) {
      return next(new ApiError(404, 'API key not found'));
    }
    
    // Generate new API key while preserving the same keyId and all other data
    const { apiKey, keyHash } = ApiKey.generateApiKey();
    
    // Update the existing document with new key hash only
    existingApiKey.keyHash = keyHash;
    existingApiKey.metadata = {
      ...existingApiKey.metadata,
      rotatedAt: new Date(),
      rotatedBy: req.apiKey ? req.apiKey.keyId : 'system',
      previousRotations: (existingApiKey.metadata.previousRotations || 0) + 1
    };
    await existingApiKey.save();
    
    logger.info(`API key rotated: ${keyId}`, {
      keyId,
      rotatedBy: req.apiKey ? req.apiKey.keyId : 'system'
    });
    
    res.status(200).json(formatResponse(
      {
        apiKey,
        keyId,
        name: existingApiKey.name,
        assignedTo: existingApiKey.assignedTo,
        permissions: existingApiKey.permissions,
        rotatedAt: new Date(),
        warning: 'This is the only time the new API key will be shown. Please store it securely. The old key is now invalid.'
      },
      'API key rotated successfully'
    ));
  } catch (error) {
    next(error);
  }
};
