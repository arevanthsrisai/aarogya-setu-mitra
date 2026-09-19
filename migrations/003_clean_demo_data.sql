-- 003: Replace test/AI-generated patient data with realistic demo patients.
-- Keeps users, demo accounts, audit_logs and sync_queue intact.
-- Keepers: p-lakshmi, p-arjun, p-meena. All other patients (E2E_*, XSS test
-- rows, duplicates) are deleted together with their child rows, in FK order
-- (caregivers.consent_id -> consents, so caregivers must go first).

BEGIN;

DELETE FROM caregivers WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');

DELETE FROM teleconsultations
 WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena')
    OR referral_id IN (SELECT id FROM referrals WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena'));

DELETE FROM referral_events
 WHERE referral_id IN (SELECT id FROM referrals WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena'));

DELETE FROM referrals WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');

DELETE FROM extracted_values
 WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena')
    OR document_id IN (SELECT id FROM documents WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena'));

DELETE FROM documents WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');

DELETE FROM observations
 WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena')
    OR encounter_id IN (SELECT id FROM encounters WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena'));

DELETE FROM encounters WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');

DELETE FROM consents WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');

DELETE FROM anc_visits      WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');
DELETE FROM conditions      WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');
DELETE FROM followup_schedule WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');
DELETE FROM hbnc_visits     WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');
DELETE FROM immunizations   WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');
DELETE FROM medications     WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');
DELETE FROM ncd_followups   WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');
DELETE FROM triage_results  WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');
DELETE FROM alerts          WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');
DELETE FROM fhir_resources  WHERE patient_id NOT IN ('p-lakshmi','p-arjun','p-meena');

DELETE FROM patients WHERE id NOT IN ('p-lakshmi','p-arjun','p-meena');

INSERT INTO patients (id, temporary_id, first_name, last_name, age, gender, phone, village, district, state, household_id, blood_group, registered_by) VALUES
('p-sunita','TMP-010','Sunita','Devi',34,'F','+91-9822000010','Wadgaon','Pune','Maharashtra','hh-001','B+','u-asha1'),
('p-ramesh','TMP-011','Ramesh','Patil',52,'M','+91-9822000011','Wadgaon','Pune','Maharashtra','hh-001','O+','u-asha1'),
('p-anita','TMP-012','Anita','Kulkarni',26,'F','+91-9822000012','Wadgaon','Pune','Maharashtra','hh-001','A+','u-asha1'),
('p-vikram','TMP-013','Vikram','Deshmukh',45,'M','+91-9822000013','Wadgaon','Pune','Maharashtra','hh-001','AB+','u-asha1'),
('p-geeta','TMP-014','Geeta','Shinde',7,'F','+91-9822000014','Wadgaon','Pune','Maharashtra','hh-001','O+','u-asha1'),
('p-shyam','TMP-015','Shyam','Jadhav',60,'M','+91-9822000015','Khed','Pune','Maharashtra','hh-001','B-','u-asha1'),
('p-pooja','TMP-016','Pooja','Kale',31,'F','+91-9822000016','Khed','Pune','Maharashtra','hh-001','A-','u-asha1'),
('p-manoj','TMP-017','Manoj','Pawar',41,'M','+91-9822000017','Khed','Pune','Maharashtra','hh-001','AB-','u-asha1');

-- Re-link the caregiver demo account to a real patient (child rows above were emptied).
INSERT INTO caregivers (id, patient_id, caregiver_user_id, relationship, scope, consent_id, active)
VALUES (gen_random_uuid()::text, 'p-lakshmi', 'u-caregiver1', 'spouse', 'full', NULL, 1);

COMMIT;
