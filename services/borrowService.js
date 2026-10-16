// services/borrowService.js
// Borrow and return logic. Each action is ONE transaction with row locks.
// No HTTP here (no req/res).

const { pool } = require('../config/db');

const LOAN_DAYS = 14; // standard loan period (development value; the team can change it)

function appError(appCode, message) {
  const error = new Error(message);
  error.appCode = appCode;
  return error;
}

// Same status rule as Stage 9 and 11: copies above 0 means 'available', otherwise 'borrowed'.
function statusFor(copies) {
  return copies > 0 ? 'available' : 'borrowed';
}

/**
 * Returns one borrow record with dates as plain text (YYYY-MM-DD).
 * DATE_FORMAT avoids the timezone shift that JavaScript Date objects cause in JSON.
 */
async function getBorrowById(borrowId) {
  const [rows] = await pool.query(
    `SELECT borrow_id,
            user_id,
            book_id,
            DATE_FORMAT(borrowed_date, '%Y-%m-%d') AS borrowed_date,
            DATE_FORMAT(due_date, '%Y-%m-%d')      AS due_date,
            DATE_FORMAT(return_date, '%Y-%m-%d')   AS return_date,
            status
       FROM tbl_borrow_records
      WHERE borrow_id = ?`,
    [borrowId]
  );
  return rows[0] || null;
}

/**
 * Records a borrow. Everything below happens in ONE transaction.
 *
 * Lock order: student, then book, then (insert) borrow record.
 * returnBook uses the same order (book before borrow record), so the two
 * can never wait on each other in a circle (deadlock).
 */
async function borrowBook(userId, bookId) {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Lock the student row. Confirms the student exists.
    const [users] = await conn.query(
      'SELECT user_id FROM tbl_users WHERE user_id = ? FOR UPDATE',
      [userId]
    );
    if (users.length === 0) {
      throw appError('USER_NOT_FOUND', 'No student exists with this ID.');
    }

    // 2. Lock the book row. Other borrow or return requests for this book now wait.
    const [books] = await conn.query(
      'SELECT book_id, available_copies FROM tbl_books WHERE book_id = ? FOR UPDATE',
      [bookId]
    );
    if (books.length === 0) {
      throw appError('BOOK_NOT_FOUND', 'No book exists with this ID.');
    }

    // 3. One active loan per student per book.
    const [active] = await conn.query(
      "SELECT borrow_id FROM tbl_borrow_records " +
        "WHERE user_id = ? AND book_id = ? AND status IN ('borrowed', 'overdue') LIMIT 1",
      [userId, bookId]
    );
    if (active.length > 0) {
      throw appError('ALREADY_BORROWED', 'This student already has this book checked out.');
    }

    // 4. Check copies. Safe to read because the book row is locked.
    const copies = books[0].available_copies;
    if (copies <= 0) {
      throw appError('NO_COPIES_AVAILABLE', 'No copies of this book are available right now.');
    }

    // 5. Take one copy and update the status in the same statement.
    await conn.query(
      'UPDATE tbl_books SET available_copies = ?, status = ? WHERE book_id = ?',
      [copies - 1, statusFor(copies - 1), bookId]
    );

    // 6. Record the loan. MySQL sets both dates, so one clock is used.
    const [result] = await conn.query(
      'INSERT INTO tbl_borrow_records (user_id, book_id, borrowed_date, due_date) ' +
        'VALUES (?, ?, CURRENT_DATE, DATE_ADD(CURRENT_DATE, INTERVAL ? DAY))',
      [userId, bookId, LOAN_DAYS]
    );

    // 7. Both changes become visible together, or neither does.
    await conn.commit();
    const borrow = await getBorrowById(result.insertId);
    return borrow;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* connection may already be gone */ }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Records a return. Lock order: book, then borrow record (same as borrowBook's book-before-record rule).
 */
async function returnBook(borrowId) {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Read which book this loan is for. No lock yet: we need the book ID to know what to lock first.
    const [peek] = await conn.query(
      'SELECT book_id FROM tbl_borrow_records WHERE borrow_id = ?',
      [borrowId]
    );
    if (peek.length === 0) {
      throw appError('BORROW_NOT_FOUND', 'No borrow record exists with this ID.');
    }
    const bookId = peek[0].book_id;

    // 2. Lock the book row first (same order as borrowBook).
    const [books] = await conn.query(
      'SELECT available_copies FROM tbl_books WHERE book_id = ? FOR UPDATE',
      [bookId]
    );

    // 3. Lock the borrow record and re-check its status now that we hold the lock.
    //    This is what stops two simultaneous returns from both adding a copy.
    const [records] = await conn.query(
      'SELECT status FROM tbl_borrow_records WHERE borrow_id = ? FOR UPDATE',
      [borrowId]
    );
    if (records.length === 0) {
      throw appError('BORROW_NOT_FOUND', 'No borrow record exists with this ID.');
    }
    if (records[0].status === 'returned') {
      throw appError('ALREADY_RETURNED', 'This book has already been returned.');
    }

    // 4. Mark the loan returned.
    await conn.query(
      "UPDATE tbl_borrow_records SET status = 'returned', return_date = CURRENT_DATE WHERE borrow_id = ?",
      [borrowId]
    );

    // 5. Put the copy back on the shelf and update the status.
    const copies = books[0].available_copies + 1;
    await conn.query(
      'UPDATE tbl_books SET available_copies = ?, status = ? WHERE book_id = ?',
      [copies, statusFor(copies), bookId]
    );

    await conn.commit();
    const borrow = await getBorrowById(borrowId);
    return borrow;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* connection may already be gone */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { borrowBook, returnBook };