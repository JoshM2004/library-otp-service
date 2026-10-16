// services/bookService.js
// Book business logic: searching the catalog and admin book management.
// No HTTP here (no req/res).

const { pool } = require('../config/db');

// Only these columns may be changed through the update function.
const UPDATABLE_FIELDS = ['accession_no', 'book_title', 'author', 'category', 'available_copies'];

/**
 * Creates an error that carries an application code (for example BOOK_NOT_FOUND).
 * The controller reads appCode and chooses the HTTP status.
 */
function appError(appCode, message) {
  const error = new Error(message);
  error.appCode = appCode;
  return error;
}

/**
 * Status column rule (same as the availability label in searchBooks):
 * copies above 0 means 'available', otherwise 'borrowed'.
 */
function statusFor(copies) {
  return copies > 0 ? 'available' : 'borrowed';
}

/**
 * Escapes the LIKE wildcards % and _ (and the escape character itself),
 * so a student typing "%" or "_" searches for those characters literally.
 */
function escapeLike(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

// ---------------------------------------------------------------
// Student search (Stage 10)
// ---------------------------------------------------------------

/**
 * Searches title, author, and category. Returns up to 50 books sorted by title.
 * The availability label comes from available_copies, not the status column.
 */
async function searchBooks(term) {
  const pattern = `%${escapeLike(term)}%`;

  // Every value goes through a ? placeholder, so user input never becomes SQL.
  const [rows] = await pool.query(
    `SELECT book_id,
            book_title,
            author,
            category,
            CASE WHEN available_copies > 0 THEN 'Available' ELSE 'Borrowed' END AS availability
       FROM tbl_books
      WHERE book_title LIKE ? OR author LIKE ? OR category LIKE ?
      ORDER BY book_title
      LIMIT 50`,
    [pattern, pattern, pattern]
  );

  return rows;
}

// ---------------------------------------------------------------
// Admin management (Stage 11)
// ---------------------------------------------------------------

/**
 * Returns one full book row (including accession_no), or null if it does not exist.
 */
async function getBookById(bookId) {
  const [rows] = await pool.query(
    'SELECT book_id, accession_no, book_title, author, category, available_copies, status, date_added ' +
      'FROM tbl_books WHERE book_id = ?',
    [bookId]
  );
  return rows[0] || null;
}

/**
 * Inserts a new book. Throws DUPLICATE_ACCESSION if the accession number already exists.
 */
async function createBook(data) {
  try {
    const [result] = await pool.query(
      'INSERT INTO tbl_books (accession_no, book_title, author, category, available_copies, status) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
      [
        data.accession_no,
        data.book_title,
        data.author,
        data.category,
        data.available_copies,
        statusFor(data.available_copies),
      ]
    );
    return getBookById(result.insertId);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw appError('DUPLICATE_ACCESSION', 'A book with this accession number already exists.');
    }
    throw err;
  }
}

/**
 * Updates the given fields of one book. If available_copies changes,
 * status is recalculated in the same statement.
 */
async function updateBook(bookId, changes) {
  const existing = await getBookById(bookId);
  if (!existing) {
    throw appError('BOOK_NOT_FOUND', 'No book exists with this ID.');
  }

  // Build the SET list only from whitelisted column names.
  const fields = Object.keys(changes).filter((field) => UPDATABLE_FIELDS.includes(field));
  const sets = fields.map((field) => `${field} = ?`);
  const values = fields.map((field) => changes[field]);

  if ('available_copies' in changes) {
    sets.push('status = ?');
    values.push(statusFor(changes.available_copies));
  }

  try {
    await pool.query(`UPDATE tbl_books SET ${sets.join(', ')} WHERE book_id = ?`, [
      ...values,
      bookId,
    ]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw appError('DUPLICATE_ACCESSION', 'A book with this accession number already exists.');
    }
    throw err;
  }

  return getBookById(bookId);
}

/**
 * Deletes a book. MySQL refuses if borrow records point to it (ON DELETE RESTRICT),
 * and that refusal is turned into BOOK_HAS_HISTORY.
 */
async function deleteBook(bookId) {
  try {
    const [result] = await pool.query('DELETE FROM tbl_books WHERE book_id = ?', [bookId]);
    if (result.affectedRows === 0) {
      throw appError('BOOK_NOT_FOUND', 'No book exists with this ID.');
    }
    return true;
  } catch (err) {
    // Sinasalo na nito ang parehong ER_ROW_IS_REFERENCED at ER_ROW_IS_REFERENCED_2, pati ang MySQL error number 1451
    if (
      err.code === 'ER_ROW_IS_REFERENCED' || 
      err.code === 'ER_ROW_IS_REFERENCED_2' || 
      err.errno === 1451
    ) {
      throw appError(
        'BOOK_HAS_HISTORY',
        'This book has borrowing history and cannot be deleted. Mark it as withdrawn instead.'
      );
    }
    throw err;
  }
}

module.exports = { searchBooks, createBook, updateBook, deleteBook };