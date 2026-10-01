// Access Control Verification Test
const http = require('http');
const assert = require('assert');

// Start test server instance
const express = require('express');
const path = require('path');
const config = require('../src/config/config');
const networkService = require('../src/services/networkService');
const apiRoutes = require('../src/routes/apiRoutes');

const app = express();
app.use(express.json());
app.set('trust proxy', true);

// Middleware to restrict Host/Admin views from student devices on Wi-Fi
function requireHostView(req, res, next) {
  if (networkService.isHostClient(req)) {
    return next();
  }
  if (req.path === '/') {
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    return res.redirect(302, '/student' + query);
  }
  return res.status(403).sendFile(path.join(__dirname, '../public/views/access-denied.html'));
}

app.use('/api', apiRoutes);

app.get('/', requireHostView, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/index.html'));
});

app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/student.html'));
});

app.get('/students', requireHostView, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/students.html'));
});

const server = app.listen(3099, '0.0.0.0', async () => {
  console.log('\n\x1b[36m=== TESTING ACCESS RESTRICTIONS (HOST VS STUDENT DEVICE) ===\x1b[0m\n');

  try {
    // 1. Host accessing '/' -> Should be 200 OK
    console.log('Test 1: Host accessing "/" on localhost...');
    const hostRootRes = await fetch('http://127.0.0.1:3099/');
    assert.strictEqual(hostRootRes.status, 200, 'Host should be able to access "/"');
    const hostHtml = await hostRootRes.text();
    assert(hostHtml.includes('Host Dashboard'), 'Host should see Host Dashboard');
    console.log('  ✓ Passed: Host receives Host Dashboard (HTTP 200).');

    // 2. Student device accessing '/' without '/student' -> Should be 302 Redirect to /student!
    console.log('\nTest 2: Student device (192.168.43.88) accessing "/" without "/student"...');
    const studentRootRes = await fetch('http://127.0.0.1:3099/', {
      headers: { 'x-simulated-client-ip': '192.168.43.88' },
      redirect: 'manual' // Inspect redirect response directly
    });
    assert.strictEqual(studentRootRes.status, 302, 'External client accessing "/" should receive HTTP 302 Redirect');
    assert.strictEqual(studentRootRes.headers.get('location'), '/student', 'Should redirect directly to /student');
    console.log('  ✓ Passed: External client accessing "/" is immediately REDIRECTED to /student (HTTP 302)!');

    // 3. Student device accessing '/student' -> Should be 200 OK
    console.log('\nTest 3: Student device accessing "/student"...');
    const studentPortalRes = await fetch('http://127.0.0.1:3099/student', {
      headers: { 'x-forwarded-for': '192.168.43.88' }
    });
    assert.strictEqual(studentPortalRes.status, 200, 'Student should be able to access "/student"');
    const portalHtml = await studentPortalRes.text();
    assert(portalHtml.includes('Wi-Fi Attendance Portal'), 'Should see Student Attendance Portal');
    console.log('  ✓ Passed: Student portal "/student" is accessible (HTTP 200).');

    // 4. Student device trying to access admin '/students' directory -> Should be 403 Forbidden
    console.log('\nTest 4: Student device trying to access admin directory "/students"...');
    const studentAdminRes = await fetch('http://127.0.0.1:3099/students', {
      headers: { 'x-simulated-client-ip': '192.168.43.88' }
    });
    assert.strictEqual(studentAdminRes.status, 403, 'Student should be blocked from "/students"');
    console.log('  ✓ Passed: Student blocked from "/students" directory (HTTP 403).');

    // 5. Student device trying to call Admin API 'POST /api/sessions/start' -> Should be 403
    console.log('\nTest 5: Student device attempting to start a session via API...');
    const apiRes = await fetch('http://127.0.0.1:3099/api/sessions/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-simulated-client-ip': '192.168.43.88'
      },
      body: JSON.stringify({ subject: 'Hacked Class' })
    });
    assert.strictEqual(apiRes.status, 403, 'External client must not start sessions');
    const apiJson = await apiRes.json();
    assert.strictEqual(apiJson.error, 'HOST_ACCESS_REQUIRED', 'Should specify HOST_ACCESS_REQUIRED');
    console.log('  ✓ Passed: Admin API call from student phone rejected (HTTP 403 HOST_ACCESS_REQUIRED).');

    console.log('\n\x1b[32m=== ALL ACCESS CONTROL TESTS PASSED! ===\x1b[0m\n');
  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  } finally {
    server.close();
  }
});
