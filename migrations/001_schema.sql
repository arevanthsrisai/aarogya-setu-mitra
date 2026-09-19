-- 001_schema.sql — Aarogya Setu Mitra / Neon Postgres schema (idempotent)
-- TEXT PKs (client-generated UUIDs), timestamptz dates, integer flags kept as integers.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  facility_id TEXT,
  phone TEXT,
  language TEXT DEFAULT 'en',
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  head_name TEXT,
  address TEXT,
  village TEXT,
  district TEXT,
  num_members INTEGER DEFAULT 0,
  socioeconomic_status TEXT,
  water_source TEXT,
  sanitation_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  abha_id TEXT,
  temporary_id TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT,
  date_of_birth TEXT,
  age INTEGER,
  gender TEXT,
  phone TEXT,
  village TEXT,
  district TEXT,
  state TEXT,
  address TEXT,
  household_id TEXT REFERENCES households(id),
  blood_group TEXT,
  allergies TEXT,
  registered_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS encounters (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  type TEXT NOT NULL,
  date TIMESTAMPTZ DEFAULT NOW(),
  worker_id TEXT REFERENCES users(id),
  facility_id TEXT,
  location TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  encounter_id TEXT REFERENCES encounters(id),
  type TEXT NOT NULL,
  value DOUBLE PRECISION,
  value_text TEXT,
  unit TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conditions (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  code TEXT,
  display_name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  onset_date TEXT,
  resolved_date TEXT,
  severity TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medications (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  medication_name TEXT NOT NULL,
  dosage TEXT,
  frequency TEXT,
  route TEXT,
  start_date TEXT,
  end_date TEXT,
  prescribed_by TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS facilities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  address TEXT,
  village TEXT,
  district TEXT,
  state TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  phone TEXT,
  services TEXT,
  bed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  referring_facility_id TEXT,
  receiving_facility_id TEXT,
  referring_user_id TEXT REFERENCES users(id),
  receiving_user_id TEXT,
  reason TEXT,
  priority TEXT DEFAULT 'NORMAL',
  status TEXT DEFAULT 'BOOKED' CHECK(status IN ('BOOKED','SEEN','REFERRED','ARRIVED','TREATED','CLOSED','CANCELLED')),
  referral_code TEXT UNIQUE,
  notes TEXT,
  escalated INTEGER DEFAULT 0,
  escalation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_events (
  id TEXT PRIMARY KEY,
  referral_id TEXT NOT NULL REFERENCES referrals(id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  actor_id TEXT REFERENCES users(id),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS doctor_availability (
  id TEXT PRIMARY KEY,
  doctor_id TEXT NOT NULL REFERENCES users(id),
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  day_of_week INTEGER,
  start_time TEXT,
  end_time TEXT,
  is_available INTEGER DEFAULT 1,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medicine_stock (
  id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  medicine_name TEXT NOT NULL,
  quantity INTEGER DEFAULT 0,
  unit TEXT DEFAULT 'tablets',
  threshold INTEGER DEFAULT 10,
  status TEXT DEFAULT 'IN_STOCK' CHECK(status IN ('IN_STOCK','LOW_STOCK','OUT_OF_STOCK')),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  requester_id TEXT NOT NULL REFERENCES users(id),
  scope TEXT DEFAULT 'full' CHECK(scope IN ('appointment_only','selected_records','full')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','granted','denied','revoked','expired')),
  purpose TEXT,
  granted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS caregivers (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  caregiver_user_id TEXT NOT NULL REFERENCES users(id),
  relationship TEXT,
  scope TEXT DEFAULT 'full' CHECK(scope IN ('appointment_only','selected_records','full')),
  consent_id TEXT REFERENCES consents(id),
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  type TEXT,
  filename TEXT,
  filepath TEXT,
  ocr_status TEXT DEFAULT 'pending',
  ocr_text TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS extracted_values (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  patient_id TEXT NOT NULL REFERENCES patients(id),
  field_name TEXT NOT NULL,
  field_value DOUBLE PRECISION,
  field_unit TEXT,
  report_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  patient_id TEXT,
  facility_id TEXT,
  type TEXT NOT NULL,
  severity TEXT DEFAULT 'INFO',
  title TEXT NOT NULL,
  message TEXT,
  read INTEGER DEFAULT 0,
  requires_review INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT,
  title TEXT NOT NULL,
  message TEXT,
  read INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS triage_results (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  encounter_id TEXT,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  score INTEGER,
  rules_triggered TEXT,
  symptoms TEXT,
  recommendation TEXT,
  assessed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hbnc_visits (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  visit_number INTEGER,
  visit_date TIMESTAMPTZ,
  weight DOUBLE PRECISION,
  temperature DOUBLE PRECISION,
  breastfeeding TEXT,
  umbilical_cord TEXT,
  danger_signs TEXT,
  worker_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anc_visits (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  visit_number INTEGER,
  visit_date TIMESTAMPTZ,
  gestational_age_weeks INTEGER,
  weight DOUBLE PRECISION,
  blood_pressure_systolic INTEGER,
  blood_pressure_diastolic INTEGER,
  hemoglobin DOUBLE PRECISION,
  urine_protein TEXT,
  fetal_heart_rate INTEGER,
  complications TEXT,
  worker_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS immunizations (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  vaccine_name TEXT NOT NULL,
  dose_number INTEGER DEFAULT 1,
  date_given TEXT,
  due_date TEXT,
  status TEXT DEFAULT 'due' CHECK(status IN ('due','given','overdue','skipped')),
  given_by TEXT,
  facility_id TEXT,
  batch_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ncd_followups (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  condition_type TEXT,
  visit_date TIMESTAMPTZ,
  blood_sugar_fasting DOUBLE PRECISION,
  blood_sugar_pp DOUBLE PRECISION,
  blood_pressure_systolic INTEGER,
  blood_pressure_diastolic INTEGER,
  medication_adherence TEXT,
  lifestyle_notes TEXT,
  next_followup_date TEXT,
  worker_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('INSERT','UPDATE','DELETE')),
  data TEXT,
  client_mutation_id TEXT,
  result TEXT,
  synced INTEGER DEFAULT 0,
  sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_client_mutation_id ON sync_queue(client_mutation_id);

CREATE TABLE IF NOT EXISTS fhir_resources (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  patient_id TEXT,
  data TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teleconsultations (
  id TEXT PRIMARY KEY,
  referral_id TEXT REFERENCES referrals(id),
  patient_id TEXT NOT NULL REFERENCES patients(id),
  doctor_id TEXT,
  asha_id TEXT,
  type TEXT DEFAULT 'store_and_forward' CHECK(type IN ('store_and_forward','scheduled','urgent')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
  chief_complaint TEXT,
  clinical_notes TEXT,
  doctor_response TEXT,
  attachments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS followup_schedule (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  type TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','completed','overdue','cancelled')),
  assigned_to TEXT,
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS translations (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  language TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(key, language)
);

-- Helpful indices (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_patients_village ON patients(village);
CREATE INDEX IF NOT EXISTS idx_patients_district ON patients(district);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(first_name, last_name);
CREATE INDEX IF NOT EXISTS idx_observations_patient ON observations(patient_id, type);
CREATE INDEX IF NOT EXISTS idx_referrals_patient ON referrals(patient_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_stock_facility ON medicine_stock(facility_id);
CREATE INDEX IF NOT EXISTS idx_avail_facility ON doctor_availability(facility_id);
CREATE INDEX IF NOT EXISTS idx_alerts_patient ON alerts(patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_synced ON sync_queue(synced);
