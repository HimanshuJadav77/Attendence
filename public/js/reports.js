// Reports & Security Audit Controller

document.addEventListener('DOMContentLoaded', () => {
  loadSessions();
  loadProxyLogs();
  setupTabListeners();
});

// Setup tab navigation
function setupTabListeners() {
  const tabSessions = document.getElementById('tabSessionsBtn');
  const tabProxy = document.getElementById('tabProxyBtn');
  const secSessions = document.getElementById('sectionSessions');
  const secProxy = document.getElementById('sectionProxyLogs');

  tabSessions.addEventListener('click', () => {
    tabSessions.className = 'btn btn-primary btn-sm';
    tabProxy.className = 'btn btn-outline btn-sm';
    secSessions.style.display = 'block';
    secProxy.style.display = 'none';
  });

  tabProxy.addEventListener('click', () => {
    tabProxy.className = 'btn btn-primary btn-sm';
    tabSessions.className = 'btn btn-outline btn-sm';
    secProxy.style.display = 'block';
    secSessions.style.display = 'none';
  });
}

// Load sessions list
async function loadSessions() {
  try {
    const res = await fetch('/api/sessions/history');
    const data = await res.json();
    const tbody = document.getElementById('sessionsTableBody');

    if (data.success && data.sessions.length > 0) {
      tbody.innerHTML = '';
      data.sessions.forEach(s => {
        const tr = document.createElement('tr');
        const dateStr = new Date(s.start_time).toLocaleString();
        const statusBadge = s.status === 'active'
          ? `<span class="badge badge-success">Active</span>`
          : `<span class="badge badge-secondary">Completed</span>`;

        tr.innerHTML = `
          <td><strong class="font-mono">${s.session_code}</strong></td>
          <td><strong style="color: var(--text-main);">${s.subject}</strong></td>
          <td>${s.department}</td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${dateStr}</td>
          <td>${s.duration_minutes} min</td>
          <td><span class="badge badge-info">${s.present_count || 0} Students</span></td>
          <td>${statusBadge}</td>
          <td style="text-align: right;">
            <button class="btn btn-outline btn-sm" onclick="viewSessionDetails(${s.id})">
              👁 View Log
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            No attendance sessions recorded yet. Start a session from the Live Session dashboard!
          </td>
        </tr>
      `;
    }
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

// View details of a specific session
window.viewSessionDetails = async (sessionId) => {
  try {
    const res = await fetch(`/api/sessions/${sessionId}`);
    const data = await res.json();

    if (data.success) {
      const card = document.getElementById('sessionDetailCard');
      card.style.display = 'block';

      document.getElementById('detailSubjectTitle').textContent = `${data.session.subject} (${data.session.session_code})`;
      document.getElementById('detailSubtitle').textContent = `Department: ${data.session.department} • Present: ${data.stats.presentCount} / ${data.stats.totalStudents} (${data.stats.percentage}%)`;

      const exportBtn = document.getElementById('btnExportCsv');
      exportBtn.href = `/api/sessions/${sessionId}/export`;

      const tbody = document.getElementById('sessionRecordsBody');
      if (data.records.length > 0) {
        tbody.innerHTML = '';
        data.records.forEach(r => {
          const tr = document.createElement('tr');
          const time = new Date(r.timestamp).toLocaleTimeString();
          tr.innerHTML = `
            <td><strong class="font-mono">${r.roll_number}</strong></td>
            <td><strong>${r.name}</strong></td>
            <td>${r.department}</td>
            <td class="font-mono" style="font-size: 0.8rem;">${time}</td>
            <td class="font-mono">${r.client_ip}</td>
            <td class="font-mono text-primary font-bold">${r.client_mac}</td>
            <td><span class="badge badge-secondary" style="font-size: 0.7rem;">${r.verification_method}</span></td>
            <td><span class="badge badge-success">PRESENT</span></td>
          `;
          tbody.appendChild(tr);
        });
      } else {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">
              No student records for this session.
            </td>
          </tr>
        `;
      }

      // Smooth scroll to details
      card.scrollIntoView({ behavior: 'smooth' });
    }
  } catch (err) {
    alert('Error loading session details: ' + err.message);
  }
};

// Load Proxy & Security Logs
async function loadProxyLogs() {
  try {
    const res = await fetch('/api/attendance/proxy-logs');
    const data = await res.json();
    const tbody = document.getElementById('proxyLogsTableBody');

    if (data.success && data.logs.length > 0) {
      tbody.innerHTML = '';
      data.logs.forEach(l => {
        const tr = document.createElement('tr');
        const time = new Date(l.timestamp).toLocaleString();
        tr.innerHTML = `
          <td style="font-size: 0.8rem; color: var(--text-muted);">${time}</td>
          <td><strong class="font-mono text-danger" style="color: #dc2626;">${l.attempted_roll}</strong></td>
          <td class="font-mono">${l.client_ip}</td>
          <td class="font-mono font-bold" style="color: #dc2626;">${l.client_mac}</td>
          <td class="font-mono">${l.registered_mac || '<span style="color: #94a3b8;">Unbound</span>'}</td>
          <td><span class="badge badge-danger">${l.reason.replace(/_/g, ' ')}</span></td>
          <td style="font-size: 0.75rem; color: var(--text-muted);">${l.details || '-'}</td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            No proxy violations or suspicious attempts logged.
          </td>
        </tr>
      `;
    }
  } catch (err) {
    console.error('Failed to load proxy logs:', err);
  }
}
