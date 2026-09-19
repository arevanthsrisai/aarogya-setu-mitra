'use strict';

/**
 * MockABHAProvider — deterministic, sandbox-shaped ABHA behavior for demos.
 *
 * - OTP is always '123456' (echoed back as `mockOtp` so the UI can display it).
 * - Aadhaar of all 9s ('999999999999') simulates ABHA service downtime (503).
 * - State lives in module-level Maps: txnId -> flow state, xToken/abhaNumber -> profile.
 * - Txn TTL default 10 min, override via ABHA_MOCK_TXN_TTL_MS (tests use a tiny value).
 * - Latency default ~200-500ms, override via ABHA_MOCK_LATENCY_MS (tests set ~0).
 */

const crypto = require('crypto');
const { ok, fail, MOCK_OTP } = require('./provider');

const TXNS = new Map(); // txnId -> { aadhaar, mobile, otp, createdAt, expiresAt, attempts, stage, profile }
const PROFILES = new Map(); // abhaNumber -> record { profile, abhaNumber, abhaAddress, xToken }
const XTOKENS = new Map(); // xToken -> abhaNumber

const FIRST = ['Aarav', 'Priya', 'Rahul', 'Sunita', 'Vikram', 'Meera', 'Kiran', 'Divya', 'Arjun', 'Kavita'];
const LAST = ['Sharma', 'Patel', 'Kumar', 'Devi', 'Singh', 'Reddy', 'Joshi', 'Nair', 'Gupta', 'Yadav'];
const DISTRICTS = [['Pune', 'MH', '27'], ['Nashik', 'MH', '27'], ['Jaipur', 'RJ', '27'], ['Lucknow', 'UP', '27']];

function latencyMs() {
  const override = Number(process.env.ABHA_MOCK_LATENCY_MS);
  if (Number.isFinite(override) && override >= 0) return override;
  return 200 + Math.floor(Math.random() * 300);
}

function txnTtlMs() {
  const override = Number(process.env.ABHA_MOCK_TXN_TTL_MS);
  if (Number.isFinite(override) && override >= 0) return override;
  return 10 * 60 * 1000;
}

function sleep(ms) {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

function hashDigits(seed, n) {
  const h = crypto.createHash('sha256').update(String(seed)).digest('hex');
  let out = '';
  for (let i = 0; out.length < n; i += 1) out += String(parseInt(h.slice(i * 2, i * 2 + 2), 16) % 10);
  return out;
}

function buildProfile(aadhaar) {
  const h = crypto.createHash('sha256').update('abha-profile:' + aadhaar).digest('hex');
  const pick = (arr, off) => arr[parseInt(h.slice(off, off + 2), 16) % arr.length];
  const first = pick(FIRST, 0);
  const last = pick(LAST, 2);
  const gender = parseInt(h.slice(4, 6), 16) % 2 === 0 ? 'M' : 'F';
  const year = 1960 + (parseInt(h.slice(6, 8), 16) % 45);
  const month = String(1 + (parseInt(h.slice(8, 10), 16) % 12)).padStart(2, '0');
  const day = String(1 + (parseInt(h.slice(10, 12), 16) % 28)).padStart(2, '0');
  const [district, stateCode] = DISTRICTS[parseInt(h.slice(12, 14), 16) % DISTRICTS.length];
  const seq = hashDigits('abha-seq:' + aadhaar, 12);
  const abhaNumber = `27-${seq.slice(0, 4)}-${seq.slice(4, 8)}-${seq.slice(8, 12)}`;
  const abhaAddress = `${first.toLowerCase()}.${last.toLowerCase()}${hashDigits('addr:' + aadhaar, 4)}@abdm`;
  const mobile = `9${hashDigits('mob:' + aadhaar, 9)}`;
  return {
    // Sandbox-shaped field names (ABHA V3 guide: ABHANumber, name parts, dob parts).
    ABHANumber: abhaNumber,
    abhaNumber,
    abhaAddress,
    preferredAbhaAddress: abhaAddress,
    firstName: first,
    lastName: last,
    name: `${first} ${last}`,
    gender,
    dateOfBirth: `${day}-${month}-${year}`,
    dayOfBirth: day,
    monthOfBirth: month,
    yearOfBirth: String(year),
    dob: `${year}-${month}-${day}`,
    mobile,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${hashDigits('em:' + aadhaar, 3)}@example.in`,
    address: `At Post Khed, Tal Khed, Dist ${district}, Maharashtra 410001`,
    districtName: district,
    stateCode,
    stateName: 'Maharashtra',
    pincode: '410001',
    status: 'ACTIVE',
    kycVerified: true,
    verificationStatus: 'VERIFIED',
    authMethods: ['MOBILE_OTP', 'AADHAAR_OTP'],
  };
}

function newTxnId() {
  return `${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
}

function lookupTxn(txnId) {
  const txn = TXNS.get(txnId);
  if (!txn) return { err: fail('INVALID_TXN', 'Invalid or unknown txnId. Generate a fresh OTP.', 400) };
  if (Date.now() > txn.expiresAt) {
    TXNS.delete(txnId);
    return { err: fail('TXN_EXPIRED', 'OTP session expired. Generate a fresh OTP.', 410) };
  }
  return { txn };
}

class MockABHAProvider {
  constructor() {
    this.mode = 'mock';
  }

  async createSession() {
    await sleep(latencyMs());
    return ok({ accessToken: 'mock-access-token', tokenType: 'Bearer', expiresIn: 1200, mock: true });
  }

  async generateAadhaarOtp({ aadhaar }) {
    await sleep(latencyMs());
    if (!/^\d{12}$/.test(String(aadhaar || ''))) {
      return fail('INVALID_AADHAAR', 'Aadhaar must be exactly 12 digits.', 400);
    }
    if (String(aadhaar) === '999999999999') {
      return fail('ABHA_SERVICE_UNAVAILABLE', 'ABHA service temporarily unavailable. Try again later.', 503);
    }
    const txnId = newTxnId();
    TXNS.set(txnId, {
      aadhaar: String(aadhaar),
      otp: MOCK_OTP,
      createdAt: Date.now(),
      expiresAt: Date.now() + txnTtlMs(),
      attempts: 0,
      stage: 'aadhaar-otp-sent',
      profile: null,
    });
    return ok({ txnId, otpSent: true, message: 'OTP sent to Aadhaar-registered mobile.', mockOtp: MOCK_OTP, mock: true });
  }

  async verifyAadhaarOtp({ txnId, otp }) {
    await sleep(latencyMs());
    const { txn, err } = lookupTxn(txnId);
    if (err) return err;
    txn.attempts += 1;
    if (String(otp) !== txn.otp) {
      return fail('OTP_MISMATCH', 'Incorrect OTP. Please retry.', 400, { attemptsLeft: Math.max(0, 3 - txn.attempts) });
    }
    const profile = buildProfile(txn.aadhaar);
    const xToken = `mock-x-token-${crypto.randomBytes(8).toString('hex')}`;
    const record = { profile, abhaNumber: profile.abhaNumber, abhaAddress: profile.abhaAddress, xToken };
    PROFILES.set(profile.abhaNumber, record);
    XTOKENS.set(xToken, profile.abhaNumber);
    txn.stage = 'verified';
    txn.profile = record;
    return ok({
      abhaProfile: profile,
      abhaNumber: profile.abhaNumber,
      abhaAddress: profile.abhaAddress,
      xToken,
      requiresMobileVerify: false,
      message: 'ABHA verified successfully.',
      mock: true,
    });
  }

  async generateMobileOtp({ txnId, mobile }) {
    await sleep(latencyMs());
    if (!/^[6-9]\d{9}$/.test(String(mobile || ''))) {
      return fail('INVALID_MOBILE', 'Mobile must be a 10-digit Indian number starting 6-9.', 400);
    }
    let txn = txnId ? lookupTxn(txnId).txn : null;
    if (txnId && !txn) {
      const { err } = lookupTxn(txnId);
      return err;
    }
    if (!txn) {
      const freshId = newTxnId();
      txn = { aadhaar: null, mobile: String(mobile), otp: MOCK_OTP, createdAt: Date.now(), expiresAt: Date.now() + txnTtlMs(), attempts: 0, stage: 'mobile-otp-sent', profile: null };
      TXNS.set(freshId, txn);
      return ok({ txnId: freshId, otpSent: true, message: 'OTP sent to mobile.', mockOtp: MOCK_OTP, mock: true });
    }
    txn.mobile = String(mobile);
    txn.otp = MOCK_OTP;
    txn.stage = 'mobile-otp-sent';
    txn.expiresAt = Date.now() + txnTtlMs();
    return ok({ txnId, otpSent: true, message: 'OTP sent to mobile.', mockOtp: MOCK_OTP, mock: true });
  }

  async verifyMobileOtp({ txnId, otp }) {
    await sleep(latencyMs());
    const { txn, err } = lookupTxn(txnId);
    if (err) return err;
    txn.attempts += 1;
    if (String(otp) !== txn.otp) {
      return fail('OTP_MISMATCH', 'Incorrect mobile OTP. Please retry.', 400);
    }
    if (txn.profile) {
      txn.stage = 'verified';
      const r = txn.profile;
      return ok({ abhaProfile: r.profile, abhaNumber: r.abhaNumber, abhaAddress: r.abhaAddress, xToken: r.xToken, requiresMobileVerify: false, message: 'Mobile verified successfully.', mock: true });
    }
    // Standalone mobile flow (no aadhaar step): synthesize a profile keyed by mobile.
    const profile = buildProfile('mobile:' + (txn.mobile || txnId));
    const xToken = `mock-x-token-${crypto.randomBytes(8).toString('hex')}`;
    const record = { profile, abhaNumber: profile.abhaNumber, abhaAddress: profile.abhaAddress, xToken };
    PROFILES.set(profile.abhaNumber, record);
    XTOKENS.set(xToken, profile.abhaNumber);
    txn.stage = 'verified';
    txn.profile = record;
    return ok({ abhaProfile: profile, abhaNumber: profile.abhaNumber, abhaAddress: profile.abhaAddress, xToken, requiresMobileVerify: false, message: 'Mobile verified successfully.', mock: true });
  }

  async searchByMobile(mobile) {
    await sleep(latencyMs());
    if (!/^[6-9]\d{9}$/.test(String(mobile || ''))) {
      return fail('INVALID_MOBILE', 'Mobile must be a 10-digit Indian number starting 6-9.', 400);
    }
    const profile = buildProfile('mobile:' + mobile);
    return ok({
      results: [{
        abhaNumber: profile.abhaNumber,
        abhaAddress: profile.abhaAddress,
        name: profile.name,
        gender: profile.gender,
        mobile: `******${String(mobile).slice(-4)}`,
        status: 'ACTIVE',
      }],
      mock: true,
    });
  }

  resolveRecord(ref) {
    if (!ref) return null;
    if (PROFILES.has(ref)) return PROFILES.get(ref);
    const abhaNumber = XTOKENS.get(ref);
    return abhaNumber ? PROFILES.get(abhaNumber) || null : null;
  }

  async getProfile(xToken) {
    await sleep(latencyMs());
    const record = this.resolveRecord(xToken);
    if (!record) return fail('PROFILE_NOT_FOUND', 'No ABHA profile found for this reference. Complete OTP verification first.', 404);
    return ok({ abhaProfile: record.profile, abhaNumber: record.abhaNumber, abhaAddress: record.abhaAddress, mock: true });
  }

  async generateQr(xToken) {
    await sleep(latencyMs());
    const record = this.resolveRecord(xToken);
    if (!record) return fail('PROFILE_NOT_FOUND', 'No ABHA profile found for this reference.', 404);
    const payload = `ABHA:${record.abhaNumber}:${record.abhaAddress}:${record.profile.name}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="220" height="220" fill="white"/><rect x="10" y="10" width="60" height="60" fill="black"/><rect x="150" y="10" width="60" height="60" fill="black"/><rect x="10" y="150" width="60" height="60" fill="black"/><text x="110" y="115" font-size="10" text-anchor="middle" font-family="monospace">${record.abhaNumber}</text><text x="110" y="135" font-size="8" text-anchor="middle" font-family="monospace">MOCK QR</text></svg>`;
    return ok({
      abhaNumber: record.abhaNumber,
      qrPayload: payload,
      qrImage: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      qrDataUrl: `data:text/plain;base64,${Buffer.from(payload).toString('base64')}`,
      format: 'svg-data-uri',
      mock: true,
    });
  }

  async generateCard(xToken) {
    await sleep(latencyMs());
    const record = this.resolveRecord(xToken);
    if (!record) return fail('PROFILE_NOT_FOUND', 'No ABHA profile found for this reference.', 404);
    const p = record.profile;
    return ok({
      abhaNumber: record.abhaNumber,
      abhaAddress: record.abhaAddress,
      name: p.name,
      gender: p.gender,
      dob: p.dob,
      dateOfBirth: p.dateOfBirth,
      mobile: p.mobile,
      email: p.email,
      address: p.address,
      profilePhoto: null,
      status: 'ACTIVE',
      issuedAt: new Date().toISOString(),
      cardTitle: 'Ayushman Bharat Health Account',
      mock: true,
    });
  }

  async linkAbhaAddress({ xToken, abhaAddress, txnId } = {}) {
    await sleep(latencyMs());
    if (!/^[a-zA-Z0-9._-]{3,}@(abdm|sbx)$/.test(String(abhaAddress || ''))) {
      return fail('INVALID_ABHA_ADDRESS', 'ABHA address must look like name@abdm (min 3 chars before @).', 400);
    }
    const record = this.resolveRecord(xToken || txnId && (TXNS.get(txnId) || {}).profile);
    const finalRecord = record && typeof record === 'object' && record.abhaNumber ? record : null;
    return ok({
      abhaAddress,
      abhaNumber: finalRecord ? finalRecord.abhaNumber : null,
      message: 'ABHA address reserved.',
      mock: true,
    });
  }
}

module.exports = MockABHAProvider;
