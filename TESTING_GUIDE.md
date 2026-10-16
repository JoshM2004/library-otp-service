# Testing Guide

**Status key**
- **Verified**: output was captured and shown.
- **Reported working**: the developer confirmed it works, but no output was captured.
- **Not run**: written, not tested.

Re-run any test with Postman or Thunder Client when you need proof for a demo.

## Setup for tests

- Server running: `npm run dev`
- Test student: `student001`, email `joshuamorillo0444@gmail.com` (your own address)
- Reset between verify tests:
```sql
  UPDATE tbl_users SET is_verified = 0 WHERE user_id = 1;
```
- Check results:
```sql
  SELECT otp_id, user_id, status, attempts, expires_at FROM tbl_otps ORDER BY otp_id DESC LIMIT 5;
  SELECT user_id, username, is_verified FROM tbl_users;
```
- The send limiter allows 5 requests per email in 15 minutes. Restart the server (save a file) between groups of send tests.

## Stage 3 and 4 checks (verified)

| ID | Check | Status |
|---|---|---|
| DB-1 | `SHOW TABLES` lists `tbl_otps`, `tbl_users` | Verified |
| DB-2 | Foreign key `fk_otps_user` exists | Verified |
| DB-3 | App connects as `library_otp_user@localhost` | Verified |
| DB-4 | Node connection test prints `MySQL connection OK` | Verified |
| MAIL-1 | Gmail SMTP login (Test A) | Verified (developer report) |
| MAIL-2 | Test email arrives in Inbox (Test B) | Verified (developer report) |

## Send endpoint: POST /api/otp/send

| ID | Scenario | Body | Expected | Status |
|---|---|---|---|---|
| S1 | Success | `{"email":"student001 email"}` | 200 + email arrives | **Verified** (#3 output; email delivery verified) |
| S2 | Bad format | `{"email":"not-an-email"}` | 400 `INVALID_EMAIL` | Reported working |
| S3 | Missing field | `{}` | 400 `INVALID_REQUEST` | Reported working |
| S4 | Unknown student | `{"email":"nobody@example.com"}` | 200, same body as S1 (unchanged) | **Verified** (#4 output / L1 leak protection) |
| S5 | Broken JSON | `{"email": ` | 400 `INVALID_JSON` | Reported working |
| S6 | Unknown URL | GET `/api/nothing` | 404 `NOT_FOUND` | Reported working |
| S7 | New code invalidates old | Send twice, check table | Only newest `active` | Reported working |
| S8 | Email rate limit | Send 6 times in a row | 6th: 429 `RATE_LIMITED` | Reported working |
| S9 | Email failure (after L1 fix) | Wrong App Password, send to known email | 200 (same body); background log; row `invalidated`. | **Verified** (Gap D background rollback) |

## Verify endpoint: POST /api/otp/verify

| ID | Scenario | Steps | Expected | Status |
|---|---|---|---|---|
| V1 | Success | Send, then verify with emailed code | 200; OTP `used`; `is_verified = 1` | **Verified** (#5 output; OTP consumed & `used`) |
| V2 | Reuse | Repeat V1 | 400 `INVALID_OR_EXPIRED_OTP` | Reported working |
| V3 | Wrong code | Verify `000000` | 400; `attempts = 1` | **Verified** (Gap B attempt counter) |
| V4 | Attempt limit | After V3, 4 more wrong guesses | Guess 5: 429 `TOO_MANY_ATTEMPTS`; `invalidated` | Reported working |
| V5 | Locked out | Real code after V4 | 400; `is_verified` stays 0 | Reported working |
| V6 | Replaced code | Send twice, verify with first code, then second | First: 400; second: 200 | Reported working |
| V7 | Unknown email | `{"email":"nobody@example.com","otp":"123456"}` | 400 `INVALID_OR_EXPIRED_OTP` | Reported working |
| V8 | Bad formats | `"12345"`, `"abcdef"`, `123456` as number, bad email | 400 `INVALID_OTP_FORMAT`, `INVALID_OTP_FORMAT`, `INVALID_REQUEST`, `INVALID_EMAIL` | Reported working |
| V9 | Expired code | `OTP_EXPIRY_MINUTES=0.1`, wait 10 s, verify | 400; row `invalidated`. Restore to 5 afterwards | Reported working |
| V10 | Verify rate limit | 21 verify requests, same email | 21st: 429 `RATE_LIMITED` (attempt limit usually hits first) | Reported working |

## Concurrency and failure tests

| ID | Scenario | Command or steps | Expected | Status |
|---|---|---|---|---|
| C1 | Concurrent correct codes | `node scripts/test-concurrency.js` | 1 × 200, 9 × 400; `is_verified = 1`; prints PASS | **Verified** (#7 concurrency output) |
| D1 | MySQL down | `net stop MySQL80` (Admin), send verify, then `net start MySQL80` | 500 `INTERNAL_ERROR`; `/health` still 200; server keeps running; verify works after restart | **Verified** (#8 outage & recovery) |
| X1 | Expiry setting restored | After V9, set `OTP_EXPIRY_MINUTES=5`, restart, send, check `lifetime_seconds` | 300 | Reported working. Confirm the value in `.env`. |

## Final audit checklist (prompt section 13 D)

| # | Check | Status |
|---|---|---|
| 1 | Required files and dependencies present | Verified (`npm list --depth=0`, file list) |
| 2 | Secrets excluded from version control | Verified by `.gitignore` content. Secrets were rotated after being shared in an upload. |
| 3 | Schema and queries agree | Verified in code review (column names match `schema.sql`). Reported working in tests. |
| 4 | Express starts without errors | Verified (startup output) |
| 5 | Gmail SMTP delivers an OTP | Verified (Test B in Inbox) |
| 6 | Both endpoints work with the documented formats | Reported working |
| 7 | Expiry, invalidation, single use, attempt limit | Reported working (V1 to V5, V9) |
| 8 | Transactions and concurrency | Reported working (C1). Not tested under real parallel load. |
| 9 | Error handling and rate limiting | Reported working (S5, S6, S8, V10, D1) |
| 10 | Documented tests match the implementation | Done in this document. Re-check after any code change. |
| 11 | Can be explained at defense | Covered in MASTER_NOTES section 14 |

## Known gaps in testing

- No captured output for Stages 5–7. Paste output to change any row to "Verified".
- Concurrency test inserts the code directly into the database, so it tests verification, not the send endpoint.
- Email-existence leak (MASTER_NOTES L1) is documented but not tested.
- No automated test suite.

Stage 10: book search

ID	Scenario	Expected	Status
BS-1	q=algorithms	200, 1 result, Available	Reported working
BS-2	q=history	200, 1 result, Borrowed	Reported working
BS-3	q=% (literal percent)	200, 0 results	Reported working
BS-4	q=a	400 INVALID_SEARCH	Reported working
BS-5	No q	400 INVALID_REQUEST	Reported working
BS-6	Set copies to 0 by SQL, then search	Shows Borrowed	Reported working

Stage 11: admin book management

ID	Scenario	Expected	Status
AB-1	POST without key	401 UNAUTHORIZED	Reported working
AB-2	POST with key	201, status available	Reported working
AB-3	Duplicate accession	409 DUPLICATE_ACCESSION	Reported working
AB-4	PUT copies to 0	200, status borrowed	Reported working
AB-5	PUT empty body	400 INVALID_BOOK	Reported working
AB-6	PUT with ID abc	400 INVALID_BOOK_ID	Reported working
AB-7	PUT unknown ID	404 BOOK_NOT_FOUND	Reported working
AB-8	DELETE a book with history	409 BOOK_HAS_HISTORY	Reported working

Stage 12: borrow and return

ID	Scenario	Expected	Status
BR-1	Borrow a book with copies	201, copies down by one	Reported working
BR-2	Same student, same book again	409 ALREADY_BORROWED	Reported working
BR-3	No copies left	409 NO_COPIES_AVAILABLE	Reported working
BR-4	Return a loan	200, copies up by one	Reported working
BR-5	Return again	409 ALREADY_RETURNED	Reported working
BR-6	Unknown student or book	404	Reported working
BR-7	Concurrency script (last copy)	One 201, one 409, PASS	Reported working

Stage 13: loans and overdue

ID	Scenario	Expected	Status
LO-1	List active loans, late loan	Shows days_overdue	Reported working
LO-2	status=overdue before refresh	Late loan appears, DB still borrowed	Reported working
LO-3	Refresh overdue	marked at least 1, DB now overdue	Reported working
LO-4	Refresh again	marked: 0	Reported working
LO-5	status=lost	400 INVALID_STATUS_FILTER	Reported working

#	Check	Status	Evidence
1	Required files and dependencies present	Verified	File list, npm list (Stage 2 and 3)

2	Secrets excluded from version control	Verified	.gitignore content. Earlier secrets rotated.

3	Schema and queries agree	Verified for OTP and book tables by SQL. Reported working for loans.	Stage 3, 9 SQL checks

4	Express starts without errors	Verified	Startup output (Stage 2, Stage 5)

5	Gmail delivers an OTP	Verified	Stage 4 Test B, Stage 5 inbox

6	Endpoints match the documented formats	Verified for OTP. Reported working for book and loan endpoints.	Captured outputs in Stage 5 and 6

7	Expiry, invalidation, single use, attempt limit	Verified for single use, attempt count, invalidation. Expiry by time reported only.	Gap A, B, send-twice rows

8	Transactions and concurrency	Verified for OTP (C1). Reported working for borrow (BR-7).	Stage 7 output

9	Error handling and rate limiting	Verified for errors (MySQL outage, email failure). Rate limits reported only.	Gap C and D

10	Documented tests match the implementation	Done in this stage	API_DOCUMENTATION.md, TESTING_GUIDE.md additions

11	Ready to explain at defense	Covered in MASTER_NOTES section 14	Defense questions above