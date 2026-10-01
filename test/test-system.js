// End-to-End System Test Suite
const assert = require('assert');
const path = require('path');
const db = require('../src/database/db');
const attendanceService = require('../src/services/attendanceService');
const networkService = require('../src/services/networkService');
const qrService = require('../src/services/qrService');
const { seedData } = require('../src/database/seed');

async function runTests() {
  console.log('\n\x1b[36m=== RUNNING HOTSPOT ATTENDANCE SYSTEM VERIFICATION ===\x1b[0m\n');

  // Test 1: Database & Seed
  console.log('Test 1: Verifying Database & Student Seeding...');
  seedData();
  const studentCount = db.prepare('SELECT COUNT(*) as count FROM students').get().count;
  assert(studentCount >= 7, 'Expected at least 7 seeded students');
  console.log(`  ✓ Passed: Found ${studentCount} students in database.`);

  // Test 2: Network Service & Interfaces
  console.log('\nTest 2: Verifying Network Discovery & Interfaces...');
  const ifaces = networkService.getHostInterfaces();
  const primaryIp = networkService.getPrimaryHostIp();
  assert(primaryIp, 'Primary host IP should not be null');
  console.log(`  ✓ Passed: Primary Host IP resolved to: ${primaryIp} across ${ifaces.length} network adapters.`);

  // Test 3: Session Creation
  console.log('\nTest 3: Creating Attendance Session...');
  const session = attendanceService.startSession({
    subject: 'Computer Networks - Lecture 5',
    department: 'Computer Science',
    durationMinutes: 30,
    hostIp: primaryIp,
    allowAutoBind: true
  });
  assert(session && session.id, 'Session should be created with an ID');
  assert.strictEqual(session.status, 'active', 'Session should be active');
  console.log(`  ✓ Passed: Active Session created [${session.session_code}] for "${session.subject}".`);

  // Test 4: Dynamic QR Token Generation & Verification
  console.log('\nTest 4: Verifying Dynamic Rotating QR Code Token...');
  const qrData = await qrService.generateDynamicSessionQr(primaryIp, 3000, session.id, session.session_code);
  assert(qrData.token, 'QR Data should contain dynamic token');
  assert(qrData.qrDataUrl.startsWith('data:image/png;base64,'), 'QR data URL should be a valid PNG base64 string');
  
  const isValidToken = qrService.verifySessionToken(qrData.token, session.id, primaryIp);
  assert.strictEqual(isValidToken, true, 'Current session token should be valid');

  const isFakeTokenValid = qrService.verifySessionToken('fake_token_123', session.id, primaryIp);
  assert.strictEqual(isFakeTokenValid, false, 'Fake token must be rejected');
  console.log(`  ✓ Passed: Dynamic QR Token generated and cryptographically verified.`);

  // Test 5: First-Time Student Device Auto-Binding
  console.log('\nTest 5: Testing First-Time Student MAC Auto-Binding...');
  const testStudentRoll = 'CS-2024-001';
  const testMac1 = '1A:2B:3C:4D:5E:6F';
  
  // Ensure test student exists
  db.prepare(`
    INSERT OR IGNORE INTO students (roll_number, name, email, department)
    VALUES (?, 'Aarav Sharma', 'aarav@college.edu', 'Computer Science')
  `).run(testStudentRoll);

  // Clean student MAC for clean test
  db.prepare('UPDATE students SET mapped_mac = NULL WHERE roll_number = ?').run(testStudentRoll);

  const res1 = await attendanceService.markAttendance({
    sessionCode: session.session_code,
    token: qrData.token,
    rollNumber: testStudentRoll,
    clientIp: '192.168.137.50',
    clientMac: testMac1,
    verificationMethod: 'WIFI_HOTSPOT_ARP'
  });

  assert.strictEqual(res1.success, true, 'First-time attendance should succeed');
  assert.strictEqual(res1.isFirstTimeBinding, true, 'Should indicate device was bound');
  assert.strictEqual(res1.student.mapped_mac, testMac1, 'Student should now be mapped to test MAC');
  console.log(`  ✓ Passed: Student ${testStudentRoll} registered and mapped to MAC ${testMac1}.`);

  // Test 6: Returning Student Attendance with Bound MAC
  console.log('\nTest 6: Testing Returning Student Attendance (Verified Device)...');
  // First, verify attempting duplicate submission in same session is handled
  const resDup = await attendanceService.markAttendance({
    sessionCode: session.session_code,
    token: qrData.token,
    rollNumber: testStudentRoll,
    clientIp: '192.168.137.50',
    clientMac: testMac1,
    verificationMethod: 'WIFI_HOTSPOT_ARP'
  });
  assert.strictEqual(resDup.success, true, 'Should acknowledge student');
  assert.strictEqual(resDup.alreadyMarked, true, 'Should detect duplicate marking in same session');
  console.log(`  ✓ Passed: Duplicate submission in same session handled gracefully.`);

  // Test 7: Anti-Proxy Test 1 - MAC Mismatch (Friend's phone)
  console.log('\nTest 7: Testing Anti-Proxy Defense (MAC Mismatch Detection)...');
  const imposterMac = '99:88:77:66:55:44';
  const resProxy1 = await attendanceService.markAttendance({
    sessionCode: session.session_code,
    token: qrData.token,
    rollNumber: testStudentRoll, // CS-2024-001 is mapped to 1A:2B:3C:4D:5E:6F
    clientIp: '192.168.137.99',
    clientMac: imposterMac, // Different phone
    verificationMethod: 'WIFI_HOTSPOT_ARP'
  });

  assert.strictEqual(resProxy1.success, false, 'Proxy attempt with different MAC must be rejected');
  assert.strictEqual(resProxy1.error, 'PROXY_DETECTED_MAC_MISMATCH', 'Error code should be MAC mismatch');
  console.log(`  ✓ Passed: Imposter phone blocked! Reason: ${resProxy1.message}`);

  // Test 8: Anti-Proxy Test 2 - Single Device Reused for Multiple Students
  console.log('\nTest 8: Testing Anti-Proxy Defense (One Phone marking for multiple students)...');
  const testStudent2 = 'CS-2024-002'; // Unmapped student
  db.prepare('UPDATE students SET mapped_mac = NULL WHERE roll_number = ?').run(testStudent2);

  const resProxy2 = await attendanceService.markAttendance({
    sessionCode: session.session_code,
    token: qrData.token,
    rollNumber: testStudent2,
    clientIp: '192.168.137.50',
    clientMac: testMac1, // Same physical phone that already marked CS-2024-001
    verificationMethod: 'WIFI_HOTSPOT_ARP'
  });

  assert.strictEqual(resProxy2.success, false, 'One phone must not mark for multiple students');
  assert.strictEqual(resProxy2.error, 'PROXY_BLOCKED_DEVICE_REUSED', 'Should block device reuse');
  console.log(`  ✓ Passed: Double-dipping blocked! Reason: ${resProxy2.message}`);

  // Test 9: Expired / Invalid QR Token
  console.log('\nTest 9: Testing Expired / Forged QR Code Protection...');
  const resProxy3 = await attendanceService.markAttendance({
    sessionCode: session.session_code,
    token: 'invalid_token_999',
    rollNumber: 'CS-2024-004',
    clientIp: '192.168.137.60',
    clientMac: '44:33:22:11:00:55',
    verificationMethod: 'WIFI_HOTSPOT_ARP'
  });

  assert.strictEqual(resProxy3.success, false, 'Invalid token must be rejected');
  assert.strictEqual(resProxy3.error, 'INVALID_TOKEN', 'Error code should be INVALID_TOKEN');
  console.log(`  ✓ Passed: Stale / forged QR code token blocked!`);

  // Test 10: Student MAC QR Digital Pass
  console.log('\nTest 10: Testing Student MAC QR Digital Pass Generation & Verification...');
  const student = db.prepare('SELECT * FROM students WHERE roll_number = ?').get(testStudentRoll);
  const pass = await qrService.generateStudentMacQr(student);
  assert(pass.qrDataUrl, 'Pass should generate QR data URL');
  assert(pass.payload.sig, 'Pass payload must contain cryptographic signature');

  const isValidPass = qrService.verifyStudentPassPayload(pass.payload);
  assert.strictEqual(isValidPass, true, 'Authentic student pass signature must verify');

  const tamperedPass = { ...pass.payload, mac: 'FF:FF:FF:FF:FF:FF' };
  const isTamperedValid = qrService.verifyStudentPassPayload(tamperedPass);
  assert.strictEqual(isTamperedValid, false, 'Tampered pass signature must fail verification');
  console.log(`  ✓ Passed: Student MAC Pass generated and verified.`);

  // Test 11: Proxy Violation Logs
  console.log('\nTest 11: Verifying Security Audit Log...');
  const proxyLogs = db.prepare('SELECT * FROM proxy_logs ORDER BY id DESC').all();
  assert(proxyLogs.length >= 3, 'Expected at least 3 logged security violations');
  console.log(`  ✓ Passed: Found ${proxyLogs.length} logged proxy violations with IP, MAC, and timestamp.`);

  console.log('\n\x1b[32m=== ALL 11 TESTS PASSED SUCCESSFULLY! ===\x1b[0m\n');
}

runTests().catch(err => {
  console.error('\n✖ Test Failed:', err);
  process.exit(1);
});
