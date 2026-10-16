// middleware/errorHandler.js
// One place that turns any error into a safe, consistent JSON response.
// It never sends stack traces, SQL, or secrets to the client.

function notFound(req, res) {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: 'Route not found.',
  });
}

// Express recognizes an error handler by its 4 parameters. Keep all four.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Broken JSON in the request body (e.g. a missing quote).
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_JSON',
      message: 'Request body is not valid JSON.',
    });
  }

  // Body bigger than the 10kb limit set in server.js.
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large.',
    });
  }

  // Email provider failed (thrown by services/emailService.js).
  if (err.code === 'EMAIL_DELIVERY_FAILED') {
    return res.status(502).json({
      success: false,
      code: 'EMAIL_DELIVERY_FAILED',
      message: 'We could not send the verification email. Please try again later.',
    });
  }

  // Anything else (database down, bug, ...). Log details for YOU, hide them from the client.
  console.error('Unhandled error:', err.code || 'UNKNOWN', err.message);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again later.',
  });
}

module.exports = { notFound, errorHandler };