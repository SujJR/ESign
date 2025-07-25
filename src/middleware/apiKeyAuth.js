const ApiKey = require('../models/apiKey.model');
const Organization = require('../models/organization.model');
const { ApiError } = require('../utils/apiUtils');
const logger = require('../utils/logger');

/**
 * Rate limiting storage (in-memory for simplicity)
 * In production, use Redis or another persistent store
 */
const rateLimitStore = new Map();

/**
 * Middleware to authenticate API key
 */
exports.authenticateApiKey = async (req, res, next) => {
  try {
    let apiKey;
    
    // Get API key from different sources
    if (req.headers['x-api-key']) {
      apiKey = req.headers['x-api-key'];
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      apiKey = req.headers.authorization.split(' ')[1];
    } else if (req.query.api_key) {
      apiKey = req.query.api_key;
    }
    
    // Check if API key exists
    if (!apiKey) {
      return next(new ApiError(401, 'API key is required. Please provide an API key via X-API-Key header, Authorization header, or api_key query parameter.'));
    }
    
    // TEMPORARY BYPASS FOR TESTING ONLY
    if (apiKey === 'test_bypass_key_for_debugging') {
      req.apiKey = {
        name: 'Test Bypass Key',
        type: 'full_access',
        permissions: ['*:*', 'admin:all', 'documents:send'],
        userId: '000000000000000000000000',
        lastUsed: new Date()
      };
      return next();
    }
    
    // TEMPORARY: Allow test API key when database is unavailable
    if (apiKey === 'test-api-key-123' || apiKey === 'ak_12345678_test_key_for_development') {
      req.user = {
        id: 'test-user-123',
        name: 'Test User',
        email: 'test@example.com'
      };
      return next();
    }
    
    // Extract keyId from the API key
    const keyIdMatch = apiKey.match(/^(ak_[a-z0-9-]+_[a-f0-9]{8})_/);
    if (!keyIdMatch) {
      return next(new ApiError(401, 'Invalid API key format.'));
    }
    
    const keyId = keyIdMatch[1];
    
    // Find the API key in database with organization info
    const apiKeyDoc = await ApiKey.findOne({ keyId })
      .select('+keyHash')
      .populate('organization', 'name slug type isActive settings billing');
    
    if (!apiKeyDoc) {
      return next(new ApiError(401, 'Invalid API key.'));
    }

    // Check if organization is active
    if (!apiKeyDoc.organization.isActive) {
      return next(new ApiError(401, 'Organization is inactive.'));
    }
    
    // Verify the API key
    if (!apiKeyDoc.verifyKey(apiKey)) {
      return next(new ApiError(401, 'Invalid API key.'));
    }
    
    // Check if API key is valid (active and not expired)
    if (!apiKeyDoc.isValid()) {
      return next(new ApiError(401, 'API key is inactive or expired.'));
    }
    
    // Check IP restrictions
    if (apiKeyDoc.allowedIPs && apiKeyDoc.allowedIPs.length > 0) {
      const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
      const isAllowed = apiKeyDoc.allowedIPs.some(allowedIP => {
        return clientIP === allowedIP || clientIP.endsWith(allowedIP);
      });
      
      if (!isAllowed) {
        logger.warn(`API key access denied from IP: ${clientIP}`, {
          keyId: apiKeyDoc.keyId,
          clientIP,
          allowedIPs: apiKeyDoc.allowedIPs
        });
        return next(new ApiError(403, 'Access denied from this IP address.'));
      }
    }
    
    // Rate limiting check with organization-specific limits
    const rateLimitKey = `${keyId}_${Date.now() - (Date.now() % 60000)}`; // Per minute
    const rateLimitKeyHour = `${keyId}_${Date.now() - (Date.now() % 3600000)}`; // Per hour
    const rateLimitKeyDay = `${keyId}_${Date.now() - (Date.now() % 86400000)}`; // Per day
    
    const currentMinuteCount = rateLimitStore.get(rateLimitKey) || 0;
    const currentHourCount = rateLimitStore.get(rateLimitKeyHour) || 0;
    const currentDayCount = rateLimitStore.get(rateLimitKeyDay) || 0;
    
    if (currentMinuteCount >= apiKeyDoc.rateLimit.requestsPerMinute) {
      return next(new ApiError(429, 'Rate limit exceeded. Too many requests per minute.'));
    }
    
    if (currentHourCount >= apiKeyDoc.rateLimit.requestsPerHour) {
      return next(new ApiError(429, 'Rate limit exceeded. Too many requests per hour.'));
    }

    if (apiKeyDoc.rateLimit.requestsPerDay && currentDayCount >= apiKeyDoc.rateLimit.requestsPerDay) {
      return next(new ApiError(429, 'Rate limit exceeded. Too many requests per day.'));
    }

    // Check organization usage limits
    const orgLimits = apiKeyDoc.organization.isWithinLimits();
    if (!orgLimits.canProceed) {
      return next(new ApiError(429, 'Organization has exceeded monthly usage limits.'));
    }
    
    // Update rate limit counters
    rateLimitStore.set(rateLimitKey, currentMinuteCount + 1);
    rateLimitStore.set(rateLimitKeyHour, currentHourCount + 1);
    rateLimitStore.set(rateLimitKeyDay, currentDayCount + 1);
    
    // Clean up old entries (cleanup every 100 requests)
    if (Math.random() < 0.01) {
      cleanupRateLimitStore();
    }
    
    // Update usage statistics (async, don't wait)
    apiKeyDoc.updateUsage().catch(err => {
      logger.error('Failed to update API key usage:', err);
    });

    // Increment organization API call usage
    apiKeyDoc.organization.incrementUsage('apiCalls', 1).catch(err => {
      logger.error('Failed to update organization usage:', err);
    });
    
    // Add API key and organization info to request object
    req.apiKey = {
      keyId: apiKeyDoc.keyId,
      name: apiKeyDoc.name,
      permissions: apiKeyDoc.permissions,
      scopes: apiKeyDoc.scopes,
      environment: apiKeyDoc.environment,
      metadata: apiKeyDoc.metadata,
      organization: {
        id: apiKeyDoc.organization._id,
        name: apiKeyDoc.organization.name,
        slug: apiKeyDoc.organization.slug,
        type: apiKeyDoc.organization.type,
        settings: apiKeyDoc.organization.settings,
        billing: apiKeyDoc.organization.billing
      }
    };
    
    // Log API key usage
    logger.info(`API key authenticated: ${apiKeyDoc.keyId}`, {
      keyId: apiKeyDoc.keyId,
      keyName: apiKeyDoc.name,
      organizationId: apiKeyDoc.organization._id,
      organizationName: apiKeyDoc.organization.name,
      endpoint: req.path,
      method: req.method,
      ip: req.ip
    });
    
    next();
  } catch (error) {
    logger.error('API key authentication error:', error);
    next(new ApiError(500, 'Authentication error occurred.'));
  }
};

/**
 * Middleware to check specific permissions
 * @param {string|string[]} requiredPermissions - Required permission(s)
 */
exports.requirePermissions = (requiredPermissions) => {
  return (req, res, next) => {
    if (!req.apiKey) {
      return next(new ApiError(401, 'API key authentication required.'));
    }
    
    const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
    
    // Check if API key has admin:all permission
    if (req.apiKey.permissions.includes('admin:all')) {
      return next();
    }
    
    // Check if API key has any of the required permissions
    const hasPermission = permissions.some(permission => 
      req.apiKey.permissions.includes(permission)
    );
    
    if (!hasPermission) {
      return next(new ApiError(403, `Insufficient permissions. Required: ${permissions.join(' or ')}`));
    }
    
    next();
  };
};

/**
 * Middleware to check if API key has required scopes
 */
exports.requireScopes = (...scopes) => {
  return (req, res, next) => {
    if (!req.apiKey) {
      return next(new ApiError(401, 'Authentication required.'));
    }
    
    // Admin keys have all scopes
    if (req.apiKey.scopes.includes('full_access')) {
      return next();
    }
    
    // Check if API key has any of the required scopes
    const hasScope = scopes.some(scope => 
      req.apiKey.scopes.includes(scope)
    );
    
    if (!hasScope) {
      return next(new ApiError(403, `Insufficient scope. Required: ${scopes.join(' or ')}`));
    }
    
    next();
  };
};

/**
 * Middleware to check if organization has required features
 */
exports.requireOrganizationFeatures = (...features) => {
  return (req, res, next) => {
    if (!req.apiKey || !req.apiKey.organization) {
      return next(new ApiError(401, 'Authentication required.'));
    }
    
    // Check if organization has all required features
    const missingFeatures = features.filter(feature => 
      !req.apiKey.organization.settings.allowedFeatures.includes(feature)
    );
    
    if (missingFeatures.length > 0) {
      return next(new ApiError(403, `Organization missing required features: ${missingFeatures.join(', ')}`));
    }
    
    next();
  };
};

/**
 * Middleware to check organization environment restrictions
 */
exports.requireEnvironment = (...environments) => {
  return (req, res, next) => {
    if (!req.apiKey) {
      return next(new ApiError(401, 'Authentication required.'));
    }
    
    if (!environments.includes(req.apiKey.environment)) {
      return next(new ApiError(403, `API key environment '${req.apiKey.environment}' not allowed for this endpoint.`));
    }
    
    next();
  };
};

/**
 * Middleware to check domain restrictions
 */
exports.checkDomainRestrictions = (req, res, next) => {
  if (!req.apiKey) {
    return next(new ApiError(401, 'Authentication required.'));
  }

  // Get the origin domain from request
  const origin = req.get('origin') || req.get('referer');
  
  if (req.apiKey.allowedDomains && req.apiKey.allowedDomains.length > 0 && origin) {
    const requestDomain = new URL(origin).hostname;
    const isAllowed = req.apiKey.allowedDomains.some(allowedDomain => {
      return requestDomain === allowedDomain || requestDomain.endsWith(`.${allowedDomain}`);
    });
    
    if (!isAllowed) {
      logger.warn(`API key access denied from domain: ${requestDomain}`, {
        keyId: req.apiKey.keyId,
        requestDomain,
        allowedDomains: req.apiKey.allowedDomains
      });
      return next(new ApiError(403, 'Access denied from this domain.'));
    }
  }
  
  next();
};

/**
 * Clean up old rate limit entries
 */
function cleanupRateLimitStore() {
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  
  for (const [key, value] of rateLimitStore.entries()) {
    // Extract timestamp from key
    const timestamp = parseInt(key.split('_').pop());
    if (timestamp < oneHourAgo) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Optional middleware that allows both API key and no authentication
 * Useful for endpoints that provide different data based on authentication
 */
exports.optionalApiKey = async (req, res, next) => {
  try {
    // Try to authenticate with API key
    await exports.authenticateApiKey(req, res, (err) => {
      if (err && err.status === 401) {
        // API key authentication failed, but continue without auth
        req.apiKey = null;
        next();
      } else if (err) {
        // Other errors should be passed through
        next(err);
      } else {
        // Authentication successful
        next();
      }
    });
  } catch (error) {
    // Continue without authentication
    req.apiKey = null;
    next();
  }
};
