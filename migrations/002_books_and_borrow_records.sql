-- migrations/002_books_and_borrow_records.sql
-- Adds the book catalog and borrowing history tables.
-- Matches the team's ERD (DATABASE-SCHEMA.docx). Safe to run more than once.
-- Run as the MySQL root user (the app user cannot CREATE tables).

USE library_otp_db;

-- ---------------------------------------------------------------
-- tbl_books: the library catalog.
-- status mirrors availability: 'available' when available_copies > 0,
-- 'borrowed' when no copies are left. The application keeps the two in sync.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_books (
  book_id          INT          NOT NULL AUTO_INCREMENT,
  accession_no     VARCHAR(30)  NOT NULL,              -- library's unique copy/catalog number
  book_title       VARCHAR(150) NOT NULL,
  author           VARCHAR(100) NOT NULL,
  category         VARCHAR(60)  NOT NULL,
  available_copies INT          NOT NULL DEFAULT 0,
  status           VARCHAR(20)  NOT NULL DEFAULT 'available',
  date_added       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (book_id),
  UNIQUE KEY uq_books_accession (accession_no),
  KEY idx_books_category (category),
  KEY idx_books_status (status),
  CONSTRAINT chk_books_copies CHECK (available_copies >= 0),
  CONSTRAINT chk_books_status CHECK (status IN ('available', 'borrowed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- tbl_borrow_records: one row per borrowing event.
-- One student can have many records (1 : M), and one book can appear
-- in many records over time (1 : M).
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_borrow_records (
  borrow_id     INT  NOT NULL AUTO_INCREMENT,
  user_id       INT  NOT NULL,                        -- the student who borrowed
  book_id       INT  NOT NULL,                        -- the book that was borrowed
  borrowed_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  due_date      DATE NOT NULL,
  return_date   DATE NULL,                            -- NULL until the book comes back
  status        ENUM('borrowed', 'returned', 'overdue') NOT NULL DEFAULT 'borrowed',
  PRIMARY KEY (borrow_id),
  KEY idx_borrow_user_status (user_id, status),       -- "what does this student have out?"
  KEY idx_borrow_book_status (book_id, status),       -- "is this book out right now?"
  CONSTRAINT fk_borrow_user
    FOREIGN KEY (user_id) REFERENCES tbl_users (user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_borrow_book
    FOREIGN KEY (book_id) REFERENCES tbl_books (book_id) ON DELETE RESTRICT,
  CONSTRAINT chk_borrow_dates CHECK (due_date >= borrowed_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- Sample books for development and testing only.
-- Re-running this file will not create duplicates.
-- ---------------------------------------------------------------
INSERT INTO tbl_books (accession_no, book_title, author, category, available_copies, status)
VALUES
  ('ACC-0001', 'Introduction to Algorithms',   'Test Author A', 'Computer Science', 3, 'available'),
  ('ACC-0002', 'Basic Principles of Physics',  'Test Author B', 'Science',          1, 'available'),
  ('ACC-0003', 'Philippine History Reader',    'Test Author C', 'History',          0, 'borrowed'),
  ('ACC-0004', 'Short Stories Anthology',     'Test Author D', 'Literature',       2, 'available')
ON DUPLICATE KEY UPDATE accession_no = accession_no;