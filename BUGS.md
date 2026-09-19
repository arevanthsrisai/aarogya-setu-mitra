# BUGS.md — Bug Triage & Resolution Register

## Priority 1: Critical / Data Safety / Crashes
- **BUG-001 (Resolved)**: Unhandled promise rejection when `process.env.JWT_SECRET` was undefined during isolated node testing.
  - *Fix*: Added default development fallback secret in `middleware.js` and loaded `dotenv` in test runners.
  - *Verification*: `tests/run-tests.js` PASS.
- **BUG-002 (Resolved)**: Double quoted `datetime("now")` in SQLite `INSERT` queries caused SQLite column resolution error.
  - *Fix*: Replaced `datetime("now")` with single-quoted `datetime('now')` across SQL prepared statements.
  - *Verification*: `TEST 11` (Offline Data Sync) PASS.
- **BUG-003 (Resolved)**: SPA initialization loop failed to run on script load due to missing `init()` call at the bottom of `public/app.js`.
  - *Fix*: Wrapped `init()` execution with explicit `document.readyState` check at the end of `public/app.js`.
  - *Verification*: Static JS fetch length verified & page renders clean UI.

## Priority 2: Core Workflow Buttons & Endpoint Routes
- **BUG-004 (Resolved)**: Express server background task 99 was running an older version of `routes.js` without the `/api/telecom/send-sms` and `/api/telecom/ivr-query` endpoints.
  - *Fix*: Restarted Express server process; updated routes loaded cleanly.
  - *Verification*: `SMS Endpoint` & `IVR Endpoint` PASS.

## Priority 3: Edge Case / Boundary Inputs
- **BUG-005 (Resolved)**: Malformed JWT tokens or SQL injection strings in patient search fields.
  - *Fix*: Parameterized all SQLite prepared statements and validated Bearer tokens in auth middleware.
  - *Verification*: `tests/bug-hunter.js` 10/10 PASS.

---
**Current Bug Status**: 0 Open Priority-1/2/3 Bugs.
