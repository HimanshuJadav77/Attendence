const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const config = require('./src/config/config');
const logger = require('./src/utils/logger');
const { seedData } = require('./src/database/seed');
const attendanceService = require('./src/services/attendanceService');
const networkService = require('./src/services/networkService');
const qrService = require('./src/services/qrService');
const apiRoutes = require('./src/routes/apiRoutes');

// Seed sample students if database is fresh
seedData();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Attach Socket.IO to AttendanceService for real-time broadcasts
attendanceService.setSocketIo(io);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxy headers for local hotspot & Wi-Fi router IP preservation
app.set('trust proxy', true);

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);

// Middleware to restrict Host/Admin views from student devices on Wi-Fi
function requireHostView(req, res, next) {
  if (networkService.isHostClient(req)) {
    return next();
  }
  // External client accessing root '/' -> Block access with 403 and show access‑denied page
  if (req.path === '/') {
    return res.status(403).sendFile(path.join(__dirname, 'public/views/access-denied.html'));
  }
  // External client accessing other admin paths (/students, /reports, /scanner)
  return res.status(403).sendFile(path.join(__dirname, 'public/views/access-denied.html'));
}

// View routes
// Root path: Host gets dashboard, external student devices are immediately redirected to /student
app.get('/', requireHostView, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/views/index.html'));
});

// Student attendance portal: Publicly accessible to all devices on the hotspot
app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/views/student.html'));
});

// Student digital ID pass: Publicly accessible
app.get('/pass', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/views/pass.html'));
});

// Admin-only views (students directory, reports, scanner)
app.get('/students', requireHostView, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/views/students.html'));
});

app.get('/reports', requireHostView, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/views/reports.html'));
});

app.get('/scanner', requireHostView, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/views/scanner.html'));
});

app.get('/hotspot-guide', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/views/hotspot-guide.html'));
});

// Socket.io event handling
io.on('connection', (socket) => {
  // Send active session immediately upon client connection
  const activeSession = attendanceService.getActiveSession();
  socket.emit('session:status', { active: !!activeSession, session: activeSession });

  socket.on('disconnect', () => {
    // client disconnected
  });
});

// Background Worker: Rotate dynamic QR code every N seconds for the active session
setInterval(async () => {
  try {
    const activeSession = attendanceService.getActiveSession();
    if (activeSession) {
      const hostIp = activeSession.host_ip || networkService.getPrimaryHostIp();
      const qrData = await qrService.generateDynamicSessionQr(
        hostIp,
        config.port,
        activeSession.id,
        activeSession.session_code
      );
      io.emit('session:qr_rotated', qrData);
    }
  } catch (err) {
    logger.error('Error rotating dynamic QR code:', err.message);
  }
}, config.qrRotationSeconds * 1000);

// Start HTTP server on 0.0.0.0 so all network devices (phones on hotspot/Wi-Fi) can access it
server.listen(config.port, '0.0.0.0', () => {
  const interfaces = networkService.getHostInterfaces();
  const primaryIp = networkService.getPrimaryHostIp();

  console.log('\n\x1b[36m' + '='.repeat(68) + '\x1b[0m');
  console.log('   \x1b[1m\x1b[32m🚀 SMART WI-FI HOTSPOT & MAC-BASED ATTENDANCE SYSTEM\x1b[0m');
  console.log('\x1b[36m' + '='.repeat(68) + '\x1b[0m');
  console.log(`\n\x1b[1mHost Dashboard (Instructor Laptop Only):\x1b[0m`);
  console.log(`  👉 Localhost:       \x1b[34m\x1b[1mhttp://localhost:${config.port}\x1b[0m (Restricted to Host)`);

  console.log(`\n\x1b[1mStudent Attendance Portal (Phones on Wi-Fi Hotspot):\x1b[0m`);
  console.log(`  👉 Attendance URL:  \x1b[32m\x1b[1mhttp://${primaryIp}:${config.port}/student\x1b[0m`);
  console.log(`  👉 Direct Hotspot:  \x1b[33mhttp://${primaryIp}:${config.port}\x1b[0m (Auto-redirects to /student)`);

  console.log(`\n\x1b[1mActive Network Adapters Detected:\x1b[0m`);
  if (interfaces.length === 0) {
    console.log('  ⚠️  No active network interfaces detected. Turn on Wi-Fi or Mobile Hotspot!');
  } else {
    for (const iface of interfaces) {
      const tag = iface.isHotspotLikely ? ' [HOTSPOT/PREFERRED]' : '';
      console.log(`  • ${iface.type.padEnd(22)}: \x1b[36mhttp://${iface.address}:${config.port}\x1b[0m (${iface.mac})${tag}`);
    }
  }
  console.log('\n\x1b[36m' + '='.repeat(68) + '\x1b[0m\n');
});
