-- schema.sql
-- Standalone development database for the OTP service.
-- Safe to run more than once (uses IF NOT EXISTS).
-- NOTE: do NOT put real passwords or real student data in this file.

CREATE DATABASE IF NOT EXISTS library_otp_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE library_otp_db;

-- ---------------------------------------------------------------
-- tbl_users: follows the team's tbl_users design, plus two added
-- columns needed for OTP: email and is_verified.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_users (
  user_id      INT          NOT NULL AUTO_INCREMENT,
  username     VARCHAR(50)  NOT NULL,
  password     VARCHAR(255) NOT NULL,            -- never read or written by the OTP service
  full_name    VARCHAR(100) NOT NULL,
  email        VARCHAR(255) NOT NULL,            -- ADDED for OTP
  role         ENUM('admin','student') NOT NULL DEFAULT 'student',
  is_verified  TINYINT(1)   NOT NULL DEFAULT 0,  -- ADDED for OTP (0 = not verified, 1 = verified)
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- tbl_otps: one row per OTP that was generated.
-- One student can have many OTP rows over time (1 : M).
-- The OTP itself is NEVER stored, only its HMAC-SHA256 hash.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_otps (
  otp_id      INT              NOT NULL AUTO_INCREMENT,
  user_id     INT              NOT NULL,
  code_hash   CHAR(64)         NOT NULL,   -- HMAC-SHA256 in hex is always 64 characters
  expires_at  DATETIME         NOT NULL,   -- OTP is invalid at or after this time
  attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,  -- number of wrong guesses so far
  status      ENUM('active','used','invalidated') NOT NULL DEFAULT 'active',
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (otp_id),
  KEY idx_otps_user_status (user_id, status),  -- speeds up "find this student's active OTP"
  KEY idx_otps_expires_at (expires_at),        -- helps with cleaning up old rows later
  CONSTRAINT fk_otps_user
    FOREIGN KEY (user_id) REFERENCES tbl_users (user_id)
    ON DELETE CASCADE                          -- deleting a student also deletes their OTP rows
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- Sample students for standalone testing only.
-- The password value is a fake placeholder, not a real hash.
-- Re-running this file will not create duplicates.
-- ---------------------------------------------------------------
INSERT INTO tbl_users (username, password, full_name, email, role)
VALUES
  ('student001', 'DEV_PLACEHOLDER_NOT_A_REAL_PASSWORD_HASH', 'Test Student One', 'student001@example.com', 'student'),
  ('student002', 'DEV_PLACEHOLDER_NOT_A_REAL_PASSWORD_HASH', 'Test Student Two', 'student002@example.com', 'student')
ON DUPLICATE KEY UPDATE user_id = user_id;