// Admin Students Directory & MAC Manager Controller

document.addEventListener('DOMContentLoaded', () => {
  loadStudents();
  setupFilterListeners();
  setupModalListeners();
});

async function loadStudents() {
  const search = document.getElementById('searchInput').value.trim();
  const department = document.getElementById('filterDept').value;
  const mapped = document.getElementById('filterMapped').value;

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (department && department !== 'All') params.append('department', department);
  if (mapped && mapped !== 'all') params.append('mapped', mapped);

  try {
    const res = await fetch(`/api/students?${params.toString()}`);
    const data = await res.json();
    const tbody = document.getElementById('studentsTableBody');

    if (data.success && data.students.length > 0) {
      tbody.innerHTML = '';
      data.students.forEach(s => {
        const tr = document.createElement('tr');
        const boundDate = s.mapped_at ? new Date(s.mapped_at).toLocaleDateString() : '-';

        const macBadge = s.mapped_mac
          ? `<span class="badge badge-success font-mono font-bold">${s.mapped_mac}</span>`
          : `<span class="badge badge-warning">Unbound (Auto-Bind on Scan)</span>`;

        tr.innerHTML = `
          <td><strong class="font-mono">${s.roll_number}</strong></td>
          <td>
            <div style="font-weight: 700;">${s.name}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${s.email || 'No email'}</div>
          </td>
          <td>${s.department}</td>
          <td>${macBadge}</td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${boundDate}</td>
          <td style="text-align: right;">
            <div style="display: inline-flex; gap: 0.35rem;">
              <a href="/pass?roll=${s.roll_number}" target="_blank" class="btn btn-outline btn-sm" title="View Digital Pass">
                💳 Pass
              </a>
              ${
                s.mapped_mac
                  ? `<button class="btn btn-outline btn-sm" style="color: #dc2626;" onclick="unbindMac(${s.id}, '${s.roll_number}')" title="Unbind phone MAC">
                      Reset MAC
                    </button>`
                  : `<button class="btn btn-outline btn-sm" onclick="openBindModal(${s.id}, '${s.roll_number}', '${s.name}')" title="Manually assign MAC">
                      Bind MAC
                    </button>`
              }
              <button class="btn btn-outline btn-sm" style="color: #94a3b8;" onclick="deleteStudent(${s.id}, '${s.roll_number}')" title="Delete Student">
                🗑
              </button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            No students found matching your filters.
          </td>
        </tr>
      `;
    }
  } catch (err) {
    console.error('Failed to load students:', err);
  }
}

function setupFilterListeners() {
  document.getElementById('searchInput').addEventListener('input', debounce(loadStudents, 300));
  document.getElementById('filterDept').addEventListener('change', loadStudents);
  document.getElementById('filterMapped').addEventListener('change', loadStudents);
}

function setupModalListeners() {
  // Add Student
  const addModal = document.getElementById('addStudentModal');
  document.getElementById('btnAddStudent').addEventListener('click', () => {
    addModal.classList.add('open');
  });

  document.getElementById('addStudentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      roll_number: document.getElementById('newRoll').value,
      name: document.getElementById('newName').value,
      email: document.getElementById('newEmail').value,
      department: document.getElementById('newDept').value,
      mapped_mac: document.getElementById('newMac').value || null
    };

    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        addModal.classList.remove('open');
        document.getElementById('addStudentForm').reset();
        await loadStudents();
      } else {
        alert(data.message || 'Failed to add student');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // Manual Bind MAC
  const bindModal = document.getElementById('bindMacModal');
  document.getElementById('bindMacForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('bindStudentId').value;
    const macAddress = document.getElementById('bindMacInput').value;

    try {
      const res = await fetch(`/api/students/${id}/bind-mac`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ macAddress })
      });
      const data = await res.json();
      if (data.success) {
        bindModal.classList.remove('open');
        await loadStudents();
      } else {
        alert(data.message || 'Failed to bind MAC');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // Bulk Import
  const importModal = document.getElementById('bulkImportModal');
  document.getElementById('btnBulkImport').addEventListener('click', () => {
    importModal.classList.add('open');
  });

  document.getElementById('btnLoadSampleCsv').addEventListener('click', () => {
    document.getElementById('csvDataInput').value =
      'CS-2024-006,Rahul Gupta,rahul@college.edu,Computer Science,\n' +
      'CS-2024-007,Neha Sen,neha@college.edu,Computer Science,2A:32:AB:11:22:33\n' +
      'IT-2024-012,Amit Roy,amit@college.edu,Information Tech,\n' +
      'EC-2024-026,Karan Gill,karan@college.edu,Electronics,';
  });

  document.getElementById('btnProcessImport').addEventListener('click', async () => {
    const rawText = document.getElementById('csvDataInput').value.trim();
    if (!rawText) return alert('Please paste CSV text first');

    const lines = rawText.split('\n');
    const students = [];

    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        // Skip header if present
        if (parts[0].toLowerCase().includes('roll')) continue;
        students.push({
          roll_number: parts[0],
          name: parts[1],
          email: parts[2] || null,
          department: parts[3] || 'Computer Science',
          mapped_mac: parts[4] || null
        });
      }
    }

    if (students.length === 0) return alert('No valid student rows found');

    try {
      const res = await fetch('/api/students/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ students })
      });
      const data = await res.json();
      if (data.success) {
        alert(`Successfully imported ${data.imported} of ${data.total} students!`);
        importModal.classList.remove('open');
        document.getElementById('csvDataInput').value = '';
        await loadStudents();
      }
    } catch (err) {
      alert('Import error: ' + err.message);
    }
  });

  // Close modals
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    });
  });
}

// Window actions
window.unbindMac = async (id, rollNumber) => {
  if (!confirm(`Are you sure you want to reset the hardware MAC for student ${rollNumber}? This will allow the student to bind a replacement phone on their next scan.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/students/${id}/unbind-mac`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await loadStudents();
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

window.openBindModal = (id, rollNumber, name) => {
  document.getElementById('bindStudentId').value = id;
  document.getElementById('bindStudentTitle').textContent = `Bind Hardware MAC for ${name} (${rollNumber})`;
  document.getElementById('bindMacInput').value = '';
  document.getElementById('bindMacModal').classList.add('open');
};

window.deleteStudent = async (id, rollNumber) => {
  if (!confirm(`Are you sure you want to delete student ${rollNumber}? This will also delete their attendance records.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/students/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      await loadStudents();
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
