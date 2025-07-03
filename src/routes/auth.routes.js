const express = require('express');
const authController = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');

const router = express.Router();

// User registration endpoint - documentation removed (manual authentication)
// Register new user
router.post('/register', authController.register);

// User login endpoint - documentation removed (manual authentication)
// Login user
router.post('/login', authController.login);

// Get current user profile endpoint - documentation removed (manual authentication)
// Get current user (protected route)
router.get('/me', protect, authController.getMe);

module.exports = router;
