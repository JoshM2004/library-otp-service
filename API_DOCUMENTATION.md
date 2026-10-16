# Library OTP and Book Service: API Documentation

**Base URL (development):** `http://localhost:3000`
**Format:** JSON. Send `Content-Type: application/json` on every request with a body.

## Authentication

| Area | How it is protected |
|---|---|
| OTP endpoints | Rate limits only |
| Book search | Public for now (see limitations) |
| Admin endpoints | Header `x-admin-key: <ADMIN_API_KEY>`. Missing or wrong key returns 401. |

## Response shapes

Success: `{ "success": true, ... }`

Error: `{ "success": false, "code": "ERROR_CODE", "message": "Readable text" }`

Clients should check `success` and branch on `code`. Do not parse `message`.

---

## Health

### GET /health
Checks that the server is running. Does not check the database.
- **200:** `{ "success": true, "message": "OTP service is running" }`

---

## OTP endpoints

### POST /api/otp/send
Creates a 6-digit code for the student with this email and emails it. Older active codes for that student are invalidated. The code expires after 5 minutes.

Body: `{ "email": "student@example.com" }`

| Status | Code | When |
|---|---|---|
| 200 | none | Valid request. Same response whether or not the email is registered. |
| 400 | `INVALID_REQUEST` | Body missing, or `email` not a string |
| 400 | `INVALID_EMAIL` | Bad email format |
| 400 | `INVALID_JSON` | Malformed JSON |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 10 kB |
| 429 | `RATE_LIMITED` | More than 20 requests per IP, or 5 per email, in 15 minutes |
| 502 | `EMAIL_DELIVERY_FAILED` | Email could not be sent. The new code was invalidated. |
| 500 | `INTERNAL_ERROR` | Server or database error |

### POST /api/otp/verify
Checks the code. On success the code is consumed and the student's `is_verified` becomes 1.

Body: `{ "email": "student@example.com", "otp": "004821" }`. `otp` must be a **JSON string** of exactly 6 digits.

| Status | Code | When |
|---|---|---|
| 200 | none | Correct, current code. Body: `"Email verified successfully."` |
| 400 | `INVALID_REQUEST` | Missing or wrong-type fields |
| 400 | `INVALID_EMAIL` | Bad email format |
| 400 | `INVALID_OTP_FORMAT` | `otp` not exactly 6 digits. Not counted as an attempt. |
| 400 | `INVALID_OR_EXPIRED_OTP` | Wrong, expired, used, replaced, or unknown email. Deliberately vague. |
| 429 | `TOO_MANY_ATTEMPTS` | This wrong guess was the last allowed. The code is now dead. |
| 429 | `RATE_LIMITED` | 30 per IP or 20 per email in 15 minutes |
| 500 | `INTERNAL_ERROR` | Server or database error |

---

## Book search (student)

### GET /api/books/search?q=keyword
Searches title, author, and category. Case-insensitive. Returns up to 50 books sorted by title.

Query: `q`, 2 to 100 characters after trimming.

**200 example:**
```json
{
  "success": true,
  "count": 1,
  "results": [
    {
      "book_id": 1,
      "book_title": "Introduction to Algorithms",
      "author": "Test Author A",
      "category": "Computer Science",
      "availability": "Available"
    }
  ]
}
```

`availability` is `Available` when copies are above 0, otherwise `Borrowed`.

| Status | Code | When |
|---|---|---|
| 200 | none | Results, possibly zero |
| 400 | `INVALID_REQUEST` | `q` missing |
| 400 | `INVALID_SEARCH` | Shorter than 2 or longer than 100 characters |
| 500 | `INTERNAL_ERROR` | Server or database error |

---

## Book management (admin)

All routes below need `x-admin-key`.

### POST /api/books
Adds a book.

Body:
```json
{
  "accession_no": "ACC-0005",
  "book_title": "Test Book",
  "author": "Test Author E",
  "category": "Testing",
  "available_copies": 2
}
```

Field limits: `accession_no` 30, `book_title` 150, `author` 100, `category` 60 characters. `available_copies` is a whole number from 0 to 10000. All fields are required.

| Status | Code | When |
|---|---|---|
| 201 | none | Book created. Response includes `book` with `status` set from copies. |
| 400 | `INVALID_BOOK` | A field is missing or invalid |
| 401 | `UNAUTHORIZED` | Key missing or wrong |
| 409 | `DUPLICATE_ACCESSION` | Accession number already exists |

### PUT /api/books/:id
Updates only the fields sent. At least one field is required. Changing `available_copies` also updates `status`.

Body example: `{ "available_copies": 0 }`

| Status | Code | When |
|---|---|---|
| 200 | none | Updated. Response includes the full `book`. |
| 400 | `INVALID_BOOK_ID` | ID is not a positive whole number |
| 400 | `INVALID_BOOK` | Empty body, or a field invalid |
| 401 | `UNAUTHORIZED` | Key missing or wrong |
| 404 | `BOOK_NOT_FOUND` | No book with this ID |
| 409 | `DUPLICATE_ACCESSION` | New accession number already exists |

### DELETE /api/books/:id
Deletes a book.

| Status | Code | When |
|---|---|---|
| 200 | none | Deleted |
| 400 | `INVALID_BOOK_ID` | Bad ID |
| 401 | `UNAUTHORIZED` | Key missing or wrong |
| 404 | `BOOK_NOT_FOUND` | No book with this ID |
| 409 | `BOOK_HAS_HISTORY` | Borrow records exist. Mark the book withdrawn instead. |

---

## Borrowing (admin)

All routes below need `x-admin-key`. Loans last 14 days. Due dates are set by the database clock.

### POST /api/borrows
Records a borrow. Lowers `available_copies` by one, in one transaction.

Body: `{ "user_id": 1, "book_id": 2 }`, both positive whole numbers.

**201 example:**
```json
{
  "success": true,
  "message": "Book borrowed.",
  "borrow": {
    "borrow_id": 7,
    "user_id": 1,
    "book_id": 2,
    "borrowed_date": "2026-10-16",
    "due_date": "2026-10-30",
    "return_date": null,
    "status": "borrowed"
  }
}
```

| Status | Code | When |
|---|---|---|
| 201 | none | Loan recorded |
| 400 | `INVALID_BORROW` | IDs missing, or not positive whole numbers |
| 401 | `UNAUTHORIZED` | Key missing or wrong |
| 404 | `USER_NOT_FOUND` | No student with this `user_id` |
| 404 | `BOOK_NOT_FOUND` | No book with this `book_id` |
| 409 | `ALREADY_BORROWED` | This student already has this book out |
| 409 | `NO_COPIES_AVAILABLE` | No copies left |

### PUT /api/borrows/:id/return
Records a return. Raises `available_copies` by one and sets `return_date`.

| Status | Code | When |
|---|---|---|
| 200 | none | Returned. Response includes the updated `borrow`. |
| 400 | `INVALID_BORROW_ID` | Bad ID |
| 401 | `UNAUTHORIZED` | Key missing or wrong |
| 404 | `BORROW_NOT_FOUND` | No loan with this ID |
| 409 | `ALREADY_RETURNED` | Already returned |

### GET /api/borrows?status=active
Lists loans with the student's name and the book title. Read-only.

| `status` value | Meaning |
|---|---|
| `active` (default) | Borrowed or overdue |
| `overdue` | Past due date, marked or not yet marked |
| `returned` | Already returned |

Each loan includes `days_overdue` (0 when on time or returned). Returns up to 100 loans, earliest due date first.

| Status | Code | When |
|---|---|---|
| 200 | none | List returned, possibly empty |
| 400 | `INVALID_STATUS_FILTER` | `status` is not one of the three values above |
| 401 | `UNAUTHORIZED` | Key missing or wrong |

### POST /api/borrows/overdue/refresh
Marks every loan still `borrowed` past its due date as `overdue`. The server also runs this every hour and at startup.

- **200:** `{ "success": true, "message": "Overdue check complete.", "marked": 1 }`
- **401:** `UNAUTHORIZED`

---

## Errors for unknown URLs

Any unknown route returns **404** with `{"success":false,"code":"NOT_FOUND","message":"Route not found."}`.

## Error code reference

| Code | Meaning |
|---|---|
| `INVALID_REQUEST` | Body or query shape is wrong |
| `INVALID_JSON` | Body is not valid JSON |
| `PAYLOAD_TOO_LARGE` | Body over 10 kB |
| `INVALID_EMAIL` | Email format wrong |
| `INVALID_OTP_FORMAT` | OTP not 6 digits |
| `INVALID_OR_EXPIRED_OTP` | OTP cannot be used |
| `TOO_MANY_ATTEMPTS` | OTP locked after too many wrong guesses |
| `RATE_LIMITED` | Too many requests |
| `EMAIL_DELIVERY_FAILED` | Gmail rejected the send |
| `INVALID_SEARCH` | Search term length wrong |
| `INVALID_BOOK`, `INVALID_BOOK_ID` | Admin book input wrong |
| `DUPLICATE_ACCESSION` | Accession number taken |
| `BOOK_NOT_FOUND`, `BOOK_HAS_HISTORY` | Book lookup or delete rule |
| `INVALID_BORROW`, `INVALID_BORROW_ID` | Borrow input wrong |
| `USER_NOT_FOUND` | Student ID unknown |
| `ALREADY_BORROWED`, `NO_COPIES_AVAILABLE`, `ALREADY_RETURNED` | Loan rules |
| `BORROW_NOT_FOUND` | Loan ID unknown |
| `INVALID_STATUS_FILTER` | Unknown loan filter |
| `UNAUTHORIZED` | Admin key missing or wrong |
| `NOT_FOUND` | Unknown route |
| `INTERNAL_ERROR` | Server or database error. Details appear only in the server terminal. |