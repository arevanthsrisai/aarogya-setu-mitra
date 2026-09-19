'use strict';

/* ABHA module tests — runnable with plain `node tests/abha-module.test.js`.
 * Assert-based, console PASS/FAIL, exit non-zero on failure.
 * Uses a tiny in-memory db stub (async prepare/get/run like db/pg-shim.js)
 * so it never depends on the SQLite->Postgres migration being finished. */

process.env.ABHA_MODE = 'mock';
process.env.ABHA_MOCK_LATENCY_MS = '5';
delete process.env.ABDM_CLIENT_ID;
delete process.env.ABDM_CLIENT_SECRET;

const assert = require('assert');
const express = require('express');

const { getAbhaProvider, resolveMode } = require('../src/abha/provider');
const { registerAbhaRoutes } = require('../src/abha/routes');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`[FAIL] ${name} - ${err.message}`);
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`[FAIL] ${name} - ${err.message}`);
  }
}

// ---- In-memory db stub (async shim shape) ---------------------------------
function makeDbStub() {
  const patients = new Map([
    ['p1', { id: 'p1', first_name: 'Test', last_name: 'Patient', abha_id: null }],
  ]);
  const audit = [];
  return {
    _patients: patients,
    _audit: audit,
    prepare(sql) {
      const s = String(sql);
      return {
        get: async (...params) => {
          if (/FROM patients/.test(s)) return patients.get(params[0]) || null;
          return null;
        },
        all: async () => [],
        run: async (...params) => {
          if (/UPDATE patients SET abha_id/.test(s)) {
            const p = patients.get(params[1]);
            if (p) p.abha_id = params[0];
            return { changes: p ? 1 : 0 };
          }
          if (/INSERT INTO audit_logs/.test(s)) {
            audit.push({ params });
            return { changes: 1 };
          }
          return { changes: 0 };
        },
      };
    },
  };
}

function makeApp(db, user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); }); // fake auth (app-level authMiddleware owns real auth)
  const router = express.Router();
  registerAbhaRoutes(router, db);
  app.use('/api', router);
  return app;
}

async function req(port, path, options = {}) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data };
}

async function main() {
  const db = makeDbStub();
  const user = { id: 'u1', role: 'ASHA' };
  const app = makeApp(db, user);
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 1. status (mock)
    await checkAsync('status reports mock mode', async () => {
      const r = await req(port, '/api/abha/status');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.provider, 'mock');
      assert.strictEqual(r.data.connected, true);
      assert.strictEqual(r.data.hasCredentials, false);
    });

    // 2. invalid aadhaar validation
    await checkAsync('invalid aadhaar rejected', async () => {
      const r = await req(port, '/api/abha/aadhaar/generate-otp', { method: 'POST', body: JSON.stringify({ aadhaar: '123' }) });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.data.code, 'INVALID_AADHAAR');
    });

    // 3. service-unavailable demo path (all 9s)
    await checkAsync('all-9s aadhaar simulates downtime', async () => {
      const r = await req(port, '/api/abha/aadhaar/generate-otp', { method: 'POST', body: JSON.stringify({ aadhaar: '999999999999' }) });
      assert.strictEqual(r.status, 503);
      assert.strictEqual(r.data.code, 'ABHA_SERVICE_UNAVAILABLE');
    });

    // 4. generate OTP
    let txnId;
    await checkAsync('generate-otp returns txnId + mockOtp', async () => {
      const r = await req(port, '/api/abha/aadhaar/generate-otp', { method: 'POST', body: JSON.stringify({ aadhaar: '123456789012' }) });
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.txnId, 'missing txnId');
      assert.strictEqual(r.data.mockOtp, '123456');
      txnId = r.data.txnId;
    });

    // 5. wrong OTP error
    await checkAsync('wrong OTP errors with OTP_MISMATCH', async () => {
      const r = await req(port, '/api/abha/aadhaar/verify-otp', { method: 'POST', body: JSON.stringify({ txnId, otp: '000000' }) });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.data.code, 'OTP_MISMATCH');
    });

    // 6. correct OTP completes
    let abhaNumber;
    let abhaAddress;
    await checkAsync('correct OTP (123456) completes with profile', async () => {
      const r = await req(port, '/api/abha/aadhaar/verify-otp', { method: 'POST', body: JSON.stringify({ txnId, otp: '123456' }) });
      assert.strictEqual(r.status, 200);
      assert.ok(/^27-\d{4}-\d{4}-\d{4}$/.test(r.data.abhaNumber), `bad abhaNumber: ${r.data.abhaNumber}`);
      assert.ok(/@abdm$/.test(r.data.abhaAddress), `bad abhaAddress: ${r.data.abhaAddress}`);
      assert.ok(r.data.abhaProfile && r.data.abhaProfile.name, 'missing profile name');
      assert.ok(r.data.abhaProfile.gender && r.data.abhaProfile.dob, 'missing profile fields');
      abhaNumber = r.data.abhaNumber;
      abhaAddress = r.data.abhaAddress;
    });

    // 7. profile endpoint
    await checkAsync('profile endpoint returns stored profile', async () => {
      const r = await req(port, `/api/abha/profile/${encodeURIComponent(abhaNumber)}`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.abhaNumber, abhaNumber);
    });

    // 8. QR endpoint
    await checkAsync('qr endpoint returns data-uri payload', async () => {
      const r = await req(port, `/api/abha/qr/${encodeURIComponent(abhaNumber)}`);
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.qrImage && r.data.qrImage.startsWith('data:image/svg+xml;base64,'), 'bad qrImage');
      assert.ok(r.data.qrPayload && r.data.qrPayload.includes(abhaNumber), 'bad qrPayload');
    });

    // 9. card endpoint
    await checkAsync('card endpoint returns card JSON', async () => {
      const r = await req(port, `/api/abha/card/${encodeURIComponent(abhaNumber)}`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.abhaNumber, abhaNumber);
      assert.strictEqual(r.data.abhaAddress, abhaAddress);
      assert.ok(r.data.name && r.data.status === 'ACTIVE', 'bad card fields');
    });

    // 10. link-patient persists + patient lookup
    await checkAsync('link-patient persists abha_id', async () => {
      const r = await req(port, '/api/abha/link-patient', { method: 'POST', body: JSON.stringify({ patientId: 'p1', abhaNumber, abhaAddress }) });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.patient.abha_id, abhaNumber);
      assert.strictEqual(db._patients.get('p1').abha_id, abhaNumber);
      const g = await req(port, '/api/abha/patient/p1');
      assert.strictEqual(g.status, 200);
      assert.strictEqual(g.data.linked, true);
      assert.strictEqual(g.data.abhaId, abhaNumber);
    });

    // 11. RBAC: caregiver cannot link
    await checkAsync('link-patient RBAC blocks CAREGIVER', async () => {
      const app2 = makeApp(db, { id: 'u2', role: 'CAREGIVER' });
      const s2 = app2.listen(0);
      try {
        const r = await req(s2.address().port, '/api/abha/link-patient', { method: 'POST', body: JSON.stringify({ patientId: 'p1', abhaNumber }) });
        assert.strictEqual(r.status, 403);
      } finally { s2.close(); }
    });

    // 12. expired txn
    await checkAsync('expired txn rejected', async () => {
      process.env.ABHA_MOCK_TXN_TTL_MS = '10';
      const g = await req(port, '/api/abha/aadhaar/generate-otp', { method: 'POST', body: JSON.stringify({ aadhaar: '234567890123' }) });
      assert.strictEqual(g.status, 200);
      await new Promise((r) => setTimeout(r, 40));
      const v = await req(port, '/api/abha/aadhaar/verify-otp', { method: 'POST', body: JSON.stringify({ txnId: g.data.txnId, otp: '123456' }) });
      assert.strictEqual(v.status, 410);
      assert.strictEqual(v.data.code, 'TXN_EXPIRED');
      delete process.env.ABHA_MOCK_TXN_TTL_MS;
    });

    // 13. sandbox falls back to mock when credentials missing
    check('sandbox without creds falls back to mock', () => {
      process.env.ABHA_MODE = 'sandbox';
      for (const k of Object.keys(require.cache)) {
        if (k.includes('src\\abha') || k.includes('src/abha')) delete require.cache[k];
      }
      const fresh = require('../src/abha/provider');
      assert.strictEqual(fresh.resolveMode(), 'sandbox');
      const p = fresh.getAbhaProvider();
      assert.strictEqual(p.mode, 'mock');
      assert.ok(p.fallback && p.fallback.reason.includes('ABDM_CLIENT_ID'));
      process.env.ABHA_MODE = 'mock';
      for (const k of Object.keys(require.cache)) {
        if (k.includes('src\\abha') || k.includes('src/abha')) delete require.cache[k];
      }
    });

    // 14. no secrets leak in responses
    await checkAsync('responses never leak secrets', async () => {
      const bodies = [];
      const r1 = await req(port, '/api/abha/status');
      const r2 = await req(port, `/api/abha/card/${encodeURIComponent(abhaNumber)}`);
      bodies.push(JSON.stringify(r1.data), JSON.stringify(r2.data));
      for (const b of bodies) {
        assert.ok(!/clientSecret|ABHA_RSA|BEGIN PUBLIC KEY|accessToken/i.test(b) || /mock-access-token/.test(b) === false, 'secret leak');
      }
      assert.ok(!JSON.stringify(r2.data).includes('mock-access-token'));
    });
  } finally {
    server.close();
  }

  console.log(`\nABHA MODULE: ${passed} PASSED, ${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test harness error:', err);
  process.exit(1);
});
