const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const DATA_DIR = path.join(__dirname, 'data');

function loadJson(filename, fallback) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function saveJson(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

const patients = loadJson('patients.json', []);
const appointmentSlots = loadJson('appointmentSlots.json', []);
const bookedAppointments = loadJson('bookedAppointments.json', []);

function requireApiKey(req, res, next) {
  if (!API_KEY) return res.status(500).json({ success: false, message: 'Server API key not configured.' });
  const key = req.header('x-api-key');
  if (!key || key !== API_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Missing or invalid x-api-key.' });
  }
  next();
}

function formatSlot(slot) {
  return {
    hospitalId: slot.hospitalId,
    department: slot.department,
    doctorId: slot.doctorId,
    doctorName: slot.doctorName,
    doctorRole: slot.doctorRole,
    slotId: slot.slotId,
    startTime: slot.startTime,
    isAvailable: slot.isAvailable,
  };
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>SR Medical API</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; margin: 24px; }
          pre { background: #f4f4f4; padding: 12px; border-radius: 6px; }
          code { color: #c7254e; }
        </style>
      </head>
      <body>
        <h1>SR Medical API</h1>
        <p>This API supports appointment booking across multiple departments.</p>
        <p>Use the endpoints below to check availability, book appointments, and view patient bookings.</p>
        <h2>Available routes</h2>
        <ul>
          <li><strong>GET /api/health</strong> - service health check</li>
          <li><strong>GET /api/appointments/availability</strong> - list available slots</li>
          <li><strong>POST /api/appointments</strong> - book an appointment</li>
          <li><strong>GET /api/appointments/patient/:patientId</strong> - list patient bookings</li>
        </ul>
        <h2>Example usage</h2>
        <pre><code>GET /api/appointments/availability?department=Cardiology</code></pre>
        <pre><code>POST /api/appointments</code></pre>
        <p>All requests require the header <code>x-api-key</code>.</p>
      </body>
    </html>
  `);
});

app.get('/api/appointments/availability', requireApiKey, (req, res) => {
  const { department, hospitalId } = req.query;

  const matches = appointmentSlots.filter((slot) => {
    const departmentMatch = department ? slot.department.toLowerCase() === department.toLowerCase() : true;
    const hospitalMatch = hospitalId ? slot.hospitalId === hospitalId : true;
    return slot.isAvailable && departmentMatch && hospitalMatch;
  });

  return res.json({ success: true, availableSlots: matches.map(formatSlot) });
});

app.post('/api/appointments', requireApiKey, (req, res) => {
  const { patientId, slotId, reason, verified } = req.body;

  if (!patientId || !slotId || !reason || verified !== true) {
    return res.status(400).json({
      success: false,
      message: 'Missing or invalid request body. Required fields: patientId, slotId, reason, verified=true.',
    });
  }

  const patient = patients.find((p) => p.patientId === patientId);
  if (!patient) {
    return res.status(404).json({ success: false, message: 'Patient not found.' });
  }

  const slot = appointmentSlots.find((s) => s.slotId === slotId);
  if (!slot) {
    return res.status(404).json({ success: false, message: 'Appointment slot not found.' });
  }

  if (!slot.isAvailable) {
    return res.status(409).json({ success: false, message: 'Slot is no longer available.' });
  }

  slot.isAvailable = false;
  saveJson('appointmentSlots.json', appointmentSlots);

  const appointmentId = `APT-${patientId}-${slotId}`;
  const booked = {
    appointmentId,
    patientId,
    slotId,
    reason,
    status: 'booked',
    bookedAt: new Date().toISOString(),
  };

  bookedAppointments.push(booked);
  saveJson('bookedAppointments.json', bookedAppointments);

  return res.json({
    success: true,
    status: 'booked',
    appointmentId,
    message: 'Appointment booked successfully.',
    appointment: {
      patientId: patient.patientId,
      patientName: `${patient.firstName} ${patient.lastName}`,
      phone: patient.phone,
      hospitalId: slot.hospitalId,
      department: slot.department,
      doctorId: slot.doctorId,
      doctorName: slot.doctorName,
      doctorRole: slot.doctorRole,
      slotId: slot.slotId,
      startTime: slot.startTime,
      reason,
    },
  });
});

app.get('/api/appointments/patient/:patientId', requireApiKey, (req, res) => {
  const { patientId } = req.params;
  const patient = patients.find((p) => p.patientId === patientId);
  if (!patient) {
    return res.status(404).json({ success: false, message: 'Patient not found.' });
  }

  const patientAppointments = bookedAppointments
    .filter((appointment) => appointment.patientId === patientId)
    .map((appointment) => {
      const slot = appointmentSlots.find((s) => s.slotId === appointment.slotId) || {};
      return {
        appointmentId: appointment.appointmentId,
        patientId: appointment.patientId,
        patientName: `${patient.firstName} ${patient.lastName}`,
        phone: patient.phone,
        hospitalId: slot.hospitalId || null,
        department: slot.department || null,
        doctorId: slot.doctorId || null,
        doctorName: slot.doctorName || null,
        doctorRole: slot.doctorRole || null,
        slotId: appointment.slotId,
        startTime: slot.startTime || null,
        reason: appointment.reason,
        status: appointment.status,
        bookedAt: appointment.bookedAt,
      };
    });

  return res.json({ success: true, appointments: patientAppointments });
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'SR Medical API is running.' });
});

app.listen(PORT, () => {
  console.log(`SR Medical API listening on port ${PORT}`);
});
