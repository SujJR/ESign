const mongoose = require('mongoose');
const Organization = require('../models/organization.model');
const ApiKey = require('../models/apiKey.model');
const logger = require('./logger');

/**
 * Organization and API Key Management Utilities
 */

/**
 * Create a new organization
 * @param {Object} orgData - Organization data
 * @param {string} createdBy - User ID who created the organization
 * @returns {Object} Created organization
 */
const createOrganization = async (orgData, createdBy) => {
  try {
    const organization = new Organization({
      ...orgData,
      createdBy
    });
    
    await organization.save();
    logger.info(`Organization created: ${organization.name} (${organization.slug})`);
    return organization;
  } catch (error) {
    logger.error(`Error creating organization: ${error.message}`);
    throw error;
  }
};

/**
 * Create API key for an organization
 * @param {string} organizationId - Organization ID
 * @param {Object} keyData - API key data
 * @returns {Object} Created API key with full key value
 */
const createApiKeyForOrganization = async (organizationId, keyData) => {
  try {
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new Error('Organization not found');
    }

    // Check API key limit
    const existingKeyCount = await ApiKey.countDocuments({
      organization: organizationId,
      isActive: true
    });

    if (existingKeyCount >= organization.settings.maxApiKeys) {
      throw new Error(`Organization has reached the maximum limit of ${organization.settings.maxApiKeys} API keys`);
    }

    // Generate API key
    const { apiKey, keyId, prefix, keyHash } = ApiKey.generateApiKey(organization.slug);

    // Create API key document
    const newApiKey = new ApiKey({
      name: keyData.name,
      keyId,
      keyHash,
      prefix,
      organization: organizationId,
      environment: keyData.environment || 'production',
      permissions: keyData.permissions || ['documents:read', 'documents:write'],
      scopes: keyData.scopes || ['document_management'],
      rateLimit: {
        ...organization.settings.defaultRateLimit,
        ...keyData.rateLimit
      },
      allowedIPs: keyData.allowedIPs || [],
      allowedDomains: keyData.allowedDomains || [],
      expiresAt: keyData.expiresAt,
      metadata: keyData.metadata || {},
      createdBy: keyData.createdBy || 'system'
    });

    await newApiKey.save();

    logger.info(`API key created: ${keyId} for organization ${organization.name}`);

    return {
      apiKey,
      keyId,
      name: newApiKey.name,
      environment: newApiKey.environment,
      permissions: newApiKey.permissions,
      scopes: newApiKey.scopes,
      organization: {
        id: organization._id,
        name: organization.name,
        slug: organization.slug
      }
    };
  } catch (error) {
    logger.error(`Error creating API key: ${error.message}`);
    throw error;
  }
};

/**
 * Get organization by slug
 * @param {string} slug - Organization slug
 * @returns {Object} Organization
 */
const getOrganizationBySlug = async (slug) => {
  try {
    const organization = await Organization.findOne({ slug, isActive: true });
    return organization;
  } catch (error) {
    logger.error(`Error fetching organization by slug: ${error.message}`);
    throw error;
  }
};

/**
 * Get organization usage statistics
 * @param {string} organizationId - Organization ID
 * @returns {Object} Usage statistics
 */
const getOrganizationUsage = async (organizationId) => {
  try {
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new Error('Organization not found');
    }

    const apiKeyCount = await ApiKey.countDocuments({
      organization: organizationId,
      isActive: true
    });

    const totalApiCalls = await ApiKey.aggregate([
      { $match: { organization: mongoose.Types.ObjectId(organizationId), isActive: true } },
      { $group: { _id: null, totalCalls: { $sum: '$usageCount' } } }
    ]);

    return {
      organization: {
        id: organization._id,
        name: organization.name,
        slug: organization.slug,
        type: organization.type,
        plan: organization.billing.plan
      },
      usage: organization.billing.usage.currentMonth,
      limits: organization.billing.monthlyLimit,
      apiKeys: {
        count: apiKeyCount,
        maxAllowed: organization.settings.maxApiKeys,
        totalCalls: totalApiCalls[0]?.totalCalls || 0
      },
      withinLimits: organization.isWithinLimits(),
      resetDate: organization.billing.usage.resetDate
    };
  } catch (error) {
    logger.error(`Error fetching organization usage: ${error.message}`);
    throw error;
  }
};

/**
 * Validate API key and get organization context
 * @param {string} apiKey - Full API key
 * @returns {Object} API key and organization info
 */
const validateApiKeyWithOrganization = async (apiKey) => {
  try {
    // Extract keyId from the API key
    const keyIdMatch = apiKey.match(/^(ak_[a-z0-9-]+_[a-f0-9]{8})_/);
    if (!keyIdMatch) {
      throw new Error('Invalid API key format');
    }

    const keyId = keyIdMatch[1];

    // Find the API key with organization info
    const apiKeyDoc = await ApiKey.findOne({ keyId })
      .select('+keyHash')
      .populate('organization', 'name slug type isActive settings billing');

    if (!apiKeyDoc) {
      throw new Error('Invalid API key');
    }

    // Verify the API key
    if (!apiKeyDoc.verifyKey(apiKey)) {
      throw new Error('Invalid API key');
    }

    // Check if API key and organization are valid
    if (!apiKeyDoc.isValid() || !apiKeyDoc.organization.isActive) {
      throw new Error('API key or organization is inactive');
    }

    return {
      keyId: apiKeyDoc.keyId,
      name: apiKeyDoc.name,
      environment: apiKeyDoc.environment,
      permissions: apiKeyDoc.permissions,
      scopes: apiKeyDoc.scopes,
      organization: {
        id: apiKeyDoc.organization._id,
        name: apiKeyDoc.organization.name,
        slug: apiKeyDoc.organization.slug,
        type: apiKeyDoc.organization.type,
        settings: apiKeyDoc.organization.settings,
        billing: apiKeyDoc.organization.billing
      }
    };
  } catch (error) {
    logger.error(`Error validating API key: ${error.message}`);
    throw error;
  }
};

/**
 * Update organization usage
 * @param {string} organizationId - Organization ID
 * @param {string} usageType - Type of usage (documents, recipients, apiCalls)
 * @param {number} amount - Amount to increment
 */
const incrementOrganizationUsage = async (organizationId, usageType, amount = 1) => {
  try {
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new Error('Organization not found');
    }

    await organization.incrementUsage(usageType, amount);
    logger.debug(`Incremented ${usageType} usage by ${amount} for organization ${organization.name}`);
  } catch (error) {
    logger.error(`Error incrementing organization usage: ${error.message}`);
    throw error;
  }
};

/**
 * Deactivate API key
 * @param {string} keyId - API key ID
 * @param {string} reason - Reason for deactivation
 */
const deactivateApiKey = async (keyId, reason = 'Manual deactivation') => {
  try {
    const apiKey = await ApiKey.findOne({ keyId });
    if (!apiKey) {
      throw new Error('API key not found');
    }

    apiKey.isActive = false;
    apiKey.metadata.deactivationReason = reason;
    apiKey.metadata.deactivatedAt = new Date();
    
    await apiKey.save();
    logger.info(`API key deactivated: ${keyId}, reason: ${reason}`);
  } catch (error) {
    logger.error(`Error deactivating API key: ${error.message}`);
    throw error;
  }
};

/**
 * Get organization API keys
 * @param {string} organizationId - Organization ID
 * @param {Object} filters - Optional filters
 * @returns {Array} List of API keys
 */
const getOrganizationApiKeys = async (organizationId, filters = {}) => {
  try {
    const query = { organization: organizationId, ...filters };
    const apiKeys = await ApiKey.find(query)
      .select('-keyHash')
      .sort({ createdAt: -1 });

    return apiKeys;
  } catch (error) {
    logger.error(`Error fetching organization API keys: ${error.message}`);
    throw error;
  }
};

module.exports = {
  createOrganization,
  createApiKeyForOrganization,
  getOrganizationBySlug,
  getOrganizationUsage,
  validateApiKeyWithOrganization,
  incrementOrganizationUsage,
  deactivateApiKey,
  getOrganizationApiKeys
};
