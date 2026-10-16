// controllers/bookController.js
// HTTP layer for books: reads the cleaned input, calls the service,
// and shapes the response. No SQL and no business rules here.

const bookService = require('../services/bookService');

// Maps application error codes from the service to HTTP status codes.
const APP_ERROR_STATUS = {
  DUPLICATE_ACCESSION: 409,
  BOOK_HAS_HISTORY: 409,
  BOOK_NOT_FOUND: 404,
};

// Sends a known application error as JSON. Unknown errors go to errorHandler.
function handleError(err, res, next) {
  const status = APP_ERROR_STATUS[err.appCode];
  if (status) {
    return res.status(status).json({
      success: false,
      code: err.appCode,
      message: err.message,
    });
  }
  return next(err);
}

// GET /api/books/search?q=...
async function searchBooks(req, res, next) {
  try {
    // The validator stored the cleaned term in res.locals (see middleware/validate.js).
    const results = await bookService.searchBooks(res.locals.searchTerm);
    return res.status(200).json({
      success: true,
      count: results.length,
      results,
    });
  } catch (err) {
    return next(err);
  }
}

// POST /api/books (admin)
async function createBook(req, res, next) {
  try {
    const book = await bookService.createBook(req.body);
    return res.status(201).json({
      success: true,
      message: 'Book added.',
      book,
    });
  } catch (err) {
    return handleError(err, res, next);
  }
}

// PUT /api/books/:id (admin)
async function updateBook(req, res, next) {
  try {
    const book = await bookService.updateBook(res.locals.bookId, req.body);
    return res.status(200).json({
      success: true,
      message: 'Book updated.',
      book,
    });
  } catch (err) {
    return handleError(err, res, next);
  }
}

// DELETE /api/books/:id (admin)
async function deleteBook(req, res, next) {
  try {
    await bookService.deleteBook(res.locals.bookId);
    return res.status(200).json({
      success: true,
      message: 'Book deleted.',
    });
  } catch (err) {
    return handleError(err, res, next);
  }
}

module.exports = { searchBooks, createBook, updateBook, deleteBook };