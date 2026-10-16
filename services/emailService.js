// services/emailService.js
// Responsible ONLY for sending emails. It knows nothing about the database or OTP rules.
// Called later by services/otpService.js.

const { transporter } = require('../config/email');
const config = require('../config/env');

/**
 * Sends the OTP to a student's email.
 * Throws an error with code 'EMAIL_DELIVERY_FAILED' if sending fails,
 * so the caller can cancel the OTP it just stored.
 * SECURITY: the OTP is never logged here.
 */
async function sendOtpEmail(toEmail, otp) {
  const minutes = config.otp.expiryMinutes;
  // In production the expiry is always 5. Decimals only appear in development testing.
  const expiryText = Number.isInteger(minutes) ? `${minutes} minutes` : 'a very short time (test mode)';

  try {
    await transporter.sendMail({
      from: `"${config.email.fromName}" <${config.email.user}>`,
      to: toEmail,
      subject: 'Your library verification code',
      text:
        `Your library verification code is: ${otp}\n\n` +
        `It expires in ${expiryText}. Do not share it with anyone.\n` +
        `If you did not request this, you can ignore this email.`,
      html:
        `<p>Your library verification code is:</p>` +
        `<p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${otp}</p>` +
        `<p>It expires in ${expiryText}. Do not share it with anyone.</p>` +
        `<p>If you did not request this, you can ignore this email.</p>`,
    });
  } catch (err) {
    // Log only technical codes, never the OTP or credentials.
    console.error('Email delivery failed:', err.code || 'UNKNOWN', err.responseCode || '');
    const error = new Error('Email delivery failed');
    error.code = 'EMAIL_DELIVERY_FAILED';
    throw error;
  }
}

module.exports = { sendOtpEmail };