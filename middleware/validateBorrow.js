// middleware/validateBorrow.js
// Checks borrow, return, and loan-list input BEFORE the controller runs.

const { FILTER_NAMES } = require('../services/loanService');

// Accepts only whole numbers greater than 0, such as 1, 2, 42.
function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

// POST /api/borrows: needs user_id and book_id as JSON numbers.
function validateCreateBorrow(req, res, next) {
  const body = req.body || {};

  if (!isPositiveInt(body.user_id) || !isPositiveInt(body.book_id)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_BORROW',
      message: 'Send "user_id" and "book_id" as positive whole numbers.',
    });
  }

  // Keep only the expected fields.
  req.body = { user_id: body.user_id, book_id: body.book_id };
  next();
}

// PUT /api/borrows/:id/return: the :id in the URL must be a positive whole number.
function validateBorrowId(req, res, next) {
  const id = req.params.id;

  if (!/^[1-9]\d*$/.test(id)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_BORROW_ID',
      message: 'The borrow ID must be a positive whole number.',
    });
  }

  res.locals.borrowId = Number(id);
  next();
}

// GET /api/borrows?status=...: optional. Defaults to 'active'.
// Only the names in FILTER_NAMES are accepted.
function validateLoanQuery(req, res, next) {
  const status = req.query.status === undefined ? 'active' : req.query.status;

  if (typeof status !== 'string' || !FILTER_NAMES.includes(status)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_STATUS_FILTER',
      message: `"status" must be one of: ${FILTER_NAMES.join(', ')}.`,
    });
  }

  res.locals.loanFilter = status;
  next();
}

module.exports = { validateCreateBorrow, validateBorrowId, validateLoanQuery };