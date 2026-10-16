// config/env.js
// Central place that loads .env and validates configuration at startup.
// Every other file should import settings from here instead of using process.env directly.

require('dotenv').config({ quiet: true });

const NODE_ENV = process.env.NODE_ENV || 'development';

// Variables that must exist for the app to work.
const REQUIRED = [
  'DB_HOST',
  'DB_USER',
  'DB_NAME',
  'OTP_HMAC_SECRET',
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
  'ADMIN_API_KEY',
];

const missing = REQUIRED.filter(
  (name) => !process.env[name] || process.env[name].trim() === ''
);

// DB_PASSWORD must be defined (an empty password is allowed only for local testing).
if (process.env.DB_PASSWORD === undefined) {
  missing.push('DB_PASSWORD');
}

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Check your .env file (see .env.example).');
  process.exit(1);
}

// The HMAC secret protects stored OTP hashes, so it must be long and not a placeholder.
const hmacSecret = process.env.OTP_HMAC_SECRET.trim();
if (hmacSecret.length < 32 || hmacSecret.startsWith('replace_with') || hmacSecret.startsWith('PASTE_')) {
  console.error('OTP_HMAC_SECRET is too short or still a placeholder. Generate a real one (at least 32 characters).');
  process.exit(1);
}

// The admin key protects book management, so it must be long and not a placeholder.
const adminApiKey = process.env.ADMIN_API_KEY.trim();
if (adminApiKey.length < 32 || adminApiKey.startsWith('PASTE_')) {
  console.error('ADMIN_API_KEY is too short or still a placeholder. Generate a real one (at least 32 characters).');
  process.exit(1);
}

// OTP expiry in minutes. Production must stay at 5 minutes.
// A shorter value is allowed only in development so expiration can be tested quickly.
const expiryMinutes = Number(process.env.OTP_EXPIRY_MINUTES || 5);
if (!Number.isFinite(expiryMinutes) || expiryMinutes <= 0) {
  console.error('OTP_EXPIRY_MINUTES must be a positive number.');
  process.exit(1);
}
if (NODE_ENV === 'production' && expiryMinutes !== 5) {
  console.error('In production, OTP_EXPIRY_MINUTES must be exactly 5.');
  process.exit(1);
}

// Maximum number of wrong guesses allowed per OTP.
const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS || 5);
if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
  console.error('OTP_MAX_ATTEMPTS must be a whole number of at least 1.');
  process.exit(1);
}

// Gmail App Passwords are 16 characters. Google shows them in groups of four,
// so we remove any spaces before checking.
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '');
if (gmailAppPassword.length !== 16) {
  console.error('GMAIL_APP_PASSWORD must be the 16-character Google App Password (not your normal Gmail password).');
  process.exit(1);
}

// 465 = SSL from the start (default). 587 = STARTTLS (fallback if 465 is blocked).
const smtpPort = Number(process.env.SMTP_PORT || 465);
if (smtpPort !== 465 && smtpPort !== 587) {
  console.error('SMTP_PORT must be 465 or 587.');
  process.exit(1);
}

module.exports = Object.freeze({
  nodeEnv: NODE_ENV,
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  otp: {
    hmacSecret,
    expiryMinutes,
    maxAttempts,
  },
  email: {
    user: process.env.GMAIL_USER.trim(),
    appPassword: gmailAppPassword,
    fromName: (process.env.EMAIL_FROM_NAME || 'Library OTP Service').trim(),
    port: smtpPort,
  },
  admin: {
    apiKey: adminApiKey,
  },
});