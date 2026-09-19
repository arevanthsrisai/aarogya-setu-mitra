# AUDIT.md — Codebase & Interactive Element Inventory

## 1. File / Module Map
- [server.js](file:///c:/Users/Revanth/Desktop/SIH/prototype/server.js): Main application entry point, Express server configuration, database initialization, CORS, static file serving (`/public`), SPA fallback routing.
- [src/database.js](file:///c:/Users/Revanth/Desktop/SIH/prototype/src/database.js): SQLite database initialization, schema definition (18 relational tables), indices, and demo data seeder.
- [src/middleware.js](file:///c:/Users/Revanth/Desktop/SIH/prototype/src/middleware.js): Authentication (JWT validation), RBAC role checks (`requireRole`), and audit log writer.
- [src/services.js](file:///c:/Users/Revanth/Desktop/SIH/prototype/src/services.js): Core business logic rules engine (10 versioned triage rules), trend detection, AI summary generator, referral state transition validator, RADAR search service, FHIR resource mappers.
- [src/routes.js](file:///c:/Users/Revanth/Desktop/SIH/prototype/src/routes.js): Express router definitions for Auth, Patients, Encounters, Observations, Triage, Referrals, Teleconsultations, Telecom (SMS/IVR), Facilities/RADAR, Medicine Stock, Consents, Caregivers, Dashboard, HBNC, ANC, Immunizations, NCD, Documents/OCR, Audit Logs, Offline Sync, and FHIR bundles.
- [public/index.html](file:///c:/Users/Revanth/Desktop/SIH/prototype/public/index.html): SPA HTML shell with viewport, dark theme CSS link, and script imports.
- [public/style.css](file:///c:/Users/Revanth/Desktop/SIH/prototype/public/style.css): Production glassmorphism CSS design system with CSS variables, animations, grid systems, custom buttons, badges, modals, and responsive layout.
- [public/app.js](file:///c:/Users/Revanth/Desktop/SIH/prototype/public/app.js): Single Page Application client-side JavaScript engine managing state, router, API fetch wrapper, offline sync queue, multilingual state, and UI view rendering.
- [tests/run-tests.js](file:///c:/Users/Revanth/Desktop/SIH/prototype/tests/run-tests.js): Automated E2E integration test suite covering 12 core workflow scenarios.
- [tests/bug-hunter.js](file:///c:/Users/Revanth/Desktop/SIH/prototype/tests/bug-hunter.js): Automated edge case & stress test suite covering SQL injection, XSS escaping, malformed JWTs, illegal state transitions, and missing payload fallback.

---

## 2. Screen / Page Inventory & Interactive Element Audit

### Screen 1: Login Screen (`#login-screen`)
- **Username Field** (`#login-username`): Input text for username. *Working*.
- **Password Field** (`#login-password`): Input password. *Working*.
- **Sign In Button** (`button[type=submit]`): Submits auth request, stores JWT, navigates to app. *Working*.
- **Quick Login Chips** (`.quick-login-chips .chip`): 6 chips (ASHA, PHC Doctor, Hospital Doctor, THO, DHO, Caregiver). Immediately authenticates as demo role. *Working*.

### Screen 2: Patient Registry (`#patients-view`)
- **Search Input** (`#patient-search`): Live text search filtering patient table by name, ID, village. *Working*.
- **+ Register Patient Button** (`showRegisterPatientModal()`): Opens registration modal. *Working*.
- **Registration Modal Submit** (`#reg-patient-form`): Registers new patient via `POST /api/patients`. *Working*.
- **View Record Button** (`navigateTo('patient_detail')`): Opens full medical record view. *Working*.
- **Run Triage Button** (`navigateTo('triage')`): Opens triage engine with patient pre-selected. *Working*.

### Screen 3: Patient Medical Record & AI Summary (`#patient-detail-view`)
- **Run Triage Button**: Triggers triage for patient. *Working*.
- **Create Referral Button**: Opens referral ticket creation modal. *Working*.
- **+ Record Vitals Button**: Opens modal to add hemoglobin, BP, blood sugar, weight, temp. *Working*.
- **Vitals Form Submit**: Saves observation via `POST /api/observations`. *Working*.
- **AI Summary Display**: Shows aggregated clinical history & trend alerts with mandatory medical disclaimer. *Working*.

### Screen 4: Clinical Triage & Decision Engine (`#triage-view`)
- **Patient Dropdown** (`#triage-patient`): Selects patient. *Working*.
- **Fever Duration Input** (`#tr-fever`): Numeric input in days. *Working*.
- **Urination Hours Input** (`#tr-urination`): Numeric input in hours. *Working*.
- **Danger Signs Checkboxes** (Lethargy, Diarrhea, Dehydration): Boolean check toggles. *Working*.
- **BP & Hb Inputs** (Systolic, Diastolic, Hb): Numeric inputs. *Working*.
- **Execute Rule Evaluation Button**: Evaluates 10 clinical rules, returns Risk Level & Recommendation. *Working*.
- **Route to Teleconsult Button**: Appears on HIGH/CRITICAL risk to immediately generate referral. *Working*.

### Screen 5: Teleconsultation & Referrals (`#referrals-view`)
- **+ New Referral Ticket Button**: Opens referral creation modal. *Working*.
- **Referral Ticket Submit**: Submits ticket via `POST /api/referrals`. *Working*.
- **Manage Lifecycle Button**: Opens modal displaying state history and next allowed state buttons. *Working*.
- **Transition to [STATE] Buttons**: Advances referral status (`BOOKED` ➔ `SEEN` ➔ `REFERRED` ➔ `ARRIVED` ➔ `TREATED` ➔ `CLOSED`). *Working*.
- **Escalate to Supervisor Button**: Escalates ticket to THO/DHO level. *Working*.

### Screen 6: Maternal & Child Health (`#maternal-child-view`)
- **Record ANC Pregnancy Visit Form**: Submits ANC record (gestational age, weight, BP, Hb). *Working*.
- **Record HBNC Newborn Visit Form**: Submits HBNC infant visit record (visit number, weight, temp, feeding). *Working*.

### Screen 7: Document Intelligence & OCR Scanner (`#ocr-scanner-view`)
- **Patient Select Dropdown**: Target patient selection. *Working*.
- **Raw OCR Text Input**: Textarea for lab report text. *Working*.
- **Process Document & Extract Labs Button**: Extracts Hb, BP, glucose, bilirubin values into database observations. *Working*.

### Screen 8: RADAR Directory (`#radar-view`)
- **Facility / District / Medicine Inputs**: Filters for RADAR search. *Working*.
- **Query Live RADAR Directory Button**: Queries real-time doctor availability & medicine stock. *Working*.

### Screen 9: Health Officer Dashboard (`#dashboard-view`)
- **Metrics Cards**: Displays total patients, referral completion rate %, stockouts, doctor availability. *Working*.
- **Facility Performance Table**: Aggregated metrics per health facility. *Working*.

### Screen 10: ABDM Consents (`#consents-view`)
- **Revoke Consent Button**: Immediately revokes consent access (triggers HTTP 403 on subsequent requests). *Working*.

### Screen 11: Caregiver Portal (`#caregiver-view`)
- **View Allowed Record Button**: Opens patient detail if consent is active. *Working*.

### Screen 12: System Audit Logs (`#audit-view`)
- **Audit Table**: Displays user, action, resource, timestamp, and details. *Working*.

### Screen 13: ABDM FHIR R4 Inspector (`#fhir-inspector-view`)
- **Patient Bundle Dropdown**: Generates and views live FHIR R4 JSON bundle. *Working*.

---

## 3. Backend API Route Map

| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| POST | `/api/auth/login` | User authentication & JWT issuance | Implemented |
| GET | `/api/auth/me` | Current user profile | Implemented |
| GET / POST | `/api/patients` | Patient directory / Registration | Implemented |
| GET / PUT | `/api/patients/:id` | Patient details / Update | Implemented |
| GET / POST | `/api/encounters` | Encounters management | Implemented |
| GET / POST | `/api/observations` | Clinical observations & vitals | Implemented |
| GET / POST | `/api/conditions` | Patient conditions | Implemented |
| GET / POST | `/api/medications` | Patient prescriptions | Implemented |
| POST | `/api/triage` | Rule-based clinical triage evaluation | Implemented |
| GET / POST | `/api/referrals` | Referral tickets creation & list | Implemented |
| GET | `/api/referrals/:id` | Referral details & state event history | Implemented |
| PUT | `/api/referrals/:id/status` | Referral state transition validator | Implemented |
| POST | `/api/referrals/:id/escalate` | Supervisor escalation | Implemented |
| GET / POST | `/api/facilities` | Facility directory & bed count | Implemented |
| GET | `/api/radar/query` | Real-time supply & doctor search | Implemented |
| PUT | `/api/stock/:id` | Update medicine inventory quantity | Implemented |
| GET / POST | `/api/consents` | ABDM consent manager | Implemented |
| PUT | `/api/consents/:id/revoke` | Instant consent revocation | Implemented |
| GET / POST | `/api/caregivers` | Caregiver link & authorized access | Implemented |
| PUT | `/api/caregivers/:id/revoke` | Revoke caregiver linkage | Implemented |
| GET | `/api/dashboard/metrics` | Officer aggregated analytics | Implemented |
| POST | `/api/hbnc` | Home-based newborn care visit | Implemented |
| POST | `/api/anc` | Antenatal care pregnancy visit | Implemented |
| POST | `/api/documents` | Document upload & OCR processing | Implemented |
| GET | `/api/audit-logs` | Immutable audit trail | Implemented |
| POST | `/api/sync/push` | Offline data queue synchronization | Implemented |
| GET | `/api/fhir/Patient/:id/everything` | FHIR R4 interoperability bundle | Implemented |
| POST | `/api/telecom/send-sms` | SMS gateway service adapter | Implemented |
| POST | `/api/telecom/ivr-query` | IVR helpline service adapter | Implemented |

---

## 4. Data Model Audit
- **users**: User credentials, role (`ASHA`, `ANM`, `PHC_DOCTOR`, `HOSPITAL_DOCTOR`, `THO`, `DHO`, `STATE_MSIS`, `CAREGIVER`, `PATIENT`), facility assignment.
- **patients**: Demographic info, `abha_id`, `temporary_id`, blood group, allergies, registration metadata.
- **households**: Household head name, village, district, socioeconomic data.
- **encounters**: Patient visits, worker ID, location, notes.
- **observations**: Vitals and lab readings (`hemoglobin`, `bp_systolic`, `bp_diastolic`, `blood_sugar_fasting`, `weight`, `temperature`, `bilirubin`).
- **conditions**: Active/resolved medical diagnoses.
- **medications**: Prescribed drugs, dosage, frequency, status.
- **referrals**: Unique `referral_code`, priority, status state machine (`BOOKED`, `SEEN`, `REFERRED`, `ARRIVED`, `TREATED`, `CLOSED`), escalation flag.
- **referral_events**: Immutably stored state transition history (`from_state`, `to_state`, `actor_id`, timestamp).
- **facilities**: Facility directory, type (`PHC`, `SDH`, `DH`, `HSC`), location, bed count.
- **doctor_availability**: Physician weekly schedules & live status.
- **medicine_stock**: Stock inventory quantity, threshold, status (`IN_STOCK`, `LOW_STOCK`, `OUT_OF_STOCK`).
- **consents**: ABDM consent tickets, scope (`appointment_only`, `selected_records`, `full`), status (`granted`, `revoked`, `expired`).
- **caregivers**: Caregiver user linkage to patient and consent ID.
- **documents**: File metadata, OCR extraction text, processing status.
- **extracted_values**: Extracted lab values from OCR scans.
- **alerts**: High-risk triage and stockout alert logs.
- **audit_logs**: Immutably recorded system audit trail.

---

## 5. Dependency Audit
- `express` (^5.2.1): Core HTTP server. *Active & secure.*
- `better-sqlite3` (^13.0.3): High-performance synchronous SQLite database driver. *Active.*
- `jsonwebtoken` (^9.0.3): JWT authentication. *Active.*
- `bcryptjs` (^3.0.3): Password hashing. *Active.*
- `cors` (^2.8.6): Cross-origin resource sharing. *Active.*
- `dotenv` (^17.4.2): Environment configuration loader. *Active.*
- `uuid` (^14.0.2): UUID generator for identifiers. *Active.*
- `multer` (^2.3.0): Multipart form data handling. *Active.*

---

## 6. Test Coverage Audit
- **Integration Test Suite** (`tests/run-tests.js`): 12 / 12 passing scenarios covering authentication, patient creation, triage rules, referral state transitions, doctor summaries, consent revocation, RADAR queries, officer analytics, trend detection, offline sync, and RBAC enforcement.
- **Bug & Stress Test Suite** (`tests/bug-hunter.js`): 10 / 10 passing bug scenarios covering SQL injection protection, XSS string escaping, malformed JWT rejection, empty login validation, illegal state transition blocking, stock boundary checks, and missing symptom fallback.
