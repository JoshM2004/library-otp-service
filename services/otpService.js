// services/otpService.js
// OTP business logic. It knows about the database and the email service,
// but NOTHING about HTTP (no req/res). That keeps it reusable and testable.
//   requestOtp() : creates an OTP and schedules the email (background)
//   verifyOtp()  : checks a submitted OTP

const crypto = require('crypto');
const { pool } = require('../config/db');
const config = require('../config/env');
const { sendOtpEmail } = require('./emailService');

/**
 * Generates a cryptographically secure 6-digit code, e.g. "004821".
 * crypto.randomInt is unbiased and uses the operating system's secure random source.
 * padStart keeps leading zeros (so "4821" becomes "004821").
 */
function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/**
 * HMAC-SHA256 of "userId:otp", keyed with the server secret from .env.
 * Without that secret, someone who copies the database cannot test all
 * 1,000,000 possible codes against the stored hashes.
 * requestOtp and verifyOtp MUST compute it exactly the same way.
 */
function hashOtp(userId, otp) {
  return crypto
    .createHmac('sha256', config.otp.hmacSecret)
    .update(`${userId}:${otp}`)
    .digest('hex'); // 64 hex characters, fits CHAR(64)
}

/**
 * Compares two hex hashes in constant time, so the comparison time
 * does not reveal how many leading characters were correct.
 */
function hashesMatch(hexA, hexB) {
  const a = Buffer.from(hexA, 'hex');
  const b = Buffer.from(hexB, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Sends the email WITHOUT making the HTTP request wait for Gmail.
 * If sending fails, the new code is invalidated (the student never got it),
 * and the failure is logged on the server only. The client is never told,
 * so the response cannot reveal whether an email is registered.
 * Every error is caught here, so nothing can crash the server.
 */
function deliverInBackground(email, otp, otpId) {
  sendOtpEmail(email, otp).catch(async (err) => {
    console.error('Background OTP email failed for otp_id', otpId, '-', err.code || 'UNKNOWN');
    try {
      await pool.query("UPDATE tbl_otps SET status = 'invalidated' WHERE otp_id = ?", [otpId]);
    } catch (dbErr) {
      console.error('Could not invalidate OTP after email failure:', dbErr.code || 'UNKNOWN');
    }
  });
}

/**
 * Creates a new OTP for the student with this email, stores its HMAC,
 * and schedules the email. Returns nothing. The controller gives the same
 * response whether or not the student exists (anti-enumeration).
 * Throws only for database errors.
 */
async function requestOtp(email) {
  const otp = generateOtp();
  // Dev testing may use decimal minutes, so round to whole seconds.
  const expirySeconds = Math.max(1, Math.round(config.otp.expiryMinutes * 60));

  const conn = await pool.getConnection();
  let otpId;

  try {
    await conn.beginTransaction();

    // Lock this student's row until we commit. A second simultaneous request
    // for the same student waits here, so two active OTPs can never coexist.
    const [users] = await conn.query(
      'SELECT user_id FROM tbl_users WHERE email = ? FOR UPDATE',
      [email]
    );

    if (users.length === 0) {
      await conn.rollback();
      return; // unknown student: nothing stored, nothing sent
    }
    const userId = users[0].user_id;

    // Only one active OTP per student: cancel any older ones.
    await conn.query(
      "UPDATE tbl_otps SET status = 'invalidated' WHERE user_id = ? AND status = 'active'",
      [userId]
    );

    // Store only the HMAC, never the code. MySQL computes the expiry time
    // so creation, expiry and the verify-time expiry check all use the same clock.
    const [result] = await conn.query(
      'INSERT INTO tbl_otps (user_id, code_hash, expires_at) ' +
        'VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
      [userId, hashOtp(userId, otp), expirySeconds]
    );
    otpId = result.insertId;

    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* connection may already be gone */ }
    throw err;
  } finally {
    conn.release(); // always return the connection to the pool
  }

  // The code is committed. Send the email in the background.
  deliverInBackground(email, otp, otpId);
}

/**
 * Checks a submitted OTP. Returns one of three strings:
 *   'VERIFIED' : code correct; OTP consumed and is_verified set to 1
 *   'LOCKED'   : too many wrong guesses; the OTP is now invalidated
 *   'INVALID'  : unknown email, no active OTP, expired, or wrong code
 * Everything happens in ONE transaction with row locks.
 */
async function verifyOtp(email, otp) {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Lock 1: the student row. Concurrent verify requests for this student
    // wait here, one at a time. (Same lock order as requestOtp: no deadlocks.)
    const [users] = await conn.query(
      'SELECT user_id FROM tbl_users WHERE email = ? FOR UPDATE',
      [email]
    );
    if (users.length === 0) {
      await conn.rollback();
      return 'INVALID';
    }
    const userId = users[0].user_id;

    // Lock 2: the student's current active OTP. Expiry is judged by MySQL's NOW(),
    // the same clock that set expires_at.
    const [otps] = await conn.query(
      "SELECT otp_id, code_hash, attempts, (expires_at <= NOW()) AS is_expired " +
        "FROM tbl_otps WHERE user_id = ? AND status = 'active' " +
        'ORDER BY otp_id DESC LIMIT 1 FOR UPDATE',
      [userId]
    );
    if (otps.length === 0) {
      // Never requested, already used, or replaced by a newer OTP.
      await conn.rollback();
      return 'INVALID';
    }
    const record = otps[0];

    // Expired: retire it so it can never be used.
    if (record.is_expired) {
      await conn.query("UPDATE tbl_otps SET status = 'invalidated' WHERE otp_id = ?", [record.otp_id]);
      await conn.commit();
      return 'INVALID';
    }

    // Safety net: attempts already used up (normally the OTP is invalidated before this).
    if (record.attempts >= config.otp.maxAttempts) {
      await conn.query("UPDATE tbl_otps SET status = 'invalidated' WHERE otp_id = ?", [record.otp_id]);
      await conn.commit();
      return 'LOCKED';
    }

    // Compare HMAC of the submitted code with the stored HMAC.
    if (!hashesMatch(hashOtp(userId, otp), record.code_hash)) {
      const newAttempts = record.attempts + 1;
      if (newAttempts >= config.otp.maxAttempts) {
        // Last allowed guess was wrong: kill this OTP. The student must request a new one.
        await conn.query(
          "UPDATE tbl_otps SET attempts = ?, status = 'invalidated' WHERE otp_id = ?",
          [newAttempts, record.otp_id]
        );
        await conn.commit(); // commit on purpose: a rollback would erase the counted attempt
        return 'LOCKED';
      }
      await conn.query('UPDATE tbl_otps SET attempts = ? WHERE otp_id = ?', [newAttempts, record.otp_id]);
      await conn.commit(); // commit on purpose, same reason
      return 'INVALID';
    }

    // Correct code. Consume it. "AND status = 'active'" plus affectedRows is a second guard:
    // only one request can ever flip an OTP from active to used.
    const [consumed] = await conn.query(
      "UPDATE tbl_otps SET status = 'used' WHERE otp_id = ? AND status = 'active'",
      [record.otp_id]
    );
    if (consumed.affectedRows !== 1) {
      await conn.rollback();
      return 'INVALID';
    }

    // Mark the student verified in the same transaction: both changes happen or neither does.
    await conn.query('UPDATE tbl_users SET is_verified = 1 WHERE user_id = ?', [userId]);
    await conn.commit();
    return 'VERIFIED';
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* connection may already be gone */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { requestOtp, verifyOtp };