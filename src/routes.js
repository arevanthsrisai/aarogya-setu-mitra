const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { requireRole, auditLog } = require('./middleware');
const {
  runTriage, detectTrends, generatePatientSummary,
  canTransition, checkConsent, queryRadar, getDashboardMetrics,
  toFHIRPatient, toFHIRObservation, toFHIREncounter, toFHIRCondition, toFHIRServiceRequest,
  toFHIRImmunization, toFHIRMedication
} = require('./services');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const {
  MANDATORY_DISCLAIMER,
  summarizeHealthRecord,
  compareReports,
  generatePatientExplanation,
  translateText,
  transcribeAudio,
  chatWithMitra
} = require('./groqClient');

function createRoutes(db) {
  const router = express.Router();

  // ==================== AUTH ====================
  router.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = await db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '24h' });
    const refreshToken = jwt.sign({ userId: user.id, type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    await auditLog(db, user.id, 'LOGIN', 'user', user.id, { username }, req.ip);

    res.json({
      token,
      refreshToken,
      user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, facility_id: user.facility_id, language: user.language }
    });
  });

  router.get('/auth/me', async (req, res) => {
    res.json({ user: req.user });
  });

  router.post('/auth/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
    try {
      const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
      if (decoded.type !== 'refresh') return res.status(401).json({ error: 'Invalid refresh token' });
      const user = await db.prepare('SELECT id, username, full_name, role, facility_id, language FROM users WHERE id = ? AND active = 1').get(decoded.userId);
      if (!user) return res.status(401).json({ error: 'User not found or inactive' });
      const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '24h' });
      res.json({ token, user });
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
  });

  // Pagination helper: ?limit (default 100, max 500) &offset (default 0)
  function pageParams(req) {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    return { limit, offset };
  }

  // ponytail: role-only gate, no per-patient ownership scoping — add patient-level checks if finer control matters.
  const requirePhiRead = requireRole('ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'FACILITY_STAFF');

  // ==================== PATIENTS ====================
  router.get('/patients', requireRole('ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'THO', 'DHO', 'STATE_MSIS'), async (req, res) => {
    const { search, village, household_id } = req.query;
    let query = 'SELECT * FROM patients WHERE 1=1';
    const params = [];
    if (search) { query += ' AND (first_name ILIKE ? OR last_name ILIKE ? OR temporary_id ILIKE ? OR abha_id ILIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    if (village) { query += ' AND village = ?'; params.push(village); }
    if (household_id) { query += ' AND household_id = ?'; params.push(household_id); }
    const { limit, offset } = pageParams(req);
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    res.json(await db.prepare(query).all(...params, limit, offset));
  });

  router.get('/patients/:id', async (req, res) => {
    const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Check consent for non-clinical roles or caregivers
    if (req.user.role === 'CAREGIVER') {
      const caregiver = await db.prepare('SELECT * FROM caregivers WHERE caregiver_user_id = ? AND patient_id = ? AND active = 1').get(req.user.id, patient.id);
      if (!caregiver) return res.status(403).json({ error: 'No active caregiver access to this patient' });

      const consentCheck = await checkConsent(db, patient.id, req.user.id, 'selected_records');
      if (!consentCheck.allowed) return res.status(403).json({ error: consentCheck.reason });
    }

    await auditLog(db, req.user.id, 'VIEW_PATIENT', 'patient', patient.id, {}, req.ip);
    res.json(patient);
  });

  router.post('/patients', requireRole('ASHA', 'ANM', 'PHC_DOCTOR'), async (req, res) => {
    const { first_name, last_name, date_of_birth, age, gender, phone, village, district, state, address, household_id, abha_id, blood_group, allergies } = req.body;
    if (!first_name) return res.status(400).json({ error: 'First name required' });

    const id = uuidv4();
    const temporary_id = 'TMP-' + Date.now().toString(36).toUpperCase();

    await db.prepare(`
      INSERT INTO patients (id, abha_id, temporary_id, first_name, last_name, date_of_birth, age, gender, phone, village, district, state, address, household_id, blood_group, allergies, registered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, abha_id || null, temporary_id, first_name, last_name || null, date_of_birth || null, age || null, gender || null, phone || null, village || null, district || null, state || null, address || null, household_id || null, blood_group || null, allergies || null, req.user.id);

    await auditLog(db, req.user.id, 'CREATE_PATIENT', 'patient', id, { first_name, temporary_id }, req.ip);
    const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
    res.status(201).json(patient);
  });

  router.put('/patients/:id', requireRole('ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR'), async (req, res) => {
    const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const fields = ['first_name', 'last_name', 'date_of_birth', 'age', 'gender', 'phone', 'village', 'district', 'state', 'address', 'household_id', 'abha_id', 'blood_group', 'allergies'];
    const updates = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(req.body[f]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    updates.push("updated_at = NOW()");
    params.push(req.params.id);
    await db.prepare(`UPDATE patients SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    await auditLog(db, req.user.id, 'UPDATE_PATIENT', 'patient', req.params.id, { fields: Object.keys(req.body) }, req.ip);
    res.json(await db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id));
  });

  // ==================== HOUSEHOLDS ====================
  router.get('/households', requireRole('ASHA', 'ANM', 'PHC_DOCTOR'), async (req, res) => {
    const { limit, offset } = pageParams(req);
    res.json(await db.prepare('SELECT * FROM households ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset));
  });

  router.post('/households', requireRole('ASHA', 'ANM'), async (req, res) => {
    const { head_name, address, village, district, num_members, socioeconomic_status, water_source, sanitation_type } = req.body;
    const id = uuidv4();
    await db.prepare('INSERT INTO households (id, head_name, address, village, district, num_members, socioeconomic_status, water_source, sanitation_type) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, head_name, address, village, district, num_members || 0, socioeconomic_status, water_source, sanitation_type);
    res.status(201).json(await db.prepare('SELECT * FROM households WHERE id = ?').get(id));
  });

  // ==================== ENCOUNTERS ====================
  router.get('/patients/:patientId/encounters', requirePhiRead, async (req, res) => {
    res.json(await db.prepare('SELECT * FROM encounters WHERE patient_id = ? ORDER BY date DESC').all(req.params.patientId));
  });

  router.post('/encounters', requireRole('ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR'), async (req, res) => {
    const { patient_id, type, location, notes, facility_id } = req.body;
    if (!patient_id || !type) return res.status(400).json({ error: 'patient_id and type required' });
    const id = uuidv4();
    await db.prepare('INSERT INTO encounters (id, patient_id, type, worker_id, facility_id, location, notes) VALUES (?,?,?,?,?,?,?)')
      .run(id, patient_id, type, req.user.id, facility_id || req.user.facility_id, location, notes);
    await auditLog(db, req.user.id, 'CREATE_ENCOUNTER', 'encounter', id, { patient_id, type }, req.ip);
    res.status(201).json(await db.prepare('SELECT * FROM encounters WHERE id = ?').get(id));
  });

  // ==================== OBSERVATIONS ====================
  router.get('/patients/:patientId/observations', requirePhiRead, async (req, res) => {
    const { type } = req.query;
    let query = 'SELECT * FROM observations WHERE patient_id = ?';
    const params = [req.params.patientId];
    if (type) { query += ' AND type = ?'; params.push(type); }
    query += ' ORDER BY recorded_at DESC';
    res.json(await db.prepare(query).all(...params));
  });

  router.post('/observations', requireRole('ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR'), async (req, res) => {
    const { patient_id, encounter_id, type, value, value_text, unit, recorded_at, source } = req.body;
    if (!patient_id || !type) return res.status(400).json({ error: 'patient_id and type required' });

    // Check prior observation for AI trend comparison
    const priorObs = await db.prepare('SELECT * FROM observations WHERE patient_id = ? AND type = ? ORDER BY recorded_at DESC LIMIT 1').get(patient_id, type);

    const id = uuidv4();
    await db.prepare('INSERT INTO observations (id, patient_id, encounter_id, type, value, value_text, unit, recorded_at, source) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, patient_id, encounter_id || null, type, value || null, value_text || null, unit || null, recorded_at || new Date().toISOString(), source || 'manual');

    // Execute AI report comparison if prior observation exists
    if (priorObs && priorObs.value !== null && value !== null) {
      try {
        const trendDescription = await compareReports(priorObs.value, value, type, req.user.id);
        const alertId = uuidv4();
        await db.prepare('INSERT INTO alerts (id, patient_id, type, severity, title, message, requires_review) VALUES (?,?,?,?,?,?,?)')
          .run(alertId, patient_id, 'TREND_ALERT', 'WARNING', `AI Trend Alert: ${type}`, trendDescription, 1);
      } catch (err) {
        console.warn('AI report comparison background error:', err.message);
      }
    }

    res.status(201).json(await db.prepare('SELECT * FROM observations WHERE id = ?').get(id));
  });

  // ==================== CONDITIONS ====================
  router.get('/patients/:patientId/conditions', requirePhiRead, async (req, res) => {
    res.json(await db.prepare('SELECT * FROM conditions WHERE patient_id = ? ORDER BY created_at DESC').all(req.params.patientId));
  });

  router.post('/conditions', requireRole('PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'ANM'), async (req, res) => {
    const { patient_id, code, display_name, status, onset_date, severity, notes } = req.body;
    if (!patient_id || !display_name) return res.status(400).json({ error: 'patient_id and display_name required' });
    const id = uuidv4();
    await db.prepare('INSERT INTO conditions (id, patient_id, code, display_name, status, onset_date, severity, notes) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, patient_id, code, display_name, status || 'active', onset_date, severity, notes);
    res.status(201).json(await db.prepare('SELECT * FROM conditions WHERE id = ?').get(id));
  });

  // ==================== MEDICATIONS ====================
  router.get('/patients/:patientId/medications', requirePhiRead, async (req, res) => {
    res.json(await db.prepare('SELECT * FROM medications WHERE patient_id = ? ORDER BY created_at DESC').all(req.params.patientId));
  });

  router.post('/medications', requireRole('PHC_DOCTOR', 'HOSPITAL_DOCTOR'), async (req, res) => {
    const { patient_id, medication_name, dosage, frequency, route, start_date, end_date } = req.body;
    if (!patient_id || !medication_name) return res.status(400).json({ error: 'patient_id and medication_name required' });
    const id = uuidv4();
    await db.prepare('INSERT INTO medications (id, patient_id, medication_name, dosage, frequency, route, start_date, end_date, prescribed_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, patient_id, medication_name, dosage, frequency, route, start_date, end_date, req.user.id);
    res.status(201).json(await db.prepare('SELECT * FROM medications WHERE id = ?').get(id));
  });

  // ==================== TRIAGE ====================
  router.post('/triage', requireRole('ASHA', 'ANM', 'PHC_DOCTOR'), async (req, res) => {
    const { patient_id, encounter_id, symptoms } = req.body;
    if (!patient_id || !symptoms) return res.status(400).json({ error: 'patient_id and symptoms required' });

    const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(patient_id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Merge patient data with symptoms for rule evaluation
    const triageData = {
      age: patient.age,
      gender: patient.gender,
      ...symptoms
    };

    const result = runTriage(triageData);

    // Store triage result
    const id = uuidv4();
    await db.prepare(`
      INSERT INTO triage_results (id, patient_id, encounter_id, risk_level, score, rules_triggered, symptoms, recommendation, assessed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, patient_id, encounter_id || null, result.riskLevel, result.score, JSON.stringify(result.rulesTriggered), JSON.stringify(symptoms), result.recommendation, req.user.id);

    // Create alert if high risk
    if (result.riskLevel === 'HIGH' || result.riskLevel === 'CRITICAL') {
      const alertId = uuidv4();
      await db.prepare(`
        INSERT INTO alerts (id, patient_id, type, severity, title, message, requires_review)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(alertId, patient_id, 'TRIAGE_HIGH_RISK', result.riskLevel === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
        `${result.riskLevel} Risk: ${patient.first_name} ${patient.last_name || ''}`,
        result.recommendation, 1);
    }

    await auditLog(db, req.user.id, 'RUN_TRIAGE', 'triage', id, { risk: result.riskLevel, patient_id }, req.ip);
    res.json({ id, ...result });
  });

  router.get('/patients/:patientId/triage', requirePhiRead, async (req, res) => {
    res.json(await db.prepare('SELECT * FROM triage_results WHERE patient_id = ? ORDER BY created_at DESC').all(req.params.patientId));
  });

  // ==================== REFERRALS ====================
  router.get('/referrals', async (req, res) => {
    const { status, facility_id, my_referrals } = req.query;
    let query = `
      SELECT r.*, p.first_name, p.last_name, p.age, p.gender,
             rf.name as referring_facility_name,
             rec.name as receiving_facility_name,
             rec.type as receiving_facility_type
      FROM referrals r 
      JOIN patients p ON r.patient_id = p.id 
      LEFT JOIN facilities rf ON r.referring_facility_id = rf.id
      LEFT JOIN facilities rec ON r.receiving_facility_id = rec.id
      WHERE 1=1
    `;
    const params = [];

    if (status) { query += ' AND r.status = ?'; params.push(status); }
    if (facility_id) { query += ' AND (r.referring_facility_id = ? OR r.receiving_facility_id = ?)'; params.push(facility_id, facility_id); }

    // Doctors see referrals for their facility
    if (req.user.role === 'PHC_DOCTOR' || req.user.role === 'HOSPITAL_DOCTOR') {
      if (!facility_id) {
        query += ' AND (r.receiving_facility_id = ? OR r.referring_user_id = ?)';
        params.push(req.user.facility_id, req.user.id);
      }
    }

    if (my_referrals === 'true') {
      query += ' AND r.referring_user_id = ?';
      params.push(req.user.id);
    }

    const { limit, offset } = pageParams(req);
    query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    res.json(await db.prepare(query).all(...params, limit, offset));
  });

  router.get('/referrals/:id', async (req, res) => {
    const referral = await db.prepare(`
      SELECT r.*, p.first_name, p.last_name, p.age, p.gender, p.village, p.abha_id, p.temporary_id,
             rf.name as referring_facility_name,
             rec.name as receiving_facility_name,
             rec.type as receiving_facility_type,
             rec.address as receiving_facility_address,
             rec.phone as receiving_facility_phone,
             rec.services as receiving_facility_services
      FROM referrals r 
      JOIN patients p ON r.patient_id = p.id 
      LEFT JOIN facilities rf ON r.referring_facility_id = rf.id
      LEFT JOIN facilities rec ON r.receiving_facility_id = rec.id
      WHERE r.id = ?
    `).get(req.params.id);
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    // Get referral events
    const events = await db.prepare('SELECT re.*, u.full_name as actor_name FROM referral_events re LEFT JOIN users u ON re.actor_id = u.id WHERE re.referral_id = ? ORDER BY re.timestamp ASC').all(req.params.id);

    // Get patient clinical data
    const observations = await db.prepare('SELECT * FROM observations WHERE patient_id = ? ORDER BY recorded_at DESC LIMIT 20').all(referral.patient_id);
    const conditions = await db.prepare("SELECT * FROM conditions WHERE patient_id = ? AND status = 'active'").all(referral.patient_id);
    const medications = await db.prepare("SELECT * FROM medications WHERE patient_id = ? AND status = 'active'").all(referral.patient_id);
    const triageResults = await db.prepare('SELECT * FROM triage_results WHERE patient_id = ? ORDER BY created_at DESC LIMIT 5').all(referral.patient_id);

    // Generate AI summary
    const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(referral.patient_id);
    const summary = generatePatientSummary(patient, observations, conditions, medications);

    res.json({ referral, events, observations, conditions, medications, triageResults, aiSummary: summary });
  });

  router.post('/referrals', requireRole('ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR'), async (req, res) => {
    const { patient_id, receiving_facility_id, reason, priority, notes } = req.body;
    if (!patient_id || !reason) return res.status(400).json({ error: 'patient_id and reason required' });

    const id = uuidv4();
    const referral_code = 'REF-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    await db.prepare(`
      INSERT INTO referrals (id, patient_id, referring_facility_id, receiving_facility_id, referring_user_id, reason, priority, status, referral_code, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'BOOKED', ?, ?)
    `).run(id, patient_id, req.user.facility_id, receiving_facility_id || null, req.user.id, reason, priority || 'NORMAL', referral_code, notes || null);

    // Record initial event
    await db.prepare('INSERT INTO referral_events (id, referral_id, from_state, to_state, actor_id, notes) VALUES (?,?,?,?,?,?)')
      .run(uuidv4(), id, null, 'BOOKED', req.user.id, 'Referral created');

    await auditLog(db, req.user.id, 'CREATE_REFERRAL', 'referral', id, { patient_id, reason, referral_code }, req.ip);

    // Create notification for receiving facility doctors
    if (receiving_facility_id) {
      const doctors = await db.prepare("SELECT id FROM users WHERE facility_id = ? AND role IN ('PHC_DOCTOR','HOSPITAL_DOCTOR')").all(receiving_facility_id);
      for (const doc of doctors) {
        await db.prepare('INSERT INTO notifications (id, user_id, type, title, message) VALUES (?,?,?,?,?)')
          .run(uuidv4(), doc.id, 'NEW_REFERRAL', 'New Referral', `New referral ${referral_code} received.`);
      }
    }

    res.status(201).json(await db.prepare('SELECT * FROM referrals WHERE id = ?').get(id));
  });

  router.put('/referrals/:id/status', requireRole('PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'ANM', 'ASHA'), async (req, res) => {
    const { status, notes } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });

    const referral = await db.prepare('SELECT * FROM referrals WHERE id = ?').get(req.params.id);
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    if (!canTransition(referral.status, status)) {
      return res.status(400).json({ error: `Cannot transition from ${referral.status} to ${status}. Allowed: ${JSON.stringify(require('./services').REFERRAL_TRANSITIONS[referral.status])}` });
    }

    await db.prepare("UPDATE referrals SET status = ?, notes = COALESCE(?, notes), updated_at = NOW() WHERE id = ?")
      .run(status, notes, req.params.id);

    await db.prepare('INSERT INTO referral_events (id, referral_id, from_state, to_state, actor_id, notes) VALUES (?,?,?,?,?,?)')
      .run(uuidv4(), req.params.id, referral.status, status, req.user.id, notes || `Status changed to ${status}`);

    await auditLog(db, req.user.id, 'UPDATE_REFERRAL_STATUS', 'referral', req.params.id, { from: referral.status, to: status }, req.ip);
    res.json(await db.prepare('SELECT * FROM referrals WHERE id = ?').get(req.params.id));
  });

  // ==================== ESCALATION ====================
  router.post('/referrals/:id/escalate', requireRole('PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'THO', 'DHO'), async (req, res) => {
    const { reason } = req.body;
    const referral = await db.prepare('SELECT * FROM referrals WHERE id = ?').get(req.params.id);
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    await db.prepare("UPDATE referrals SET escalated = 1, escalation_reason = ?, updated_at = NOW() WHERE id = ?")
      .run(reason || 'Unresolved beyond threshold', req.params.id);

    // Notify supervisors
    const supervisors = await db.prepare("SELECT id FROM users WHERE role IN ('THO','DHO','STATE_MSIS')").all();
    for (const sup of supervisors) {
      await db.prepare('INSERT INTO notifications (id, user_id, type, title, message) VALUES (?,?,?,?,?)')
        .run(uuidv4(), sup.id, 'ESCALATION', 'Referral Escalated', `Referral ${referral.referral_code} has been escalated: ${reason || 'Unresolved'}`);
    }

    await auditLog(db, req.user.id, 'ESCALATE_REFERRAL', 'referral', req.params.id, { reason }, req.ip);
    res.json({ success: true, message: 'Referral escalated' });
  });

  // Auto-escalation check (run periodically or on demand)
  router.post('/referrals/check-escalation', requireRole('THO', 'DHO', 'STATE_MSIS'), async (req, res) => {
    const thresholdHours = req.body.threshold_hours || 48;
    const unresolved = await db.prepare(`
      SELECT * FROM referrals
      WHERE status NOT IN ('CLOSED','CANCELLED','TREATED')
      AND escalated = 0
      AND created_at + CAST(? AS integer) * interval '1 hour' < NOW()
    `).all(thresholdHours);

    let escalatedCount = 0;
    for (const ref of unresolved) {
      await db.prepare("UPDATE referrals SET escalated = 1, escalation_reason = 'Auto-escalated: unresolved beyond threshold', updated_at = NOW() WHERE id = ?")
        .run(ref.id);
      escalatedCount++;
    }

    res.json({ escalatedCount, message: `${escalatedCount} referrals auto-escalated` });
  });

  // ==================== TELECONSULTATION ====================
  router.post('/teleconsultations', requireRole('ASHA', 'ANM', 'PHC_DOCTOR'), async (req, res) => {
    const { patient_id, referral_id, type, chief_complaint } = req.body;
    if (!patient_id) return res.status(400).json({ error: 'patient_id required' });
    const id = uuidv4();
    await db.prepare(`
      INSERT INTO teleconsultations (id, referral_id, patient_id, asha_id, type, chief_complaint)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, referral_id || null, patient_id, req.user.id, type || 'store_and_forward', chief_complaint);
    res.status(201).json(await db.prepare('SELECT * FROM teleconsultations WHERE id = ?').get(id));
  });

  router.get('/teleconsultations', async (req, res) => {
    let query = `SELECT tc.*, p.first_name, p.last_name FROM teleconsultations tc JOIN patients p ON tc.patient_id = p.id WHERE 1=1`;
    const params = [];
    if (req.user.role === 'PHC_DOCTOR' || req.user.role === 'HOSPITAL_DOCTOR') {
      query += ` AND (tc.doctor_id = ? OR tc.doctor_id IS NULL)`;
      params.push(req.user.id);
    }
    const { limit, offset } = pageParams(req);
    query += ' ORDER BY tc.created_at DESC LIMIT ? OFFSET ?';
    res.json(await db.prepare(query).all(...params, limit, offset));
  });

  router.put('/teleconsultations/:id/respond', requireRole('PHC_DOCTOR', 'HOSPITAL_DOCTOR'), async (req, res) => {
    const { clinical_notes, doctor_response } = req.body;
    await db.prepare(`
      UPDATE teleconsultations SET doctor_id = ?, clinical_notes = ?, doctor_response = ?, status = 'completed', completed_at = NOW() WHERE id = ?
    `).run(req.user.id, clinical_notes, doctor_response, req.params.id);
    res.json(await db.prepare('SELECT * FROM teleconsultations WHERE id = ?').get(req.params.id));
  });

  // ==================== TELECOM / RADAR ADAPTERS ====================
  router.post('/telecom/send-sms', async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });
    await auditLog(db, req.user ? req.user.id : 'SYSTEM', 'TELECOM_SMS_SIMULATED', 'telecom', null, { to, message }, req.ip);
    res.json({
      status: 'simulated_success',
      adapter: 'LocalTelecomAdapter',
      to,
      message,
      timestamp: new Date().toISOString(),
      note: 'External SMS gateway credentials unavailable in development. Internal message formatted & processed.'
    });
  });

  router.post('/telecom/ivr-query', async (req, res) => {
    const { phone, query_type } = req.body;
    await auditLog(db, req.user ? req.user.id : 'SYSTEM', 'TELECOM_IVR_SIMULATED', 'telecom', null, { phone, query_type }, req.ip);
    res.json({
      status: 'simulated_success',
      adapter: 'LocalIVRAdapter',
      response_audio_prompt: `Welcome to Aarogya Setu Mitra RADAR helpline. Query processed for ${query_type || 'facility availability'}.`,
      timestamp: new Date().toISOString()
    });
  });
  router.get('/facilities', async (req, res) => {
    const { search, district, type } = req.query;
    let query = 'SELECT * FROM facilities WHERE 1=1';
    const params = [];
    if (search) { query += ' AND name ILIKE ?'; params.push(`%${search}%`); }
    if (district) { query += ' AND district = ?'; params.push(district); }
    if (type) { query += ' AND type = ?'; params.push(type); }
    const { limit, offset } = pageParams(req);
    query += ' ORDER BY name ASC LIMIT ? OFFSET ?';
    res.json(await db.prepare(query).all(...params, limit, offset));
  });

  router.get('/facilities/:id', async (req, res) => {
    const facility = await db.prepare('SELECT * FROM facilities WHERE id = ?').get(req.params.id);
    if (!facility) return res.status(404).json({ error: 'Facility not found' });

    const doctors = await db.prepare(`
      SELECT da.*, u.full_name as doctor_name FROM doctor_availability da 
      JOIN users u ON da.doctor_id = u.id WHERE da.facility_id = ?
    `).all(req.params.id);
    const stock = await db.prepare('SELECT * FROM medicine_stock WHERE facility_id = ?').all(req.params.id);

    res.json({ facility, doctors, stock });
  });

  router.post('/facilities', requireRole('THO', 'DHO', 'STATE_MSIS', 'FACILITY_STAFF'), async (req, res) => {
    const { name, type, address, village, district, state, phone, services, bed_count, latitude, longitude } = req.body;
    const id = uuidv4();
    await db.prepare('INSERT INTO facilities (id, name, type, address, village, district, state, phone, services, bed_count, latitude, longitude) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, name, type, address, village, district, state, phone, services, bed_count || 0, latitude, longitude);
    res.status(201).json(await db.prepare('SELECT * FROM facilities WHERE id = ?').get(id));
  });

  // RADAR query
  router.get('/radar/query', async (req, res) => {
    const { facility, district, medicine, doctor } = req.query;
    const results = await queryRadar(db, {
      facilityName: facility,
      district: district,
      medicineName: medicine,
      doctorName: doctor
    });
    res.json(results);
  });

  // ==================== MEDICINE STOCK ====================
  router.get('/facilities/:facilityId/stock', async (req, res) => {
    res.json(await db.prepare('SELECT * FROM medicine_stock WHERE facility_id = ?').all(req.params.facilityId));
  });

  router.put('/stock/:id', requireRole('PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'ANM', 'THO', 'FACILITY_STAFF'), async (req, res) => {
    const { quantity } = req.body;
    if (quantity === undefined) return res.status(400).json({ error: 'quantity required' });

    const stock = await db.prepare('SELECT * FROM medicine_stock WHERE id = ?').get(req.params.id);
    if (!stock) return res.status(404).json({ error: 'Stock record not found' });

    const status = quantity === 0 ? 'OUT_OF_STOCK' : quantity <= stock.threshold ? 'LOW_STOCK' : 'IN_STOCK';
    await db.prepare("UPDATE medicine_stock SET quantity = ?, status = ?, last_updated = NOW() WHERE id = ?")
      .run(quantity, status, req.params.id);

    if (status === 'OUT_OF_STOCK') {
      await db.prepare('INSERT INTO alerts (id, facility_id, type, severity, title, message) VALUES (?,?,?,?,?,?)')
        .run(uuidv4(), stock.facility_id, 'STOCKOUT', 'WARNING', `Stockout: ${stock.medicine_name}`, `${stock.medicine_name} is out of stock at facility.`);
    }

    await auditLog(db, req.user.id, 'UPDATE_STOCK', 'medicine_stock', req.params.id, { quantity, status }, req.ip);
    res.json(await db.prepare('SELECT * FROM medicine_stock WHERE id = ?').get(req.params.id));
  });

  // ==================== DOCTOR AVAILABILITY ====================
  router.put('/availability/:id', requireRole('PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'THO', 'FACILITY_STAFF'), async (req, res) => {
    const { is_available, start_time, end_time } = req.body;
    const updates = [];
    const params = [];
    if (is_available !== undefined) { updates.push('is_available = ?'); params.push(is_available ? 1 : 0); }
    if (start_time) { updates.push('start_time = ?'); params.push(start_time); }
    if (end_time) { updates.push('end_time = ?'); params.push(end_time); }
    updates.push("last_updated = NOW()");
    params.push(req.params.id);
    await db.prepare(`UPDATE doctor_availability SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json(await db.prepare('SELECT * FROM doctor_availability WHERE id = ?').get(req.params.id));
  });

  // ==================== CONSENTS ====================
  router.get('/consents', async (req, res) => {
    let query = 'SELECT c.*, p.first_name, p.last_name, u.full_name as requester_name FROM consents c JOIN patients p ON c.patient_id = p.id LEFT JOIN users u ON c.requester_id = u.id WHERE 1=1';
    const params = [];
    if (req.user.role === 'CAREGIVER') {
      query += ' AND c.requester_id = ?';
      params.push(req.user.id);
    }
    const { limit, offset } = pageParams(req);
    query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    res.json(await db.prepare(query).all(...params, limit, offset));
  });

  router.post('/consents', requireRole('ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'PATIENT'), async (req, res) => {
    const { patient_id, requester_id, scope, purpose, expires_at } = req.body;
    if (!patient_id || !requester_id) return res.status(400).json({ error: 'patient_id and requester_id required' });
    const id = uuidv4();
    await db.prepare(`
      INSERT INTO consents (id, patient_id, requester_id, scope, purpose, status, granted_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'granted', NOW(), ?)
    `).run(id, patient_id, requester_id, scope || 'full', purpose, expires_at || null);
    await auditLog(db, req.user.id, 'GRANT_CONSENT', 'consent', id, { patient_id, requester_id, scope }, req.ip);
    res.status(201).json(await db.prepare('SELECT * FROM consents WHERE id = ?').get(id));
  });

  router.put('/consents/:id/revoke', async (req, res) => {
    const consent = await db.prepare('SELECT * FROM consents WHERE id = ?').get(req.params.id);
    if (!consent) return res.status(404).json({ error: 'Consent not found' });

    await db.prepare("UPDATE consents SET status = 'revoked', revoked_at = NOW() WHERE id = ?").run(req.params.id);

    // Deactivate associated caregivers
    await db.prepare('UPDATE caregivers SET active = 0 WHERE consent_id = ?').run(req.params.id);

    await auditLog(db, req.user.id, 'REVOKE_CONSENT', 'consent', req.params.id, { patient_id: consent.patient_id }, req.ip);
    res.json({ success: true, message: 'Consent revoked' });
  });

  // ==================== CAREGIVERS ====================
  router.post('/caregivers', requireRole('ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'PATIENT'), async (req, res) => {
    const { patient_id, caregiver_user_id, relationship, scope } = req.body;
    if (!patient_id || !caregiver_user_id) return res.status(400).json({ error: 'patient_id and caregiver_user_id required' });

    // Create consent first
    const consentId = uuidv4();
    await db.prepare(`
      INSERT INTO consents (id, patient_id, requester_id, scope, purpose, status, granted_at)
      VALUES (?, ?, ?, ?, 'Caregiver access', 'granted', NOW())
    `).run(consentId, patient_id, caregiver_user_id, scope || 'full');

    const id = uuidv4();
    await db.prepare('INSERT INTO caregivers (id, patient_id, caregiver_user_id, relationship, scope, consent_id) VALUES (?,?,?,?,?,?)')
      .run(id, patient_id, caregiver_user_id, relationship, scope || 'full', consentId);

    await auditLog(db, req.user.id, 'CREATE_CAREGIVER', 'caregiver', id, { patient_id, caregiver_user_id, scope }, req.ip);
    res.status(201).json(await db.prepare('SELECT * FROM caregivers WHERE id = ?').get(id));
  });

  router.get('/caregivers', async (req, res) => {
    let query = 'SELECT cg.*, p.first_name, p.last_name FROM caregivers cg JOIN patients p ON cg.patient_id = p.id WHERE 1=1';
    const params = [];
    if (req.user.role === 'CAREGIVER') {
      query += ' AND cg.caregiver_user_id = ? AND cg.active = 1';
      params.push(req.user.id);
    }
    const { limit, offset } = pageParams(req);
    query += ' ORDER BY cg.created_at DESC LIMIT ? OFFSET ?';
    res.json(await db.prepare(query).all(...params, limit, offset));
  });

  router.put('/caregivers/:id/revoke', async (req, res) => {
    const caregiver = await db.prepare('SELECT * FROM caregivers WHERE id = ?').get(req.params.id);
    if (!caregiver) return res.status(404).json({ error: 'Caregiver not found' });

    await db.prepare('UPDATE caregivers SET active = 0 WHERE id = ?').run(req.params.id);
    if (caregiver.consent_id) {
      await db.prepare("UPDATE consents SET status = 'revoked', revoked_at = NOW() WHERE id = ?").run(caregiver.consent_id);
    }

    await auditLog(db, req.user.id, 'REVOKE_CAREGIVER', 'caregiver', req.params.id, { patient_id: caregiver.patient_id }, req.ip);
    res.json({ success: true, message: 'Caregiver access revoked' });
  });

  // Caregiver patient access
  router.get('/caregiver/patients', requireRole('CAREGIVER'), async (req, res) => {
    const activeLinks = await db.prepare(`
      SELECT cg.*, p.*, c.scope as consent_scope, c.status as consent_status, c.expires_at
      FROM caregivers cg
      JOIN patients p ON cg.patient_id = p.id
      JOIN consents c ON cg.consent_id = c.id
      WHERE cg.caregiver_user_id = ? AND cg.active = 1 AND c.status = 'granted'
      AND (c.expires_at IS NULL OR c.expires_at > NOW())
    `).all(req.user.id);
    res.json(activeLinks);
  });

  // ==================== TRENDS / AI ====================
  router.get('/patients/:patientId/trends', async (req, res) => {
    const observations = await db.prepare('SELECT * FROM observations WHERE patient_id = ? ORDER BY recorded_at ASC').all(req.params.patientId);
    const trends = detectTrends(observations);

    // Create alerts for concerning trends
    for (const trend of trends) {
      if (trend.requiresReview) {
        const existing = await db.prepare("SELECT id FROM alerts WHERE patient_id = ? AND type = 'TREND_ALERT' AND title ILIKE ? AND created_at > NOW() - interval '24 hours'").get(req.params.patientId, `%${trend.displayName}%`);
        if (!existing) {
          await db.prepare('INSERT INTO alerts (id, patient_id, type, severity, title, message, requires_review) VALUES (?,?,?,?,?,?,?)')
            .run(uuidv4(), req.params.patientId, 'TREND_ALERT', trend.severity, `Trend Alert: ${trend.displayName}`, trend.message, 1);
        }
      }
    }

    res.json(trends);
  });

  router.get('/patients/:patientId/summary', requirePhiRead, async (req, res) => {
    try {
      const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const observations = await db.prepare('SELECT * FROM observations WHERE patient_id = ? ORDER BY recorded_at ASC').all(req.params.patientId);
      const conditions = await db.prepare('SELECT * FROM conditions WHERE patient_id = ?').all(req.params.patientId);
      const medications = await db.prepare('SELECT * FROM medications WHERE patient_id = ?').all(req.params.patientId);
      const referrals = await db.prepare('SELECT * FROM referrals WHERE patient_id = ?').all(req.params.patientId);

      const summaryText = await summarizeHealthRecord({ patient, observations, conditions, medications, referrals }, req.user.id);

      await auditLog(db, req.user.id, 'VIEW_SUMMARY', 'patient', req.params.patientId, {}, req.ip);
      res.json({
        patientId: patient.id,
        patientName: `${patient.first_name} ${patient.last_name || ''}`,
        summary: summaryText,
        disclaimer: MANDATORY_DISCLAIMER,
        observationsCount: observations.length,
        conditionsCount: conditions.length,
        medicationsCount: medications.length
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== AI SPECIALIZED ENDPOINTS (Module F / A6 / A7) ====================
  router.get('/patients/:patientId/explanation', requirePhiRead, async (req, res) => {
    try {
      const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const summaryRes = await summarizeHealthRecord({ patient }, req.user.id);
      const lang = req.query.language || 'en';
      const explanation = await generatePatientExplanation(summaryRes, lang, req.user.id);
      res.json({ language: lang, explanation, disclaimer: MANDATORY_DISCLAIMER });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/ai/translate', async (req, res) => {
    try {
      const { text, targetLanguage } = req.body;
      if (!text) return res.status(400).json({ error: 'text required' });
      const translated = await translateText(text, targetLanguage || 'hi', req.user.id);
      res.json({ original: text, targetLanguage: targetLanguage || 'hi', translated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/ai/stt', upload.single('audio'), async (req, res) => {
    try {
      const buffer = req.file?.buffer || Buffer.from('mock audio');
      const filename = req.file?.originalname || 'speech.wav';
      const text = await transcribeAudio(buffer, filename, req.user.id);
      if (!text || !text.trim()) {
        return res.json({ transcription: '', success: false, message: 'Voice transcription unavailable. Please type your symptoms instead.' });
      }
      res.json({ transcription: text, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/ai/chat', async (req, res) => {
    const { messages, language } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
    try {
      const reply = await chatWithMitra(messages, language || 'en', req.user.id);
      res.json({ reply, disclaimer: MANDATORY_DISCLAIMER });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== DASHBOARD ====================
  router.get('/dashboard/metrics', requireRole('THO', 'DHO', 'STATE_MSIS', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR'), async (req, res) => {
    const metrics = await getDashboardMetrics(db, req.user.role, req.user.facility_id, req.query.district);
    res.json(metrics);
  });

  // ==================== HBNC ====================
  router.post('/hbnc', requireRole('ASHA', 'ANM'), async (req, res) => {
    const { patient_id, visit_number, weight, temperature, breastfeeding, umbilical_cord, danger_signs } = req.body;
    const id = uuidv4();
    await db.prepare('INSERT INTO hbnc_visits (id, patient_id, visit_number, visit_date, weight, temperature, breastfeeding, umbilical_cord, danger_signs, worker_id) VALUES (?,?,?,NOW(),?,?,?,?,?,?)')
      .run(id, patient_id, visit_number, weight, temperature, breastfeeding, umbilical_cord, danger_signs, req.user.id);
    res.status(201).json(await db.prepare('SELECT * FROM hbnc_visits WHERE id = ?').get(id));
  });

  router.get('/patients/:patientId/hbnc', async (req, res) => {
    res.json(await db.prepare('SELECT * FROM hbnc_visits WHERE patient_id = ? ORDER BY visit_number ASC').all(req.params.patientId));
  });

  // ==================== ANC ====================
  router.post('/anc', requireRole('ASHA', 'ANM', 'PHC_DOCTOR'), async (req, res) => {
    const { patient_id, visit_number, gestational_age_weeks, weight, blood_pressure_systolic, blood_pressure_diastolic, hemoglobin, urine_protein, fetal_heart_rate, complications } = req.body;
    const id = uuidv4();
    await db.prepare('INSERT INTO anc_visits (id, patient_id, visit_number, visit_date, gestational_age_weeks, weight, blood_pressure_systolic, blood_pressure_diastolic, hemoglobin, urine_protein, fetal_heart_rate, complications, worker_id) VALUES (?,?,?,NOW(),?,?,?,?,?,?,?,?,?)')
      .run(id, patient_id, visit_number, gestational_age_weeks, weight, blood_pressure_systolic, blood_pressure_diastolic, hemoglobin, urine_protein, fetal_heart_rate, complications, req.user.id);
    res.status(201).json(await db.prepare('SELECT * FROM anc_visits WHERE id = ?').get(id));
  });

  router.get('/patients/:patientId/anc', async (req, res) => {
    res.json(await db.prepare('SELECT * FROM anc_visits WHERE patient_id = ? ORDER BY visit_number ASC').all(req.params.patientId));
  });

  // ==================== IMMUNIZATIONS ====================
  router.get('/patients/:patientId/immunizations', async (req, res) => {
    res.json(await db.prepare('SELECT * FROM immunizations WHERE patient_id = ? ORDER BY due_date ASC').all(req.params.patientId));
  });

  router.post('/immunizations', requireRole('ASHA', 'ANM', 'PHC_DOCTOR'), async (req, res) => {
    const { patient_id, vaccine_name, dose_number, date_given, due_date, status, facility_id, batch_number } = req.body;
    const id = uuidv4();
    await db.prepare('INSERT INTO immunizations (id, patient_id, vaccine_name, dose_number, date_given, due_date, status, given_by, facility_id, batch_number) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, patient_id, vaccine_name, dose_number || 1, date_given, due_date, status || 'due', req.user.id, facility_id, batch_number);
    res.status(201).json(await db.prepare('SELECT * FROM immunizations WHERE id = ?').get(id));
  });

  router.put('/immunizations/:id', requireRole('ASHA', 'ANM', 'PHC_DOCTOR'), async (req, res) => {
    const { status, date_given, batch_number } = req.body;
    await db.prepare("UPDATE immunizations SET status = ?, date_given = COALESCE(?, date_given), batch_number = COALESCE(?, batch_number) WHERE id = ?")
      .run(status, date_given, batch_number, req.params.id);
    res.json(await db.prepare('SELECT * FROM immunizations WHERE id = ?').get(req.params.id));
  });

  // ==================== NCD FOLLOWUPS ====================
  router.post('/ncd-followups', requireRole('ASHA', 'ANM', 'PHC_DOCTOR'), async (req, res) => {
    const { patient_id, condition_type, blood_sugar_fasting, blood_sugar_pp, blood_pressure_systolic, blood_pressure_diastolic, medication_adherence, lifestyle_notes, next_followup_date } = req.body;
    const id = uuidv4();
    await db.prepare('INSERT INTO ncd_followups (id, patient_id, condition_type, visit_date, blood_sugar_fasting, blood_sugar_pp, blood_pressure_systolic, blood_pressure_diastolic, medication_adherence, lifestyle_notes, next_followup_date, worker_id) VALUES (?,?,?,NOW(),?,?,?,?,?,?,?,?)')
      .run(id, patient_id, condition_type, blood_sugar_fasting, blood_sugar_pp, blood_pressure_systolic, blood_pressure_diastolic, medication_adherence, lifestyle_notes, next_followup_date, req.user.id);

    // Create follow-up schedule entry
    if (next_followup_date) {
      await db.prepare('INSERT INTO followup_schedule (id, patient_id, type, due_date, assigned_to) VALUES (?,?,?,?,?)')
        .run(uuidv4(), patient_id, 'NCD_FOLLOWUP', next_followup_date, req.user.id);
    }

    res.status(201).json(await db.prepare('SELECT * FROM ncd_followups WHERE id = ?').get(id));
  });

  router.get('/patients/:patientId/ncd-followups', async (req, res) => {
    res.json(await db.prepare('SELECT * FROM ncd_followups WHERE patient_id = ? ORDER BY visit_date DESC').all(req.params.patientId));
  });

  // ==================== FOLLOW-UP SCHEDULE ====================
  router.get('/followups', async (req, res) => {
    let query = 'SELECT fs.*, p.first_name, p.last_name FROM followup_schedule fs JOIN patients p ON fs.patient_id = p.id WHERE 1=1';
    const params = [];
    if (req.query.status) { query += ' AND fs.status = ?'; params.push(req.query.status); }
    if (req.query.assigned_to) { query += ' AND fs.assigned_to = ?'; params.push(req.query.assigned_to); }
    const { limit, offset } = pageParams(req);
    query += ' ORDER BY fs.due_date ASC LIMIT ? OFFSET ?';
    res.json(await db.prepare(query).all(...params, limit, offset));
  });

  router.put('/followups/:id', async (req, res) => {
    const { status, notes } = req.body;
    const updates = [];
    const params = [];
    if (status) { updates.push('status = ?'); params.push(status); if (status === 'completed') { updates.push("completed_at = NOW()"); } }
    if (notes) { updates.push('notes = ?'); params.push(notes); }
    params.push(req.params.id);
    await db.prepare(`UPDATE followup_schedule SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json(await db.prepare('SELECT * FROM followup_schedule WHERE id = ?').get(req.params.id));
  });

  // ==================== DOCUMENTS / OCR ====================
  router.post('/documents', requireRole('ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR'), async (req, res) => {
    const { patient_id, type, filename, ocr_text } = req.body;
    const id = uuidv4();
    await db.prepare('INSERT INTO documents (id, patient_id, type, filename, ocr_status, ocr_text, uploaded_by) VALUES (?,?,?,?,?,?,?)')
      .run(id, patient_id, type, filename, ocr_text ? 'completed' : 'pending', ocr_text || null, req.user.id);

    // If OCR text provided, attempt extraction
    if (ocr_text) {
      await extractValues(db, id, patient_id, ocr_text);
    }

    res.status(201).json(await db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
  });

  router.get('/patients/:patientId/documents', async (req, res) => {
    res.json(await db.prepare('SELECT * FROM documents WHERE patient_id = ? ORDER BY created_at DESC').all(req.params.patientId));
  });

  router.get('/patients/:patientId/extracted-values', async (req, res) => {
    res.json(await db.prepare('SELECT * FROM extracted_values WHERE patient_id = ? ORDER BY report_date DESC').all(req.params.patientId));
  });

  // ==================== NOTIFICATIONS ====================
  router.get('/notifications', async (req, res) => {
    const { limit, offset } = pageParams(req);
    res.json(await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(req.user.id, limit, offset));
  });

  router.put('/notifications/:id/read', async (req, res) => {
    await db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
  });

  // ==================== ALERTS ====================
  router.get('/alerts', async (req, res) => {
    const { patient_id, severity, unread } = req.query;
    let query = 'SELECT * FROM alerts WHERE 1=1';
    const params = [];
    if (patient_id) { query += ' AND patient_id = ?'; params.push(patient_id); }
    if (severity) { query += ' AND severity = ?'; params.push(severity); }
    if (unread === 'true') { query += ' AND read = 0'; }
    const { limit, offset } = pageParams(req);
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    res.json(await db.prepare(query).all(...params, limit, offset));
  });

  router.put('/alerts/:id/read', async (req, res) => {
    await db.prepare('UPDATE alerts SET read = 1 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // ==================== AUDIT LOGS ====================
  router.get('/audit-logs', requireRole('THO', 'DHO', 'STATE_MSIS'), async (req, res) => {
    const { user_id, action, resource_type } = req.query;
    let query = 'SELECT al.*, u.full_name as user_name FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id WHERE 1=1';
    const params = [];
    if (user_id) { query += ' AND al.user_id = ?'; params.push(user_id); }
    if (action) { query += ' AND al.action = ?'; params.push(action); }
    if (resource_type) { query += ' AND al.resource_type = ?'; params.push(resource_type); }
    const { limit, offset } = pageParams(req);
    query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    res.json(await db.prepare(query).all(...params, limit, offset));
  });

  // ==================== SYNC ====================
  router.post('/sync/push', requireRole('ASHA', 'ANM', 'PHC_DOCTOR', 'FACILITY_STAFF'), async (req, res) => {
    const { records } = req.body;
    if (!records || !Array.isArray(records)) return res.status(400).json({ error: 'records array required' });
    if (records.length > 100) return res.status(400).json({ error: 'Batch too large (max 100 records)' });

    try {
      const results = await db.transaction(async (tx) => {
        const out = [];
        for (const record of records) {
          try {
            out.push(await applySyncRecord(tx, record, req));
          } catch (err) {
            out.push({ record_id: record.record_id || null, status: 'error', error: err.message });
          }
        }
        return out;
      });
      res.json({ results, synced: results.filter((r) => r.status === 'synced').length });
    } catch (err) {
      res.status(500).json({ error: 'Sync transaction failed: ' + err.message });
    }
  });

  router.get('/sync/status', async (req, res) => {
    const pending = (await db.prepare('SELECT COUNT(*) as count FROM sync_queue WHERE synced = 0').get()).count;
    const synced = (await db.prepare('SELECT COUNT(*) as count FROM sync_queue WHERE synced = 1').get()).count;
    const errors = (await db.prepare('SELECT COUNT(*) as count FROM sync_queue WHERE sync_error IS NOT NULL').get()).count;
    res.json({ pending, synced, errors });
  });

  // ==================== FHIR ENDPOINTS ====================
  router.get('/fhir/Patient/:id', requirePhiRead, async (req, res) => {
    const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json(toFHIRPatient(patient));
  });

  router.get('/fhir/Patient/:patientId/everything', requirePhiRead, async (req, res) => {
    const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      timestamp: new Date().toISOString(),
      meta: {
        lastUpdated: new Date().toISOString(),
        profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle']
      },
      entry: [
        { resource: toFHIRPatient(patient) },
        ...(await db.prepare('SELECT * FROM observations WHERE patient_id = ?').all(patient.id)).map(o => ({ resource: toFHIRObservation(o) })),
        ...(await db.prepare('SELECT * FROM encounters WHERE patient_id = ?').all(patient.id)).map(e => ({ resource: toFHIREncounter(e) })),
        ...(await db.prepare('SELECT * FROM conditions WHERE patient_id = ?').all(patient.id)).map(c => ({ resource: toFHIRCondition(c) })),
        ...(await db.prepare('SELECT * FROM referrals WHERE patient_id = ?').all(patient.id)).map(r => ({ resource: toFHIRServiceRequest(r) })),
        ...(await db.prepare('SELECT * FROM immunizations WHERE patient_id = ?').all(patient.id)).map(i => ({ resource: toFHIRImmunization(i) })),
        ...(await db.prepare('SELECT * FROM medications WHERE patient_id = ?').all(patient.id)).map(m => ({ resource: toFHIRMedication(m) }))
      ]
    };
    res.json(bundle);
  });

  // ==================== TRANSLATIONS ====================
  router.get('/translations/:language', async (req, res) => {
    const translations = await db.prepare('SELECT key, value FROM translations WHERE language = ?').all(req.params.language);
    const map = {};
    for (const t of translations) { map[t.key] = t.value; }
    res.json(map);
  });

  // ==================== USERS (admin) ====================
  router.get('/users', requireRole('THO', 'DHO', 'STATE_MSIS'), async (req, res) => {
    const { limit, offset } = pageParams(req);
    res.json(await db.prepare('SELECT id, username, full_name, role, facility_id, phone, active, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset));
  });

  const { registerAbhaRoutes } = require('./abha/routes');
  registerAbhaRoutes(router, db);

  return router;
}

// ==================== HELPER: OCR VALUE EXTRACTION ====================
async function extractValues(db, documentId, patientId, text) {
  const patterns = [
    { field: 'hemoglobin', regex: /(?:hb|hemoglobin|haemoglobin)[:\s]*(\d+\.?\d*)\s*(?:g\/dl|gm\/dl)?/i, unit: 'g/dL' },
    { field: 'bp_systolic', regex: /(?:bp|blood\s*pressure)[:\s]*(\d{2,3})\s*\/\s*(\d{2,3})/i, unit: 'mmHg', group: 1 },
    { field: 'bp_diastolic', regex: /(?:bp|blood\s*pressure)[:\s]*(\d{2,3})\s*\/\s*(\d{2,3})/i, unit: 'mmHg', group: 2 },
    { field: 'blood_sugar_fasting', regex: /(?:fasting\s*(?:blood\s*)?(?:sugar|glucose)|fbs)[:\s]*(\d+\.?\d*)\s*(?:mg\/dl)?/i, unit: 'mg/dL' },
    { field: 'blood_sugar_random', regex: /(?:random\s*(?:blood\s*)?(?:sugar|glucose)|rbs)[:\s]*(\d+\.?\d*)\s*(?:mg\/dl)?/i, unit: 'mg/dL' },
    { field: 'weight', regex: /(?:weight|wt)[:\s]*(\d+\.?\d*)\s*(?:kg)?/i, unit: 'kg' },
    { field: 'bilirubin', regex: /(?:bilirubin|total\s*bilirubin)[:\s]*(\d+\.?\d*)\s*(?:mg\/dl)?/i, unit: 'mg/dL' },
  ];

  const dateMatch = text.match(/(?:date|dated?)[:\s]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i);
  const reportDate = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

  for (const pat of patterns) {
    const match = text.match(pat.regex);
    if (match) {
      const value = parseFloat(match[pat.group || 1]);
      if (!isNaN(value)) {
        await db.prepare('INSERT INTO extracted_values (id, document_id, patient_id, field_name, field_value, field_unit, report_date) VALUES (?,?,?,?,?,?,?)')
          .run(uuidv4(), documentId, patientId, pat.field, value, pat.unit, reportDate);

        // Also create an observation
        await db.prepare('INSERT INTO observations (id, patient_id, type, value, unit, recorded_at, source) VALUES (?,?,?,?,?,?,?)')
          .run(uuidv4(), patientId, pat.field, value, pat.unit, reportDate, 'ocr');
      }
    }
  }
}

// ==================== HELPER: SYNC APPLY ====================
const SYNCABLE_TABLES = ['patients', 'observations', 'encounters', 'conditions', 'medications', 'hbnc_visits', 'anc_visits', 'immunizations', 'ncd_followups'];
// ponytail: single owner column per table; tables without one fall back to the parent patient's registered_by. New rows in ownerless tables are allowed (fresh ids can't overwrite).
const SYNC_OWNER_COLUMN = { patients: 'registered_by', encounters: 'worker_id', hbnc_visits: 'worker_id', anc_visits: 'worker_id', ncd_followups: 'worker_id' };
const syncColumnCache = {};

async function syncColumns(tx, tableName) {
  if (!syncColumnCache[tableName]) {
    const rows = await tx.prepare('SELECT column_name FROM information_schema.columns WHERE table_name = ?').all(tableName);
    syncColumnCache[tableName] = new Set(rows.map((r) => r.column_name));
  }
  return syncColumnCache[tableName];
}

async function applySyncUpsert(tx, tableName, data) {
  const columns = Object.keys(data);
  if (columns.length === 0) throw new Error('Empty sync data');
  for (const c of columns) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(c)) throw new Error(`Invalid column name: ${c}`);
  }
  const values = columns.map((c) => data[c]);
  const placeholders = columns.map(() => '?').join(',');
  if (data.id) {
    const sets = columns.filter((c) => c !== 'id').map((c) => `${c}=EXCLUDED.${c}`).join(', ');
    await tx.prepare(`INSERT INTO ${tableName} (${columns.join(',')}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${sets}`).run(...values);
  } else {
    await tx.prepare(`INSERT INTO ${tableName} (${columns.join(',')}) VALUES (${placeholders})`).run(...values);
  }
}

async function applySyncRecord(tx, record, req) {
  const fail = (error) => ({ record_id: record.record_id || null, status: 'error', error });
  if (!record || !record.table_name || !record.record_id || !record.action) {
    return fail('table_name, record_id and action required');
  }
  if (!SYNCABLE_TABLES.includes(record.table_name)) {
    return fail(`Table ${record.table_name} is not syncable`);
  }
  if (!['INSERT', 'UPDATE', 'DELETE'].includes(record.action)) {
    return fail(`Invalid action ${record.action}`);
  }
  const data = record.data || {};
  const rowId = record.action === 'DELETE' ? record.record_id : (data.id || record.record_id);

  // Ownership is enforced against the server's stored row, never the client payload:
  // client-supplied owner fields are ignored (overwritten below for new rows).
  const ownerCol = SYNC_OWNER_COLUMN[record.table_name] || null;
  const existingRow = await tx.prepare(`SELECT * FROM ${record.table_name} WHERE id = ?`).get(rowId);
  const forbidden = () => ({ record_id: record.record_id, status: 'error', error: 'Forbidden: row not owned by authenticated user' });
  async function ownedByUser(row) {
    if (!row) return true; // new row: nothing to steal
    if (ownerCol && row[ownerCol] !== undefined) {
      return row[ownerCol] === null || row[ownerCol] === undefined || row[ownerCol] === req.user.id;
    }
    // Ownerless table: fall back to the parent patient's registered_by.
    const pid = row.patient_id || data.patient_id;
    if (!pid) return true;
    const patient = await tx.prepare('SELECT registered_by FROM patients WHERE id = ?').get(pid);
    if (!patient || patient.registered_by === null || patient.registered_by === undefined) return true;
    return patient.registered_by === req.user.id;
  }

  if (record.action === 'DELETE') {
    if (existingRow && !(await ownedByUser(existingRow))) {
      await auditLog(tx, req.user.id, 'SYNC_REJECTED', record.table_name, record.record_id, { reason: 'ownership' }, req.ip);
      return forbidden();
    }
  } else if (existingRow) {
    if (!(await ownedByUser(existingRow))) {
      await auditLog(tx, req.user.id, 'SYNC_REJECTED', record.table_name, record.record_id, { reason: 'ownership' }, req.ip);
      return forbidden();
    }
  }
  if (ownerCol && record.action !== 'DELETE') {
    // Server sets ownership from JWT, ignoring any client-supplied value
    // (also blocks ownership transfer on updates to already-owned rows).
    data[ownerCol] = req.user.id;
  }

  let incomingUpdatedAt = null;
  if (data.updated_at !== undefined && data.updated_at !== null) {
    incomingUpdatedAt = new Date(data.updated_at);
    if (isNaN(incomingUpdatedAt.getTime())) return fail('Invalid updated_at format (expected ISO-8601)');
  }

  // Idempotency: duplicate client_mutation_id returns the recorded result
  const mutationId = record.client_mutation_id || null;
  if (mutationId) {
    const prior = await tx.prepare('SELECT result FROM sync_queue WHERE client_mutation_id = ?').get(mutationId);
    if (prior && prior.result) {
      try {
        return JSON.parse(prior.result);
      } catch (_) {
        return { record_id: record.record_id, status: 'synced', duplicate: true };
      }
    }
  }

  let outcome;
  try {
    if (record.action === 'DELETE') {
      await tx.prepare(`DELETE FROM ${record.table_name} WHERE id = ?`).run(record.record_id);
      outcome = { record_id: record.record_id, status: 'synced', action: 'DELETE' };
    } else {
      const existing = existingRow;
      if (existing && incomingUpdatedAt) {
        // Stored version: row's updated_at when the table has one,
        // else the updated_at of the last successfully synced payload.
        let storedUpdatedAt = existing.updated_at || null;
        if (!storedUpdatedAt) {
          const lastSync = await tx.prepare('SELECT data FROM sync_queue WHERE table_name = ? AND record_id = ? AND sync_error IS NULL ORDER BY synced_at DESC, created_at DESC LIMIT 1').get(record.table_name, data.id || record.record_id);
          if (lastSync && lastSync.data) {
            try { storedUpdatedAt = JSON.parse(lastSync.data).updated_at || null; } catch (_) { /* ignore malformed */ }
          }
        }
        if (storedUpdatedAt) {
          const stored = new Date(storedUpdatedAt);
          if (!isNaN(stored.getTime()) && incomingUpdatedAt < stored) {
            await auditLog(tx, req.user.id, 'SYNC_CONFLICT', record.table_name, record.record_id, { incoming: data.updated_at, stored: storedUpdatedAt }, req.ip);
            // ponytail: minimal ack only — never return the server row (PHI exfiltration).
            outcome = { record_id: record.record_id, status: 'conflict' };
          }
        }
      }
      if (!outcome) {
        // Strip contract-only keys (e.g. updated_at) that are not table columns
        const cols = await syncColumns(tx, record.table_name);
        const clean = {};
        for (const [k, v] of Object.entries(data)) {
          if (cols.has(k)) clean[k] = v;
        }
        if (!clean.id) clean.id = data.id || record.record_id;
        await applySyncUpsert(tx, record.table_name, clean);
        outcome = { record_id: record.record_id, status: 'synced', action: record.action };
      }
    }
  } catch (err) {
    outcome = fail(err.message);
  }

  await tx.prepare(`INSERT INTO sync_queue (id, table_name, record_id, action, data, client_mutation_id, result, synced, synced_at) VALUES (?,?,?,?,?,?,?,1,NOW())`)
    .run(uuidv4(), record.table_name, record.record_id, record.action, JSON.stringify(data), mutationId, JSON.stringify(outcome));
  return outcome;
}

module.exports = { createRoutes };
