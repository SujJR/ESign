const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const { ApiError, formatResponse } = require('../utils/apiUtils');
const logger = require('../utils/logger');

/**
 * Generate JWT token
 * @param {string} id - User ID
 * @returns {string} - JWT token
 */
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN
  });
};

/**
 * Register a new user
 * @route POST /api/auth/register
 */
exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return next(new ApiError(400, 'Email already in use'));
    }
    
    // Create new user
    const user = await User.create({
      name,
      email,
      password
    });
    
    // Generate token
    const token = generateToken(user._id);
    
    // Remove password from output
    user.password = undefined;
    
    logger.info(`User registered: ${user.email}`);
    
    res.status(201).json(formatResponse(
      201,
      'User registered successfully',
      { user, token }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Login user
 * @route POST /api/auth/login
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // Check if email and password exist
    if (!email || !password) {
      return next(new ApiError(400, 'Please provide email and password'));
    }
    
    // Check if user exists and password is correct
    const user = await User.findOne({ email }).select('+password');
    
    if (!user || !(await user.isPasswordMatch(password))) {
      return next(new ApiError(401, 'Incorrect email or password'));
    }
    
    // Generate token
    const token = generateToken(user._id);
    
    // Remove password from output
    user.password = undefined;
    
    logger.info(`User logged in: ${user.email}`);
    
    res.status(200).json(formatResponse(
      200,
      'Login successful',
      { user, token }
    ));
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user profile
 * @route GET /api/auth/me
 */
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    res.status(200).json(formatResponse(
      200,
      'User profile retrieved successfully',
      { user }
    ));
  } catch (error) {
    next(error);
  }
};
