const Organization = require('../models/organization.model');
const ApiKey = require('../models/apiKey.model');
const User = require('../models/user.model');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

// System user ID for organizations created via API
const SYSTEM_USER_ID = '68836d9590c9d926a4e64056';

/**
 * Create a new organization
 * @route POST /api/organizations
 */
exports.createOrganization = async (req, res, next) => {
  try {
    const {
      name,
      slug,
      type = 'client',
      description,
      contactEmail,
      contactPhone,
      website,
      address,
      settings = {},
      billing = {}
    } = req.body;

    if (!name || !contactEmail) {
      return next(new ApiError(400, 'Organization name and contact email are required'));
    }

    // Check if slug already exists
    if (slug) {
      const existingOrg = await Organization.findOne({ slug });
      if (existingOrg) {
        return next(new ApiError(400, 'Organization slug already exists'));
      }
    }

    // Merge with default settings
    const defaultSettings = {
      maxApiKeys: 10,
      defaultRateLimit: {
        requestsPerMinute: 100,
        requestsPerHour: 1000,
        requestsPerDay: 10000
      },
      allowedFeatures: ['document_upload', 'document_send', 'document_status'],
      webhookUrls: []
    };

    const defaultBilling = {
      plan: 'free',
      monthlyLimit: {
        documents: 10,
        recipients: 50
      },
      usage: {
        currentMonth: {
          documents: 0,
          recipients: 0,
          apiCalls: 0
        }
      }
    };

    const organization = new Organization({
      name,
      slug,
      type,
      description,
      contactEmail,
      contactPhone,
      website,
      address,
      settings: { ...defaultSettings, ...settings },
      billing: { ...defaultBilling, ...billing },
      createdBy: req.user?.id || new mongoose.Types.ObjectId(SYSTEM_USER_ID)
    });

    const savedOrganization = await organization.save();

    logger.info('Organization created successfully', {
      organizationId: savedOrganization._id,
      name: savedOrganization.name,
      slug: savedOrganization.slug,
      createdBy: req.user?.id || req.apiKey?.keyId || 'system'
    });

    res.status(201).json(formatResponse(
      savedOrganization,
      'Organization created successfully'
    ));
  } catch (error) {
    logger.error('Error creating organization:', error);
    next(new ApiError(500, 'Failed to create organization'));
  }
};

/**
 * Get all organizations
 * @route GET /api/organizations
 */
exports.getOrganizations = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      type,
      isActive,
      search
    } = req.query;

    const query = {};
    
    if (type) query.type = type;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
        { contactEmail: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const organizations = await Organization.find(query)
      .populate('apiKeyCount')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Organization.countDocuments(query);

    res.json(formatResponse({
      organizations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    }));
  } catch (error) {
    logger.error('Error fetching organizations:', error);
    next(new ApiError(500, 'Failed to fetch organizations'));
  }
};

/**
 * Get organization by ID
 * @route GET /api/organizations/:id
 */
exports.getOrganization = async (req, res, next) => {
  try {
    const organization = await Organization.findById(req.params.id)
      .populate('apiKeyCount');

    if (!organization) {
      return next(new ApiError(404, 'Organization not found'));
    }

    res.json(formatResponse(organization));
  } catch (error) {
    logger.error('Error fetching organization:', error);
    next(new ApiError(500, 'Failed to fetch organization'));
  }
};

/**
 * Update organization
 * @route PUT /api/organizations/:id
 */
exports.updateOrganization = async (req, res, next) => {
  try {
    const allowedUpdates = [
      'name', 'description', 'contactEmail', 'contactPhone', 'website',
      'address', 'settings', 'billing', 'isActive'
    ];
    
    const updates = {};
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    const organization = await Organization.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    if (!organization) {
      return next(new ApiError(404, 'Organization not found'));
    }

    logger.info('Organization updated successfully', {
      organizationId: organization._id,
      updatedBy: req.user?.id || req.apiKey?.keyId || 'system'
    });

    res.json(formatResponse(organization, 'Organization updated successfully'));
  } catch (error) {
    logger.error('Error updating organization:', error);
    next(new ApiError(500, 'Failed to update organization'));
  }
};

/**
 * Delete organization
 * @route DELETE /api/organizations/:id
 */
exports.deleteOrganization = async (req, res, next) => {
  try {
    const organization = await Organization.findById(req.params.id);

    if (!organization) {
      return next(new ApiError(404, 'Organization not found'));
    }

    // Check if organization has active API keys
    const activeApiKeys = await ApiKey.countDocuments({
      organization: organization._id,
      isActive: true
    });

    if (activeApiKeys > 0) {
      return next(new ApiError(400, 'Cannot delete organization with active API keys. Please deactivate all API keys first.'));
    }

    await Organization.findByIdAndDelete(req.params.id);

    logger.info('Organization deleted successfully', {
      organizationId: req.params.id,
      deletedBy: req.user?.id || req.apiKey?.keyId || 'system'
    });

    res.json(formatResponse(null, 'Organization deleted successfully'));
  } catch (error) {
    logger.error('Error deleting organization:', error);
    next(new ApiError(500, 'Failed to delete organization'));
  }
};

/**
 * Get organization API keys
 * @route GET /api/organizations/:id/api-keys
 */
exports.getOrganizationApiKeys = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, isActive, environment } = req.query;

    const query = { organization: req.params.id };
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (environment) query.environment = environment;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const apiKeys = await ApiKey.find(query)
      .select('-keyHash')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ApiKey.countDocuments(query);

    res.json(formatResponse({
      apiKeys,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    }));
  } catch (error) {
    logger.error('Error fetching organization API keys:', error);
    next(new ApiError(500, 'Failed to fetch API keys'));
  }
};

/**
 * Get organization usage statistics
 * @route GET /api/organizations/:id/usage
 */
exports.getOrganizationUsage = async (req, res, next) => {
  try {
    const organization = await Organization.findById(req.params.id);

    if (!organization) {
      return next(new ApiError(404, 'Organization not found'));
    }

    // Get API call statistics for the current month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const apiKeys = await ApiKey.find({
      organization: req.params.id,
      isActive: true
    }).select('usageCount lastUsed');

    const totalApiCalls = apiKeys.reduce((sum, key) => sum + (key.usageCount || 0), 0);

    const usageStats = {
      currentMonth: organization.billing.usage.currentMonth,
      limits: organization.billing.monthlyLimit,
      apiKeys: {
        total: apiKeys.length,
        totalCalls: totalApiCalls
      },
      resetDate: organization.billing.usage.resetDate,
      withinLimits: organization.isWithinLimits()
    };

    res.json(formatResponse(usageStats));
  } catch (error) {
    logger.error('Error fetching organization usage:', error);
    next(new ApiError(500, 'Failed to fetch usage statistics'));
  }
};

module.exports = exports;
