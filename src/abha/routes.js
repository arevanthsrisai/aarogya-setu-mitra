'use strict';

/**
 * ABHA routes — wire-up (run once at server boot by the orchestrator):
 *
 *   const { registerAbhaRoutes } = require('./src/abha/routes');
 *   registerAbhaRoutes(router, db);   // `router` = the /api express Router, `db` = app db handle
 *
 * Notes for the orchestrator:
 * - All paths below are relative ('/abha/...'); mount the router at '/api'
 *   so endpoints land at '/api/abha/...' as listed in the UI CONTRACT.
 * - App-level authMiddleware already guards /api/*, so no per-route auth
 *   needed here except RBAC on link-patient (requireRole).
 * - Every `db` call is awaited (works with both sync better-sqlite3 and the
 *   async Neon pg-shim, since await on a non-promise is a no-op).
 * - Only `patients.abha_id` is written. No schema changes.
 * - ABDM secrets / RSA key / OTPs are never returned in responses or logged.
 */

const { getAbhaProvider, hasCredentials, resolveMode } = require('./provider');
const { requireRole, auditLog } = require('../middleware');
const { v4: uuidv4 } = require('uuid');

const LINK_ROLES = ['ASHA', 'ANM', 'PHC_DOCTOR'];

function providerForReq(req) {
  // Per-request factory so ABHA_MODE changes (and fallback reason) are always fresh.
  if (req.app && req.app.locals && req.app.locals.abhaProvider) return req.app.locals.abhaProvider;
  return getAbhaProvider();
}

function sendResult(res, result) {
  if (result.ok) return res.status(result.status || 200).json(result.data);
  return res.status(result.status || 400).json({ error: result.error.message, code: result.error.code });
}

function isValidAadhaar(a) {
  return /^\d{12}$/.test(String(a || '').replace(/[\s-]/g, ''));
}

function isValidMobile(m) {
  return /^[6-9]\d{9}$/.test(String(m || '').replace(/[\s+-]/g, '').slice(-10));
}

function isValidAbhaRef(v) {
  const s = String(v || '');
  return /^\d{2}-\d{4}-\d{4}-\d{4}$/.test(s) || /^[a-zA-Z0-9._-]{3,}@(abdm|sbx)$/.test(s);
}

function resolveXToken(req, paramValue) {
  // Sandbox needs the real user X-token (issued at verify); mock can resolve
  // an ABHA number/address straight from its in-memory store.
  return req.headers['x-abha-token'] || req.query.xToken || paramValue;
}

function registerAbhaRoutes(router, db) {
  // ---- Status: UI badge source of truth ---------------------------------
  router.get('/abha/status', (req, res) => {
    const provider = providerForReq(req);
    const creds = hasCredentials();
    const live = provider.mode === 'sandbox' || provider.mode === 'production';
    res.json({
      mode: resolveMode(),
      provider: provider.mode,
      connected: provider.mode === 'mock' ? true : creds,
      hasCredentials: creds,
      fallback: provider.fallback || null,
      message: provider.fallback
        ? `ABHA running in MOCK mode (${provider.fallback.reason})`
        : live
          ? `ABHA running in ${provider.mode.toUpperCase()} mode against ABDM.`
          : 'ABHA running in MOCK mode (sandbox-shaped demo data, OTP 123456).',
    });
  });

  // ---- Aadhaar OTP --------------------------------------------------------
  router.post('/abha/aadhaar/generate-otp', async (req, res) => {
    const aadhaar = String(req.body && req.body.aadhaar || '').replace(/[\s-]/g, '');
    if (!isValidAadhaar(aadhaar)) {
      return res.status(400).json({ error: 'Aadhaar must be exactly 12 digits.', code: 'INVALID_AADHAAR' });
    }
    try {
      const result = await providerForReq(req).generateAadhaarOtp({ aadhaar });
      sendResult(res, result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate Aadhaar OTP.', code: 'ABHA_ERROR' });
    }
  });

  router.post('/abha/aadhaar/verify-otp', async (req, res) => {
    const { txnId, otp } = req.body || {};
    if (!txnId || otp === undefined || String(otp).trim() === '') {
      return res.status(400).json({ error: 'txnId and otp are required.', code: 'BAD_REQUEST' });
    }
    try {
      const result = await providerForReq(req).verifyAadhaarOtp({ txnId, otp: String(otp).trim() });
      sendResult(res, result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to verify Aadhaar OTP.', code: 'ABHA_ERROR' });
    }
  });

  // ---- Mobile OTP ----------------------------------------------------------
  // Extra convenience endpoint (not in the original spec list): mints a txnId
  // for the standalone mobile flow so the UI never has to invent one.
  router.post('/abha/mobile/generate-otp', async (req, res) => {
    const { txnId, mobile } = req.body || {};
    if (!isValidMobile(mobile)) {
      return res.status(400).json({ error: 'Mobile must be a 10-digit Indian number starting 6-9.', code: 'INVALID_MOBILE' });
    }
    try {
      const result = await providerForReq(req).generateMobileOtp({ txnId, mobile });
      sendResult(res, result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate mobile OTP.', code: 'ABHA_ERROR' });
    }
  });

  router.post('/abha/mobile/verify', async (req, res) => {
    const { txnId, mobile, otp } = req.body || {};
    if (!txnId || otp === undefined || String(otp).trim() === '') {
      return res.status(400).json({ error: 'txnId and otp are required.', code: 'BAD_REQUEST' });
    }
    if (mobile !== undefined && !isValidMobile(mobile)) {
      return res.status(400).json({ error: 'Mobile must be a 10-digit Indian number starting 6-9.', code: 'INVALID_MOBILE' });
    }
    try {
      const provider = providerForReq(req);
      if (mobile !== undefined && provider.generateMobileOtp && provider.mode === 'mock') {
        // Ensure the txn carries this mobile in mock standalone flows. Best-effort; ignore errors.
        await provider.generateMobileOtp({ txnId, mobile }).catch(() => null);
      }
      const result = await provider.verifyMobileOtp({ txnId, otp: String(otp).trim() });
      sendResult(res, result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to verify mobile OTP.', code: 'ABHA_ERROR' });
    }
  });

  // ---- Profile / QR / Card ---------------------------------------------------
  router.get('/abha/profile/:abhaNumber', async (req, res) => {
    try {
      const result = await providerForReq(req).getProfile(resolveXToken(req, req.params.abhaNumber));
      sendResult(res, result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch ABHA profile.', code: 'ABHA_ERROR' });
    }
  });

  router.get('/abha/qr/:abhaNumber', async (req, res) => {
    try {
      const result = await providerForReq(req).generateQr(resolveXToken(req, req.params.abhaNumber));
      sendResult(res, result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate ABHA QR.', code: 'ABHA_ERROR' });
    }
  });

  router.get('/abha/card/:abhaNumber', async (req, res) => {
    try {
      const result = await providerForReq(req).generateCard(resolveXToken(req, req.params.abhaNumber));
      sendResult(res, result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate ABHA card.', code: 'ABHA_ERROR' });
    }
  });

  // ---- Patient linkage ---------------------------------------------------------
  router.post('/abha/link-patient', requireRole(...LINK_ROLES), async (req, res) => {
    const { patientId, abhaNumber, abhaAddress } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required.', code: 'BAD_REQUEST' });
    const ref = abhaNumber || abhaAddress;
    if (!ref || !isValidAbhaRef(ref)) {
      return res.status(400).json({ error: 'A valid abhaNumber (XX-XXXX-XXXX-XXXX) or abhaAddress (name@abdm) is required.', code: 'INVALID_ABHA_REF' });
    }
    try {
      const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found.', code: 'PATIENT_NOT_FOUND' });
      const abhaId = abhaAddress && !abhaNumber ? String(abhaAddress) : String(abhaNumber || abhaAddress);
      await db.prepare('UPDATE patients SET abha_id = ? WHERE id = ?').run(abhaId, patientId);
      try {
        await auditLog(db, req.user && req.user.id, 'ABHA_LINK', 'patient', patientId, { abha_id: abhaId }, req.ip);
      } catch (_) { /* audit must never break linkage */ }
      const updated = await db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
      res.json({ patient: updated, abhaNumber: abhaNumber || null, abhaAddress: abhaAddress || null, message: 'ABHA linked to patient.' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to link ABHA to patient.', code: 'ABHA_LINK_FAILED' });
    }
  });

  router.get('/abha/patient/:patientId', async (req, res) => {
    try {
      const patient = await db.prepare('SELECT id, abha_id FROM patients WHERE id = ?').get(req.params.patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found.', code: 'PATIENT_NOT_FOUND' });
      if (!patient.abha_id) return res.json({ patientId: patient.id, linked: false, abhaId: null });
      let profile = null;
      try {
        const r = await providerForReq(req).getProfile(resolveXToken(req, patient.abha_id));
        if (r.ok) profile = r.data;
      } catch (_) { /* linkage info survives provider misses */ }
      res.json({ patientId: patient.id, linked: true, abhaId: patient.abha_id, abha: profile });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch linked ABHA info.', code: 'ABHA_ERROR' });
    }
  });

  return router;
}

module.exports = { registerAbhaRoutes };

/* ============================================================================
 * UI CONTRACT (for the frontend agent — base path is /api, auth: Bearer JWT)
 * ----------------------------------------------------------------------------
 * GET  /api/abha/status
 *   -> 200 { mode, provider, connected, hasCredentials, fallback|null, message }
 *   UI badge: show `provider` + green when `connected`, amber + fallback msg otherwise.
 *
 * POST /api/abha/aadhaar/generate-otp   { aadhaar: "12 digits" }
 *   -> 200 { txnId, otpSent:true, message, mockOtp?: "123456", mock?:true }
 *        (mockOtp/mock present ONLY in mock mode — display mockOtp as demo hint)
 *   -> 400 { error, code:"INVALID_AADHAAR" } | 503 { error, code:"ABHA_SERVICE_UNAVAILABLE" }
 *        (send aadhaar "999999999999" to demo the 503 path)
 *
 * POST /api/abha/aadhaar/verify-otp     { txnId, otp }
 *   -> 200 { abhaProfile:{...}, abhaNumber:"27-XXXX-XXXX-XXXX",
 *            abhaAddress:"name@abdm", xToken, requiresMobileVerify:false, message }
 *        (SAVE xToken client-side; send as `X-ABHA-Token` header or ?xToken=
 *         on profile/qr/card calls when in sandbox/production mode)
 *   -> 400 { error, code:"OTP_MISMATCH" } | 410 { error, code:"TXN_EXPIRED" }
 *
 * POST /api/abha/mobile/generate-otp    { txnId?, mobile:"10 digits" }  [extra helper]
 *   -> 200 { txnId, otpSent:true, message, mockOtp?, mock? }
 *
 * POST /api/abha/mobile/verify          { txnId, mobile?, otp }
 *   -> 200 same shape as verify-otp completion.
 *
 * GET  /api/abha/profile/:abhaNumber   (headers: X-ABHA-Token: <xToken> for live mode)
 *   -> 200 { abhaProfile:{...}, abhaNumber, abhaAddress }
 *   -> 404 { error, code:"PROFILE_NOT_FOUND" }
 *
 * GET  /api/abha/qr/:abhaNumber
 *   -> 200 { abhaNumber, qrPayload, qrImage:"data:image/svg+xml;base64,...",
 *            qrDataUrl, format:"svg-data-uri" }
 *        (render qrImage in an <img>; sandbox mode returns { qrPayload, qrData, format:"abdm-qr" })
 *
 * GET  /api/abha/card/:abhaNumber
 *   -> 200 { abhaNumber, abhaAddress, name, gender, dob, dateOfBirth, mobile,
 *            email, address, profilePhoto:null, status:"ACTIVE", issuedAt, cardTitle }
 *        (render your own ABHA card UI from this JSON)
 *
 * POST /api/abha/link-patient   (roles: ASHA | ANM | PHC_DOCTOR only)
 *        { patientId, abhaNumber?, abhaAddress? }  (one of the two required)
 *   -> 200 { patient:{...updated}, abhaNumber|null, abhaAddress|null, message }
 *   -> 400 { error, code:"INVALID_ABHA_REF"|"BAD_REQUEST" } | 403 role error | 404 PATIENT_NOT_FOUND
 *
 * GET  /api/abha/patient/:patientId
 *   -> 200 { patientId, linked:false, abhaId:null }
 *        | { patientId, linked:true, abhaId, abha:{...profile-shape}|null }
 *
 * Error shape (all failures): { error:<human message>, code:<MACHINE_CODE> }.
 * Never returned: ABDM client secret, RSA key, session tokens, OTP values
 * (except mockOtp in mock mode only).
 * ========================================================================== */
