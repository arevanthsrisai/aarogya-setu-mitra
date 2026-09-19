'use strict';

/**
 * SandboxABHAProvider — real HTTPS calls to ABDM ABHA V3 (SBX or PROD).
 *
 * Field/header mapping follows docs/abha-v3-integrator-reference.md:
 * - Session: POST https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions
 *   { clientId, clientSecret } -> { accessToken, expiresIn (1200s) }.
 * - Encryption: RSA/ECB/OAEPWithSHA-1AndMGF1Padding == node:crypto
 *   publicEncrypt { RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, base64 output.
 * - Per-request headers: REQUEST-ID (uuid), TIMESTAMP (ISO-8601),
 *   Authorization: Token <accessToken>, X-token: Bearer <xToken> (profile endpoints).
 *
 * Session cache is module-level ({ accessToken, expiresAt }) with single-flight:
 * concurrent callers share one in-flight token request. Refresh when
 * now > expiresAt - 60s. OTPs/tokens are never logged — only status + REQUEST-ID.
 */

const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { ok, fail, AbhaError } = require('./provider');

const SESSION_URL = 'https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions';
const BASE_URLS = {
  sandbox: 'https://abhasbx.abdm.gov.in/abha/api',
  production: 'https://abha.abdm.gov.in/api/abha',
};
const TIMEOUT_MS = 10000;

// Module-level session cache (shared across instances).
const sessionCache = { accessToken: null, refreshToken: null, expiresAt: 0 };
let inflightSessionPromise = null;
// txnId -> aadhaar captured at generate time (verify/enrol needs both).
const aadhaarByTxn = new Map();

function rsaEncryptBase64(plainText) {
  const pem = String(process.env.ABHA_RSA_PUBLIC_KEY || '');
  if (!pem.includes('BEGIN PUBLIC KEY')) {
    throw new AbhaError('MISSING_RSA_KEY', 'ABHA_RSA_PUBLIC_KEY is not configured.', 500);
  }
  const encrypted = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
    Buffer.from(String(plainText), 'utf8')
  );
  return encrypted.toString('base64');
}

async function postJson(url, { body, accessToken, xToken, timeoutMs = TIMEOUT_MS }) {
  const requestId = randomUUID();
  const headers = {
    'Content-Type': 'application/json',
    'REQUEST-ID': requestId,
    TIMESTAMP: new Date().toISOString(),
  };
  if (accessToken) headers.Authorization = `Token ${accessToken}`;
  if (xToken) headers['X-token'] = `Bearer ${xToken}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Network/timeout only; no secrets in message.
    throw new AbhaError('ABHA_NETWORK_ERROR', `ABHA request failed: ${err.name === 'TimeoutError' ? 'timed out' : 'network error'} (request ${requestId}).`, 502);
  }
  return readResult(res, requestId);
}

async function getJson(url, { accessToken, xToken, timeoutMs = TIMEOUT_MS }) {
  const requestId = randomUUID();
  const headers = { 'REQUEST-ID': requestId, TIMESTAMP: new Date().toISOString() };
  if (accessToken) headers.Authorization = `Token ${accessToken}`;
  if (xToken) headers['X-token'] = `Bearer ${xToken}`;
  let res;
  try {
    res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new AbhaError('ABHA_NETWORK_ERROR', `ABHA request failed: ${err.name === 'TimeoutError' ? 'timed out' : 'network error'} (request ${requestId}).`, 502);
  }
  return readResult(res, requestId);
}

async function readResult(res, requestId) {
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text.slice(0, 500) }; }
  if (res.ok) return { status: res.status, data, requestId };
  const code = (data && (data.code || data.errorCode || data.error)) || `HTTP_${res.status}`;
  const message = (data && (data.message || data.errorMessage || data.details)) || `ABHA request failed with status ${res.status}`;
  // Never include tokens/OTPs: error bodies are passed through only as code+message.
  throw new AbhaError(String(code), String(message).slice(0, 500), res.status, { requestId });
}

async function fetchSessionToken() {
  const now = Date.now();
  if (sessionCache.accessToken && now < sessionCache.expiresAt - 60 * 1000) return sessionCache.accessToken;
  if (!inflightSessionPromise) {
    inflightSessionPromise = (async () => {
      const res = await fetch(SESSION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: process.env.ABDM_CLIENT_ID, clientSecret: process.env.ABDM_CLIENT_SECRET }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text().catch(() => '');
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
      if (!res.ok || !data || !data.accessToken) {
        throw new AbhaError('SESSION_FAILED', 'Failed to obtain ABDM session token.', res.status || 502);
      }
      sessionCache.accessToken = data.accessToken;
      sessionCache.refreshToken = data.refreshToken || null;
      sessionCache.expiresAt = Date.now() + (Number(data.expiresIn) || 1200) * 1000;
      return sessionCache.accessToken;
    })().finally(() => { inflightSessionPromise = null; });
  }
  return inflightSessionPromise;
}

class SandboxABHAProvider {
  constructor(mode = 'sandbox') {
    this.mode = mode === 'production' ? 'production' : 'sandbox';
    this.baseUrl = BASE_URLS[this.mode];
  }

  async createSession() {
    const token = await fetchSessionToken();
    void token;
    return ok({ expiresIn: Math.max(0, Math.round((sessionCache.expiresAt - Date.now()) / 1000)), tokenType: 'Token', mock: false });
  }

  async generateAadhaarOtp({ aadhaar }) {
    if (!/^\d{12}$/.test(String(aadhaar || ''))) return fail('INVALID_AADHAAR', 'Aadhaar must be exactly 12 digits.', 400);
    try {
      const at = await fetchSessionToken();
      const { status, data } = await postJson(`${this.baseUrl}/v3/enrollment/request/otp`, {
        accessToken: at, body: { aadhaar: rsaEncryptBase64(aadhaar) },
      });
      if (data && data.txnId) aadhaarByTxn.set(data.txnId, String(aadhaar));
      return ok({ txnId: data.txnId, otpSent: true, message: (data && data.message) || 'OTP sent to Aadhaar-registered mobile.' }, status);
    } catch (err) {
      return this._err(err);
    }
  }

  async verifyAadhaarOtp({ txnId, otp }) {
    if (!txnId || otp === undefined) return fail('BAD_REQUEST', 'txnId and otp are required.', 400);
    try {
      const at = await fetchSessionToken();
      const aadhaar = aadhaarByTxn.get(txnId);
      const body = {
        authData: { authMethods: ['otp'], otp: { txnId, otpValue: rsaEncryptBase64(otp) } },
        ...(aadhaar ? { aadhaar: rsaEncryptBase64(aadhaar) } : {}),
      };
      const { status, data } = await postJson(`${this.baseUrl}/v3/enrollment/enrol/byAadhar`, { accessToken: at, body });
      return ok(this._shapeVerify(data), status);
    } catch (err) {
      return this._err(err);
    }
  }

  async generateMobileOtp({ txnId, mobile, xToken }) {
    if (!/^[6-9]\d{9}$/.test(String(mobile || ''))) return fail('INVALID_MOBILE', 'Mobile must be a 10-digit Indian number starting 6-9.', 400);
    if (!xToken) {
      return fail('XTOKEN_REQUIRED', 'Mobile OTP update requires a logged-in user X-token, which enrollment has not issued yet.', 400);
    }
    try {
      const at = await fetchSessionToken();
      const { status, data } = await postJson(`${this.baseUrl}/v3/profile/account/request/otp`, {
        accessToken: at,
        xToken,
        body: { scope: ['abha-profile', 'mobile-verify'], loginHint: 'mobile', loginId: rsaEncryptBase64(mobile), otpSystem: 'abdm' },
      });
      return ok({ txnId: (data && data.txnId) || txnId, otpSent: true, message: (data && data.message) || 'OTP sent to mobile.' }, status);
    } catch (err) {
      return this._err(err);
    }
  }

  async verifyMobileOtp({ txnId, otp, xToken }) {
    if (!txnId || otp === undefined) return fail('BAD_REQUEST', 'txnId and otp are required.', 400);
    if (!xToken) return fail('XTOKEN_REQUIRED', 'Mobile OTP verification requires the user X-token.', 400);
    try {
      const at = await fetchSessionToken();
      const { status, data } = await postJson(`${this.baseUrl}/v3/profile/account/verify`, {
        accessToken: at,
        xToken,
        body: { scope: ['abha-profile', 'mobile-verify'], authData: { authMethods: ['otp'], otp: { txnId, otpValue: rsaEncryptBase64(otp) } } },
      });
      return ok(this._shapeVerify(data), status);
    } catch (err) {
      return this._err(err);
    }
  }

  async searchByMobile(mobile) {
    if (!/^[6-9]\d{9}$/.test(String(mobile || ''))) return fail('INVALID_MOBILE', 'Mobile must be a 10-digit Indian number starting 6-9.', 400);
    try {
      const at = await fetchSessionToken();
      const { status, data } = await postJson(`${this.baseUrl}/v3/profile/account/abha/search`, {
        accessToken: at, body: { mobile: rsaEncryptBase64(mobile) },
      });
      const results = Array.isArray(data) ? data : (data && (data.results || data.users)) || data;
      return ok({ results }, status);
    } catch (err) {
      return this._err(err);
    }
  }

  async getProfile(xToken) {
    if (!xToken) return fail('XTOKEN_REQUIRED', 'Profile retrieval requires the user X-token from login/verify.', 400);
    try {
      const at = await fetchSessionToken();
      // NOTE: the guide writes this URL with {{env_url}}/abha/api/...; resolved against the SBX base above.
      const { status, data } = await getJson(`${this.baseUrl}/v3/profile/account`, { accessToken: at, xToken });
      return ok(this._shapeVerify(data), status);
    } catch (err) {
      return this._err(err);
    }
  }

  async generateQr(xToken) {
    if (!xToken) return fail('XTOKEN_REQUIRED', 'QR generation requires the user X-token.', 400);
    try {
      const at = await fetchSessionToken();
      const { status, data } = await getJson(`${this.baseUrl}/v3/profile/account/qrCode`, { accessToken: at, xToken });
      return ok({ qrPayload: (data && (data.qrCode || data.qr)) || null, qrData: data, format: 'abdm-qr' }, status);
    } catch (err) {
      return this._err(err);
    }
  }

  async generateCard(xToken) {
    if (!xToken) return fail('XTOKEN_REQUIRED', 'ABHA card requires the user X-token.', 400);
    try {
      const at = await fetchSessionToken();
      // NOTE: guide typo `{ env_url}}`; resolved against the SBX base above.
      const { status, data } = await getJson(`${this.baseUrl}/v3/profile/account/abha-card`, { accessToken: at, xToken });
      return ok({ card: data }, status);
    } catch (err) {
      return this._err(err);
    }
  }

  async linkAbhaAddress({ xToken, abhaAddress } = {}) {
    if (!abhaAddress) return fail('BAD_REQUEST', 'abhaAddress is required.', 400);
    if (!xToken) return fail('XTOKEN_REQUIRED', 'Reserving an ABHA address requires the user X-token.', 400);
    try {
      const at = await fetchSessionToken();
      const { status, data } = await postJson(`${this.baseUrl}/v3/enrollment/enrol/abha-address`, {
        accessToken: at, xToken, body: { abhaAddress },
      });
      return ok({ abhaAddress, response: data }, status);
    } catch (err) {
      return this._err(err);
    }
  }

  _shapeVerify(data) {
    if (!data || typeof data !== 'object') return { response: data };
    return {
      abhaProfile: data.abhaProfile || data.profile || data,
      abhaNumber: data.abhaNumber || data.ABHANumber || data.healthIdNumber || null,
      abhaAddress: data.abhaAddress || data.preferredAbhaAddress || data.phrAddress || null,
      xToken: (data.tokens && data.tokens.token) || data.xToken || data.token || null,
      requiresMobileVerify: data.requiresMobileVerify || false,
      response: data,
    };
  }

  _err(err) {
    if (err instanceof AbhaError) return fail(err.code || 'ABHA_ERROR', err.message, err.status || 502);
    return fail('ABHA_ERROR', 'Unexpected ABHA error.', 502);
  }
}

module.exports = SandboxABHAProvider;
