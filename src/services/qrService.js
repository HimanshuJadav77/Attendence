const QRCode = require('qrcode');
const crypto = require('crypto');
const config = require('../config/config');

class QrService {
  /**
   * Generate a time-sensitive session token that rotates every N seconds
   */
  generateSessionToken(sessionId, hostIp) {
    const timeWindow = Math.floor(Date.now() / (config.qrRotationSeconds * 1000));
    const raw = `${sessionId}:${hostIp}:${timeWindow}:${config.jwtSecret}`;
    const hash = crypto.createHmac('sha256', config.jwtSecret).update(raw).digest('hex').substring(0, 16);
    return `${sessionId}_${timeWindow}_${hash}`;
  }

  /**
   * Verify whether a submitted token is valid for the current or immediately previous time window
   */
  verifySessionToken(token, sessionId, hostIp) {
    if (!token) return false;
    const parts = token.split('_');
    if (parts.length !== 3) return false;

    const [tokenSessionId, tokenTimeWindow, tokenHash] = parts;
    if (String(tokenSessionId) !== String(sessionId)) return false;

    const currentTimeWindow = Math.floor(Date.now() / (config.qrRotationSeconds * 1000));
    const timeWindowNum = parseInt(tokenTimeWindow, 10);

    // Allow current time window or 1 window grace period (prevents race conditions right at rotation)
    if (Math.abs(currentTimeWindow - timeWindowNum) > 1) {
      return false;
    }

    const expectedRaw = `${sessionId}:${hostIp}:${tokenTimeWindow}:${config.jwtSecret}`;
    const expectedHash = crypto.createHmac('sha256', config.jwtSecret).update(expectedRaw).digest('hex').substring(0, 16);

    return tokenHash === expectedHash;
  }

  /**
   * Generate a Data URL for the dynamic session QR code
   */
  async generateDynamicSessionQr(hostIp, port, sessionId, sessionCode) {
    const token = this.generateSessionToken(sessionId, hostIp);
    const targetUrl = `http://${hostIp}:${port}/student?session=${sessionCode}&token=${token}`;

    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      quality: 0.95,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      },
      width: 320
    });

    return {
      token,
      targetUrl,
      qrDataUrl,
      expiresIn: config.qrRotationSeconds
    };
  }

  /**
   * Generate a QR Code for a Student based on their Roll Number and mapped MAC address
   */
  async generateStudentMacQr(student) {
    if (!student) throw new Error('Student data required');

    const payload = {
      type: 'STUDENT_MAC_PASS',
      roll: student.roll_number,
      name: student.name,
      dept: student.department,
      mac: student.mapped_mac || 'UNMAPPED',
      created: Date.now()
    };

    // Create an authenticity signature
    const signature = crypto
      .createHmac('sha256', config.jwtSecret)
      .update(`${student.roll_number}:${student.mapped_mac || ''}`)
      .digest('hex')
      .substring(0, 12);

    payload.sig = signature;

    const jsonString = JSON.stringify(payload);

    const qrDataUrl = await QRCode.toDataURL(jsonString, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 260,
      color: {
        dark: '#1e3a8a', // Deep navy
        light: '#ffffff'
      }
    });

    return {
      payload,
      qrDataUrl
    };
  }

  /**
   * Verify student MAC pass payload
   */
  verifyStudentPassPayload(payload) {
    if (!payload || !payload.roll || !payload.sig) return false;
    const expectedSig = crypto
      .createHmac('sha256', config.jwtSecret)
      .update(`${payload.roll}:${payload.mac === 'UNMAPPED' ? '' : (payload.mac || '')}`)
      .digest('hex')
      .substring(0, 12);

    return payload.sig === expectedSig;
  }
}

module.exports = new QrService();
