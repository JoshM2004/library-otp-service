// config/email.js
// Creates the Nodemailer "transporter" = our connection settings for Gmail's SMTP server.
// SMTP is the standard protocol for sending email.

const nodemailer = require('nodemailer');
const config = require('./env');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: config.email.port,
  secure: config.email.port === 465,       // 465 uses SSL immediately
  requireTLS: config.email.port === 587,   // 587 must upgrade to TLS (STARTTLS)
  auth: {
    user: config.email.user,
    pass: config.email.appPassword,        // App Password, never the real Gmail password
  },
  // Time limits so a blocked network fails quickly instead of hanging forever.
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});

module.exports = { transporter };