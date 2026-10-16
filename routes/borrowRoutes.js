// routes/borrowRoutes.js
// URL to middleware + controller mapping for borrowing and loan listing.
// Every route is admin-only: the key is checked before any validation.

const express = require('express');
const {
  createBorrow,
  returnBorrow,
  listBorrows,
  refreshOverdue,
} = require('../controllers/borrowController');
const { requireAdmin } = require('../middleware/adminAuth');
const {
  validateCreateBorrow,
  validateBorrowId,
  validateLoanQuery,
} = require('../middleware/validateBorrow');

const router = express.Router();

// GET /api/borrows?status=active : list loans
router.get('/', requireAdmin, validateLoanQuery, listBorrows);

// POST /api/borrows : record a borrow
router.post('/', requireAdmin, validateCreateBorrow, createBorrow);

// POST /api/borrows/overdue/refresh : mark past-due loans as overdue
router.post('/overdue/refresh', requireAdmin, refreshOverdue);

// PUT /api/borrows/:id/return : record a return
router.put('/:id/return', requireAdmin, validateBorrowId, returnBorrow);

module.exports = router;