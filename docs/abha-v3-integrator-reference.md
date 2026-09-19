# ABHA V3 API — Integrator Reference (for Express 5 + Node.js Backend)

Extracted verbatim from **ABDM ABHA V3 APIs Integrator Guide, Version 1.0** (`ABDM_ABHA_V3_AP_Is_SOP_V1_0_1_13_09_24_2d0e7c0839.pdf`, 123 pages). This document is a build reference for a backend engineer implementing ABHA integration in an **Express 5 + Node.js CommonJS** backend. Every endpoint, field, and enum below is transcribed from the PDF. Nothing is invented. Ambiguities are flagged explicitly.

---

## 1. Environments & Base URLs

| Env | Base URL | Section |
|-----|----------|---------|
| **Sandbox (SBX)** | `https://abhasbx.abdm.gov.in/abha/api` | 1.0 / general |
| **Production** | `https://abha.abdm.gov.in/api/abha` | 1.0 / general |
| ABHA Address verification (Section 12 only) | SBX `https://abhasbx.abdm.gov.in/abha/api/v3/phr/web` · PROD `https://phr.abdm.gov.in/api/phr/web/v3` | 12.x |

> **Inconsistency in the PDF**: most V3 URLs use the `{{base_url}}` variable defined in Section 1.0 (SBX `.../abha/api`, PROD `.../api/abha`). A few endpoints (8.0 Get Profile, 10.0 ABHA Card) are written with `{{env_url}}/abha/api/...` instead, and 7.2 uses `{{base_url}}/abha/api/...` (double `/abha/api`). Treat these as a single resolved base + path; resolve the actual URL against the sandbox console / Postman collection before hardcoding. The `phr/web` variants in Section 12 are a genuinely different path prefix (see 12.1).

---

## 2. Session Token (Authentication bootstrap)

All subsequent calls need a session `accessToken` from this API.

**Endpoint:** `https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions` (this is a HIE-CM gateway endpoint, distinct from the `base_url` used by the profile APIs)
**Method:** `POST`

**Request body:**
```json
{
  "clientId": "{{ClientId}}",
  "clientSecret": "{{ClientSecret}}"
}
```

**Response 200:**
```json
{
  "accessToken": "<JWT>",
  "expiresIn": 1200,
  "refreshExpiresIn": 1800,
  "refreshToken": "<JWT>"
}
```

**Notes for implementer:**
- `accessToken` is a JWT; expires in **1200 s (20 min)**. `refreshToken` / `refreshExpiresIn` 1800 s.
- Send the access token as the `Authorization Token` header value on every profile/enrollment/login call.

---

## 3. Encryption Specification

This is the single most important detail in the whole guide.

| Parameter | Value |
|-----------|-------|
| Cipher / `encryptionAlgorithm` | **`RSA/ECB/OAEPWithSHA-1AndMGF1Padding`** (exact string from PDF Section 2.0) |
| Input | The value to encrypt (e.g. Aadhaar number, ABHA number, mobile, OTP, loginId) as a **plain string** |
| Key | **RSA public key** (the "ABHA Public Key" / `publicKey` obtained for the environment — see note below) |
| Output encoding | The PDF samples pass the ciphertext as a base64 string in `loginId` / `otpValue` / `data` fields |

**Where the RSA public key comes from:** The PDF says "data encrypted with RSA public key" and repeatedly labels the Authorization Token as "(Use ABHA Public Key)". The guide does not print a literal public key. On the sandbox the public key is typically provisioned/obtained along with `ClientId`/`ClientSecret` when you register as an integrator; in the Postman collection it is a stored environment variable. **You must obtain the actual RSA public key for the target environment** (SBX vs PROD) from ABDM onboarding / the sandbox console — this is a genuine external dependency the PDF does not document.

**Node.js (crypto) reference implementation:**
```js
const crypto = require('crypto');

function rsaEncrypt(plainText, publicKeyPem) {
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha1',               // OAEPWithSHA-1
    },
    Buffer.from(plainText, 'utf8')
  );
  return encrypted.toString('base64');
}
```
> `RSA/ECB/OAEPWithSHA-1AndMGF1Padding` in Java maps to Node `publicEncrypt` with `padding: RSA_PKCS1_OAEP_PADDING` + `oaepHash: 'sha1'`. MGF1 digest defaults to the same hash (sha1) here. Verify against a known vector from the Postman collection during development.

---

## 4. Common V3 Request Headers

The same headers appear on nearly every endpoint. They are:

| Header | Example | Mandatory | Description |
|--------|---------|-----------|-------------|
| `REQUEST-ID` | `18235d89-cb13-479d-ad71-7a57d5f669a8` | Yes | Unique UUID for tracking the end-to-end request transaction |
| `TIMESTAMP` | ISO 8601 (e.g. `{{$isoTimestamp}}`) | Yes | Actual time the request was initiated (year→ms, ISO 8601) |
| `X-token` | `Bearer X-token` | Conditional | X-token of user; obtained **after login**. Mandatory on endpoints that operate on a logged-in user's profile (Get Profile, QR, ABHA Card, update profile) |
| `Authorization Token` | `{{accesstoken}}` | Yes | Token generated from the session API (Section 2) |
| `BENEFIT-NAME` | (e.g. COVIN) | Conditional | Mandatory on benefit APIs (Demo Auth, benefit search) |

> Several body tables reuse the `scope` / `loginHint` / `otpSystem` / `authMethods` enums. They are consolidated here and referenced throughout.

### Scope enum (`Scope`)
`ABHA_LOGIN("abha-login")`, `ABHA_PROFILE("abha-profile")`, `AADHAAR_VERIFY("aadhaar-verify")`, `EMAIL_VERIFY("email-verify")`, `MOBILE_VERIFY("mobile-verify")`, `PASSWORD_VERIFY("password-verify")`, `CHANGE_PASSWORD("change-password")`, `RE_KYC("re-kyc")`

### loginHint enum (`loginHint`)
`ABHA_NUMBER("abha-number")`, `MOBILE("mobile")`, `EMAIL("email")`, `AADHAAR("aadhaar")`, `PASSWORD("password")`

### otpSystem enum (`otpSystem`)
`AADHAAR("aadhaar")`, `ABDM("abdm")`

### authMethods enum
`OTP("otp")`, `PASSWORD("password")` (used in `authData.authMethods` arrays; login responses may also return `"MOBILE_OTP"`, `"AADHAAR_OTP"`).

---

## 5. Flow Summaries & Endpoints

### 5.0 ABHA Creation via Aadhaar (Enrollment)

**Step 1 — Generate Aadhaar OTP**
- `POST {{base_url}}/v3/enrollment/request/otp`
- Headers: `REQUEST-ID`, `TIMESTAMP`, `Authorization Token`
- Body: encrypted Aadhaar number
- Response: `txnId`

**Step 2 — Enrol (by Aadhaar)**
- `POST {{base_url}}/v3/enrollment/enrol/byAadhar`
- Headers: `REQUEST-ID`, `TIMESTAMP`, `Authorization Token`
- Body: `authData` (contains `txnId`), `authMethods: ["otp", "pi"]`, plus encrypted Aadhaar number and encrypted OTP
- Response: ABHA created (profile fields)

**Other enrolment endpoints (documented in Section 11 / guide):**
- `POST {{base_url}}/v3/enrollment/enrol/byAbdm`
- `POST {{base_url}}/v3/enrollment/enrol/suggestion`
- `POST {{base_url}}/v3/enrollment/enrol/abha-address`
- `POST {{base_url}}/v3/enrollment/enrol/byDocument`
- `POST {{base_url}}/v3/enrollment/enrol/byAadhaar`

### 5.0 Demo Auth (Section 5.0)

Enroll a user via Aadhaar **without** OTP (demo/bio-auth simulation), used for testing.

- `POST {{base_url}}/v3/enrollment/enrol/byAadhaar`
- Headers: `REQUEST-ID`, `TIMESTAMP`, `BENEFIT-NAME`, `Authorization Token`
- Body `authData.authMethods: ["demo_auth"]` and a `demo_auth` object containing the **encrypted Aadhaar number**
- User fields:
  - **Mandatory:** `dateOfBirth`, `districtCode`, `name`, `gender`, `stateCode`
  - **Optional:** `address`, `mobile`, `pinCode`, `validity`, `profilePhoto`

### 6.0 Login Flows (Section 6.x)

**Login via Aadhaar OTP**

Step 1 — Generate OTP:
- `POST {{base_url}}/v3/profile/login/request/otp`
- Headers: `REQUEST-ID`, `TIMESTAMP`, `Authorization Token`
- Body: `Scope` (`["abha-login","aadhaar-verify"]`), `loginHint: "aadhaar"`, `loginId` = **RSA-encrypted Aadhaar number**
- Response: `txnId`

Step 2 — Verify OTP (and other verify variants):
- `POST {{base_url}}/v3/profile/login/verify`
- `POST {{base_url}}/v3/profile/login/verify/user`

Login OTP flows exist for other hints (mobile, email, abha-number) using the same request/verify endpoint pair with different `loginHint` + `scope`.

**Login response (success) — `tokens` object:**
```json
{
  "token": "<JWT>",
  "expiresIn": 1800,
  "refreshToken": "<JWT>",
  "refreshExpiresIn": 1296000
}
```
> The login JWT `token` is used to obtain the user `X-token` (Bearer X-token) required by profile endpoints.

### 7.0 Profile Update Flows (Section 7.x)

#### 7.1 Update Mobile

Step 1 — Generate OTP:
- `POST {{base_url}}/v3/profile/account/request/otp`
- Headers: `REQUEST-ID`, `TIMESTAMP`, `X-token` (Bearer, mandatory), `Authorization Token`
- Body: `scope: ["abha-profile","mobile-verify"]`, `loginHint: "mobile"`, `loginId` = **RSA-encrypted mobile**, `otpSystem: "abdm"`
- Response 200: `txnId` (e.g. `"1234567890:20211216223812"`)

Step 2 — Verify OTP:
- `POST {{base_url}}/v3/profile/account/verify`

#### 7.2 Update Email

- Request verification link: `POST {{base_url}}/abha/api/v3/profile/account/request/emailVerificationLink` (note `/abha/api` prefix in PDF)
- Verify: `POST {{base_url}}/v3/profile/account/verify`

#### 7.3 (Update profile via verify)

- `POST {{base_url}}/v3/profile/account/verify`

#### 7.4 Deactivate ABHA via Aadhaar

Step 1 — Generate OTP:
- `POST {{base_url}}/v3/profile/account/request/otp`
- Headers: `REQUEST-ID`, `TIMESTAMP`, `X-token` (Bearer, mandatory), `Authorization Token`
- Body: `txnId` (empty, optional), `scope: ["abha-profile","de-activate"]`, `loginHint: "abha-number"`, `loginId` = **RSA-encrypted ABHA number**, `otpSystem: "aadhaar"`

Step 2 — Verify:
- `POST {{base_url}}/v3/profile/account/verify`

#### 7.5 Re-activate ABHA
Documented as a reactivation flow; uses the same `request/otp` + `account/verify` pattern with a re-activate scope (see guide Section 7.5 for the exact scope string).

### 8.0 Get Profile

- `GET {{env_url}}/abha/api/v3/profile/account` (PDF uses `{{env_url}}`, not `base_url`)
- Headers: `REQUEST-ID`, `TIMESTAMP`, `X-token` (Bearer, mandatory), `Authorization Token`
- Response 200 fields: `ABHANumber`, `preferredAbhaAddress`, `mobile`, `firstName`, `middleName`, `lastName`, `name`, `yearOfBirth`, `dayOfBirth`, `monthOfBirth`, `gender`, `email`, `profilePhoto` (base64)

### 9.0 Generate QR Code

- `GET {{base_url}}/v3/profile/account/qrCode`
- Headers: `REQUEST-ID`, `TIMESTAMP`, `X-token` (Bearer, mandatory), `Authorization Token`
- Body: none (`NA`)
- Returns the QR code upon successful validation of the JWT access token.

### 10.0 Generate ABHA Card

- `GET {env_url}/abha/api/v3/profile/account/abha-card` (PDF has a typo `{ env_url}}`; treat as `{{env_url}}/abha/api/v3/profile/account/abha-card`)
- Headers: `REQUEST-ID`, `TIMESTAMP`, `X-token` (Bearer, mandatory), `Authorization Token`
- Response: `202 Accepted` returns the ABHA Card.

### 11.0 Benefit APIs

> "These APIs are used by government integrators with some special benefits."

- **11.1 Create ABHA using Aadhaar** — Step 1 Generate Aadhaar OTP (encrypted Aadhaar → OTP to Aadhaar-linked mobile); same endpoints as 5.0.
- **11.4 Link/De-link benefit**: `{{base_url}}/v3/profile/benefit/linkAndDelink` (see guide for body).
- **Get ABHA benefits**: `GET {{base_url}}/profile/benefit/abha/{{healthIdNumber}}` → response `abhaNumber` + `programme[]` (each `{ benefitName }`).
- **Benefit search**: `POST {{base_url}}/v3/profile/benefit/search`
  - Headers: `REQUEST-ID`, `TIMESTAMP`, `BENEFIT-NAME`, `Authorization Token`
  - Body: `scope: ["search"]`, `loginHint: "xmlUid"` **or** `"abha-number"`, `loginId` = encrypted `xmlUid`/abha
  - Response 200: array of `{ stateCode, benefitName ("COVIN"), benefitId, abhaNumber }`

### 11.6 Find ABHA / Search & Child ABHA

- **11.6.1 Find ABHA / Search via Mobile**: `POST {{base_url}}/v3/profile/account/abha/search`
  - Headers: `REQUEST-ID`, `TIMESTAMP`, `Authorization Token`
- **Update Child ABHA** body:
```json
{
  "abhaNumber": "...",
  "name": "...",
  "dob": "dd-mm-yyyy",
  "gender": "M/F"
}
```
- Response 200 includes: `ABHANumber`, `preferredAbhaAddress`, `mobile`, name parts, `yearOfBirth`/`dayOfBirth`/`monthOfBirth`, `gender`, `status: "ACTIVE"`, `stateCode`, `districtCode`, `pincode`, `address`, `stateName`, `districtName`, `subdistrictName`, `authMethods: ["MOBILE_OTP"]`, `tags`, `kycVerified: false`, `verificationStatus: "VERIFIED"`, `verificationType: "CHILD_ABHA"`, `createdDate`

### 12.0 ABHA Address Verification (Section 12.x)

**Base URLs (different prefix):** SBX `https://abhasbx.abdm.gov.in/abha/api/v3/phr/web` · PROD `https://phr.abdm.gov.in/api/phr/web/v3`

**12.1 / 12.2 — Flow (mobile OTP and Aadhaar OTP variants)**

Step 1 — Search Auth Methods:
- `POST {{base_url}}/login/abha/search`
- Headers: `REQUEST-ID`, `TIMESTAMP`, `Authorization Token` (Use ABHA Public Key)
- Body: `{ "abhaAddress": "singh128@sbx" }`
- Response:
```json
{
  "healthIdNumber": "91-6167-8028-XXXX",
  "abhaAddress": "singh128@sbx",
  "authMethods": ["MOBILE_OTP", "AADHAAR_OTP"],
  "blockedAuthMethods": [],
  "status": "ACTIVE",
  "message": null,
  "fullName": "Deepak Kumar Singh",
  "mobile": "******9340"
}
```

Step 2 — Request ABHA address OTP:
- `POST {{base_url}}/login/abha/request/otp`
- Headers: `REQUEST-ID`, `TIMESTAMP`, `Authorization Token` (Use ABHA Public Key)
- **Mobile OTP body** (12.1): `{ "abhaAddress": "singh128@sbx" }`
- **Aadhaar OTP body** (12.2):
```json
{
  "scope": ["abha-address-login", "aadhaar-verify"],
  "loginHint": "abha-address",
  "loginId": "<RSA encrypted ABHA address>",
  "otpSystem": "aadhaar"
}
```
- Response: `{ "txnId": "1234567890:20211216223812", "message": "OTP is sent to Aadhaar registered mobile ending xxx001" }`

Step 3 — Verify ABHA address OTP:
- `POST {{base_url}}/login/abha/verify`
- Headers: `REQUEST-ID`, `TIMESTAMP`, `Authorization Token` (Use ABHA Public Key)
- Body:
```json
{
  "scope": ["abha-address-login", "mobile-verify"],   // or ["abha-address-login","aadhaar-verify"]
  "authData": {
    "authMethods": ["otp"],
    "otp": { "txnId": "{{txnId}}", "otpValue": "{{OTP_encryption}}" }
  }
}
```
- Response 200:
```json
{
  "message": "OTP verified successfully",
  "authResult": "success",
  "users": [
    {
      "abhaAddress": "singh128@sbx",
      "fullName": "Deepak Kumar Singh",
      "profilePhoto": "<base64>",
      "abhaNumber": "91-6167-8028-XXXX",
      "status": "ACTIVE",
      "kycStatus": "VERIFIED"
    }
  ],
  "tokens": { "token": "<JWT>", "expiresIn": 1800, "refreshToken": "<JWT>", "refreshExpiresIn": 1296000 }
}
```

**12.3 Profile (after address login)**

- **12.3.1 Get ABHA address profile**: `GET {{base_url}}/login/profile/abha-profile`
  - Headers: `REQUEST-ID`, `TIMESTAMP`, `X-token` (Bearer, mandatory), `Authorization Token`
  - Response fields: `abhaAddress`, `fullName`, `profilePhoto` (base64), `firstName`, `middleName`, `lastName`, `dayOfBirth`, `monthOfBirth`, `yearOfBirth`, `dateOfBirth` (`24-11-1998`), `gender`, `email`, `mobile` (masked), `abhaNumber`, `address`, `stateName`, `pinCode`, `stateCode`, `districtCode`, `authMethods`, `status`, `subDistrictCode`, `subDistrictName`, `emailVerified` (`"false"`), `mobileVerified` (`"true"`), `kycStatus` (`"VERIFIED"`)

- **12.3.2 Get ABHA address ABHA card**: `GET {{base_url}}/login/profile/abha/phr-card`
  - Headers: `REQUEST-ID`, `TIMESTAMP`, `X-token` (Bearer, mandatory), `Authorization Token`
  - Response: QR Code

---

## 6. Consolidated Endpoint Index

| # | Method | URL (relative to base) | Purpose | Auth |
|---|--------|------------------------|---------|------|
| 1 | POST | `/api/hiecm/gateway/v3/sessions` (HIE-CM, `https://dev.abdm.gov.in`) | Get session accessToken | — |
| 2 | POST | `/v3/enrollment/request/otp` | Generate Aadhaar OTP (enrolment) | AT |
| 3 | POST | `/v3/enrollment/enrol/byAadhar` | Create ABHA via Aadhaar | AT |
| 4 | POST | `/v3/enrollment/enrol/byAadhaar` | Demo Auth enrolment | AT + BENEFIT-NAME |
| 5 | POST | `/v3/enrollment/enrol/byAbdm` | Enrol via ABDM | AT |
| 6 | POST | `/v3/enrollment/enrol/suggestion` | ABHA address suggestion | AT |
| 7 | POST | `/v3/enrollment/enrol/abha-address` | Reserve ABHA address | AT |
| 8 | POST | `/v3/enrollment/enrol/byDocument` | Enrol via document (DL flow) | AT |
| 9 | POST | `/v3/profile/login/request/otp` | Login OTP request | AT |
| 10 | POST | `/v3/profile/login/verify` | Login OTP verify | AT |
| 11 | POST | `/v3/profile/login/verify/user` | Login verify (user) | AT |
| 12 | POST | `/v3/profile/account/request/otp` | Profile-update OTP (mobile/email/deactivate) | AT + X-token |
| 13 | POST | `/v3/profile/account/verify` | Profile-update OTP verify | AT + X-token |
| 14 | POST | `/abha/api/v3/profile/account/request/emailVerificationLink` | Email verification link | AT + X-token |
| 15 | GET | `/abha/api/v3/profile/account` | Get profile (uses env_url) | AT + X-token |
| 16 | GET | `/v3/profile/account/qrCode` | Generate QR code | AT + X-token |
| 17 | GET | `/abha/api/v3/profile/account/abha-card` | Generate ABHA card | AT + X-token |
| 18 | GET | `/profile/benefit/abha/{{healthIdNumber}}` | Get ABHA benefits | AT |
| 19 | POST | `/v3/profile/benefit/search` | Search benefits | AT + BENEFIT-NAME |
| 20 | POST | `/v3/profile/benefit/linkAndDelink` | Link/de-link benefit | AT |
| 21 | POST | `/v3/profile/account/abha/search` | Find ABHA / search by mobile | AT |
| 22 | POST | `/login/abha/search` | Search ABHA address auth methods (Section 12) | AT |
| 23 | POST | `/login/abha/request/otp` | Request ABHA address OTP (Section 12) | AT |
| 24 | POST | `/login/abha/verify` | Verify ABHA address OTP (Section 12) | AT |
| 25 | GET | `/login/profile/abha-profile` | Get ABHA address profile (Section 12.3.1) | AT + X-token |
| 26 | GET | `/login/profile/abha/phr-card` | Get ABHA address card (Section 12.3.2) | AT + X-token |

AT = `Authorization Token` header (session accessToken). Rows 15–17, 25–26 additionally require `X-token` (Bearer user token after login). Rows 4 and 19 require `BENEFIT-NAME`.

---

## 7. Implementation Notes for the Express Backend

### 7.1 What the sandbox can realistically do
- **Session token**, **encryption**, **login OTP flows**, **profile retrieval**, **QR / ABHA card**, **benefit APIs**, and **Section 12 ABHA address verification** are all exerciseable against the sandbox with valid `ClientId`/`ClientSecret` and the SBX RSA public key.
- **Aadhaar-OTP and Demo-Auth enrolment** may be restricted/limited on the sandbox (real Aadhaar/KYC). For a prototype, **mock the enrollment steps** (5.0/11.1) behind a flag and focus end-to-end integration on login + profile + QR/card + Section 12.

### 7.2 Encryption: use server-side crypto, not online tools
- The PDF's Postman collection references third-party online encryption tools. **Do not use those** — use Node `crypto` per Section 3 above.
- Put the RSA public key (PEM) in an environment variable / secret manager, never in source control.

### 7.3 Security must-haves
- Store `clientId`, `clientSecret`, and the RSA public key in `.env` (never committed).
- Cache the session `accessToken` in memory and refresh via `refreshToken` before expiry (1200 s); do not fetch a new token per request.
- Never log the full `Authorization Token`, `X-token`, OTPs, or encrypted values.
- Treat `REQUEST-ID` as a per-request UUID (correlate logs across the transaction).

### 7.4 Suggested module layout (CommonJS)
```
backend/
  src/
    abha/
      session.js        // getSessionToken(), cached
      encrypt.js        // rsaEncrypt()
      client.js         // request wrapper: headers, REQUEST-ID, TIMESTAMP
      login.js          // 6.x
      profile.js        // 7.x, 8.0
      card.js           // 9.0 QR, 10.0 ABHA card
      benefits.js       // 11.x
      address.js        // 12.x
    routes/
      abha.routes.js    // Express routers wiring the above
```

### 7.5 Implementation order (shortest path to a working demo)
1. `session.js` + `encrypt.js` — get a token, prove you can encrypt a value (compare against a Postman vector).
2. `client.js` — build the header wrapper.
3. Section 12 ABHA address verification (search → OTP → verify → profile) — self-contained, no real KYC, great first end-to-end win.
4. Login flow (6.x) to obtain `X-token`.
5. Get Profile (8.0), QR (9.0), ABHA Card (10.0).
6. Benefits (11.x). Leave full Aadhaar/DL enrolment (5.0/11.1) mocked.

---

## 8. Ambiguities / Gaps in the PDF (flagged)

1. **`{{base_url}}` vs `{{env_url}}`** — inconsistent across sections (7.2, 8.0, 10.0). Resolve against the sandbox console / Postman collection.
2. **RSA public key value** — not printed in the guide. Must be obtained from ABDM onboarding / sandbox console.
3. **7.5 Re-activate scope string** — not captured verbatim; guide lists the flow, verify exact scope against the Postman collection.
4. **`linkAndDelink` request body** — documented in Section 11.4 but the exact body JSON was not extracted; refer to the Postman collection.
5. **10.0 response** — only `202 Accepted` + "ABHA Card" shown; actual payload not detailed in the extraction.
6. **No rate-limit / throttling section** — the PDF does not document rate limits.
7. **No "Implementation notes for Aarogya Setu Mitra" section** — the PDF contains no such section; this doc's Section 7 is our own pragmatic guidance.
8. **Enrolment by Aadhaar (11.1) vs Demo Auth (5.0)** both hit `/enrol/byAadhaar` — confirm the distinguishing `authData.authMethods` (`demo_auth` vs `otp`/`pi`).

---

## 9. Source
- PDF: `ABDM_ABHA_V3_AP_Is_SOP_V1_0_1_13_09_24_2d0e7c0839.pdf` (ABDM ABHA V3 APIs Integrator Guide, V1.0, dated 13-Sep-24).
- Extracted text work file: `C:\Users\Revanth\AppData\Local\Temp\opencode\abha_sop.txt`.