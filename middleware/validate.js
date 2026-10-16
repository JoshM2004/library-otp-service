// middleware/validate.js
// Checks the request BEFORE it reaches the controller.
// Bad input is rejected early with a 400 so the database is never touched.

// Simple, practical email check (not a full RFC parser): something@something.something
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Reads and cleans body.email. If it's bad, this sends the 400 itself and returns null.
function readEmail(req, res) {
  // Express 5 leaves req.body undefined when no JSON was sent, so default to {}.
  const body = req.body || {};

  if (typeof body.email !== 'string') {
    res.status(400).json({
      success: false,
      code: 'INVALID_REQUEST',
      message: 'Request body must be JSON with an "email" string.',
    });
    return null;
  }

  // Normalize: trim spaces and lowercase, so "A@x.com " and "a@x.com" are the same.
  const email = body.email.trim().toLowerCase();

  if (email.length === 0 || email.length > 254 || !EMAIL_REGEX.test(email)) {
    res.status(400).json({
      success: false,
      code: 'INVALID_EMAIL',
      message: 'Please provide a valid email address.',
    });
    return null;
  }
  return email;
}

function validateSendOtp(req, res, next) {
  const email = readEmail(req, res);
  if (!email) return; // response already sent

  // Later code (rate limiter, controller) always reads the cleaned value.
  req.body.email = email;
  next();
}

function validateVerifyOtp(req, res, next) {
  const email = readEmail(req, res);
  if (!email) return;

  // The OTP must be a STRING: a JSON number would lose leading zeros ("004821" -> 4821).
  if (typeof req.body.otp !== 'string') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_REQUEST',
      message: 'Request body must include "otp" as a string.',
    });
  }

  const otp = req.body.otp.trim();
  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_OTP_FORMAT',
      message: 'The code must be exactly 6 digits.',
    });
  }

  req.body.email = email;
  req.body.otp = otp;
  next();
}

// Search term for GET /api/books/search?q=...
// Must be a single string of 2 to 100 characters after trimming.
function validateBookSearch(req, res, next) {
  const q = req.query.q;

  if (typeof q !== 'string') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_REQUEST',
      message: 'Provide a search term in the "q" query parameter.',
    });
  }

  const term = q.trim();
  if (term.length < 2 || term.length > 100) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_SEARCH',
      message: 'The search term must be between 2 and 100 characters.',
    });
  }

  // Store the cleaned term for the controller. req.query itself is read-only in Express 5.
  res.locals.searchTerm = term;
  next();
}

module.exports = { validateSendOtp, validateVerifyOtp, validateBookSearch };