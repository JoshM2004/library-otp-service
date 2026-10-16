// controllers/borrowController.js
// HTTP layer for borrowing. Reads cleaned input, calls the services,
// and maps application errors to HTTP status codes.

const borrowService = require('../services/borrowService');
const loanService = require('../services/loanService');

const APP_ERROR_STATUS = {
  USER_NOT_FOUND: 404,
  BOOK_NOT_FOUND: 404,
  BORROW_NOT_FOUND: 404,
  ALREADY_BORROWED: 409,
  NO_COPIES_AVAILABLE: 409,
  ALREADY_RETURNED: 409,
};

function handleError(err, res, next) {
  const status = APP_ERROR_STATUS[err.appCode];
  if (status) {
    return res.status(status).json({
      success: false,
      code: err.appCode,
      message: err.message,
    });
  }
  return next(err); // unexpected: errorHandler returns a safe 500
}

// POST /api/borrows (admin)
async function createBorrow(req, res, next) {
  try {
    const borrow = await borrowService.borrowBook(req.body.user_id, req.body.book_id);
    return res.status(201).json({
      success: true,
      message: 'Book borrowed.',
      borrow,
    });
  } catch (err) {
    return handleError(err, res, next);
  }
}

// PUT /api/borrows/:id/return (admin)
async function returnBorrow(req, res, next) {
  try {
    const borrow = await borrowService.returnBook(res.locals.borrowId);
    return res.status(200).json({
      success: true,
      message: 'Book returned.',
      borrow,
    });
  } catch (err) {
    return handleError(err, res, next);
  }
}

// GET /api/borrows?status=active|overdue|returned (admin). Read-only.
async function listBorrows(req, res, next) {
  try {
    const loans = await loanService.listLoans(res.locals.loanFilter);
    return res.status(200).json({
      success: true,
      filter: res.locals.loanFilter,
      count: loans.length,
      loans,
    });
  } catch (err) {
    return next(err);
  }
}

// POST /api/borrows/overdue/refresh (admin). Marks past-due loans as overdue.
async function refreshOverdue(req, res, next) {
  try {
    const marked = await loanService.markOverdueLoans();
    return res.status(200).json({
      success: true,
      message: 'Overdue check complete.',
      marked,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createBorrow, returnBorrow, listBorrows, refreshOverdue };