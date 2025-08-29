/**
 * Adobe Sign Multi-Factor Authentication (MFA) Configuration
 * This module handles MFA settings for document signing
 */

const logger = require('./logger');

/**
 * MFA Authentication Methods supported by Adobe Sign
 */
const MFA_METHODS = {
  NONE: 'NONE',
  EMAIL: 'EMAIL',
  PASSWORD: 'PASSWORD',
  PHONE: 'PHONE',
  KBA: 'KBA', // Knowledge-Based Authentication
  WEB_IDENTITY: 'WEB_IDENTITY',
  ADOBE_SIGN_AUTHENTICATION: 'ADOBE_SIGN_AUTHENTICATION'
};

/**
 * MFA Phone Authentication Types
 */
const PHONE_AUTH_TYPES = {
  SMS: 'SMS',
  VOICE: 'VOICE'
};

/**
 * Default MFA configuration
 */
const DEFAULT_MFA_CONFIG = {
  authenticationMethod: MFA_METHODS.EMAIL, // Default to email OTP
  phoneAuthentication: {
    type: PHONE_AUTH_TYPES.SMS,
    countryCode: '+1' // Default US country code
  },
  emailAuthentication: {
    enabled: true,
    requireVerification: true
  },
  passwordAuthentication: {
    enabled: false,
    customPassword: null
  },
  kbaAuthentication: {
    enabled: false,
    questionCount: 3
  }
};

/**
 * Generate authentication configuration for a recipient
 * @param {Object} recipient - Recipient information
 * @param {Object} mfaOptions - MFA configuration options
 * @returns {Object} Authentication configuration for Adobe Sign API
 */
const generateAuthenticationConfig = (recipient, mfaOptions = {}) => {
  try {
    const config = { ...DEFAULT_MFA_CONFIG, ...mfaOptions };
    
    const authConfig = {
      authenticationMethod: config.authenticationMethod
    };

    // Configure based on authentication method
    switch (config.authenticationMethod) {
      case MFA_METHODS.EMAIL:
        authConfig.emailAuthenticationInfo = {
          enabled: true,
          verificationRequired: config.emailAuthentication?.requireVerification ?? true
        };
        logger.info(`Email MFA configured for ${recipient.email || recipient}`);
        break;

      case MFA_METHODS.PHONE:
        if (!recipient.phone && !config.phoneAuthentication?.defaultPhone) {
          logger.warn(`Phone MFA requested but no phone number provided for ${recipient.email || recipient}. Falling back to email MFA.`);
          authConfig.authenticationMethod = MFA_METHODS.EMAIL;
          authConfig.emailAuthenticationInfo = {
            enabled: true,
            verificationRequired: true
          };
        } else {
          authConfig.phoneAuthenticationInfo = {
            phone: recipient.phone || config.phoneAuthentication?.defaultPhone,
            countryCode: config.phoneAuthentication?.countryCode || '+1',
            type: config.phoneAuthentication?.type || PHONE_AUTH_TYPES.SMS
          };
          logger.info(`Phone MFA (${authConfig.phoneAuthenticationInfo.type}) configured for ${recipient.email || recipient}`);
        }
        break;

      case MFA_METHODS.PASSWORD:
        authConfig.passwordAuthenticationInfo = {
          password: config.passwordAuthentication?.customPassword || generateSecurePassword(),
          enabled: true
        };
        logger.info(`Password MFA configured for ${recipient.email || recipient}`);
        break;

      case MFA_METHODS.KBA:
        authConfig.kbaAuthenticationInfo = {
          enabled: true,
          questionCount: config.kbaAuthentication?.questionCount || 3
        };
        logger.info(`KBA MFA configured for ${recipient.email || recipient}`);
        break;

      case MFA_METHODS.WEB_IDENTITY:
        authConfig.webIdentityAuthenticationInfo = {
          enabled: true
        };
        logger.info(`Web Identity MFA configured for ${recipient.email || recipient}`);
        break;

      case MFA_METHODS.ADOBE_SIGN_AUTHENTICATION:
        authConfig.adobeSignAuthenticationInfo = {
          enabled: true
        };
        logger.info(`Adobe Sign Authentication configured for ${recipient.email || recipient}`);
        break;

      case MFA_METHODS.NONE:
      default:
        logger.info(`No MFA configured for ${recipient.email || recipient}`);
        break;
    }

    return authConfig;
  } catch (error) {
    logger.error(`Error generating authentication config: ${error.message}`);
    // Fallback to email MFA
    return {
      authenticationMethod: MFA_METHODS.EMAIL,
      emailAuthenticationInfo: {
        enabled: true,
        verificationRequired: true
      }
    };
  }
};

/**
 * Generate a secure password for password-based authentication
 * @returns {string} Secure password
 */
const generateSecurePassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

/**
 * Validate MFA configuration
 * @param {Object} mfaConfig - MFA configuration to validate
 * @returns {Object} Validation result
 */
const validateMfaConfig = (mfaConfig) => {
  const errors = [];
  const warnings = [];

  if (!mfaConfig) {
    return {
      isValid: true,
      errors,
      warnings: ['No MFA configuration provided, using default email MFA']
    };
  }

  // Validate authentication method
  if (mfaConfig.authenticationMethod && !Object.values(MFA_METHODS).includes(mfaConfig.authenticationMethod)) {
    errors.push(`Invalid authentication method: ${mfaConfig.authenticationMethod}`);
  }

  // Validate phone authentication
  if (mfaConfig.authenticationMethod === MFA_METHODS.PHONE) {
    if (mfaConfig.phoneAuthentication?.type && !Object.values(PHONE_AUTH_TYPES).includes(mfaConfig.phoneAuthentication.type)) {
      errors.push(`Invalid phone authentication type: ${mfaConfig.phoneAuthentication.type}`);
    }
    if (!mfaConfig.phoneAuthentication?.countryCode) {
      warnings.push('No country code provided for phone authentication, using default +1');
    }
  }

  // Validate KBA settings
  if (mfaConfig.authenticationMethod === MFA_METHODS.KBA) {
    if (mfaConfig.kbaAuthentication?.questionCount && (mfaConfig.kbaAuthentication.questionCount < 1 || mfaConfig.kbaAuthentication.questionCount > 5)) {
      errors.push('KBA question count must be between 1 and 5');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * Apply MFA configuration to participant sets
 * @param {Array} participantSets - Array of participant sets
 * @param {Object} mfaOptions - MFA configuration options
 * @returns {Array} Enhanced participant sets with MFA configuration
 */
const applyMfaToParticipantSets = (participantSets, mfaOptions = {}) => {
  try {
    logger.info('Applying MFA configuration to participant sets');
    
    return participantSets.map((participantSet, setIndex) => {
      const enhancedSet = { ...participantSet };
      
      if (enhancedSet.memberInfos && enhancedSet.memberInfos.length > 0) {
        enhancedSet.memberInfos = enhancedSet.memberInfos.map((member, memberIndex) => {
          // Generate recipient-specific MFA config
          const recipientMfaOptions = {
            ...mfaOptions,
            // Allow per-recipient MFA overrides
            ...(member.mfaConfig || {})
          };
          
          const authConfig = generateAuthenticationConfig(member, recipientMfaOptions);
          
          return {
            ...member,
            ...authConfig
          };
        });
      }
      
      logger.info(`MFA applied to participant set ${setIndex + 1} with ${enhancedSet.memberInfos?.length || 0} members`);
      return enhancedSet;
    });
  } catch (error) {
    logger.error(`Error applying MFA to participant sets: ${error.message}`);
    throw error;
  }
};

/**
 * Get MFA configuration from environment variables or defaults
 * @returns {Object} MFA configuration
 */
const getMfaConfigFromEnv = () => {
  const config = {
    authenticationMethod: process.env.ADOBE_SIGN_MFA_METHOD || MFA_METHODS.EMAIL,
    emailAuthentication: {
      enabled: process.env.ADOBE_SIGN_EMAIL_MFA_ENABLED !== 'false',
      requireVerification: process.env.ADOBE_SIGN_EMAIL_MFA_VERIFICATION !== 'false'
    },
    phoneAuthentication: {
      type: process.env.ADOBE_SIGN_PHONE_MFA_TYPE || PHONE_AUTH_TYPES.SMS,
      countryCode: process.env.ADOBE_SIGN_PHONE_COUNTRY_CODE || '+1'
    },
    passwordAuthentication: {
      enabled: process.env.ADOBE_SIGN_PASSWORD_MFA_ENABLED === 'true',
      customPassword: process.env.ADOBE_SIGN_CUSTOM_PASSWORD || null
    },
    kbaAuthentication: {
      enabled: process.env.ADOBE_SIGN_KBA_MFA_ENABLED === 'true',
      questionCount: parseInt(process.env.ADOBE_SIGN_KBA_QUESTION_COUNT) || 3
    }
  };

  logger.info(`MFA configuration loaded: method=${config.authenticationMethod}`);
  return config;
};

module.exports = {
  MFA_METHODS,
  PHONE_AUTH_TYPES,
  DEFAULT_MFA_CONFIG,
  generateAuthenticationConfig,
  validateMfaConfig,
  applyMfaToParticipantSets,
  getMfaConfigFromEnv,
  generateSecurePassword
};
