/**
 * Adobe Sign Configuration Validator and Health Check
 */

const logger = require('../utils/logger');
const { validateAdobeSignConfig, getAccessToken, fetchApiAccessPoints } = require('../config/adobeSign');

/**
 * Comprehensive Adobe Sign configuration health check
 */
const performAdobeSignHealthCheck = async () => {
  const healthCheck = {
    timestamp: new Date().toISOString(),
    configurationValid: false,
    accessTokenValid: false,
    apiAccessPointValid: false,
    errors: [],
    warnings: []
  };

  try {
    // Step 1: Validate basic configuration
    logger.info('🔍 Validating Adobe Sign configuration...');
    const configValidation = validateAdobeSignConfig();
    
    if (!configValidation.isValid) {
      healthCheck.errors.push(...configValidation.errors);
      logger.error('❌ Configuration validation failed:', configValidation.errors);
    } else {
      healthCheck.configurationValid = true;
      logger.info('✅ Configuration validation passed');
    }

    // Step 2: Test access token generation
    if (healthCheck.configurationValid) {
      try {
        logger.info('🔍 Testing access token generation...');
        const accessToken = await getAccessToken();
        
        if (accessToken && accessToken.length > 0) {
          healthCheck.accessTokenValid = true;
          logger.info('✅ Access token generated successfully');
          
          // Mask token for logging
          const maskedToken = `${accessToken.substring(0, 8)}...${accessToken.substring(accessToken.length - 8)}`;
          logger.info(`🔑 Token: ${maskedToken}`);
        } else {
          healthCheck.errors.push('Access token generation returned empty token');
          logger.error('❌ Access token generation failed - empty token');
        }
      } catch (tokenError) {
        healthCheck.errors.push(`Access token generation failed: ${tokenError.message}`);
        logger.error('❌ Access token generation failed:', tokenError.message);
        
        // Provide specific guidance based on error type
        if (tokenError.message.includes('401')) {
          healthCheck.errors.push('Authentication failed - check ADOBE_INTEGRATION_KEY');
        } else if (tokenError.message.includes('invalid_request')) {
          healthCheck.errors.push('Invalid request format - check Adobe Sign API configuration');
        }
      }
    }

    // Step 3: Test API access point fetching
    if (healthCheck.accessTokenValid) {
      try {
        logger.info('🔍 Testing API access point fetching...');
        const apiAccessPoints = await fetchApiAccessPoints();
        
        if (apiAccessPoints && apiAccessPoints.apiAccessPoint) {
          healthCheck.apiAccessPointValid = true;
          logger.info('✅ API access point fetched successfully');
          logger.info(`🌐 API Access Point: ${apiAccessPoints.apiAccessPoint}`);
        } else {
          healthCheck.warnings.push('API access point fetching succeeded but returned unexpected format');
          logger.warn('⚠️ API access point fetching returned unexpected format');
        }
      } catch (apiError) {
        healthCheck.errors.push(`API access point fetching failed: ${apiError.message}`);
        logger.error('❌ API access point fetching failed:', apiError.message);
      }
    }

    // Step 4: Provide recommendations
    const recommendations = [];
    
    if (!healthCheck.configurationValid) {
      recommendations.push('Update environment variables with valid Adobe Sign credentials');
    }
    
    if (!healthCheck.accessTokenValid) {
      recommendations.push('Verify ADOBE_INTEGRATION_KEY is correct and has proper permissions');
      recommendations.push('Ensure Adobe Sign application is properly configured');
    }
    
    if (!healthCheck.apiAccessPointValid && healthCheck.accessTokenValid) {
      recommendations.push('Check network connectivity to Adobe Sign servers');
      recommendations.push('Verify API base URL is correct for your Adobe Sign instance');
    }

    healthCheck.recommendations = recommendations;

    // Overall health status
    const isHealthy = healthCheck.configurationValid && 
                     healthCheck.accessTokenValid && 
                     healthCheck.apiAccessPointValid;

    if (isHealthy) {
      logger.info('🎉 Adobe Sign integration is healthy and ready to use!');
    } else {
      logger.error('🚨 Adobe Sign integration has issues that need to be resolved');
    }

    return {
      ...healthCheck,
      isHealthy,
      summary: isHealthy ? 
        'Adobe Sign integration is fully operational' : 
        `${healthCheck.errors.length} error(s) and ${healthCheck.warnings.length} warning(s) found`
    };

  } catch (error) {
    logger.error('❌ Health check failed with unexpected error:', error.message);
    return {
      ...healthCheck,
      isHealthy: false,
      errors: [...healthCheck.errors, `Unexpected error during health check: ${error.message}`],
      summary: 'Health check failed with unexpected error'
    };
  }
};

/**
 * Monitor Adobe Sign API calls and detect patterns
 */
const monitorApiCallPatterns = () => {
  const patterns = {
    authFailures: 0,
    rateLimitHits: 0,
    successfulCalls: 0,
    lastAuthFailure: null,
    lastRateLimitHit: null,
    consecutiveFailures: 0
  };

  return {
    recordAuthFailure: () => {
      patterns.authFailures++;
      patterns.consecutiveFailures++;
      patterns.lastAuthFailure = new Date();
      logger.warn(`🔒 Adobe Sign auth failure #${patterns.authFailures} (consecutive: ${patterns.consecutiveFailures})`);
    },
    
    recordRateLimitHit: () => {
      patterns.rateLimitHits++;
      patterns.lastRateLimitHit = new Date();
      logger.warn(`⏳ Adobe Sign rate limit hit #${patterns.rateLimitHits}`);
    },
    
    recordSuccess: () => {
      patterns.successfulCalls++;
      patterns.consecutiveFailures = 0;
      logger.debug(`✅ Adobe Sign successful call #${patterns.successfulCalls}`);
    },
    
    getPatterns: () => ({ ...patterns }),
    
    needsAttention: () => {
      return patterns.consecutiveFailures >= 3 || 
             patterns.authFailures >= 5 ||
             patterns.rateLimitHits >= 10;
    }
  };
};

module.exports = {
  performAdobeSignHealthCheck,
  monitorApiCallPatterns
};
