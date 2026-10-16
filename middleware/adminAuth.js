// middleware/adminAuth.js
// Lets a request through only if it carries the correct admin key in the
// "x-admin-key" header. This is a shared-secret check for the prototype.

const crypto = require('crypto');
const config = require('../config/env');

// Hash both values first. Two SHA-256 digests always have the same length,
// so timingSafeEqual can be used safely, and the key's length is not revealed.
function digest(text) {
  return crypto.createHash('sha256').update(text).digest();
}

function requireAdmin(req, res, next) {
  const provided = req.get('x-admin-key') || '';

  if (provided.length > 0 && crypto.timingSafeEqual(digest(provided), digest(config.admin.apiKey))) {
    return next();
  }

  // Same message whether the header is missing or wrong, so nothing is revealed.
  return res.status(401).json({
    success: false,
    code: 'UNAUTHORIZED',
    message: 'Admin key missing or incorrect.',
  });
}

module.exports = { requireAdmin };
