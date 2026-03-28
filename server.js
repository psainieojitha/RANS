/**
 * ClearPath — Emergency Vehicle En-Route Alert System
 * Backend Server: Node.js + Express + Socket.io
 *
 * Architecture:
 *   - Driver app  → emits GPS coords → server
 *   - Server      → checks geofences → broadcasts tiered alerts
 *   - Dashboard   → receives all telemetry + alerts
 *   - Public app  → receives proximity alerts for their location
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────
// CONSTANTS & CONFIG
// ─────────────────────────────────────────────────────────────

const ALERT_ZONES = {
  APPROACH: 1000,   // metres — amber warning
  NEAR:     700,   // metres — urgent pull-over
  IMMINENT: 300,   // metres — clear intersection NOW
};

// Named intersections along the Bengaluru demo route
const INTERSECTIONS = [
  { id: 'richmond',    name: 'Richmond Circle',    lat: 12.9614, lng: 77.6003 },
  { id: 'lalbagh',     name: 'Lal Bagh Gate',      lat: 12.9619, lng: 77.6042 },
  { id: 'koramangala', name: 'Koramangala Jn.',    lat: 12.9670, lng: 77.6078 },
  { id: 'trinity',     name: 'Trinity Circle',     lat: 12.9725, lng: 77.6103 },
  { id: 'brigade',     name: 'Brigade Road Jn.',   lat: 12.9753, lng: 77.6233 },
  { id: 'hal',         name: 'HAL Cross',          lat: 12.9769, lng: 77.6358 },
];

// ─────────────────────────────────────────────────────────────
// MISSION STATE (in-memory; replace with DB for production)
// ─────────────────────────────────────────────────────────────

let missionState = createDefaultMission();

function createDefaultMission() {
  return {
    id: uuidv4(),
    status: 'idle',           // idle | active | paused | complete
    vehicle: {
      id: 'AMB-A7',
      name: 'Ambulance Unit A-7',
      plate: 'KA-01-AB-2024',
      type: 'ambulance',
    },
    origin: { name: 'Victoria Hospital',  lat: 12.9641, lng: 77.5953 },
    destination: { name: 'Manipal Hospital', lat: 12.9775, lng: 77.6408 },
    currentPosition: null,
    speed: 0,
    heading: 0,
    distanceTravelled: 0,
    distanceRemaining: 0,
    eta: null,
    startedAt: null,
    intersectionAlerts: {},   // intersectionId → last alert level
    alertLog: [],             // full history
    connectedDrivers: 0,
    connectedPublic: 0,
    connectedDashboards: 0,
  };
}

// ─────────────────────────────────────────────────────────────
// HAVERSINE DISTANCE (metres)
// ─────────────────────────────────────────────────────────────

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─────────────────────────────────────────────────────────────
// ALERT EVALUATION ENGINE
// ─────────────────────────────────────────────────────────────

function evaluateAlerts(vehicleLat, vehicleLng) {
  const newAlerts = [];

  for (const inter of INTERSECTIONS) {
    const dist = Math.round(haversine(vehicleLat, vehicleLng, inter.lat, inter.lng));
    const prev = missionState.intersectionAlerts[inter.id] || 'none';

    let level = 'none';
    if (dist <= ALERT_ZONES.IMMINENT)  level = 'imminent';
    else if (dist <= ALERT_ZONES.NEAR) level = 'near';
    else if (dist <= ALERT_ZONES.APPROACH) level = 'approach';

    // Was previously alerting, now passed (vehicle moved beyond intersection)
    const bearingPast = isVehiclePast(vehicleLat, vehicleLng, inter.lat, inter.lng);
    if (bearingPast && prev !== 'none' && prev !== 'clear') {
      level = 'clear';
    }

    if (level !== prev) {
      missionState.intersectionAlerts[inter.id] = level;

      if (level !== 'none') {
        const alert = buildAlert(inter, level, dist);
        missionState.alertLog.unshift(alert);
        if (missionState.alertLog.length > 200) missionState.alertLog.pop();
        newAlerts.push(alert);
      }
    }
  }

  return newAlerts;
}

function isVehiclePast(vLat, vLng, iLat, iLng) {
  // Simplified: vehicle is "past" if it's south-east of intersection in this route
  return vLat > iLat + 0.001 || vLng > iLng + 0.003;
}

function buildAlert(inter, level, dist) {
  const messages = {
    approach: `Ambulance approaching ${inter.name} — prepare to yield`,
    near:     `Pull over immediately — ambulance ${dist}m from ${inter.name}`,
    imminent: `⚠ CLEAR ${inter.name} NOW — ambulance arriving!`,
    clear:    `${inter.name} is clear — ambulance has passed`,
  };
  return {
    id: uuidv4(),
    intersectionId: inter.id,
    intersectionName: inter.name,
    lat: inter.lat,
    lng: inter.lng,
    level,
    distance: dist,
    message: messages[level],
    timestamp: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
// SOCKET.IO EVENT HANDLING
// ─────────────────────────────────────────────────────────────

io.on('connection', socket => {
  const clientIp = socket.handshake.address;
  console.log(`[CONNECT] ${socket.id} from ${clientIp}`);

  // ── JOIN ROOMS ──────────────────────────────────────────────
  socket.on('join:driver', () => {
    socket.join('drivers');
    missionState.connectedDrivers++;
    console.log(`[DRIVER] ${socket.id} joined`);
    socket.emit('mission:state', missionState);
    broadcastStats();
  });

  socket.on('join:dashboard', () => {
    socket.join('dashboards');
    missionState.connectedDashboards++;
    console.log(`[DASHBOARD] ${socket.id} joined`);
    socket.emit('mission:state', missionState);
    broadcastStats();
  });

  socket.on('join:public', (data) => {
    // data: { lat, lng } — public user's location (for nearby filtering)
    socket.join('public');
    socket.data.publicLat = data?.lat;
    socket.data.publicLng = data?.lng;
    missionState.connectedPublic++;
    console.log(`[PUBLIC] ${socket.id} joined (loc: ${data?.lat}, ${data?.lng})`);
    socket.emit('mission:state', missionState);
    broadcastStats();
  });

  // ── DRIVER: GPS UPDATE ──────────────────────────────────────
  socket.on('driver:gps', (data) => {
    if (missionState.status !== 'active') return;

    const { lat, lng, speed, heading, accuracy } = data;

    // Update vehicle position
    missionState.currentPosition = { lat, lng, accuracy };
    missionState.speed = Math.round(speed || 0);
    missionState.heading = heading || 0;
    missionState.distanceRemaining = Math.round(
      haversine(lat, lng, missionState.destination.lat, missionState.destination.lng)
    );

    // Calculate ETA
    const speedMs = (missionState.speed / 3.6) || 10;
    missionState.eta = new Date(Date.now() + (missionState.distanceRemaining / speedMs) * 1000).toISOString();

    // Emit telemetry to dashboards
    io.to('dashboards').emit('vehicle:telemetry', {
      lat, lng, speed: missionState.speed, heading,
      distanceRemaining: missionState.distanceRemaining,
      eta: missionState.eta,
      timestamp: new Date().toISOString(),
    });

    // Evaluate intersection alerts
    const newAlerts = evaluateAlerts(lat, lng);
    if (newAlerts.length > 0) {
      // Broadcast to all
      io.to('dashboards').emit('alerts:new', newAlerts);
      io.to('drivers').emit('alerts:new', newAlerts);

      // Send proximity-filtered alerts to public users
      for (const [sid, sock] of io.of('/').sockets) {
        if (sock.rooms.has('public')) {
          const pLat = sock.data.publicLat;
          const pLng = sock.data.publicLng;
          if (pLat && pLng) {
            const relevantAlerts = newAlerts.filter(a => {
              const d = haversine(pLat, pLng, a.lat, a.lng);
              return d < 1000; // only alerts within 1km of user
            });
            if (relevantAlerts.length > 0) {
              sock.emit('alerts:new', relevantAlerts);
            }
          } else {
            // No location available — send all alerts
            sock.emit('alerts:new', newAlerts);
          }
        }
      }
    }

    // Check if arrived
    if (missionState.distanceRemaining < 80) {
      completeMission();
    }
  });

  // ── MISSION CONTROL ─────────────────────────────────────────
  socket.on('mission:start', () => {
    if (missionState.status === 'active') return;
    missionState.status = 'active';
    missionState.startedAt = new Date().toISOString();
    missionState.intersectionAlerts = {};
    missionState.alertLog = [];
    missionState.currentPosition = { lat: missionState.origin.lat, lng: missionState.origin.lng };
    console.log('[MISSION] Started');
    io.emit('mission:started', missionState);
    broadcastStats();
  });

  socket.on('mission:pause', () => {
    if (missionState.status !== 'active') return;
    missionState.status = 'paused';
    console.log('[MISSION] Paused');
    io.emit('mission:paused');
    broadcastStats();
  });

  socket.on('mission:resume', () => {
    if (missionState.status !== 'paused') return;
    missionState.status = 'active';
    console.log('[MISSION] Resumed');
    io.emit('mission:resumed');
    broadcastStats();
  });

  socket.on('mission:reset', () => {
    missionState = createDefaultMission();
    missionState.connectedDrivers = [...io.of('/').sockets.values()].filter(s => s.rooms.has('drivers')).length;
    missionState.connectedDashboards = [...io.of('/').sockets.values()].filter(s => s.rooms.has('dashboards')).length;
    missionState.connectedPublic = [...io.of('/').sockets.values()].filter(s => s.rooms.has('public')).length;
    console.log('[MISSION] Reset');
    io.emit('mission:state', missionState);
  });

  // ── DISCONNECT ──────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (socket.rooms.has('drivers'))    missionState.connectedDrivers = Math.max(0, missionState.connectedDrivers - 1);
    if (socket.rooms.has('dashboards')) missionState.connectedDashboards = Math.max(0, missionState.connectedDashboards - 1);
    if (socket.rooms.has('public'))     missionState.connectedPublic = Math.max(0, missionState.connectedPublic - 1);
    console.log(`[DISCONNECT] ${socket.id}`);
    broadcastStats();
  });
});

function broadcastStats() {
  io.emit('stats:update', {
    connectedDrivers:    missionState.connectedDrivers,
    connectedDashboards: missionState.connectedDashboards,
    connectedPublic:     missionState.connectedPublic,
    missionStatus:       missionState.status,
  });
}

function completeMission() {
  if (missionState.status === 'complete') return;
  missionState.status = 'complete';
  const completedAt = new Date().toISOString();
  console.log('[MISSION] Complete');
  io.emit('mission:complete', { completedAt, alertsSent: missionState.alertLog.length });
}

// ─────────────────────────────────────────────────────────────
// REST API
// ─────────────────────────────────────────────────────────────

app.get('/api/mission', (req, res) => res.json(missionState));
app.get('/api/mission/alerts', (req, res) => res.json(missionState.alertLog));
app.get('/api/intersections', (req, res) => res.json(INTERSECTIONS));
app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/driver', (req, res) => res.sendFile(path.join(__dirname, 'public', 'driver.html')));
app.get('/alert', (req, res) => res.sendFile(path.join(__dirname, 'public', 'alert.html')));

// ─────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║     🚨  ClearPath Server Running              ║
╠═══════════════════════════════════════════════╣
║  Dashboard  →  http://localhost:${PORT}          ║
║  Driver App →  http://localhost:${PORT}/driver   ║
║  Public App →  http://localhost:${PORT}/alert    ║
║  API        →  http://localhost:${PORT}/api      ║
╚═══════════════════════════════════════════════╝
  `);
});
