// middleware/rateLimiter.js
// Limits how often OTPs can be requested or checked. Counts are kept in memory:
// OK for local development and one server process; they reset on restart.

const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function tooMany(req, res) {
  res.status(429).json({
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please try again later.',
  });
}

function makeLimiter(limit, keyGenerator) {
  const options = {
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-7', // sends RateLimit headers so clients can see their limit
    legacyHeaders: false,
    handler: tooMany,
  };
  if (keyGenerator) options.keyGenerator = keyGenerator;
  return rateLimit(options);
}

// Per IP address (stops one machine flooding the service).
const sendIpLimiter = makeLimiter(20);
const verifyIpLimiter = makeLimiter(30);

// Per email address. These run AFTER validation, so req.body.email is already clean.
const byEmail = (req) => req.body.email;
const sendEmailLimiter = makeLimiter(5, byEmail);    // stops flooding one student's inbox
const verifyEmailLimiter = makeLimiter(20, byEmail); // extra layer on top of per-OTP attempts

module.exports = { sendIpLimiter, sendEmailLimiter, verifyIpLimiter, verifyEmailLimiter };