// Kiosk Camera QR Scanner Controller

let html5QrCode = null;
let isScanning = false;
let lastScannedText = null;
let scanCooldownTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  setupScannerControls();
});

function setupScannerControls() {
  const startBtn = document.getElementById('btnStartScan');
  const stopBtn = document.getElementById('btnStopScan');

  startBtn.addEventListener('click', async () => {
    try {
      html5QrCode = new Html5Qrcode('reader');
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };

      await html5QrCode.start(
        { facingMode: 'environment' },
        config,
        onScanSuccess,
        onScanFailure
      );

      isScanning = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      showScannerAlert('Camera active. Point at student QR code.', 'info');
    } catch (err) {
      showScannerAlert('Failed to start camera: ' + err.message, 'danger');
    }
  });

  stopBtn.addEventListener('click', async () => {
    if (html5QrCode && isScanning) {
      await html5QrCode.stop();
      isScanning = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      showScannerAlert('Camera stopped.', 'info');
    }
  });
}

async function onScanSuccess(decodedText) {
  // Prevent duplicate rapid scans of same code
  if (decodedText === lastScannedText) return;
  lastScannedText = decodedText;

  clearTimeout(scanCooldownTimer);
  scanCooldownTimer = setTimeout(() => {
    lastScannedText = null;
  }, 3500);

  try {
    const payload = JSON.parse(decodedText);
    if (!payload.roll || payload.type !== 'STUDENT_MAC_PASS') {
      showScannerAlert('Invalid QR code. Please scan an authentic Student Digital Pass.', 'warning');
      return;
    }

    showScannerAlert(`Verifying ${payload.roll} (${payload.name})...`, 'info');

    const res = await fetch('/api/attendance/scan-student-pass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload })
    });

    const data = await res.json();

    if (data.success) {
      showScannerAlert(`✓ PRESENT: ${data.student.name} (${data.student.roll_number}) • MAC: ${data.record.client_mac}`, 'success');
      playBeep(true);
    } else {
      showScannerAlert(`✖ Rejected: ${data.message}`, 'danger');
      playBeep(false);
    }
  } catch (e) {
    showScannerAlert('Could not parse QR data: ' + e.message, 'danger');
  }
}

function onScanFailure(error) {
  // Quiet ignore frame scan errors
}

function showScannerAlert(msg, type = 'info') {
  const el = document.getElementById('scanResultAlert');
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.style.display = 'block';
}

function playBeep(success) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (success) {
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else {
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {
    // Audio context not allowed or supported
  }
}
