// Simple console logger with timestamps and icons

function formatTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

module.exports = {
  info: (msg, ...args) => {
    console.log(`\x1b[36m[${formatTime()}] ℹ\x1b[0m ${msg}`, ...args);
  },
  success: (msg, ...args) => {
    console.log(`\x1b[32m[${formatTime()}] ✓\x1b[0m ${msg}`, ...args);
  },
  warn: (msg, ...args) => {
    console.warn(`\x1b[33m[${formatTime()}] ⚠\x1b[0m ${msg}`, ...args);
  },
  error: (msg, ...args) => {
    console.error(`\x1b[31m[${formatTime()}] ✖\x1b[0m ${msg}`, ...args);
  },
  network: (msg, ...args) => {
    console.log(`\x1b[35m[${formatTime()}] 🌐 [NET]\x1b[0m ${msg}`, ...args);
  },
  security: (msg, ...args) => {
    console.log(`\x1b[41m\x1b[37m[${formatTime()}] 🛡 [SECURITY]\x1b[0m ${msg}`, ...args);
  }
};
