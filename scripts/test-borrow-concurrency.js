// scripts/test-borrow-concurrency.js
// Dev-only test. Sends two borrow requests at the same moment for the last copy
// of one book. Exactly one should succeed. Needs the server running.
// Usage: node scripts/test-borrow-concurrency.js <book_id>

require('dotenv').config({ quiet: true });

const BASE = `http://localhost:${process.env.PORT || 3000}/api/borrows`;
const KEY = process.env.ADMIN_API_KEY;
const bookId = Number(process.argv[2]);

if (!bookId) {
  console.error('Usage: node scripts/test-borrow-concurrency.js <book_id>');
  process.exit(1);
}

async function borrow(userId) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': KEY },
    body: JSON.stringify({ user_id: userId, book_id: bookId }),
  });
  const body = await res.json();
  return { user_id: userId, http_status: res.status, code: body.code || 'OK' };
}

(async () => {
  // Both requests start at the same time.
  const results = await Promise.all([borrow(1), borrow(2)]);
  console.table(results);

  const succeeded = results.filter((r) => r.http_status === 201).length;
  const rejected = results.filter(
    (r) => r.http_status === 409 && r.code === 'NO_COPIES_AVAILABLE'
  ).length;

  if (succeeded === 1 && rejected === 1) {
    console.log('PASS: exactly one student got the last copy');
  } else {
    console.log('FAIL: expected one 201 and one 409 NO_COPIES_AVAILABLE');
  }
})().catch((err) => console.error('Script error:', err.message));