const express = require('express');
const router = express.Router();
const db = require('../database/db');
const attendanceService = require('../services/attendanceService');
const networkService = require('../services/networkService');
const qrService = require('../services/qrService');
const config = require('../config/config');
const logger = require('../utils/logger');

// Middleware: Restrict administrative API endpoints to host machine
function requireHostApi(req, res, next) {
  if (networkService.isHostClient(req)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    error: 'HOST_ACCESS_REQUIRED',
    message: 'Access denied: This administrative operation is restricted to the host instructor.'
  });
}

// ==========================================
// 1. NETWORK & CLIENT DEVICE DISCOVERY
// ==========================================

// Get host interfaces (Hotspot, Wi-Fi, Ethernet)
router.get('/network/interfaces', (req, res) => {
  try {
    const interfaces = networkService.getHostInterfaces();
    const primaryIp = networkService.getPrimaryHostIp();
    res.json({
      success: true,
      primaryIp,
      port: config.port,
      interfaces
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get connected devices on the local hotspot/subnet from ARP
router.get('/network/connected-devices', (req, res) => {
  try {
    const devices = networkService.getAllConnectedDevices();
    res.json({ success: true, count: devices.length, devices });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Client device self-detection: IP + Hardware MAC via ARP
router.get('/device/my-info', async (req, res) => {
  try {
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const clientIp = networkService.normalizeIp(rawIp);
    const clientMac = await networkService.getMacFromIp(clientIp, req);

    let mappedStudent = null;
    if (clientMac) {
      mappedStudent = db
        .prepare(`SELECT id, roll_number, name, email, department, mapped_mac, mapped_at FROM students WHERE mapped_mac = ?`)
        .get(clientMac);
    }

    res.json({
      success: true,
      clientIp,
      clientMac,
      isLocal: networkService.isLocalIp(clientIp),
      isLocalhost: clientIp === '127.0.0.1',
      isMapped: !!mappedStudent,
      student: mappedStudent
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 2. ATTENDANCE SESSIONS & DYNAMIC QR
// ==========================================

// Get currently active session
router.get('/sessions/active', (req, res) => {
  try {
    const session = attendanceService.getActiveSession();
    if (!session) {
      return res.json({ success: true, active: false, session: null });
    }

    const details = attendanceService.getSessionDetails(session.id);
    res.json({
      success: true,
      active: true,
      session: details.session,
      stats: details.stats,
      records: details.records
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Start a new session (Host only)
router.post('/sessions/start', requireHostApi, (req, res) => {
  try {
    const { subject, department, durationMinutes, hostIp, allowAutoBind } = req.body;
    if (!subject) {
      return res.status(400).json({ success: false, error: 'Subject name is required' });
    }

    const ip = hostIp || networkService.getPrimaryHostIp();
    const session = attendanceService.startSession({
      subject,
      department: department || 'All',
      durationMinutes: durationMinutes ? parseInt(durationMinutes, 10) : config.defaultSessionDuration,
      hostIp: ip,
      allowAutoBind: allowAutoBind !== false
    });

    res.json({ success: true, session });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Stop an active session (Host only)
router.post('/sessions/stop', requireHostApi, (req, res) => {
  try {
    const active = attendanceService.getActiveSession();
    if (!active) {
      return res.status(400).json({ success: false, error: 'No active session to stop' });
    }

    const stopped = attendanceService.stopSession(active.id);
    res.json({ success: true, session: stopped });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Dynamic Rotating QR Code for the active session (polled or refreshed every N seconds)
router.get('/sessions/qr', async (req, res) => {
  try {
    const activeSession = attendanceService.getActiveSession();
    if (!activeSession) {
      return res.status(404).json({ success: false, error: 'No active session' });
    }

    const hostIp = activeSession.host_ip || networkService.getPrimaryHostIp();
    const qrData = await qrService.generateDynamicSessionQr(
      hostIp,
      config.port,
      activeSession.id,
      activeSession.session_code
    );

    res.json({
      success: true,
      sessionCode: activeSession.session_code,
      subject: activeSession.subject,
      ...qrData
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Past sessions history
router.get('/sessions/history', (req, res) => {
  try {
    const sessions = db
      .prepare(`
        SELECT s.*, 
          COUNT(a.id) as present_count 
        FROM sessions s 
        LEFT JOIN attendance_records a ON s.id = a.session_id 
        GROUP BY s.id 
        ORDER BY s.id DESC 
        LIMIT 50
      `)
      .all();
    res.json({ success: true, sessions });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Session details with student attendance records
router.get('/sessions/:id', (req, res) => {
  try {
    const details = attendanceService.getSessionDetails(parseInt(req.params.id, 10));
    if (!details) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    res.json({ success: true, ...details });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Export session attendance as CSV
router.get('/sessions/:id/export', (req, res) => {
  try {
    const details = attendanceService.getSessionDetails(parseInt(req.params.id, 10));
    if (!details) {
      return res.status(404).send('Session not found');
    }

    const { session, records } = details;
    const filename = `Attendance_${session.subject.replace(/[^a-zA-Z0-9]/g, '_')}_${session.session_code}.csv`;

    let csv = 'Roll Number,Student Name,Department,Status,IP Address,MAC Address,Verification Method,Timestamp\n';
    for (const r of records) {
      csv += `"${r.roll_number}","${r.name}","${r.department}","${r.status}","${r.client_ip}","${r.client_mac}","${r.verification_method}","${r.timestamp}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e) {
    res.status(500).send('Error generating CSV: ' + e.message);
  }
});

// ==========================================
// 3. ATTENDANCE MARKING & VERIFICATION
// ==========================================

// Mark attendance (called by student's browser)
router.post('/attendance/mark', async (req, res) => {
  try {
    const { sessionCode, token, rollNumber, verificationMethod } = req.body;

    if (!rollNumber) {
      return res.status(400).json({ success: false, message: 'Roll Number is required.' });
    }

    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const clientIp = networkService.normalizeIp(rawIp);
    const clientMac = await networkService.getMacFromIp(clientIp, req);

    const result = await attendanceService.markAttendance({
      sessionCode,
      token,
      rollNumber: rollNumber.trim(),
      clientIp,
      clientMac,
      verificationMethod: verificationMethod || 'WIFI_HOTSPOT_ARP',
      req
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (e) {
    logger.error('Error marking attendance:', e);
    res.status(500).json({ success: false, message: 'Internal server error: ' + e.message });
  }
});

// Scan student digital pass (Teacher scanning student's QR badge)
router.post('/attendance/scan-student-pass', async (req, res) => {
  try {
    const { payload } = req.body;
    if (!payload || !payload.roll) {
      return res.status(400).json({ success: false, message: 'Invalid student pass data' });
    }

    // Verify digital pass signature
    const isValidSignature = qrService.verifyStudentPassPayload(payload);
    if (!isValidSignature) {
      return res.status(400).json({
        success: false,
        message: 'Invalid digital pass signature! Counterfeit or tampered pass.'
      });
    }

    const activeSession = attendanceService.getActiveSession();
    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active session running.' });
    }

    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const clientIp = networkService.normalizeIp(rawIp);

    const result = await attendanceService.markAttendance({
      sessionCode: activeSession.session_code,
      rollNumber: payload.roll,
      clientIp,
      clientMac: payload.mac !== 'UNMAPPED' ? payload.mac : null,
      verificationMethod: 'STUDENT_QR_SCAN',
      req
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Get proxy violation logs (Host only)
router.get('/attendance/proxy-logs', requireHostApi, (req, res) => {
  try {
    const logs = db
      .prepare(`
        SELECT p.*, s.subject 
        FROM proxy_logs p 
        LEFT JOIN sessions s ON p.session_id = s.id 
        ORDER BY p.id DESC 
        LIMIT 100
      `)
      .all();
    res.json({ success: true, logs });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 4. STUDENT MANAGEMENT & MAC MAPPINGS
// ==========================================

// Get all students
router.get('/students', (req, res) => {
  try {
    const { search, department, mapped } = req.query;
    let query = 'SELECT * FROM students WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (roll_number LIKE ? OR name LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (department && department !== 'All') {
      query += ' AND department = ?';
      params.push(department);
    }

    if (mapped === 'true') {
      query += ' AND mapped_mac IS NOT NULL';
    } else if (mapped === 'false') {
      query += ' AND mapped_mac IS NULL';
    }

    query += ' ORDER BY roll_number ASC';

    const students = db.prepare(query).all(...params);
    res.json({ success: true, count: students.length, students });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Add new student (Host only)
router.post('/students', requireHostApi, (req, res) => {
  try {
    const { roll_number, name, email, department, mapped_mac, notes } = req.body;

    if (!roll_number || !name) {
      return res.status(400).json({ success: false, message: 'Roll Number and Name are required.' });
    }

    const cleanRoll = roll_number.trim().toUpperCase();
    const cleanMac = mapped_mac ? mapped_mac.trim().toUpperCase().replace(/-/g, ':') : null;

    if (cleanMac && !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(cleanMac)) {
      return res.status(400).json({ success: false, message: 'Invalid MAC address format (XX:XX:XX:XX:XX:XX).' });
    }

    const stmt = db.prepare(`
      INSERT INTO students (roll_number, name, email, department, mapped_mac, mapped_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      cleanRoll,
      name.trim(),
      email ? email.trim() : null,
      department || 'Computer Science',
      cleanMac,
      cleanMac ? new Date().toISOString() : null,
      notes || null
    );

    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(result.lastInsertRowid);
    res.json({ success: true, student });
  } catch (e) {
    if (e.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ success: false, message: 'Roll number or MAC address already exists!' });
    }
    res.status(500).json({ success: false, message: e.message });
  }
});

// Unbind MAC address from a student (Host only)
router.post('/students/:id/unbind-mac', requireHostApi, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const success = attendanceService.unbindStudentMac(id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(id);
    res.json({ success: true, message: 'Device MAC address unbound successfully', student });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Manually bind MAC address to a student (Host only)
router.post('/students/:id/bind-mac', requireHostApi, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { macAddress } = req.body;
    if (!macAddress) {
      return res.status(400).json({ success: false, message: 'MAC address is required' });
    }

    const student = attendanceService.bindStudentMac(id, macAddress);
    res.json({ success: true, message: 'MAC address bound successfully', student });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// Generate Student MAC QR Code Pass
router.get('/students/:id/mac-qr', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const pass = await qrService.generateStudentMacQr(student);
    res.json({
      success: true,
      student,
      ...pass
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Delete student (Host only)
router.delete('/students/:id', requireHostApi, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.prepare(`DELETE FROM students WHERE id = ?`).run(id);
    res.json({ success: true, message: 'Student deleted successfully' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Bulk Import students via CSV payload (Host only)
router.post('/students/bulk-import', requireHostApi, (req, res) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or empty students array' });
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO students (roll_number, name, email, department, mapped_mac, mapped_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let imported = 0;
    const tx = db.transaction((rows) => {
      for (const row of rows) {
        if (row.roll_number && row.name) {
          const res = insert.run(
            row.roll_number.trim().toUpperCase(),
            row.name.trim(),
            row.email ? row.email.trim() : null,
            row.department || 'Computer Science',
            row.mapped_mac ? row.mapped_mac.trim().toUpperCase() : null,
            row.mapped_mac ? new Date().toISOString() : null
          );
          if (res.changes > 0) imported++;
        }
      }
    });

    tx(students);
    res.json({ success: true, imported, total: students.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
