// controllers/otpController.js
// Translates between HTTP and the OTP service: reads the request, calls the
// service, and shapes the response. No business logic lives here.

const otpService = require('../services/otpService');

async function sendOtp(req, res, next) {
  try {
    // req.body.email was already validated and normalized by middleware/validate.js.
    // Email delivery happens in the background, so only database errors reach the catch.
    await otpService.requestOtp(req.body.email);
  } catch (err) {
    return next(err); // errorHandler returns a generic 500
  }

  // Identical response for registered, unknown, and email-failed cases (L1 fix).
  return res.status(200).json({
    success: true,
    message: 'If this email is registered, a verification code has been sent.',
  });
}

async function verifyOtp(req, res, next) {
  try {
    const outcome = await otpService.verifyOtp(req.body.email, req.body.otp);

    if (outcome === 'VERIFIED') {
      return res.status(200).json({
        success: true,
        message: 'Email verified successfully.',
      });
    }

    if (outcome === 'LOCKED') {
      return res.status(429).json({
        success: false,
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many incorrect attempts. Please request a new code.',
      });
    }

    // 'INVALID': deliberately vague (wrong, expired, used, replaced, or unknown email).
    return res.status(400).json({
      success: false,
      code: 'INVALID_OR_EXPIRED_OTP',
      message: 'The code is invalid or has expired.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { sendOtp, verifyOtp };