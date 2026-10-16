// scripts/test-concurrency.js
// Development-only test. It proves that only ONE of several simultaneous
// verify requests with the correct code can succeed.
// Run it while the server is running (npm run dev in another terminal).

const crypto = require('crypto');
const { pool } = require('../config/db');
const config = require('../config/env');

const BASE_URL = 'http://localhost:3000';
const EMAIL = 'joshuamorillo0444@gmail.com'; // your test student (student001)
const KNOWN_CODE = '123456';                 // a code we choose, so we don't need the inbox
const PARALLEL_REQUESTS = 10;

// Must match services/otpService.js hashOtp() EXACTLY, or verification will fail.
function hashOtp(userId, otp) {
  return crypto
    .createHmac('sha256', config.otp.hmacSecret)
    .update(`${userId}:${otp}`)
    .digest('hex');
}

async function main() {
  // 1. Find the test student.
  const [rows] = await pool.query('SELECT user_id FROM tbl_users WHERE email = ?', [EMAIL]);
  if (rows.length === 0) throw new Error(`No student with email ${EMAIL}`);
  const userId = rows[0].user_id;

  // 2. Reset: unverified, and no older active OTP.
  await pool.query('UPDATE tbl_users SET is_verified = 0 WHERE user_id = ?', [userId]);
  await pool.query(
    "UPDATE tbl_otps SET status = 'invalidated' WHERE user_id = ? AND status = 'active'",
    [userId]
  );

  // 3. Insert one active OTP with a known code, valid for 5 minutes.
  await pool.query(
    'INSERT INTO tbl_otps (user_id, code_hash, expires_at) ' +
      'VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))',
    [userId, hashOtp(userId, KNOWN_CODE)]
  );

  // 4. Fire all requests at once.
  const requests = Array.from({ length: PARALLEL_REQUESTS }, () =>
    fetch(`${BASE_URL}/api/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, otp: KNOWN_CODE }),
    }).then((res) => res.status)
  );
  const statuses = await Promise.all(requests);

  // 5. Count the results.
  const ok = statuses.filter((s) => s === 200).length;
  const rejected = statuses.filter((s) => s === 400).length;
  const other = statuses.length - ok - rejected;

  console.log('Status codes received:', statuses.join(', '));
  console.log(`200 (success): ${ok}   400 (rejected): ${rejected}   other: ${other}`);

  // 6. Check the database.
  const [[user]] = await pool.query('SELECT is_verified FROM tbl_users WHERE user_id = ?', [userId]);
  const [otpRows] = await pool.query(
    'SELECT status, attempts FROM tbl_otps WHERE user_id = ? ORDER BY otp_id DESC LIMIT 1',
    [userId]
  );
  console.log('is_verified:', user.is_verified, '| latest OTP status:', otpRows[0].status);

  // 7. Verdict.
  if (ok === 1 && rejected === PARALLEL_REQUESTS - 1 && other === 0 && user.is_verified === 1) {
    console.log('PASS: exactly one request succeeded.');
  } else {
    console.log('FAIL: expected exactly 1 success and the rest rejected.');
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Test script error:', err.code || '', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());