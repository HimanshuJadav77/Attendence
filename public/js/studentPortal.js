// Student Mobile Attendance Portal Controller

let currentDeviceInfo = null;
let activeSessionData = null;
let sessionCodeFromUrl = null;
let tokenFromUrl = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Parse query parameters from scanned QR code URL
  const urlParams = new URLSearchParams(window.location.search);
  sessionCodeFromUrl = urlParams.get('session');
  tokenFromUrl = urlParams.get('token');

  initSimulationTools();
  await fetchMyDeviceInfo();
  await checkActiveSession();
  setupEventListeners();
});

// Detect client's IP and hardware MAC address via server ARP lookup
async function fetchMyDeviceInfo() {
  try {
    const headers = getRequestHeaders();
    const res = await fetch('/api/device/my-info', { headers });
    const data = await res.json();

    if (data.success) {
      currentDeviceInfo = data;
      document.getElementById('clientIpDisplay').textContent = data.clientIp;
      document.getElementById('clientMacDisplay').textContent = data.clientMac || 'Unresolved';

      const bindingRow = document.getElementById('deviceBindingRow');
      const bindingBadge = document.getElementById('deviceBindingStatus');

      if (data.isMapped && data.student) {
        bindingRow.style.display = 'flex';
        bindingBadge.className = 'badge badge-success';
        bindingBadge.textContent = `Mapped to ${data.student.roll_number}`;

        // Show recognized student card
        document.getElementById('recognizedStudentCard').style.display = 'block';
        document.getElementById('recognizedName').textContent = data.student.name;
        document.getElementById('recognizedRoll').textContent = data.student.roll_number;
        document.getElementById('recognizedDept').textContent = data.student.department;

        // Hide manual input or pre-fill
        document.getElementById('manualRollInputGroup').style.display = 'none';
        document.getElementById('rollNumberInput').value = data.student.roll_number;

        // Show view pass button
        const passBtn = document.getElementById('btnViewMyPass');
        passBtn.style.display = 'block';
        passBtn.href = `/pass?roll=${data.student.roll_number}`;
      } else {
        bindingRow.style.display = 'flex';
        bindingBadge.className = 'badge badge-warning';
        bindingBadge.textContent = 'Unregistered Device';

        document.getElementById('recognizedStudentCard').style.display = 'none';
        document.getElementById('manualRollInputGroup').style.display = 'block';

        // Check if student was previously saved in localStorage
        const savedRoll = localStorage.getItem('last_roll_number');
        if (savedRoll) {
          document.getElementById('rollNumberInput').value = savedRoll;
        }
      }
    }
  } catch (err) {
    console.error('Error fetching device info:', err);
    showAlert('Unable to connect to host server. Are you connected to the Wi-Fi Hotspot?', 'danger');
  }
}

// Check active session on the host
async function checkActiveSession() {
  try {
    const res = await fetch('/api/sessions/active');
    const data = await res.json();

    if (data.success && data.active && data.session) {
      activeSessionData = data.session;
      const banner = document.getElementById('sessionBanner');
      banner.style.display = 'flex';
      document.getElementById('sessionSubject').textContent = data.session.subject;

      // Check if session code matches URL
      if (sessionCodeFromUrl && sessionCodeFromUrl !== data.session.session_code) {
        showAlert('Warning: The QR code you scanned is for an earlier session.', 'warning');
      }
    } else {
      activeSessionData = null;
      document.getElementById('sessionBanner').style.display = 'none';
      showAlert('No active attendance session currently running on the host.', 'warning');
    }
  } catch (err) {
    console.error('Error checking active session:', err);
  }
}

// Setup event listeners
function setupEventListeners() {
  document.getElementById('btnSubmitAttendance').addEventListener('click', async () => {
    await submitAttendance();
  });

  document.getElementById('btnMarkAnother').addEventListener('click', () => {
    document.getElementById('successCard').style.display = 'none';
    document.getElementById('markAttendanceSection').style.display = 'block';
  });
}

// Submit attendance
async function submitAttendance() {
  const rollInput = document.getElementById('rollNumberInput');
  const rollNumber = rollInput.value.trim().toUpperCase();

  if (!rollNumber) {
    showAlert('Please enter your Student Roll Number.', 'warning');
    rollInput.focus();
    return;
  }

  const btn = document.getElementById('btnSubmitAttendance');
  btn.disabled = true;
  btn.textContent = 'Verifying Hardware MAC...';

  try {
    const payload = {
      rollNumber,
      sessionCode: sessionCodeFromUrl || (activeSessionData ? activeSessionData.session_code : null),
      token: tokenFromUrl,
      verificationMethod: 'WIFI_HOTSPOT_ARP'
    };

    const headers = {
      'Content-Type': 'application/json',
      ...getRequestHeaders()
    };

    const res = await fetch('/api/attendance/mark', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.success) {
      // Save roll to localStorage for convenience
      localStorage.setItem('last_roll_number', rollNumber);

      showSuccess(data);
    } else {
      showAlert(data.message || 'Attendance failed.', 'danger');
    }
  } catch (err) {
    showAlert('Network error: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Mark Attendance Now';
  }
}

// Display success view with confetti
function showSuccess(data) {
  document.getElementById('alertBox').style.display = 'none';
  document.getElementById('markAttendanceSection').style.display = 'none';
  document.getElementById('successCard').style.display = 'block';

  const student = data.student;
  const record = data.record;

  document.getElementById('receiptName').textContent = student.name;
  document.getElementById('receiptRoll').textContent = student.roll_number;
  document.getElementById('receiptSubject').textContent = activeSessionData ? activeSessionData.subject : 'Attendance Verified';
  document.getElementById('receiptTime').textContent = new Date(record.timestamp || Date.now()).toLocaleTimeString();
  document.getElementById('receiptMac').textContent = record.client_mac;

  const passBtn = document.getElementById('btnPassLink');
  passBtn.href = `/pass?roll=${student.roll_number}`;

  if (data.alreadyMarked) {
    document.getElementById('successSubtitle').textContent = 'You have already marked attendance for this session.';
  } else if (data.isFirstTimeBinding) {
    document.getElementById('successSubtitle').textContent = `🎉 Device mapped to ${student.roll_number} and attendance marked!`;
  }

  // Trigger celebration confetti
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 80,
      spread: 60,
      origin: { y: 0.6 }
    });
  }
}

function showAlert(message, type = 'info') {
  const box = document.getElementById('alertBox');
  box.className = `alert alert-${type}`;
  box.innerHTML = `
    <div style="font-weight: 700; font-size: 0.85rem;">
      ${type === 'danger' ? '⛔ ' : type === 'warning' ? '⚠️ ' : 'ℹ '}
      ${message}
    </div>
  `;
  box.style.display = 'flex';
}

// Simulation helper headers for developer testing
function getRequestHeaders() {
  const headers = {};
  const simMac = localStorage.getItem('simulated_mac');
  if (simMac) {
    headers['x-simulated-mac'] = simMac;
  }
  return headers;
}

function initSimulationTools() {
  const input = document.getElementById('simulatedMacInput');
  const savedSim = localStorage.getItem('simulated_mac');
  if (savedSim) {
    input.value = savedSim;
  }

  document.getElementById('btnSetSimMac').addEventListener('click', () => {
    const val = input.value.trim();
    if (val) {
      localStorage.setItem('simulated_mac', val);
      alert('Simulated MAC set to: ' + val + '. Reloading...');
      window.location.reload();
    }
  });

  document.getElementById('btnClearSimMac').addEventListener('click', () => {
    localStorage.removeItem('simulated_mac');
    input.value = '';
    alert('Simulated MAC cleared. Reloading...');
    window.location.reload();
  });
}
