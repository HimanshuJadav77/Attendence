const Database = require('better-sqlite3');
const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');

// Initialize database
const db = new Database(config.dbPath);

// Enable WAL mode for high concurrency & performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  logger.info('Initializing SQLite database schema...');

  db.exec(`
    -- Students table
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roll_number TEXT UNIQUE NOT NULL COLLATE NOCASE,
      name TEXT NOT NULL,
      email TEXT,
      department TEXT DEFAULT 'Computer Science',
      mapped_mac TEXT UNIQUE COLLATE NOCASE,
      mapped_at DATETIME,
      is_active INTEGER DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Attendance Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_code TEXT UNIQUE NOT NULL,
      subject TEXT NOT NULL,
      department TEXT DEFAULT 'All',
      host_ip TEXT NOT NULL,
      status TEXT DEFAULT 'active', -- 'active', 'completed', 'cancelled'
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME,
      duration_minutes INTEGER DEFAULT 15,
      current_token TEXT,
      token_expires_at DATETIME,
      allow_auto_bind INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Attendance Records table
    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      roll_number TEXT NOT NULL COLLATE NOCASE,
      client_ip TEXT NOT NULL,
      client_mac TEXT NOT NULL COLLATE NOCASE,
      verification_method TEXT DEFAULT 'WIFI_HOTSPOT_ARP', -- 'WIFI_HOTSPOT_ARP', 'STUDENT_QR_SCAN', 'MANUAL_OVERRIDE'
      status TEXT DEFAULT 'PRESENT', -- 'PRESENT', 'LATE', 'FLAGGED'
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      UNIQUE(session_id, student_id),
      UNIQUE(session_id, client_mac)
    );

    -- Proxy & Security Violation Logs
    CREATE TABLE IF NOT EXISTS proxy_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      attempted_roll TEXT,
      client_ip TEXT,
      client_mac TEXT,
      registered_mac TEXT,
      reason TEXT NOT NULL,
      details TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for sub-millisecond lookups
    CREATE INDEX IF NOT EXISTS idx_students_roll ON students(roll_number);
    CREATE INDEX IF NOT EXISTS idx_students_mac ON students(mapped_mac);
    CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance_records(session_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance_records(student_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_mac ON attendance_records(client_mac);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  `);

  logger.success(`Database schema initialized successfully at ${config.dbPath}`);
}

initSchema();

module.exports = db;
