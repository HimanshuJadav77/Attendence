// Host / Instructor Dashboard Controller
const socket = io();

let currentSession = null;
let hostConfig = { primaryIp: '127.0.0.1', port: 3000, interfaces: [] };
let rotationSeconds = 20;
let rotationTimer = null;
let secondsRemaining = 20;
let proxyCount = 0;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  await fetchNetworkInfo();
  await checkActiveSession();
  await fetchArpDevices();
  setupEventListeners();
  setupSocketListeners();
});

// Fetch Host Network Interfaces
async function fetchNetworkInfo() {
  try {
    const res = await fetch('/api/network/interfaces');
    const data = await res.json();
    if (data.success) {
      hostConfig = data;
      document.getElementById('displayHostIp').textContent = `${data.primaryIp}:${data.port}`;
      
      const link = document.getElementById('studentPortalLink');
      link.href = `http://${data.primaryIp}:${data.port}/student`;
      link.textContent = `http://${data.primaryIp}:${data.port}/student`;

      // Populate interface dropdown in Start Session modal
      const select = document.getElementById('selectHostInterface');
      select.innerHTML = '';
      data.interfaces.forEach((iface) => {
        const opt = document.createElement('option');
        opt.value = iface.address;
        opt.textContent = `${iface.name} - ${iface.address} (${iface.type})`;
        if (iface.address === data.primaryIp) opt.selected = true;
        select.appendChild(opt);
      });

      const activeIface = data.interfaces.find(i => i.address === data.primaryIp);
      if (activeIface) {
        document.getElementById('displayAdapter').textContent = activeIface.type;
      }
    }
  } catch (err) {
    console.error('Failed to fetch network info:', err);
  }
}

// Check if an attendance session is already active
async function checkActiveSession() {
  try {
    const res = await fetch('/api/sessions/active');
    const data = await res.json();

    if (data.success && data.active && data.session) {
      currentSession = data.session;
      renderActiveSession(data);
      await fetchDynamicQr();
    } else {
      currentSession = null;
      renderNoSession();
    }
  } catch (err) {
    console.error('Failed to check active session:', err);
    renderNoSession();
  }
}

// Fetch Dynamic Rotating QR Code
async function fetchDynamicQr() {
  if (!currentSession) return;
  try {
    const res = await fetch('/api/sessions/qr');
    const data = await res.json();
    if (data.success && data.qrDataUrl) {
      updateQrDisplay(data);
    }
  } catch (err) {
    console.error('Error fetching QR:', err);
  }
}

// Update QR display & start local countdown timer
function updateQrDisplay(qrData) {
  const img = document.getElementById('sessionQrImg');
  const fsImg = document.getElementById('fsQrImg');
  img.src = qrData.qrDataUrl;
  fsImg.src = qrData.qrDataUrl;

  rotationSeconds = qrData.expiresIn || 20;
  secondsRemaining = rotationSeconds;
  startCountdownTimer();
}

function startCountdownTimer() {
  clearInterval(rotationTimer);
  const fill = document.getElementById('qrTimerFill');
  const text = document.getElementById('timerCountdown');

  updateTimerVisual();
  rotationTimer = setInterval(() => {
    secondsRemaining--;
    if (secondsRemaining <= 0) {
      secondsRemaining = rotationSeconds;
    }
    updateTimerVisual();
  }, 1000);

  function updateTimerVisual() {
    const pct = Math.max(0, (secondsRemaining / rotationSeconds) * 100);
    fill.style.width = `${pct}%`;
    text.textContent = `Rotating in ${secondsRemaining}s`;
  }
}

// Render active session view
function renderActiveSession(data) {
  document.getElementById('noSessionCard').style.display = 'none';
  document.getElementById('activeSessionCard').style.display = 'block';

  const session = data.session;
  document.getElementById('sessionSubjectTitle').textContent = session.subject;
  document.getElementById('sessionCodeSub').textContent = `${session.session_code} • ${session.department}`;
  document.getElementById('fsSubject').textContent = session.subject;

  if (data.stats) {
    updateStats(data.stats);
  }

  // Populate initial records if any
  const attendeeList = document.getElementById('attendeeList');
  if (data.records && data.records.length > 0) {
    attendeeList.innerHTML = '';
    data.records.forEach(r => appendAttendeeCard(r, false));
    document.getElementById('liveFeedCount').textContent = `${data.records.length} Marked`;
  }
}

function renderNoSession() {
  clearInterval(rotationTimer);
  document.getElementById('noSessionCard').style.display = 'block';
  document.getElementById('activeSessionCard').style.display = 'none';
}

function updateStats(stats) {
  document.getElementById('statPresentCount').textContent = stats.presentCount;
  document.getElementById('statTotalStudents').textContent = stats.totalStudents;
  document.getElementById('statPercentage').textContent = `${stats.percentage}%`;
  document.getElementById('fsPresentCount').textContent = stats.presentCount;
  document.getElementById('liveFeedCount').textContent = `${stats.presentCount} Marked`;
}

// Append real-time attendee card to the live feed
function appendAttendeeCard(record, animate = true) {
  const empty = document.getElementById('emptyFeedNotice');
  if (empty) empty.remove();

  const attendeeList = document.getElementById('attendeeList');
  const card = document.createElement('div');
  card.className = 'alert alert-success';
  card.style.padding = '0.75rem 1rem';
  card.style.marginBottom = '0.5rem';
  card.style.display = 'flex';
  card.style.justifyContent = 'space-between';
  card.style.alignItems = 'center';

  if (animate) {
    card.style.animation = 'fadeIn 0.3s ease-in';
  }

  const timeStr = new Date(record.timestamp || Date.now()).toLocaleTimeString();

  card.innerHTML = `
    <div>
      <div style="font-weight: 700; font-size: 0.95rem;">
        ${record.name || record.student?.name || record.roll_number}
      </div>
      <div style="font-size: 0.75rem; color: #166534; display: flex; gap: 0.5rem; align-items: center; margin-top: 2px;">
        <span class="font-mono" style="font-weight: 600;">${record.roll_number}</span>
        <span>•</span>
        <span class="font-mono">MAC: ${record.client_mac}</span>
      </div>
    </div>
    <div style="text-align: right;">
      <span class="badge badge-success" style="font-size: 0.7rem;">PRESENT</span>
      <div style="font-size: 0.7rem; color: #166534; margin-top: 2px;">${timeStr}</div>
    </div>
  `;

  attendeeList.prepend(card);
}

// Append security violation alert card
function appendSecurityAlert(alert) {
  proxyCount++;
  document.getElementById('statProxyAlerts').textContent = proxyCount;

  const list = document.getElementById('securityAlertsList');
  if (list.querySelector('div') && list.innerText.includes('No unauthorized')) {
    list.innerHTML = '';
  }

  const card = document.createElement('div');
  card.className = 'alert alert-danger';
  card.style.animation = 'fadeIn 0.3s ease-in';

  card.innerHTML = `
    <div style="font-size: 1.25rem;">⚠️</div>
    <div style="flex: 1;">
      <div style="font-weight: 700; font-size: 0.85rem; color: #991b1b;">
        SECURITY PROXY ALERT: ${alert.reason.replace(/_/g, ' ')}
      </div>
      <div style="font-size: 0.75rem; margin-top: 2px;">
        <strong>Roll:</strong> ${alert.attempted_roll} | <strong>Device MAC:</strong> <span class="font-mono">${alert.client_mac}</span>
      </div>
      <div style="font-size: 0.72rem; color: #b91c1c; margin-top: 2px;">
        ${alert.details || ''}
      </div>
    </div>
    <div style="font-size: 0.7rem; color: #991b1b;">
      ${new Date(alert.timestamp || Date.now()).toLocaleTimeString()}
    </div>
  `;

  list.prepend(card);
}

// Fetch connected Hotspot devices from ARP
async function fetchArpDevices() {
  try {
    const res = await fetch('/api/network/connected-devices');
    const data = await res.json();
    const tbody = document.getElementById('arpDevicesBody');
    const badge = document.getElementById('connectedCountBadge');

    if (data.success && data.devices.length > 0) {
      badge.textContent = `${data.devices.length} Connected`;
      tbody.innerHTML = '';
      data.devices.forEach(d => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="font-mono">${d.ip}</td>
          <td class="font-mono font-bold text-primary">${d.mac}</td>
          <td><span class="badge badge-secondary">${d.type}</span></td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      badge.textContent = '0 Found';
      tbody.innerHTML = `
        <tr>
          <td colspan="3" style="text-align: center; color: var(--text-muted); padding: 1rem;">
            No other active devices in ARP cache yet.
          </td>
        </tr>
      `;
    }
  } catch (err) {
    console.error('Failed to fetch ARP devices:', err);
  }
}

// Socket.IO event listeners
function setupSocketListeners() {
  // Real-time QR rotation from server background worker
  socket.on('session:qr_rotated', (qrData) => {
    if (currentSession) {
      updateQrDisplay(qrData);
    }
  });

  // Real-time attendance marked
  socket.on('attendance:marked', (payload) => {
    appendAttendeeCard({
      name: payload.student.name,
      roll_number: payload.student.roll_number,
      client_mac: payload.record.client_mac,
      timestamp: payload.record.timestamp
    });

    const presentEl = document.getElementById('statPresentCount');
    const current = parseInt(presentEl.textContent, 10) || 0;
    const newCount = current + 1;
    presentEl.textContent = newCount;
    document.getElementById('fsPresentCount').textContent = newCount;
    document.getElementById('liveFeedCount').textContent = `${newCount} Marked`;

    const total = parseInt(document.getElementById('statTotalStudents').textContent, 10) || 1;
    document.getElementById('statPercentage').textContent = `${Math.round((newCount / total) * 100)}%`;
  });

  // Real-time proxy / security alert
  socket.on('attendance:security_alert', (logEntry) => {
    appendSecurityAlert(logEntry);
  });

  // Session stopped
  socket.on('session:stopped', () => {
    currentSession = null;
    renderNoSession();
  });
}

// Setup button and form event listeners
function setupEventListeners() {
  // Open modal
  const modal = document.getElementById('startSessionModal');
  document.getElementById('btnOpenStartModal').addEventListener('click', () => {
    modal.classList.add('open');
  });

  document.getElementById('btnCancelModal').addEventListener('click', () => {
    modal.classList.remove('open');
  });

  // Submit Start Session Form
  document.getElementById('startSessionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = document.getElementById('sessionSubject').value;
    const department = document.getElementById('sessionDept').value;
    const durationMinutes = document.getElementById('sessionDuration').value;
    const hostIp = document.getElementById('selectHostInterface').value;
    const allowAutoBind = document.getElementById('allowAutoBind').checked;

    try {
      const res = await fetch('/api/sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, department, durationMinutes, hostIp, allowAutoBind })
      });
      const data = await res.json();
      if (data.success) {
        modal.classList.remove('open');
        currentSession = data.session;
        await checkActiveSession();
      } else {
        alert(data.error || 'Failed to start session');
      }
    } catch (err) {
      alert('Network error starting session: ' + err.message);
    }
  });

  // Stop Session
  document.getElementById('btnStopSession').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to end this attendance session?')) return;
    try {
      const res = await fetch('/api/sessions/stop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        currentSession = null;
        renderNoSession();
      }
    } catch (err) {
      alert('Error stopping session: ' + err.message);
    }
  });

  // Fullscreen Projector Mode
  const fsOverlay = document.getElementById('fullscreenOverlay');
  document.getElementById('btnFullscreenQr').addEventListener('click', () => {
    fsOverlay.style.display = 'flex';
  });

  document.getElementById('btnCloseFullscreen').addEventListener('click', () => {
    fsOverlay.style.display = 'none';
  });

  // Refresh ARP devices
  document.getElementById('btnRefreshArp').addEventListener('click', () => {
    fetchArpDevices();
  });
}
