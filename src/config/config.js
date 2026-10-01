const os = require('os');
const path = require('path');
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'hotspot-attendance-secret-key-2026',
  dbPath: process.env.DB_PATH || path.join(__dirname, '../../attendance.db'),
  qrRotationSeconds: parseInt(process.env.QR_ROTATION_SECONDS || '20', 10),
  defaultSessionDuration: parseInt(process.env.DEFAULT_SESSION_DURATION || '15', 10), // in minutes
  allowAutoBind: process.env.ALLOW_AUTO_BIND !== 'false', // whether first-time students can auto-bind their MAC
  adminPin: process.env.ADMIN_PIN || 'admin123',
  environment: process.env.NODE_ENV || 'development'
};
