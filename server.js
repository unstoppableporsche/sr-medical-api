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

// Dynamically generate future slots at runtime so availability can return many
// future slots without editing the source JSON. Configurable by months, doctors
// per department, and slots per doctor.
function generateFutureSlots({ months = 6, doctorsPerDept = 6, slotsPerDoctor = 6 } = {}) {
  const msInDay = 24 * 60 * 60 * 1000;
  const maxDays = Math.round(months * 30.44);
  const today = new Date();
  const existingDeptSet = new Set(appointmentSlots.map((s) => s.department));
  const departments = Array.from(existingDeptSet.length ? existingDeptSet : ['General Practice', 'Cardiology', 'Pediatrics', 'Dermatology', 'Neurology']);

  const sampleNames = [
    'Alex Morgan', 'Priya Desai', 'Daniel Ortiz', 'Sanjay Kapoor', 'Emily Johnson', 'Michael Chen',
    'Sara Lopez', 'James Patel', 'Alice Kumar', 'Robert Diaz', 'Linda Park', 'Yasmin Ali'
  ];

  const times = ['09:00', '10:30', '14:00', '15:30', '17:00'];

  let added = 0;

  function makeDeptCode(department) {
    return department.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
  }

  for (const department of departments) {
    const code = makeDeptCode(department);

    for (let dIndex = 1; dIndex <= doctorsPerDept; dIndex++) {
      const doctorId = `${code}-DR-${String(dIndex).padStart(3, '0')}`;
      const doctorName = sampleNames[(dIndex - 1) % sampleNames.length];
      const doctorRole = department === 'Pediatrics' ? 'Pediatrician' : `${department} Specialist`;

      for (let sIndex = 0; sIndex < slotsPerDoctor; sIndex++) {
        // Spread slots weekly across the range, with a small offset to vary weekdays
        const daysFromNow = Math.round((sIndex * 7) + (dIndex % 3));
        if (daysFromNow > maxDays) continue;

        const date = new Date(today.getTime() + daysFromNow * msInDay);
        const time = times[(dIndex + sIndex) % times.length];
        const [hourStr, minuteStr] = time.split(':');
        date.setHours(parseInt(hourStr, 10));
        date.setMinutes(parseInt(minuteStr, 10));
        date.setSeconds(0);

        if (date <= today) continue; // only future slots

        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');

        const slotId = `${code}-GEN-${y}${m}${dd}-${hh}${mm}-${dIndex}-${sIndex}`;

        // Avoid duplicates
        if (appointmentSlots.find((s) => s.slotId === slotId)) continue;

        const startTime = date.toDateString() + ' ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });

        const slot = {
          hospitalId: `HOSP-${String((dIndex % 5) + 1).padStart(3, '0')}`,
          department,
          doctorId,
          doctorName,
          doctorRole,
          slotId,
          startTime,
          isAvailable: true,
          insertedDate: new Date().toISOString(),
          updatedDate: new Date().toISOString(),
        };

        appointmentSlots.push(slot);
        added += 1;
      }
    }
  }

  console.log(`Generated ${added} dynamic future slots (months=${months}, doctorsPerDept=${doctorsPerDept}, slotsPerDoctor=${slotsPerDoctor}).`);
}

// Generate a healthy number of future slots on startup. Adjust params as needed.
generateFutureSlots({ months: 6, doctorsPerDept: 6, slotsPerDoctor: 6 });

function requireApiKey(req, res, next) {
  if (!API_KEY) return res.status(500).json({ success: false, message: 'Server API key not configured.' });
  const key = req.header('x-api-key');
  if (!key || key !== API_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Missing or invalid x-api-key.' });
  }
  next();
}

function parseStartTimeFromSlotId(slotId) {
  // Support both formats: YYYY-MM-DD-HHMM and YYYYMMDD-HHMM embedded at the end.
  const dateTimeMatch = slotId.match(/(\d{4})(?:-?(\d{2})(?:-?(\d{2}))?)-(\d{2})(\d{2})$/);
  if (!dateTimeMatch) return null;

  const year = Number(dateTimeMatch[1]);
  const month = Number(dateTimeMatch[2]);
  const day = Number(dateTimeMatch[3]);
  const hour = Number(dateTimeMatch[4]);
  const minute = Number(dateTimeMatch[5]);

  if (!year || !month || !day || hour > 23 || minute > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, 0);
  if (Number.isNaN(date.getTime())) return null;

  return `${date.toDateString()} ${date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  })}`;
}

function normalizeSlotStartTime(slot) {
  const parsed = parseStartTimeFromSlotId(slot.slotId);
  if (!parsed) return slot.startTime;
  return parsed;
}

function formatSlot(slot) {
  return {
    hospitalId: slot.hospitalId,
    department: slot.department,
    doctorId: slot.doctorId,
    doctorName: slot.doctorName,
    doctorRole: slot.doctorRole,
    slotId: slot.slotId,
    startTime: normalizeSlotStartTime(slot),
    isAvailable: slot.isAvailable,
  };
}

function buildSummary() {
  const available = appointmentSlots.filter((slot) => slot.isAvailable);
  const departments = available.reduce((summary, slot) => {
    const key = slot.department;
    if (!summary[key]) {
      summary[key] = {
        department: slot.department,
        totalAvailable: 0,
        hospitalIds: new Set(),
        nextSlot: normalizeSlotStartTime(slot),
      };
    }
    summary[key].totalAvailable += 1;
    summary[key].hospitalIds.add(slot.hospitalId);
    return summary;
  }, {});

  return Object.values(departments).map((item) => ({
    department: item.department,
    totalAvailable: item.totalAvailable,
    hospitalIds: Array.from(item.hospitalIds),
    nextSlot: item.nextSlot,
  }));
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
          <li><strong>GET /api/appointments/summary</strong> - public department summary of available slots</li>
          <li><strong>GET /api/appointments/availability</strong> - list available slots</li>
          <li><strong>POST /api/appointments</strong> - book an appointment</li>
          <li><strong>GET /api/appointments/patient/:patientId</strong> - list patient bookings</li>
        </ul>
        <h2>Example usage</h2>
        <pre><code>GET /api/appointments/summary</code></pre>
        <pre><code>GET /api/appointments/availability?department=Cardiology</code></pre>
        <pre><code>POST /api/appointments</code></pre>
        <p>Only <code>/api/appointments/summary</code> and <code>/api/health</code> are public.</p>
      </body>
    </html>
  `);
});

app.get('/api/appointments/summary', (req, res) => {
  return res.json({ success: true, departments: buildSummary() });
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
