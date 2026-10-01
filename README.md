# 📡 Smart Wi-Fi Hotspot & MAC-Verified Attendance System

A production-grade, anti-proxy student attendance platform powered by **Node.js, Express, Socket.IO, and SQLite**. The system uses **Layer 2 ARP (Address Resolution Protocol)** to extract the hardware MAC address of connected student phones, permanently mapping each device to its student roll number.

---

## 🌟 Key Features

1. **Wi-Fi Hotspot & Local Subnet Isolation**:
   - The instructor creates a Wi-Fi Hotspot (e.g., Windows Mobile Hotspot or college Wi-Fi subnet).
   - Only students physically present and connected to the host network can reach the attendance server.
   - External internet access is completely unnecessary; the entire system works offline in a local LAN.

2. **Automatic Hardware MAC Resolution via ARP**:
   - When a student opens the portal on their phone, the server inspects the incoming TCP connection.
   - It queries the host operating system's ARP cache (`arp -a <ip>`) to retrieve the student's physical hardware MAC address (`XX:XX:XX:XX:XX:XX`).
   - No app installation is required on student devices — works out of the box in Safari, Chrome, and all mobile browsers.

3. **Multi-Layer Anti-Proxy Protection**:
   - **One Phone, One Attendance**: A single phone MAC address can only submit attendance **once per lecture session**. A student cannot mark attendance for their absent friends from the same phone.
   - **Device-to-Student Binding**: Each student's Roll Number is locked to their phone's MAC address in the database. Using another device triggers an immediate **MAC Mismatch Proxy Alert**.
   - **Dynamic Rotating QR Codes**: The instructor screen displays a large QR code that cryptographically rotates every 20 seconds. Students cannot photograph the QR code and share it with friends outside.
   - **Host-Only Dashboard Protection**: Accessing the server without `/student` (e.g., `http://<IP>:3000/`, `/students`, `/reports`) from any student device is **strictly rejected as invalid (HTTP 403)**. Student devices are only permitted to access `/student` and `/pass`.
   - **Private IP Restriction**: The server runs on a private local IP (e.g. `192.168.137.1`), preventing remote submissions.

4. **Real-Time Live Instructor Dashboard**:
   - Fullscreen Projector mode for classroom screens.
   - Real-time stream of students marking attendance with live green cards.
   - Live counter of present students, enrolled total, and attendance percentage.
   - Live security violation alerts showing intercepted proxy attempts.
   - Active ARP scanner showing all phones connected to the Wi-Fi hotspot.

5. **Student Digital ID Pass (MAC QR Badge)**:
   - Every student receives a **Digital Attendance Pass** with a cryptographic QR code encoding their Roll Number and mapped MAC address.
   - Allows Kiosk / Camera scanning at the classroom door.

6. **Student Directory & Device Management**:
   - Search & filter students by department and binding status.
   - One-click **"Reset MAC"** button if a student replaces or loses their phone.
   - Bulk CSV student import and export.
   - Comprehensive lecture attendance logs and CSV export.

---

## 🏗️ Architecture & How It Works

```
                        ┌──────────────────────────────────────────────────────────┐
                        │              INSTRUCTOR HOST COMPUTER                    │
                        │  • Windows Mobile Hotspot: 192.168.137.1                 │
                        │  • Node.js Server: Port 3000                             │
                        │  • SQLite Database (Students, Sessions, MAC Bindings)   │
                        │  • OS ARP Table (Maps IP -> Hardware MAC)                │
                        └──────────────────────────┬───────────────────────────────┘
                                                   │
                ┌──────────────────────────────────┴──────────────────────────────────┐
                │                                                                     │
     Wi-Fi Hotspot Connection                                              Wi-Fi Hotspot Connection
                │                                                                     │
                ▼                                                                     ▼
┌───────────────────────────────┐                                     ┌───────────────────────────────┐
│     STUDENT A's PHONE         │                                     │     STUDENT B's PHONE         │
│ IP: 192.168.137.45            │                                     │ IP: 192.168.137.46            │
│ MAC: 2A:32:AB:A5:AB:97        │                                     │ MAC: 8C:7A:3D:12:F0:9A        │
│ Roll: CS-2024-001             │                                     │ Roll: CS-2024-002             │
│                               │                                     │                               │
│ 1. Scans Projected QR Code    │                                     │ 1. Scans Projected QR Code    │
│ 2. Server extracts MAC via ARP│                                     │ 2. Server extracts MAC via ARP│
│ 3. Matches bound Roll Number  │                                     │ 3. Matches bound Roll Number  │
│ 4. ✅ ATTENDANCE MARKED        │                                     │ 4. ✅ ATTENDANCE MARKED        │
└───────────────────────────────┘                                     └───────────────────────────────┘
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js** v18+ (tested on Node v22.16)
- **Windows, Linux, or macOS**

### 2. Installation
```bash
# Navigate to project directory
cd F:\Attendence

# Install dependencies (already installed)
npm install
```

### 3. Start the Server
```bash
npm start
```
The server will print:
```
====================================================================
   🚀 SMART WI-FI HOTSPOT & MAC-BASED ATTENDANCE SYSTEM
====================================================================

Host Dashboard (Instructor):
  👉 Localhost:       http://localhost:3000
  👉 Hotspot / LAN:   http://192.168.137.1:3000

Student Attendance Portal (Phones on Hotspot):
  👉 Mobile URL:      http://192.168.137.1:3000/student
====================================================================
```

---

## 📶 Step-by-Step Classroom Setup

### Step 1: Turn on Windows Mobile Hotspot
1. Press `Win + I` to open **Windows Settings**.
2. Go to **Network & Internet** ➔ **Mobile Hotspot**.
3. Toggle Mobile Hotspot to **ON**.
4. Set your Network Name (e.g., `Classroom-Attendance`) and a simple password.
*(Note: Windows assigns IP `192.168.137.1` to the host computer).*

### Step 2: Instructor Launches Lecture Session
1. Open `http://localhost:3000` in your laptop browser.
2. Click **Start New Attendance Session**.
3. Enter the Subject Name (e.g., *Computer Networks*), Department, and Duration.
4. Click **Projector Mode** (`⛶`) to display the rotating QR code on the classroom projector.

### Step 3: Students Connect & Mark
1. Students connect their phones to the `Classroom-Attendance` Wi-Fi hotspot.
2. Students open their phone camera and scan the projected QR code (or open `http://192.168.137.1:3000/student`).
3. **First-Time Students**: Enter their Roll Number. The server immediately binds their phone's hardware MAC to their profile and marks attendance.
4. **Returning Students**: Recognized automatically! Tap **"Mark Attendance Now"** in 1 click.

---

## 📱 Smartphone MAC Randomization Note

Modern smartphones (Android 10+ and iOS 14+) use "Randomized MAC Addresses" for Wi-Fi privacy.
- **Good News**: Both Android and iOS assign a **consistent, persistent MAC address per Wi-Fi network SSID**. As long as students connect to the same hotspot name (`Classroom-Attendance`), their MAC address remains 100% constant across every lecture!
- **Optional Static MAC**: If preferred, students can toggle "Use Device MAC" in Wi-Fi Settings:
  - *Android*: Settings ➔ Wi-Fi ➔ Tap Network ➔ Advanced ➔ Privacy ➔ Select **"Use Device MAC"**.
  - *iPhone*: Settings ➔ Wi-Fi ➔ Tap (i) ➔ Toggle **"Private Wi-Fi Address"** OFF for this network.

---

## 🧪 Running the Verification Test Suite

A complete automated test suite is included to test end-to-end functionality and all anti-proxy security defenses:

```bash
node test/test-system.js
```

### Verified Test Cases:
- [x] **Test 1**: SQLite Database & Student Seeding
- [x] **Test 2**: Network Interface Discovery & Primary Host IP Resolution
- [x] **Test 3**: Attendance Session Creation & Expiry Management
- [x] **Test 4**: Dynamic Rotating QR Code Token & Cryptographic HMAC Verification
- [x] **Test 5**: First-Time Student Hardware MAC Auto-Binding
- [x] **Test 6**: Returning Student Verified MAC Attendance
- [x] **Test 7**: **Anti-Proxy Defense 1** — Imposter phone (MAC Mismatch) is BLOCKED
- [x] **Test 8**: **Anti-Proxy Defense 2** — One phone marking for multiple students is BLOCKED
- [x] **Test 9**: **Anti-Proxy Defense 3** — Expired / forged QR code token is BLOCKED
- [x] **Test 10**: Student Digital MAC Pass QR Generation & Signature Verification
- [x] **Test 11**: Real-Time Security Audit Logging

---

## 📂 Web Pages & Endpoints

| Page / Route | Purpose | Target Audience |
| :--- | :--- | :--- |
| `http://localhost:3000/` | Live Lecture Dashboard with rotating QR code & live attendee stream | Instructor |
| `http://<HOST_IP>:3000/student` | Mobile Attendance Portal with auto-MAC detection | Students |
| `http://localhost:3000/students` | Student Directory & MAC Mapping Manager (Unbind/Rebind) | Instructor / Admin |
| `http://localhost:3000/reports` | Attendance History & CSV Export, Proxy Audit Logs | Instructor / Admin |
| `http://localhost:3000/pass` | Student Digital ID Pass with hardware MAC QR Badge | Students / Instructor |
| `http://localhost:3000/scanner` | Camera QR Scanner (Kiosk Mode) for scanning student passes | Instructor / Gatekeeper |
| `http://localhost:3000/hotspot-guide` | Interactive Step-by-Step Hotspot Deployment Guide | All Users |

---

## 🛠️ REST API Reference

### Network & Devices
- `GET /api/network/interfaces` - List host network adapters and active IPs.
- `GET /api/network/connected-devices` - List devices in host ARP table.
- `GET /api/device/my-info` - Auto-detect caller IP and hardware MAC address.

### Sessions & Dynamic QR
- `GET /api/sessions/active` - Current active attendance session and stats.
- `POST /api/sessions/start` - Start new attendance session.
- `POST /api/sessions/stop` - End active session.
- `GET /api/sessions/qr` - Dynamic rotating session QR code.
- `GET /api/sessions/history` - List past lecture sessions.
- `GET /api/sessions/:id/export` - Export attendance record to CSV.

### Attendance & Anti-Proxy
- `POST /api/attendance/mark` - Submit student attendance with MAC validation.
- `POST /api/attendance/scan-student-pass` - Mark attendance via scanned digital pass.
- `GET /api/attendance/proxy-logs` - Retrieve security violation audit trail.

### Students
- `GET /api/students` - List all students (search, filter by department).
- `POST /api/students` - Create new student.
- `POST /api/students/:id/unbind-mac` - Reset hardware MAC for a student.
- `POST /api/students/:id/bind-mac` - Manually assign hardware MAC.
- `GET /api/students/:id/mac-qr` - Generate digital pass for student.
- `POST /api/students/bulk-import` - Bulk import students via CSV.

---

## 🔒 Security Summary

| Threat Vector | System Countermeasure |
| :--- | :--- |
| **Marking attendance from dorm/home** | Server runs on private local Wi-Fi IP; unreachable outside the classroom. |
| **Friend marking for absent friend** | Single phone MAC can only mark ONCE per session. Multiple attempts from same MAC are rejected. |
| **Using another student's phone** | Roll Numbers are bound to hardware MACs. MAC mismatch triggers an instant proxy alert. |
| **Photographing and forwarding QR code** | Dynamic QR codes rotate every 20 seconds. Expired tokens are immediately rejected. |
| **Forged / counterfeit passes** | Digital passes are cryptographically signed with HMAC-SHA256 signatures. |
