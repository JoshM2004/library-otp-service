// routes/otpRoutes.js
// Maps URLs to middleware + controller. Order matters: each function runs
// in sequence, and any of them can stop the request by sending a response.

const express = require('express');
const { sendOtp, verifyOtp } = require('../controllers/otpController');
const { validateSendOtp, validateVerifyOtp } = require('../middleware/validate');
const {
  sendIpLimiter,
  sendEmailLimiter,
  verifyIpLimiter,
  verifyEmailLimiter,
} = require('../middleware/rateLimiter');

const router = express.Router();

// POST /api/otp/send   : IP limit -> validate -> email limit -> controller
router.post('/send', sendIpLimiter, validateSendOtp, sendEmailLimiter, sendOtp);

// POST /api/otp/verify : IP limit -> validate -> email limit -> controller
router.post('/verify', verifyIpLimiter, validateVerifyOtp, verifyEmailLimiter, verifyOtp);

module.exports = router;