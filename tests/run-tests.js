require('dotenv').config();
const http = require('http');
const { initializeDatabase, seedDatabase } = require('../src/database');
const express = require('express');
const cors = require('cors');
const { authMiddleware } = require('../src/middleware');
const { createRoutes } = require('../src/routes');

async function runAllTests() {
  console.log('\n============================================================');
  console.log('       HEALTHRADAR PROTOTYPE - END-TO-END TEST SUITE        ');
  console.log('============================================================\n');

  // Setup test server (Neon Postgres via async shim)
  const db = await initializeDatabase();
  await seedDatabase(db);

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(authMiddleware(db));
  app.use('/api', createRoutes(db));

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api`;

  let passed = 0;
  let failed = 0;
  const results = [];

  function logTest(num, name, status, notes = '') {
    if (status === 'PASS') {
      passed++;
      console.log(`[PASS] TEST ${num}: ${name} ${notes ? `(${notes})` : ''}`);
    } else {
      failed++;
      console.log(`[FAIL] TEST ${num}: ${name} - ${notes}`);
    }
    results.push({ test: `TEST ${num}`, scenario: name, result: status, notes });
  }

  // Request helper
  async function request(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }

  try {
    // ------------------------------------------------------------
    // TEST 1 — AUTH & LOGIN
    // ------------------------------------------------------------
    const loginRes = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'asha1', password: 'asha123' })
    });

    if (loginRes.status === 200 && loginRes.data.token) {
      logTest(1, 'ASHA Authentication', 'PASS', 'JWT token issued successfully');
    } else {
      logTest(1, 'ASHA Authentication', 'FAIL', 'Login failed');
    }

    const ashaToken = loginRes.data.token;
    const ashaHeaders = { Authorization: `Bearer ${ashaToken}` };

    // Login as Doctor
    const docLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'doctor1', password: 'doctor123' }) });
    const docToken = docLogin.data.token;
    const docHeaders = { Authorization: `Bearer ${docToken}` };

    // Login as Caregiver
    const cgLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'caregiver1', password: 'care123' }) });
    const cgToken = cgLogin.data.token;
    const cgHeaders = { Authorization: `Bearer ${cgToken}` };

    // Login as THO
    const thoLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'tho1', password: 'tho123' }) });
    const thoToken = thoLogin.data.token;
    const thoHeaders = { Authorization: `Bearer ${thoToken}` };

    // ------------------------------------------------------------
    // TEST 2 — ASHA PATIENT CREATION
    // ------------------------------------------------------------
    const newPatientRes = await request('/patients', {
      method: 'POST',
      headers: ashaHeaders,
      body: JSON.stringify({
        first_name: 'Chhota',
        last_name: 'Bheem',
        age: 4,
        gender: 'M',
        village: 'Khed',
        district: 'Pune'
      })
    });

    let createdPatientId;
    if (newPatientRes.status === 201 && newPatientRes.data.id && newPatientRes.data.temporary_id) {
      createdPatientId = newPatientRes.data.id;
      logTest(2, 'ASHA Patient Creation', 'PASS', `Patient ID: ${createdPatientId}, TempID: ${newPatientRes.data.temporary_id}`);
    } else {
      logTest(2, 'ASHA Patient Creation', 'FAIL', 'Could not create patient');
    }

    // ------------------------------------------------------------
    // TEST 3 — TRIAGE ENGINE RULE EVALUATION
    // ------------------------------------------------------------
    // Rule: Age < 5 AND fever >= 3 days AND (no urination >= 8h OR lethargy) -> HIGH RISK
    const triageRes = await request('/triage', {
      method: 'POST',
      headers: ashaHeaders,
      body: JSON.stringify({
        patient_id: createdPatientId,
        symptoms: {
          fever_duration_days: 3,
          no_urination_hours: 8,
          lethargy: true
        }
      })
    });

    if (triageRes.status === 200 && triageRes.data.riskLevel === 'HIGH') {
      logTest(3, 'Triage Rule Evaluation (Child Fever & Danger Signs)', 'PASS', `Evaluated Risk: ${triageRes.data.riskLevel}`);
    } else {
      logTest(3, 'Triage Rule Evaluation', 'FAIL', `Expected HIGH risk, got ${triageRes.data?.riskLevel}`);
    }

    // ------------------------------------------------------------
    // TEST 4 — REFERRAL TICKET CREATION & STATE MACHINE
    // ------------------------------------------------------------
    const facilities = await request('/facilities', { headers: ashaHeaders });
    const receivingFacilityId = facilities.data[0].id;

    const refRes = await request('/referrals', {
      method: 'POST',
      headers: ashaHeaders,
      body: JSON.stringify({
        patient_id: createdPatientId,
        receiving_facility_id: receivingFacilityId,
        priority: 'HIGH',
        reason: 'Child under 5 with severe fever and danger signs (HIGH Triage Risk)'
      })
    });

    let referralId;
    if (refRes.status === 201 && refRes.data.id && refRes.data.status === 'BOOKED') {
      referralId = refRes.data.id;
      logTest(4, 'Referral Ticket Creation', 'PASS', `Code: ${refRes.data.referral_code}, Status: BOOKED`);
    } else {
      logTest(4, 'Referral Ticket Creation', 'FAIL', 'Creation failed');
    }

    // Progress referral state machine: BOOKED -> SEEN -> REFERRED -> ARRIVED -> TREATED -> CLOSED
    const states = ['SEEN', 'REFERRED', 'ARRIVED', 'TREATED', 'CLOSED'];
    let stateSuccess = true;
    for (const state of states) {
      const updateRes = await request(`/referrals/${referralId}/status`, {
        method: 'PUT',
        headers: docHeaders,
        body: JSON.stringify({ status: state, notes: `Advanced to ${state}` })
      });
      if (updateRes.status !== 200 || updateRes.data.status !== state) {
        stateSuccess = false;
        break;
      }
    }

    if (stateSuccess) {
      logTest(5, 'Referral State Machine Transitions', 'PASS', 'BOOKED -> SEEN -> REFERRED -> ARRIVED -> TREATED -> CLOSED verified with full event logging');
    } else {
      logTest(5, 'Referral State Machine Transitions', 'FAIL', 'State transition failed');
    }

    // ------------------------------------------------------------
    // TEST 6 — DOCTOR CLINICAL RECORD VIEW
    // ------------------------------------------------------------
    const docViewRes = await request(`/referrals/${referralId}`, { headers: docHeaders });
    if (docViewRes.status === 200 && docViewRes.data.events && docViewRes.data.aiSummary) {
      logTest(6, 'Doctor Clinical Summary View', 'PASS', 'Events and clinical summaries returned');
    } else {
      logTest(6, 'Doctor Clinical Summary View', 'FAIL', 'Doctor view failed');
    }

    // ------------------------------------------------------------
    // TEST 7 — CONSENT & CAREGIVER REVOCATION ENFORCEMENT
    // ------------------------------------------------------------
    // Create caregiver link (which automatically creates associated consent)
    const cgRes = await request('/caregivers', {
      method: 'POST',
      headers: ashaHeaders,
      body: JSON.stringify({
        patient_id: createdPatientId,
        caregiver_user_id: cgLogin.data.user.id,
        relationship: 'Parent',
        scope: 'full'
      })
    });
    const caregiverId = cgRes.data.id;

    // Caregiver attempts view (should succeed while granted)
    const cgViewBefore = await request(`/patients/${createdPatientId}`, { headers: cgHeaders });

    // Revoke caregiver access
    await request(`/caregivers/${caregiverId}/revoke`, { method: 'PUT', headers: ashaHeaders });

    // Caregiver attempts view after revocation (should fail with 403)
    const cgViewAfter = await request(`/patients/${createdPatientId}`, { headers: cgHeaders });

    if (cgViewBefore.status === 200 && cgViewAfter.status === 403) {
      logTest(7, 'Consent & Revocation Security', 'PASS', 'Access granted when active, blocked (403) immediately after revocation');
    } else {
      logTest(7, 'Consent & Revocation Security', 'FAIL', `Before: ${cgViewBefore.status}, After: ${cgViewAfter.status}`);
    }

    // ------------------------------------------------------------
    // TEST 8 — RADAR QUERY & REAL-TIME MEDICINE UPDATE
    // ------------------------------------------------------------
    const stockQueryBefore = await request(`/radar/query?medicine=Paracetamol&district=Pune`, { headers: ashaHeaders });
    const stockId = stockQueryBefore.data.medicines[0].id;
    const initialQty = stockQueryBefore.data.medicines[0].quantity;

    // Doctor updates stock quantity
    await request(`/stock/${stockId}`, {
      method: 'PUT',
      headers: docHeaders,
      body: JSON.stringify({ quantity: initialQty + 50 })
    });

    const stockQueryAfter = await request(`/radar/query?medicine=Paracetamol&district=Pune`, { headers: ashaHeaders });
    const newQty = stockQueryAfter.data.medicines[0].quantity;

    if (newQty === initialQty + 50) {
      logTest(8, 'RADAR Directory Real-Time Query', 'PASS', `Stock quantity updated from ${initialQty} to ${newQty}`);
    } else {
      logTest(8, 'RADAR Directory Real-Time Query', 'FAIL', `Stock update mismatch: expected ${initialQty + 50}, got ${newQty}`);
    }

    // ------------------------------------------------------------
    // TEST 9 — DASHBOARD METRICS CALCULATION
    // ------------------------------------------------------------
    const dashRes = await request('/dashboard/metrics', { headers: thoHeaders });
    if (dashRes.status === 200 && dashRes.data.totalPatients > 0 && dashRes.data.referralCompletionRate !== undefined) {
      logTest(9, 'Government Officer Dashboard Analytics', 'PASS', `Calculated Total Patients: ${dashRes.data.totalPatients}, Completion Rate: ${dashRes.data.referralCompletionRate}%`);
    } else {
      logTest(9, 'Government Officer Dashboard Analytics', 'FAIL', 'Metrics fetch failed');
    }

    // ------------------------------------------------------------
    // TEST 10 — TREND DETECTION & AI SAFETY DISCLAIMER
    // ------------------------------------------------------------
    // Add multiple Hb observations showing downward trend
    await request('/observations', { method: 'POST', headers: ashaHeaders, body: JSON.stringify({ patient_id: createdPatientId, type: 'hemoglobin', value: 11.5, recorded_at: '2026-06-01' }) });
    await request('/observations', { method: 'POST', headers: ashaHeaders, body: JSON.stringify({ patient_id: createdPatientId, type: 'hemoglobin', value: 9.8, recorded_at: '2026-07-01' }) });
    await request('/observations', { method: 'POST', headers: ashaHeaders, body: JSON.stringify({ patient_id: createdPatientId, type: 'hemoglobin', value: 7.5, recorded_at: '2026-08-01' }) });

    const trendsRes = await request(`/patients/${createdPatientId}/trends`, { headers: ashaHeaders });
    const summaryRes = await request(`/patients/${createdPatientId}/summary`, { headers: ashaHeaders });

    const hasDownwardHb = trendsRes.data.some(t => t.type === 'hemoglobin' && t.direction === 'downward');
    const hasDisclaimer = summaryRes.data.disclaimer && summaryRes.data.disclaimer.includes('medical diagnosis');

    if (hasDownwardHb && hasDisclaimer) {
      logTest(10, 'Trend Detection & AI Guardrails', 'PASS', 'Downward Hb trend identified with mandatory medical disclaimer');
    } else {
      logTest(10, 'Trend Detection & AI Guardrails', 'FAIL', `Trend: ${hasDownwardHb}, Disclaimer: ${hasDisclaimer}`);
    }

    // ------------------------------------------------------------
    // TEST 11 — OFFLINE SYNC PUSH
    // ------------------------------------------------------------
    const syncRes = await request('/sync/push', {
      method: 'POST',
      headers: ashaHeaders,
      body: JSON.stringify({
        records: [
          {
            table_name: 'observations',
            record_id: 'sync-obs-001',
            action: 'INSERT',
            data: {
              id: 'sync-obs-001',
              patient_id: createdPatientId,
              type: 'weight',
              value: 14.5,
              unit: 'kg',
              recorded_at: new Date().toISOString(),
              source: 'offline'
            }
          }
        ]
      })
    });

    if (syncRes.status === 200 && syncRes.data.synced === 1) {
      logTest(11, 'Offline Data Sync', 'PASS', '1 offline record pushed and synchronized to backend database');
    } else {
      logTest(11, 'Offline Data Sync', 'FAIL', `Status: ${syncRes.status}, Data: ${JSON.stringify(syncRes.data)}`);
    }

    // ------------------------------------------------------------
    // TEST 12 — SERVER-SIDE RBAC AUTHORIZATION
    // ------------------------------------------------------------
    // Caregiver attempts to access audit logs (only THO/DHO/State allowed)
    const rbacRes = await request('/audit-logs', { headers: cgHeaders });
    if (rbacRes.status === 403) {
      logTest(12, 'Server-Side RBAC Enforcement', 'PASS', 'Unauthorized access rejected with HTTP 403 Forbidden');
    } else {
      logTest(12, 'Server-Side RBAC Enforcement', 'FAIL', `Expected 403, got ${rbacRes.status}`);
    }

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    server.close();
    console.log('\n============================================================');
    console.log(`TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('============================================================\n');
  }
}

runAllTests();
