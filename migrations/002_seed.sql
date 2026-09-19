-- 002_seed.sql — demo seed data (idempotent: safe to re-apply)
-- Password hashes precomputed at build time with bcryptjs cost 10 (no runtime hashing).
-- Passwords: asha1/asha123, anm1/anm123, doctor1-5/doctor123, tho1/tho123,
--            dho1/dho123, state1/state123, caregiver1/care123, facility1/facility123

-- ---------- USERS ----------
INSERT INTO users (id, username, password_hash, full_name, role, facility_id, phone) VALUES
('u-asha1','asha1','$2b$10$j1MJbaZ4YGNK/24N2Ejfw.D5fGdyt65gzonWxqGcZ9puPXzDWkGgW','Sunita Devi','ASHA','fac-phc-wadgaon','9876543210'),
('u-anm1','anm1','$2b$10$tlGregm6AWEBlLHYA3xo.uid.axYeTAkvmL9pmZhGlF.mj6LU39S.','Kavita Sharma','ANM','fac-phc-wadgaon','9876543211'),
('u-doctor1','doctor1','$2b$10$8NU/O4bgBqBl3ferhcnAhO9TMuJzEP87zDRUtia1rK4AA9LBVIVf2','Dr. Rajesh Kumar','PHC_DOCTOR','fac-phc-wadgaon','9876543212'),
('u-doctor2','doctor2','$2b$10$8NU/O4bgBqBl3ferhcnAhO9TMuJzEP87zDRUtia1rK4AA9LBVIVf2','Dr. Priya Patel','HOSPITAL_DOCTOR','fac-sdh-baramati','9876543213'),
('u-tho1','tho1','$2b$10$C.5a8FMArqIADlmny4Y.5.PoeDP3jfZixIABA0RCm4kzDtbpha9.K','Amit Singh','THO','fac-phc-wadgaon','9876543214'),
('u-dho1','dho1','$2b$10$nuG5sZxUmzJxsGcI3VbEge0k.GU68m8LWGvbD9CW4C0o9Y/dc9mAa','Dr. Suresh Reddy','DHO','fac-dh-aundh','9876543215'),
('u-state1','state1','$2b$10$T4bWsTgmf8nIR8Mkicj8OuGLpVNBryP.5CrzXB9Rvb1j610kP9NAO','Anand Mishra','STATE_MSIS','fac-dh-aundh','9876543216'),
('u-caregiver1','caregiver1','$2b$10$kpMqghWkfRGndtIYjPQUt.6tW1K7aszuoFX3dpNwB2HqUyoylBZBS','Ramesh Patil','CAREGIVER',NULL,'9876543217'),
('u-doctor3','doctor3','$2b$10$8NU/O4bgBqBl3ferhcnAhO9TMuJzEP87zDRUtia1rK4AA9LBVIVf2','Dr. Anand Deshmukh','HOSPITAL_DOCTOR','fac-sassoon-trauma','+919876543220'),
('u-doctor4','doctor4','$2b$10$8NU/O4bgBqBl3ferhcnAhO9TMuJzEP87zDRUtia1rK4AA9LBVIVf2','Dr. Meera Kulkarni','HOSPITAL_DOCTOR','fac-mch-shirur','+919876543221'),
('u-doctor5','doctor5','$2b$10$8NU/O4bgBqBl3ferhcnAhO9TMuJzEP87zDRUtia1rK4AA9LBVIVf2','Dr. Vikram Joshi','PHC_DOCTOR','fac-chc-junnar','+919876543222'),
('u-facility1','facility1','$2b$10$1.NL5R/SiCETjmeuVS3bHunjqOFfr6mKC/VaRva4OZUd7m5T5KzUm','Facility Operator','FACILITY_STAFF','fac-phc-wadgaon','9876543218')
ON CONFLICT (username) DO NOTHING;

-- ---------- FACILITIES ----------
INSERT INTO facilities (id, name, type, address, village, district, state, latitude, longitude, phone, services, bed_count) VALUES
('fac-phc-wadgaon','PHC Wadgaon','PHC','Main Market Road, Wadgaon','Wadgaon','Pune','Maharashtra',18.7423,73.6421,'+91-20-27481001','General Outpatient, Basic Emergency, ANC & Immunization, Teleconsultation',12),
('fac-sdh-baramati','Sub-District Hospital Baramati','SDH','Station Road, Baramati','Baramati','Pune','Maharashtra',18.1517,74.5772,'+91-2112-220102','General Surgery, Obstetrics & Gynaecology, Pediatrics, Emergency Triage, ICU Support',50),
('fac-dh-aundh','District Hospital Aundh','DH','Chest Hospital Campus, Aundh','Aundh','Pune','Maharashtra',18.5602,73.8031,'+91-20-25883000','Tertiary Referral, Multispecialty Surgery, ICU/CCU, High-Risk ANC & Neonatal Care, Blood Bank',350),
('fac-hsc-khed','Health Sub-Centre Khed','HSC','Main Gram Panchayat, Khed','Khed','Pune','Maharashtra',18.9438,73.9118,'+91-2135-222004','Primary Triage, Maternal Screening, Vaccine Storage',2),
('fac-chc-junnar','CHC Junnar Community Health Centre','CHC','Fort Road, Junnar','Junnar','Pune','Maharashtra',19.2083,73.8767,'+91-2132-225010','Secondary Triage, 24/7 Emergency, Maternal Delivery, Operation Theatre, Oxygen Unit',30),
('fac-mch-shirur','Shirur Specialty Maternal & Child Hospital','MCH','Nagar Highway, Shirur','Shirur','Pune','Maharashtra',18.8273,74.3789,'+91-2138-232015','High-Risk Pregnancy, Special Newborn Care Unit (SNCU), Pediatric Care, 24/7 Delivery Suite',40),
('fac-sassoon-trauma','Sassoon General Hospital & Level-1 Trauma Centre','TERTIARY_HOSPITAL','Jay Prakash Narayan Road, Near Station, Pune','Pune City','Pune','Maharashtra',18.5284,73.8741,'+91-20-26128000','24/7 Level-1 Trauma Care, Neurosurgery, Burn Unit, Neonatal ICU, Superspecialty Tele-Consultation',500),
('fac-phc-paud','Paud Rural Primary Health Centre','PHC','Paud Village, Mulshi','Paud','Pune','Maharashtra',18.5312,73.6144,'+91-2115-223008','Primary Care, Diagnostic Testing, Basic ANC/HBNC, Teleconsultation',10)
ON CONFLICT (id) DO NOTHING;

-- ---------- DOCTOR AVAILABILITY (Mon-Fri 09:00-17:00) ----------
INSERT INTO doctor_availability (id, doctor_id, facility_id, day_of_week, start_time, end_time, is_available) VALUES
('av-d1-1','u-doctor1','fac-phc-wadgaon',1,'09:00','17:00',1),
('av-d1-2','u-doctor1','fac-phc-wadgaon',2,'09:00','17:00',1),
('av-d1-3','u-doctor1','fac-phc-wadgaon',3,'09:00','17:00',1),
('av-d1-4','u-doctor1','fac-phc-wadgaon',4,'09:00','17:00',1),
('av-d1-5','u-doctor1','fac-phc-wadgaon',5,'09:00','17:00',1),
('av-d2-1','u-doctor2','fac-sdh-baramati',1,'09:00','17:00',1),
('av-d2-2','u-doctor2','fac-sdh-baramati',2,'09:00','17:00',1),
('av-d2-3','u-doctor2','fac-sdh-baramati',3,'09:00','17:00',1),
('av-d2-4','u-doctor2','fac-sdh-baramati',4,'09:00','17:00',1),
('av-d2-5','u-doctor2','fac-sdh-baramati',5,'09:00','17:00',1),
('av-d3-1','u-doctor3','fac-sassoon-trauma',1,'09:00','17:00',1),
('av-d3-2','u-doctor3','fac-sassoon-trauma',2,'09:00','17:00',1),
('av-d3-3','u-doctor3','fac-sassoon-trauma',3,'09:00','17:00',1),
('av-d3-4','u-doctor3','fac-sassoon-trauma',4,'09:00','17:00',1),
('av-d3-5','u-doctor3','fac-sassoon-trauma',5,'09:00','17:00',1),
('av-d4-1','u-doctor4','fac-mch-shirur',1,'09:00','17:00',1),
('av-d4-2','u-doctor4','fac-mch-shirur',2,'09:00','17:00',1),
('av-d4-3','u-doctor4','fac-mch-shirur',3,'09:00','17:00',1),
('av-d4-4','u-doctor4','fac-mch-shirur',4,'09:00','17:00',1),
('av-d4-5','u-doctor4','fac-mch-shirur',5,'09:00','17:00',1),
('av-d5-1','u-doctor5','fac-chc-junnar',1,'09:00','17:00',1),
('av-d5-2','u-doctor5','fac-chc-junnar',2,'09:00','17:00',1),
('av-d5-3','u-doctor5','fac-chc-junnar',3,'09:00','17:00',1),
('av-d5-4','u-doctor5','fac-chc-junnar',4,'09:00','17:00',1),
('av-d5-5','u-doctor5','fac-chc-junnar',5,'09:00','17:00',1)
ON CONFLICT (id) DO NOTHING;

-- ---------- MEDICINE STOCK (deterministic demo quantities) ----------
INSERT INTO medicine_stock (id, facility_id, medicine_name, quantity, unit, threshold, status) VALUES
('st-wad-01','fac-phc-wadgaon','Paracetamol',120,'tablets',20,'IN_STOCK'),
('st-wad-02','fac-phc-wadgaon','Amoxicillin',85,'tablets',20,'IN_STOCK'),
('st-wad-03','fac-phc-wadgaon','ORS Packets',200,'tablets',20,'IN_STOCK'),
('st-wad-04','fac-phc-wadgaon','Iron + Folic Acid',15,'tablets',20,'LOW_STOCK'),
('st-wad-05','fac-phc-wadgaon','Metformin',90,'tablets',20,'IN_STOCK'),
('st-wad-06','fac-phc-wadgaon','Amlodipine',60,'tablets',20,'IN_STOCK'),
('st-wad-07','fac-phc-wadgaon','Insulin',12,'tablets',20,'LOW_STOCK'),
('st-wad-08','fac-phc-wadgaon','Cotrimoxazole',0,'tablets',20,'OUT_OF_STOCK'),
('st-wad-09','fac-phc-wadgaon','Oxytocin Injection',40,'tablets',20,'IN_STOCK'),
('st-wad-10','fac-phc-wadgaon','Ceftriaxone 1g',55,'tablets',20,'IN_STOCK'),
('st-bar-01','fac-sdh-baramati','Paracetamol',150,'tablets',20,'IN_STOCK'),
('st-bar-02','fac-sdh-baramati','Amoxicillin',70,'tablets',20,'IN_STOCK'),
('st-bar-03','fac-sdh-baramati','ORS Packets',180,'tablets',20,'IN_STOCK'),
('st-bar-04','fac-sdh-baramati','Iron + Folic Acid',95,'tablets',20,'IN_STOCK'),
('st-bar-05','fac-sdh-baramati','Metformin',110,'tablets',20,'IN_STOCK'),
('st-bar-06','fac-sdh-baramati','Amlodipine',45,'tablets',20,'IN_STOCK'),
('st-bar-07','fac-sdh-baramati','Insulin',30,'tablets',20,'IN_STOCK'),
('st-bar-08','fac-sdh-baramati','Cotrimoxazole',65,'tablets',20,'IN_STOCK'),
('st-bar-09','fac-sdh-baramati','Oxytocin Injection',25,'tablets',20,'IN_STOCK'),
('st-bar-10','fac-sdh-baramati','Ceftriaxone 1g',80,'tablets',20,'IN_STOCK'),
('st-aun-01','fac-dh-aundh','Paracetamol',300,'tablets',20,'IN_STOCK'),
('st-aun-02','fac-dh-aundh','Amoxicillin',140,'tablets',20,'IN_STOCK'),
('st-aun-03','fac-dh-aundh','ORS Packets',250,'tablets',20,'IN_STOCK'),
('st-aun-04','fac-dh-aundh','Iron + Folic Acid',160,'tablets',20,'IN_STOCK'),
('st-aun-05','fac-dh-aundh','Metformin',130,'tablets',20,'IN_STOCK'),
('st-aun-06','fac-dh-aundh','Amlodipine',100,'tablets',20,'IN_STOCK'),
('st-aun-07','fac-dh-aundh','Insulin',50,'tablets',20,'IN_STOCK'),
('st-aun-08','fac-dh-aundh','Cotrimoxazole',90,'tablets',20,'IN_STOCK'),
('st-aun-09','fac-dh-aundh','Oxytocin Injection',75,'tablets',20,'IN_STOCK'),
('st-aun-10','fac-dh-aundh','Ceftriaxone 1g',120,'tablets',20,'IN_STOCK'),
('st-khe-01','fac-hsc-khed','Paracetamol',40,'tablets',20,'IN_STOCK'),
('st-khe-02','fac-hsc-khed','Amoxicillin',18,'tablets',20,'LOW_STOCK'),
('st-khe-03','fac-hsc-khed','ORS Packets',60,'tablets',20,'IN_STOCK'),
('st-khe-04','fac-hsc-khed','Iron + Folic Acid',35,'tablets',20,'IN_STOCK'),
('st-khe-05','fac-hsc-khed','Metformin',22,'tablets',20,'IN_STOCK'),
('st-khe-06','fac-hsc-khed','Amlodipine',0,'tablets',20,'OUT_OF_STOCK'),
('st-khe-07','fac-hsc-khed','Insulin',8,'tablets',20,'LOW_STOCK'),
('st-khe-08','fac-hsc-khed','Cotrimoxazole',30,'tablets',20,'IN_STOCK'),
('st-khe-09','fac-hsc-khed','Oxytocin Injection',10,'tablets',20,'LOW_STOCK'),
('st-khe-10','fac-hsc-khed','Ceftriaxone 1g',25,'tablets',20,'IN_STOCK'),
('st-jun-01','fac-chc-junnar','Paracetamol',110,'tablets',20,'IN_STOCK'),
('st-jun-02','fac-chc-junnar','Amoxicillin',75,'tablets',20,'IN_STOCK'),
('st-jun-03','fac-chc-junnar','ORS Packets',130,'tablets',20,'IN_STOCK'),
('st-jun-04','fac-chc-junnar','Iron + Folic Acid',88,'tablets',20,'IN_STOCK'),
('st-jun-05','fac-chc-junnar','Metformin',64,'tablets',20,'IN_STOCK'),
('st-jun-06','fac-chc-junnar','Amlodipine',52,'tablets',20,'IN_STOCK'),
('st-jun-07','fac-chc-junnar','Insulin',20,'tablets',20,'LOW_STOCK'),
('st-jun-08','fac-chc-junnar','Cotrimoxazole',48,'tablets',20,'IN_STOCK'),
('st-jun-09','fac-chc-junnar','Oxytocin Injection',33,'tablets',20,'IN_STOCK'),
('st-jun-10','fac-chc-junnar','Ceftriaxone 1g',61,'tablets',20,'IN_STOCK'),
('st-shi-01','fac-mch-shirur','Paracetamol',95,'tablets',20,'IN_STOCK'),
('st-shi-02','fac-mch-shirur','Amoxicillin',58,'tablets',20,'IN_STOCK'),
('st-shi-03','fac-mch-shirur','ORS Packets',105,'tablets',20,'IN_STOCK'),
('st-shi-04','fac-mch-shirur','Iron + Folic Acid',140,'tablets',20,'IN_STOCK'),
('st-shi-05','fac-mch-shirur','Metformin',44,'tablets',20,'IN_STOCK'),
('st-shi-06','fac-mch-shirur','Amlodipine',39,'tablets',20,'IN_STOCK'),
('st-shi-07','fac-mch-shirur','Insulin',26,'tablets',20,'IN_STOCK'),
('st-shi-08','fac-mch-shirur','Cotrimoxazole',0,'tablets',20,'OUT_OF_STOCK'),
('st-shi-09','fac-mch-shirur','Oxytocin Injection',90,'tablets',20,'IN_STOCK'),
('st-shi-10','fac-mch-shirur','Ceftriaxone 1g',70,'tablets',20,'IN_STOCK'),
('st-sas-01','fac-sassoon-trauma','Paracetamol',400,'tablets',20,'IN_STOCK'),
('st-sas-02','fac-sassoon-trauma','Amoxicillin',220,'tablets',20,'IN_STOCK'),
('st-sas-03','fac-sassoon-trauma','ORS Packets',310,'tablets',20,'IN_STOCK'),
('st-sas-04','fac-sassoon-trauma','Iron + Folic Acid',180,'tablets',20,'IN_STOCK'),
('st-sas-05','fac-sassoon-trauma','Metformin',200,'tablets',20,'IN_STOCK'),
('st-sas-06','fac-sassoon-trauma','Amlodipine',170,'tablets',20,'IN_STOCK'),
('st-sas-07','fac-sassoon-trauma','Insulin',80,'tablets',20,'IN_STOCK'),
('st-sas-08','fac-sassoon-trauma','Cotrimoxazole',150,'tablets',20,'IN_STOCK'),
('st-sas-09','fac-sassoon-trauma','Oxytocin Injection',120,'tablets',20,'IN_STOCK'),
('st-sas-10','fac-sassoon-trauma','Ceftriaxone 1g',190,'tablets',20,'IN_STOCK'),
('st-pau-01','fac-phc-paud','Paracetamol',70,'tablets',20,'IN_STOCK'),
('st-pau-02','fac-phc-paud','Amoxicillin',42,'tablets',20,'IN_STOCK'),
('st-pau-03','fac-phc-paud','ORS Packets',85,'tablets',20,'IN_STOCK'),
('st-pau-04','fac-phc-paud','Iron + Folic Acid',50,'tablets',20,'IN_STOCK'),
('st-pau-05','fac-phc-paud','Metformin',38,'tablets',20,'IN_STOCK'),
('st-pau-06','fac-phc-paud','Amlodipine',29,'tablets',20,'IN_STOCK'),
('st-pau-07','fac-phc-paud','Insulin',14,'tablets',20,'LOW_STOCK'),
('st-pau-08','fac-phc-paud','Cotrimoxazole',36,'tablets',20,'IN_STOCK'),
('st-pau-09','fac-phc-paud','Oxytocin Injection',19,'tablets',20,'LOW_STOCK'),
('st-pau-10','fac-phc-paud','Ceftriaxone 1g',47,'tablets',20,'IN_STOCK')
ON CONFLICT (id) DO NOTHING;

-- ---------- HOUSEHOLD + DEMO PATIENTS ----------
INSERT INTO households (id, head_name, village, district, num_members) VALUES
('hh-001','Ramesh Jadhav','Wadgaon','Pune',5)
ON CONFLICT (id) DO NOTHING;

INSERT INTO patients (id, first_name, last_name, age, gender, village, district, household_id, temporary_id, registered_by) VALUES
('p-lakshmi','Lakshmi','Jadhav',28,'F','Wadgaon','Pune','hh-001','TMP-001','u-asha1'),
('p-arjun','Arjun','Jadhav',3,'M','Wadgaon','Pune','hh-001','TMP-002','u-asha1'),
('p-meena','Meena','Pawar',65,'F','Wadgaon','Pune',NULL,'TMP-003','u-asha1')
ON CONFLICT (id) DO NOTHING;

-- ---------- DEMO OBSERVATIONS (trend-detection demo) ----------
INSERT INTO observations (id, patient_id, encounter_id, type, value, unit, recorded_at, source) VALUES
('ob-hb-01','p-lakshmi',NULL,'hemoglobin',10.2,'g/dL','2026-06-15T00:00:00.000Z','lab'),
('ob-hb-02','p-lakshmi',NULL,'hemoglobin',9.1,'g/dL','2026-07-15T00:00:00.000Z','lab'),
('ob-hb-03','p-lakshmi',NULL,'hemoglobin',7.8,'g/dL','2026-08-15T00:00:00.000Z','lab'),
('ob-bps-01','p-meena',NULL,'bp_systolic',140,'mmHg','2026-06-01T00:00:00.000Z','manual'),
('ob-bps-02','p-meena',NULL,'bp_systolic',155,'mmHg','2026-07-01T00:00:00.000Z','manual'),
('ob-bps-03','p-meena',NULL,'bp_systolic',165,'mmHg','2026-08-01T00:00:00.000Z','manual'),
('ob-bpd-01','p-meena',NULL,'bp_diastolic',90,'mmHg','2026-06-01T00:00:00.000Z','manual'),
('ob-bpd-02','p-meena',NULL,'bp_diastolic',95,'mmHg','2026-07-01T00:00:00.000Z','manual'),
('ob-bpd-03','p-meena',NULL,'bp_diastolic',100,'mmHg','2026-08-01T00:00:00.000Z','manual'),
('ob-fbs-01','p-meena',NULL,'blood_sugar_fasting',110,'mg/dL','2026-06-01T00:00:00.000Z','lab'),
('ob-fbs-02','p-meena',NULL,'blood_sugar_fasting',130,'mg/dL','2026-07-01T00:00:00.000Z','lab'),
('ob-fbs-03','p-meena',NULL,'blood_sugar_fasting',150,'mg/dL','2026-08-01T00:00:00.000Z','lab')
ON CONFLICT (id) DO NOTHING;

-- ---------- TRANSLATIONS ----------
INSERT INTO translations (id, key, language, value) VALUES
('tr-01','login.title','hi','लॉगिन'),('tr-02','login.title','mr','लॉगिन'),
('tr-03','login.username','hi','उपयोगकर्ता नाम'),('tr-04','login.username','mr','वापरकर्ता नाव'),
('tr-05','login.password','hi','पासवर्ड'),('tr-06','login.password','mr','पासवर्ड'),
('tr-07','login.submit','hi','लॉगिन करें'),('tr-08','login.submit','mr','लॉगिन करा'),
('tr-09','nav.patients','hi','मरीज़'),('tr-10','nav.patients','mr','रुग्ण'),
('tr-11','nav.referrals','hi','रेफरल'),('tr-12','nav.referrals','mr','रेफरल'),
('tr-13','nav.dashboard','hi','डैशबोर्ड'),('tr-14','nav.dashboard','mr','डॅशबोर्ड'),
('tr-15','nav.radar','hi','रडार'),('tr-16','nav.radar','mr','रडार'),
('tr-17','nav.triage','hi','ट्रायज'),('tr-18','nav.triage','mr','ट्रायज'),
('tr-19','patient.register','hi','मरीज़ पंजीकरण'),('tr-20','patient.register','mr','रुग्ण नोंदणी'),
('tr-21','patient.search','hi','मरीज़ खोजें'),('tr-22','patient.search','mr','रुग्ण शोधा'),
('tr-23','patient.name','hi','नाम'),('tr-24','patient.name','mr','नाव'),
('tr-25','patient.age','hi','आयु'),('tr-26','patient.age','mr','वय'),
('tr-27','patient.village','hi','गाँव'),('tr-28','patient.village','mr','गाव'),
('tr-29','risk.high','hi','उच्च जोखिम'),('tr-30','risk.high','mr','उच्च धोका'),
('tr-31','risk.medium','hi','मध्यम जोखिम'),('tr-32','risk.medium','mr','मध्यम धोका'),
('tr-33','risk.low','hi','कम जोखिम'),('tr-34','risk.low','mr','कमी धोका')
ON CONFLICT (key, language) DO NOTHING;
