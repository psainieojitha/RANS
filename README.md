# 🚨 ClearPath — Emergency Vehicle En-Route Alert System

> Real-time GPS tracking and tiered intersection alerts for emergency vehicles.  
> Built for hackathon demonstration — fully functional full-stack project.

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Node.js Server                           │
│              (Express + Socket.io + Alert Engine)               │
└────────┬───────────────────┬──────────────────────┬────────────┘
         │                   │                      │
    ┌────▼────┐         ┌────▼─────┐         ┌─────▼──────┐
    │ Driver  │         │Dashboard │         │Public Alert│
    │  App    │         │          │         │    App     │
    │(Mobile) │         │(Operator)│         │ (Civilians)│
    └─────────┘         └──────────┘         └────────────┘
         │
    GPS coords emitted
    via Socket.io
         │
    Server evaluates
    3 alert zones:
    ├── 600m → APPROACH (amber)
    ├── 300m → NEAR     (red)
    └── 100m → IMMINENT (red + vibrate)
```

## 📁 File Structure

```
clearpath/
├── server.js              ← Node.js + Express + Socket.io backend
├── package.json
├── public/
│   ├── dashboard.html     ← Operator command dashboard (desktop)
│   ├── driver.html        ← Driver PWA (mobile, uses real GPS)
│   └── alert.html         ← Public alert app (civilians)
└── README.md
```

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
npm start
# or for development with auto-reload:
npm run dev
```

### 3. Open the apps
| App | URL | Who uses it |
|-----|-----|-------------|
| 🖥 Operator Dashboard | http://localhost:3000 | Dispatch control room |
| 🚑 Driver App | http://localhost:3000/driver | Ambulance driver (mobile) |
| 📱 Public Alert | http://localhost:3000/alert | General public / civilians |

### 4. Run a mission
1. Open the **Dashboard** on a desktop browser
2. Open **Driver App** on a phone (on same network, use your computer's IP: `http://192.168.x.x:3000/driver`)
3. Share the **Public Alert** link with others
4. Press **Start Mission** on Driver App or Dashboard
5. Watch alerts propagate in real-time!

---

## 🔧 How It Works

### Alert Engine (`server.js`)
The server continuously evaluates the vehicle's GPS position against each known intersection using the **Haversine formula**:

| Zone | Distance | Signal Color | Action |
|------|----------|--------------|--------|
| APPROACH | ≤ 600m | 🟡 Amber | Notify drivers to prepare |
| NEAR | ≤ 300m | 🔴 Red | Urgent pull-over alert |
| IMMINENT | ≤ 100m | 🔴 Red flash | Clear intersection NOW |
| CLEAR | Vehicle passed | 🟢 Green | Resume normal traffic |

### GPS Broadcasting
- **Real device**: Uses `navigator.geolocation.watchPosition` (high-accuracy mode)
- **Simulation**: Falls back to a pre-defined Bengaluru route (Victoria → Manipal Hospital) when GPS is unavailable

### Real-time Communication
All updates flow via **Socket.io rooms**:
- `drivers` — receives alerts + mission state
- `dashboards` — receives full telemetry + alerts
- `public` — receives proximity-filtered alerts (only intersections within 1km of their location)

---

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mission` | Current mission state |
| GET | `/api/mission/alerts` | Full alert history |
| GET | `/api/intersections` | All monitored intersections |
| GET | `/api/health` | Server health check |

### Socket.io Events

**Client → Server:**
| Event | Payload | Description |
|-------|---------|-------------|
| `join:driver` | — | Register as driver |
| `join:dashboard` | — | Register as dashboard |
| `join:public` | `{lat, lng}` | Register as public user |
| `driver:gps` | `{lat, lng, speed, heading, accuracy}` | Send GPS update |
| `mission:start` | — | Start mission |
| `mission:pause` | — | Pause mission |
| `mission:reset` | — | Reset everything |

**Server → Client:**
| Event | Payload | Description |
|-------|---------|-------------|
| `mission:state` | Full mission object | Sent on join |
| `vehicle:telemetry` | `{lat, lng, speed, distanceRemaining, eta}` | Live vehicle data |
| `alerts:new` | `[Alert]` | New intersection alerts |
| `mission:complete` | `{completedAt, alertsSent}` | Mission finished |
| `stats:update` | `{connectedDrivers, connectedDashboards, connectedPublic}` | Connection counts |

---

## 🔮 Production Upgrades

| Feature | Implementation |
|---------|---------------|
| **Database** | MongoDB / PostgreSQL for mission logs |
| **Push Notifications** | Firebase FCM for background alerts |
| **Smart Signals** | Siemens SCATS / Swarco API for real signal control |
| **Auth** | JWT tokens for driver verification |
| **SMS Alerts** | Twilio for SMS to registered users in geofence |
| **Fleet Management** | Support multiple ambulances simultaneously |
| **Geofencing** | PostGIS for precise polygon-based alerting |
| **Maps** | Google Maps / HERE Maps for real routing |
| **Deployment** | Docker + Nginx + PM2 |

---

## 👥 Hackathon Team

Built for: Emergency Vehicle Management Hackathon  
Stack: Node.js · Express · Socket.io · Leaflet.js · Vanilla JS  
Demo route: Victoria Hospital → Manipal Hospital, Bengaluru

---

## 📄 License
MIT — free to use, modify, and deploy.
