// routes/bookRoutes.js
// URL to middleware + controller mapping for book features.
// Each route runs its functions in order; any of them can stop the request.

const express = require('express');
const {
  searchBooks,
  createBook,
  updateBook,
  deleteBook,
} = require('../controllers/bookController');
const { validateBookSearch } = require('../middleware/validate');
const { requireAdmin } = require('../middleware/adminAuth');
const {
  validateCreateBook,
  validateUpdateBook,
  validateBookId,
} = require('../middleware/validateBook');

const router = express.Router();

// Student (public for now): GET /api/books/search?q=keyword
router.get('/search', validateBookSearch, searchBooks);

// Admin only: key check first, then validation, then the controller.
router.post('/', requireAdmin, validateCreateBook, createBook);
router.put('/:id', requireAdmin, validateBookId, validateUpdateBook, updateBook);
router.delete('/:id', requireAdmin, validateBookId, deleteBook);

module.exports = router;