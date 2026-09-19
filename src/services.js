const { v4: uuidv4 } = require('uuid');

// ==================== TRIAGE RULES ENGINE ====================
const triageRules = [
  {
    id: 'RULE_001',
    name: 'Child High Fever with Danger Signs',
    version: '1.0',
    condition: (data) => {
      return data.age < 5 &&
        data.fever_duration_days >= 3 &&
        (data.no_urination_hours >= 8 || data.lethargy === true);
    },
    risk: 'HIGH',
    recommendation: 'Immediate referral for teleconsultation/PHC visit. Child under 5 with prolonged fever and danger signs.'
  },
  {
    id: 'RULE_002',
    name: 'Child Severe Dehydration',
    version: '1.0',
    condition: (data) => {
      return data.age < 5 &&
        data.diarrhea === true &&
        (data.sunken_eyes === true || data.skin_turgor_poor === true || data.no_urination_hours >= 6);
    },
    risk: 'HIGH',
    recommendation: 'Start ORS immediately. Refer to nearest health facility. Possible severe dehydration.'
  },
  {
    id: 'RULE_003',
    name: 'High Blood Pressure',
    version: '1.0',
    condition: (data) => {
      return data.bp_systolic >= 180 || data.bp_diastolic >= 110;
    },
    risk: 'CRITICAL',
    recommendation: 'Hypertensive crisis suspected. Immediate referral required.'
  },
  {
    id: 'RULE_004',
    name: 'Moderate Blood Pressure',
    version: '1.0',
    condition: (data) => {
      return (data.bp_systolic >= 140 && data.bp_systolic < 180) || 
             (data.bp_diastolic >= 90 && data.bp_diastolic < 110);
    },
    risk: 'MEDIUM',
    recommendation: 'Elevated blood pressure detected. Schedule follow-up. Consider NCD screening.'
  },
  {
    id: 'RULE_005',
    name: 'Severe Anemia',
    version: '1.0',
    condition: (data) => {
      return data.hemoglobin !== undefined && data.hemoglobin < 7;
    },
    risk: 'HIGH',
    recommendation: 'Severe anemia detected. Immediate referral for evaluation and possible transfusion.'
  },
  {
    id: 'RULE_006',
    name: 'Moderate Anemia',
    version: '1.0',
    condition: (data) => {
      return data.hemoglobin !== undefined && data.hemoglobin >= 7 && data.hemoglobin < 10;
    },
    risk: 'MEDIUM',
    recommendation: 'Moderate anemia. Prescribe iron supplements. Follow up in 2 weeks.'
  },
  {
    id: 'RULE_007',
    name: 'High Blood Sugar',
    version: '1.0',
    condition: (data) => {
      return data.blood_sugar_fasting >= 200 || data.blood_sugar_random >= 300;
    },
    risk: 'HIGH',
    recommendation: 'Very high blood sugar. Immediate referral for diabetic management.'
  },
  {
    id: 'RULE_008',
    name: 'ANC High Risk - Pre-eclampsia Signs',
    version: '1.0',
    condition: (data) => {
      return data.pregnant === true &&
        data.bp_systolic >= 140 && data.bp_diastolic >= 90 &&
        (data.urine_protein === 'positive' || data.headache === true || data.blurred_vision === true);
    },
    risk: 'CRITICAL',
    recommendation: 'Pre-eclampsia suspected. Immediate referral to higher facility.'
  },
  {
    id: 'RULE_009',
    name: 'Newborn Danger Signs',
    version: '1.0',
    condition: (data) => {
      return data.age_days !== undefined && data.age_days <= 28 &&
        (data.not_feeding === true || data.temperature < 35.5 || data.temperature > 38 || data.breathing_fast === true);
    },
    risk: 'HIGH',
    recommendation: 'Newborn danger signs detected. Immediate referral to facility with newborn care.'
  },
  {
    id: 'RULE_010',
    name: 'General Low Risk',
    version: '1.0',
    condition: (data) => true, // Fallback
    risk: 'LOW',
    recommendation: 'No immediate danger signs detected. Continue routine monitoring.'
  }
];

function runTriage(patientData) {
  const triggeredRules = [];
  let highestRisk = 'LOW';
  const riskLevels = { 'LOW': 0, 'MEDIUM': 1, 'HIGH': 2, 'CRITICAL': 3 };

  for (const rule of triageRules) {
    if (rule.id === 'RULE_010') continue; // Skip fallback until end
    try {
      if (rule.condition(patientData)) {
        triggeredRules.push({
          ruleId: rule.id,
          name: rule.name,
          risk: rule.risk,
          recommendation: rule.recommendation
        });
        if (riskLevels[rule.risk] > riskLevels[highestRisk]) {
          highestRisk = rule.risk;
        }
      }
    } catch (e) {
      // Rule evaluation error, skip
    }
  }

  if (triggeredRules.length === 0) {
    triggeredRules.push({
      ruleId: 'RULE_010',
      name: 'General Low Risk',
      risk: 'LOW',
      recommendation: triageRules.find(r => r.id === 'RULE_010').recommendation
    });
  }

  return {
    riskLevel: highestRisk,
    score: riskLevels[highestRisk] * 33,
    rulesTriggered: triggeredRules,
    recommendation: triggeredRules.length > 0 ? triggeredRules[0].recommendation : 'Continue routine monitoring.'
  };
}

// ==================== TREND DETECTION ENGINE ====================
function detectTrends(observations) {
  const grouped = {};
  for (const obs of observations) {
    if (!grouped[obs.type]) grouped[obs.type] = [];
    grouped[obs.type].push(obs);
  }

  const trends = [];
  const AI_DISCLAIMER = "This is a pattern noticed in your health records based on available data, not a medical diagnosis. Please discuss this with your ASHA worker, ANM, or doctor.";

  for (const [type, records] of Object.entries(grouped)) {
    if (records.length < 2) continue;
    
    // Sort by date
    records.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
    
    const values = records.map(r => r.value).filter(v => v !== null && v !== undefined);
    if (values.length < 2) continue;

    // Calculate trend direction
    let increasing = 0, decreasing = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[i-1]) increasing++;
      else if (values[i] < values[i-1]) decreasing++;
    }

    const totalChanges = increasing + decreasing;
    if (totalChanges === 0) continue;

    let direction = 'stable';
    let severity = 'INFO';
    let requiresReview = false;

    if (decreasing / totalChanges >= 0.67) {
      direction = 'downward';
    } else if (increasing / totalChanges >= 0.67) {
      direction = 'upward';
    }

    if (direction === 'stable') continue;

    // Determine severity based on type and direction
    const fieldDisplayName = getFieldDisplayName(type);
    let message = `${fieldDisplayName} shows a ${direction} trend over ${values.length} measurements: ${values.join(' → ')}.`;

    if (type === 'hemoglobin' && direction === 'downward') {
      severity = values[values.length - 1] < 8 ? 'WARNING' : 'INFO';
      requiresReview = values[values.length - 1] < 8;
      message += ' Declining hemoglobin levels may indicate anemia.';
    } else if (type === 'bp_systolic' && direction === 'upward') {
      severity = values[values.length - 1] >= 160 ? 'WARNING' : 'INFO';
      requiresReview = values[values.length - 1] >= 160;
      message += ' Rising blood pressure requires monitoring.';
    } else if (type === 'bp_diastolic' && direction === 'upward') {
      severity = values[values.length - 1] >= 100 ? 'WARNING' : 'INFO';
      requiresReview = values[values.length - 1] >= 100;
    } else if (type === 'blood_sugar_fasting' && direction === 'upward') {
      severity = values[values.length - 1] >= 126 ? 'WARNING' : 'INFO';
      requiresReview = values[values.length - 1] >= 126;
      message += ' Rising fasting blood sugar may need evaluation.';
    } else if (type === 'weight' && direction === 'downward') {
      severity = 'INFO';
      message += ' Unintended weight loss should be monitored.';
    } else if (type === 'bilirubin' && direction === 'upward') {
      severity = values[values.length - 1] > 2 ? 'WARNING' : 'INFO';
      requiresReview = true;
      message += ' Rising bilirubin needs evaluation.';
    }

    trends.push({
      type,
      displayName: fieldDisplayName,
      direction,
      values,
      dates: records.map(r => r.recorded_at),
      severity,
      requiresReview,
      message,
      disclaimer: AI_DISCLAIMER
    });
  }

  return trends;
}

function getFieldDisplayName(type) {
  const names = {
    'hemoglobin': 'Hemoglobin (Hb)',
    'bp_systolic': 'Blood Pressure (Systolic)',
    'bp_diastolic': 'Blood Pressure (Diastolic)',
    'blood_sugar_fasting': 'Blood Sugar (Fasting)',
    'blood_sugar_random': 'Blood Sugar (Random)',
    'blood_sugar_pp': 'Blood Sugar (Post-Prandial)',
    'weight': 'Weight',
    'bilirubin': 'Bilirubin',
    'temperature': 'Temperature',
    'heart_rate': 'Heart Rate',
    'respiratory_rate': 'Respiratory Rate',
    'spo2': 'SpO2'
  };
  return names[type] || type;
}

// ==================== AI SUMMARY GENERATOR ====================
function generatePatientSummary(patient, observations, conditions, medications) {
  const AI_DISCLAIMER = "This is a pattern noticed in your health records based on available data, not a medical diagnosis. Please discuss this with your ASHA worker, ANM, or doctor.";
  
  let summary = `Patient: ${patient.first_name} ${patient.last_name || ''}, Age: ${patient.age || 'Unknown'}, Gender: ${patient.gender || 'Unknown'}\n`;
  summary += `Village: ${patient.village || 'Unknown'}\n\n`;

  if (conditions && conditions.length > 0) {
    summary += `Active Conditions:\n`;
    for (const c of conditions) {
      summary += `- ${c.display_name} (${c.status})\n`;
    }
    summary += '\n';
  }

  if (medications && medications.length > 0) {
    summary += `Current Medications:\n`;
    for (const m of medications) {
      summary += `- ${m.medication_name} ${m.dosage || ''} ${m.frequency || ''}\n`;
    }
    summary += '\n';
  }

  if (observations && observations.length > 0) {
    const latest = {};
    for (const obs of observations) {
      if (!latest[obs.type] || new Date(obs.recorded_at) > new Date(latest[obs.type].recorded_at)) {
        latest[obs.type] = obs;
      }
    }
    summary += `Latest Observations:\n`;
    for (const [type, obs] of Object.entries(latest)) {
      summary += `- ${getFieldDisplayName(type)}: ${obs.value} ${obs.unit || ''} (${obs.recorded_at})\n`;
    }
    summary += '\n';
  }

  const trends = detectTrends(observations || []);
  if (trends.length > 0) {
    summary += `Detected Trends:\n`;
    for (const t of trends) {
      summary += `- ${t.message}\n`;
    }
    summary += '\n';
  }

  return {
    summary,
    trends,
    disclaimer: AI_DISCLAIMER,
    generatedAt: new Date().toISOString(),
    isAIGenerated: false,
    source: 'deterministic_analysis'
  };
}

// ==================== REFERRAL STATE MACHINE ====================
const REFERRAL_TRANSITIONS = {
  'BOOKED': ['SEEN', 'CANCELLED'],
  'SEEN': ['REFERRED', 'CLOSED'],
  'REFERRED': ['ARRIVED', 'CANCELLED'],
  'ARRIVED': ['TREATED', 'REFERRED'],
  'TREATED': ['CLOSED'],
  'CLOSED': [],
  'CANCELLED': []
};

function canTransition(currentState, newState) {
  const allowed = REFERRAL_TRANSITIONS[currentState];
  return allowed && allowed.includes(newState);
}

// ==================== CONSENT CHECK ====================
async function checkConsent(db, patientId, requesterId, requiredScope) {
  const consent = await db.prepare(`
    SELECT * FROM consents 
    WHERE patient_id = ? AND requester_id = ? AND status = 'granted'
    AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY granted_at DESC LIMIT 1
  `).get(patientId, requesterId);

  if (!consent) return { allowed: false, reason: 'No active consent found' };

  const scopeHierarchy = { 'appointment_only': 1, 'selected_records': 2, 'full': 3 };
  const requiredLevel = scopeHierarchy[requiredScope] || 3;
  const grantedLevel = scopeHierarchy[consent.scope] || 0;

  if (grantedLevel < requiredLevel) {
    return { allowed: false, reason: `Consent scope '${consent.scope}' insufficient for '${requiredScope}'` };
  }

  return { allowed: true, consent };
}

// ==================== RADAR SERVICE ====================
async function queryRadar(db, { facilityName, district, medicineName, doctorName }) {
  let results = { facilities: [], doctors: [], medicines: [] };

  // Facility search
  let facilityQuery = 'SELECT * FROM facilities WHERE 1=1';
  const params = [];
  if (facilityName) { facilityQuery += ' AND name ILIKE ?'; params.push(`%${facilityName}%`); }
  if (district) { facilityQuery += ' AND district ILIKE ?'; params.push(`%${district}%`); }
  results.facilities = await db.prepare(facilityQuery).all(...params);

  // Doctor availability
  if (results.facilities.length > 0) {
    const facilityIds = results.facilities.map(f => f.id);
    const placeholders = facilityIds.map(() => '?').join(',');
    results.doctors = await db.prepare(`
      SELECT da.*, u.full_name as doctor_name, f.name as facility_name
      FROM doctor_availability da
      JOIN users u ON da.doctor_id = u.id
      JOIN facilities f ON da.facility_id = f.id
      WHERE da.facility_id IN (${placeholders}) AND da.is_available = 1
    `).all(...facilityIds);
  }

  // Medicine search
  if (medicineName) {
    let medQuery = 'SELECT ms.*, f.name as facility_name FROM medicine_stock ms JOIN facilities f ON ms.facility_id = f.id WHERE ms.medicine_name ILIKE ?';
    const medParams = [`%${medicineName}%`];
    if (district) {
      medQuery += ' AND f.district ILIKE ?';
      medParams.push(`%${district}%`);
    }
    results.medicines = await db.prepare(medQuery).all(...medParams);
  } else if (results.facilities.length > 0) {
    const facilityIds = results.facilities.map(f => f.id);
    const placeholders = facilityIds.map(() => '?').join(',');
    results.medicines = await db.prepare(`
      SELECT ms.*, f.name as facility_name FROM medicine_stock ms 
      JOIN facilities f ON ms.facility_id = f.id
      WHERE ms.facility_id IN (${placeholders})
    `).all(...facilityIds);
  }

  return results;
}

// ==================== DASHBOARD METRICS ====================
async function getDashboardMetrics(db, role, facilityId, district) {
  const metrics = {};

  // Total patients
  metrics.totalPatients = (await db.prepare('SELECT COUNT(*) as count FROM patients').get()).count;

  // Referral metrics
  const referralStats = await db.prepare(`
    SELECT status, COUNT(*) as count FROM referrals GROUP BY status
  `).all();
  metrics.referralsByStatus = {};
  let totalReferrals = 0;
  let completedReferrals = 0;
  for (const r of referralStats) {
    metrics.referralsByStatus[r.status] = r.count;
    totalReferrals += r.count;
    if (r.status === 'CLOSED' || r.status === 'TREATED') completedReferrals += r.count;
  }
  metrics.totalReferrals = totalReferrals;
  metrics.referralCompletionRate = totalReferrals > 0 ? Math.round((completedReferrals / totalReferrals) * 100) : 0;

  // Pending referrals
  metrics.pendingReferrals = (await db.prepare("SELECT COUNT(*) as count FROM referrals WHERE status NOT IN ('CLOSED','CANCELLED','TREATED')").get()).count;

  // Escalated referrals
  metrics.escalatedReferrals = (await db.prepare("SELECT COUNT(*) as count FROM referrals WHERE escalated = 1").get()).count;

  // Follow-up compliance
  const followups = (await db.prepare("SELECT COUNT(*) as total FROM followup_schedule").get()).total;
  const completedFollowups = (await db.prepare("SELECT COUNT(*) as count FROM followup_schedule WHERE status = 'completed'").get()).count;
  metrics.followupCompliance = followups > 0 ? Math.round((completedFollowups / followups) * 100) : 0;
  metrics.totalFollowups = followups;
  metrics.completedFollowups = completedFollowups;

  // Stockout frequency
  metrics.stockouts = (await db.prepare("SELECT COUNT(*) as count FROM medicine_stock WHERE status = 'OUT_OF_STOCK'").get()).count;
  metrics.lowStock = (await db.prepare("SELECT COUNT(*) as count FROM medicine_stock WHERE status = 'LOW_STOCK'").get()).count;

  // Doctor attendance (based on availability entries)
  metrics.totalDoctors = (await db.prepare("SELECT COUNT(DISTINCT doctor_id) as count FROM doctor_availability").get()).count;
  metrics.availableDoctors = (await db.prepare("SELECT COUNT(DISTINCT doctor_id) as count FROM doctor_availability WHERE is_available = 1").get()).count;

  // Facility performance
  metrics.facilities = await db.prepare(`
    SELECT f.id, f.name, f.type,
      (SELECT COUNT(*) FROM referrals WHERE receiving_facility_id = f.id) as total_referrals,
      (SELECT COUNT(*) FROM referrals WHERE receiving_facility_id = f.id AND status IN ('CLOSED','TREATED')) as completed_referrals,
      (SELECT COUNT(*) FROM medicine_stock WHERE facility_id = f.id AND status = 'OUT_OF_STOCK') as stockouts
    FROM facilities f
  `).all();

  // Triage summary
  metrics.triageByRisk = {};
  const triageStats = await db.prepare('SELECT risk_level, COUNT(*) as count FROM triage_results GROUP BY risk_level').all();
  for (const t of triageStats) {
    metrics.triageByRisk[t.risk_level] = t.count;
  }

  // Recent alerts
  metrics.recentAlerts = await db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 10').all();

  // Geographic breakdown  
  metrics.patientsByDistrict = await db.prepare('SELECT district, COUNT(*) as count FROM patients WHERE district IS NOT NULL GROUP BY district').all();
  metrics.patientsByVillage = await db.prepare('SELECT village, COUNT(*) as count FROM patients WHERE village IS NOT NULL GROUP BY village').all();

  return metrics;
}

// ==================== FHIR RESOURCE MAPPER ====================
function toFHIRPatient(patient) {
  return {
    resourceType: 'Patient',
    id: patient.id,
    identifier: [
      patient.abha_id ? { system: 'https://healthid.abdm.gov.in', value: patient.abha_id } : null,
      patient.temporary_id ? { system: 'local', value: patient.temporary_id } : null
    ].filter(Boolean),
    name: [{ given: [patient.first_name], family: patient.last_name || '' }],
    gender: patient.gender === 'M' ? 'male' : patient.gender === 'F' ? 'female' : 'unknown',
    birthDate: patient.date_of_birth,
    address: [{ text: patient.address, city: patient.village, district: patient.district, state: patient.state }]
  };
}

function toFHIRObservation(obs) {
  return {
    resourceType: 'Observation',
    id: obs.id,
    status: 'final',
    code: { text: obs.type },
    subject: { reference: `Patient/${obs.patient_id}` },
    effectiveDateTime: obs.recorded_at,
    valueQuantity: { value: obs.value, unit: obs.unit }
  };
}

function toFHIREncounter(enc) {
  return {
    resourceType: 'Encounter',
    id: enc.id,
    status: 'finished',
    class: { code: enc.type },
    subject: { reference: `Patient/${enc.patient_id}` },
    period: { start: enc.date }
  };
}

function toFHIRCondition(cond) {
  return {
    resourceType: 'Condition',
    id: cond.id,
    clinicalStatus: { coding: [{ code: cond.status }] },
    code: { text: cond.display_name },
    subject: { reference: `Patient/${cond.patient_id}` },
    onsetDateTime: cond.onset_date
  };
}

function toFHIRServiceRequest(referral) {
  const statusMap = {
    'BOOKED': 'active',
    'SEEN': 'active',
    'REFERRED': 'active',
    'ARRIVED': 'active',
    'TREATED': 'completed',
    'CLOSED': 'completed',
    'CANCELLED': 'revoked'
  };
  return {
    resourceType: 'ServiceRequest',
    id: referral.id,
    status: statusMap[referral.status] || 'active',
    intent: 'order',
    priority: referral.priority === 'HIGH' ? 'urgent' : 'routine',
    subject: { reference: `Patient/${referral.patient_id}` },
    reasonCode: [{ text: referral.reason }],
    authoredOn: referral.created_at
  };
}

function toFHIRImmunization(imm) {
  return {
    resourceType: 'Immunization',
    id: imm.id,
    status: imm.status === 'given' ? 'completed' : 'not-done',
    vaccineCode: { text: imm.vaccine_name },
    patient: { reference: `Patient/${imm.patient_id}` },
    occurrenceDateTime: imm.date_given || imm.due_date,
    protocolApplied: [{ doseNumberPositiveInt: imm.dose_number || 1 }]
  };
}

function toFHIRMedication(med) {
  return {
    resourceType: 'MedicationStatement',
    id: med.id,
    status: med.status === 'active' ? 'active' : 'completed',
    medicationCodeableConcept: { text: med.medication_name },
    subject: { reference: `Patient/${med.patient_id}` },
    dosage: [{ text: `${med.dosage || ''} ${med.frequency || ''}` }]
  };
}

module.exports = {
  triageRules,
  runTriage,
  detectTrends,
  generatePatientSummary,
  getFieldDisplayName,
  REFERRAL_TRANSITIONS,
  canTransition,
  checkConsent,
  queryRadar,
  getDashboardMetrics,
  toFHIRPatient,
  toFHIRObservation,
  toFHIREncounter,
  toFHIRCondition,
  toFHIRServiceRequest,
  toFHIRImmunization,
  toFHIRMedication
};

