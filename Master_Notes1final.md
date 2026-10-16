# MASTER NOTES: Library OTP Service

Your main learning, troubleshooting, and defense document. It describes only the code that exists now.
Evidence labels used throughout:
- **Verified (output on record)**: you sent the terminal or database output.
- **Reported working**: you confirmed it works, but no output was captured.
- **Not yet run**: written but not tested.

---

## 1. Project overview

**What it does:** proves a student owns their school email. The service emails a 6-digit code (OTP). The student submits it, and if it is correct and recent, the student is marked `is_verified = 1`.

**Why it is separate from the main library system:** it can be built, tested, and explained on its own. The main system calls it over HTTP, so it works with any language the main system uses.

| Technology | Responsibility |
|---|---|
| Node.js | Runs the JavaScript server |
| Express 5 | Receives HTTP requests and routes them |
| MySQL 8 | Stores students (`tbl_users`) and OTP records (`tbl_otps`) |
| mysql2/promise | Lets Node talk to MySQL with async/await and connection pooling |
| Nodemailer + Gmail SMTP | Sends the email through Gmail |
| dotenv | Loads secrets from `.env` into `process.env` |
| crypto (built in) | Random OTP numbers (`randomInt`), HMAC hashing, constant-time comparison |
| helmet | Adds safe HTTP security headers |
| express-rate-limit | Limits repeated requests (in memory) |

---

## 2. Complete system flow

This is the flow of the **final implementation**.

Postman / client -> POST /api/otp/send { “email”: “...” }
Express -> helmet, JSON parser (10 kb limit)
-> sendIpLimiter (20 per 15 min per IP)
-> validateSendOtp (trim, lowercase, format check)
-> sendEmailLimiter (5 per 15 min per email)
-> otpController.sendOtp
otpService.requestOtp
-> BEGIN transaction
-> SELECT user FROM tbl_users WHERE email = ? FOR UPDATE
(unknown email: rollback, still return generic 200)
-> UPDATE older ‘active’ OTPs to ‘invalidated’
-> code = crypto.randomInt, padded to 6 digits
-> INSERT tbl_otps: HMAC-SHA256(“userId:code”),
expires_at = NOW() + 5 minutes
-> COMMIT, release connection
emailService -> Nodemailer sends the code via smtp.gmail.com
-> If sending fails: the new OTP row is set to ‘invalidated’
and the client gets 502 EMAIL_DELIVERY_FAILED
Student -> POST /api/otp/verify { “email”: “...”, “otp”: “004821” }
Express -> verifyIpLimiter -> validateVerifyOtp (6 digits, string)
-> verifyEmailLimiter -> otpController.verifyOtp
otpService.verifyOtp
-> BEGIN transaction
-> Lock student row (FOR UPDATE)
-> Lock latest ‘active’ OTP row (FOR UPDATE)
-> No active OTP: rollback, INVALID
-> Expired (MySQL NOW()): mark ‘invalidated’, commit, INVALID
-> Attempts already at max: mark ‘invalidated’, commit, LOCKED
-> Compare HMAC with timingSafeEqual
WRONG: attempts + 1
if that reaches max: mark ‘invalidated’, commit, LOCKED
otherwise commit, INVALID
RIGHT: UPDATE status = ‘used’ WHERE status = ‘active’
(checks affectedRows = 1)
UPDATE tbl_users SET is_verified = 1
COMMIT, VERIFIED
Controller -> VERIFIED: 200 success
LOCKED: 429 TOO_MANY_ATTEMPTS
INVALID: 400 INVALID_OR_EXPIRED_OTP
errorHandler -> Any unexpected error: 500 INTERNAL_ERROR (details only in the server terminal)


**Successful path in short:** request → validate → lock student → invalidate old codes → store new HMAC → email → student submits → lock → hash matches → mark used → set `is_verified = 1` → 200.

**Unsuccessful paths in short:**
- Bad input: 400 before touching the database.
- Wrong code: attempts +1 and committed. The last allowed wrong guess gives 429 and kills the code.
- Expired: marked invalidated, 400.
- Reused or replaced: no active row, 400.
- Email failure during send: the new code is invalidated, 502.
- Database down: 500 from errorHandler, server keeps running.

BOOK SEARCH (student, public)
GET /api/books/search?q=term
  -> validateBookSearch (2 to 100 characters)
  -> bookService.searchBooks: LIKE on title, author, category, with % and _ escaped
  -> availability label from available_copies (not the status column)
  -> 200 with up to 50 results

ADMIN BOOK MANAGEMENT
POST / PUT / DELETE /api/books[/:id]
  -> requireAdmin (x-admin-key, timing-safe comparison)
  -> validateBook (field rules, positive ID)
  -> bookService: insert, update, or delete; status recalculated on every copy change
  -> delete refused with BOOK_HAS_HISTORY if borrow records exist (ON DELETE RESTRICT)

BORROW (admin)
POST /api/borrows { user_id, book_id }
  -> requireAdmin -> validateCreateBorrow
  -> TRANSACTION: lock student, lock book, check no active loan, check copies,
     decrement copies, insert loan with due date = today + 14 days, COMMIT
RETURN (admin)
PUT /api/borrows/:id/return
  -> requireAdmin -> validateBorrowId
  -> TRANSACTION: read book_id, lock book, lock loan and recheck status,
     mark returned, increment copies, COMMIT

OVERDUE (admin and hourly timer)
POST /api/borrows/overdue/refresh, and runOverdueCheck() at startup and every hour
  -> UPDATE status 'borrowed' -> 'overdue' where due_date < today

---

## 3. Beginner-friendly analogy

**The school library counter.** You ask the librarian for a claim code. The librarian writes a *scrambled fingerprint* of the code in a logbook (`tbl_otps`), with a deadline and a note of how many wrong tries you've made. The real code goes to you in a sealed envelope (the email). When you come back, the librarian scrambles your code the same secret way and compares fingerprints. If they match before the deadline, the librarian marks "verified" on the class list (`tbl_users`) and tears up the slip so it can't be used again.

**Where the analogy breaks:**
- The scrambling is an HMAC with a secret key from `.env`, not a simple trick anyone can reverse. A stolen logbook alone is not enough.
- Locking in the database is not a sign on the counter. It is a lock on the logbook page, so two people can't write on the same slip at once.
- The librarian's "deadline" is MySQL's clock (`NOW()`), not a wall clock in the librarian's head.

---

## 4. Project folder and file guide

| File | Purpose | Depends on | Check first when... |
|---|---|---|---|
| `server.js` | Starts Express, mounts routes, error handlers, `/health` | config/env, config/db, routes, middleware | Server won't start, 404 on every route |
| `config/env.js` | Loads `.env`, validates settings, exports frozen config | `.env`, dotenv | "Missing required environment variables" |
| `config/db.js` | MySQL connection pool and startup check | config/env, mysql2 | MySQL errors |
| `config/email.js` | Nodemailer transporter for Gmail | config/env, nodemailer | Email login, timeout errors |
| `routes/otpRoutes.js` | URL to middleware + controller mapping | controllers, middleware | Wrong order of checks, 404 |
| `controllers/otpController.js` | HTTP in/out, maps service results to status codes | otpService | Wrong status code or message |
| `services/otpService.js` | All OTP logic: generate, hash, store, verify, lock | config/db, config/env, emailService | OTP accepted/rejected wrongly |
| `services/emailService.js` | Sends the OTP email | config/email, config/env | Email not sent |
| `middleware/validate.js` | Checks and cleans request bodies | none | 400 errors on valid input |
| `middleware/rateLimiter.js` | Request limits (IP and email) | express-rate-limit | Unexpected 429 |
| `middleware/errorHandler.js` | Turns errors into safe JSON | none | Unexpected 500, or wrong error code |
| `schema.sql` | Creates the database, tables, sample students | MySQL | Tables missing |
| `scripts/test-concurrency.js` | Dev-only concurrency test | running server, config, db | Test FAIL output |
| `.env` / `.env.example` | Real secrets (never commit) / placeholders | none | Any config problem |
| `.gitignore` | Keeps `.env`, `node_modules/`, logs out of git | none | Secrets about to be committed |

File	Purpose	Depends on	Check first when...
services/bookService.js	Search and admin book CRUD	config/db	Search results wrong, book update fails
services/borrowService.js	Borrow and return transactions	config/db	Copy count wrong, loan rejected
services/loanService.js	Loan listing and overdue marking	config/db	Overdue not marked, list filter wrong
controllers/bookController.js	HTTP for books	bookService	Wrong status code on a book route
controllers/borrowController.js	HTTP for borrowing	borrowService, loanService	Wrong status code on a borrow route
routes/bookRoutes.js, routes/borrowRoutes.js	URL to middleware mapping	controllers	404 on a route, or the key check is skipped
middleware/adminAuth.js	Checks x-admin-key	config/env	Every admin call returns 401
middleware/validateBook.js	Admin book input rules	none	Valid book rejected
middleware/validateBorrow.js	Borrow, return, and filter input rules	loanService (filter names)	Valid borrow rejected
migrations/002_books_and_borrow_records.sql	Creates book and loan tables	schema.sql	Tables missing, foreign key error

---

## 5. File connection map

server.js
├── config/env.js (validated settings)
├── config/db.js ──────── config/env.js
├── routes/otpRoutes.js
│ ├── middleware/rateLimiter.js
│ ├── middleware/validate.js
│ └── controllers/otpController.js
│ └── services/otpService.js
│ ├── config/db.js -> MySQL (tbl_users, tbl_otps)
│ ├── config/env.js (HMAC secret, expiry)
│ └── services/emailService.js
│ └── config/email.js -> Gmail SMTP
└── middleware/errorHandler.js (catches everything that calls next(err))
server.js
├── routes/bookRoutes.js     -> middleware/validate.js (search)
│                            -> middleware/adminAuth.js, validateBook.js
│                            -> controllers/bookController.js -> services/bookService.js
├── routes/borrowRoutes.js   -> middleware/adminAuth.js, validateBorrow.js
│                            -> controllers/borrowController.js
│                                 -> services/borrowService.js (transactions)
│                                 -> services/loanService.js (listing, overdue)
└── services/loanService.js  -> runOverdueCheck() every hour (from server.js)

**Request path, out and back:**
1. HTTP request enters `server.js` and reaches `otpRoutes.js`.
2. Rate limiter and validator read `req.body`, and either send a response or call `next()`.
3. The controller calls one service function with plain values (email, OTP), not `req` or `res`.
4. The service talks to MySQL through the pool and, for sends, to Gmail through the transporter.
5. The service returns a plain result (`true`, `'VERIFIED'`, `'LOCKED'`, `'INVALID'`) or throws an error.
6. The controller turns that result into a status code and JSON. Errors go to `errorHandler`.

---

## 6. Database explanation

Database: `library_otp_db`. Engine: InnoDB (needed for transactions and foreign keys). Character set: utf8mb4.



### tbl_users (the team's student table, plus two columns)

| Column | Type | Purpose |
|---|---|---|
| user_id | INT, PK, AUTO_INCREMENT | Student row ID |
| username | VARCHAR(50), UNIQUE | School login ID |
| password | VARCHAR(255) | Main system's password. The OTP service never reads or writes it. |
| full_name | VARCHAR(100) | Display name |
| email | VARCHAR(255), UNIQUE | Where the code is sent. **Added for OTP.** Case-insensitive uniqueness through the `_ci` collation. |
| role | ENUM('admin','student') | Account type |
| is_verified | TINYINT(1), default 0 | 1 after successful verification. **Added for OTP.** |
| created_at | DATETIME, default now | Row creation time |

tbl_books: book_id (PK), accession_no (unique), book_title, author, category, available_copies (CHECK 0 or more), status (available or borrowed, CHECK-constrained), date_added. Indexes on category and status.

tbl_borrow_records: borrow_id (PK), user_id (FK to tbl_users, ON DELETE RESTRICT), book_id (FK to tbl_books, ON DELETE RESTRICT), borrowed_date, due_date (CHECK: not before borrowed_date), return_date (NULL until returned), status (borrowed, returned, or overdue). Indexes on (user_id, status) and (book_id, status).

Relationships: one student has many loans; one book appears in many loans.

### tbl_otps (one row per generated code)

| Column | Type | Purpose |
|---|---|---|
| otp_id | INT, PK | Row ID |
| user_id | INT, FK to tbl_users.user_id, ON DELETE CASCADE | Which student. One student has many OTP rows over time (1:M). |
| code_hash | CHAR(64) | HMAC-SHA256 hex of `userId:code`. The code itself is never stored. |
| expires_at | DATETIME | The code is dead at or after this time |
| attempts | TINYINT UNSIGNED, default 0 | Wrong guesses so far |
| status | ENUM('active','used','invalidated') | Lifecycle: active, consumed, or retired |
| created_at | DATETIME, default now | When generated |

**Keys and indexes:**
- Primary keys: `user_id`, `otp_id`.
- Unique keys: `username`, `email` (prevents two students sharing an address).
- Foreign key: `fk_otps_user`. Every OTP row must belong to a real student.
- Index `(user_id, status)`: fast lookup of a student's active code.
- Index `expires_at`: for future cleanup of old rows.

**Safe inspection queries** (they leave out `code_hash`):
```sql
SELECT user_id, username, full_name, email, role, is_verified FROM tbl_users;

SELECT otp_id, user_id, status, attempts, expires_at, created_at
FROM tbl_otps ORDER BY otp_id DESC LIMIT 10;

-- Development only: reset a test student
UPDATE tbl_users SET is_verified = 0 WHERE user_id = 1;
```

---

## 7. OTP security explanation

| Protection | Where | Status |
|---|---|---|
| Secure random 6-digit code, leading zeros kept | `generateOtp()` uses `crypto.randomInt` | Implemented |
| Only an HMAC is stored, never the code | `hashOtp()` with `OTP_HMAC_SECRET` | Implemented |
| The HMAC includes the user ID | `"userId:code"` input | Implemented |
| Constant-time comparison | `hashesMatch()` with `timingSafeEqual` | Implemented |
| 5-minute expiry, judged by MySQL's clock | `DATE_ADD(NOW(), INTERVAL ...)` and `expires_at <= NOW()` | Implemented |
| Production refuses any expiry other than 5 minutes | `config/env.js` | Implemented |
| Attempt limit (default 5), code killed on the last wrong guess | `verifyOtp()` | Implemented |
| Single use | `status = 'active'` check plus `affectedRows` | Implemented |
| One active code per student | Old codes invalidated on each send, inside a transaction | Implemented |
| Concurrent verify protection | `FOR UPDATE` row locks on student and OTP | Implemented (concurrency script) |
| Email-failure cleanup | Failed send sets the row to `invalidated` | Implemented |
| Generic error messages | Same `INVALID_OR_EXPIRED_OTP` for all wrong cases | Implemented, partial (see L1) |
| Rate limits | Send and verify, per IP and per email | Implemented, in memory |

**Why a plain fast hash is not enough.** There are only 1,000,000 six-digit codes. Anyone who copies the database could hash all of them in about a second and read every code. An HMAC needs the secret key from `.env`, which is not in the database, so a copied database alone is not enough.

**Why transactions and row locks.** Without them, two simultaneous verify requests with the correct code could both read "active", both succeed, and reuse one code. The `FOR UPDATE` lock makes the second request wait. When it runs, the code is already `used`, so it fails. The second guard, `WHERE status = 'active'` with an `affectedRows` check, protects against any path that slips past the lock.

**Why failed attempts are committed.** Rolling back a failed attempt would undo the attempt counter, and guessing would be unlimited.

---

## 8. API reference

See `API_DOCUMENTATION.md` for full request and response examples. This file keeps only the summary:

| Method | URL | Purpose | Success |
|---|---|---|---|
| GET | `/health` | Server check | 200 |
| POST | `/api/otp/send` | Create and email a code | 200 |
| POST | `/api/otp/verify` | Check a code | 200 |

---

## 9. Environment and startup guide

| Variable | Meaning | Example (placeholder only) |
|---|---|---|
| PORT | Server port | `3000` |
| NODE_ENV | `development` or `production` | `development` |
| DB_HOST / DB_PORT | MySQL location | `localhost` / `3306` |
| DB_USER | MySQL app user (not root) | `library_otp_user` |
| DB_PASSWORD | MySQL app user's password | your own |
| DB_NAME | Database name | `library_otp_db` |
| OTP_HMAC_SECRET | 32+ character random secret | 64 hex characters |
| OTP_EXPIRY_MINUTES | 5. Shorter only if `NODE_ENV=development` | `5` |
| OTP_MAX_ATTEMPTS | Wrong guesses per code | `5` |
| GMAIL_USER | Sender Gmail address | your address |
| GMAIL_APP_PASSWORD | 16-character Google App Password | your own |
| EMAIL_FROM_NAME | Sender display name | `Library OTP Service` |
| SMTP_PORT | 465 (default) or 587 | `465` |

**Generate the HMAC secret:**

node -e “console.log(require(‘crypto’).randomBytes(32).toString(‘hex’))”


Startup order: `npm install`, then create the database and user (see README), fill in `.env`, then `npm run dev`.

**Never put real values in this file, in `.env.example`, or in any chat.**

| ADMIN_API_KEY | Shared admin key, 32+ characters, sent in x-admin-key | 64 hex characters |

---

## 10. Troubleshooting guide

| Symptom | Likely cause | Check first | Fix |
|---|---|---|---|
| `npm.ps1 cannot be loaded` | PowerShell policy | Terminal | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `Missing required environment variables: ...` | `.env` missing, misnamed, or blank | `.env` file name and location | Fix the variable, or re-check `.env.example` |
| `OTP_HMAC_SECRET is too short...` | Placeholder or short secret | `.env` | Generate a new one |
| `GMAIL_APP_PASSWORD must be the 16-character...` | Wrong length | `.env` | Paste the App Password without quotes |
| `Cannot find module 'mysql2/promise'` | Dependency missing | `npm list --depth=0` | `npm install mysql2` |
| `EADDRINUSE` | Port 3000 busy | Other programs | Change `PORT` |
| `ER_ACCESS_DENIED_ERROR` | Wrong `DB_USER` or `DB_PASSWORD` | `.env` against the `CREATE USER` password | `ALTER USER ... IDENTIFIED BY` |
| `ER_BAD_DB_ERROR` / `ER_NO_SUCH_TABLE` | Schema not run | `SHOW TABLES;` | `source schema.sql;` |
| `ECONNREFUSED` (MySQL) | MySQL stopped | `Get-Service MySQL*` | `net start MySQL80` (Administrator) |
| `EAUTH` / 535 (email) | Revoked or wrong App Password | Gmail App Passwords page | Create a new one, update `.env` |
| `ETIMEDOUT` / `ESOCKET` (email) | Network blocks port 465 | Network | `SMTP_PORT=587` |
| `400 INVALID_OR_EXPIRED_OTP` with a correct-looking code | Old code (a newer one replaced it), or older than 5 minutes | Newest email, SQL `status` column | Use the latest code |
| `400 INVALID_OTP_FORMAT` | Code sent as a number, or has spaces | Request body | Send `"otp": "004821"` in quotes |
| `429 TOO_MANY_ATTEMPTS` | 5 wrong guesses | `attempts` column | Request a new code |
| `429 RATE_LIMITED` | Too many requests in 15 minutes | Server restart clears it (dev only) | Wait, or restart in development |
| `500 INTERNAL_ERROR` | Database or code error | Server terminal (`Unhandled error:`) | Fix the error it names |
| Server behaves differently after restart | In-memory rate-limit counters reset | Expected behavior | Not a bug |

Startup: Missing required environment variables: ADMIN_API_KEY	Key not added to .env	Add the key, restart

Every admin call returns 401	Wrong or missing header	Use x-admin-key exactly, with the value from .env

ER_NO_SUCH_TABLE on a book or loan route	Migration 002 not run	source migrations/002_books_and_borrow_records.sql; as root

Book delete returns 409	Loan history exists	Expected. Keep the record.

Copies do not match loans	A manual SQL change, or a failed transaction	Check SELECT on both tables, then correct the count by hand

Overdue loan still shows borrowed	Hourly check has not run	Use POST /api/borrows/overdue/refresh, or restart

---

## 11. Testing guide

See `TESTING_GUIDE.md`. Summary of status:
- **Verified (output on record):** Stage 1 tools, Stage 2 server and `/health`, Stage 3 schema and connection, foreign key, `CURRENT_USER()`, Stage 4 Gmail login (Test A) and test email in Inbox (Test B).
- **Reported working:** all Stage 5 send tests, all Stage 6 verify tests, the concurrency script, and the MySQL-outage test. No captured output yet.

---

## 12. Future integration and feature expansion

### How the main library system connects
- The main system calls `POST /api/otp/send` and `POST /api/otp/verify` with JSON over HTTP. It can use any language.
- **Database ownership must be decided by the team.** The authoritative `tbl_users` belongs to the main library system. The OTP service should then either share that database and tables, or call the main system's API for student lookups and verification updates.
- The real `tbl_users` must get the `email` (unique) and `is_verified` (default 0) columns. Without them, the OTP service cannot work with the main database.
- The main system should identify students by `username` or `user_id`, but the OTP endpoints use `email`. Agree on this.
- Do **not** keep a second authoritative student database in production. This standalone database is for development and testing only.

### Where to change code for common future tasks

| Feature | Files to change | Also retest |
|---|---|---|
| Change email provider (e.g., SendGrid, SES) | `config/email.js`, `services/emailService.js`, `config/env.js` (new variables) | Send tests S1, S9 |
| Change the OTP length | `generateOtp()` and the `^\d{6}$` check in `middleware/validate.js` | All verify tests V1 to V8 |
| Change expiry or attempt limit | `.env` only (within the rules in `config/env.js`) | V4, V9 |
| Resend cooldown (e.g., 60 seconds) | `services/otpService.js` (`requestOtp`), plus a check on `created_at` | S7, S8 |
| Audit logging | New file `services/auditService.js`, called from `otpService.js` | Every endpoint |
| Automated tests (Jest or Node's built-in runner) | New `tests/` folder, `package.json` script | All |
| Different student lookup (by username) | `validate.js`, `otpService.js` lookup query, API docs | S1, S4, V1, V7 |
| Connect to the main login system | Share the `is_verified` value through the main system's database or API | Integration tests |
| Multi-server deployment | Replace in-memory limiter with a shared store (for example, Redis, or a database table) | S8, V10 |
| Cleanup of old OTP rows | New scheduled script using the `expires_at` index | Verify tests still pass |

**Rule for extension:** change the service layer first, then the controller, and touch routes and middleware only when a URL or check changes. Keep the controller free of SQL.

---

## 13. Known limitations and future improvements

### Limitations of the current build

ID	Limitation	Why it matters	Possible fix
L1	Send returns the same 200 for registered, unknown, and failed emails. A small timing difference remains.	Reduces the leak, does not remove it	Accept with explanation, or queue sends

L2	Rate limits are in memory, and they cover OTP routes only	Reset on restart. Book and borrow routes have no limit.	Shared store, and limits on admin routes

L3	Plain HTTP locally	Codes and keys travel unencrypted	HTTPS through a reverse proxy

L4	.env holds real secrets on disk	Anyone with the folder can read them	Secret manager

L5	No cleanup of old OTP rows	Table grows	Scheduled cleanup on expires_at

L6	Emails sent in the background, with no job queue	A restart can drop a pending email	Job queue

L7	Verify does not check whether the student is already verified	
Verified students can still request codes	Decide the policy

L8	No automated test suite	Regressions caught only by manual tests	Jest or Node’s test runner

L9	Gmail App Passwords need a personal account	School Workspace accounts cannot use them	School SMTP provider

L10	Development database is a copy	It can drift from real records	Integrate with the main system’s database

L11	Decimal expiry allowed in development	Must not reach production	config/env.js blocks it in production

L12	Sample students and books have placeholder values	Not real data	Main system’s data

L13	No audit trail	Cannot tell which admin changed what	Per-admin keys with logging

L14	One shared admin key	Every admin is the same identity. A leaked key grants full admin access.	Real admin accounts (tbl_users.role)

L15	Search is public	Anyone who can reach the server can search the catalog	Student login from the main system

L16	Copies are set by hand, and borrowing does not change them except through the transaction	A manual UPDATE can disagree with the loan records	Admin reconciliation report

L17	No automatic overdue notification	Students are not told	Reuse the email service

L18	No fines or renewals	Only days late are shown	Future feature

L19	Overdue check runs in the server process	Multiple server copies each run it (harmless but repeated)	Single scheduler

L20	No deadlock retry	Lock order prevents deadlocks in this code, but a retry is safer	Retry on ER_LOCK_DEADLOCK

### Must be addressed before any deployment
- Fix L1 and L3.
- Move secrets out of files (L4).
- Use a shared rate-limit store if more than one server process runs (L2).
- Decide database ownership with the team (L10).
- Add automated tests (L8).

---

## 14. Academic defense notes

**Why Node.js, Express, MySQL, and Nodemailer?**
Node.js runs JavaScript on the server, and the team already knows JavaScript. Express is a small, widely used web framework for routes. MySQL is the database the team's design already uses. Nodemailer is the standard Node library for sending email, and it works with Gmail SMTP.

**Why two tables?**
Students are long-lived records owned by the main system. OTPs are short-lived, and one student can have many over time. Keeping them in a separate table linked by a foreign key (one student to many OTPs) keeps each table focused and avoids storing a list of codes inside the student row.

**How is a six-digit OTP generated?**
`crypto.randomInt(0, 1000000)` picks a number from 0 to 999,999 using the operating system's secure random source. `padStart(6, '0')` adds leading zeros, so 4821 becomes "004821".

**Why is the OTP stored as an HMAC?**
Only 1,000,000 codes exist, so a plain hash could be reversed quickly. The HMAC uses a server secret from `.env`, so a copied database cannot be checked against codes without that secret.

**How does the five-minute expiration work?**
When the code is stored, MySQL sets `expires_at = NOW() + 5 minutes`. During verification, MySQL checks `expires_at <= NOW()`. Both use the database clock, so the two calculations agree.

**How does the service prevent reuse and excessive guessing?**
- Reuse: the code is marked `used` in the same transaction that sets `is_verified = 1`. The update only applies when the status is still `active`.
- Guessing: each wrong guess increases `attempts`. At the limit (default 5) the code is invalidated. Rate limits also cap how fast requests can come in.

**Why are transactions needed?**
A verification changes two tables: the OTP becomes `used`, and the student becomes verified. Both must happen together or not at all. Row locks stop two simultaneous requests from both succeeding.

**How does email delivery work?**
The service hands the message to Nodemailer, which connects to `smtp.gmail.com` over an encrypted connection, logs in with the App Password, and sends the message. If Gmail rejects it, the code is invalidated so no unseen code remains valid.

**How will it integrate with the main system?**
Over HTTP JSON endpoints. The team must agree on database ownership, the `email` and `is_verified` columns, and the student identifier. See section 12.

**What are the current limitations?**
See section 13. The most important for a defense are L1 (email existence leak), L2 (in-memory rate limits), and L3 (no HTTPS yet). Be ready to say they are known and how they would be fixed.

**Likely panel questions:**

| Question | Short answer |
|---|---|
| Why not store the OTP in plain text? | A database leak would expose every active code. The HMAC stores only a keyed fingerprint. |
| What if two people request codes at once? | The student row lock makes requests run one at a time. The newest code replaces the older one. |
| Why do wrong and expired codes return the same message? | So an attacker can't learn which case happened. |
| Can the code be guessed? | Only 5 tries per code, a short life, and rate limits. Odds of guessing one code are about 5 in 1,000,000. |
| Is it production-ready? | No. See section 13, "Must be addressed before any deployment". |

Question	Short answer
Why use a transaction for borrowing?	It lowers the copy count and creates the loan record. Both must succeed together. Otherwise the catalog and the loan history can disagree.

How do you stop two students from getting the last copy?	Both requests lock the book row with FOR UPDATE. The second waits, then sees zero copies and is refused. The concurrency script proves this.

Why lock in a fixed order?	Every operation locks the student, then the book, then the loan. Two operations that lock in the same order cannot wait on each other in a circle, so deadlocks cannot happen.

Why is status calculated from copies?	The number of copies is the real fact. status is derived from it, so the two cannot disagree when the code is correct.

Why is the admin protected by a shared key?	It is the simplest secure option for a prototype. The limitation is that every admin is the same identity, so it is not suitable for production.

Why is overdue marked by a timer and not calculated on every read?	A read should not change data. The list shows late loans correctly even before the timer runs, and the timer records the status.

---

## 15. File-by-file development record

| File | Key functions | Depends on | Related | Tests |
|---|---|---|---|---|
| `server.js` | App setup, mounts routes, error handlers | config/env, config/db, routes, middleware | `/health`, `/api/otp` | `/health` verified; startup verified |
| `config/env.js` | Validates `.env`, exports frozen config | dotenv, `.env` | All | Stage 2 and 4 startup verified |
| `config/db.js` | `pool`, `testConnection()` | config/env, mysql2 | tbl_users, tbl_otps | Stage 3 verified |
| `config/email.js` | `transporter` | config/env, nodemailer | Gmail SMTP | Stage 4 Test A verified |
| `services/emailService.js` | `sendOtpEmail(to, otp)` | config/email | Email delivery | Stage 4 Test B verified |
| `services/otpService.js` | `requestOtp`, `verifyOtp`, `generateOtp`, `hashOtp`, `hashesMatch` | config/db, config/env, emailService | tbl_users, tbl_otps | Send and verify tests reported working |
| `controllers/otpController.js` | `sendOtp`, `verifyOtp` | otpService | Both endpoints | Reported working |
| `routes/otpRoutes.js` | Route order and middleware chain | controller, middleware | Both endpoints | Reported working |
| `middleware/validate.js` | `validateSendOtp`, `validateVerifyOtp` | none | Request bodies | Reported working |
| `middleware/rateLimiter.js` | Four limiters | express-rate-limit | Both endpoints | Reported working |
| `middleware/errorHandler.js` | `notFound`, `errorHandler` | none | All routes | Reported working |
| `schema.sql` | Creates DB, tables, sample students | MySQL | All | Stage 3 verified |
| `scripts/test-concurrency.js` | Concurrency check | running server, config, db | verify endpoint | Reported working |

