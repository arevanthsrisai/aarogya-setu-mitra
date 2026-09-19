# Deployment — Aarogya Setu Mitra (free tier)

Stack: Node.js (Express) + Neon Postgres. No build step; `npm start` runs the server which serves `public/` and `/api/*`.

## 1. Neon Postgres

1. Create a project at https://neon.tech (free tier).
2. Copy the pooled connection string (with `?sslmode=require`) — this is `DATABASE_URL`.
3. Create the schema and seed demo data (idempotent, safe to re-run):

```
# using psql or the Neon SQL editor, run in order:
migrations/001_schema.sql
migrations/002_seed.sql
```

Or from Node: `node -e "const {migrate}=require('./db/pg-shim')"` is not needed — the server auto-uses `DATABASE_URL` at runtime; only the two SQL files must be applied once.

## 2. Environment variables

| Var | Required | Notes |
|---|---|---|
| `PORT` | no | Defaults to 3000 (host sets its own) |
| `JWT_SECRET` | yes | Long random string, never commit |
| `DATABASE_URL` | yes | Neon pooled connection string |
| `NODE_ENV` | no | `production` on the host |
| `ABHA_MODE` | no | `mock` (default, deterministic sandbox payloads) — set `sandbox` once ABDM SBX credentials exist |
| `ABDM_CLIENT_ID` / `ABDM_CLIENT_SECRET` | no | Required only for `ABHA_MODE=sandbox` (ABDM sandbox) |
| `ABHA_RSA_PUBLIC_KEY` | no | Required only for `ABHA_MODE=sandbox` (PEM, for request encryption) |

`.env.example` lists these as placeholders. In mock mode no ABDM credentials are needed and the OTP is always `123456`.

## 3. Deploy on Render (free web service)

1. Push this folder to a GitHub repo (the app is self-contained; `public/` included).
2. Render → New → Web Service → connect the repo. Render detects Node.
   - Build command: `npm install`
   - Start command: `npm start`
3. Add the environment variables above (Render → Environment).
4. Deploy. Free instances sleep after ~15 min idle; first request after sleep is slow — fine for a demo.

## 4. Demo accounts (seeded)

| Username | Password | Role |
|---|---|---|
| `asha1` | `asha123` | ASHA Worker (full ABHA flow + patient PHI) |
| `anm1` | `anm123` | ANM |
| `doctor1` | `doctor123` | PHC Doctor |
| `doctor2` | `doctor123` | Hospital Doctor |
| `tho1` / `dho1` / `state1` | `tho123` / `dho123` / `state123` | Govt officers (analytics, no PHI) |
| `caregiver1` | `care123` | Caregiver (consent-gated, no PHI detail) |
| `facility1` | `facility123` | Facility Staff (stock mgmt) |

## 5. Post-deploy smoke check

```
GET  /api/health      -> {"ok":true}
GET  /api/abha/status -> {"mode":"mock","connected":true}
POST /api/auth/login  -> {"token":"..."} with asha1/asha123
```
