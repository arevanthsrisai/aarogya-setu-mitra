require('dotenv').config();
const { initializeDatabase, seedDatabase } = require('../src/database');
const express = require('express');
const cors = require('cors');
const { authMiddleware } = require('../src/middleware');
const { createRoutes } = require('../src/routes');

async function runBugHunterSuite() {
  console.log('\n============================================================');
  console.log('       HEALTHRADAR AUTOMATED BUG-HUNTING & STRESS SUITE     ');
  console.log('============================================================\n');

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

  function assertTest(name, condition, notes = '') {
    if (condition) {
      passed++;
      console.log(`[PASS] ${name} ${notes ? `(${notes})` : ''}`);
    } else {
      failed++;
      console.log(`[FAIL] ${name} - ${notes}`);
    }
  }

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
    try { data = JSON.parse(text); } catch(e) { data = text; }
    return { status: res.status, data };
  }

  try {
    // Authenticate roles
    const ashaToken = (await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'asha1', password: 'asha123' }) })).data.token;
    const docToken = (await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'doctor1', password: 'doctor123' }) })).data.token;
    const cgToken = (await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'caregiver1', password: 'care123' }) })).data.token;

    const ashaHead = { Authorization: `Bearer ${ashaToken}` };
    const docHead = { Authorization: `Bearer ${docToken}` };
    const cgHead = { Authorization: `Bearer ${cgToken}` };

    // 1. Invalid JSON / Empty login
    const badLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({}) });
    assertTest('Bug Check 1: Empty Login Handling', badLogin.status === 400);

    // 2. Wrong Password
    const wrongPass = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'asha1', password: 'wrongpassword' }) });
    assertTest('Bug Check 2: Invalid Credentials Handling', wrongPass.status === 401);

    // 3. Malformed JWT Token
    const badTokenRes = await request('/patients', { headers: { Authorization: 'Bearer invalid.jwt.token' } });
    assertTest('Bug Check 3: Malformed JWT Rejection', badTokenRes.status === 401);

    // 4. SQL Injection in Patient Search
    const sqlInjRes = await request("/patients?search=" + encodeURIComponent("' OR 1=1 --"), { headers: ashaHead });
    assertTest('Bug Check 4: SQL Injection Safety in Search', sqlInjRes.status === 200 && Array.isArray(sqlInjRes.data));

    // 5. Special Characters in Patient Name (e.g. O'Connor, <script>)
    const xssPatient = await request('/patients', {
      method: 'POST',
      headers: ashaHead,
      body: JSON.stringify({
        first_name: "<script>alert('xss')</script>",
        last_name: "O'Connor",
        age: 25,
        gender: 'F',
        village: "Wadgaon"
      })
    });
    assertTest('Bug Check 5: Special Characters & Quotes Handling', xssPatient.status === 201 && xssPatient.data.id);

    // 6. Non-existent Patient ID
    const notFoundPatient = await request('/patients/non-existent-uuid-12345', { headers: ashaHead });
    assertTest('Bug Check 6: Non-Existent Patient 404', notFoundPatient.status === 404);

    // 7. Illegal State Machine Jump (BOOKED directly to TREATED)
    const pat = xssPatient.data;
    const fac = (await request('/facilities', { headers: ashaHead })).data[0];
    const ref = (await request('/referrals', {
      method: 'POST',
      headers: ashaHead,
      body: JSON.stringify({ patient_id: pat.id, receiving_facility_id: fac.id, reason: 'Testing illegal transition' })
    })).data;

    const illegalJump = await request(`/referrals/${ref.id}/status`, {
      method: 'PUT',
      headers: docHead,
      body: JSON.stringify({ status: 'TREATED' })
    });
    assertTest('Bug Check 7: Illegal Referral Transition Prevention', illegalJump.status === 400);

    // 8. Legal State Machine Transition (BOOKED to SEEN)
    const legalTransition = await request(`/referrals/${ref.id}/status`, {
      method: 'PUT',
      headers: docHead,
      body: JSON.stringify({ status: 'SEEN' })
    });
    assertTest('Bug Check 8: Valid Referral Transition Processing', legalTransition.status === 200 && legalTransition.data.status === 'SEEN');

    // 9. Stock Update boundary values (Negative/Zero stock)
    const stockList = (await request(`/facilities/${fac.id}/stock`, { headers: docHead })).data;
    if (stockList.length > 0) {
      const updateStock = await request(`/stock/${stockList[0].id}`, {
        method: 'PUT',
        headers: docHead,
        body: JSON.stringify({ quantity: 0 })
      });
      assertTest('Bug Check 9: Out-of-Stock Status Calculation', updateStock.status === 200 && updateStock.data.status === 'OUT_OF_STOCK');
    }

    // 10. Triage Rule Evaluation with empty symptoms
    const emptyTriage = await request('/triage', {
      method: 'POST',
      headers: ashaHead,
      body: JSON.stringify({ patient_id: pat.id, symptoms: {} })
    });
    assertTest('Bug Check 10: Triage Fallback for Empty Symptoms', emptyTriage.status === 200 && emptyTriage.data.riskLevel === 'LOW');

  } catch (err) {
    console.error('Bug hunter execution error:', err);
  } finally {
    server.close();
    console.log('\n============================================================');
    console.log(`BUG HUNTER SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('============================================================\n');
  }
}

runBugHunterSuite();
