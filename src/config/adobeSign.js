const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Adobe Sign API client configuration
 */
const adobeSignConfig = {
  clientId: process.env.ADOBE_CLIENT_ID,
  clientSecret: process.env.ADOBE_CLIENT_SECRET,
  baseURL: process.env.ADOBE_API_BASE_URL,
  integrationKey: process.env.ADOBE_INTEGRATION_KEY,
};

/**
 * Creates an axios instance for Adobe Sign API calls
 * @param {string} accessToken - OAuth access token
 * @returns {object} - Axios instance configured for Adobe Sign API
 */
const createAdobeSignClient = (accessToken) => {
  const client = axios.create({
    baseURL: adobeSignConfig.baseURL,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'x-api-user': `email:${adobeSignConfig.integrationKey}`
    }
  });

  // Add response interceptor for error handling
  client.interceptors.response.use(
    (response) => response,
    (error) => {
      logger.error(`Adobe Sign API Error: ${error.message}`);
      if (error.response) {
        logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
      }
      return Promise.reject(error);
    }
  );

  return client;
};

/**
 * Gets an access token for Adobe Sign API
 * @returns {Promise<string>} - Access token
 */
const getAccessToken = async () => {
  try {
    // In a real implementation, you would use OAuth flow
    // This is a placeholder for demonstration purposes
    const response = await axios.post(`${adobeSignConfig.baseURL}/oauth/token`, {
      grant_type: 'client_credentials',
      client_id: adobeSignConfig.clientId,
      client_secret: adobeSignConfig.clientSecret,
      scope: 'agreement_read agreement_write agreement_send user_read user_write'
    });
    
    return response.data.access_token;
  } catch (error) {
    logger.error(`Error obtaining Adobe Sign access token: ${error.message}`);
    throw error;
  }
};

module.exports = {
  adobeSignConfig,
  createAdobeSignClient,
  getAccessToken
};
