// server.js
const express = require('express');
const helmet = require('helmet');
const config = require('./config/env');
const { testConnection } = require('./config/db');
const otpRoutes = require('./routes/otpRoutes');
const bookRoutes = require('./routes/bookRoutes');
const borrowRoutes = require('./routes/borrowRoutes');
const { markOverdueLoans } = require('./services/loanService');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());                        // security-related HTTP headers
app.use(express.json({ limit: '10kb' })); // parse JSON bodies, reject very large ones

// Simple health check to confirm the server is running.
app.get('/health', (req, res) => {
  res.json({ success: true, message: 'OTP service is running' });
});

app.use('/api/otp', otpRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/borrows', borrowRoutes);

// These two MUST come last: unknown routes first, then the error handler.
app.use(notFound);
app.use(errorHandler);

// Overdue check: runs once at startup, then every hour.
// It is a simple timer, which is fine for one server process.
const OVERDUE_CHECK_MS = 60 * 60 * 1000;

function runOverdueCheck() {
  markOverdueLoans()
    .then((marked) => {
      if (marked > 0) console.log(`Overdue check: marked ${marked} loan(s) as overdue.`);
    })
    .catch((err) => console.error('Overdue check FAILED:', err.code, err.message));
}

app.listen(config.port, () => {
  console.log(`OTP service listening on http://localhost:${config.port}`);
  // Report database status at startup, but keep running if it fails.
  testConnection().catch((err) =>
    console.error('MySQL connection FAILED:', err.code, err.message)
  );
  runOverdueCheck();
  // unref() lets the process exit normally if the server is ever stopped.
  setInterval(runOverdueCheck, OVERDUE_CHECK_MS).unref();
});