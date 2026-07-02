# SR Medical API

A small Node.js/Express appointment booking API for Yellow.ai Nexus.

## Endpoints

- `GET /api/appointments/availability?department=Cardiology&hospitalId=SR-HOSP-001`
- `POST /api/appointments`
- `GET /api/appointments/patient/:patientId`

## Run locally

1. `cd sr-medical-api`
2. `npm install`
3. copy `.env.example` to `.env`
4. set `API_KEY` in `.env`
5. `npm start`

Example `curl` tests:

```
curl "http://localhost:3000/api/appointments/availability?department=Cardiology" -H "x-api-key: YOUR_SECRET_KEY"
```

```
curl -X POST "http://localhost:3000/api/appointments" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_SECRET_KEY" \
  -d '{"patientId":"SM-19920115-005","slotId":"CARD-SLOT-2026-06-30-1615","reason":"Chest discomfort follow-up","verified":true}'
```

## Yellow.ai Nexus configuration

- `GET /api/appointments/availability?department={{department}}`
- `POST /api/appointments`
- `GET /api/appointments/patient/{{patient_id}}`

Headers:

- `Content-Type: application/json`
- `x-api-key: YOUR_SECRET_KEY`
