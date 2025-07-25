const Log = require('../models/log.model');
const logger = require('./logger');

/**
 * Database logger that stores logs with organization context
 */
class OrganizationLogger {
  /**
   * Log to both winston and database with organization context
   */
  static async log(level, message, req = null, metadata = {}) {
    try {
      // Prepare log data
      const logData = {
        level,
        message,
        metadata,
        ipAddress: req?.ip || req?.connection?.remoteAddress,
        userAgent: req?.get ? req.get('User-Agent') : null,
        requestPath: req?.path || req?.originalUrl,
        requestMethod: req?.method
      };

      // Add organization context if available
      if (req?.apiKey) {
        logData.organization = req.apiKey.organization?.id;
        logData.apiKeyId = req.apiKey.keyId;
        logData.apiKeyName = req.apiKey.name;
        
        // Add organization info to metadata for winston
        metadata.organizationId = req.apiKey.organization?.id;
        metadata.organizationName = req.apiKey.organization?.name;
        metadata.apiKeyId = req.apiKey.keyId;
        metadata.environment = req.apiKey.environment;
      }

      // Add user context if available
      if (req?.user) {
        logData.userId = req.user.id;
        metadata.userId = req.user.id;
      }

      // Add document context if available
      if (req?.params?.id || metadata.documentId) {
        logData.documentId = req.params.id || metadata.documentId;
      }

      // Log to winston with context
      logger[level](message, metadata);

      // Save to database asynchronously
      const dbLog = new Log(logData);
      await dbLog.save();

    } catch (error) {
      // Don't let logging errors crash the application
      logger.error('Failed to save log to database:', error);
    }
  }

  static async info(message, req = null, metadata = {}) {
    await this.log('info', message, req, metadata);
  }

  static async error(message, req = null, metadata = {}) {
    await this.log('error', message, req, metadata);
  }

  static async warn(message, req = null, metadata = {}) {
    await this.log('warn', message, req, metadata);
  }

  static async debug(message, req = null, metadata = {}) {
    await this.log('debug', message, req, metadata);
  }

  /**
   * Get logs for a specific organization
   */
  static async getOrganizationLogs(organizationId, options = {}) {
    const {
      page = 1,
      limit = 50,
      level = null,
      startDate = null,
      endDate = null,
      search = null
    } = options;

    const query = { organization: organizationId };

    if (level) query.level = level;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    if (search) {
      query.$or = [
        { message: { $regex: search, $options: 'i' } },
        { 'metadata.action': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    
    const logs = await Log.find(query)
      .populate('organization', 'name slug')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Log.countDocuments(query);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get logs for a specific API key
   */
  static async getApiKeyLogs(apiKeyId, options = {}) {
    const {
      page = 1,
      limit = 50,
      level = null,
      startDate = null,
      endDate = null
    } = options;

    const query = { apiKeyId };

    if (level) query.level = level;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;
    
    const logs = await Log.find(query)
      .populate('organization', 'name slug')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Log.countDocuments(query);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get organization activity summary
   */
  static async getOrganizationActivity(organizationId, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const activity = await Log.aggregate([
      {
        $match: {
          organization: organizationId,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            level: "$level"
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: "$_id.date",
          levels: {
            $push: {
              level: "$_id.level",
              count: "$count"
            }
          },
          totalLogs: { $sum: "$count" }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    return activity;
  }
}

module.exports = OrganizationLogger;
