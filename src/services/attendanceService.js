const db = require('../database/db');
const qrService = require('./qrService');
const networkService = require('./networkService');
const logger = require('../utils/logger');
const config = require('../config/config');

class AttendanceService {
  constructor() {
    this.io = null; // Injected by server.js
  }

  setSocketIo(io) {
    this.io = io;
  }

  /**
   * Parse SQLite date string reliably as UTC timestamp
   */
  _parseDate(dateVal) {
    if (!dateVal) return 0;
    const str = String(dateVal).trim();
    if (!str.includes('Z') && !str.includes('+') && str.includes(' ')) {
      return new Date(str.replace(' ', 'T') + 'Z').getTime();
    }
    return new Date(str).getTime();
  }

  /**
   * Get the currently active attendance session
   */
  getActiveSession() {
    const session = db
      .prepare(`SELECT * FROM sessions WHERE status = 'active' ORDER BY id DESC LIMIT 1`)
      .get();

    if (!session) return null;

    // Check if session duration has expired
    const startTime = this._parseDate(session.start_time);
    const durationMs = session.duration_minutes * 60 * 1000;
    const now = Date.now();

    if (now > startTime + durationMs) {
      // Mark as completed
      this.stopSession(session.id);
      return null;
    }

    // Attach present count
    const count = db
      .prepare(`SELECT COUNT(*) as count FROM attendance_records WHERE session_id = ?`)
      .get(session.id).count;

    session.present_count = count;
    return session;
  }

  /**
   * Start a new attendance session
   */
  startSession({ subject, department = 'All', durationMinutes = 15, hostIp, allowAutoBind = true }) {
    const nowIso = new Date().toISOString();
    // End any current active session
    db.prepare(`UPDATE sessions SET status = 'completed', end_time = ? WHERE status = 'active'`).run(nowIso);

    const sessionCode = `SES-${Date.now().toString(36).toUpperCase()}`;

    const stmt = db.prepare(`
      INSERT INTO sessions (session_code, subject, department, host_ip, status, duration_minutes, allow_auto_bind, start_time)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `);

    const result = stmt.run(
      sessionCode,
      subject,
      department,
      hostIp,
      durationMinutes,
      allowAutoBind ? 1 : 0,
      nowIso
    );

    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(result.lastInsertRowid);
    session.present_count = 0;

    logger.success(`Started new attendance session: ${subject} (${sessionCode}) on host ${hostIp}`);

    if (this.io) {
      this.io.emit('session:started', session);
    }

    return session;
  }

  /**
   * Stop an active attendance session
   */
  stopSession(sessionId) {
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
    if (!session) return null;

    db.prepare(`UPDATE sessions SET status = 'completed', end_time = CURRENT_TIMESTAMP WHERE id = ?`).run(sessionId);

    logger.info(`Stopped attendance session: ${session.session_code}`);

    if (this.io) {
      this.io.emit('session:stopped', { sessionId, sessionCode: session.session_code });
    }

    return session;
  }

  /**
   * Mark attendance with Hotspot verification, MAC validation & Anti-Proxy checks
   */
  async markAttendance({
    sessionCode,
    token,
    rollNumber,
    clientIp,
    clientMac,
    verificationMethod = 'WIFI_HOTSPOT_ARP',
    req = null
  }) {
    logger.info(`Attendance submission: Roll=${rollNumber}, IP=${clientIp}, MAC=${clientMac}`);

    // 1. Verify active session
    const activeSession = this.getActiveSession();
    if (!activeSession) {
      return {
        success: false,
        error: 'NO_ACTIVE_SESSION',
        message: 'No active attendance session is running. Please ask the instructor to start a session.'
      };
    }

    if (sessionCode && activeSession.session_code !== sessionCode) {
      return {
        success: false,
        error: 'SESSION_MISMATCH',
        message: 'This QR code is for a different or expired session.'
      };
    }

    // 2. Dynamic Token Verification (prevent photo forwarding / stale links)
    if (token) {
      const isTokenValid = qrService.verifySessionToken(token, activeSession.id, activeSession.host_ip);
      if (!isTokenValid) {
        this.logProxyAttempt({
          sessionId: activeSession.id,
          attemptedRoll: rollNumber,
          clientIp,
          clientMac,
          reason: 'EXPIRED_OR_INVALID_QR_TOKEN',
          details: 'Student scanned an expired QR code token or shared link.'
        });

        return {
          success: false,
          error: 'INVALID_TOKEN',
          message: 'QR code expired or invalid! Please scan the live QR code on the instructor screen.'
        };
      }
    }

    // 3. Resolve hardware MAC if not provided or verify from IP
    let resolvedMac = clientMac;
    if (!resolvedMac) {
      resolvedMac = await networkService.getMacFromIp(clientIp, req);
    }

    if (!resolvedMac) {
      return {
        success: false,
        error: 'MAC_RESOLUTION_FAILED',
        message: 'Could not resolve device MAC address. Ensure you are connected directly to the Host Wi-Fi Hotspot!'
      };
    }

    resolvedMac = resolvedMac.toUpperCase().replace(/-/g, ':');

    // 4. Student profile lookup
    const student = db
      .prepare(`SELECT * FROM students WHERE roll_number = ? AND is_active = 1`)
      .get(rollNumber.trim());

    if (!student) {
      return {
        success: false,
        error: 'STUDENT_NOT_FOUND',
        message: `Roll Number '${rollNumber}' is not registered in the student directory.`
      };
    }

    // 5. Anti-Proxy Protection: Check if this MAC has ALREADY marked attendance for ANY student in this session
    const existingDeviceRecord = db
      .prepare(`
        SELECT a.*, s.name as student_name 
        FROM attendance_records a 
        JOIN students s ON a.student_id = s.id 
        WHERE a.session_id = ? AND a.client_mac = ?
      `)
      .get(activeSession.id, resolvedMac);

    if (existingDeviceRecord && existingDeviceRecord.student_id !== student.id) {
      const reason = 'ONE_DEVICE_MULTIPLE_STUDENTS';
      const details = `Device MAC ${resolvedMac} already marked attendance for Roll No ${existingDeviceRecord.roll_number} (${existingDeviceRecord.student_name}). Attempted proxy for ${student.roll_number} (${student.name}).`;
      
      this.logProxyAttempt({
        sessionId: activeSession.id,
        attemptedRoll: student.roll_number,
        clientIp,
        clientMac: resolvedMac,
        registeredMac: student.mapped_mac,
        reason,
        details
      });

      return {
        success: false,
        error: 'PROXY_BLOCKED_DEVICE_REUSED',
        message: `Proxy Alert! This phone has already submitted attendance for ${existingDeviceRecord.roll_number} (${existingDeviceRecord.student_name}). One phone cannot mark for multiple students!`
      };
    }

    // 6. MAC Address Mapping & Verification
    let isFirstTimeBinding = false;

    if (!student.mapped_mac) {
      // Student has no mapped device MAC yet
      if (!activeSession.allow_auto_bind && !config.allowAutoBind) {
        return {
          success: false,
          error: 'DEVICE_NOT_REGISTERED',
          message: 'Your device is not pre-registered. Please contact the administrator to register your phone.'
        };
      }

      // Check if this MAC is already bound to another student in the database
      const macOwner = db
        .prepare(`SELECT * FROM students WHERE mapped_mac = ? AND id != ?`)
        .get(resolvedMac, student.id);

      if (macOwner) {
        this.logProxyAttempt({
          sessionId: activeSession.id,
          attemptedRoll: student.roll_number,
          clientIp,
          clientMac: resolvedMac,
          registeredMac: null,
          reason: 'MAC_ALREADY_BOUND_TO_OTHER',
          details: `Device MAC ${resolvedMac} is permanently registered to ${macOwner.roll_number} (${macOwner.name}). Cannot bind to ${student.roll_number}.`
        });

        return {
          success: false,
          error: 'DEVICE_BOUND_TO_OTHER_STUDENT',
          message: `This phone is permanently registered to Roll No ${macOwner.roll_number} (${macOwner.name}). You cannot use another student's phone.`
        };
      }

      // Bind this device MAC to the student
      db.prepare(`
        UPDATE students 
        SET mapped_mac = ?, mapped_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(resolvedMac, student.id);

      isFirstTimeBinding = true;
      logger.success(`Bound MAC ${resolvedMac} to Student ${student.roll_number} (${student.name})`);
    } else {
      // Student already has a registered MAC -> MUST MATCH!
      if (student.mapped_mac.toUpperCase() !== resolvedMac.toUpperCase()) {
        const details = `Expected registered MAC: ${student.mapped_mac}, but request originated from: ${resolvedMac}.`;
        this.logProxyAttempt({
          sessionId: activeSession.id,
          attemptedRoll: student.roll_number,
          clientIp,
          clientMac: resolvedMac,
          registeredMac: student.mapped_mac,
          reason: 'MAC_MISMATCH_PROXY_ATTEMPT',
          details
        });

        return {
          success: false,
          error: 'PROXY_DETECTED_MAC_MISMATCH',
          message: `Proxy Alert! Roll No ${student.roll_number} is registered to a different device (${student.mapped_mac}). Attendance must be marked from your registered phone!`
        };
      }
    }

    // 7. Check if THIS student already marked in this session
    const existingStudentRecord = db
      .prepare(`SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?`)
      .get(activeSession.id, student.id);

    if (existingStudentRecord) {
      return {
        success: true,
        alreadyMarked: true,
        message: `You have already marked attendance for this session at ${new Date(existingStudentRecord.timestamp).toLocaleTimeString()}.`,
        student,
        record: existingStudentRecord
      };
    }

    // 8. Insert attendance record
    const insertStmt = db.prepare(`
      INSERT INTO attendance_records (
        session_id, student_id, roll_number, client_ip, client_mac, verification_method, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'PRESENT')
    `);

    const result = insertStmt.run(
      activeSession.id,
      student.id,
      student.roll_number,
      clientIp,
      resolvedMac,
      verificationMethod
    );

    const record = db.prepare(`SELECT * FROM attendance_records WHERE id = ?`).get(result.lastInsertRowid);

    // Update updated student info
    const updatedStudent = db.prepare(`SELECT * FROM students WHERE id = ?`).get(student.id);

    logger.success(`Attendance MARKED for ${student.roll_number} (${student.name}) via MAC ${resolvedMac}`);

    // Emit live update to Instructor Dashboard
    if (this.io) {
      this.io.emit('attendance:marked', {
        session: activeSession,
        student: updatedStudent,
        record,
        isFirstTimeBinding
      });
    }

    return {
      success: true,
      alreadyMarked: false,
      isFirstTimeBinding,
      message: isFirstTimeBinding
        ? `Device registered & Attendance marked successfully for ${student.name}!`
        : `Attendance marked successfully for ${student.name}!`,
      student: updatedStudent,
      record
    };
  }

  /**
   * Log security/proxy attempts and broadcast alert to instructor
   */
  logProxyAttempt({ sessionId, attemptedRoll, clientIp, clientMac, registeredMac, reason, details }) {
    logger.security(`Proxy Attempt: [${reason}] Roll: ${attemptedRoll}, IP: ${clientIp}, MAC: ${clientMac}`);

    const stmt = db.prepare(`
      INSERT INTO proxy_logs (session_id, attempted_roll, client_ip, client_mac, registered_mac, reason, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      sessionId || null,
      attemptedRoll || 'UNKNOWN',
      clientIp || 'UNKNOWN',
      clientMac || 'UNKNOWN',
      registeredMac || null,
      reason,
      details
    );

    const logEntry = db.prepare(`SELECT * FROM proxy_logs WHERE id = ?`).get(result.lastInsertRowid);

    if (this.io) {
      this.io.emit('attendance:security_alert', logEntry);
    }

    return logEntry;
  }

  /**
   * Get complete details and records for a session
   */
  getSessionDetails(sessionId) {
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
    if (!session) return null;

    const records = db
      .prepare(`
        SELECT a.*, s.name, s.department, s.email
        FROM attendance_records a
        JOIN students s ON a.student_id = s.id
        WHERE a.session_id = ?
        ORDER BY a.timestamp DESC
      `)
      .all(sessionId);

    const totalStudents = db
      .prepare(`SELECT COUNT(*) as count FROM students WHERE is_active = 1`)
      .get().count;

    const presentCount = records.length;
    const absentCount = Math.max(0, totalStudents - presentCount);
    const percentage = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;

    return {
      session,
      records,
      stats: {
        totalStudents,
        presentCount,
        absentCount,
        percentage
      }
    };
  }

  /**
   * Unbind MAC address from student (so student can register a replacement device)
   */
  unbindStudentMac(studentId) {
    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(studentId);
    if (!student) return false;

    db.prepare(`UPDATE students SET mapped_mac = NULL, mapped_at = NULL WHERE id = ?`).run(studentId);
    logger.info(`Unbound MAC address for Student ${student.roll_number} (${student.name})`);
    return true;
  }

  /**
   * Manually bind or update MAC address for a student
   */
  bindStudentMac(studentId, macAddress) {
    const cleanMac = macAddress.toUpperCase().replace(/-/g, ':');
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(cleanMac)) {
      throw new Error('Invalid MAC address format (expected XX:XX:XX:XX:XX:XX)');
    }

    // Check if MAC is used by another student
    const existing = db
      .prepare(`SELECT * FROM students WHERE mapped_mac = ? AND id != ?`)
      .get(cleanMac, studentId);

    if (existing) {
      throw new Error(`MAC ${cleanMac} is already assigned to ${existing.roll_number} (${existing.name})`);
    }

    db.prepare(`
      UPDATE students 
      SET mapped_mac = ?, mapped_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(cleanMac, studentId);

    return db.prepare(`SELECT * FROM students WHERE id = ?`).get(studentId);
  }
}

module.exports = new AttendanceService();
