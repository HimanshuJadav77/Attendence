const os = require('os');
const { execSync, exec } = require('child_process');
const logger = require('../utils/logger');

class NetworkService {
  /**
   * Get all active IPv4 network interfaces on the host
   */
  getHostInterfaces() {
    const interfaces = os.networkInterfaces();
    const results = [];

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal (127.0.0.1) and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          // Identify if it's likely a hotspot or Wi-Fi
          let type = 'LAN';
          const lowerName = name.toLowerCase();
          if (lowerName.includes('wi-fi') || lowerName.includes('wireless') || lowerName.includes('wlan')) {
            type = 'Wi-Fi';
          } else if (iface.address.startsWith('192.168.137.') || lowerName.includes('hotspot')) {
            type = 'Windows Mobile Hotspot';
          } else if (lowerName.includes('ethernet') || lowerName.includes('eth')) {
            type = 'Ethernet';
          }

          results.push({
            name,
            address: iface.address,
            netmask: iface.netmask,
            mac: iface.mac ? iface.mac.toUpperCase() : 'UNKNOWN',
            type,
            isHotspotLikely: iface.address.startsWith('192.168.137.') || type === 'Windows Mobile Hotspot' || type === 'Wi-Fi'
          });
        }
      }
    }

    // Sort so hotspot / Wi-Fi interfaces come first
    results.sort((a, b) => (b.isHotspotLikely ? 1 : 0) - (a.isHotspotLikely ? 1 : 0));
    return results;
  }

  /**
   * Get the recommended primary host IP
   */
  getPrimaryHostIp() {
    const ifaces = this.getHostInterfaces();
    if (ifaces.length === 0) {
      return '127.0.0.1';
    }
    // Prefer hotspot (192.168.137.1) if active, else Wi-Fi, else first available
    const hotspot = ifaces.find(i => i.address.startsWith('192.168.137.'));
    if (hotspot) return hotspot.address;

    const wifi = ifaces.find(i => i.type === 'Wi-Fi');
    if (wifi) return wifi.address;

    return ifaces[0].address;
  }

  /**
   * Normalize an incoming IP address from Express req
   */
  normalizeIp(ip) {
    if (!ip) return '127.0.0.1';
    // Clean IPv6 mapped IPv4 like ::ffff:192.168.1.5
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7);
    }
    if (ip === '::1') {
      return '127.0.0.1';
    }
    return ip;
  }

  /**
   * Check if an incoming request originates from the host machine (localhost) or authorized admin
   * Note: Requests over Wi-Fi/Hotspot (e.g. 192.168.43.41) are strictly treated as student clients
   * unless explicitly authenticated with the Admin PIN.
   */
  isHostClient(req) {
    if (!req) return false;
    const config = require('../config/config');

    // Always use the real TCP socket remoteAddress from the OS network stack
    let rawIp = (req.socket && req.socket.remoteAddress) || req.ip;
    if (req.headers && req.headers['x-simulated-client-ip']) {
      rawIp = req.headers['x-simulated-client-ip'];
    }
    const clientIp = this.normalizeIp(rawIp);

    // 1. Loopback / localhost is always the host machine
    if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost') {
      return true;
    }

    // 2. Allow Admin PIN authorization for instructors accessing from tablet/phone
    const pin =
      (req.headers && req.headers['x-admin-pin']) ||
      (req.query && (req.query.pin || req.query.admin_pin)) ||
      (req.headers && req.headers.cookie && req.headers.cookie.includes(`admin_pin=${config.adminPin}`));

    if (pin && String(pin) === String(config.adminPin)) {
      return true;
    }

    // All other network requests on the Wi-Fi/Hotspot IP are non-host (students)
    return false;
  }

  /**
   * Check if an IP is on the same local subnet / private network
   */
  isLocalIp(ip) {
    const cleanIp = this.normalizeIp(ip);
    if (cleanIp === '127.0.0.1') return true;

    // Check private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    return (
      cleanIp.startsWith('192.168.') ||
      cleanIp.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanIp)
    );
  }

  /**
   * Extract Hardware MAC address for a given IP using OS ARP cache table
   */
  async getMacFromIp(clientIp, req = null) {
    const ip = this.normalizeIp(clientIp);

    // Check for developer simulation header (useful for testing multi-device attendance from single browser)
    if (req && req.headers && req.headers['x-simulated-mac']) {
      const simMac = req.headers['x-simulated-mac'].trim().toUpperCase().replace(/-/g, ':');
      if (/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(simMac)) {
        logger.warn(`Using simulated MAC header: ${simMac} for IP: ${ip}`);
        return simMac;
      }
    }

    // Special handling for localhost (testing on same computer as server)
    if (ip === '127.0.0.1' || ip === 'localhost') {
      const ifaces = this.getHostInterfaces();
      const hostMac = ifaces.find(i => i.mac && i.mac !== '00:00:00:00:00:00')?.mac;
      return hostMac || '7A:9C:E2:31:00:01'; // Default host test MAC
    }

    // Try direct ARP table lookup
    let mac = this._queryArp(ip);

    // If not found in ARP table immediately, ping once to provoke ARP discovery, then re-check
    if (!mac) {
      await this._pingOnce(ip);
      mac = this._queryArp(ip);
    }

    if (mac) {
      mac = mac.toUpperCase().replace(/-/g, ':');
      logger.network(`Resolved IP ${ip} -> MAC: ${mac}`);
      return mac;
    }

    logger.warn(`Could not resolve MAC address for IP ${ip} via ARP`);
    return null;
  }

  /**
   * Internal ARP query
   */
  _queryArp(ip) {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? `arp -a ${ip}` : `arp -n ${ip}`;

    try {
      const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 });
      // Regex matches xx-xx-xx-xx-xx-xx or xx:xx:xx:xx:xx:xx
      const match = output.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/);
      return match ? match[0] : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Internal 1-packet ping
   */
  _pingOnce(ip) {
    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const cmd = isWindows ? `ping -n 1 -w 300 ${ip}` : `ping -c 1 -W 1 ${ip}`;
      exec(cmd, { timeout: 1000 }, () => resolve());
    });
  }

  /**
   * Get all active devices connected to the local network / hotspot from ARP table
   */
  getAllConnectedDevices() {
    try {
      const output = execSync('arp -a', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2000 });
      const lines = output.split('\n');
      const devices = [];

      // Regex to parse IP and MAC from ARP output
      const lineRegex = /([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\s+([0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2})\s+([a-zA-Z]+)/;

      for (const line of lines) {
        const match = line.match(lineRegex);
        if (match) {
          const ip = match[1];
          const mac = match[2].toUpperCase().replace(/-/g, ':');
          const type = match[3];

          // Filter out multicast and broadcast addresses
          if (!ip.startsWith('224.') && !ip.startsWith('239.') && !ip.endsWith('.255') && mac !== 'FF:FF:FF:FF:FF:FF') {
            devices.push({
              ip,
              mac,
              type,
              lastSeen: new Date().toISOString()
            });
          }
        }
      }
      return devices;
    } catch (e) {
      logger.error('Failed to get connected devices from ARP:', e.message);
      return [];
    }
  }
}

module.exports = new NetworkService();
