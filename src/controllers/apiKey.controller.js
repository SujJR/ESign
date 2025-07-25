const ApiKey = require('../models/apiKey.model');
const Organization = require('../models/organization.model');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');

/**
 * Create a new API key
 * @route POST /api/auth/api-keys
 */
exports.createApiKey = async (req, res, next) => {
  try {
    const { 
      name, 
      organizationId,
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

    if (!organizationId) {
      return next(new ApiError(400, 'Organization ID is required'));
    }

    // Verify organization exists and is active
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return next(new ApiError(404, 'Organization not found'));
    }

    if (!organization.isActive) {
      return next(new ApiError(400, 'Cannot create API key for inactive organization'));
    }

    // Check if organization can create more API keys
    const existingKeyCount = await ApiKey.countDocuments({
      organization: organizationId,
      isActive: true
    });

    if (existingKeyCount >= organization.settings.maxApiKeys) {
      return next(new ApiError(400, `Organization has reached the maximum limit of ${organization.settings.maxApiKeys} API keys`));
    }

    // Generate new API key with organization slug
    const { apiKey, keyId, prefix, keyHash } = ApiKey.generateApiKey(organization.slug);
    
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
    
    // Merge rate limits with organization defaults
    const orgDefaults = organization.settings.defaultRateLimit;
    const finalRateLimit = {
      requestsPerMinute: rateLimit.requestsPerMinute || orgDefaults.requestsPerMinute,
      requestsPerHour: rateLimit.requestsPerHour || orgDefaults.requestsPerHour,
      requestsPerDay: rateLimit.requestsPerDay || orgDefaults.requestsPerDay
    };

    // Create API key document
    const apiKeyDoc = await ApiKey.create({
      name,
      keyId,
      keyHash,
      prefix,
      organization: organizationId,
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
      permissions,
      createdBy: req.apiKey ? req.apiKey.keyId : 'system'
    });
    
    // Return the API key (only time it's shown in full)
    res.status(201).json(formatResponse(
      201,
      'API key created successfully',
      {
        apiKey,
        keyId,
        name,
        permissions,
        expiresAt,
        allowedIPs,
        rateLimit: apiKeyDoc.rateLimit,
        metadata,
        warning: 'This is the only time the full API key will be shown. Please store it securely.'
      }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Get all API keys (without the actual key values)
 * @route GET /api/auth/api-keys
 */
exports.getApiKeys = async (req, res, next) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      active, 
      organizationId, 
      environment,
      search 
    } = req.query;
    
    const query = {};
    if (active !== undefined) {
      query.isActive = active === 'true';
    }
    if (organizationId) {
      query.organization = organizationId;
    }
    if (environment) {
      query.environment = environment;
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { keyId: { $regex: search, $options: 'i' } }
      ];
    }
    
    const apiKeys = await ApiKey.find(query)
      .select('-keyHash')
      .populate('organization', 'name slug type')
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
 * Get specific API key details
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
      200,
      'API key retrieved successfully',
      { apiKey }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Update API key
 * @route PUT /api/auth/api-keys/:keyId
 */
exports.updateApiKey = async (req, res, next) => {
  try {
    const { keyId } = req.params;
    const { 
      name, 
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
      200,
      'API key updated successfully',
      { apiKey }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Deactivate API key
 * @route DELETE /api/auth/api-keys/:keyId
 */
exports.deactivateApiKey = async (req, res, next) => {
  try {
    const { keyId } = req.params;
    
    const apiKey = await ApiKey.findOne({ keyId });
    
    if (!apiKey) {
      return next(new ApiError(404, 'API key not found'));
    }
    
    apiKey.isActive = false;
    await apiKey.save();
    
    logger.info(`API key deactivated: ${keyId}`, {
      keyId,
      deactivatedBy: req.apiKey ? req.apiKey.keyId : 'system'
    });
    
    res.status(200).json(formatResponse(
      200,
      'API key deactivated successfully',
      { keyId }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Get API key usage statistics
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
      200,
      'API key statistics retrieved successfully',
      { stats }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Regenerate API key
 * @route POST /api/auth/api-keys/:keyId/regenerate
 */
exports.regenerateApiKey = async (req, res, next) => {
  try {
    const { keyId } = req.params;
    
    const existingApiKey = await ApiKey.findOne({ keyId });
    
    if (!existingApiKey) {
      return next(new ApiError(404, 'API key not found'));
    }
    
    // Generate new API key
    const { apiKey, keyHash } = ApiKey.generateApiKey();
    
    // Update the existing document with new key
    existingApiKey.keyHash = keyHash;
    await existingApiKey.save();
    
    logger.info(`API key regenerated: ${keyId}`, {
      keyId,
      regeneratedBy: req.apiKey ? req.apiKey.keyId : 'system'
    });
    
    res.status(200).json(formatResponse(
      200,
      'API key regenerated successfully',
      {
        apiKey,
        keyId,
        warning: 'This is the only time the new API key will be shown. Please store it securely.'
      }
    ));
  } catch (error) {
    next(error);
  }
};
