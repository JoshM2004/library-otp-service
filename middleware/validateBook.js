// middleware/validateBook.js
// Checks admin book input BEFORE the controller runs.
// On success it replaces req.body with a cleaned copy, and stores the book ID
// in res.locals.bookId. On failure it sends a 400 and stops the request.

// Maximum lengths match the column sizes in migrations/002_books_and_borrow_records.sql.
const TEXT_LIMITS = {
  accession_no: 30,
  book_title: 150,
  author: 100,
  category: 60,
};

const MAX_COPIES = 10000;

// Returns the trimmed text, or null if it is missing, empty, or too long.
function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length === 0 || text.length > max) return null;
  return text;
}

// Returns the number if it is a whole number from 0 to MAX_COPIES, otherwise null.
function cleanCopies(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_COPIES) return null;
  return value;
}

function badBook(res, message) {
  return res.status(400).json({ success: false, code: 'INVALID_BOOK', message });
}

// POST /api/books: every field is required.
function validateCreateBook(req, res, next) {
  const body = req.body || {};
  const cleaned = {};

  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    const text = cleanText(body[field], max);
    if (text === null) {
      return badBook(res, `"${field}" is required and must be 1 to ${max} characters.`);
    }
    cleaned[field] = text;
  }

  const copies = cleanCopies(body.available_copies);
  if (copies === null) {
    return badBook(res, `"available_copies" must be a whole number from 0 to ${MAX_COPIES}.`);
  }
  cleaned.available_copies = copies;

  req.body = cleaned;
  next();
}

// PUT /api/books/:id: send only the fields to change, but at least one.
function validateUpdateBook(req, res, next) {
  const body = req.body || {};
  const cleaned = {};

  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    if (body[field] === undefined) continue;
    const text = cleanText(body[field], max);
    if (text === null) {
      return badBook(res, `"${field}" must be 1 to ${max} characters.`);
    }
    cleaned[field] = text;
  }

  if (body.available_copies !== undefined) {
    const copies = cleanCopies(body.available_copies);
    if (copies === null) {
      return badBook(res, `"available_copies" must be a whole number from 0 to ${MAX_COPIES}.`);
    }
    cleaned.available_copies = copies;
  }

  if (Object.keys(cleaned).length === 0) {
    return badBook(res, 'Send at least one field to update.');
  }

  req.body = cleaned;
  next();
}

// The :id in the URL must be a positive whole number, such as 12.
function validateBookId(req, res, next) {
  const id = req.params.id;

  if (!/^[1-9]\d*$/.test(id)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_BOOK_ID',
      message: 'The book ID must be a positive whole number.',
    });
  }

  res.locals.bookId = Number(id);
  next();
}

module.exports = { validateCreateBook, validateUpdateBook, validateBookId };