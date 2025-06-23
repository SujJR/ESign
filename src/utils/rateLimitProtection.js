/**
 * Adobe Sign API Rate Limit Protection
 * This module provides utilities to handle rate limiting from Adobe Sign API
 */

const logger = require('../utils/logger');

// Store rate limit information
const rateLimitStore = {
  isRateLimited: false,
  retryAfter: 0,
  retryAfterDate: null,
  rateLimitHits: 0,
  lastRateLimitHit: null
};

/**
 * Check if the system is currently rate limited
 * @returns {boolean} - True if rate limited
 */
const isRateLimited = () => {
  if (!rateLimitStore.isRateLimited) {
    return false;
  }
  
  // Check if we've passed the retry after time
  if (rateLimitStore.retryAfterDate && new Date() > rateLimitStore.retryAfterDate) {
    // Reset rate limit
    logger.info(`Rate limit period has expired. Resetting rate limit state.`);
    resetRateLimit();
    return false;
  }
  
  return true;
};

/**
 * Set rate limit information
 * @param {number} retryAfter - Seconds to wait before retrying
 */
const setRateLimit = (retryAfter) => {
  rateLimitStore.isRateLimited = true;
  rateLimitStore.retryAfter = retryAfter;
  rateLimitStore.retryAfterDate = new Date(Date.now() + (retryAfter * 1000));
  rateLimitStore.rateLimitHits++;
  rateLimitStore.lastRateLimitHit = new Date();
  
  logger.warn(`Adobe Sign rate limit set. Retry after ${retryAfter} seconds (${Math.ceil(retryAfter / 60)} minutes). ` +
    `Rate limit hits: ${rateLimitStore.rateLimitHits}.`);
};

/**
 * Reset rate limit information
 */
const resetRateLimit = () => {
  rateLimitStore.isRateLimited = false;
  rateLimitStore.retryAfter = 0;
  rateLimitStore.retryAfterDate = null;
  
  logger.info('Adobe Sign rate limit reset.');
};

/**
 * Get time remaining in rate limit period
 * @returns {number} - Seconds remaining
 */
const getTimeRemaining = () => {
  if (!rateLimitStore.isRateLimited || !rateLimitStore.retryAfterDate) {
    return 0;
  }
  
  const now = new Date();
  const diffMs = rateLimitStore.retryAfterDate - now;
  return Math.max(0, Math.ceil(diffMs / 1000));
};

/**
 * Get human-readable rate limit status
 * @returns {string} - Status message
 */
const getRateLimitStatus = () => {
  if (!rateLimitStore.isRateLimited) {
    return 'Not rate limited';
  }
  
  const timeRemaining = getTimeRemaining();
  
  if (timeRemaining <= 0) {
    resetRateLimit();
    return 'Rate limit period has expired';
  }
  
  const minutes = Math.ceil(timeRemaining / 60);
  return `Rate limited. Retry after ${timeRemaining} seconds (${minutes} minutes)`;
};

/**
 * Handle a rate limit response from Adobe Sign
 * @param {object} response - Response object from Adobe Sign API
 */
const handleRateLimitResponse = (response) => {
  if (response?.status === 429) {
    const retryAfter = response.data?.retryAfter || 3600; // Default to 1 hour if not specified
    setRateLimit(retryAfter);
    return true;
  }
  
  return false;
};

module.exports = {
  isRateLimited,
  setRateLimit,
  resetRateLimit,
  getTimeRemaining,
  getRateLimitStatus,
  handleRateLimitResponse,
  rateLimitStore
};
