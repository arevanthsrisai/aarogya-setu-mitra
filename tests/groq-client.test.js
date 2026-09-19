const assert = require('assert');
const {
  MANDATORY_DISCLAIMER,
  checkDiagnosticGuardrail,
  wrapWithDisclaimer,
  summarizeHealthRecord,
  compareReports,
  generatePatientExplanation,
  translateText,
  transcribeAudio,
  chatWithMitra
} = require('../src/groqClient');

async function runGroqClientTests() {
  console.log('\n============================================================');
  console.log('            GROQ AI CLIENT MODULE - UNIT TESTS              ');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      passed++;
      console.log(`[PASS] ${name}`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] ${name}:`, err.message);
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`[PASS] ${name}`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] ${name}:`, err.message);
    }
  }

  // 1. Disclaimer Wrapper Test
  test('Mandatory Disclaimer is automatically appended to content', () => {
    const content = 'Patient exhibits stable blood pressure readings.';
    const wrapped = wrapWithDisclaimer(content);
    assert(wrapped.includes(MANDATORY_DISCLAIMER), 'Disclaimer must be present');
  });

  // 2. Diagnostic Guardrail Test
  test('Diagnostic guardrail replaces "you have" or "diagnosed with" phrasing', () => {
    const dangerousText = 'You have severe anemia and were diagnosed with diabetes.';
    const sanitized = checkDiagnosticGuardrail(dangerousText);
    assert(!sanitized.includes('You have'), 'Diagnostic phrase "You have" must be blocked');
    assert(!sanitized.includes('diagnosed with'), 'Diagnostic phrase "diagnosed with" must be blocked');
  });

  // 3. Health Record Summarization Test
  await asyncTest('summarizeHealthRecord returns disclaimer-wrapped summary', async () => {
    const summary = await summarizeHealthRecord({
      patient: { first_name: 'Test', age: 30 },
      observations: [{ type: 'hemoglobin', value: 11.2, recorded_at: '2026-08-01' }]
    }, 'test-user-1');

    assert(summary.includes(MANDATORY_DISCLAIMER), 'Summary must include disclaimer');
    assert(typeof summary === 'string', 'Summary must be string');
  });

  // 4. Report Comparison Test
  await asyncTest('compareReports returns trend description with disclaimer', async () => {
    const trend = await compareReports(14.0, 10.5, 'hemoglobin', 'test-user-2');
    assert(trend.includes(MANDATORY_DISCLAIMER), 'Trend must include disclaimer');
    assert(trend.toLowerCase().includes('hemoglobin'), 'Trend must reference field name');
  });

  // 5. Patient Explanation Test
  await asyncTest('generatePatientExplanation produces language output with disclaimer', async () => {
    const explanation = await generatePatientExplanation('Hemoglobin level is 9.5 g/dL', 'hi', 'test-user-3');
    assert(explanation.includes(MANDATORY_DISCLAIMER), 'Explanation must contain mandatory disclaimer');
  });

  // 6. Translation Test
  await asyncTest('translateText converts English to target language', async () => {
    const translatedHi = await translateText('Patient Record', 'hi', 'test-user-4');
    assert(translatedHi && translatedHi.length > 0, 'Translation must not be empty');
    
    const translatedMr = await translateText('Patient Record', 'mr', 'test-user-5');
    assert(translatedMr && translatedMr.length > 0, 'Translation must not be empty');
  });

  // 7. Speech-to-Text Test
  await asyncTest('transcribeAudio returns honest result without fabricating symptom data', async () => {
    const mockBuffer = Buffer.from('RIFF....WAVEfmt ...data....');
    const result = await transcribeAudio(mockBuffer, 'sample.wav', 'test-user-6');
    assert(typeof result === 'string', 'STT must return string');
    assert(!result.includes('Fever for 3 days'), 'STT must not fabricate symptom data');
  });

  // 8. Conversational AI Chatbot Test (English, Hindi, Marathi)
  await asyncTest('chatWithMitra answers queries in English, Hindi, and Marathi with mandatory disclaimer', async () => {
    const replyEn = await chatWithMitra([{ role: 'user', content: 'What to do for fever in child?' }], 'en', 'test-user-7');
    assert(replyEn.includes(MANDATORY_DISCLAIMER), 'Chat reply must include medical disclaimer');

    const replyHi = await chatWithMitra([{ role: 'user', content: 'बच्चे को तेज बुखार है क्या करें?' }], 'hi', 'test-user-8');
    assert(replyHi.includes(MANDATORY_DISCLAIMER), 'Hindi Chat reply must include disclaimer');

    const replyMr = await chatWithMitra([{ role: 'user', content: 'तापावर काय करावे?' }], 'mr', 'test-user-9');
    assert(replyMr.includes(MANDATORY_DISCLAIMER), 'Marathi Chat reply must include disclaimer');
  });

  console.log(`\n------------------------------------------------------------`);
  console.log(`GROQ AI UNIT TESTS RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log(`------------------------------------------------------------\n`);

  if (failed > 0) process.exit(1);
}

runGroqClientTests();
