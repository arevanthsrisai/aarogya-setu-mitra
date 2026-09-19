# Session Handoff — Aarogya Setu Mitra (paused for laptop restart)

Resume point for the next opencode session. Read this first.

## Project
- Path: `C:\Users\Revanth\Desktop\SIH\prototype`
- Goal: full-stack prototype (Express 5 + SQLite currently) of Aarogya Setu Mitra healthcare platform; Neon Postgres migration + ABHA V3 integration are the two mandated additions. SPEED is primary constraint (P0 must work → P1 core demo → P2 → P3 → P4).

## Done so far
1. **Phase 0 audit complete.** Existing prototype: Express 5, better-sqlite3 (SQLite `./data/app.db`), JWT+RBAC (`src/middleware.js`), business logic (`src/services.js`), all API routes (`src/routes.js`, ~54KB), vanilla JS SPA (`public/app.js` ~120KB + `style.css` glassmorphism), Groq AI server-side (`src/groqClient.js`), OCR, offline sync push, FHIR R4, audit logs, consents, caregivers, ANC/HBNC, radar, dashboard, Playwright e2e specs (tests/e2e/), key-leak check (scripts/check-key-leak.js). See `AUDIT.md` for full inventory.
2. **Existing tests pass as-is: 12/12 integration scenarios** (`node tests/run-tests.js`). NOTE: Groq key in `.env` is EXPIRED (401 expired_api_key) — AI gracefully falls back to deterministic summaries server-side (existing correct behavior).
3. **ABDM PDF read → internal reference written**: `docs/abha-v3-integrator-reference.md` (123-page guide fully processed). Key facts:
   - SBX base: `https://abhasbx.abdm.gov.in/abha/api`, PROD: `https://abha.abdm.gov.in/api/abha`
   - Session: `POST https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions` `{clientId, clientSecret}` → `accessToken` (JWT, expiresIn 1200s)
   - Encryption: RSA/ECB/OAEPWithSHA-1AndMGF1Padding → node:crypto `publicEncrypt` with `RSA_PKCS1_OAEP_PADDING` + `oaepHash:'sha1'`, base64 out. RSA public key NOT in PDF — must come from ABDM onboarding (mock provider default).
   - Headers: `Authorization: Token <AT>`; `X-token: Bearer` on profile endpoints (profile/QR/card).
   - Ambiguities flagged in the doc: base_url/env_url inconsistent; RSA key external; 7.5 scope string; linkAndDelink body.

## Neon state
- Neon project CREATED: **`aarogya-setu-mitra`**, project_id **`ancient-wind-04145311`** (org `org-raspy-grass-00565000`, aws-us-west-2, pg 17). No connection string fetched yet — call `Neon_get_connection_string` with that project_id next. Also pre-existing project "icmr" (`dark-violet-81525182`) — unrelated, do not touch.

## Architecture decisions made (speed-first)
- **DB strategy**: keep all routes SQL, swap better-sqlite3 for `pg` behind a thin better-sqlite3-compatible adapter shim (`prepare().run/get/all`, `?` → `$n` placeholder conversion, transactions). SQLite-specific syntax found and must be fixed (57 matches):
  - `database.js`: `pragma` lines (2), ~30x `DEFAULT (datetime('now'))` → `DEFAULT (NOW())`, `INSERT OR REPLACE` (translations).
  - `routes.js`: ~25x `datetime('now')` in SET/clauses → `NOW()`; `datetime(created_at, '+N hours')` → `created_at + interval`; `INSERT OR REPLACE` (sync push, line 1004).
  - `services.js`: 1x `expires_at > datetime('now')` → `NOW()`.
- **ABHA**: `src/abha/` module: provider interface + MockABHAProvider (default) + SandboxABHAProvider (real HTTP per reference doc), env switch `ABHA_MODE=mock|sandbox|production`, routes under `/api/abha/*`, UI flow in SPA. Never expose clientId/clientSecret to browser.
- **Do NOT rewrite** working code: services.js logic, routes structure, existing tests, app.js mostly intact — add ABHA views + admin/facility management views.

## Next steps (resume here, in order)
1. `Neon_get_connection_string` (project `ancient-wind-04145311`) → put into `.env` as `DATABASE_URL` (NOT committed).
2. Delegate **database-engineer**: Postgres schema+migration+seed rewrite of `src/database.js` + DB adapter shim (owns src/database.js, package.json add `pg`). Migrations as plain SQL files, seed synthetic demo data, verify with Neon MCP (`Neon_describe_table_schema`, run_sql).
3. Delegate **backend-engineer**: update `src/routes.js`/`services.js` SQL to Postgres-compatible (list above), rerun tests (`node tests/run-tests.js`).
4. Delegate **backend-engineer**: ABHA module per `docs/abha-v3-integrator-reference.md` (owns src/abha/, src/routes.js ABHA section — sequence after step 3 or give clear file-section ownership).
5. Delegate **frontend-engineer**: ABHA UX views + facility/admin management + professional healthcare styling polish in `public/` (owns public/).
6. **security-auditor** review; **verification-agent** run all tests; **e2e** browser test of primary demo path (ASHA login → patient → triage → referral → doctor → treatment → close → citizen/radar → dashboard).
7. Graphify init (`graphify .`) — never initialized yet; update after major phases.
8. Deployment docs (Render/Railway-style free Node host + Neon), README, `.env.example` update.
9. Final live demo + report.

## Environment notes
- Shell: PowerShell 5.1, no `rg` in PATH (use the grep tool). Working dir is a git repo; nothing committed this session.
- Playwright: use MCP tools (primary) or playwright-cli with `--browser=msedge` (Chrome not installed).
- Task-agent harness had one transient failure (`Not Found`) for architecture-analyst — retry works.
