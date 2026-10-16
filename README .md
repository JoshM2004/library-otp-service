# Library OTP and Book Service

Backend for the School Library Book Search Locator System. It provides:
- Email OTP verification for students
- Book search for students
- Book management, borrowing, returning, and overdue tracking for admins

## Requirements
- Node.js 18 or newer (tested with v24)
- MySQL 8
- A Gmail account with 2-Step Verification and an App Password

## Setup
1. `npm install`
2. Create the database as `root`:
   - `source schema.sql;`
   - `source migrations/002_books_and_borrow_records.sql;`
3. Create the app user (see the command in MASTER_NOTES.md section 9).
4. Copy `.env.example` to `.env` and fill in your values. Never commit `.env`.
5. Run `npm run dev`. You should see `OTP service listening on http://localhost:3000`
   and `MySQL connection OK`.

## Quick check
Open `http://localhost:3000/health`. It should return `{"success":true,"message":"OTP service is running"}`.

## Documentation
- `API_DOCUMENTATION.md`: every endpoint, request, and response
- `TESTING_GUIDE.md`: test cases and results
- `MASTER_NOTES.md`: how the system works, troubleshooting, and defense notes

## Scripts
- `node scripts/test-concurrency.js`: OTP concurrency test (server must be running)
- `node scripts/test-borrow-concurrency.js <book_id>`: borrow concurrency test