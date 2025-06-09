const Log = require('../models/log.model');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');

/**
 * Get logs with pagination and filtering
 * @route GET /api/logs
 */
exports.getLogs = async (req, res, next) => {
  try {
    // Extract query parameters
    const {
      page = 1,
      limit = 10,
      level,
      startDate,
      endDate,
      documentId,
      userId
    } = req.query;
    
    // Build filter object
    const filter = {};
    
    // Add filters if provided
    if (level) filter.level = level;
    if (documentId) filter.documentId = documentId;
    if (userId) filter.userId = userId;
    
    // Add date range if provided
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get logs with pagination
    const logs = await Log.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('userId', 'name email')
      .populate('documentId', 'originalName');
    
    // Get total count
    const total = await Log.countDocuments(filter);
    
    res.status(200).json(formatResponse(
      200,
      'Logs retrieved successfully',
      {
        logs,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Get log summary statistics
 * @route GET /api/logs/summary
 */
exports.getLogsSummary = async (req, res, next) => {
  try {
    // Get counts by level
    const levelCounts = await Log.aggregate([
      { $group: { _id: '$level', count: { $sum: 1 } } }
    ]);
    
    // Format level counts
    const levelStats = {};
    levelCounts.forEach(item => {
      levelStats[item._id] = item.count;
    });
    
    // Get most recent logs
    const recentLogs = await Log.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('userId', 'name email')
      .populate('documentId', 'originalName');
    
    // Get logs by date (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const logsByDate = await Log.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 },
          errorCount: {
            $sum: { $cond: [{ $eq: ['$level', 'error'] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    res.status(200).json(formatResponse(
      200,
      'Log summary retrieved successfully',
      {
        levelStats,
        recentLogs,
        logsByDate
      }
    ));
  } catch (error) {
    next(error);
  }
};
