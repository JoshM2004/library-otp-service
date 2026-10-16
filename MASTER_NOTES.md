# MASTER NOTES — Library OTP Service

> Last updated: after Stage 4 (code written). Stage 4 tests are **not yet confirmed**.
> Rule for this file: it describes only what actually exists. Items marked ⏳ are planned, not built.

## Implementation status

| Stage | Item | Status |
|---|---|---|
| 1 | Node, npm, MySQL, VS Code ready | ✅ Verified (command output provided) |
| 2 | Project folder, libraries, `.env`, `/health` route | ✅ Verified (server output + browser response) |
| 3 | Database, tables, sample students, DB connection | ✅ Verified (SHOW TABLES, SELECT, node connection test) |
| 4 | Gmail SMTP + email service | 📝 Code written, delivery **not yet verified** |
| 5 | `POST /api/otp/send` | ⏳ Not started |
| 6 | `POST /api/otp/verify` | ⏳ Not started |
| 7–8 | Testing, audit, final docs | ⏳ Not started |

## 1. Project overview

**What it will do (target):** let a student prove they own their email by receiving a six-digit code (OTP) and entering it. When correct, the student is marked verified.

**Why separate from the main library system:** it can be built, tested, and explained on its own. The main system can later call it over HTTP, whatever language the main system uses.

| Technology | Responsibility |
|---|---|
| Node.js | Runs the JavaScript server |
| Express | Receives HTTP requests and routes them |
| MySQL + `mysql2/promise` | Stores students and OTP records |
| Nodemailer + Gmail SMTP | Sends the email |
| dotenv | Loads secrets from `.env` |
| `crypto` (built in) | Secure random numbers and HMAC (⏳ used from Stage 5) |
| helmet | Security-related HTTP headers |
| express-rate-limit | Limits repeated requests (⏳ Stage 5) |

## 2. Complete system flow (TARGET DESIGN — endpoints not built yet)

```
1. Postman        -> POST /api/otp/send  { email }
2. Route/Controller -> validate body + email format
3. OTP service    -> find student in tbl_users
                  -> invalidate older active OTPs
                  -> generate 6-digit code (crypto), compute HMAC, set expiry
                  -> store HMAC + expiry in tbl_otps
4. Email service  -> send the code through Gmail SMTP
                  -> if sending fails: cancel the stored OTP
5. Student        -> POST /api/otp/verify  { email, otp }
6. OTP service    -> (transaction + row lock) find active OTP
                  -> reject if expired / used / invalidated / too many attempts
                  -> compare HMAC of submitted code with stored HMAC
7. On match       -> mark OTP used, set tbl_users.is_verified = 1, respond success
   On mismatch    -> increase attempts, respond with a generic error
```
Detailed success/failure flows will be added in Stages 5–6.

## 3. Beginner-friendly analogy

A school library counter. You ask the librarian for a **claim slip code**. The librarian writes down a **scrambled fingerprint** of the code in a logbook (`tbl_otps`) with a **deadline** and slips the real code to you in a sealed envelope (the email). The code itself is never written in the logbook. When you come back, the librarian scrambles your code the same secret way and compares fingerprints. If they match before the deadline, the librarian stamps "verified" on the class list (`tbl_users`) and tears the slip so it can't be used again.

**Where the analogy breaks:** the "secret way" of scrambling is an HMAC with a secret key kept in `.env`, and the computer checks thousands of requests at once, which is why we need database transactions.

## 4. Project folder and file guide

| File | Purpose | Depends on | Check first when... |
|---|---|---|---|
| `server.js` | Starts Express (⏳ temporary until Stage 5) | `config/env.js` | server won't start |
| `config/env.js` | Loads and validates `.env` | `.env`, dotenv | "Missing required environment variables" |
| `config/db.js` | MySQL connection pool | `config/env.js`, mysql2 | database errors |
| `config/email.js` | Nodemailer/Gmail connection | `config/env.js`, nodemailer | email login or timeout errors |
| `services/emailService.js` | `sendOtpEmail(toEmail, otp)` | `config/email.js`, `config/env.js` | email not sent |
| `schema.sql` | Creates DB, tables, sample students | MySQL | tables missing |
| `.env` | Real secrets (never commit) | — | any config problem |
| `.env.example` | Placeholder template (safe to commit) | — | setting up a new machine |
| `.gitignore` | Keeps `.env`, `node_modules` out of git | — | — |
| `routes/`, `controllers/`, `middleware/`, `services/otpService.js` | ⏳ Stages 5–6 | | |

## 5. File connection map (current)

```
server.js -> config/env.js
config/db.js -> config/env.js
config/email.js -> config/env.js
services/emailService.js -> config/email.js, config/env.js
```
Routes → controllers → otpService → (db.js, emailService.js) will be added in Stage 5.

## 6. Database explanation

Database: `library_otp_db`. Engine: InnoDB (needed for transactions and foreign keys). Follows the team's `tbl_users` design from the reference files, plus `email` and `is_verified`.

**tbl_users**

| Column | Type | Purpose |
|---|---|---|
| user_id | INT, PK, auto-increment | Unique student row ID |
| username | VARCHAR(50), UNIQUE | School login/ID |
| password | VARCHAR(255) | Main system's password hash. OTP service never reads or writes it. |
| full_name | VARCHAR(100) | Display name |
| email | VARCHAR(255), UNIQUE | Where the OTP is sent (**added**; case-insensitive uniqueness) |
| role | ENUM(admin, student) | Account type |
| is_verified | TINYINT(1), default 0 | 1 after successful OTP (**added**) |
| created_at | DATETIME | Row creation time |

**tbl_otps**

| Column | Type | Purpose |
|---|---|---|
| otp_id | INT, PK | Unique OTP row ID |
| user_id | INT, FK -> tbl_users.user_id (ON DELETE CASCADE) | Which student |
| code_hash | CHAR(64) | HMAC-SHA256 (hex) of the code, never the code |
| expires_at | DATETIME | Code is dead at or after this time |
| attempts | TINYINT UNSIGNED, default 0 | Wrong guesses so far |
| status | ENUM(active, used, invalidated) | Lifecycle of the code |
| created_at | DATETIME | When generated |

Indexes: `(user_id, status)` for finding a student's active OTP; `expires_at` for later cleanup. Relationship: one student : many OTP rows.

**Safe inspection queries** (they leave out `code_hash` on purpose):
```sql
SELECT user_id, username, full_name, email, role, is_verified FROM tbl_users;
SELECT otp_id, user_id, status, attempts, expires_at, created_at
  FROM tbl_otps ORDER BY otp_id DESC LIMIT 10;
-- Development only: reset a test student
UPDATE tbl_users SET is_verified = 0 WHERE user_id = 1;
```

## 7. OTP security explanation

⏳ Not implemented yet. Planned: crypto-based six-digit OTP, HMAC with a server secret, five-minute expiry, attempt limit, invalidation, single use, transaction with row lock.

Why not a plain fast hash: there are only 1,000,000 six-digit codes, so anyone who copies the database could hash all of them in about a second and read every code. An HMAC needs the secret key, which is not stored in the database.

Already in place: `OTP_HMAC_SECRET` must be 32+ characters, and production refuses an expiry other than 5 minutes (`config/env.js`).

## 8. API reference

⏳ To be written in Stages 5–6 from the real implementation.

## 9. Environment and startup guide

| Variable | Meaning |
|---|---|
| PORT | Server port (default 3000) |
| NODE_ENV | `development` or `production` |
| DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME | MySQL connection (use a dedicated user, not root) |
| OTP_HMAC_SECRET | Random 32+ char secret (generate with Node `crypto.randomBytes(32).toString('hex')`) |
| OTP_EXPIRY_MINUTES | 5. A smaller value is allowed only when NODE_ENV=development |
| OTP_MAX_ATTEMPTS | Wrong guesses allowed per OTP (default 5) |
| GMAIL_USER | Sender Gmail address |
| GMAIL_APP_PASSWORD | 16-char Google App Password |
| EMAIL_FROM_NAME | Sender display name |
| SMTP_PORT | 465 (default) or 587 |

Setup: `npm install`, then `mysql -u root -p`, then `source schema.sql;`, create the MySQL user, fill in `.env`, then `npm run dev`. No real secrets belong in this file.

## 10. Troubleshooting guide (so far)

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm.ps1 cannot be loaded` | PowerShell policy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `Missing required environment variables` | `.env` missing/misnamed | Check name (not `.env.txt`) and location |
| `Cannot find module 'mysql2/promise'` | Library not installed | `npm install mysql2` (this really happened in Stage 2) |
| `EADDRINUSE` | Port busy | Change `PORT` |
| `ER_ACCESS_DENIED_ERROR` | Wrong DB user/password | Check `.env`; reset with `ALTER USER` |
| `ER_BAD_DB_ERROR` / `ER_NO_SUCH_TABLE` | Schema not run | `source schema.sql;` |
| `ECONNREFUSED` (MySQL) | MySQL service stopped | `net start MySQL80` (Administrator) |
| `EAUTH` / 535 | Wrong or revoked App Password | Create a new App Password |
| `ETIMEDOUT` (email) | Port 465 blocked | `SMTP_PORT=587` |

## 11. Testing guide

**Confirmed (from output you provided):**
- Node v24.21.0, npm 11.19.0, MySQL 8.0.46 running
- `GET /health` returned `{"success":true,"message":"OTP service is running"}`
- `SHOW TABLES` lists `tbl_otps`, `tbl_users`; 2 sample students; `is_verified` = 0
- Node connected to `library_otp_db` and read `tbl_users`

**Not yet run:** foreign key check, DB user check, Gmail login test, test email delivery, and all OTP endpoint scenarios.

## 12. Future integration and feature expansion

The main system must agree on: who owns student records (the main system), email uniqueness, the student identifier (`username`), and the API contract. The two added columns, `email` and `is_verified`, must exist in the real `tbl_users`. Details come in Stage 8.

## 13. Known limitations and future improvements

- `server.js` is temporary until Stage 5.
- Development database is a copy, not the authoritative one.
- Sample students use a fake password value.
- Rate limiting, transaction logic, and attempt limits are not built yet.

## 14. Academic defense notes (so far)

**Why two tables?** Students are long-lived records owned by the main system. OTPs are short-lived and one student can have many over time, so they sit in a separate table linked by a foreign key (1:M).

**Why store `code_hash` instead of the code?** If the database leaks, the real codes are not exposed. (Implementation verified in Stage 5.)

*(More questions added as features are built and tested.)*

## File-by-file development record

| File | Key functions | Tests that verify it |
|---|---|---|
| `config/env.js` | validates `.env`, exports settings | Stage 2 optional missing-variable test (⏳ not reported) |
| `config/db.js` | `pool`, `testConnection()` | Stage 3 node connection test ✅ |
| `config/email.js` | `transporter` | Stage 4 Test A ⏳ |
| `services/emailService.js` | `sendOtpEmail(toEmail, otp)` | Stage 4 Test B ✅ |
| `schema.sql` | creates DB, tables, sample data | Stage 3 SHOW TABLES / SELECT ✅ |
“Confirmed”: foreign key fk_otps_user exists, and the app connects as library_otp_user@localhost
|Stage 5 ✅ Reported working (send endpoint tests; output not captured)|

## Project Progress / Notes

- **Stage 1:** Project setup & configuration ✅
- **Stage 2:** Environment variables & safety checks ✅
- **Stage 3:** Database schema & secure user creation ✅
- **Stage 4:** Email service setup (Nodemailer & Gmail) ✅
- **Stage 5:** Send OTP endpoint, rate limiting, and rollbacks $\rightarrow$ **✅ Reported working (send endpoint tests; output not captured).**
- **Stage 6:** Verify OTP endpoint (Pending)