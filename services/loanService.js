// services/loanService.js
// Loan listing and overdue marking. No HTTP here (no req/res).

const { pool } = require('../config/db');

// Filter names allowed in ?status=. Each maps to a fixed SQL condition.
// User input is never placed inside the SQL text, only chosen from this list.
const FILTERS = {
  // Loans still out, whether on time or late.
  active: "r.status IN ('borrowed', 'overdue')",
  // Late loans: already marked, or still 'borrowed' but past the due date.
  overdue:
    "(r.status = 'overdue' OR (r.status = 'borrowed' AND r.due_date < CURRENT_DATE))",
  // Loans that came back.
  returned: "r.status = 'returned'",
};

const FILTER_NAMES = Object.keys(FILTERS);

/**
 * Lists loans with the student's name and the book title.
 * days_overdue is 0 for loans that are on time or already returned.
 */
async function listLoans(filterName) {
  const condition = FILTERS[filterName];

  const [rows] = await pool.query(
    `SELECT r.borrow_id,
            r.user_id,
            u.username,
            u.full_name,
            r.book_id,
            b.book_title,
            b.accession_no,
            DATE_FORMAT(r.borrowed_date, '%Y-%m-%d') AS borrowed_date,
            DATE_FORMAT(r.due_date, '%Y-%m-%d')      AS due_date,
            DATE_FORMAT(r.return_date, '%Y-%m-%d')   AS return_date,
            r.status,
            CASE
              WHEN r.status IN ('borrowed', 'overdue') AND r.due_date < CURRENT_DATE
                THEN DATEDIFF(CURRENT_DATE, r.due_date)
              ELSE 0
            END AS days_overdue
       FROM tbl_borrow_records r
       JOIN tbl_users u ON u.user_id = r.user_id
       JOIN tbl_books b ON b.book_id = r.book_id
      WHERE ${condition}
      ORDER BY r.due_date ASC, r.borrow_id ASC
      LIMIT 100`
  );

  return rows;
}

/**
 * Sets status = 'overdue' on every loan that is still 'borrowed' but past its due date.
 * Returns how many loans were changed. Running it twice is harmless.
 */
async function markOverdueLoans() {
  const [result] = await pool.query(
    "UPDATE tbl_borrow_records SET status = 'overdue' " +
      "WHERE status = 'borrowed' AND due_date < CURRENT_DATE"
  );
  return result.affectedRows;
}

module.exports = { listLoans, markOverdueLoans, FILTER_NAMES };