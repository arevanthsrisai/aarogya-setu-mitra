// ===================================================================
// AAROGYA SETU MITRA — Groq AI Service Client Layer
// ABDM Intelligence Layer (Module F / A6 / A7)
// ===================================================================

const { Groq } = require('groq-sdk');
const fs = require('fs');
const path = require('path');

const MANDATORY_DISCLAIMER = "This is a pattern noticed in your health records based on available data, not a medical diagnosis. Please discuss this with your ASHA worker, ANM, or doctor.";

// User Call Tracker for Rate Limiting (max 50 calls/hour per user)
const userCallTracker = new Map();
const RATE_LIMIT_CAP = 50;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

// Initialize Groq Client
let groq = null;
const apiKey = process.env.GROQ_API_KEY;
const isRealKeyAvailable = apiKey && apiKey !== 'your_groq_api_key_here' && apiKey.startsWith('gsk_');

if (isRealKeyAvailable) {
  try {
    groq = new Groq({ apiKey });
    console.log('✅ Groq AI Client initialized with real API Key.');
  } catch (err) {
    console.warn('⚠️ Groq SDK initialization warning:', err.message);
  }
} else {
  console.warn('⚠️ GROQ_API_KEY is not set or is using template placeholder. Local AI Guardrail Fallback Adapter active.');
}

const CHAT_MODEL = process.env.GROQ_CHAT_MODEL || 'qwen/qwen3.8-27b';
const FAST_MODEL = process.env.GROQ_FAST_MODEL || 'qwen/qwen3.8-27b';
const STT_MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3';

// ── Diagnostic Guardrail Check ──
function checkDiagnosticGuardrail(text) {
  if (!text) return text;
  const diagnosticPatterns = [
    /\byou have\b/i,
    /\bdiagnosed with\b/i,
    /\btake \d+\s*mg\b/i,
    /\bprescribe\b/i,
    /\btreatment for\b/i,
    /\bsuffering from\b/i
  ];

  let flagged = false;
  let sanitized = text;
  for (const pattern of diagnosticPatterns) {
    if (pattern.test(sanitized)) {
      flagged = true;
      sanitized = sanitized.replace(pattern, '[Observation noted]');
    }
  }

  if (flagged) {
    console.warn('🛡️ AI Guardrail Intercepted diagnostic phrasing in model output and sanitized it.');
  }
  return sanitized;
}

// ── Mandatory Disclaimer Wrapper ──
function wrapWithDisclaimer(content) {
  const sanitized = checkDiagnosticGuardrail(content);
  if (!sanitized) return MANDATORY_DISCLAIMER;
  if (sanitized.includes(MANDATORY_DISCLAIMER)) return sanitized;
  return `${sanitized}\n\n${MANDATORY_DISCLAIMER}`;
}

// ── Rate Limiter ──
function checkRateLimit(userId = 'global') {
  const now = Date.now();
  let record = userCallTracker.get(userId);
  if (!record || (now - record.startTime > RATE_LIMIT_WINDOW)) {
    record = { count: 0, startTime: now };
    userCallTracker.set(userId, record);
  }
  if (record.count >= RATE_LIMIT_CAP) {
    throw new Error('AI API rate limit exceeded (50 calls/hour cap). Please try again later.');
  }
  record.count++;
}

// ── Groq API Call Wrapper with Single Retry ──
async function callGroqChat(messages, model = FAST_MODEL, temperature = 0.3) {
  if (!groq) return null;
  try {
    const response = await groq.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: 500
    });
    return response.choices[0]?.message?.content || null;
  } catch (err) {
    console.warn('Groq Chat first attempt failed, retrying once...', err.message);
    try {
      const retryResponse = await groq.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: 500
      });
      return retryResponse.choices[0]?.message?.content || null;
    } catch (retryErr) {
      console.error('Groq Chat retry failed:', retryErr.message);
      return null;
    }
  }
}

// ==================== EXPORTED AI FUNCTIONS ====================

// 1. AI Health-Record Summarization (Module F)
async function summarizeHealthRecord(records, userId = 'global') {
  checkRateLimit(userId);
  const prompt = [
    { role: 'system', content: 'You are a clinical decision support assistant for Indian rural healthcare workers. Summarize patient history in 2-3 concise plain-language bullet points. Never diagnose or prescribe.' },
    { role: 'user', content: `Summarize the following patient records:\n${JSON.stringify(records, null, 2)}` }
  ];

  const aiResult = await callGroqChat(prompt, CHAT_MODEL);
  if (aiResult) return wrapWithDisclaimer(aiResult);

  // Fallback Local Deterministic Summary
  const obsList = records.observations || [];
  const obsSummary = obsList.length > 0
    ? obsList.map(o => `• Recorded ${o.type}: ${o.value} ${o.unit || ''} on ${o.recorded_at?.split('T')[0] || 'recent visit'}.`).join('\n')
    : '• No critical lab abnormalities recorded.';
  
  const refList = records.referrals || [];
  const refSummary = refList.length > 0 ? `• Active referral for ${refList[0].reason} (${refList[0].status}).` : '• No active hospital transfers.';

  return wrapWithDisclaimer(`Clinical Summary:\n${obsSummary}\n${refSummary}`);
}

// 2. AI Report Comparison (Module F)
async function compareReports(previousValue, currentValue, fieldName, userId = 'global') {
  checkRateLimit(userId);
  const prompt = [
    { role: 'system', content: 'Compare two health measurements for a patient and describe the clinical trend in one sentence. Do not diagnose.' },
    { role: 'user', content: `Field: ${fieldName}. Previous: ${previousValue}, Current: ${currentValue}.` }
  ];

  const aiResult = await callGroqChat(prompt, FAST_MODEL);
  if (aiResult) return wrapWithDisclaimer(aiResult);

  // Fallback Local Trend Calculation
  let direction = 'stable';
  if (currentValue > previousValue) direction = 'increasing';
  else if (currentValue < previousValue) direction = 'decreasing';

  const desc = `${fieldName} shows a ${direction} trend from ${previousValue} to ${currentValue}.`;
  return wrapWithDisclaimer(desc);
}

// 3. Patient-Friendly Explanations (Module F)
async function generatePatientExplanation(clinicalSummary, language = 'en', userId = 'global') {
  checkRateLimit(userId);
  const prompt = [
    { role: 'system', content: `Explain the following clinical status to a rural patient in simple ${language} language. Keep it reassuring, 2 short sentences.` },
    { role: 'user', content: clinicalSummary }
  ];

  const aiResult = await callGroqChat(prompt, CHAT_MODEL);
  if (aiResult) return wrapWithDisclaimer(aiResult);

  const localExplanations = {
    hi: `आपकी स्वास्थ्य जांच रिपोर्ट में कुछ बदलाव देखे गए हैं। कृपया अपनी आशा कार्यकर्ता या पास के डॉक्टर से सलाह लें।`,
    mr: `तुमच्या आरोग्य तपासणी अहवालात काही बदल आढळले आहेत. कृपया तुमच्या आशा ताईं किंवा डॉक्टरांचा सल्ला घ्या.`,
    en: `Changes were observed in your health records. Please discuss these numbers with your ASHA worker or doctor.`
  };

  return wrapWithDisclaimer(localExplanations[language] || localExplanations.en);
}

// 4. Multilingual Translation (A6)
async function translateText(text, targetLanguage = 'hi', userId = 'global') {
  checkRateLimit(userId);
  if (!text || targetLanguage === 'en') return text;

  const prompt = [
    { role: 'system', content: `Translate the text into ${targetLanguage}. Return ONLY the translated string.` },
    { role: 'user', content: text }
  ];

  const aiResult = await callGroqChat(prompt, FAST_MODEL);
  if (aiResult) return checkDiagnosticGuardrail(aiResult);

  // Local fallback dictionary
  const dict = {
    hi: {
      'Patient Record': 'मरीज रिकॉर्ड',
      'Clinical Triage': 'स्वास्थ्य जांच',
      'Referral Ticket': 'डॉक्टर रेफरल',
      'High Fever': 'तेज बुखार'
    },
    mr: {
      'Patient Record': 'रुग्ण नोंदणी',
      'Clinical Triage': 'आरोग्य तपासणी',
      'Referral Ticket': 'डॉक्टर संदर्भ',
      'High Fever': 'काढलेला ताप'
    }
  };

  return dict[targetLanguage]?.[text] || `[${targetLanguage.toUpperCase()}] ${text}`;
}

// 5. Speech-to-Text Transcribe Audio (A7)
async function transcribeAudio(audioBuffer, filename = 'speech.wav', userId = 'global') {
  checkRateLimit(userId);
  if (groq && isRealKeyAvailable) {
    const safeName = path.basename(filename || 'speech.wav').replace(/[^a-zA-Z0-9._-]/g, '_');
    const tempPath = `./data/${Date.now()}_${safeName}`;
    try {
      fs.writeFileSync(tempPath, audioBuffer);
      const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model: STT_MODEL,
        response_format: 'json'
      });
      return transcription.text || '';
    } catch (err) {
      console.warn('Groq Whisper STT API warning:', err.message);
    } finally {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (e) { /* ignore */ }
    }
  }
  return '';
}

// 6. Conversational AI Chatbot ("Aarogya Mitra")
async function chatWithMitra(messages = [], language = 'en', userId = 'global') {
  checkRateLimit(userId);

  const systemPrompts = {
    hi: `आप "आरोग्य सेतु मित्र" (Aarogya Setu Mitra) हैं - एक दयालु, स्पष्ट और सहायक ग्रामीण स्वास्थ्य मार्गदर्शन एआई। आपका काम ग्रामीण लोगों, आशा कार्यकर्ताओं और परिवारों को हिंदी में सरल, आसानी से समझने योग्य स्वास्थ्य मार्गदर्शन देना है। कभी भी मेडिकल जांच, अंतिम बीमारी का दावा या दवा की सटीक खुराक न बताएं। हमेशा आशा कार्यकर्ता या डॉक्टर से परामर्श करने की सलाह दें।`,
    mr: `तुम्ही "आरोग्य सेतू मित्र" (Aarogya Setu Mitra) आहात - एक दयाळू, स्पष्ट आणि उपयुक्त ग्रामीण आरोग्य मार्गदर्शन AI. तुमचे काम ग्रामीण भागातील लोकांना, आशा ताईंना आणि कुटुंबांना सोप्या मराठीत आरोग्य विषयक माहिती देणे आहे. वैद्यकीय निदान किंवा औषधांचे डोस देऊ नका. नेहमी आशा ताई किंवा डॉक्टरांचा सल्ला घेण्याचा सल्ला द्या.`,
    en: `You are "Aarogya Setu Mitra" - a compassionate, clear, and helpful rural healthcare assistant. Your task is to provide supportive, easy-to-understand health awareness and guidance for rural families, ASHA workers, and caregivers. Never provide formal medical diagnosis, drug prescriptions, or exact dosage numbers. Always encourage consulting with an ASHA worker, ANM, or PHC doctor.`
  };

  const selectedSysPrompt = systemPrompts[language] || systemPrompts.en;

  const formattedMessages = [
    { role: 'system', content: selectedSysPrompt },
    ...messages.slice(-6).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: String(m.content)
    }))
  ];

  const aiResult = await callGroqChat(formattedMessages, CHAT_MODEL, 0.4);
  if (aiResult) return wrapWithDisclaimer(aiResult);

  // Local fallback response per language
  const userQuery = (messages[messages.length - 1]?.content || '').toLowerCase();

  const fallbacks = {
    hi: {
      fever: "बुखार आने पर मरीज को पर्याप्त पानी और तरल पदार्थ दें, ठंडी पट्टी लगाएं। यदि बुखार 2 दिन से अधिक हो या सुस्ती हो तो तुरंत एएनएम या निकटतम पीएचसी डॉक्टर को दिखाएं।",
      pregnant: "गर्भवती महिलाओं को नियमित एंटीनेटल चेकअप (ANC), आयरन-फॉलिक एसिड की गोलियां और पौष्टिक आहार (हरी सब्जियां, दूध) लेना चाहिए। किसी भी खतरे के संकेत पर आशा ताई से संपर्क करें।",
      vaccine: "बच्चों को समय पर टीकाकरण (BCG, Polio, Pentavalent, Measles) करवाना आवश्यक है। नजदीकी उप-स्वास्थ्य केंद्र या आशा कार्यकर्ता से अगला टीका चार्ट प्राप्त करें।",
      sugar: "ब्लड शुगर (ग्लूकोज) टेस्ट के लिए खाली पेट (8-10 घंटे) का सैंपल बेहतर है। ग्लूकोमीटर से उंगली में चुभाकर जांच करें या निकटतम पीएचसी/लैब में फास्टिंग ब्लड शुगर या HbA1c टेस्ट करवाएं। सामान्य फास्टिंग शुगर 70-100 mg/dL होती है। रिपोर्ट आशा वर्कर या डॉक्टर को दिखाएं।",
      bp: "ब्लड प्रेशर बैठकर, 5 मिनट आराम के बाद जांचें। सामान्य BP लगभग 120/80 mmHg होता है। 140/90 से अधिक होने पर पीएचसी डॉक्टर से फॉलो-अप करें।",
      default: "नमस्ते! मैं आपका आरोग्य सेतु मित्र हूँ। मैं आपको स्वास्थ्य सुरक्षा, पोषण, टीकाकरण और आपातकालीन रेफरल की जानकारी दे सकता हूँ। कृपया अपना प्रश्न पूछें।"
    },
    mr: {
      fever: "ताप आल्यास रुग्णाला भरपूर पाणी द्या आणि डोक्यावर मिठाच्या पाण्याच्या पट्ट्या ठेवा. ताप २ दिवसांपेक्षा जास्त असल्यास किंवा गळून गेल्यास त्वरित आशा ताई किंवा पीएचसी डॉक्टरांकडे जा.",
      pregnant: "गरोदर महिलांनी नियमित तपासणी, लोह व फॉलिक अ‍ॅसिडच्या गोळ्या आणि पौष्टिक आहार घ्यावा. काही अडचण असल्यास आशा ताईंशी संपर्क साधा.",
      vaccine: "बाळाला वेळेवर लसीकरण (BCG, पोलिओ, पेन्टाव्हॅलंट, गोवर) देणे अत्यंत महत्त्वाचे आहे. अधिक माहितीसाठी आशा ताईंशी संपर्क साधा.",
      sugar: "ब्लड शुगर (ग्लूकोज) तपासणीसाठी उपाशी पोट (८-१० तास) चा नमुना उत्तम. ग्लूकोमीटरने बोटात टोचून तपासा किंवा जवळच्या पीएचसी/प्रयोगशाळेत फास्टिंग ब्लड शुगर किंवा HbA1c चाचणी करा. सामान्य फास्टिंग शुगर ७०-१०० mg/dL असते. अहवाल आशा ताईंना किंवा डॉक्टरांना दाखवा.",
      bp: "रक्तदाब बसून, ५ मिनिटे आराम केल्यावर तपासा. सामान्य BP सुमारे १२०/८० mmHg असते. १४०/९० पेक्षा जास्त असल्यास पीएचसी डॉक्टरांकडे फॉलो-अप करा.",
      default: "नमस्कार! मी तुमचा आरोग्य सेतू मित्र आहे. मी तुम्हाला आरोग्य, लसीकरण आणि गरोदरपणाबद्दल माहिती देऊ शकतो. कृपया तुमचा प्रश्न विचारा."
    },
    en: {
      fever: "For fever, ensure the person rests, drinks plenty of clean fluids, and uses cool compresses. If fever persists over 2 days or there is extreme weakness, consult your ASHA worker or PHC doctor immediately.",
      pregnant: "Pregnant women should undergo regular ANC checkups, take iron-folic acid supplements, and maintain a nutritious diet. Contact your ASHA worker for hospital delivery registration.",
      vaccine: "Childhood immunizations (BCG, Polio, Pentavalent, Measles) protect against severe infections. Follow the child vaccine card provided by your ANM.",
      sugar: "For a blood sugar (glucose) test, a fasting sample is preferred: do not eat for 8-10 hours, then test with a glucometer (fingertip prick) or visit the nearest PHC/lab for a Fasting Blood Sugar or HbA1c test. Normal fasting sugar is 70-100 mg/dL. Share the report with your ASHA worker or doctor.",
      bp: "Blood pressure should be checked while seated, after resting for 5 minutes. Normal BP is around 120/80 mmHg. If it is above 140/90, follow up with your PHC doctor.",
      default: "Hello! I am your Aarogya Setu Mitra healthcare companion. Ask me any health awareness questions regarding fever, pregnancy care, child vaccines, or hospital referrals."
    }
  };

  const langFallback = fallbacks[language] || fallbacks.en;
  let reply = langFallback.default;
  if (userQuery.includes('fever') || userQuery.includes('बुखार') || userQuery.includes('ताप')) reply = langFallback.fever;
  else if (userQuery.includes('pregnant') || userQuery.includes('गर्भवती') || userQuery.includes('गरोदर')) reply = langFallback.pregnant;
  else if (userQuery.includes('vaccine') || userQuery.includes('टीका') || userQuery.includes('लस')) reply = langFallback.vaccine;
  else if (userQuery.includes('glucose') || userQuery.includes('sugar') || userQuery.includes('शुगर') || userQuery.includes('मधुमेह') || userQuery.includes('डायबिटीज')) reply = langFallback.sugar;
  else if (userQuery.includes('blood pressure') || userQuery.includes(' बीपी ') || userQuery.includes('bp') || userQuery.includes('रक्तचाप') || userQuery.includes('प्रेशर')) reply = langFallback.bp;

  return wrapWithDisclaimer(reply);
}

module.exports = {
  MANDATORY_DISCLAIMER,
  checkDiagnosticGuardrail,
  wrapWithDisclaimer,
  summarizeHealthRecord,
  compareReports,
  generatePatientExplanation,
  translateText,
  transcribeAudio,
  chatWithMitra,
  isRealKeyAvailable
};
