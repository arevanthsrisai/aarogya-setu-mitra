# TEST COVERAGE & AUTOMATION MATRIX

## 1. Groq AI Client Unit Test Suite (`tests/groq-client.test.js`) — 8/8 PASSED
- `Mandatory Disclaimer Appending`: Verified mandatory medical disclaimer is appended automatically.
- `Diagnostic Guardrail Interception`: Verified diagnostic phrasing ("you have", "diagnosed with") is intercepted & sanitized.
- `Health Record Summarization`: Verified disclaimer-wrapped clinical summaries.
- `Report Comparison`: Verified multi-visit trend comparison & delta calculation.
- `Patient Explanation`: Verified plain-language explanation generation.
- `Multilingual Translation`: Verified English to Hindi/Marathi translation output.
- `Speech-to-Text (STT)`: Verified Groq Whisper transcription fallback.
- `Conversational AI Chatbot`: Verified `chatWithMitra` live responses in English, Hindi, and Marathi with model `qwen/qwen3.8-27b` and mandatory disclaimer.

## 2. Integration Test Suite (`tests/run-tests.js`) — 12/12 PASSED
- `TEST 1`: ASHA Authentication (JWT token issuance)
- `TEST 2`: ASHA Patient Creation
- `TEST 3`: Triage Rule Evaluation (Child Fever & Danger Signs)
- `TEST 4`: Referral Ticket Creation
- `TEST 5`: Referral State Machine Transitions (`BOOKED` -> `SEEN` -> `REFERRED` -> `ARRIVED` -> `TREATED` -> `CLOSED`)
- `TEST 6`: Doctor Clinical Summary View
- `TEST 7`: Consent & Revocation Security (RBAC & ABDM Caregiver blocking)
- `TEST 8`: RADAR Directory Real-Time Query & Stock Updates
- `TEST 9`: Government Officer Dashboard Analytics
- `TEST 10`: Trend Detection & AI Guardrails (Live AI model execution)
- `TEST 11`: Offline Data Sync & Queue Push
- `TEST 12`: Server-Side RBAC Enforcement (403 Forbidden)

## 3. Playwright End-to-End Suite (`tests/e2e`) — 25/25 PASSED
- `auth-and-roles.spec.js`: 2 tests passed (Caregiver navigation restrictions & THO Officer access)
- `abha-consent-flow.spec.js`: 1 test passed (Consent revocation blocks caregiver)
- `groq-ai-features.spec.js`: 5 tests passed (AI Summarization, AI Report Comparison, Multilingual Translation, Voice STT, Conversational AI Chatbot in EN/HI/MR)
- `module1-triage-record.spec.js`: 2 tests passed (Patient registration & anemia triage)
- `module2-connect-refer.spec.js`: 1 test passed (Referral ticket state progression)
- `module3-radar.spec.js`: 1 test passed (RADAR directory query & medicine stock)
- `module4-dashboard.spec.js`: 1 test passed (Officer Command Dashboard calculation)
- `offline-sync.spec.js`: 1 test passed (Online/Offline sync status indicator)
- `smoke.spec.js`: 11 tests passed (All role views load without crashing)
