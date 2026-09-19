'use strict';

/**
 * ABHA provider interface + factory.
 *
 * Every provider method returns a result object (never throws for
 * expected ABHA failures):
 *   { ok: true, status: <http-ish status>, data: {...} }
 *   { ok: false, status: <http-ish status>, error: { code, message, details? } }
 *
 * `AbhaError` is thrown only for programmer errors (bad arguments) and by
 * the sandbox transport for unexpected failures; routes translate it to 500s.
 *
 * Modes: 'mock' (default) | 'sandbox' | 'production'.
 * 'production' currently behaves like 'sandbox' against the PROD base URL.
 * If ABHA_MODE requests sandbox/production but ABDM credentials are absent,
 * the factory falls back to mock and sets `provider.fallback = { from, reason }`
 * (never crashes — the demo must keep working).
 */

const MOCK_OTP = '123456';

class AbhaError extends Error {
  constructor(code, message, status = 500, details) {
    super(message);
    this.name = 'AbhaError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function ok(data, status = 200) {
  return { ok: true, status, data };
}

function fail(code, message, status = 400, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { ok: false, status, error };
}

function resolveMode() {
  const raw = String(process.env.ABHA_MODE || 'mock').trim().toLowerCase();
  if (raw === 'sandbox' || raw === 'sbx') return 'sandbox';
  if (raw === 'production' || raw === 'prod') return 'production';
  return 'mock';
}

function hasCredentials() {
  const id = String(process.env.ABDM_CLIENT_ID || '').trim();
  const secret = String(process.env.ABDM_CLIENT_SECRET || '').trim();
  // Treat documented placeholder values as absent.
  const placeholders = new Set(['', 'your_abdm_client_id', 'your_abdm_client_secret', 'changeme', 'test']);
  return !placeholders.has(id.toLowerCase()) && !placeholders.has(secret.toLowerCase());
}

function hasRsaKey() {
  return String(process.env.ABHA_RSA_PUBLIC_KEY || '').includes('BEGIN PUBLIC KEY');
}

/**
 * Returns a provider instance with `.mode` ('mock'|'sandbox'|'production')
 * and, on fallback, `.fallback = { from, reason }`.
 */
function getAbhaProvider() {
  const requested = resolveMode();
  if (requested === 'mock') {
    const MockABHAProvider = require('./mock');
    return new MockABHAProvider();
  }
  if (!hasCredentials()) {
    const MockABHAProvider = require('./mock');
    const provider = new MockABHAProvider();
    provider.fallback = {
      from: requested,
      reason: 'ABDM_CLIENT_ID/ABDM_CLIENT_SECRET not configured; using mock provider. Set credentials to enable live ' + requested + ' calls.',
    };
    return provider;
  }
  const SandboxABHAProvider = require('./sandbox');
  return new SandboxABHAProvider(requested);
}

module.exports = { AbhaError, ok, fail, resolveMode, hasCredentials, hasRsaKey, getAbhaProvider, MOCK_OTP };
