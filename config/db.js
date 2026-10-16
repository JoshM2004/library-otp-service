// config/db.js
// Creates one shared MySQL connection pool for the whole app.
// Other files do: const { pool } = require('../config/db');

const mysql = require('mysql2/promise');
const config = require('./env');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true, // queue requests when all connections are busy
  connectionLimit: 10,      // at most 10 connections open at the same time
  queueLimit: 0,            // 0 = unlimited waiting queue
  charset: 'utf8mb4',
});

// Simple check used at startup and in the manual test below.
// It logs only the database name, never credentials.
async function testConnection() {
  const [rows] = await pool.query('SELECT DATABASE() AS db_name');
  console.log(`MySQL connection OK (database: ${rows[0].db_name})`);
}

module.exports = { pool, testConnection };