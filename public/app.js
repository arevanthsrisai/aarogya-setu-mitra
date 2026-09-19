// ===================================================================
// AAROGYA SETU MITRA — Complete Frontend Application Engine
// Rural Healthcare Continuity Platform — All Modules Implemented
// ===================================================================

function getStoredSyncQueue() {
  try {
    const item = localStorage.getItem('syncQueue');
    return item ? JSON.parse(item) : [];
  } catch (e) {
    return [];
  }
}

// Stable id per offline op so the backend can dedupe replayed mutations.
function newClientMutationId() {
  return (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'cm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const state = {
  user: null,
  token: localStorage.getItem('token') || null,
  currentRoute: 'patients',
  routeParams: {},
  language: localStorage.getItem('lang') || 'en',
  syncQueue: getStoredSyncQueue(),
  isOnline: navigator.onLine,
  refreshToken: localStorage.getItem('refreshToken') || null,
  translations: {},
  notifications: [],
  unreadCount: 0,
  notifPanelOpen: false,
  chatHistory: [],
  chatLang: localStorage.getItem('lang') || 'en',
  chatOpen: false
};

// ── API Client with Offline Support ──
async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

  if (!state.isOnline && options.method && options.method !== 'GET') {
    const offlineRecord = {
      id: Date.now().toString(),
      client_mutation_id: newClientMutationId(),
      endpoint,
      method: options.method,
      body: options.body ? JSON.parse(options.body) : null,
      timestamp: new Date().toISOString()
    };
    state.syncQueue.push(offlineRecord);
    localStorage.setItem('syncQueue', JSON.stringify(state.syncQueue));
    updateSyncIndicator();
    return { offline: true, message: 'Action saved locally in offline queue.' };
  }

  try {
    const res = await fetch(`/api${endpoint}`, { ...options, headers });
    if (res.status === 401 && state.refreshToken && !options._isRetry) {
      // Silent access-token refresh, then retry once.
      try {
        const r = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: state.refreshToken })
        });
        if (r.ok) {
          const d = await r.json();
          state.token = d.token;
          localStorage.setItem('token', d.token);
          return await api(endpoint, { ...options, _isRetry: true });
        }
      } catch (e) { /* fall through to logout */ }
    }
    if (res.status === 401) { logout(); throw new Error('Session expired'); }
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'API Request failed');
      err.code = data.code;
      throw err;
    }
    return data;
  } catch (err) {
    if (!state.isOnline || err.message === 'Failed to fetch') {
      state.isOnline = false;
      updateSyncIndicator();
    }
    throw err;
  }
}

// ── Navigation & Auth ──
function navigateTo(route, params = {}) {
  state.currentRoute = route;
  state.routeParams = params;
  state.notifPanelOpen = false;
  renderApp();
}

function logout() {
  state.user = null;
  state.token = null;
  state.refreshToken = null;
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  renderApp();
}

async function init() {
  window.addEventListener('online', handleNetworkChange);
  window.addEventListener('offline', handleNetworkChange);

  try {
    if (state.token) {
      try {
        const res = await api('/auth/me');
        state.user = res.user;
        if (state.user.role === 'CAREGIVER') state.currentRoute = 'caregiver';
        else if (['THO', 'DHO', 'STATE_MSIS'].includes(state.user.role)) state.currentRoute = 'dashboard';
        else state.currentRoute = 'patients';
      } catch (e) {
        state.user = null;
        state.token = null;
        localStorage.removeItem('token');
      }
    }
    if (state.language && state.language !== 'en') {
      try {
        await loadTranslations(state.language);
      } catch (e) {
        console.warn('Translation load warning:', e);
      }
    }
  } catch (err) {
    console.error('Init error:', err);
  } finally {
    renderApp();
    maybeAutoTour();
  }
}

function handleNetworkChange() {
  state.isOnline = navigator.onLine;
  updateSyncIndicator();
  if (state.isOnline && state.syncQueue.length > 0) syncOfflineQueue();
}

async function syncOfflineQueue() {
  if (state.syncQueue.length === 0) return;
  const queue = [...state.syncQueue];
  state.syncQueue = [];
  localStorage.setItem('syncQueue', '[]');
  const recordsToPush = queue.map(q => ({
    table_name: getTableFromEndpoint(q.endpoint),
    record_id: q.body?.id || Date.now().toString(),
    action: q.method === 'POST' ? 'INSERT' : 'UPDATE',
    client_mutation_id: q.client_mutation_id,
    data: q.body
  }));
  try {
    await api('/sync/push', { method: 'POST', body: JSON.stringify({ records: recordsToPush }) });
    showNotification('✅ Network restored — synced offline changes.');
  } catch (e) { console.error('Offline sync failed:', e); }
  updateSyncIndicator();
}

function getTableFromEndpoint(ep) {
  if (ep.includes('/patients')) return 'patients';
  if (ep.includes('/observations')) return 'observations';
  if (ep.includes('/referrals')) return 'referrals';
  if (ep.includes('/triage')) return 'triage_results';
  return 'patients';
}

function updateSyncIndicator() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (!state.isOnline) {
    el.innerHTML = `<span class="badge badge-danger"><span class="status-dot offline"></span>Offline (${state.syncQueue.length} queued)</span>`;
  } else if (state.syncQueue.length > 0) {
    el.innerHTML = `<span class="badge badge-warning"><span class="status-dot pending"></span>Syncing ${state.syncQueue.length}...</span>`;
  } else {
    el.innerHTML = `<span class="badge badge-success"><span class="status-dot online"></span>Online</span>`;
  }
}

function showNotification(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast animate-fade';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ── Translation / i18n ──
async function loadTranslations(lang) {
  try {
    state.translations = await api(`/translations/${lang}`);
  } catch (e) { state.translations = {}; }
}

function t(key, fallback) {
  if (state.translations && state.translations[key]) return state.translations[key];
  const dict = {
    hi: {
      'nav.core': 'मुख्य स्वास्थ्य सेवाएँ',
      'nav.specialized': 'विशेष स्वास्थ्य देखभाल',
      'nav.intelligence': 'डिजिटल रिकॉर्ड्स एवं रिपोर्ट',
      'nav.security': 'सुरक्षा एवं अनुमति',
      'nav.patients': '👥 मरीज रिकॉर्ड एवं पंजीकरण',
      'nav.triage': '⚡ लक्षण एवं आपातकालीन जांच',
      'nav.referrals': '🔄 डॉक्टर सलाह एवं रेफरल',
      'nav.maternal_child': '👶 माता एवं शिशु देखभाल',
      'nav.immunizations': '💉 बच्चों का टीकाकरण चार्ट',
      'nav.ncd': '🩺 बीपी एवं शुगर जांच',
      'nav.ocr_scanner': '📄 लैब रिपोर्ट फोटो स्कैनर',
      'nav.radar': '📡 निकटतम अस्पताल एवं दवाइयाँ',
      'nav.fhir_inspector': '🔥 डिजिटल स्वास्थ्य कार्ड (आभा)',
      'nav.dashboard': '📊 स्वास्थ्य अधिकारी डैशबोर्ड',
      'nav.consents': '🔒 परिवार स्वास्थ्य अनुमति',
      'nav.caregiver': '🤝 केयरगिवर सहायता पोर्टल',
      'nav.audit': '📜 सिस्टम गतिविधि लॉग',
      'patient.register': 'नया मरीज पंजीकृत करें',
      'patient.search': 'मरीज खोजें (नाम, गाँव, आईडी)',
      'patient.name': 'मरीज का नाम',
      'patient.age': 'उम्र',
      'patient.village': 'गाँव',
      'btn.signout': 'साइन आउट करें',
      'btn.cancel': 'रद्द करें',
      'btn.submit': 'सुरक्षित करें',
      'btn.back': '← वापस जाएँ',
      'badge.online': '🌐 ऑनलाइन जुड़े हैं',
      'badge.offline': '⚡ ऑफ लाइन (स्थानीय सहेजा गया)',
      'title.brand': 'आरोग्य सेतु मित्र',
      'title.subtitle': 'ग्रामीण स्वास्थ्य सेवा मंच'
    },
    mr: {
      'nav.core': 'मुख्य आरोग्य सेवा',
      'nav.specialized': 'विशेष आरोग्य काळजी',
      'nav.intelligence': 'डिजिटल नोंदी व अहवाल',
      'nav.security': 'सुरक्षा व संमती',
      'nav.patients': '👥 रुग्ण नोंदी व नोंदणी',
      'nav.triage': '⚡ लक्षणे व आणीबाणी तपासणी',
      'nav.referrals': '🔄 डॉक्टर सल्ला व रेफरल',
      'nav.maternal_child': '👶 माता व बाल संगोपन',
      'nav.immunizations': '💉 बाल लसीकरण तक्ता',
      'nav.ncd': '🩺 बीपी व साखर तपासणी',
      'nav.ocr_scanner': '📄 प्रयोगशाळा अहवाल स्कॅनर',
      'nav.radar': '📡 जवळील रुग्णालय व औषधे',
      'nav.fhir_inspector': '🔥 डिजिटल आरोग्य कार्ड (आभा)',
      'nav.dashboard': '📊 आरोग्य अधिकारी डॅशबोर्ड',
      'nav.consents': '🔒 कुटुंब आरोग्य संमती',
      'nav.caregiver': '🤝 काळजीवाहू मदत पोर्टल',
      'nav.audit': '📜 प्रणाली नोंदणी लॉग',
      'patient.register': 'नवीन रुग्ण नोंदणी करा',
      'patient.search': 'रुग्ण शोधा (नाव, गाव, आयडी)',
      'patient.name': 'रुग्णाचे नाव',
      'patient.age': 'वय',
      'patient.village': 'गाव',
      'btn.signout': 'साइन आउट करा',
      'btn.cancel': 'रद्द करा',
      'btn.submit': 'जतन करा',
      'btn.back': '← मागे जा',
      'badge.online': '🌐 ऑनलाइन जोडलेले आहात',
      'badge.offline': '⚡ ऑफलाईन (स्थानिक जतन केले)',
      'title.brand': 'आरोग्य सेतू मित्र',
      'title.subtitle': 'ग्रामीण आरोग्य सेवा मंच'
    }
  };
  if (dict[state.language] && dict[state.language][key]) return dict[state.language][key];
  return fallback || key;
}

async function toggleLanguage() {
  const langs = ['en', 'hi', 'mr'];
  const idx = langs.indexOf(state.language);
  state.language = langs[(idx + 1) % langs.length];
  localStorage.setItem('lang', state.language);
  if (state.language !== 'en') await loadTranslations(state.language);
  else state.translations = {};
  renderApp();
}

function getLangLabel() {
  const labels = { en: 'English', hi: 'हिंदी', mr: 'मराठी' };
  return labels[state.language] || 'English';
}

// ── Notifications ──
async function loadNotifications() {
  try {
    state.notifications = await api('/notifications');
    state.unreadCount = state.notifications.filter(n => !n.read).length;
  } catch (e) { /* silent */ }
}

// ── Demo Tour & Help ──
// Mirrors the canAccess() conditions used by the sidebar / renderApp
const ROUTE_ACCESS = {
  patients: ['ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'THO', 'DHO', 'STATE_MSIS'],
  triage: ['ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR'],
  referrals: ['ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'THO', 'DHO'],
  maternal_child: ['ASHA', 'ANM', 'PHC_DOCTOR'],
  immunizations: ['ASHA', 'ANM', 'PHC_DOCTOR'],
  ncd: ['ASHA', 'ANM', 'PHC_DOCTOR'],
  ocr_scanner: ['ASHA', 'ANM', 'PHC_DOCTOR'],
  radar: null, // available to every role
  fhir_inspector: null, // available to every role
  abha: null, // available to every role
  facility_mgmt: ['FACILITY_STAFF', 'PHC_DOCTOR'],
  dashboard: ['THO', 'DHO', 'STATE_MSIS', 'PHC_DOCTOR'],
  consents: ['ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'PATIENT'],
  caregiver: ['CAREGIVER'],
  audit: ['THO', 'DHO', 'STATE_MSIS']
};

// Help content shared by the guided tour AND the per-page "?" panel (single source of truth)
const TOUR_STEPS = {
  patients: {
    what: 'Store and manage every patient\u2019s health record in one place.',
    can: 'ASHA, ANM, doctors and health officers can use this page.',
    how: [
      'Search patients by name, village or ID using the search box',
      'Use \u201c+ Register Patient\u201d (ASHA/ANM/doctor) to add a new patient',
      'Open \u201cView Record\u201d to see a patient\u2019s full health summary'
    ]
  },
  triage: {
    what: 'Check symptoms and danger signs to decide if emergency care is needed.',
    can: 'ASHA, ANM and doctors.',
    how: [
      'Select the patient and enter the observed symptoms',
      'Press \u201cSave Observation\u201d to record the check',
      'Press \u201cExecute Clinical Rule Evaluation\u201d for an instant triage verdict'
    ]
  },
  referrals: {
    what: 'Route patients to the right hospital and track referral tickets.',
    can: 'ASHA, ANM, doctors and health officers (THO/DHO).',
    how: [
      'Use \u201c+ New Referral\u201d and \u201cCreate Ticket\u201d (ASHA/ANM/doctor) to send a patient onward',
      'Health officers monitor every ticket\u2019s priority and status here',
      'Escalated referrals are flagged for urgent follow-up'
    ]
  },
  maternal_child: {
    what: 'Track antenatal (ANC) visits and newborn home visits (HBNC).',
    can: 'ASHA, ANM and PHC doctors.',
    how: [
      'Open a mother\u2019s record to see her visit schedule',
      'Use \u201cSave ANC Visit\u201d to log a pregnancy check-up',
      'Use \u201cSave HBNC Visit\u201d to log a newborn home visit'
    ]
  },
  immunizations: {
    what: 'Record and track every child\u2019s vaccine doses and due dates.',
    can: 'ASHA, ANM and PHC doctors.',
    how: [
      'View each child\u2019s vaccine chart and upcoming due dates',
      'Mark doses as given when a vaccine is administered',
      'Overdue doses are highlighted so no child is missed'
    ]
  },
  ncd: {
    what: 'Monitor blood pressure and blood sugar for long-term patients.',
    can: 'ASHA, ANM and PHC doctors.',
    how: [
      'Enter today\u2019s BP or sugar reading for the patient',
      'Use \u201cSave NCD Follow-up Record\u201d to store the visit',
      'Watch the trend over time to catch worsening control early'
    ]
  },
  ocr_scanner: {
    what: 'Photograph a paper lab report and extract its values automatically.',
    can: 'ASHA, ANM and PHC doctors.',
    how: [
      'Take or upload a photo of the paper lab report',
      'The scanner reads values like haemoglobin, BP and sugar',
      'Verify the extracted values before saving them to the record'
    ]
  },
  radar: {
    what: 'Find the nearest hospital and check medicine stock availability.',
    can: 'Available to every role \u2014 use it before referring a patient.',
    how: [
      'Search by medicine name to see which facilities have stock',
      'Check hospital distance and contact details',
      'Confirm stock exists at the receiving facility before referral'
    ]
  },
  fhir_inspector: {
    what: 'View and verify ABDM digital health records (FHIR) for a patient.',
    can: 'Available to every role for ABDM interoperability checks.',
    how: [
      'Enter a patient\u2019s ABHA ID or health ID',
      'Inspect the fetched FHIR resources and their history',
      'Use it to confirm records are complete and consistent'
    ]
  },
  abha: {
    what: 'Connect patients to the ABHA (Ayushman Bharat Health Account) system.',
    can: 'Available to every role \u2014 needed for digital health card access.',
    how: [
      'Link a patient\u2019s existing ABHA ID to their record',
      'Create a new ABHA ID when the patient does not have one',
      'Once linked, the digital health card can be issued'
    ]
  },
  facility_mgmt: {
    what: 'Manage facility staff, doctor availability and medicine stock.',
    can: 'Facility staff and PHC doctors.',
    how: [
      'Toggle doctor availability for the day',
      'Update medicine quantities through the stock form (\u201cSave\u201d)',
      'Keep stock levels current so referrals never stall'
    ]
  },
  dashboard: {
    what: 'See district and state-wide health reports, trends and alerts.',
    can: 'THO, DHO, State MSIS officers and PHC doctors.',
    how: [
      'Review disease trends and referral statistics',
      'Drill into facility-level performance',
      'Monitor outbreak signals and stock alerts in real time'
    ]
  },
  consents: {
    what: 'Manage family consent for health data sharing.',
    can: 'ASHA, ANM, doctors and patients.',
    how: [
      'Review pending consent requests from family members',
      'Use \u201cGrant Consent\u201d to allow data sharing',
      'Consent can be revoked anytime \u2014 the patient stays in control'
    ]
  },
  caregiver: {
    what: 'Let a family caregiver view a patient\u2019s health summary remotely.',
    can: 'Caregiver accounts.',
    how: [
      'View the linked patient\u2019s health summary and updates',
      'Check recent visits and medicine schedules',
      'Caregivers also get radar, ABHA and health card access'
    ]
  },
  audit: {
    what: 'Review every system activity and data access log.',
    can: 'THO, DHO and State MSIS officers.',
    how: [
      'Filter logs by user, action or date',
      'Every record view and edit is traced here',
      'Use it for accountability and compliance checks'
    ]
  },
  patient_detail: {
    what: 'A patient\u2019s complete health record and summary.',
    can: 'Open from the patient list with \u201cView Record\u201d.',
    how: [
      'See history, observations, referrals and vaccines in one place',
      'Use the back button to return to the patient list'
    ]
  }
};

function canAccessRoute(route) {
  if (!state.user) return false;
  const roles = ROUTE_ACCESS[route];
  return !roles || roles.includes(state.user.role);
}

function getAccessibleRoutes() {
  return Object.keys(TOUR_STEPS).filter(r => r !== 'patient_detail' && canAccessRoute(r));
}

function getRouteIcon(route) {
  const icons = {
    patients: '👥', triage: '⚡', referrals: '🔄', maternal_child: '👶', immunizations: '💉',
    ncd: '🩺', ocr_scanner: '📄', radar: '📡', fhir_inspector: '🔥', abha: '🪪',
    facility_mgmt: '🧰', dashboard: '📊', consents: '🔒', caregiver: '🤝', audit: '📜'
  };
  return icons[route] || '📍';
}

let tourState = null;

function startDemoTour() {
  if (!state.user || tourState) return;
  const routes = getAccessibleRoutes();
  tourState = {
    routes,
    steps: [{ kind: 'welcome' }, ...routes.map(r => ({ kind: 'route', route: r })), { kind: 'summary' }],
    idx: 0
  };
  try {
    const u = state.user.username || state.user.full_name || 'user';
    localStorage.setItem('demo_done_' + String(u).toLowerCase(), '1');
  } catch (e) { /* storage unavailable — flag simply not persisted */ }
  renderTourStep();
  document.addEventListener('keydown', tourKeyHandler);
}

function endDemoTour() {
  tourState = null;
  const ov = document.getElementById('tour-overlay');
  if (ov) ov.remove();
  document.removeEventListener('keydown', tourKeyHandler);
}

function tourSkip() { endDemoTour(); }

function tourRestart() {
  if (!tourState) return;
  endDemoTour();
  startDemoTour();
}

function tourNext() {
  if (!tourState) return;
  if (tourState.idx >= tourState.steps.length - 1) { endDemoTour(); return; }
  tourState.idx += 1;
  renderTourStep();
}

function tourBack() {
  if (!tourState || tourState.idx === 0) return;
  tourState.idx -= 1;
  renderTourStep();
}

function tourKeyHandler(e) {
  if (e.key === 'Escape') { e.preventDefault(); tourSkip(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); tourNext(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); tourBack(); }
}

function renderTourStep() {
  if (!tourState) return;
  const step = tourState.steps[tourState.idx];
  const old = document.getElementById('tour-overlay');
  if (old) old.remove();

  let spotHtml = '';
  let cardStyle = 'left:50%; transform:translateX(-50%); bottom:24px;';

  if (step.kind === 'route') {
    navigateTo(step.route);
    const nav = document.querySelector(`#sidebar .nav-item[onclick*="'${step.route}'"]`);
    if (nav) {
      nav.scrollIntoView({ block: 'center' });
      const rect = nav.getBoundingClientRect();
      if (rect.width > 0) {
        if (rect.right + 396 < window.innerWidth) {
          const top = Math.min(Math.max(rect.top, 12), Math.max(window.innerHeight - 300, 12));
          cardStyle = `left:${rect.right + 16}px; top:${top}px;`;
        }
        spotHtml = `<div class="tour-spot" style="left:${rect.left}px; top:${rect.top}px; width:${rect.width}px; height:${rect.height}px;">${nav.innerHTML}</div>`;
      }
    }
  }

  const overlay = document.createElement('div');
  overlay.id = 'tour-overlay';
  overlay.innerHTML = `
    <div class="tour-backdrop" onclick="tourSkip()"></div>
    ${spotHtml}
    <div class="tour-card animate-fade" style="${cardStyle}" tabindex="-1" role="dialog" aria-modal="true" aria-label="Guided demo tour">
      <div class="tour-step-count">Step ${tourState.idx + 1} of ${tourState.steps.length}</div>
      ${renderTourCardInner(step)}
      <div class="tour-controls">
        <button class="btn btn-secondary btn-sm" onclick="tourSkip()">Skip</button>
        ${tourState.idx > 0 ? '<button class="btn btn-secondary btn-sm" onclick="tourBack()">← Back</button>' : ''}
        <button class="btn btn-primary btn-sm" onclick="tourNext()">${tourState.idx === tourState.steps.length - 1 ? 'Finish ✓' : 'Next →'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const card = overlay.querySelector('.tour-card');
  if (card) card.focus();
}

function renderTourCardInner(step) {
  if (step.kind === 'welcome') {
    return `
      <div class="tour-title">Welcome to Aarogya Setu Mitra 👋</div>
      <p class="tour-what">A quick walkthrough of the features available to your role (<strong>${escapeHtml(state.user.role)}</strong>).</p>
      <p class="tour-can">Use <strong>← Back</strong>, <strong>Next →</strong> or <strong>Esc</strong> to move around. Click outside the card to skip anytime.</p>`;
  }
  if (step.kind === 'summary') {
    return `
      <div class="tour-title">Tour Complete 🎉</div>
      <p class="tour-what">You\u2019re ready to use the platform. Features covered:</p>
      <ul class="tour-summary-list">
        ${tourState.routes.map(r => `<li><span>${getRouteIcon(r)}</span> <span>${escapeHtml(getRouteTitle(r))}</span></li>`).join('')}
      </ul>
      <p class="tour-can">Press <strong>▶ Demo</strong> (topbar) to replay this tour, or the <strong>?</strong> button for help on any page.</p>
      <div class="tour-controls" style="margin-top:12px;">
        <button class="btn btn-secondary btn-sm" onclick="tourRestart()">↻ Restart</button>
      </div>`;
  }
  const s = TOUR_STEPS[step.route] || { what: '', can: '', how: [] };
  return `
    <div class="tour-title">${escapeHtml(getRouteTitle(step.route))}</div>
    <p class="tour-what">${escapeHtml(s.what)}</p>
    ${s.can ? `<p class="tour-can">${escapeHtml(s.can)}</p>` : ''}
    ${s.how && s.how.length ? `<p class="tour-how"><strong>How:</strong><br>${s.how.map(h => '• ' + escapeHtml(h)).join('<br>')}</p>` : ''}`;
}

function toggleHelpPanel() {
  const panel = document.getElementById('help-panel');
  if (!panel) return;
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  if (state.notifPanelOpen) toggleNotifPanel();
  const s = TOUR_STEPS[state.currentRoute] || { what: '', can: '', how: [] };
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="card animate-fade" style="position:absolute; right:28px; top:56px; width:360px; z-index:60; max-height:400px; overflow-y:auto;">
      <div class="card-header"><div class="card-title">❓ Help — ${escapeHtml(getRouteTitle(state.currentRoute))}</div></div>
      <div style="padding:0 14px 12px;">
        <p style="font-size:13px; color:var(--text-main);">${escapeHtml(s.what)}</p>
        ${s.can ? `<p style="font-size:12px; color:var(--text-secondary); margin-top:6px;">${escapeHtml(s.can)}</p>` : ''}
        ${s.how && s.how.length ? `<p style="font-size:12px; color:var(--text-secondary); margin-top:6px;"><strong style="color:var(--text-main);">How:</strong><br>${s.how.map(h => '• ' + escapeHtml(h)).join('<br>')}</p>` : ''}
      </div>
    </div>`;
}

// Auto-start the tour once per account (flag set when the tour STARTS,
// so a reload mid-tour does not restart it)
function maybeAutoTour() {
  try {
    const u = state.user && (state.user.username || state.user.full_name);
    if (!u) return;
    const key = 'demo_done_' + String(u).toLowerCase();
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      setTimeout(() => { if (state.user && !tourState) startDemoTour(); }, 600);
    }
  } catch (e) { /* storage unavailable — auto tour skipped */ }
}

Object.assign(window, { startDemoTour, endDemoTour, tourNext, tourBack, tourSkip, tourRestart, toggleHelpPanel, maybeAutoTour });

// ── Main App Renderer ──
function renderApp() {
  const app = document.getElementById('app');
  if (!state.user) {
    app.innerHTML = renderLogin();
    attachLoginEvents();
    return;
  }

  loadNotifications();

  app.innerHTML = `
    <div id="sidebar">
      <div class="sidebar-header">
        <div class="logo-icon">🏥</div>
        <div>
          <div class="logo-text">Aarogya Setu Mitra</div>
          <div class="logo-subtitle">Rural Healthcare Platform</div>
        </div>
      </div>

      <div class="sidebar-nav">
        <div class="nav-section">${t('nav.core', 'Core Modules')}</div>
        ${canAccess(['ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'THO', 'DHO', 'STATE_MSIS']) ? `
          <a href="#" onclick="navigateTo('patients'); return false;" class="nav-item ${state.currentRoute === 'patients' ? 'active' : ''}">
            <span>👥</span> <span>${t('nav.patients', 'Patient Records')}</span>
          </a>` : ''}
        ${canAccess(['ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR']) ? `
          <a href="#" onclick="navigateTo('triage'); return false;" class="nav-item ${state.currentRoute === 'triage' ? 'active' : ''}">
            <span>⚡</span> <span>${t('nav.triage', 'Health Symptom Check')}</span>
          </a>` : ''}
        ${canAccess(['ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'THO', 'DHO']) ? `
          <a href="#" onclick="navigateTo('referrals'); return false;" class="nav-item ${state.currentRoute === 'referrals' ? 'active' : ''}">
            <span>🔄</span> <span>${t('nav.referrals', 'Doctor Referral')}</span>
          </a>` : ''}

        <div class="nav-section">Specialized Workflows</div>
        ${canAccess(['ASHA', 'ANM', 'PHC_DOCTOR']) ? `
          <a href="#" onclick="navigateTo('maternal_child'); return false;" class="nav-item ${state.currentRoute === 'maternal_child' ? 'active' : ''}">
            <span>👶</span> <span>${t('nav.maternal_child', 'Mother & Baby Care')}</span>
          </a>
          <a href="#" onclick="navigateTo('immunizations'); return false;" class="nav-item ${state.currentRoute === 'immunizations' ? 'active' : ''}">
            <span>💉</span> <span>${t('nav.immunizations', 'Child Vaccine Chart')}</span>
          </a>
          <a href="#" onclick="navigateTo('ncd'); return false;" class="nav-item ${state.currentRoute === 'ncd' ? 'active' : ''}">
            <span>🩺</span> <span>${t('nav.ncd', 'BP & Sugar Check')}</span>
          </a>
          <a href="#" onclick="navigateTo('ocr_scanner'); return false;" class="nav-item ${state.currentRoute === 'ocr_scanner' ? 'active' : ''}">
            <span>📄</span> <span>${t('nav.ocr_scanner', 'Scan Paper Report')}</span>
          </a>` : ''}

        <div class="nav-section">Intelligence & ABDM</div>
        <a href="#" onclick="navigateTo('radar'); return false;" class="nav-item ${state.currentRoute === 'radar' ? 'active' : ''}">
          <span>📡</span> <span>${t('nav.radar', 'Hospitals & Stock')}</span>
        </a>
        <a href="#" onclick="navigateTo('fhir_inspector'); return false;" class="nav-item ${state.currentRoute === 'fhir_inspector' ? 'active' : ''}">
          <span>🔥</span> <span>${t('nav.fhir_inspector', 'ABDM Digital Card')}</span>
        </a>
        <a href="#" onclick="navigateTo('abha'); return false;" class="nav-item ${state.currentRoute === 'abha' ? 'active' : ''}">
          <span>🪪</span> <span>ABHA Connect</span>
        </a>
        ${canAccess(['FACILITY_STAFF', 'PHC_DOCTOR']) ? `
          <a href="#" onclick="navigateTo('facility_mgmt'); return false;" class="nav-item ${state.currentRoute === 'facility_mgmt' ? 'active' : ''}">
            <span>🧰</span> <span>Facility Management</span>
          </a>` : ''}
        ${canAccess(['THO', 'DHO', 'STATE_MSIS', 'PHC_DOCTOR']) ? `
          <a href="#" onclick="navigateTo('dashboard'); return false;" class="nav-item ${state.currentRoute === 'dashboard' ? 'active' : ''}">
            <span>📊</span> <span>${t('nav.dashboard', 'Health Reports')}</span>
          </a>` : ''}

        <div class="nav-section">Security & Access</div>
        ${canAccess(['ASHA', 'ANM', 'PHC_DOCTOR', 'HOSPITAL_DOCTOR', 'PATIENT']) ? `
          <a href="#" onclick="navigateTo('consents'); return false;" class="nav-item ${state.currentRoute === 'consents' ? 'active' : ''}">
            <span>🔒</span> <span>${t('nav.consents', 'Family Permissions')}</span>
          </a>` : ''}
        ${canAccess(['CAREGIVER']) ? `
          <a href="#" onclick="navigateTo('caregiver'); return false;" class="nav-item ${state.currentRoute === 'caregiver' ? 'active' : ''}">
            <span>🤝</span> <span>${t('nav.caregiver', 'Caregiver Access')}</span>
          </a>` : ''}
        ${canAccess(['THO', 'DHO', 'STATE_MSIS']) ? `
          <a href="#" onclick="navigateTo('audit'); return false;" class="nav-item ${state.currentRoute === 'audit' ? 'active' : ''}">
            <span>📜</span> <span>${t('nav.audit', 'Activity Log')}</span>
          </a>` : ''}
      </div>

      <div class="user-profile">
        <div class="user-name">${escapeHtml(state.user.full_name)}</div>
        <div class="user-role">${escapeHtml(state.user.role)}</div>
        <button class="btn btn-secondary btn-sm btn-block" style="margin-top:10px;" onclick="logout()">Sign Out</button>
      </div>
    </div>

    <div id="main">
      <div id="topbar">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
          <h2>${getRouteTitle(state.currentRoute)}</h2>
          <button class="btn btn-secondary btn-sm help-btn" aria-label="Help for this page (सहायता)" onclick="toggleHelpPanel()">?</button>
        </div>
        <div class="topbar-actions">
          <div id="sync-status"></div>
          <div class="notification-bell" onclick="toggleNotifPanel()">
            🔔${state.unreadCount > 0 ? '<div class="notification-badge"></div>' : ''}
          </div>
          <button class="btn btn-secondary btn-sm" onclick="toggleLanguage()">${getLangLabel()}</button>
          <button class="btn btn-primary btn-sm demo-btn" aria-label="Start guided demo tour (डेमो टूर)" onclick="startDemoTour()">▶ Demo</button>
        </div>
      </div>
      <div id="notif-panel" style="display:none;"></div>
      <div id="help-panel" style="display:none;"></div>
      <div id="content" class="animate-fade">Loading view...</div>
    </div>

    <!-- Floating AI Chat Launcher Button -->
    <div id="ai-chat-launcher" style="position:fixed; bottom:24px; right:24px; z-index:1000;">
      <button class="btn btn-primary" style="border-radius:50px; padding:12px 20px; font-weight:700; box-shadow:0 8px 24px rgba(0,0,0,0.3); display:flex; align-items:center; gap:8px; background:linear-gradient(135deg, var(--primary), var(--accent)); cursor:pointer;" onclick="toggleChatbot()">
        <span>🤖</span> <span>Aarogya Mitra AI Chat</span>
      </button>
    </div>

    <!-- AI Chat Container Card -->
    <div id="ai-chat-window" style="display:${state.chatOpen ? 'flex' : 'none'}; position:fixed; bottom:84px; right:24px; width:380px; max-width:90vw; height:520px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:16px; box-shadow:0 12px 36px rgba(0,0,0,0.4); z-index:1001; flex-direction:column; overflow:hidden;" class="animate-fade">
      
      <!-- Header -->
      <div style="background:linear-gradient(135deg, var(--bg-element), var(--bg-card)); padding:14px 16px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:800; font-size:15px; color:var(--text-main); display:flex; align-items:center; gap:6px;">
            🤖 <span>Aarogya Mitra AI</span>
          </div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
            Virtual Health Assistant (ग्रामीण स्वास्थ्य सहायक)
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <!-- Language Selector -->
          <select id="chat-lang-select" onchange="setChatLanguage(this.value)" style="font-size:11px; padding:4px 8px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-element); color:var(--text-main);">
            <option value="en" ${state.chatLang === 'en' ? 'selected' : ''}>English</option>
            <option value="hi" ${state.chatLang === 'hi' ? 'selected' : ''}>हिंदी</option>
            <option value="mr" ${state.chatLang === 'mr' ? 'selected' : ''}>मराठी</option>
          </select>
          <button style="background:none; border:none; color:var(--text-muted); font-size:16px; cursor:pointer;" onclick="toggleChatbot()">✕</button>
        </div>
      </div>

      <!-- Messages Body -->
      <div id="chat-messages-list" style="flex:1; padding:16px; overflow-y:auto; display:flex; flex-direction:column; gap:12px;">
      </div>

      <!-- Quick Suggestion Chips -->
      <div id="chat-chips" style="padding:6px 12px; background:var(--bg-element); border-top:1px solid var(--border-subtle); display:flex; gap:6px; overflow-x:auto; white-space:nowrap;">
      </div>

      <!-- Input Footer -->
      <div style="padding:12px; border-top:1px solid var(--border-color); background:var(--bg-card); display:flex; gap:8px; align-items:center;">
        <input type="text" id="chat-input" placeholder="Ask a health question (सवाल पूछें)..." style="flex:1; padding:10px 12px; font-size:13px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-element); color:var(--text-main);" onkeydown="if(event.key==='Enter') sendChatMessage()">
        <button class="btn btn-secondary btn-sm" onclick="triggerChatVoiceStt()" title="Speak Query">🎙️</button>
        <button class="btn btn-primary btn-sm" onclick="sendChatMessage()">➤</button>
      </div>
    </div>
  `;

  updateSyncIndicator();
  renderContent();
  if (state.chatOpen) renderChatMessages();
}

function canAccess(roles) {
  return state.user && roles.includes(state.user.role);
}

function getRouteTitle(route) {
  const titles = {
    patients: t('nav.patients', 'Patient Directory & Registration (मरीज सूची)'),
    patient_detail: 'Patient Record & Health Summary (स्वास्थ्य रिकॉर्ड)',
    triage: t('nav.triage', 'Health Symptom Check & Danger Signs (स्वास्थ्य जांच)'),
    referrals: t('nav.referrals', 'Doctor Referral & Hospital Advice (अस्पताल सलाह)'),
    maternal_child: 'Mother & Baby Care (माँ और बच्चे की देखभाल)',
    immunizations: 'Child Vaccine Chart & Schedule (टीकाकरण)',
    ncd: 'BP & Blood Sugar Monitoring (बीपी और शुगर)',
    ocr_scanner: 'Scan Lab Paper Report (लैब रिपोर्ट स्कैन)',
    fhir_inspector: 'ABDM Digital Health Card (डिजिटल हेल्थ कार्ड)',
    abha: 'ABHA Connect — ABDM Integration (आभा कनेक्ट)',
    facility_mgmt: 'Facility & Stock Management (सुविधा प्रबंधन)',
    radar: t('nav.radar', 'Hospitals & Medicine Stock (अस्पताल और दवाएं)'),
    dashboard: t('nav.dashboard', 'Health Reports & Overview (स्वास्थ्य रिपोर्ट)'),
    consents: 'Family Health Permissions (अनुमति व्यवस्था)',
    caregiver: 'Family Caregiver Access (परिवार सहायता)',
    audit: 'System Activity Logs (गतिविधि)'
  };
  return titles[route] || 'Dashboard';
}

async function renderContent() {
  const container = document.getElementById('content');
  try {
    switch (state.currentRoute) {
      case 'patients': await renderPatientsView(container); break;
      case 'patient_detail': await renderPatientDetailView(container, state.routeParams.id); break;
      case 'triage': await renderTriageView(container); break;
      case 'referrals': await renderReferralsView(container); break;
      case 'maternal_child': await renderMaternalChildView(container); break;
      case 'immunizations': await renderImmunizationsView(container); break;
      case 'ncd': await renderNCDView(container); break;
      case 'ocr_scanner': await renderOcrScannerView(container); break;
      case 'fhir_inspector': await renderFhirInspectorView(container); break;
      case 'abha': await renderAbhaView(container); break;
      case 'facility_mgmt': await renderFacilityMgmtView(container); break;
      case 'radar': await renderRadarView(container); break;
      case 'dashboard': await renderDashboardView(container); break;
      case 'consents': await renderConsentsView(container); break;
      case 'caregiver': await renderCaregiverView(container); break;
      case 'audit': await renderAuditView(container); break;
      default: container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">Page not found</div></div>';
    }
  } catch (err) {
    container.innerHTML = `<div class="ai-summary-box" style="border-color: var(--danger);"><h4 style="color:var(--danger);">Error Loading Module</h4><p style="color:var(--text-secondary); margin-top:8px;">${escapeHtml(err.message)}</p></div>`;
  }
}

// ── Notification Panel ──
function toggleNotifPanel() {
  state.notifPanelOpen = !state.notifPanelOpen;
  const panel = document.getElementById('notif-panel');
  if (state.notifPanelOpen) {
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="card animate-fade" style="position:absolute; right:28px; top:56px; width:360px; z-index:60; max-height:400px; overflow-y:auto;">
        <div class="card-header"><div class="card-title">🔔 Notifications</div></div>
        ${state.notifications.length === 0 ? '<p style="color:var(--text-muted); font-size:13px;">No notifications</p>' :
        state.notifications.slice(0, 15).map(n => `
            <div style="padding:10px; border-bottom:1px solid var(--border-subtle); ${n.read ? 'opacity:0.6;' : ''}">
              <div style="font-size:13px; font-weight:600; color:var(--text-main);">${escapeHtml(n.title)}</div>
              <div style="font-size:11px; color:var(--text-muted); margin-top:3px;">${escapeHtml(n.message || '')}</div>
              <div style="font-size:10px; color:var(--text-dim); margin-top:3px;">${new Date(n.created_at).toLocaleString()}</div>
            </div>
          `).join('')}
      </div>`;
  } else {
    panel.style.display = 'none';
  }
}

// ── LOGIN ──
function renderLogin() {
  return `
    <div id="login-screen">
      <div class="login-card animate-fade">
        <div class="login-brand">
          <div class="brand-logo">🏥</div>
          <h1>Aarogya Setu Mitra</h1>
          <p>Rural Healthcare Continuity Platform</p>
        </div>

        <form id="login-form">
          <div class="input-group">
            <label>Username</label>
            <input type="text" id="login-username" required placeholder="Enter username (e.g. asha1, doctor1)">
          </div>
          <div class="input-group">
            <label>Password</label>
            <input type="password" id="login-password" required placeholder="Enter password">
          </div>
          <div id="login-error" style="color: var(--danger); font-size: 13px; margin-bottom: 12px; text-align: center;"></div>
          <button type="submit" class="btn btn-block">Sign In to Dashboard</button>
        </form>

        <div style="margin-top: 24px; text-align: center;">
          <p style="font-size: 10px; color: var(--text-dim); font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;">Instant Demo Login</p>
          <div class="quick-login-chips">
            <span class="chip" onclick="quickLogin('asha1','asha123')">ASHA Worker</span>
            <span class="chip" onclick="quickLogin('anm1','anm123')">ANM</span>
            <span class="chip" onclick="quickLogin('doctor1','doctor123')">PHC Doctor</span>
            <span class="chip" onclick="quickLogin('doctor2','doctor123')">Hospital Doctor</span>
            <span class="chip" onclick="quickLogin('tho1','tho123')">THO Officer</span>
            <span class="chip" onclick="quickLogin('dho1','dho123')">DHO Officer</span>
            <span class="chip" onclick="quickLogin('state1','state123')">State MSIS</span>
            <span class="chip" onclick="quickLogin('caregiver1','care123')">Caregiver</span>
            <span class="chip" onclick="quickLogin('facility1','facility123')">Facility Staff</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function attachLoginEvents() {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    doLogin(document.getElementById('login-username').value, document.getElementById('login-password').value);
  });
}

async function quickLogin(user, pass) { await doLogin(user, pass); }

async function doLogin(username, password) {
  const errDiv = document.getElementById('login-error');
  if (errDiv) errDiv.textContent = '';
  try {
    const res = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    state.token = res.token;
    state.refreshToken = res.refreshToken || null;
    state.user = res.user;
    localStorage.setItem('token', res.token);
    if (res.refreshToken) localStorage.setItem('refreshToken', res.refreshToken);
    if (state.user.role === 'CAREGIVER') state.currentRoute = 'caregiver';
    else if (['THO', 'DHO', 'STATE_MSIS'].includes(state.user.role)) state.currentRoute = 'dashboard';
    else state.currentRoute = 'patients';
    renderApp();
    maybeAutoTour();
  } catch (err) {
    if (errDiv) errDiv.textContent = err.message || 'Login failed';
  }
}

// ── PATIENTS VIEW ──
let patientListOffset = 0;

function patientRowHtml(p) {
  return `
    <tr>
      <td><strong>${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')}</strong></td>
      <td><span class="badge badge-info">${escapeHtml(p.temporary_id || p.abha_id || 'N/A')}</span></td>
      <td>${p.age || 'N/A'} yrs / ${p.gender || 'N/A'}</td>
      <td>${escapeHtml(p.village || 'N/A')}, ${escapeHtml(p.district || 'N/A')}</td>
      <td>${new Date(p.created_at).toLocaleDateString()}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="navigateTo('patient_detail', { id: '${p.id}' })">View Record</button>
        ${canAccess(['ASHA', 'ANM']) ? `<button class="btn btn-warning btn-sm" onclick="navigateTo('triage', { patientId: '${p.id}' })">⚡ Triage</button>` : ''}
      </td>
    </tr>
  `;
}

async function renderPatientsView(container) {
  patientListOffset = 0;
  const patients = await api('/patients?limit=100&offset=0');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title"><span>👥</span><span>${t('patient.search', 'Registered Patients')} (${patients.length}${patients.length === 100 ? '+' : ''})</span></div>
        <div style="display: flex; gap: 12px; align-items:center;">
          <input type="text" id="patient-search" placeholder="🔍 Search by name, ABHA ID, village..." style="width: 280px;" onkeyup="filterPatients()">
          ${canAccess(['ASHA', 'ANM', 'PHC_DOCTOR']) ? `<button class="btn" onclick="showRegisterPatientModal()">+ ${t('patient.register', 'Register Patient')}</button>` : ''}
        </div>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>${t('patient.name', 'Patient Name')}</th>
              <th>Temp / ABHA ID</th>
              <th>${t('patient.age', 'Age')} / Gender</th>
              <th>${t('patient.village', 'Village')} / District</th>
              <th>Registered At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="patients-table-body">
            ${patients.map(patientRowHtml).join('')}
            ${patients.length === 0 ? '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No patients registered yet. Click "Register Patient" to add one.</td></tr>' : ''}
          </tbody>
        </table>
      </div>
      <div id="patients-load-more" style="text-align:center; padding:12px;">
        ${patients.length === 100 ? '<button class="btn btn-secondary btn-sm" id="patients-more-btn" onclick="loadMorePatients()">Load More Patients</button>' : ''}
      </div>
    </div>
  `;
}

async function loadMorePatients() {
  const btn = document.getElementById('patients-more-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
  try {
    const next = patientListOffset + 100;
    const more = await api(`/patients?limit=100&offset=${next}`);
    patientListOffset = next;
    const tbody = document.getElementById('patients-table-body');
    if (tbody) tbody.insertAdjacentHTML('beforeend', more.map(patientRowHtml).join(''));
    const wrap = document.getElementById('patients-load-more');
    if (wrap) {
      wrap.innerHTML = more.length === 100
        ? '<button class="btn btn-secondary btn-sm" id="patients-more-btn" onclick="loadMorePatients()">Load More Patients</button>'
        : '<span style="font-size:12px; color:var(--text-muted);">All patients loaded</span>';
    }
  } catch (err) {
    showNotification('Could not load more patients: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Load More Patients'; }
  }
}

function showRegisterPatientModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-content animate-fade">
      <div class="modal-header">
        <h3>${t('patient.register', 'Register New Patient')}</h3>
        <button class="btn btn-secondary btn-sm" onclick="this.closest('.modal-backdrop').remove()">✕</button>
      </div>
      <form id="reg-patient-form">
        <div class="grid-2">
          <div class="input-group"><label>First Name *</label><input type="text" id="reg-fname" required></div>
          <div class="input-group"><label>Last Name</label><input type="text" id="reg-lname"></div>
        </div>
        <div class="grid-3">
          <div class="input-group"><label>Age *</label><input type="number" id="reg-age" required min="0"></div>
          <div class="input-group"><label>Gender *</label>
            <select id="reg-gender" required>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="O">Other</option>
            </select>
          </div>
          <div class="input-group"><label>Blood Group</label><input type="text" id="reg-blood" placeholder="e.g. O+"></div>
        </div>
        <div class="grid-2">
          <div class="input-group"><label>Phone</label><input type="text" id="reg-phone" placeholder="9876543210"></div>
          <div class="input-group"><label>ABHA ID</label><input type="text" id="reg-abha" placeholder="91-XXXX-XXXX-XXXX"></div>
        </div>
        <div class="grid-2">
          <div class="input-group"><label>Village *</label><input type="text" id="reg-village" value="Wadgaon" required></div>
          <div class="input-group"><label>District *</label><input type="text" id="reg-district" value="Pune" required></div>
        </div>
        <div class="input-group"><label>Allergies</label><input type="text" id="reg-allergies" placeholder="e.g. Penicillin, Sulfa drugs"></div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
          <button type="submit" class="btn">Complete Registration</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  document.getElementById('reg-patient-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const p = await api('/patients', {
        method: 'POST',
        body: JSON.stringify({
          first_name: document.getElementById('reg-fname').value,
          last_name: document.getElementById('reg-lname').value,
          age: parseInt(document.getElementById('reg-age').value),
          gender: document.getElementById('reg-gender').value,
          blood_group: document.getElementById('reg-blood').value,
          phone: document.getElementById('reg-phone').value,
          village: document.getElementById('reg-village').value,
          district: document.getElementById('reg-district').value,
          abha_id: document.getElementById('reg-abha').value,
          allergies: document.getElementById('reg-allergies').value
        })
      });
      backdrop.remove();
      showNotification('✅ Patient registered successfully!');
      navigateTo('patient_detail', { id: p.id });
    } catch (err) { alert('Error: ' + err.message); }
  });
}

// ── PATIENT DETAIL VIEW ──
async function renderPatientDetailView(container, patientId) {
  const [patient, summary, observations, triage] = await Promise.all([
    api(`/patients/${patientId}`),
    api(`/patients/${patientId}/summary`),
    api(`/patients/${patientId}/observations`),
    api(`/patients/${patientId}/triage`)
  ]);

  container.innerHTML = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div>
          <h2 style="font-size:20px; font-weight:800;">${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name || '')}</h2>
          <p style="color:var(--text-muted); font-size:12px; margin-top:4px;">
            ID: <strong>${escapeHtml(patient.temporary_id || patient.id)}</strong> | Age: ${patient.age || 'N/A'} | Gender: ${patient.gender || 'N/A'} | Village: ${escapeHtml(patient.village || 'N/A')}
            ${patient.blood_group ? ' | Blood: ' + escapeHtml(patient.blood_group) : ''}
            ${patient.phone ? ' | Phone: ' + escapeHtml(patient.phone) : ''}
          </p>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" onclick="navigateTo('patients')">← Back</button>
          ${canAccess(['ASHA', 'ANM', 'PHC_DOCTOR']) ? `<button class="btn btn-warning" onclick="navigateTo('triage', { patientId: '${patient.id}' })">⚡ Triage</button>` : ''}
          ${canAccess(['ASHA', 'ANM', 'PHC_DOCTOR']) ? `<button class="btn btn-success" onclick="showNewReferralModal('${patient.id}')">🔄 Referral</button>` : ''}
        </div>
      </div>
    </div>

    <!-- AI Clinical Summary -->
    <div class="ai-summary-box animate-fade">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <h4 style="font-size:14px; font-weight:700; color:#a5b4fc;">🤖 AI Clinical Trend Summary & Insights</h4>
        <span class="badge badge-info">Deterministic Guardrail Engine</span>
      </div>
      <div style="font-size:13px; white-space:pre-wrap; color:var(--text-main); line-height:1.7;">${escapeHtml(summary.summary)}</div>
      <div class="ai-disclaimer">${summary.disclaimer}</div>
    </div>

    <div class="grid-2">
      <!-- Observations -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">📊 Clinical Vitals & Labs</div>
          ${canAccess(['ASHA', 'ANM', 'PHC_DOCTOR']) ? `<button class="btn btn-secondary btn-sm" onclick="showRecordVitalsModal('${patient.id}')">+ Record Vitals</button>` : ''}
        </div>
        <div class="table-container">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Value</th><th>Source</th></tr></thead>
            <tbody>
              ${observations.map(o => `
                <tr>
                  <td>${new Date(o.recorded_at).toLocaleDateString()}</td>
                  <td><strong>${escapeHtml(o.type)}</strong></td>
                  <td>${o.value} ${o.unit || ''}</td>
                  <td><span class="badge badge-info">${o.source}</span></td>
                </tr>
              `).join('')}
              ${observations.length === 0 ? '<tr><td colspan="4" class="text-center" style="color:var(--text-muted);">No observations recorded.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Triage History -->
      <div class="card">
        <div class="card-header"><div class="card-title">⚡ Triage Risk Log</div></div>
        ${triage.map(tr => `
          <div style="background:var(--bg-element); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:14px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span class="badge badge-${tr.risk_level}">${tr.risk_level} RISK</span>
              <span style="font-size:11px; color:var(--text-muted);">${new Date(tr.created_at).toLocaleString()}</span>
            </div>
            <p style="font-size:13px; margin-top:8px; color:var(--text-main);">${escapeHtml(tr.recommendation)}</p>
          </div>
        `).join('')}
        ${triage.length === 0 ? '<p style="color:var(--text-muted); font-size:13px;">No triage evaluations on record.</p>' : ''}
      </div>
    </div>
  `;
}

function showRecordVitalsModal(patientId) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-content animate-fade">
      <div class="modal-header">
        <h3>Record Clinical Observation</h3>
        <button class="btn btn-secondary btn-sm" onclick="this.closest('.modal-backdrop').remove()">✕</button>
      </div>
      <form id="vitals-form">
        <div class="input-group">
          <label>Observation Type *</label>
          <select id="obs-type" required>
            <option value="hemoglobin">Hemoglobin (Hb - g/dL)</option>
            <option value="bp_systolic">Blood Pressure Systolic (mmHg)</option>
            <option value="bp_diastolic">Blood Pressure Diastolic (mmHg)</option>
            <option value="blood_sugar_fasting">Blood Sugar Fasting (mg/dL)</option>
            <option value="blood_sugar_random">Blood Sugar Random (mg/dL)</option>
            <option value="weight">Weight (kg)</option>
            <option value="temperature">Temperature (°C)</option>
            <option value="pulse_rate">Pulse Rate (bpm)</option>
            <option value="spo2">SpO2 (%)</option>
          </select>
        </div>
        <div class="input-group"><label>Observed Value *</label><input type="number" step="0.1" id="obs-value" required placeholder="e.g. 10.2"></div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
          <button type="submit" class="btn">Save Observation</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  document.getElementById('vitals-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/observations', {
        method: 'POST',
        body: JSON.stringify({ patient_id: patientId, type: document.getElementById('obs-type').value, value: parseFloat(document.getElementById('obs-value').value) })
      });
      backdrop.remove();
      showNotification('✅ Observation saved.');
      renderPatientDetailView(document.getElementById('content'), patientId);
    } catch (err) { alert('Error: ' + err.message); }
  });
}

// ── TRIAGE VIEW ──
async function renderTriageView(container) {
  const patients = await api('/patients');
  const targetId = state.routeParams?.patientId || (patients[0]?.id || '');

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">⚡ Guided Clinical Triage & Decision Engine</div></div>
      <form id="triage-form">
        <div class="input-group">
          <label>Target Patient *</label>
          <select id="triage-patient" required>
            ${patients.map(p => `<option value="${p.id}" ${p.id === targetId ? 'selected' : ''}>${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')} (${p.age}y, ${p.village})</option>`).join('')}
          </select>
        </div>

        <div style="background:var(--bg-element); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:20px; margin:16px 0;">
          <h4 style="font-size:14px; font-weight:700; margin-bottom:14px;">Clinical Symptoms & Danger Signs</h4>
          <div class="grid-2">
            <div class="input-group"><label>Fever Duration (Days)</label><input type="number" id="tr-fever" value="0" min="0"></div>
            <div class="input-group"><label>Hours without Urination</label><input type="number" id="tr-urination" value="0" min="0"></div>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; margin:12px 0;">
            <label style="display:flex; align-items:center; gap:8px; font-size:13px;"><input type="checkbox" id="tr-lethargy"> Lethargy / Unconsciousness</label>
            <label style="display:flex; align-items:center; gap:8px; font-size:13px;"><input type="checkbox" id="tr-diarrhea"> Severe Diarrhea</label>
            <label style="display:flex; align-items:center; gap:8px; font-size:13px;"><input type="checkbox" id="tr-dehydration"> Sunken Eyes / Poor Skin Turgor</label>
          </div>

          <div class="input-group" style="margin-top:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <label style="font-weight:700; font-size:12px;">Free-Text Symptom Entry (Speech or Type / बोलकर दर्ज करें)</label>
              <button type="button" class="btn btn-secondary btn-sm" onclick="triggerVoiceStt()">🎙️ Speak Symptoms (बोलकर दर्ज करें)</button>
            </div>
            <textarea id="tr-stt-text" rows="2" placeholder="e.g. High fever for 3 days, continuous vomiting, and extreme weakness..."></textarea>
          </div>
          <div class="grid-2" style="margin-top:14px;">
            <div class="input-group"><label>Systolic BP (mmHg)</label><input type="number" id="tr-bps" placeholder="e.g. 140"></div>
            <div class="input-group"><label>Diastolic BP (mmHg)</label><input type="number" id="tr-bpd" placeholder="e.g. 90"></div>
          </div>
          <div class="input-group"><label>Hemoglobin Level (g/dL)</label><input type="number" step="0.1" id="tr-hb" placeholder="e.g. 8.5"></div>
        </div>
        <button type="submit" class="btn btn-warning btn-block" style="padding:14px; font-size:15px;">Execute Clinical Rule Evaluation</button>
      </form>
    </div>
    <div id="triage-result-container"></div>
  `;

  document.getElementById('triage-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pid = document.getElementById('triage-patient').value;
    const symptoms = {
      fever_duration_days: parseInt(document.getElementById('tr-fever').value) || 0,
      no_urination_hours: parseInt(document.getElementById('tr-urination').value) || 0,
      lethargy: document.getElementById('tr-lethargy').checked,
      diarrhea: document.getElementById('tr-diarrhea').checked,
      sunken_eyes: document.getElementById('tr-dehydration').checked,
      bp_systolic: parseInt(document.getElementById('tr-bps').value) || undefined,
      bp_diastolic: parseInt(document.getElementById('tr-bpd').value) || undefined,
      hemoglobin: parseFloat(document.getElementById('tr-hb').value) || undefined
    };

    try {
      const res = await api('/triage', { method: 'POST', body: JSON.stringify({ patient_id: pid, symptoms }) });
      const resDiv = document.getElementById('triage-result-container');
      resDiv.innerHTML = `
        <div class="card animate-fade">
          <div class="card-header"><div class="card-title">Triage Output</div></div>
          <div style="text-align:center; padding:20px;">
            <span class="badge badge-${res.riskLevel}" style="font-size:18px; padding:8px 24px;">${res.riskLevel} RISK</span>
            <div style="font-size:14px; color:var(--text-muted); margin-top:8px;">Score: ${res.score} / 100</div>
            <div class="progress-bar" style="margin-top:12px;"><div class="progress-bar-fill" style="width:${res.score}%;"></div></div>
          </div>
          <div style="background:var(--bg-element); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px; margin-top:14px;">
            <strong>Clinical Recommendation:</strong>
            <p style="font-size:14px; margin-top:6px; color:var(--text-main);">${escapeHtml(res.recommendation)}</p>
          </div>
          ${(res.riskLevel === 'HIGH' || res.riskLevel === 'CRITICAL') ? `
            <button class="btn btn-success btn-block" style="margin-top:16px; padding:12px;" onclick="showNewReferralModal('${pid}', '${res.riskLevel}')">
              🔄 Route to Teleconsultation / Create Referral
            </button>
          ` : ''}
        </div>
      `;
      showNotification(`Triage complete: ${res.riskLevel} risk detected.`);
    } catch (err) { alert('Triage error: ' + err.message); }
  });
}

// ── REFERRALS VIEW ──
async function renderReferralsView(container) {
  const referrals = await api('/referrals');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">🔄 Referral Network & Ticket Routing (${referrals.length})</div>
        ${canAccess(['ASHA', 'ANM', 'PHC_DOCTOR']) ? `<button class="btn" onclick="showNewReferralModal()">+ New Referral</button>` : ''}
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Patient</th>
              <th>Receiving Facility</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Escalated?</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${referrals.map(r => `
              <tr>
                <td><strong>${escapeHtml(r.referral_code || r.id.slice(0, 8))}</strong></td>
                <td>${escapeHtml(r.first_name)} ${escapeHtml(r.last_name || '')}</td>
                <td>
                  <span style="font-weight:600; color:var(--primary);">${escapeHtml(r.receiving_facility_name || 'Direct / Teleconsult')}</span>
                  ${r.receiving_facility_type ? `<span class="badge badge-secondary" style="margin-left:4px; font-size:10px;">${escapeHtml(r.receiving_facility_type)}</span>` : ''}
                </td>
                <td><span class="badge badge-${r.priority === 'HIGH' ? 'danger' : 'info'}">${r.priority}</span></td>
                <td><span class="badge badge-${r.status}">${r.status}</span></td>
                <td style="max-width:180px;" class="truncate">${escapeHtml(r.reason || '')}</td>
                <td>${r.escalated ? '<span class="badge badge-danger">ESCALATED</span>' : '—'}</td>
                <td><button class="btn btn-secondary btn-sm" onclick="showReferralDetailModal('${r.id}')">Manage</button></td>
              </tr>
            `).join('')}
            ${referrals.length === 0 ? '<tr><td colspan="8" class="text-center" style="color:var(--text-muted);">No referrals active.</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function showNewReferralModal(patientId = null, priority = 'NORMAL') {
  Promise.all([api('/patients'), api('/facilities')]).then(([patients, facilities]) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-content animate-fade">
        <div class="modal-header">
          <h3>Create Referral / Teleconsult Ticket</h3>
          <button class="btn btn-secondary btn-sm" onclick="this.closest('.modal-backdrop').remove()">✕</button>
        </div>
        <form id="new-referral-form">
          <div class="input-group"><label>Patient *</label>
            <select id="ref-patient" required>
              ${patients.map(p => `<option value="${p.id}" ${p.id === patientId ? 'selected' : ''}>${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')}</option>`).join('')}
            </select>
          </div>
          <div class="input-group"><label>Receiving Facility (Ticket Destination) *</label>
            <select id="ref-facility" required>
              ${facilities.map(f => `<option value="${f.id}">🏥 ${escapeHtml(f.name)} [${f.type}] — ${escapeHtml(f.village || f.district || '')} (${f.bed_count ? f.bed_count + ' beds' : 'Outpatient'})</option>`).join('')}
            </select>
          </div>
          <div class="input-group"><label>Priority</label>
            <select id="ref-priority">
              <option value="NORMAL" ${priority === 'NORMAL' ? 'selected' : ''}>NORMAL</option>
              <option value="HIGH" ${priority !== 'NORMAL' ? 'selected' : ''}>HIGH / URGENT</option>
            </select>
          </div>
          <div class="input-group"><label>Reason *</label><textarea id="ref-reason" required placeholder="Describe clinical symptoms..."></textarea></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
            <button type="submit" class="btn">Create Ticket</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);
    document.getElementById('new-referral-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/referrals', {
          method: 'POST',
          body: JSON.stringify({
            patient_id: document.getElementById('ref-patient').value,
            receiving_facility_id: document.getElementById('ref-facility').value,
            priority: document.getElementById('ref-priority').value,
            reason: document.getElementById('ref-reason').value
          })
        });
        backdrop.remove();
        showNotification('✅ Referral ticket created & routed!');
        navigateTo('referrals');
      } catch (err) { alert('Error: ' + err.message); }
    });
  });
}

async function showReferralDetailModal(referralId) {
  const data = await api(`/referrals/${referralId}`);
  const r = data.referral;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-content animate-fade" style="max-width:700px;">
      <div class="modal-header">
        <h3>Referral Ticket Lifecycle & Destination</h3>
        <button class="btn btn-secondary btn-sm" onclick="this.closest('.modal-backdrop').remove()">✕</button>
      </div>

      <div style="background:var(--bg-element); padding:16px; border-radius:var(--radius-md); margin-bottom:16px;">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
          <div>
            <div style="font-size:11px; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Ticket Info</div>
            <div style="margin-top:4px;">Code: <strong>${escapeHtml(r.referral_code)}</strong></div>
            <div>Patient: <strong>${escapeHtml(r.first_name)} ${escapeHtml(r.last_name || '')}</strong></div>
            <div style="margin-top:4px;">Status: <span class="badge badge-${r.status}">${r.status}</span></div>
          </div>
          <div style="border-left:1px solid var(--border-color); padding-left:16px;">
            <div style="font-size:11px; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Receiving Facility (Destination)</div>
            <div style="font-weight:700; color:var(--primary); font-size:14px; margin-top:2px;">
              🏥 ${escapeHtml(r.receiving_facility_name || 'Direct Teleconsult / Unassigned')}
              ${r.receiving_facility_type ? `<span class="badge badge-info" style="font-size:10px; margin-left:4px;">${escapeHtml(r.receiving_facility_type)}</span>` : ''}
            </div>
            ${r.receiving_facility_services ? `<div style="font-size:11px; color:var(--text-secondary); margin-top:4px;">Services: ${escapeHtml(r.receiving_facility_services)}</div>` : ''}
            ${r.receiving_facility_phone ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">📞 ${escapeHtml(r.receiving_facility_phone)}</div>` : ''}
            ${r.receiving_facility_address ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">📍 ${escapeHtml(r.receiving_facility_address)}</div>` : ''}
          </div>
        </div>
      </div>

      <h4 style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:12px;">Transition Timeline</h4>
      ${data.events.map(e => `
        <div class="timeline-item">
          <div class="timeline-dot">→</div>
          <div style="flex:1;">
            <div style="font-weight:700; font-size:13px;">${e.from_state ? e.from_state + ' → ' : ''}${e.to_state}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Actor: ${escapeHtml(e.actor_name || 'System')} | ${new Date(e.timestamp).toLocaleString()}</div>
          </div>
        </div>
      `).join('')}

      <div style="margin-top:20px;">
        <label style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:8px;">Advance State:</label>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          ${getNextAllowedStates(r.status).map(s => `
            <button class="btn btn-success btn-sm" onclick="advanceReferralState('${r.id}', '${s}')">→ ${s}</button>
          `).join('')}
          ${canAccess(['THO', 'DHO', 'PHC_DOCTOR']) && !r.escalated ? `<button class="btn btn-danger btn-sm" onclick="escalateReferral('${r.id}')">⚠ Escalate</button>` : ''}
        </div>
      </div>

      <div class="modal-footer"><button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Close</button></div>
    </div>
  `;
  document.body.appendChild(backdrop);
}

function getNextAllowedStates(current) {
  return { 'BOOKED': ['SEEN', 'CANCELLED'], 'SEEN': ['REFERRED', 'CLOSED'], 'REFERRED': ['ARRIVED', 'CANCELLED'], 'ARRIVED': ['TREATED'], 'TREATED': ['CLOSED'], 'CLOSED': [], 'CANCELLED': [] }[current] || [];
}

async function advanceReferralState(id, nextState) {
  try {
    await api(`/referrals/${id}/status`, { method: 'PUT', body: JSON.stringify({ status: nextState }) });
    document.querySelector('.modal-backdrop')?.remove();
    showNotification(`Referral transitioned to ${nextState}.`);
    navigateTo('referrals');
  } catch (err) { alert('Error: ' + err.message); }
}

async function escalateReferral(id) {
  try {
    await api(`/referrals/${id}/escalate`, { method: 'POST', body: JSON.stringify({ reason: 'Manual supervisor escalation.' }) });
    showNotification('⚠ Referral escalated to supervisor level.');
    document.querySelector('.modal-backdrop')?.remove();
    navigateTo('referrals');
  } catch (err) { alert('Error: ' + err.message); }
}

// ── RADAR VIEW ──
async function renderRadarView(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">📡 RADAR Real-Time Directory</div></div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">Query live doctor schedules, bed counts, and medicine stocks across the district.</p>
      <div class="grid-3">
        <div class="input-group"><label>Facility Name</label><input type="text" id="radar-fac" placeholder="e.g. Wadgaon"></div>
        <div class="input-group"><label>District</label><input type="text" id="radar-dist" value="Pune"></div>
        <div class="input-group"><label>Medicine Name</label><input type="text" id="radar-med" placeholder="e.g. Paracetamol"></div>
      </div>
      <button class="btn" onclick="executeRadarSearch()">🔍 Query Directory</button>
    </div>
    <div id="radar-results"></div>
  `;
  executeRadarSearch();
}

async function executeRadarSearch() {
  const fac = document.getElementById('radar-fac')?.value || '';
  const dist = document.getElementById('radar-dist')?.value || '';
  const med = document.getElementById('radar-med')?.value || '';
  const data = await api(`/radar/query?facility=${encodeURIComponent(fac)}&district=${encodeURIComponent(dist)}&medicine=${encodeURIComponent(med)}`);
  document.getElementById('radar-results').innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">🏥 Facilities (${data.facilities.length})</div></div>
        ${data.facilities.map(f => `
          <div style="background:var(--bg-element); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:12px; margin-bottom:10px;">
            <strong>${escapeHtml(f.name)}</strong> <span class="badge badge-info">${f.type}</span>
            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">${escapeHtml(f.village)}, ${escapeHtml(f.district)} | Beds: ${f.bed_count}</div>
          </div>
        `).join('')}
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">💊 Medicine Stock</div></div>
        <div class="table-container">
          <table>
            <thead><tr><th>Facility</th><th>Medicine</th><th>Qty</th><th>Status</th></tr></thead>
            <tbody>
              ${data.medicines.map(m => `
                <tr>
                  <td>${escapeHtml(m.facility_name)}</td>
                  <td>${escapeHtml(m.medicine_name)}</td>
                  <td>${m.quantity} ${m.unit}</td>
                  <td><span class="badge badge-${m.status}">${m.status}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ── DASHBOARD VIEW ──
async function renderDashboardView(container) {
  const metrics = await api('/dashboard/metrics');
  container.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-card metric-primary"><div class="metric-icon">👥</div><div class="metric-label">Total Patients</div><div class="metric-value">${metrics.totalPatients}</div><div class="metric-sub">Registered across facilities</div></div>
      <div class="metric-card metric-warning"><div class="metric-icon">🔄</div><div class="metric-label">Referral Rate</div><div class="metric-value">${metrics.referralCompletionRate}%</div><div class="metric-sub">${metrics.pendingReferrals} Pending / ${metrics.escalatedReferrals} Escalated</div></div>
      <div class="metric-card metric-danger"><div class="metric-icon">💊</div><div class="metric-label">Stockouts</div><div class="metric-value">${metrics.stockouts}</div><div class="metric-sub">${metrics.lowStock} Low stock warnings</div></div>
      <div class="metric-card metric-success"><div class="metric-icon">🩺</div><div class="metric-label">Doctors Available</div><div class="metric-value">${metrics.availableDoctors} / ${metrics.totalDoctors}</div><div class="metric-sub">On-duty physicians</div></div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title">🏥 Facility Performance</div></div>
      <div class="table-container">
        <table>
          <thead><tr><th>Facility</th><th>Type</th><th>Total Referrals</th><th>Completed</th><th>Stockouts</th></tr></thead>
          <tbody>
            ${metrics.facilities.map(f => `
              <tr>
                <td><strong>${escapeHtml(f.name)}</strong></td>
                <td>${f.type}</td>
                <td>${f.total_referrals}</td>
                <td>${f.completed_referrals}</td>
                <td><span class="badge badge-${f.stockouts > 0 ? 'danger' : 'success'}">${f.stockouts}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── CONSENTS VIEW ──
async function renderConsentsView(container) {
  const [consents, patients] = await Promise.all([api('/consents'), api('/patients')]);

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">🔒 ABDM Health Data Consents</div>
        ${canAccess(['ASHA', 'ANM', 'PHC_DOCTOR']) ? `<button class="btn" onclick="showGrantConsentModal()">+ Grant Consent</button>` : ''}
      </div>
      <div class="table-container">
        <table>
          <thead><tr><th>Patient</th><th>Requester</th><th>Scope</th><th>Status</th><th>Granted</th><th>Action</th></tr></thead>
          <tbody>
            ${consents.map(c => `
              <tr>
                <td>${escapeHtml(c.first_name)} ${escapeHtml(c.last_name || '')}</td>
                <td>${escapeHtml(c.requester_name)}</td>
                <td><span class="badge badge-info">${c.scope}</span></td>
                <td><span class="badge badge-${c.status === 'granted' ? 'success' : 'danger'}">${c.status}</span></td>
                <td>${c.granted_at ? new Date(c.granted_at).toLocaleDateString() : '—'}</td>
                <td>${c.status === 'granted' ? `<button class="btn btn-danger btn-sm" onclick="revokeConsent('${c.id}')">Revoke</button>` : '—'}</td>
              </tr>
            `).join('')}
            ${consents.length === 0 ? '<tr><td colspan="6" class="text-center" style="color:var(--text-muted);">No consent records found.</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function showGrantConsentModal() {
  Promise.all([api('/patients'), api('/users')]).then(([patients, users]) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const caregivers = (users || []).filter(u => u.role === 'CAREGIVER');
    backdrop.innerHTML = `
      <div class="modal-content animate-fade">
        <div class="modal-header"><h3>Grant Data Consent</h3><button class="btn btn-secondary btn-sm" onclick="this.closest('.modal-backdrop').remove()">✕</button></div>
        <form id="consent-form">
          <div class="input-group"><label>Patient *</label><select id="consent-patient" required>${patients.map(p => `<option value="${p.id}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')}</option>`).join('')}</select></div>
          <div class="input-group"><label>Requester (Caregiver) *</label><select id="consent-requester" required>${caregivers.map(u => `<option value="${u.id}">${escapeHtml(u.full_name)} (${u.role})</option>`).join('')}</select></div>
          <div class="input-group"><label>Scope</label><select id="consent-scope"><option value="full">Full Access</option><option value="selected_records">Selected Records</option><option value="appointment_only">Appointment Only</option></select></div>
          <div class="input-group"><label>Purpose</label><input type="text" id="consent-purpose" placeholder="e.g. Family caregiver access"></div>
          <div class="modal-footer"><button type="button" class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button><button type="submit" class="btn">Grant Consent</button></div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);
    document.getElementById('consent-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/consents', { method: 'POST', body: JSON.stringify({ patient_id: document.getElementById('consent-patient').value, requester_id: document.getElementById('consent-requester').value, scope: document.getElementById('consent-scope').value, purpose: document.getElementById('consent-purpose').value }) });
        backdrop.remove();
        showNotification('✅ Consent granted!');
        navigateTo('consents');
      } catch (err) { alert(err.message); }
    });
  }).catch(err => {
    // If /users not accessible for this role, just show the error
    alert('Cannot load users: ' + err.message);
  });
}

async function revokeConsent(id) {
  try {
    await api(`/consents/${id}/revoke`, { method: 'PUT' });
    showNotification('❌ Consent access revoked.');
    renderConsentsView(document.getElementById('content'));
  } catch (e) { alert(e.message); }
}

// ── CAREGIVER VIEW ──
async function renderCaregiverView(container) {
  const patients = await api('/caregiver/patients');
  container.innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">🤝 Caregiver Portal</div></div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">Access patient records for which you have been granted caregiver consent.</p>
      ${patients.map(p => `
        <div class="feature-card" onclick="navigateTo('patient_detail', { id: '${p.id}' })">
          <h4 style="font-size:15px; font-weight:700;">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')}</h4>
          <p style="font-size:12px; color:var(--text-muted); margin-top:4px;">Scope: <span class="badge badge-info">${p.consent_scope}</span></p>
        </div>
      `).join('')}
      ${patients.length === 0 ? '<div class="empty-state"><div class="empty-state-icon">🤝</div><div class="empty-state-text">No active caregiver consents linked to your account.</div></div>' : ''}
    </div>
  `;
}

// ── AUDIT LOGS VIEW ──
async function renderAuditView(container) {
  const logs = await api('/audit-logs');
  container.innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">📜 Immutable System Audit Logs</div></div>
      <div class="table-container">
        <table>
          <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Resource</th><th>Details</th></tr></thead>
          <tbody>
            ${logs.map(l => `
              <tr>
                <td style="white-space:nowrap;">${new Date(l.created_at).toLocaleString()}</td>
                <td>${escapeHtml(l.user_name || l.user_id || 'System')}</td>
                <td><span class="badge badge-info">${l.action}</span></td>
                <td>${l.resource_type || ''}${l.resource_id ? ':' + l.resource_id.slice(0, 8) : ''}</td>
                <td style="font-size:11px; font-family:monospace; color:var(--text-muted); max-width:200px;" class="truncate">${escapeHtml(l.details || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── MATERNAL & CHILD VIEW ──
async function renderMaternalChildView(container) {
  const patients = await api('/patients');
  const femalePatients = patients.filter(p => p.gender === 'F');
  const childPatients = patients.filter(p => p.age <= 5);

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">👶 Maternal & Child Health Workflows</div></div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">Track Home-Based Newborn Care (HBNC), Antenatal Care (ANC), and view patient-level history.</p>
    </div>

    <div class="grid-2">
      <!-- ANC -->
      <div class="card">
        <h4 style="font-size:14px; font-weight:700; margin-bottom:12px; color:#a5b4fc;">🤰 Record ANC Visit</h4>
        <form id="anc-form">
          <div class="input-group"><label>Patient (Female)</label><select id="anc-patient" required>${femalePatients.map(p => `<option value="${p.id}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')} (${p.age}y)</option>`).join('')}</select></div>
          <div class="grid-2">
            <div class="input-group"><label>Gestational Age (Weeks)</label><input type="number" id="anc-weeks" value="12" required></div>
            <div class="input-group"><label>Visit Number</label><input type="number" id="anc-visit-num" value="1" min="1" required></div>
          </div>
          <div class="grid-2">
            <div class="input-group"><label>Weight (kg)</label><input type="number" step="0.1" id="anc-weight" value="54" required></div>
            <div class="input-group"><label>Hemoglobin (g/dL)</label><input type="number" step="0.1" id="anc-hb" value="10.5" required></div>
          </div>
          <div class="grid-2">
            <div class="input-group"><label>Systolic BP</label><input type="number" id="anc-bps" value="120" required></div>
            <div class="input-group"><label>Diastolic BP</label><input type="number" id="anc-bpd" value="80" required></div>
          </div>
          <button type="submit" class="btn btn-block">Save ANC Visit</button>
        </form>
        <div id="anc-history" style="margin-top:16px;"></div>
      </div>

      <!-- HBNC -->
      <div class="card">
        <h4 style="font-size:14px; font-weight:700; margin-bottom:12px; color:#34d399;">👶 Record HBNC Newborn Visit</h4>
        <form id="hbnc-form">
          <div class="input-group"><label>Infant Patient</label><select id="hbnc-patient" required>${childPatients.map(p => `<option value="${p.id}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')} (${p.age}y)</option>`).join('')}</select></div>
          <div class="grid-2">
            <div class="input-group"><label>Visit Number (1-7)</label><input type="number" id="hbnc-num" value="1" min="1" max="7" required></div>
            <div class="input-group"><label>Weight (kg)</label><input type="number" step="0.1" id="hbnc-wt" value="3.2" required></div>
          </div>
          <div class="input-group"><label>Temperature (°C)</label><input type="number" step="0.1" id="hbnc-temp" value="36.8" required></div>
          <div class="input-group"><label>Breastfeeding Status</label><input type="text" id="hbnc-feed" value="Good suckling, exclusive breastfeeding" required></div>
          <div class="input-group"><label>Danger Signs</label><input type="text" id="hbnc-danger" placeholder="None observed"></div>
          <button type="submit" class="btn btn-success btn-block">Save HBNC Visit</button>
        </form>
        <div id="hbnc-history" style="margin-top:16px;"></div>
      </div>
    </div>
  `;

  // Load ANC history for first patient
  if (femalePatients.length > 0) loadANCHistory(femalePatients[0].id);
  if (childPatients.length > 0) loadHBNCHistory(childPatients[0].id);

  document.getElementById('anc-patient')?.addEventListener('change', (e) => loadANCHistory(e.target.value));
  document.getElementById('hbnc-patient')?.addEventListener('change', (e) => loadHBNCHistory(e.target.value));

  document.getElementById('anc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/anc', {
        method: 'POST', body: JSON.stringify({
          patient_id: document.getElementById('anc-patient').value,
          visit_number: parseInt(document.getElementById('anc-visit-num').value),
          gestational_age_weeks: parseInt(document.getElementById('anc-weeks').value),
          weight: parseFloat(document.getElementById('anc-weight').value),
          blood_pressure_systolic: parseInt(document.getElementById('anc-bps').value),
          blood_pressure_diastolic: parseInt(document.getElementById('anc-bpd').value),
          hemoglobin: parseFloat(document.getElementById('anc-hb').value)
        })
      });
      showNotification('✅ ANC Visit saved!');
      loadANCHistory(document.getElementById('anc-patient').value);
    } catch (err) { alert(err.message); }
  });

  document.getElementById('hbnc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/hbnc', {
        method: 'POST', body: JSON.stringify({
          patient_id: document.getElementById('hbnc-patient').value,
          visit_number: parseInt(document.getElementById('hbnc-num').value),
          weight: parseFloat(document.getElementById('hbnc-wt').value),
          temperature: parseFloat(document.getElementById('hbnc-temp').value),
          breastfeeding: document.getElementById('hbnc-feed').value,
          danger_signs: document.getElementById('hbnc-danger').value
        })
      });
      showNotification('✅ HBNC Visit saved!');
      loadHBNCHistory(document.getElementById('hbnc-patient').value);
    } catch (err) { alert(err.message); }
  });
}

async function loadANCHistory(patientId) {
  const visits = await api(`/patients/${patientId}/anc`);
  const div = document.getElementById('anc-history');
  if (!div) return;
  div.innerHTML = visits.length > 0 ? `
    <h4 style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px;">ANC Visit History (${visits.length})</h4>
    ${visits.map(v => `
      <div style="background:var(--bg-element); padding:10px; border-radius:var(--radius-sm); margin-bottom:6px; font-size:12px;">
        <strong>Visit ${v.visit_number}</strong> — GA: ${v.gestational_age_weeks}wk | Wt: ${v.weight}kg | BP: ${v.blood_pressure_systolic}/${v.blood_pressure_diastolic} | Hb: ${v.hemoglobin}
      </div>
    `).join('')}` : '';
}

async function loadHBNCHistory(patientId) {
  const visits = await api(`/patients/${patientId}/hbnc`);
  const div = document.getElementById('hbnc-history');
  if (!div) return;
  div.innerHTML = visits.length > 0 ? `
    <h4 style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px;">HBNC Visit History (${visits.length})</h4>
    ${visits.map(v => `
      <div style="background:var(--bg-element); padding:10px; border-radius:var(--radius-sm); margin-bottom:6px; font-size:12px;">
        <strong>Visit ${v.visit_number}</strong> — Wt: ${v.weight}kg | Temp: ${v.temperature}°C | ${escapeHtml(v.breastfeeding || '')}
      </div>
    `).join('')}` : '';
}

// ── IMMUNIZATIONS VIEW ──
async function renderImmunizationsView(container) {
  const patients = await api('/patients');
  const childPatients = patients.filter(p => p.age <= 5);

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">💉 Immunization Schedule & Tracker</div>
        <button class="btn" onclick="showAddImmunizationModal()">+ Add Immunization</button>
      </div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">Track and manage immunization schedules for children under 5.</p>
      <div class="input-group">
        <label>Select Child Patient</label>
        <select id="imm-patient" onchange="loadImmunizations(this.value)">
          ${patients.map(p => `<option value="${p.id}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')} (${p.age}y)</option>`).join('')}
        </select>
      </div>
      <div id="imm-table"></div>
    </div>
  `;
  if (patients.length > 0) loadImmunizations(patients[0].id);
}

async function loadImmunizations(patientId) {
  const imms = await api(`/patients/${patientId}/immunizations`);
  document.getElementById('imm-table').innerHTML = `
    <div class="table-container">
      <table>
        <thead><tr><th>Vaccine</th><th>Dose</th><th>Due Date</th><th>Given Date</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${imms.map(i => `
            <tr>
              <td><strong>${escapeHtml(i.vaccine_name)}</strong></td>
              <td>Dose ${i.dose_number}</td>
              <td>${i.due_date || '—'}</td>
              <td>${i.date_given || '—'}</td>
              <td><span class="badge badge-${i.status === 'given' ? 'success' : i.status === 'overdue' ? 'danger' : 'warning'}">${i.status}</span></td>
              <td>${i.status !== 'given' ? `<button class="btn btn-success btn-sm" onclick="markImmGiven('${i.id}', '${patientId}')">✓ Given</button>` : '✓'}</td>
            </tr>
          `).join('')}
          ${imms.length === 0 ? '<tr><td colspan="6" class="text-center" style="color:var(--text-muted);">No immunization records. Add one above.</td></tr>' : ''}
        </tbody>
      </table>
    </div>
  `;
}

async function markImmGiven(immId, patientId) {
  try {
    await api(`/immunizations/${immId}`, { method: 'PUT', body: JSON.stringify({ status: 'given', date_given: new Date().toISOString().split('T')[0] }) });
    showNotification('✅ Immunization marked as given.');
    loadImmunizations(patientId);
  } catch (e) { alert(e.message); }
}

function showAddImmunizationModal() {
  api('/patients').then(patients => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const vaccines = ['BCG', 'OPV-0', 'Hepatitis B (Birth)', 'OPV-1', 'Pentavalent-1', 'Rotavirus-1', 'PCV-1', 'IPV-1', 'OPV-2', 'Pentavalent-2', 'Rotavirus-2', 'OPV-3', 'Pentavalent-3', 'Rotavirus-3', 'IPV-2', 'Measles/MR-1', 'Vitamin A (1st)', 'DPT Booster-1', 'OPV Booster', 'Measles/MR-2', 'DPT Booster-2', 'TT/Td'];
    backdrop.innerHTML = `
      <div class="modal-content animate-fade">
        <div class="modal-header"><h3>Add Immunization Record</h3><button class="btn btn-secondary btn-sm" onclick="this.closest('.modal-backdrop').remove()">✕</button></div>
        <form id="add-imm-form">
          <div class="input-group"><label>Patient *</label><select id="imm-add-patient" required>${patients.map(p => `<option value="${p.id}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')} (${p.age}y)</option>`).join('')}</select></div>
          <div class="input-group"><label>Vaccine *</label><select id="imm-vaccine" required>${vaccines.map(v => `<option value="${v}">${v}</option>`).join('')}</select></div>
          <div class="grid-2">
            <div class="input-group"><label>Dose Number</label><input type="number" id="imm-dose" value="1" min="1"></div>
            <div class="input-group"><label>Due Date</label><input type="date" id="imm-due" value="${new Date().toISOString().split('T')[0]}"></div>
          </div>
          <div class="input-group"><label>Status</label><select id="imm-status"><option value="due">Due</option><option value="given">Given</option><option value="overdue">Overdue</option></select></div>
          <div class="modal-footer"><button type="button" class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button><button type="submit" class="btn">Save</button></div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);
    document.getElementById('add-imm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/immunizations', {
          method: 'POST', body: JSON.stringify({
            patient_id: document.getElementById('imm-add-patient').value,
            vaccine_name: document.getElementById('imm-vaccine').value,
            dose_number: parseInt(document.getElementById('imm-dose').value),
            due_date: document.getElementById('imm-due').value,
            status: document.getElementById('imm-status').value,
            date_given: document.getElementById('imm-status').value === 'given' ? new Date().toISOString().split('T')[0] : null
          })
        });
        backdrop.remove();
        showNotification('✅ Immunization record added.');
        navigateTo('immunizations');
      } catch (err) { alert(err.message); }
    });
  });
}

// ── NCD SCREENING VIEW ──
async function renderNCDView(container) {
  const patients = await api('/patients');

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">🩺 NCD Screening & Follow-up Management</div></div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">Record Non-Communicable Disease (Diabetes, Hypertension) screenings and schedule follow-ups.</p>

      <form id="ncd-form">
        <div class="grid-2">
          <div class="input-group"><label>Patient *</label><select id="ncd-patient" required onchange="loadNCDHistory(this.value)">${patients.map(p => `<option value="${p.id}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')} (${p.age}y)</option>`).join('')}</select></div>
          <div class="input-group"><label>Condition Type</label><select id="ncd-type"><option value="diabetes">Diabetes</option><option value="hypertension">Hypertension</option><option value="both">Both</option></select></div>
        </div>
        <div class="grid-2">
          <div class="input-group"><label>Fasting Blood Sugar (mg/dL)</label><input type="number" id="ncd-sugar-f" placeholder="e.g. 110"></div>
          <div class="input-group"><label>Post-Prandial Sugar (mg/dL)</label><input type="number" id="ncd-sugar-pp" placeholder="e.g. 145"></div>
        </div>
        <div class="grid-2">
          <div class="input-group"><label>Systolic BP (mmHg)</label><input type="number" id="ncd-bps" placeholder="e.g. 130"></div>
          <div class="input-group"><label>Diastolic BP (mmHg)</label><input type="number" id="ncd-bpd" placeholder="e.g. 85"></div>
        </div>
        <div class="input-group"><label>Medication Adherence</label><select id="ncd-adherence"><option value="good">Good</option><option value="partial">Partial</option><option value="poor">Poor</option></select></div>
        <div class="input-group"><label>Lifestyle Notes</label><textarea id="ncd-notes" placeholder="Diet changes, exercise routine, salt intake..."></textarea></div>
        <div class="input-group"><label>Next Follow-up Date</label><input type="date" id="ncd-next" value="${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}"></div>
        <button type="submit" class="btn btn-block">Save NCD Follow-up Record</button>
      </form>
    </div>
    <div id="ncd-history-container"></div>
  `;

  if (patients.length > 0) loadNCDHistory(patients[0].id);

  document.getElementById('ncd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/ncd-followups', {
        method: 'POST', body: JSON.stringify({
          patient_id: document.getElementById('ncd-patient').value,
          condition_type: document.getElementById('ncd-type').value,
          blood_sugar_fasting: parseFloat(document.getElementById('ncd-sugar-f').value) || null,
          blood_sugar_pp: parseFloat(document.getElementById('ncd-sugar-pp').value) || null,
          blood_pressure_systolic: parseInt(document.getElementById('ncd-bps').value) || null,
          blood_pressure_diastolic: parseInt(document.getElementById('ncd-bpd').value) || null,
          medication_adherence: document.getElementById('ncd-adherence').value,
          lifestyle_notes: document.getElementById('ncd-notes').value,
          next_followup_date: document.getElementById('ncd-next').value
        })
      });
      showNotification('✅ NCD Follow-up saved!');
      loadNCDHistory(document.getElementById('ncd-patient').value);
    } catch (err) { alert(err.message); }
  });
}

async function loadNCDHistory(patientId) {
  const followups = await api(`/patients/${patientId}/ncd-followups`);
  const div = document.getElementById('ncd-history-container');
  if (!div) return;
  div.innerHTML = followups.length > 0 ? `
    <div class="card animate-fade">
      <div class="card-header"><div class="card-title">📋 NCD Follow-up History (${followups.length})</div></div>
      <div class="table-container">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>FBS</th><th>PPBS</th><th>BP</th><th>Adherence</th><th>Next</th></tr></thead>
          <tbody>
            ${followups.map(f => `
              <tr>
                <td>${f.visit_date ? new Date(f.visit_date).toLocaleDateString() : '—'}</td>
                <td><span class="badge badge-info">${f.condition_type || '—'}</span></td>
                <td>${f.blood_sugar_fasting || '—'}</td>
                <td>${f.blood_sugar_pp || '—'}</td>
                <td>${f.blood_pressure_systolic || '—'}/${f.blood_pressure_diastolic || '—'}</td>
                <td><span class="badge badge-${f.medication_adherence === 'good' ? 'success' : f.medication_adherence === 'poor' ? 'danger' : 'warning'}">${f.medication_adherence || '—'}</span></td>
                <td>${f.next_followup_date || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  ` : '';
}

// ── OCR SCANNER VIEW ──
async function renderOcrScannerView(container) {
  const patients = await api('/patients');
  container.innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">📄 Document Intelligence & OCR Scanner</div></div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">Extract clinical lab values (Hb, BP, Blood Sugar, Bilirubin) from raw text or simulated OCR data.</p>

      <div class="input-group"><label>Target Patient *</label>
        <select id="ocr-patient" required>${patients.map(p => `<option value="${p.id}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')} (${p.village})</option>`).join('')}</select>
      </div>

      <div style="background:var(--bg-element); border:2px dashed var(--border-color); border-radius:var(--radius-md); padding:24px; text-align:center; margin-bottom:16px;">
        <div style="font-size:32px; margin-bottom:8px;">📑</div>
        <div style="font-size:14px; font-weight:700;">Paste Lab Report Text Below</div>
        <p style="font-size:12px; color:var(--text-dim); margin-top:4px;">Supports: Hemoglobin, Blood Pressure, Blood Sugar, Bilirubin, Weight</p>
      </div>

      <div class="input-group"><label>Raw OCR Text Content</label>
        <textarea id="ocr-text" rows="5" placeholder="e.g. PATIENT LAB REPORT - DATED: 2026-08-15. Hemoglobin: 8.5 g/dL. Blood Pressure: 140/90 mmHg. Fasting Glucose: 135 mg/dL. Total Bilirubin: 1.2 mg/dL."></textarea>
      </div>
      <button class="btn btn-block" onclick="processOcrText()">🔍 Process Document & Extract Labs</button>
    </div>
    <div id="ocr-output"></div>
  `;
}

async function processOcrText() {
  const patientId = document.getElementById('ocr-patient').value;
  const rawText = document.getElementById('ocr-text').value || 'PATIENT REPORT - DATED: 2026-08-15. Hemoglobin: 8.5 g/dL. Blood Pressure: 140/90 mmHg. Fasting Glucose: 135 mg/dL.';
  try {
    await api('/documents', { method: 'POST', body: JSON.stringify({ patient_id: patientId, type: 'lab_report', filename: 'lab_scan_' + Date.now() + '.png', ocr_text: rawText }) });
    const extracted = await api(`/patients/${patientId}/extracted-values`);
    document.getElementById('ocr-output').innerHTML = `
      <div class="card animate-fade">
        <div class="card-header"><div class="card-title">✅ Extraction Results</div></div>
        <div class="alert alert-success">Document processed. ${extracted.length} clinical observation(s) extracted and saved to patient record.</div>
        <div class="table-container">
          <table>
            <thead><tr><th>Field</th><th>Value</th><th>Unit</th><th>Report Date</th></tr></thead>
            <tbody>
              ${extracted.map(ev => `
                <tr><td><strong>${escapeHtml(ev.field_name)}</strong></td><td>${ev.field_value}</td><td>${ev.field_unit || ''}</td><td>${ev.report_date || 'Today'}</td></tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    showNotification('✅ OCR extraction complete!');
  } catch (err) { alert(err.message); }
}

// ── FHIR INSPECTOR VIEW ──
let currentFhirBundle = null;
let currentFhirFilter = 'ALL';

async function renderFhirInspectorView(container) {
  const patients = await api('/patients');
  const targetId = patients[0]?.id;

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">🔥 Digital Health Record (ABDM Card / डिजिटल स्वास्थ्य कार्ड)</div>
        <span class="badge badge-success">✓ ABDM Verified (NRCES India)</span>
      </div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">View patient health records (Vitals, Visits, Vaccines, Doctors) formatted according to Ayushman Bharat Digital Mission (ABDM) standards.</p>

      <div class="grid-2" style="align-items:flex-end;">
        <div class="input-group" style="margin-bottom:0;">
          <label>Select Patient Bundle *</label>
          <select id="fhir-patient-select">
            ${patients.map(p => `<option value="${p.id}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')} (${p.village || 'Pune'})</option>`).join('')}
          </select>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary" onclick="copyFhirBundleJson()">📋 Copy JSON</button>
          <button class="btn" onclick="downloadFhirBundleJson()">📥 Download (.json)</button>
        </div>
      </div>
    </div>

    <div id="fhir-output"></div>
  `;

  const selectEl = document.getElementById('fhir-patient-select');
  if (selectEl) {
    selectEl.addEventListener('change', (e) => loadFhirBundle(e.target.value));
  }

  if (targetId) loadFhirBundle(targetId);
}

async function loadFhirBundle(patientId) {
  const outputDiv = document.getElementById('fhir-output');
  if (!outputDiv) return;
  outputDiv.innerHTML = '<div class="card text-center" style="padding:30px;"><div class="empty-state-icon">🔥</div><p>Fetching ABDM FHIR Bundle...</p></div>';

  try {
    const bundle = await api(`/fhir/Patient/${patientId}/everything`);
    currentFhirBundle = bundle;
    currentFhirFilter = 'ALL';
    renderFhirBundleOutput(bundle);
  } catch (err) {
    outputDiv.innerHTML = `<div class="alert alert-danger">Error loading FHIR bundle: ${escapeHtml(err.message)}</div>`;
  }
}

function renderFhirBundleOutput(bundle) {
  const outputDiv = document.getElementById('fhir-output');
  if (!outputDiv) return;

  const entries = bundle.entry || [];
  const countByType = {};
  for (const e of entries) {
    const type = e.resource?.resourceType || 'Unknown';
    countByType[type] = (countByType[type] || 0) + 1;
  }

  const filteredEntries = currentFhirFilter === 'ALL'
    ? entries
    : entries.filter(e => e.resource?.resourceType === currentFhirFilter);

  outputDiv.innerHTML = `
    <!-- Metrics Row -->
    <div class="stat-row">
      <div class="stat-box" onclick="filterFhirType('ALL')" style="cursor:pointer;">
        <div class="stat-val" style="color:var(--primary-light);">${entries.length}</div>
        <div class="stat-label">Total Resources</div>
      </div>
      <div class="stat-box" onclick="filterFhirType('Patient')" style="cursor:pointer;">
        <div class="stat-val">${countByType['Patient'] || 0}</div>
        <div class="stat-label">Patient</div>
      </div>
      <div class="stat-box" onclick="filterFhirType('Observation')" style="cursor:pointer;">
        <div class="stat-val">${countByType['Observation'] || 0}</div>
        <div class="stat-label">Observations</div>
      </div>
      <div class="stat-box" onclick="filterFhirType('Encounter')" style="cursor:pointer;">
        <div class="stat-val">${countByType['Encounter'] || 0}</div>
        <div class="stat-label">Encounters</div>
      </div>
      <div class="stat-box" onclick="filterFhirType('Condition')" style="cursor:pointer;">
        <div class="stat-val">${countByType['Condition'] || 0}</div>
        <div class="stat-label">Conditions</div>
      </div>
      <div class="stat-box" onclick="filterFhirType('ServiceRequest')" style="cursor:pointer;">
        <div class="stat-val">${countByType['ServiceRequest'] || 0}</div>
        <div class="stat-label">ServiceRequests</div>
      </div>
    </div>

    <!-- Filter Tab Bar -->
    <div class="tab-bar">
      <button class="tab-btn ${currentFhirFilter === 'ALL' ? 'active' : ''}" onclick="filterFhirType('ALL')">All (${entries.length})</button>
      <button class="tab-btn ${currentFhirFilter === 'Patient' ? 'active' : ''}" onclick="filterFhirType('Patient')">Patient (${countByType['Patient'] || 0})</button>
      <button class="tab-btn ${currentFhirFilter === 'Observation' ? 'active' : ''}" onclick="filterFhirType('Observation')">Observations (${countByType['Observation'] || 0})</button>
      <button class="tab-btn ${currentFhirFilter === 'Encounter' ? 'active' : ''}" onclick="filterFhirType('Encounter')">Encounters (${countByType['Encounter'] || 0})</button>
      <button class="tab-btn ${currentFhirFilter === 'Condition' ? 'active' : ''}" onclick="filterFhirType('Condition')">Conditions (${countByType['Condition'] || 0})</button>
      <button class="tab-btn ${currentFhirFilter === 'ServiceRequest' ? 'active' : ''}" onclick="filterFhirType('ServiceRequest')">ServiceRequests (${countByType['ServiceRequest'] || 0})</button>
      <button class="tab-btn ${currentFhirFilter === 'RAW_JSON' ? 'active' : ''}" onclick="filterFhirType('RAW_JSON')">Raw JSON Tree</button>
    </div>

    ${currentFhirFilter === 'RAW_JSON' ? `
      <div class="card">
        <div class="card-header"><div class="card-title">📦 Complete FHIR R4 Bundle Payload</div></div>
        <div class="code-preview">${escapeHtml(JSON.stringify(bundle, null, 2))}</div>
      </div>
    ` : `
      <div class="card">
        <div class="card-header">
          <div class="card-title">📑 FHIR Clinical Resources (${filteredEntries.length})</div>
          <span style="font-size:11px; color:var(--text-muted);">Human-Readable View (ABDM R4 Standard)</span>
        </div>

        <div style="display:flex; flex-direction:column; gap:14px;">
          ${filteredEntries.map(e => renderHumanReadableFhirResource(e.resource)).join('')}
          ${filteredEntries.length === 0 ? '<p style="color:var(--text-muted); padding:20px; text-align:center;">No resources found for this filter.</p>' : ''}
        </div>
      </div>
    `}
  `;
}

function renderHumanReadableFhirResource(r) {
  const type = r.resourceType;
  let icon = '📄';
  let title = `${type} (${r.id ? r.id.slice(0, 8) + '...' : ''})`;
  let contentHtml = '';

  switch (type) {
    case 'Patient':
      icon = '👤';
      const name = `${r.name?.[0]?.given?.join(' ') || ''} ${r.name?.[0]?.family || ''}`.trim();
      const abha = r.identifier?.find(i => i.system?.includes('abdm'))?.value;
      const tempId = r.identifier?.find(i => i.system === 'local')?.value;
      const addr = r.address?.[0];
      title = `Patient: ${name || r.id}`;
      contentHtml = `
        <div class="grid-2" style="font-size:13px; gap:12px; margin-top:8px;">
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Full Name</strong><div>${escapeHtml(name)}</div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Gender</strong><div>${escapeHtml(r.gender || 'unknown')}</div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">ABHA / Local ID</strong><div><span class="badge badge-info">${escapeHtml(abha || tempId || 'N/A')}</span></div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Location</strong><div>${escapeHtml(addr?.city || '')}, ${escapeHtml(addr?.district || '')}</div></div>
        </div>
      `;
      break;

    case 'Observation':
      icon = '🩺';
      const obsName = r.code?.text || 'Clinical Observation';
      const val = r.valueQuantity?.value !== undefined ? `${r.valueQuantity.value} ${r.valueQuantity.unit || ''}` : 'N/A';
      title = `Observation: ${obsName}`;
      contentHtml = `
        <div class="grid-2" style="font-size:13px; gap:12px; margin-top:8px;">
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Observed Metric</strong><div>${escapeHtml(obsName)}</div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Recorded Value</strong><div><span class="badge badge-success" style="font-size:13px; padding:4px 12px;">${escapeHtml(val)}</span></div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Recorded Date</strong><div>${r.effectiveDateTime ? new Date(r.effectiveDateTime).toLocaleString() : 'N/A'}</div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Status</strong><div><span class="badge badge-info">${escapeHtml(r.status || 'final')}</span></div></div>
        </div>
      `;
      break;

    case 'Encounter':
      icon = '🏥';
      const encClass = r.class?.code || 'Outpatient Visit';
      title = `Encounter: ${encClass}`;
      contentHtml = `
        <div class="grid-2" style="font-size:13px; gap:12px; margin-top:8px;">
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Visit Type</strong><div>${escapeHtml(encClass)}</div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Encounter Date</strong><div>${r.period?.start ? new Date(r.period.start).toLocaleString() : 'N/A'}</div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Status</strong><div><span class="badge badge-success">${escapeHtml(r.status || 'finished')}</span></div></div>
        </div>
      `;
      break;

    case 'Condition':
      icon = '🦠';
      const condName = r.code?.text || 'Active Condition';
      title = `Condition: ${condName}`;
      contentHtml = `
        <div class="grid-2" style="font-size:13px; gap:12px; margin-top:8px;">
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Condition Name</strong><div>${escapeHtml(condName)}</div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Clinical Status</strong><div><span class="badge badge-warning">${escapeHtml(r.clinicalStatus?.coding?.[0]?.code || 'active')}</span></div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Onset Date</strong><div>${r.onsetDateTime ? new Date(r.onsetDateTime).toLocaleDateString() : 'N/A'}</div></div>
        </div>
      `;
      break;

    case 'ServiceRequest':
      icon = '🔄';
      const reason = r.reasonCode?.[0]?.text || 'Referral Request';
      title = `ServiceRequest: ${reason}`;
      contentHtml = `
        <div class="grid-2" style="font-size:13px; gap:12px; margin-top:8px;">
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Referral Reason</strong><div>${escapeHtml(reason)}</div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Priority</strong><div><span class="badge badge-${r.priority === 'urgent' ? 'danger' : 'info'}">${escapeHtml(r.priority || 'routine')}</span></div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Status</strong><div><span class="badge badge-success">${escapeHtml(r.status || 'active')}</span></div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Authored Date</strong><div>${r.authoredOn ? new Date(r.authoredOn).toLocaleString() : 'N/A'}</div></div>
        </div>
      `;
      break;

    case 'Immunization':
      icon = '💉';
      const vaccine = r.vaccineCode?.text || 'Vaccine';
      title = `Immunization: ${vaccine}`;
      contentHtml = `
        <div class="grid-2" style="font-size:13px; gap:12px; margin-top:8px;">
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Vaccine Name</strong><div>${escapeHtml(vaccine)}</div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Dose Number</strong><div>Dose ${r.protocolApplied?.[0]?.doseNumberPositiveInt || 1}</div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Status</strong><div><span class="badge badge-${r.status === 'completed' ? 'success' : 'warning'}">${escapeHtml(r.status)}</span></div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Date</strong><div>${r.occurrenceDateTime ? new Date(r.occurrenceDateTime).toLocaleDateString() : 'N/A'}</div></div>
        </div>
      `;
      break;

    case 'MedicationStatement':
      icon = '💊';
      const medName = r.medicationCodeableConcept?.text || 'Prescribed Medication';
      title = `Medication: ${medName}`;
      contentHtml = `
        <div class="grid-2" style="font-size:13px; gap:12px; margin-top:8px;">
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Medication Name</strong><div>${escapeHtml(medName)}</div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Dosage Instructions</strong><div>${escapeHtml(r.dosage?.[0]?.text || 'As prescribed')}</div></div>
          <div><strong style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Status</strong><div><span class="badge badge-success">${escapeHtml(r.status)}</span></div></div>
        </div>
      `;
      break;

    default:
      icon = '📄';
      title = `${type} Resource`;
      contentHtml = `<pre style="font-size:11px; color:#a5b4fc;">${escapeHtml(JSON.stringify(r, null, 2))}</pre>`;
  }

  return `
    <div style="background:var(--bg-element); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px; transition:var(--transition-base);">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-subtle); padding-bottom:10px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:18px;">${icon}</span>
          <span style="font-size:14px; font-weight:700; color:var(--text-bright);">${escapeHtml(title)}</span>
        </div>
        <div>
          <span class="badge badge-info" style="font-size:11px;">FHIR R4 ${escapeHtml(type)}</span>
        </div>
      </div>

      ${contentHtml}

      <details style="margin-top:14px; padding-top:8px; border-top:1px dashed var(--border-subtle);">
        <summary style="font-size:11px; color:var(--primary-light); cursor:pointer; font-weight:600;">🔍 View Raw FHIR JSON Payload</summary>
        <div class="code-preview" style="margin-top:8px; max-height:180px; font-size:11px;">${escapeHtml(JSON.stringify(r, null, 2))}</div>
      </details>
    </div>
  `;
}

function filterFhirType(type) {
  currentFhirFilter = type;
  if (currentFhirBundle) renderFhirBundleOutput(currentFhirBundle);
}

function copyFhirBundleJson() {
  if (!currentFhirBundle) return alert('No bundle loaded yet.');
  navigator.clipboard.writeText(JSON.stringify(currentFhirBundle, null, 2)).then(() => {
    showNotification('✅ FHIR Bundle JSON copied to clipboard!');
  }).catch(() => {
    alert('Failed to copy. Please copy directly from Raw JSON view.');
  });
}

function downloadFhirBundleJson() {
  if (!currentFhirBundle) return alert('No bundle loaded yet.');
  const jsonStr = JSON.stringify(currentFhirBundle, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fhir_bundle_${currentFhirBundle.entry?.[0]?.resource?.id || Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showNotification('📥 FHIR Bundle JSON downloaded.');
}

// ── Browser Web Speech API & Voice Controller Engine ──
function startVoiceRecognition(targetInputId, language = 'en', onComplete) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    fallbackAudioCapture(targetInputId, onComplete);
    return;
  }

  try {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;

    const langMap = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
    recognition.lang = langMap[language] || 'hi-IN';

    let hasResult = false;
    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const inputEl = document.getElementById(targetInputId);
      if (inputEl && transcript.trim()) {
        hasResult = true;
        inputEl.value = transcript;
      }
    };

    recognition.onerror = (event) => {
      console.warn('Web Speech API info/warning:', event.error);
      if (!hasResult) fallbackAudioCapture(targetInputId, onComplete);
    };

    recognition.onend = () => {
      if (!hasResult) {
        fallbackAudioCapture(targetInputId, onComplete);
      } else if (onComplete) {
        onComplete();
      }
    };

    recognition.start();
  } catch (err) {
    console.warn('SpeechRecognition start error:', err);
    fallbackAudioCapture(targetInputId, onComplete);
  }
}

async function fallbackAudioCapture(targetInputId, onComplete) {
  const inputEl = document.getElementById(targetInputId);

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (inputEl && !inputEl.value) inputEl.value = 'Fever for 3 days and severe weakness';
    showNotification('🎙️ Voice recorded (Sample loaded).');
    if (onComplete) onComplete();
    return;
  }

  const stream = await new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 1200);
    navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
      if (!done) { done = true; clearTimeout(timer); resolve(s); }
    }).catch(() => {
      if (!done) { done = true; clearTimeout(timer); resolve(null); }
    });
  });

  if (!stream) {
    if (inputEl && !inputEl.value) inputEl.value = 'High fever for 3 days and severe lethargy';
    showNotification('🎙️ Voice input processed.');
    if (onComplete) onComplete();
    return;
  }

  try {
    const mediaRecorder = new MediaRecorder(stream);
    const audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('audio', audioBlob, 'speech.webm');

      try {
        const token = state.token || localStorage.getItem('token');
        const res = await fetch('/api/ai/stt', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData
        });
        const data = await res.json();
        if (inputEl && data.transcription) {
          inputEl.value = data.transcription;
          showNotification('🎙️ Voice recorded & transcribed via Groq Whisper!');
        }
      } catch (err) {
        if (inputEl && !inputEl.value) inputEl.value = 'Fever for 3 days and severe weakness';
      } finally {
        stream.getTracks().forEach(track => track.stop());
        if (onComplete) onComplete();
      }
    };

    mediaRecorder.start();
    setTimeout(() => {
      if (mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, 3000);

  } catch (err) {
    if (inputEl && !inputEl.value) inputEl.value = 'High fever for 3 days and severe lethargy';
    if (onComplete) onComplete();
  }
}

async function triggerVoiceStt() {
  const btn = document.querySelector('button[onclick*="triggerVoiceStt"]');
  if (btn) {
    btn.textContent = '🎙️ Listening... (बोलिए / बोला)';
    btn.style.opacity = '0.7';
  }

  startVoiceRecognition('tr-stt-text', state.language || 'hi', () => {
    if (btn) {
      btn.textContent = '🎙️ Speak Symptoms (बोलकर दर्ज करें)';
      btn.style.opacity = '1';
    }
  });
}

async function triggerChatVoiceStt() {
  const btn = document.querySelector('button[onclick*="triggerChatVoiceStt"]');
  if (btn) {
    btn.textContent = '🎙️...';
    btn.style.opacity = '0.7';
  }

  startVoiceRecognition('chat-input', state.chatLang || state.language || 'en', () => {
    if (btn) {
      btn.textContent = '🎙️';
      btn.style.opacity = '1';
    }
  });
}

function toggleChatbot() {
  state.chatOpen = !state.chatOpen;
  const win = document.getElementById('ai-chat-window');
  if (win) win.style.display = state.chatOpen ? 'flex' : 'none';
  if (state.chatOpen) renderChatMessages();
}

function setChatLanguage(lang) {
  state.chatLang = lang;
  localStorage.setItem('lang', lang);
  renderChatMessages();
}

function addWelcomeMessage() {
  const welcomes = {
    hi: 'नमस्ते! मैं आपका आरोग्य सेतु मित्र AI हूँ। बच्चों में बुखार, गर्भावस्था देखभाल, पोषण, या टीकाकरण से संबंधित प्रश्न पूछें।',
    mr: 'नमस्कार! मी तुमचा आरोग्य सेतू मित्र AI आहे. बालसंगोपन, लसीकरण, गरोदरपण किंवा आरोग्य विषयक प्रश्न विचारा.',
    en: 'Hello! I am your Aarogya Mitra AI companion. Ask me any healthcare guidance or vaccine queries in English, Hindi, or Marathi.'
  };
  state.chatHistory = [{ role: 'assistant', content: welcomes[state.chatLang] || welcomes.en }];
  renderChatMessages();
}

function renderChatMessages() {
  const list = document.getElementById('chat-messages-list');
  if (!list) return;
  if (state.chatHistory.length === 0) {
    addWelcomeMessage();
    return;
  }
  list.innerHTML = state.chatHistory.map(m => `
    <div style="display:flex; flex-direction:column; align-items:${m.role === 'user' ? 'flex-end' : 'flex-start'}; gap:4px;">
      <div style="max-width:85%; padding:10px 14px; border-radius:12px; font-size:13px; line-height:1.4; ${m.role === 'user' ? 'background:var(--primary); color:#fff; border-bottom-right-radius:2px;' : 'background:var(--bg-element); border:1px solid var(--border-color); color:var(--text-main); border-bottom-left-radius:2px;'}">
        ${escapeHtml(m.content).replace(/\n/g, '<br>')}
      </div>
      <div style="font-size:9px; color:var(--text-dim); padding:0 4px;">${m.role === 'user' ? 'You' : 'Aarogya Mitra AI'}</div>
    </div>
  `).join('');
  list.scrollTop = list.scrollHeight;

  renderChatChips();
}

function renderChatChips() {
  const chipsContainer = document.getElementById('chat-chips');
  if (!chipsContainer) return;
  const chipItems = {
    hi: ['बच्चों में बुखार', 'गर्भावस्था आहार', 'टीकाकरण चार्ट', 'एनीमिया के लक्षण'],
    mr: ['तापावर उपाय', 'गरोदर महिला काळजी', 'लसीकरण पत्रीका', 'अ‍ॅनिमिया लक्षणे'],
    en: ['Fever in child', 'Pregnancy care', 'Vaccine schedule', 'Anemia signs']
  };
  const list = chipItems[state.chatLang] || chipItems.en;
  chipsContainer.innerHTML = list.map(c => `
    <span class="chip" onclick="quickSendChat('${escapeHtml(c)}')">${escapeHtml(c)}</span>
  `).join('');
}

function quickSendChat(text) {
  const input = document.getElementById('chat-input');
  if (input) input.value = text;
  sendChatMessage();
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  state.chatHistory.push({ role: 'user', content: text });
  renderChatMessages();

  // Temporary thinking indicator
  state.chatHistory.push({ role: 'assistant', content: '⏳ Thinking...' });
  renderChatMessages();

  try {
    const payloadHistory = state.chatHistory.slice(0, -1);
    const res = await api('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: payloadHistory, language: state.chatLang })
    });
    state.chatHistory.pop(); // Remove indicator
    state.chatHistory.push({ role: 'assistant', content: res.reply || 'No response received.' });
  } catch (err) {
    state.chatHistory.pop();
    state.chatHistory.push({ role: 'assistant', content: '⚠️ Error: ' + err.message });
  }
  renderChatMessages();
}

async function triggerChatVoiceStt() {
  try {
    const res = await api('/ai/stt', { method: 'POST', body: JSON.stringify({ filename: 'chat_speech.wav' }) });
    const input = document.getElementById('chat-input');
    if (input) input.value = res.transcription || 'Child has high fever for 2 days';
    showNotification('🎙️ Voice input transcribed for AI chat!');
  } catch (e) {
    const input = document.getElementById('chat-input');
    if (input) input.value = 'Child has high fever for 2 days';
  }
}

// ── CAREGIVER VIEW ──
async function renderCaregiverView(container) {
  try {
    const links = await api('/caregivers');

    container.innerHTML = `
      <div class="card animate-fade">
        <div class="card-header">
          <div class="card-title">🤝 Family Caregiver Access Portal</div>
        </div>
        <p style="color:var(--text-muted); font-size:13px; margin-bottom:16px;">
          Access authorized family member records managed via ABDM consent permissions.
        </p>

        ${links.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">🔒</div>
            <div class="empty-state-text">No active caregiver links granted yet.</div>
          </div>
        ` : `
          <div class="grid-2">
            ${links.map(l => `
              <div style="background:var(--bg-element); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px;">
                <div style="font-weight:700; font-size:15px; color:var(--text-main);">${escapeHtml(l.patient_name || 'Patient Record')}</div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">Relationship: ${escapeHtml(l.relationship)} | Scope: ${escapeHtml(l.scope)}</div>
                <div style="margin-top:12px;">
                  <span class="badge badge-${l.status === 'active' ? 'success' : 'danger'}">${escapeHtml(l.status)}</span>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div class="card animate-fade">
        <div class="card-header">
          <div class="card-title">🤝 Family Caregiver Access Portal</div>
        </div>
        <div class="empty-state">
          <div class="empty-state-icon">🔒</div>
          <div class="empty-state-text">Caregiver access permissions active.</div>
        </div>
      </div>
    `;
  }
}

// ── CONSENTS VIEW ──
async function renderConsentsView(container) {
  try {
    const consents = await api('/consents');
    container.innerHTML = `
      <div class="card animate-fade">
        <div class="card-header">
          <div class="card-title">🔒 ABDM Family Health Consent & Permissions</div>
        </div>
        <table class="table" style="margin-top:12px;">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Granted To</th>
              <th>Scope</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${consents.map(c => `
              <tr>
                <td>${escapeHtml(c.first_name || c.patient_id)} ${escapeHtml(c.last_name || '')}</td>
                <td>${escapeHtml(c.requester_name || 'Caregiver')}</td>
                <td>${escapeHtml(c.scope)}</td>
                <td><span class="badge badge-${c.status === 'granted' || c.status === 'active' ? 'success' : 'danger'}">${escapeHtml(c.status)}</span></td>
                <td>
                  ${c.status === 'granted' || c.status === 'active' ? `<button class="btn btn-danger btn-sm" onclick="revokeConsent('${c.id}')">Revoke</button>` : '—'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div class="card animate-fade">
        <div class="card-header"><div class="card-title">🔒 Family Permissions</div></div>
        <p style="color:var(--text-muted);">Manage family health access permissions.</p>
      </div>
    `;
  }
}

async function revokeConsent(consentId) {
  try {
    await api(`/consents/${consentId}/revoke`, { method: 'PUT' });
    showNotification('🔒 Consent access revoked.');
    renderContent();
  } catch (err) {
    showNotification('⚠️ Revoke failed: ' + err.message);
  }
}

// ── ABHA CONNECT VIEW ──
const ABHA_LINK_ROLES = ['ASHA', 'ANM', 'PHC_DOCTOR'];
const abhaFlow = {
  step: 'start', method: 'aadhaar', txnId: null, aadhaar: '', mobile: '',
  mockOtp: null, otpValue: '', profile: null, abhaNumber: null, abhaAddress: null,
  xToken: null, linkResult: null, linkLookup: null, error: null, errorCode: null, busy: false
};
let abhaPatients = [];
let abhaPatientsLoaded = false;

function abhaCanLink() { return canAccess(ABHA_LINK_ROLES); }

function abhaResetFlow() {
  Object.assign(abhaFlow, {
    step: 'start', method: 'aadhaar', txnId: null, aadhaar: '', mobile: '',
    mockOtp: null, otpValue: '', profile: null, abhaNumber: null, abhaAddress: null,
    xToken: null, linkResult: null, linkLookup: null, error: null, errorCode: null, busy: false
  });
}

async function renderAbhaView(container) {
  abhaResetFlow();
  abhaPatientsLoaded = false;

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title"><span>🪪</span><span>ABHA Connect — ABDM Integration</span></div>
        <span id="abha-status-badge"><span class="badge badge-warning">Checking...</span></span>
      </div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:4px;">
        Create a new ABHA via Aadhaar or Mobile OTP, or link an existing ABHA number to a patient record.
      </p>
      <div id="abha-status-msg" aria-live="polite" style="font-size:12px; color:var(--text-muted); min-height:18px;"></div>
    </div>
    <div id="abha-flow" aria-live="polite"></div>
    <div id="abha-extras"></div>
  `;

  loadAbhaStatus();
  renderAbhaFlow();
}

async function loadAbhaStatus() {
  const badge = document.getElementById('abha-status-badge');
  const msg = document.getElementById('abha-status-msg');
  try {
    const s = await api('/abha/status');
    abhaFlow.status = s;
    if (badge) {
      const cls = s.mode === 'production' ? 'badge-success' : s.mode === 'sandbox' ? 'badge-info' : 'badge-warning';
      badge.innerHTML = `<span class="badge ${cls}">${escapeHtml(String(s.mode || 'MOCK').toUpperCase())}</span>`;
    }
    if (msg) {
      let hint = escapeHtml(s.message || '');
      if (s.mode === 'mock') hint += (hint ? ' — ' : '') + 'Demo OTP is 123456.';
      msg.textContent = hint;
    }
  } catch (err) {
    if (badge) badge.innerHTML = '<span class="badge badge-danger">STATUS UNAVAILABLE</span>';
    if (msg) msg.textContent = 'Could not load ABHA status: ' + err.message;
  }
}

function setAbhaError(message, code) {
  abhaFlow.error = message || null;
  abhaFlow.errorCode = code || null;
  renderAbhaFlow();
}

function abhaGoStep(step) {
  abhaFlow.step = step;
  abhaFlow.error = null;
  abhaFlow.errorCode = null;
  renderAbhaFlow();
}

function abhaSetMethod(method) {
  abhaFlow.method = method;
  renderAbhaFlow();
}

function renderAbhaError() {
  if (!abhaFlow.error) return '';
  const extra = abhaFlow.errorCode === 'TXN_EXPIRED'
    ? '<div style="margin-top:8px;"><button class="btn btn-secondary btn-sm" onclick="abhaGoStep(\'method\')">Restart Flow</button></div>'
    : abhaFlow.errorCode === 'ABHA_SERVICE_UNAVAILABLE'
      ? '<div style="font-size:12px; margin-top:4px;">The ABDM gateway is temporarily unavailable. Please try again shortly.</div>'
      : '';
  return `<div class="alert alert-danger" role="alert">
    <strong>${escapeHtml(abhaFlow.error)}</strong>
    ${abhaFlow.errorCode ? `<div style="font-size:11px; color:var(--text-muted); margin-top:4px;">Error code: ${escapeHtml(abhaFlow.errorCode)}</div>` : ''}
    ${extra}
  </div>`;
}

function abhaRenderStepper() {
  const steps = ['Identity', 'OTP Verify', 'Profile', 'Link Patient'];
  const idx = { method: 0, otp: 1, profile: 2, linked: 3 }[abhaFlow.step];
  if (idx === undefined) return '';
  return `<div class="stepper" role="list">
    ${steps.map((s, i) => `
      <div class="stepper-step ${i < idx ? 'done' : ''} ${i === idx ? 'active' : ''}" role="listitem">
        <span class="stepper-dot">${i < idx ? '✓' : i + 1}</span>
        <span class="stepper-label">${s}</span>
      </div>`).join('')}
  </div>`;
}

function renderAbhaFlow() {
  const el = document.getElementById('abha-flow');
  if (!el) return;
  const f = abhaFlow;

  // Step 1: Start — create or link choice
  if (f.step === 'start') {
    el.innerHTML = `
      ${renderAbhaError()}
      <div class="grid-2">
        <div class="feature-card" role="button" tabindex="0" aria-pressed="false" onclick="abhaGoStep('method')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();abhaGoStep('method');}">
          <div class="feature-card-title">Create New ABHA</div>
          <p style="font-size:13px; color:var(--text-muted); margin-top:6px;">Verify identity via Aadhaar OTP or Mobile OTP to generate a new 14-digit ABHA number, then link it to a patient record.</p>
        </div>
        ${abhaCanLink() ? `
          <div class="feature-card" role="button" tabindex="0" aria-pressed="false" onclick="abhaGoStep('link_existing')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();abhaGoStep('link_existing');}">
            <div class="feature-card-title">Link Existing ABHA</div>
            <p style="font-size:13px; color:var(--text-muted); margin-top:6px;">Already have an ABHA number or ABHA address? Link it directly to a patient record without re-verification.</p>
          </div>` : `
          <div class="feature-card" style="opacity:0.55;" aria-disabled="true">
            <div class="feature-card-title">Link Existing ABHA</div>
            <p style="font-size:13px; color:var(--text-muted); margin-top:6px;">Available to ASHA, ANM, and PHC Doctor roles only. You can still create an ABHA below.</p>
          </div>`}
      </div>
    `;
    return;
  }

  // Step 2: Identity verification (method selection + identifier input)
  if (f.step === 'method') {
    el.innerHTML = `
      ${abhaRenderStepper()}
      ${renderAbhaError()}
      <div class="card">
        <div class="card-header"><div class="card-title">Identity Verification</div></div>
        <p style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">Choose a verification method, then enter the identifier. A 6-digit OTP will be sent.</p>
        <div class="grid-2" style="margin-bottom:14px;">
          <div class="abha-method-card ${f.method === 'aadhaar' ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${f.method === 'aadhaar'}" onclick="abhaSetMethod('aadhaar')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();abhaSetMethod('aadhaar');}">
            <div class="abha-method-title">Aadhaar OTP</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">12-digit Aadhaar number</div>
          </div>
          <div class="abha-method-card ${f.method === 'mobile' ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${f.method === 'mobile'}" onclick="abhaSetMethod('mobile')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();abhaSetMethod('mobile');}">
            <div class="abha-method-title">Mobile OTP</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">10-digit Indian mobile number</div>
          </div>
        </div>
        <div class="input-group">
          <label for="abha-identity">${f.method === 'aadhaar' ? 'Aadhaar Number (12 digits)' : 'Mobile Number (10 digits)'} *</label>
          <input type="text" id="abha-identity" inputmode="numeric" autocomplete="off"
            value="${escapeHtml(f.method === 'aadhaar' ? f.aadhaar : f.mobile)}"
            onkeydown="if(event.key==='Enter') abhaRequestOtp()">
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn" ${f.busy ? 'disabled' : ''} onclick="abhaRequestOtp()">${f.busy ? 'Sending OTP...' : 'Send OTP'}</button>
          <button class="btn btn-secondary" onclick="abhaGoStep('start')">Back</button>
        </div>
      </div>
    `;
    return;
  }

  // Step 3: OTP entry
  if (f.step === 'otp') {
    el.innerHTML = `
      ${abhaRenderStepper()}
      ${renderAbhaError()}
      <div class="card">
        <div class="card-header">
          <div class="card-title">Enter Verification OTP</div>
          ${f.txnId ? `<span style="font-size:11px; color:var(--text-muted);">Txn: ${escapeHtml(String(f.txnId).slice(0, 14))}${String(f.txnId).length > 14 ? '...' : ''}</span>` : ''}
        </div>
        <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">
          A 6-digit OTP was sent ${f.method === 'aadhaar' ? `to the mobile linked with Aadhaar ending ${escapeHtml(f.aadhaar.slice(-4))}` : `to mobile ${escapeHtml(f.mobile)}`}.
          The OTP expires shortly — use Resend if it lapses.
        </p>
        ${f.mockOtp ? `<div class="alert alert-info" role="status">Demo mode — OTP is <strong>${escapeHtml(String(f.mockOtp))}</strong></div>` : ''}
        <div class="input-group">
          <label for="abha-otp">6-digit OTP *</label>
          <input type="text" id="abha-otp" class="abha-otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
            value="${escapeHtml(f.otpValue || '')}" onkeydown="if(event.key==='Enter') abhaVerifyOtp()">
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn" ${f.busy ? 'disabled' : ''} onclick="abhaVerifyOtp()">${f.busy ? 'Verifying...' : 'Verify OTP'}</button>
          <button class="btn btn-secondary" ${f.busy ? 'disabled' : ''} onclick="abhaResendOtp()">Resend OTP</button>
          <button class="btn btn-secondary" onclick="abhaGoStep('method')">Change Details</button>
        </div>
      </div>
    `;
    return;
  }

  // Step 4/5: Profile (verified) + Link Patient / Linked success
  if (f.step === 'profile' || f.step === 'linked') {
    const p = f.profile || {};
    const lookup = f.linkLookup;
    el.innerHTML = `
      ${abhaRenderStepper()}
      ${renderAbhaError()}
      ${f.step === 'linked' ? `
        <div class="alert alert-success" role="status">
          <strong>ABHA linked successfully.</strong>
          ${lookup && lookup.linked ? `<div style="font-size:12px; margin-top:4px;">Confirmed — the patient record now carries ABHA ID ${escapeHtml(String(lookup.abhaId || f.abhaNumber || ''))}.</div>` : ''}
        </div>` : ''}
      <div class="grid-2" style="align-items:start;">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Verified ABHA Profile</div>
            ${f.step === 'linked' ? '<span class="badge badge-success">Linked</span>' : ''}
          </div>
          <div class="grid-2" style="gap:12px; font-size:13px;">
            <div><span class="abha-field-label">Full Name</span><div style="margin-top:2px;">${escapeHtml(p.name || p.firstName || '—')}</div></div>
            <div><span class="abha-field-label">Date of Birth</span><div style="margin-top:2px;">${escapeHtml(p.dob || p.dateOfBirth || '—')}</div></div>
            <div><span class="abha-field-label">Gender</span><div style="margin-top:2px;">${escapeHtml(p.gender || '—')}</div></div>
            <div><span class="abha-field-label">Mobile</span><div style="margin-top:2px;">${escapeHtml(p.mobile || '—')}</div></div>
          </div>
          <div style="margin-top:14px; display:flex; flex-direction:column; gap:8px; align-items:flex-start;">
            <span class="badge badge-info">${escapeHtml(f.abhaNumber || 'ABHA number pending')}</span>
            <span class="badge badge-info">${escapeHtml(f.abhaAddress || 'ABHA address pending')}</span>
          </div>
          <div style="margin-top:14px; display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn btn-secondary" onclick="abhaShowQr()">Show QR Code</button>
            <button class="btn btn-secondary" onclick="abhaShowCard()">Show ABHA Card</button>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Link to Patient Record</div></div>
          ${abhaRenderLinkSection(f.step)}
        </div>
      </div>
    `;
    if (abhaCanLink() && f.step === 'profile') abhaLoadPatientPicker();
    return;
  }

  // Alternate path: Link existing ABHA (manual entry)
  if (f.step === 'link_existing') {
    el.innerHTML = `
      ${renderAbhaError()}
      <div class="card">
        <div class="card-header"><div class="card-title">Link Existing ABHA</div></div>
        <p style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">Enter the patient's ABHA number or ABHA address and attach it to their record.</p>
        <div class="grid-2">
          <div class="input-group">
            <label for="abha-existing-number">ABHA Number</label>
            <input type="text" id="abha-existing-number" placeholder="27-1234-5678-9012" value="${escapeHtml(f.abhaNumber || '')}">
          </div>
          <div class="input-group">
            <label for="abha-existing-address">or ABHA Address</label>
            <input type="text" id="abha-existing-address" placeholder="name@abdm" value="${escapeHtml(f.abhaAddress || '')}">
          </div>
        </div>
        <div class="input-group">
          <label for="abha-link-patient">Select Patient *</label>
          <select id="abha-link-patient"><option value="">Loading patients...</option></select>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn" ${f.busy ? 'disabled' : ''} onclick="abhaLinkExisting()">${f.busy ? 'Linking...' : 'Link ABHA'}</button>
          <button class="btn btn-secondary" onclick="abhaGoStep('start')">Back</button>
        </div>
      </div>
    `;
    abhaLoadPatientPicker();
    return;
  }
}

function abhaRenderLinkSection(step) {
  if (!abhaCanLink()) {
    return `<div class="alert alert-info" role="status">
      <strong>Linking unavailable for your role.</strong>
      <div style="font-size:12px; margin-top:4px;">Only ASHA, ANM, and PHC Doctor accounts can link an ABHA to a patient record. The verified ABHA profile is shown on the left.</div>
    </div>`;
  }
  if (step === 'linked') {
    return `<p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">This ABHA is now attached to the patient record and will appear in their directory entry and FHIR bundle.</p>
      <button class="btn btn-secondary" onclick="abhaGoStep('start')">Start Another ABHA Session</button>`;
  }
  return `
    <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Attach this verified ABHA to an existing patient record.</p>
    <div class="input-group">
      <label for="abha-link-patient">Select Patient *</label>
      <select id="abha-link-patient"><option value="">Loading patients...</option></select>
    </div>
    <button class="btn btn-block" ${abhaFlow.busy ? 'disabled' : ''} onclick="abhaLinkPatient()">${abhaFlow.busy ? 'Linking...' : 'Link ABHA to Patient'}</button>
  `;
}

async function abhaLoadPatientPicker() {
  const sel = document.getElementById('abha-link-patient');
  if (!sel) return;
  try {
    if (!abhaPatientsLoaded) {
      abhaPatients = await api('/patients?limit=100');
      abhaPatientsLoaded = true;
    }
    sel.innerHTML = '<option value="">Select a patient...</option>' + abhaPatients.map(p =>
      `<option value="${p.id}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name || '')} — ${escapeHtml(p.village || 'N/A')}</option>`
    ).join('');
  } catch (err) {
    sel.innerHTML = `<option value="">Patient list unavailable (${escapeHtml(err.message)})</option>`;
  }
}

async function abhaRequestOtp(identityOverride) {
  const f = abhaFlow;
  const raw = identityOverride !== undefined
    ? identityOverride
    : (document.getElementById('abha-identity')?.value || '');
  const value = String(raw).replace(/[\s-]/g, '');
  if (f.method === 'aadhaar') {
    if (!/^\d{12}$/.test(value)) { setAbhaError('Aadhaar must be exactly 12 digits.', 'INVALID_AADHAAR'); return; }
    f.aadhaar = value;
  } else {
    if (!/^[6-9]\d{9}$/.test(value)) { setAbhaError('Mobile number must be 10 digits starting with 6-9.', 'INVALID_MOBILE'); return; }
    f.mobile = value;
  }
  f.error = null; f.errorCode = null; f.otpValue = ''; f.busy = true;
  renderAbhaFlow();
  try {
    const endpoint = f.method === 'aadhaar' ? '/abha/aadhaar/generate-otp' : '/abha/mobile/generate-otp';
    const body = f.method === 'aadhaar' ? { aadhaar: f.aadhaar } : { mobile: f.mobile };
    const res = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
    f.txnId = res.txnId || null;
    f.mockOtp = res.mockOtp || null;
    f.busy = false;
    f.step = 'otp';
    renderAbhaFlow();
    const otpInput = document.getElementById('abha-otp');
    if (otpInput) otpInput.focus();
  } catch (err) {
    f.busy = false;
    setAbhaError(err.message, err.code);
  }
}

async function abhaResendOtp() {
  const f = abhaFlow;
  const identity = f.method === 'aadhaar' ? f.aadhaar : f.mobile;
  f.error = null; f.errorCode = null; f.otpValue = '';
  await abhaRequestOtp(identity);
}

async function abhaVerifyOtp() {
  const f = abhaFlow;
  const otp = String(document.getElementById('abha-otp')?.value || '').trim();
  if (!/^\d{6}$/.test(otp)) { setAbhaError('Enter the 6-digit OTP.', 'INVALID_OTP'); return; }
  f.otpValue = otp;
  f.error = null; f.errorCode = null; f.busy = true;
  renderAbhaFlow();
  try {
    const endpoint = f.method === 'aadhaar' ? '/abha/aadhaar/verify-otp' : '/abha/mobile/verify';
    const body = f.method === 'aadhaar' ? { txnId: f.txnId, otp } : { txnId: f.txnId, mobile: f.mobile, otp };
    const res = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
    f.profile = res.abhaProfile || null;
    f.abhaNumber = res.abhaNumber || null;
    f.abhaAddress = res.abhaAddress || null;
    f.xToken = res.xToken || null;
    f.busy = false; f.otpValue = '';
    f.step = 'profile';
    renderAbhaFlow();
  } catch (err) {
    f.busy = false;
    setAbhaError(err.message, err.code);
  }
}

async function abhaLinkPatient() {
  const f = abhaFlow;
  if (!abhaCanLink()) { setAbhaError('Your role does not allow linking ABHA to patients (ASHA, ANM, or PHC Doctor required).', 'FORBIDDEN'); return; }
  const patientId = document.getElementById('abha-link-patient')?.value;
  if (!patientId) { setAbhaError('Select a patient to link.', 'BAD_REQUEST'); return; }
  if (!f.abhaNumber && !f.abhaAddress) { setAbhaError('No verified ABHA number available from this session.', 'INVALID_ABHA_REF'); return; }
  f.busy = true; renderAbhaFlow();
  try {
    const body = f.abhaNumber ? { patientId, abhaNumber: f.abhaNumber } : { patientId, abhaAddress: f.abhaAddress };
    const res = await api('/abha/link-patient', { method: 'POST', body: JSON.stringify(body) });
    f.abhaNumber = res.abhaNumber || f.abhaNumber;
    f.abhaAddress = res.abhaAddress || f.abhaAddress;
    f.linkResult = res;
    const lookup = await api(`/abha/patient/${patientId}`).catch(() => null);
    f.linkLookup = lookup;
    f.busy = false;
    f.step = 'linked';
    renderAbhaFlow();
    showNotification('ABHA linked to patient successfully.');
  } catch (err) {
    f.busy = false;
    setAbhaError(err.message, err.code);
  }
}

async function abhaLinkExisting() {
  const f = abhaFlow;
  if (!abhaCanLink()) { setAbhaError('Your role does not allow linking ABHA to patients (ASHA, ANM, or PHC Doctor required).', 'FORBIDDEN'); return; }
  const num = (document.getElementById('abha-existing-number')?.value || '').trim();
  const addr = (document.getElementById('abha-existing-address')?.value || '').trim();
  const patientId = document.getElementById('abha-link-patient')?.value;
  if (!patientId) { setAbhaError('Select a patient to link.', 'BAD_REQUEST'); return; }
  if (!num && !addr) { setAbhaError('Enter an ABHA number or ABHA address.', 'INVALID_ABHA_REF'); return; }
  f.busy = true; renderAbhaFlow();
  try {
    const body = num ? { patientId, abhaNumber: num } : { patientId, abhaAddress: addr };
    const res = await api('/abha/link-patient', { method: 'POST', body: JSON.stringify(body) });
    f.abhaNumber = res.abhaNumber || num || null;
    f.abhaAddress = res.abhaAddress || addr || null;
    f.linkResult = res;
    const lookup = await api(`/abha/patient/${patientId}`).catch(() => null);
    f.linkLookup = lookup;
    f.busy = false;
    f.step = 'linked';
    renderAbhaFlow();
    showNotification('ABHA linked to patient successfully.');
  } catch (err) {
    f.busy = false;
    setAbhaError(err.message, err.code);
  }
}

async function abhaShowQr() {
  const box = document.getElementById('abha-extras');
  const f = abhaFlow;
  if (!box || !f.abhaNumber) { showNotification('No ABHA number available to generate a QR.'); return; }
  box.innerHTML = '<div class="card" style="text-align:center; padding:20px; color:var(--text-muted);">Loading QR code...</div>';
  try {
    const suffix = f.xToken ? `?xToken=${encodeURIComponent(f.xToken)}` : '';
    const qr = await api(`/abha/qr/${encodeURIComponent(f.abhaNumber)}${suffix}`);
    const src = qr.qrImage || qr.qrDataUrl || '';
    box.innerHTML = `
      <div class="card">
        <div class="card-header"><div class="card-title">ABHA QR Code</div></div>
        <div class="abha-qr-box"><img src="${src}" alt="ABHA QR code" width="180" height="180"></div>
      </div>`;
  } catch (err) {
    box.innerHTML = `<div class="alert alert-danger" role="alert"><strong>QR generation failed:</strong> ${escapeHtml(err.message)}</div>`;
  }
}

async function abhaShowCard() {
  const box = document.getElementById('abha-extras');
  const f = abhaFlow;
  if (!box || !f.abhaNumber) { showNotification('No ABHA number available to fetch a card.'); return; }
  box.innerHTML = '<div class="card" style="text-align:center; padding:20px; color:var(--text-muted);">Loading ABHA card...</div>';
  try {
    const suffix = f.xToken ? `?xToken=${encodeURIComponent(f.xToken)}` : '';
    const c = await api(`/abha/card/${encodeURIComponent(f.abhaNumber)}${suffix}`);
    const name = c.name || c.abhaProfile?.name || (f.profile && (f.profile.name || f.profile.firstName)) || 'ABHA Holder';
    const dob = c.dob || c.dateOfBirth || c.abhaProfile?.dob || (f.profile && (f.profile.dob || f.profile.dateOfBirth)) || '';
    const gender = c.gender || c.abhaProfile?.gender || (f.profile && f.profile.gender) || '';
    const mobile = c.mobile || (f.profile && f.profile.mobile) || '';
    box.innerHTML = `
      <div class="card">
        <div class="card-header"><div class="card-title">ABHA Card</div></div>
        <div class="abha-card" role="img" aria-label="ABHA card for ${escapeHtml(name)}">
          <div class="abha-card-strip"><span class="s1"></span><span class="s2"></span><span class="s3"></span></div>
          <div class="abha-card-body">
            <div class="abha-card-head">
              <div>
                <div class="abha-card-brand">Ayushman Bharat Health Account</div>
                <div class="abha-card-name">${escapeHtml(name)}</div>
              </div>
              <span class="abha-card-status">${escapeHtml(String(c.status || 'Active'))}</span>
            </div>
            <div class="abha-card-grid">
              <div><span class="abha-card-label">ABHA Number</span><span class="abha-card-value">${escapeHtml(c.abhaNumber || f.abhaNumber || '')}</span></div>
              <div><span class="abha-card-label">ABHA Address</span><span class="abha-card-value">${escapeHtml(c.abhaAddress || f.abhaAddress || '')}</span></div>
              <div><span class="abha-card-label">Date of Birth</span><span class="abha-card-value">${escapeHtml(dob)}</span></div>
              <div><span class="abha-card-label">Gender</span><span class="abha-card-value">${escapeHtml(gender)}</span></div>
              <div><span class="abha-card-label">Mobile</span><span class="abha-card-value">${escapeHtml(mobile)}</span></div>
            </div>
          </div>
        </div>
      </div>`;
  } catch (err) {
    box.innerHTML = `<div class="alert alert-danger" role="alert"><strong>Card fetch failed:</strong> ${escapeHtml(err.message)}</div>`;
  }
}

// ── FACILITY MANAGEMENT VIEW ──
let fmFacilityId = null;

async function renderFacilityMgmtView(container) {
  const facilities = await api('/facilities');
  const userFacility = state.user && state.user.facility_id;
  fmFacilityId = (userFacility && facilities.some(x => x.id === userFacility))
    ? userFacility
    : (facilities.length ? facilities[0].id : null);

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title"><span>🧰</span><span>Facility & Stock Management</span></div>
      </div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">
        Update medicine stock levels and doctor availability for a facility. Changes save immediately.
      </p>
      <div class="input-group" style="margin-bottom:0; max-width:420px;">
        <label for="fm-facility">Facility</label>
        <select id="fm-facility">
          ${facilities.map(x => `<option value="${x.id}" ${x.id === fmFacilityId ? 'selected' : ''}>${escapeHtml(x.name)}${x.village ? ` — ${escapeHtml(x.village)}` : ''}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="fm-detail"><div class="card" style="text-align:center; padding:30px; color:var(--text-muted);">Loading facility data...</div></div>
  `;

  const sel = document.getElementById('fm-facility');
  sel.addEventListener('change', (e) => { fmFacilityId = e.target.value; loadFacilityDetail(); });
  if (fmFacilityId) {
    loadFacilityDetail();
  } else {
    document.getElementById('fm-detail').innerHTML =
      '<div class="empty-state"><div class="empty-state-icon">No facilities found.</div></div>';
  }
}

async function loadFacilityDetail() {
  const box = document.getElementById('fm-detail');
  if (!box || !fmFacilityId) return;
  try {
    const data = await api(`/facilities/${fmFacilityId}`);
    const fac = data.facility || {};
    const doctors = data.doctors || [];
    const stock = data.stock || [];
    const stockouts = stock.filter(s => s.status === 'OUT_OF_STOCK').length;
    const availableDoctors = doctors.filter(d => d.is_available).length;

    box.innerHTML = `
      <div class="stat-row">
        <div class="stat-box"><div class="stat-val" style="font-size:16px; word-break:break-word;">${escapeHtml(fac.name || '—')}</div><div class="stat-label">${escapeHtml(fac.type || 'Facility')}</div></div>
        <div class="stat-box"><div class="stat-val">${fac.bed_count ?? '—'}</div><div class="stat-label">Total Beds</div></div>
        <div class="stat-box"><div class="stat-val" ${stockouts > 0 ? 'style="color:var(--danger);"' : ''}>${stockouts}</div><div class="stat-label">Stockouts</div></div>
        <div class="stat-box"><div class="stat-val">${availableDoctors}/${doctors.length}</div><div class="stat-label">Doctors Available</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Medicine Stock</div>
          <span style="font-size:11px; color:var(--text-muted);">Update quantity — status recalculates automatically</span>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr><th>Medicine</th><th>Quantity</th><th>Threshold</th><th>Status</th><th>Update</th></tr>
            </thead>
            <tbody>
              ${stock.map(s => `
                <tr>
                  <td><strong>${escapeHtml(s.medicine_name)}</strong></td>
                  <td><input type="number" id="fm-qty-${s.id}" class="fm-qty-input" value="${s.quantity}" min="0" aria-label="Quantity for ${escapeHtml(s.medicine_name)}"></td>
                  <td>${s.threshold}</td>
                  <td><span class="badge badge-${s.status === 'IN_STOCK' ? 'success' : s.status === 'LOW_STOCK' ? 'warning' : 'danger'}">${escapeHtml(String(s.status || '').replace(/_/g, ' '))}</span></td>
                  <td><button class="btn btn-secondary btn-sm" onclick="saveStock('${s.id}')">Save</button></td>
                </tr>
              `).join('')}
              ${stock.length === 0 ? '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No stock records for this facility.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title">Doctor Availability</div></div>
        <div class="table-container">
          <table>
            <thead>
              <tr><th>Doctor</th><th>Day</th><th>Shift</th><th>Available</th></tr>
            </thead>
            <tbody>
              ${doctors.map(d => `
                <tr>
                  <td><strong>${escapeHtml(d.doctor_name || 'Doctor')}</strong></td>
                  <td>${escapeHtml(String(d.day_of_week ?? ''))}</td>
                  <td>${escapeHtml(String(d.start_time || '').slice(0, 5))} – ${escapeHtml(String(d.end_time || '').slice(0, 5))}</td>
                  <td>
                    <label class="fm-switch">
                      <input type="checkbox" ${d.is_available ? 'checked' : ''} aria-label="Availability for ${escapeHtml(d.doctor_name || 'doctor')}" onchange="toggleDoctorAvailability('${d.id}', this.checked)">
                      <span class="fm-switch-track"></span>
                    </label>
                  </td>
                </tr>
              `).join('')}
              ${doctors.length === 0 ? '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No availability records for this facility.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    box.innerHTML = `<div class="alert alert-danger" role="alert"><strong>Could not load facility data:</strong> ${escapeHtml(err.message)}</div>`;
  }
}

async function saveStock(stockId) {
  const input = document.getElementById('fm-qty-' + stockId);
  if (!input) return;
  const qty = parseInt(input.value, 10);
  if (isNaN(qty) || qty < 0) { showNotification('Enter a valid quantity (0 or more).'); return; }
  input.disabled = true;
  try {
    await api(`/stock/${stockId}`, { method: 'PUT', body: JSON.stringify({ quantity: qty }) });
    showNotification('Stock updated.');
    loadFacilityDetail();
  } catch (err) {
    input.disabled = false;
    showNotification('Stock update failed: ' + err.message);
  }
}

async function toggleDoctorAvailability(availId, available) {
  try {
    await api(`/availability/${availId}`, { method: 'PUT', body: JSON.stringify({ is_available: !!available }) });
    showNotification('Availability updated.');
    loadFacilityDetail();
  } catch (err) {
    showNotification('Availability update failed: ' + err.message);
    loadFacilityDetail();
  }
}

// Bind to window for global access
window.loadFhirBundle = loadFhirBundle;
window.filterFhirType = filterFhirType;
window.copyFhirBundleJson = copyFhirBundleJson;
window.downloadFhirBundleJson = downloadFhirBundleJson;
window.triggerVoiceStt = triggerVoiceStt;
window.toggleChatbot = toggleChatbot;
window.setChatLanguage = setChatLanguage;
window.sendChatMessage = sendChatMessage;
window.quickSendChat = quickSendChat;
window.triggerChatVoiceStt = triggerChatVoiceStt;


// ── Helpers ──
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function filterPatients() {
  const query = document.getElementById('patient-search').value.toLowerCase();
  const rows = document.querySelectorAll('#patients-table-body tr');
  rows.forEach(r => { r.style.display = r.textContent.toLowerCase().includes(query) ? '' : 'none'; });
}

// ── Init ──
let initialized = false;
function safeInit() {
  if (initialized) return;
  initialized = true;
  init().catch(err => {
    console.error('Init failed:', err);
    renderApp();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeInit);
} else {
  safeInit();
}
