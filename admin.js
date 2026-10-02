/* ==========================================================================
   Neuer Blick Verein e.V. - Admin Login & Content Studio
   Talks to server.js (/api/...). Depends on site-data.js for the defaults:
   translations, defaultGalleryItems, DEFAULT_EVENT, DEFAULT_STATS,
   DEFAULT_CONTACT, DEFAULT_SOCIAL, DEFAULT_IMAGES.
   ========================================================================== */

const TOKEN_KEY = 'nbStudioToken';
const THEME_KEY = 'newerBlickAdminTheme';
const LEGACY_KEYS = ['newerBlickTranslationOverrides', 'newerBlickTranslations', 'newerBlickMessages', 'newerBlickCalloutImage', 'newerBlickGallery', 'newerBlickEvent', 'newerBlickStats', 'newerBlickSubmissions', 'newerBlickSubscribers'];

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// ==========================================================================
// Helpers
// ==========================================================================
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const pad2 = (n) => String(n).padStart(2, '0');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stripTags(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
}

function initialsOf(name) {
  const parts = String(name || '?').trim().split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

function relativeTime(iso) {
  if (!iso) return 'never';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(diff)) return '';
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const formatSize = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function zoneParts(timeZone, date = new Date()) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).forEach((p) => { if (p.type !== 'literal') parts[p.type] = parseInt(p.value, 10); });
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

function zoneTime(timeZone) {
  try {
    const p = zoneParts(timeZone);
    return `${pad2(p.hour)}:${pad2(p.minute)}`;
  } catch (e) {
    return '--:--';
  }
}

function fromBerlinWallTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  try {
    const p = zoneParts('Europe/Berlin', new Date(guess));
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess;
    return new Date(guess - offset);
  } catch (e) {
    return new Date(guess - 3600000);
  }
}

function countUp(el, target, duration = 900) {
  if (!el) return;
  const value = Number(target) || 0;
  if (reducedMotion) {
    el.textContent = value;
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    el.textContent = Math.round((1 - Math.pow(1 - t, 3)) * value);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function optimizeImage(file, maxDimension = 2200) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('That file could not be read as an image.'));
      image.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function downloadFile(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch (err) { /* ignore */ }
    area.remove();
  }
}

// ==========================================================================
// API
// ==========================================================================
let token = null;
try { token = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY); } catch (e) { /* ignore */ }

function saveToken(value, remember) {
  token = value;
  try {
    sessionStorage.setItem(TOKEN_KEY, value);
    if (remember) localStorage.setItem(TOKEN_KEY, value);
  } catch (e) { /* ignore */ }
}

function clearToken() {
  token = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* ignore */ }
}

const SERVER_HINT = 'The studio server is not running. In the website folder run "npm start", then open http://localhost:3000/admin.html';

async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (e) {
    throw Object.assign(new Error(SERVER_HINT), { offline: true });
  }
  let data = null;
  try { data = await response.json(); } catch (e) { /* empty body */ }
  if (response.status === 401 && path !== 'login' && !app.hidden) sessionExpired();
  if (!response.ok) {
    const err = new Error(data?.error || (response.status === 404 && !data ? SERVER_HINT : `Request failed (${response.status})`));
    Object.assign(err, { status: response.status, data });
    throw err;
  }
  return data;
}

async function uploadImage(file, maxDimension) {
  const data = await optimizeImage(file, maxDimension);
  const result = await api('upload', { method: 'POST', body: { filename: file.name, data } });
  return result.path;
}

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('newer-blick-site') : null;

// Site content cache (mirrors data/content.json on the server)
let content = {};
let me = null;
let mailReady = false;

async function saveContent(section, value, button) {
  try {
    content = await api('content', { method: 'PUT', body: { [section]: value } });
    channel?.postMessage({ type: 'content-updated' });
    updateLastSaved();
    flashSaved(button);
    return true;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
}

function updateLastSaved() {
  const el = $('#lastSaved');
  if (el) el.textContent = content.updatedAt ? relativeTime(content.updatedAt) : '–';
}

// ==========================================================================
// Toasts & Dialogs
// ==========================================================================
const toastStack = $('#toastStack');

function toast(message, type = 'success') {
  if (!toastStack) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon"><svg class="ico"><use href="#${type === 'error' ? 'i-x' : 'i-check'}"/></svg></span><span></span>`;
  el.lastElementChild.textContent = message;
  toastStack.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  }, type === 'error' ? 6000 : 3600);
}

const confirmDialog = $('#confirmDialog');
function confirmAction(title, text, yesLabel = 'Confirm') {
  return new Promise((resolve) => {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmYes').textContent = yesLabel;
    confirmDialog.hidden = false;
    setTimeout(() => $('#confirmYes').focus(), 50);

    const close = (answer) => {
      confirmDialog.hidden = true;
      confirmDialog.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      resolve(answer);
    };
    const onClick = (e) => {
      const choice = e.target.closest('[data-confirm]')?.dataset.confirm;
      if (choice) close(choice === 'yes');
    };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    confirmDialog.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
  });
}

function flashSaved(button) {
  if (!button) return;
  button.classList.add('saved');
  setTimeout(() => button.classList.remove('saved'), 1400);
}

// Image picker: choose a file already in the images folder
const pickerDialog = $('#pickerDialog');
async function pickFromLibrary() {
  let files = [];
  try {
    files = await api('images');
  } catch (e) {
    toast(e.message, 'error');
    return null;
  }
  $('#pickerGrid').innerHTML = files.length
    ? files.map((f) => `<button class="pick" type="button" data-path="${escapeHtml(f.path)}"><img src="${escapeHtml(f.path)}" alt="" loading="lazy" /><span>${escapeHtml(f.name)}</span></button>`).join('')
    : emptyState('i-image', 'The folder is empty', 'Upload images first.');
  pickerDialog.hidden = false;
  return new Promise((resolve) => {
    const close = (value) => {
      pickerDialog.hidden = true;
      pickerDialog.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onClick = (e) => {
      if (e.target.closest('[data-close-picker]')) return close(null);
      const pick = e.target.closest('.pick');
      if (pick) close(pick.dataset.path);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    pickerDialog.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
  });
}

// ==========================================================================
// Theme & Clocks
// ==========================================================================
let savedTheme = null;
try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.body.classList.add('dark');
}

function toggleTheme() {
  const dark = document.body.classList.toggle('dark');
  try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
}

$('#themeToggle')?.addEventListener('click', toggleTheme);

function updateClocks() {
  const munster = zoneTime('Europe/Berlin');
  const kabul = zoneTime('Asia/Kabul');
  ['#loginClockMunster', '#topClockMunster'].forEach((id) => { const el = $(id); if (el) el.textContent = munster; });
  ['#loginClockKabul', '#topClockKabul'].forEach((id) => { const el = $(id); if (el) el.textContent = kabul; });
  if (activeView === 'event') tickEventPreview();
}

function timeOfDayGreeting() {
  let hour = new Date().getHours();
  try { hour = zoneParts('Europe/Berlin').hour; } catch (e) { /* local */ }
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// ==========================================================================
// LOGIN
// ==========================================================================
const loginStage = $('#loginStage');
const loginCard = $('#loginCard');
const loginForm = $('#loginForm');
const usernameInput = $('#username');
const passwordInput = $('#password');
const loginSubmit = $('#loginSubmit');
const loginError = $('#loginError');
const loginErrorText = $('#loginErrorText');
const app = $('#app');

$('#timeGreeting').textContent = timeOfDayGreeting();

loginCard?.addEventListener('animationend', (e) => {
  if (e.target === loginCard) loginCard.classList.add('ready');
});

const greetings = [
  { text: 'سلام', lang: 'fa' },
  { text: 'Willkommen', lang: 'de' },
  { text: 'Welcome', lang: 'en' },
  { text: 'په خیر راغلاست', lang: 'ps' },
  { text: 'خوش آمدید', lang: 'fa' }
];
let greetIndex = 0;
const greetWord = $('#greetWord');
let greetTimer = null;
if (greetWord && !reducedMotion) {
  greetTimer = setInterval(() => {
    greetWord.classList.remove('in');
    greetWord.classList.add('out');
    setTimeout(() => {
      greetIndex = (greetIndex + 1) % greetings.length;
      greetWord.textContent = greetings[greetIndex].text;
      greetWord.lang = greetings[greetIndex].lang;
      greetWord.dir = ['fa', 'ps'].includes(greetings[greetIndex].lang) ? 'rtl' : 'ltr';
      greetWord.classList.remove('out');
      greetWord.classList.add('in');
    }, 380);
  }, 2600);
}

(function spawnLoginParticles() {
  const host = $('#loginParticles');
  if (!host || reducedMotion) return;
  for (let i = 0; i < 26; i += 1) {
    const p = document.createElement('span');
    const dur = 12 + Math.random() * 16;
    p.style.setProperty('--x', `${Math.random() * 100}%`);
    p.style.setProperty('--size', `${2 + Math.random() * 5}px`);
    p.style.setProperty('--dur', `${dur}s`);
    p.style.setProperty('--delay', `${-Math.random() * dur}s`);
    p.style.setProperty('--drift', `${(Math.random() - 0.5) * 140}px`);
    host.appendChild(p);
  }
})();

if (loginStage && loginCard && finePointer && !reducedMotion) {
  loginStage.addEventListener('pointermove', (e) => {
    if (!loginCard.classList.contains('ready') || loginStage.classList.contains('leaving')) return;
    const x = e.clientX / window.innerWidth - 0.5;
    const y = e.clientY / window.innerHeight - 0.5;
    loginCard.style.transform = `perspective(1400px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg)`;
  });
  loginStage.addEventListener('pointerleave', () => { loginCard.style.transform = ''; });
}

const revealBtn = $('#revealPassword');
revealBtn?.addEventListener('click', () => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  revealBtn.setAttribute('aria-pressed', String(show));
  revealBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  passwordInput.focus();
});

const capsWarning = $('#capsWarning');
['keydown', 'keyup'].forEach((type) => {
  passwordInput?.addEventListener(type, (e) => {
    if (typeof e.getModifierState === 'function') capsWarning.hidden = !e.getModifierState('CapsLock');
  });
});
passwordInput?.addEventListener('blur', () => { capsWarning.hidden = true; });

$('#forgotBtn')?.addEventListener('click', () => {
  const note = $('#forgotNote');
  note.hidden = !note.hidden;
});

[usernameInput, passwordInput].forEach((input) => {
  input?.addEventListener('input', () => {
    input.closest('.field').classList.remove('invalid');
    loginError.hidden = true;
  });
});

let lockTimer = null;
function lockLogin(seconds) {
  const label = $('.submit-label', loginSubmit);
  const until = Date.now() + seconds * 1000;
  loginSubmit.disabled = true;
  clearInterval(lockTimer);
  const tick = () => {
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(lockTimer);
      loginSubmit.disabled = false;
      label.textContent = 'Enter Content Studio';
      loginError.hidden = true;
      return;
    }
    label.textContent = `Try again in ${left}s`;
  };
  tick();
  lockTimer = setInterval(tick, 1000);
}

function shakeCard() {
  loginCard.classList.remove('shake');
  void loginCard.offsetWidth;
  loginCard.classList.add('shake');
}

function showLoginError(text) {
  loginErrorText.textContent = text;
  loginError.hidden = false;
  shakeCard();
}

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (loginSubmit.disabled) return;

  const user = usernameInput.value.trim();
  const pass = passwordInput.value;
  let missing = false;
  [[usernameInput, user], [passwordInput, pass]].forEach(([input, value]) => {
    if (!value) {
      input.closest('.field').classList.add('invalid');
      missing = true;
    }
  });
  if (missing) {
    showLoginError('Please enter your username and password.');
    (user ? passwordInput : usernameInput).focus();
    return;
  }

  loginSubmit.classList.add('loading');
  loginSubmit.disabled = true;
  const remember = $('#rememberMe').checked;

  try {
    const [result] = await Promise.all([
      api('login', { method: 'POST', body: { username: user, password: pass, remember } }),
      new Promise((r) => setTimeout(r, reducedMotion ? 0 : 700))
    ]);
    saveToken(result.token, remember);
    me = result.user;
    loginSubmit.classList.remove('loading');
    loginSubmit.classList.add('success');
    $('.submit-label', loginSubmit).textContent = 'Welcome!';
    setTimeout(() => {
      loginStage.classList.add('leaving');
      setTimeout(() => enterStudio(true), reducedMotion ? 0 : 650);
    }, reducedMotion ? 0 : 550);
  } catch (err) {
    loginSubmit.classList.remove('loading');
    loginSubmit.disabled = false;
    passwordInput.value = '';
    passwordInput.dispatchEvent(new Event('input'));
    if (err.status === 429) {
      showLoginError(`Too many attempts. Please wait ${err.data?.retryIn || 30} seconds.`);
      lockLogin(err.data?.retryIn || 30);
      return;
    }
    if (err.status === 401) {
      const left = err.data?.attemptsLeft;
      showLoginError(`Incorrect username or password.${left ? ` ${left} attempt${left === 1 ? '' : 's'} left.` : ''}`);
      passwordInput.closest('.field').classList.add('invalid');
      passwordInput.focus();
      return;
    }
    showLoginError(err.message);
  }
});

function sessionExpired() {
  clearToken();
  dirtyViews.clear();
  toast('Your session ended. Please sign in again.', 'error');
  setTimeout(() => location.reload(), 1200);
}

// ==========================================================================
// STUDIO: Navigation
// ==========================================================================
const VIEWS = {
  overview: { title: 'Overview', icon: 'i-home', render: renderOverview },
  inbox: { title: 'Inbox', icon: 'i-inbox', render: renderInbox },
  translations: { title: 'Texts & translations', icon: 'i-globe', render: renderTranslations, save: saveTranslations },
  announcements: { title: 'Announcements', icon: 'i-megaphone', render: renderAnnouncements, save: saveMessages },
  event: { title: 'Upcoming event', icon: 'i-calendar', render: renderEventView, save: saveEvent },
  contact: { title: 'Contact & social', icon: 'i-phone', render: renderContact, save: saveContact },
  media: { title: 'Website images', icon: 'i-image', render: renderImages, save: saveImages },
  gallery: { title: 'Photo gallery', icon: 'i-grid', render: renderGalleryEditor, save: saveGallery },
  users: { title: 'Users', icon: 'i-users', render: renderUsers },
  settings: { title: 'Settings & backup', icon: 'i-settings', render: renderSettings, save: saveStats }
};

let activeView = 'overview';
const dirtyViews = new Set();

function setDirty(view, dirty = true) {
  if (dirty) dirtyViews.add(view);
  else dirtyViews.delete(view);
  $(`.nav-item[data-view="${view}"]`)?.classList.toggle('dirty', dirty);
  const stateEl = { translations: $('#transState'), gallery: $('#galleryState'), media: $('#imagesState') }[view];
  if (stateEl) {
    stateEl.textContent = dirty ? 'Unsaved changes' : 'No unsaved changes';
    stateEl.classList.toggle('dirty', dirty);
  }
}

function go(view, options = {}) {
  if (!VIEWS[view]) view = 'overview';
  activeView = view;
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  $$('.view').forEach((section) => section.classList.toggle('active', section.dataset.view === view));
  $('#viewTitle').textContent = VIEWS[view].title;
  $('#crumbName').textContent = VIEWS[view].title;
  document.title = `${VIEWS[view].title} · Neuer Blick Studio`;
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  closeSidebar();
  if (!dirtyViews.has(view) || options.force) VIEWS[view].render(options);
  window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
}

$$('.nav-item').forEach((item) => item.addEventListener('click', () => go(item.dataset.view)));

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-goto]');
  if (!target) return;
  e.preventDefault();
  go(target.dataset.goto, { filter: target.dataset.filter, search: target.dataset.search });
});

const sidebar = $('#sidebar');
function closeSidebar() { sidebar?.classList.remove('open'); }
$('#sidebarToggle')?.addEventListener('click', () => sidebar.classList.toggle('open'));
$('#sidebarScrim')?.addEventListener('click', closeSidebar);

let pollTimer = null;
async function enterStudio(animated = false) {
  clearInterval(greetTimer);
  try {
    const [session, siteContent] = await Promise.all([api('me'), api('content')]);
    me = session.user;
    mailReady = session.mailReady;
    content = siteContent || {};
  } catch (e) {
    if (e.status === 401) {
      clearToken();
      setTimeout(() => usernameInput?.focus(), 300);
      return;
    }
    showLoginError(e.message);
    return;
  }
  loginStage.hidden = true;
  app.hidden = false;
  if (!animated) app.style.animation = 'none';

  $('#meName').textContent = me.username;
  $('#avatar').textContent = initialsOf(me.username);
  $('#avatar').title = `Signed in as ${me.username}`;
  $('#welcomeName').textContent = me.username;
  updateLastSaved();

  const hashView = location.hash.slice(1);
  go(VIEWS[hashView] ? hashView : 'overview');
  refreshInbox();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => refreshInbox(true), 30000);
  if (animated) toast(`${timeOfDayGreeting()}, ${me.username}!`);
}

$('#logoutButton')?.addEventListener('click', async () => {
  if (dirtyViews.size) {
    const ok = await confirmAction('Log out with unsaved changes?', 'Changes you have not saved will be lost.', 'Log out');
    if (!ok) return;
  }
  try { await api('logout', { method: 'POST' }); } catch (e) { /* already signed out */ }
  clearToken();
  dirtyViews.clear();
  history.replaceState(null, '', location.pathname);
  location.reload();
});

window.addEventListener('beforeunload', (e) => {
  if (!app.hidden && dirtyViews.size) {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('keydown', (e) => {
  if (app.hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    VIEWS[activeView].save?.();
  } else if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
  }
});

// Inputs marked data-dirty="<view>" flag their view as unsaved
document.addEventListener('input', (e) => {
  const view = e.target.closest('[data-dirty]')?.dataset.dirty;
  if (view) setDirty(view, true);
});

// ==========================================================================
// Inbox data
// ==========================================================================
const TYPES = {
  membership: { label: 'Membership', tone: '#e27d1d' },
  event: { label: 'Event RSVP', tone: '#c23824' },
  job: { label: 'Jobs', tone: '#0b6352' },
  study: { label: 'Study', tone: '#1a5173' },
  volunteer: { label: 'Volunteer', tone: '#b8860b' },
  general: { label: 'General', tone: '#64736c' },
  newsletter: { label: 'Newsletter', tone: '#15856e' }
};
const LANG_FLAGS = { fa: '🇦🇫 FA', de: '🇩🇪 DE', en: '🇬🇧 EN' };

let submissions = [];
let subscribers = [];

function syncBadge() {
  const unread = submissions.filter((s) => !s.read).length;
  $('#inboxBadge').hidden = unread === 0;
  $('#inboxBadge').textContent = unread;
}

async function refreshInbox(silent = false) {
  try {
    const before = submissions.filter((s) => !s.read).length;
    const known = new Set(submissions.map((s) => s.id));
    [submissions, subscribers] = await Promise.all([api('submissions'), api('subscribers')]);
    const unread = submissions.filter((s) => !s.read).length;
    const fresh = submissions.find((s) => !known.has(s.id) && !s.read);
    if (silent && fresh && unread > before) toast(`New request from ${fresh.name || 'a visitor'}`);
    syncBadge();
    if (activeView === 'overview') renderOverview();
    if (activeView === 'inbox') renderInbox();
  } catch (e) {
    if (!silent) toast(e.message, 'error');
  }
}

// ==========================================================================
// VIEW: Overview
// ==========================================================================
const getEvent = () => ({ ...DEFAULT_EVENT, ...(content.event || {}) });
const getStats = () => ({ ...DEFAULT_STATS, ...(content.stats || {}) });
const getContact = () => ({ ...DEFAULT_CONTACT, ...(content.contact || {}) });
const getSocial = () => ({ ...DEFAULT_SOCIAL, ...(content.social || {}) });
const getImages = () => ({ ...DEFAULT_IMAGES, ...(content.images || {}) });

function getGallery() {
  const list = Array.isArray(content.gallery) && content.gallery.length ? content.gallery : defaultGalleryItems;
  return list.map((item) => ({ url: item.url || '', title: item.title || '', titleDe: item.titleDe || '', titleEn: item.titleEn || '' }));
}

function emptyState(icon, title, text) {
  return `<div class="empty"><span class="empty-icon"><svg class="ico"><use href="#${icon}"/></svg></span><strong>${title}</strong><span>${text}</span></div>`;
}

function renderOverview() {
  const unread = submissions.filter((s) => !s.read).length;

  $('#welcomeGreeting').textContent = timeOfDayGreeting();
  $('#welcomeDate').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  countUp($('#kpiNew'), unread);
  $('#kpiNewSub').textContent = `${submissions.length} total`;
  countUp($('#kpiSubs'), subscribers.length);
  countUp($('#kpiPhotos'), getGallery().length);

  const start = fromBerlinWallTime(getEvent().date);
  const days = start ? Math.ceil((start - Date.now()) / 86400000) : null;
  if (days !== null && days >= 0) {
    countUp($('#kpiEvent'), days);
    $('#kpiEventSub').textContent = days === 1 ? 'day to go' : 'days to go';
  } else {
    $('#kpiEvent').textContent = '–';
    $('#kpiEventSub').textContent = 'set a new date';
  }

  const recent = $('#recentList');
  if (!submissions.length) {
    recent.innerHTML = emptyState('i-inbox', 'No requests yet', 'Membership, event and contact forms on the website land here.');
  } else {
    recent.innerHTML = submissions.slice(0, 5).map((s) => {
      const type = TYPES[s.type] || TYPES.general;
      return `
        <button class="recent-item" data-goto="inbox" data-filter="${escapeHtml(s.type)}">
          <span class="initials" style="--tone:${type.tone}">${escapeHtml(initialsOf(s.name))}</span>
          <span class="who">
            <strong>${escapeHtml(s.name || 'Unnamed')}${s.read ? '' : ' •'}</strong>
            <small>${escapeHtml(s.email)} · ${relativeTime(s.date)}</small>
          </span>
          <span class="type-pill" style="--tone:${type.tone}">${type.label}</span>
        </button>`;
    }).join('');
  }

  const counts = {};
  submissions.forEach((s) => { counts[s.type] = (counts[s.type] || 0) + 1; });
  counts.newsletter = subscribers.length;
  const max = Math.max(1, ...Object.values(counts));
  $('#typeBars').innerHTML = Object.entries(TYPES).map(([key, meta]) => `
    <div class="type-bar">
      <span>${meta.label}</span>
      <span class="track"><i class="fill" style="--tone:${meta.tone}" data-w="${((counts[key] || 0) / max) * 100}"></i></span>
      <b>${counts[key] || 0}</b>
    </div>`).join('');
  requestAnimationFrame(() => {
    $$('#typeBars .fill').forEach((bar) => { bar.style.width = `${bar.dataset.w}%`; });
  });
}

// ==========================================================================
// VIEW: Inbox
// ==========================================================================
let inboxFilter = 'all';
let inboxQuery = '';

function inboxItems() {
  const items = submissions.map((s) => ({ ...s, kind: 'submission' }));
  subscribers.forEach((sub) => items.push({
    id: `sub:${sub.email}`, kind: 'subscriber', type: 'newsletter', name: sub.email.split('@')[0],
    email: sub.email, phone: '', notes: '', lang: sub.lang, date: sub.date, read: true
  }));
  return items.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function filteredInbox() {
  const q = inboxQuery.toLowerCase();
  return inboxItems().filter((item) => (inboxFilter === 'all' || item.type === inboxFilter)
    && (!q || [item.name, item.email, item.phone, item.notes].some((v) => String(v || '').toLowerCase().includes(q))));
}

function renderInbox(options = {}) {
  if (options.filter) inboxFilter = options.filter;
  const all = inboxItems();
  $$('#inboxFilters .chip').forEach((chip) => {
    const f = chip.dataset.filter;
    const count = f === 'all' ? all.length : all.filter((i) => i.type === f).length;
    chip.classList.toggle('active', f === inboxFilter);
    chip.innerHTML = `${chip.dataset.label || (chip.dataset.label = chip.textContent)}<span class="count">${count}</span>`;
  });

  const list = $('#inboxList');
  const items = filteredInbox();
  if (!items.length) {
    list.innerHTML = `<div class="panel">${all.length
      ? emptyState('i-search', 'Nothing matches', 'Try another filter or search term.')
      : emptyState('i-inbox', 'Your inbox is empty', 'When visitors send the membership, event or contact forms on the website, their requests appear here.')}</div>`;
    return;
  }

  list.innerHTML = items.map((item, i) => {
    const type = TYPES[item.type] || TYPES.general;
    const subject = encodeURIComponent(`Neuer Blick Verein · ${type.label}`);
    return `
      <article class="msg ${item.read ? '' : 'unread'}" data-id="${escapeHtml(item.id)}" style="animation-delay:${Math.min(i, 10) * 40}ms">
        <span class="initials" style="--tone:${type.tone}">${escapeHtml(initialsOf(item.name))}</span>
        <div class="msg-main">
          <div class="msg-top">
            <strong>${escapeHtml(item.name || 'Unnamed')}</strong>
            <span class="type-pill" style="--tone:${type.tone}">${type.label}</span>
            ${item.read ? '' : '<span class="msg-new">NEW</span>'}
          </div>
          <div class="msg-meta">
            <a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>
            ${item.phone ? `<a href="tel:${escapeHtml(item.phone.replace(/\s+/g, ''))}">${escapeHtml(item.phone)}</a>` : ''}
            <span>${LANG_FLAGS[item.lang] || ''}</span>
            <span title="${escapeHtml(new Date(item.date).toLocaleString('en-GB'))}">${relativeTime(item.date)}</span>
          </div>
          ${item.notes ? `<p class="msg-notes">${escapeHtml(item.notes)}</p>` : ''}
        </div>
        <div class="msg-actions">
          ${item.kind === 'submission' ? `<button class="mini-btn" data-act="toggle" title="${item.read ? 'Mark as unread' : 'Mark as read'}" aria-label="${item.read ? 'Mark as unread' : 'Mark as read'}"><svg class="ico"><use href="#i-check"/></svg></button>` : ''}
          <a class="mini-btn" href="mailto:${escapeHtml(item.email)}?subject=${subject}" title="Reply by email" aria-label="Reply by email"><svg class="ico"><use href="#i-mail"/></svg></a>
          <button class="mini-btn danger" data-act="delete" title="Delete" aria-label="Delete"><svg class="ico"><use href="#i-trash"/></svg></button>
        </div>
      </article>`;
  }).join('');
}

$('#inboxFilters')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  inboxFilter = chip.dataset.filter;
  renderInbox();
});

$('#inboxSearch')?.addEventListener('input', (e) => {
  inboxQuery = e.target.value.trim();
  renderInbox();
});

$('#inboxList')?.addEventListener('click', async (e) => {
  const card = e.target.closest('.msg');
  if (!card) return;
  const id = card.dataset.id;
  const action = e.target.closest('[data-act]')?.dataset.act;

  try {
    if (action === 'delete') {
      const ok = await confirmAction('Delete this entry?', 'It will be removed from the inbox permanently.', 'Delete');
      if (!ok) return;
      card.classList.add('removing');
      if (id.startsWith('sub:')) {
        const email = id.slice(4);
        await api(`subscribers/${encodeURIComponent(email)}`, { method: 'DELETE' });
        subscribers = subscribers.filter((s) => s.email !== email);
      } else {
        await api(`submissions/${encodeURIComponent(id)}`, { method: 'DELETE' });
        submissions = submissions.filter((s) => s.id !== id);
      }
      syncBadge();
      setTimeout(renderInbox, 250);
      toast('Entry deleted.');
      return;
    }

    if (id.startsWith('sub:') || e.target.closest('a')) return;
    const entry = submissions.find((s) => s.id === id);
    if (!entry) return;
    const read = action === 'toggle' ? !entry.read : true;
    if (read === entry.read) return;
    await api(`submissions/${encodeURIComponent(id)}`, { method: 'PATCH', body: { read } });
    entry.read = read;
    syncBadge();
    renderInbox();
  } catch (err) {
    card.classList.remove('removing');
    toast(err.message, 'error');
  }
});

$('#markAllRead')?.addEventListener('click', async () => {
  if (!submissions.some((s) => !s.read)) return toast('Everything is already read.');
  try {
    await api('submissions/read-all', { method: 'POST' });
    submissions.forEach((s) => { s.read = true; });
    syncBadge();
    renderInbox();
    toast('All requests marked as read.');
  } catch (e) {
    toast(e.message, 'error');
  }
});

function exportCsv() {
  const rows = filteredInbox();
  if (!rows.length) return toast('Nothing to export.', 'error');
  const header = ['Date', 'Type', 'Name', 'Email', 'Phone', 'Language', 'Message', 'Read'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows.map((r) => [
    new Date(r.date).toLocaleString('en-GB'), (TYPES[r.type] || TYPES.general).label, r.name, r.email, r.phone, r.lang, r.notes, r.read ? 'yes' : 'no'
  ])].map((row) => row.map(cell).join(',')).join('\r\n');
  downloadFile(`neuer-blick-requests-${new Date().toISOString().slice(0, 10)}.csv`, `﻿${csv}`, 'text/csv;charset=utf-8');
  toast(`${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} exported.`);
}

$('#exportCsv')?.addEventListener('click', exportCsv);

// ==========================================================================
// VIEW: Texts & Translations
// ==========================================================================
// Keys are grouped by the part of the page they belong to
const TEXT_GROUPS = [
  ['Header & menu', /^(brand|nav|loginButton|loaderText)/],
  ['Clocks', /^(munster|kabul)City/],
  ['Ticker', /^message/],
  ['Hero', /^(callout|joinButton|discoverButton|strip|eyebrow|hero|stat\d|floating|frame|stamp|scrollHint)/],
  ['About', /^(labelAbout|about|readMore|value\d)/],
  ['Activities', /^(labelActivities|activit|moreInfo)/],
  ['Jobs & study', /^(labelOpportunities|opportunities|job|study)/],
  ['Event', /^(labelEvent|event|tag|cd[A-Z]|addCalendar|shareEvent|linkCopied)/],
  ['Gallery & quote', /^(labelGallery|gallery|quote)/],
  ['Membership', /^(labelTogether|membership|benefit|art[A-Z])/],
  ['FAQ', /^(labelFaq|faq)/],
  ['Contact', /^(labelContact|contact|addressLabel|phoneLabel|emailLabel|act[A-Z]|copied)/],
  ['Footer', /^(footer|newsletter|social|dev[A-Z])/],
  ['Forms & messages', /^(form|opt[A-Z]|modal|thanks|friend|send)/]
];

function groupOf(key) {
  return (TEXT_GROUPS.find(([, re]) => re.test(key)) || ['Other'])[0];
}

(function fillGroupSelect() {
  const select = $('#transGroup');
  if (!select) return;
  [...TEXT_GROUPS.map(([name]) => name), 'Other'].forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
})();

let transLang = 'fa';
let transQuery = '';
let transGroup = '';
let workingOverrides = {};
let rawMode = false;

function renderTranslations(options = {}) {
  workingOverrides = clone(content.overrides || {}) || {};
  if (options.search) {
    transQuery = options.search;
    $('#transSearch').value = options.search;
  }
  buildTransTable();
  setDirty('translations', false);
}

function buildTransTable() {
  const base = translations[transLang] || {};
  const overrides = workingOverrides[transLang] || {};
  const keys = [...new Set([...Object.keys(base), ...Object.keys(overrides)])];
  const rtl = transLang === 'fa';

  const groups = new Map();
  keys.forEach((key) => {
    const g = groupOf(key);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(key);
  });
  const order = [...TEXT_GROUPS.map(([n]) => n), 'Other'];

  $('#transTable').innerHTML = order.filter((g) => groups.has(g)).map((g) => `
    <div class="trans-group" data-group="${escapeHtml(g)}">
      <h4 class="trans-group-title">${escapeHtml(g)} <span>${groups.get(g).length}</span></h4>
      ${groups.get(g).map((key) => {
        const edited = Object.prototype.hasOwnProperty.call(overrides, key);
        const value = edited ? overrides[key] : (base[key] ?? '');
        return `
          <div class="trans-row ${edited ? 'edited' : ''}" data-key="${escapeHtml(key)}">
            <div class="trans-key">${escapeHtml(key)}${edited ? '<br><span class="edited-tag">Edited</span>' : ''}</div>
            <div class="trans-field">
              <textarea rows="1" dir="${rtl ? 'rtl' : 'ltr'}" data-key="${escapeHtml(key)}">${escapeHtml(value)}</textarea>
              <button class="reset-key" type="button" title="Restore default text" aria-label="Restore default text" ${edited ? '' : 'hidden'}><svg class="ico"><use href="#i-refresh"/></svg></button>
              ${edited && base[key] !== undefined ? `<p class="trans-default">Default: ${escapeHtml(stripTags(base[key]).slice(0, 140))}</p>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>`).join('');

  applyTransFilter();
  if (rawMode) $('#rawEditor').value = JSON.stringify(workingOverrides, null, 2);
}

function autoSize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight + 2}px`;
}

function applyTransFilter() {
  const q = transQuery.toLowerCase();
  const onlyEdited = $('#onlyEdited').checked;
  $$('#transTable .trans-group').forEach((group) => {
    let visible = 0;
    const groupMatch = !transGroup || group.dataset.group === transGroup;
    $$('.trans-row', group).forEach((row) => {
      const value = $('textarea', row).value.toLowerCase();
      const match = groupMatch
        && (!q || row.dataset.key.toLowerCase().includes(q) || value.includes(q))
        && (!onlyEdited || row.classList.contains('edited'));
      row.hidden = !match;
      if (match) visible += 1;
    });
    group.hidden = visible === 0;
  });
  requestAnimationFrame(() => $$('#transTable .trans-row:not([hidden]) textarea').forEach(autoSize));
}

$('#langTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn || btn.dataset.lang === transLang) return;
  transLang = btn.dataset.lang;
  $$('#langTabs .seg-btn').forEach((b) => {
    const active = b === btn;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  buildTransTable();
});

$('#transSearch')?.addEventListener('input', (e) => {
  transQuery = e.target.value.trim();
  applyTransFilter();
});

$('#transGroup')?.addEventListener('change', (e) => {
  transGroup = e.target.value;
  applyTransFilter();
});

$('#onlyEdited')?.addEventListener('change', applyTransFilter);

$('#transTable')?.addEventListener('input', (e) => {
  const textarea = e.target.closest('textarea');
  if (!textarea) return;
  autoSize(textarea);
  const key = textarea.dataset.key;
  const base = translations[transLang]?.[key];
  workingOverrides[transLang] = workingOverrides[transLang] || {};
  if (textarea.value === base) delete workingOverrides[transLang][key];
  else workingOverrides[transLang][key] = textarea.value;

  const row = textarea.closest('.trans-row');
  const edited = textarea.value !== base;
  row.classList.toggle('edited', edited);
  $('.reset-key', row).hidden = !edited;
  setDirty('translations', true);
});

$('#transTable')?.addEventListener('click', (e) => {
  const reset = e.target.closest('.reset-key');
  if (!reset) return;
  const row = reset.closest('.trans-row');
  delete workingOverrides[transLang]?.[row.dataset.key];
  setDirty('translations', true);
  buildTransTable();
});

$('#toggleRaw')?.addEventListener('click', () => {
  rawMode = !rawMode;
  $('#rawWrap').hidden = !rawMode;
  $('#transTable').hidden = rawMode;
  $('#toggleRaw').classList.toggle('saved', rawMode);
  if (rawMode) $('#rawEditor').value = JSON.stringify(workingOverrides, null, 2);
  else buildTransTable();
});

$('#rawEditor')?.addEventListener('input', (e) => {
  try {
    const parsed = JSON.parse(e.target.value || '{}');
    if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    workingOverrides = parsed;
    e.target.classList.remove('invalid');
    setDirty('translations', true);
  } catch (err) {
    e.target.classList.add('invalid');
  }
});

async function saveTranslations() {
  if (rawMode && $('#rawEditor').classList.contains('invalid')) {
    return toast('The JSON has an error. Fix it before saving.', 'error');
  }
  Object.keys(workingOverrides).forEach((lang) => {
    if (!Object.keys(workingOverrides[lang] || {}).length) delete workingOverrides[lang];
  });
  if (await saveContent('overrides', workingOverrides, $('#saveTranslations'))) {
    setDirty('translations', false);
    if (!rawMode) buildTransTable();
    toast('Texts saved. The website is updated.');
  }
}

$('#saveTranslations')?.addEventListener('click', saveTranslations);

// ==========================================================================
// VIEW: Announcements
// ==========================================================================
const messageFields = [
  { id: 'messageOne', key: 'one', fallback: 'messageText' },
  { id: 'messageTwo', key: 'two', fallback: 'messageTextTwo' },
  { id: 'messageThree', key: 'three', fallback: 'messageTextThree' },
  { id: 'messageFour', key: 'four', fallback: 'messageTextFour' }
];

function renderAnnouncements() {
  const messages = content.messages || {};
  messageFields.forEach((f) => { $(`#${f.id}`).value = messages[f.key] || ''; });
  updateTickerPreview();
  setDirty('announcements', false);
}

function updateTickerPreview() {
  const items = messageFields.map((f) => escapeHtml($(`#${f.id}`).value.trim() || stripTags(translations.fa[f.fallback])));
  const html = items.map((t) => `<span>${t}</span><i></i>`).join('');
  $('#tickerPreview').innerHTML = html + html;
}

messageFields.forEach((f) => $(`#${f.id}`)?.addEventListener('input', updateTickerPreview));

async function saveMessages() {
  const messages = {};
  messageFields.forEach((f) => {
    const value = $(`#${f.id}`).value.trim();
    if (value) messages[f.key] = value;
  });
  if (await saveContent('messages', messages, $('#saveMessages'))) {
    setDirty('announcements', false);
    toast('Announcements saved.');
  }
}

$('#saveMessages')?.addEventListener('click', saveMessages);

// ==========================================================================
// VIEW: Upcoming Event
// ==========================================================================
function renderEventView() {
  const ev = getEvent();
  $('#eventDate').value = ev.date || '';
  $('#eventDuration').value = ev.durationHours || 4;
  $('#eventLocation').value = ev.location || '';
  const c = getContact();
  $('#eventLocation').placeholder = [c.addressStreet, c.addressCity, c.addressCountry].filter(Boolean).join(', ');
  tickEventPreview();
  setDirty('event', false);
}

function tickEventPreview() {
  const start = fromBerlinWallTime($('#eventDate').value);
  const when = $('#evWhen');
  const cd = $('#evCountdown');
  const title = $('.ev-card h4');
  if (title) title.textContent = stripTags(content.overrides?.en?.eventTitle || translations.en.eventTitle);
  if (!start) {
    when.textContent = 'No date set';
    cd.innerHTML = '<div class="ev-past">Visitors see “The next date will be announced soon.”</div>';
    return;
  }
  try {
    $('#evMonth').textContent = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'Europe/Berlin' }).format(start).toUpperCase();
    $('#evDay').textContent = new Intl.DateTimeFormat('en', { day: 'numeric', timeZone: 'Europe/Berlin' }).format(start);
    when.textContent = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
    }).format(start);
  } catch (e) {
    when.textContent = start.toLocaleString();
  }

  const remaining = start - Date.now();
  if (remaining <= 0) {
    cd.innerHTML = '<div class="ev-past">This date has passed. Visitors see “announced soon” until you set a new one.</div>';
    return;
  }
  const s = Math.floor(remaining / 1000);
  const parts = [[Math.floor(s / 86400), 'Days'], [Math.floor((s % 86400) / 3600), 'Hours'], [Math.floor((s % 3600) / 60), 'Min'], [s % 60, 'Sec']];
  cd.innerHTML = parts.map(([v, l]) => `<div><b>${pad2(v)}</b><span>${l}</span></div>`).join('');
}

['eventDate', 'eventDuration', 'eventLocation'].forEach((id) => $(`#${id}`)?.addEventListener('input', tickEventPreview));

async function saveEvent() {
  const date = $('#eventDate').value;
  if (!date) return toast('Choose a start date and time first.', 'error');
  const ok = await saveContent('event', {
    date: date.slice(0, 16),
    durationHours: Number($('#eventDuration').value) || 4,
    location: $('#eventLocation').value.trim()
  }, $('#saveEvent'));
  if (ok) {
    setDirty('event', false);
    toast('Event saved. The countdown is live.');
  }
}

$('#saveEvent')?.addEventListener('click', saveEvent);

// ==========================================================================
// VIEW: Contact & Social
// ==========================================================================
const CONTACT_FIELDS = { cStreet: 'addressStreet', cCity: 'addressCity', cCountry: 'addressCountry', cPhone: 'phone', cWhatsapp: 'whatsapp', cEmail: 'email' };
const SOCIAL_FIELDS = { sInstagram: 'instagram', sFacebook: 'facebook', sYoutube: 'youtube', sTiktok: 'tiktok' };

function renderContact() {
  const c = getContact();
  const s = getSocial();
  Object.entries(CONTACT_FIELDS).forEach(([id, key]) => { $(`#${id}`).value = c[key] || ''; });
  Object.entries(SOCIAL_FIELDS).forEach(([id, key]) => { $(`#${id}`).value = s[key] || ''; });
  updateContactPreview(true);
  setDirty('contact', false);
}

let mapTimer = null;
function updateContactPreview(immediate = false) {
  const street = $('#cStreet').value.trim();
  const city = $('#cCity').value.trim();
  const country = $('#cCountry').value.trim();
  $('#pvAddress').innerHTML = [street, [city, country].filter(Boolean).join(', ')].filter(Boolean).map(escapeHtml).join('<br>') || '–';
  $('#pvPhone').textContent = $('#cPhone').value.trim() || '–';
  $('#pvEmail').textContent = $('#cEmail').value.trim() || '–';
  clearTimeout(mapTimer);
  mapTimer = setTimeout(() => {
    const q = [street, city, country].filter(Boolean).join(', ');
    const src = `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
    if (q && $('#pvMap').src !== src) $('#pvMap').src = src;
  }, immediate ? 0 : 800);
}

Object.keys(CONTACT_FIELDS).forEach((id) => $(`#${id}`)?.addEventListener('input', () => updateContactPreview()));

async function saveContact() {
  const email = $('#cEmail').value.trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return toast('Please enter a valid email address.', 'error');
  const contact = {};
  Object.entries(CONTACT_FIELDS).forEach(([id, key]) => { contact[key] = $(`#${id}`).value.trim(); });
  const social = {};
  for (const [id, key] of Object.entries(SOCIAL_FIELDS)) {
    const value = $(`#${id}`).value.trim();
    if (value && !/^https?:\/\//i.test(value)) return toast(`The ${key} link must start with https://`, 'error');
    social[key] = value;
  }
  if (await saveContent('contact', contact) && await saveContent('social', social, $('#saveContact'))) {
    setDirty('contact', false);
    toast('Contact details and social links saved.');
  }
}

$('#saveContact')?.addEventListener('click', saveContact);

// ==========================================================================
// VIEW: Website Images (+ images folder)
// ==========================================================================
const IMAGE_SLOTS = [
  { key: 'calloutBg', label: 'Hero background', where: 'Large photo at the top, behind the main headline', max: 2200 },
  { key: 'heroMain', label: 'Community photo', where: 'Section under the hero, next to the statistics', max: 1600 },
  { key: 'activity1', label: 'Activity 1 · Culture', where: 'Activities section, first card', max: 1200 },
  { key: 'activity2', label: 'Activity 2 · Education', where: 'Activities section, second card', max: 1200 },
  { key: 'activity3', label: 'Activity 3 · Youth & family', where: 'Activities section, third card', max: 1200 },
  { key: 'activity4', label: 'Activity 4 · Dialogue', where: 'Activities section, fourth card', max: 1200 },
  { key: 'eventImage', label: 'Event photo', where: 'Upcoming event card', max: 1600 },
  { key: 'footerArt', label: 'Footer illustration', where: 'Kabul ↔ Münster artwork above the footer', max: 2200 }
];
let workingImages = {};

function renderImages() {
  workingImages = { ...getImages() };
  paintSlots();
  renderLibrary();
  setDirty('media', false);
}

function paintSlots() {
  $('#slotGrid').innerHTML = IMAGE_SLOTS.map((slot) => {
    const src = workingImages[slot.key];
    const isDefault = src === DEFAULT_IMAGES[slot.key];
    return `
      <div class="slot" data-slot="${slot.key}">
        <div class="slot-thumb"><img src="${escapeHtml(src)}" alt="" loading="lazy" />${isDefault ? '' : '<span class="slot-tag">Changed</span>'}</div>
        <div class="slot-body">
          <strong>${slot.label}</strong>
          <small>${slot.where}</small>
          <code title="${escapeHtml(src)}">${escapeHtml(src)}</code>
          <div class="slot-actions">
            <label class="btn btn-soft sm"><svg class="ico"><use href="#i-upload"/></svg> Upload<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" data-upload-slot="${slot.key}" hidden /></label>
            <button class="btn btn-soft sm" type="button" data-pick-slot="${slot.key}"><svg class="ico"><use href="#i-grid"/></svg> Folder</button>
            ${isDefault ? '' : `<button class="btn btn-soft sm" type="button" data-reset-slot="${slot.key}" title="Restore original" aria-label="Restore original"><svg class="ico"><use href="#i-refresh"/></svg></button>`}
          </div>
        </div>
      </div>`;
  }).join('');
}

async function renderLibrary() {
  const grid = $('#libraryGrid');
  try {
    const files = await api('images');
    const total = files.reduce((sum, f) => sum + f.size, 0);
    $('#libraryInfo').innerHTML = `${files.length} file${files.length === 1 ? '' : 's'} in the <code>images</code> folder · ${formatSize(total)}`;
    const live = new Set([...Object.values(getImages()), ...getGallery().map((g) => g.url)]);
    grid.innerHTML = files.map((f) => `
        <div class="lib-item">
          <img src="${escapeHtml(f.path)}" alt="" loading="lazy" />
          <div class="lib-meta">
            <span title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
            <small>${formatSize(f.size)}${live.has(f.path) ? ' · <b>on website</b>' : ''}</small>
          </div>
          <div class="lib-actions">
            <button class="mini-btn" type="button" data-copy-path="${escapeHtml(f.path)}" title="Copy path" aria-label="Copy path"><svg class="ico"><use href="#i-copy"/></svg></button>
            <button class="mini-btn danger" type="button" data-delete-file="${escapeHtml(f.name)}" title="Delete file" aria-label="Delete file"><svg class="ico"><use href="#i-trash"/></svg></button>
          </div>
        </div>`).join('') || emptyState('i-image', 'No images yet', 'Upload images to fill the folder.');
  } catch (e) {
    grid.innerHTML = emptyState('i-image', 'Could not read the folder', escapeHtml(e.message));
  }
}

$('#slotGrid')?.addEventListener('change', async (e) => {
  const input = e.target.closest('[data-upload-slot]');
  if (!input?.files[0]) return;
  const slot = IMAGE_SLOTS.find((s) => s.key === input.dataset.uploadSlot);
  const card = input.closest('.slot');
  card.classList.add('busy');
  try {
    workingImages[slot.key] = await uploadImage(input.files[0], slot.max);
    setDirty('media', true);
    paintSlots();
    renderLibrary();
    toast(`${slot.label} saved in the images folder. Click “Save images” to publish it.`);
  } catch (err) {
    card.classList.remove('busy');
    toast(err.message || 'That image could not be uploaded.', 'error');
  }
});

$('#slotGrid')?.addEventListener('click', async (e) => {
  const pick = e.target.closest('[data-pick-slot]');
  const reset = e.target.closest('[data-reset-slot]');
  if (pick) {
    const path = await pickFromLibrary();
    if (!path) return;
    workingImages[pick.dataset.pickSlot] = path;
  } else if (reset) {
    workingImages[reset.dataset.resetSlot] = DEFAULT_IMAGES[reset.dataset.resetSlot];
  } else {
    return;
  }
  setDirty('media', true);
  paintSlots();
});

$('#libraryGrid')?.addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy-path]');
  const del = e.target.closest('[data-delete-file]');
  if (copy) {
    await copyText(copy.dataset.copyPath);
    toast('Path copied.');
  }
  if (del) {
    const ok = await confirmAction('Delete this file?', `${del.dataset.deleteFile} will be removed from the images folder.`, 'Delete');
    if (!ok) return;
    try {
      await api(`images/${encodeURIComponent(del.dataset.deleteFile)}`, { method: 'DELETE' });
      renderLibrary();
      toast('File deleted.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

$('#libraryUpload')?.addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  let done = 0;
  for (const file of files) {
    try {
      await uploadImage(file, 2200);
      done += 1;
    } catch (err) {
      toast(`${file.name}: ${err.message}`, 'error');
    }
  }
  if (done) toast(`${done} image${done === 1 ? '' : 's'} saved in the images folder.`);
  renderLibrary();
});

async function saveImages() {
  const changed = {};
  Object.entries(workingImages).forEach(([key, value]) => {
    if (value && value !== DEFAULT_IMAGES[key]) changed[key] = value;
  });
  if (await saveContent('images', changed, $('#saveImages'))) {
    setDirty('media', false);
    paintSlots();
    renderLibrary();
    toast('Images saved. The website now uses them.');
  }
}

$('#saveImages')?.addEventListener('click', saveImages);

// ==========================================================================
// VIEW: Photo Gallery
// ==========================================================================
let workingGallery = [];
let dragIndex = null;

function renderGalleryEditor() {
  workingGallery = getGallery();
  paintGallery();
  setDirty('gallery', false);
}

function paintGallery() {
  const editor = $('#galleryEditor');
  if (!workingGallery.length) {
    editor.innerHTML = `<div style="grid-column:1/-1">${emptyState('i-image', 'No photos', 'Upload photos or add some from the images folder. With no photos, the website shows its default gallery.')}</div>`;
    return;
  }
  editor.innerHTML = workingGallery.map((item, i) => `
      <div class="g-card" data-index="${i}" style="animation-delay:${Math.min(i, 12) * 35}ms">
        <div class="g-thumb">
          ${item.url ? `<img src="${escapeHtml(item.url)}" alt="" loading="lazy" />` : ''}
          <span class="g-num">${i + 1}</span>
          <div class="g-tools">
            <span class="g-handle" title="Drag to reorder" aria-hidden="true"><svg class="ico"><use href="#i-drag"/></svg></span>
            <button type="button" data-move="-1" title="Move earlier" aria-label="Move earlier" ${i === 0 ? 'disabled' : ''}><svg class="ico flip"><use href="#i-arrow"/></svg></button>
            <button type="button" data-move="1" title="Move later" aria-label="Move later" ${i === workingGallery.length - 1 ? 'disabled' : ''}><svg class="ico"><use href="#i-arrow"/></svg></button>
            <button type="button" class="g-remove" title="Remove photo" aria-label="Remove photo"><svg class="ico"><use href="#i-x"/></svg></button>
          </div>
        </div>
        <div class="g-fields">
          <input class="g-url" data-field="url" value="${escapeHtml(item.url)}" placeholder="images/… or https://…" aria-label="Image path or URL" />
          <label>FA<input data-field="title" dir="rtl" value="${escapeHtml(item.title)}" placeholder="عنوان فارسی" /></label>
          <label>DE<input data-field="titleDe" value="${escapeHtml(item.titleDe)}" placeholder="Bildunterschrift" /></label>
          <label>EN<input data-field="titleEn" value="${escapeHtml(item.titleEn)}" placeholder="Caption" /></label>
        </div>
      </div>`).join('');
}

const galleryEditorEl = $('#galleryEditor');

galleryEditorEl?.addEventListener('input', (e) => {
  const input = e.target.closest('[data-field]');
  if (!input) return;
  const card = input.closest('.g-card');
  const item = workingGallery[Number(card.dataset.index)];
  item[input.dataset.field] = input.value;
  if (input.dataset.field === 'url') {
    const thumb = $('.g-thumb', card);
    let img = $('img', thumb);
    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      thumb.prepend(img);
    }
    img.src = input.value.trim();
  }
  setDirty('gallery', true);
});

galleryEditorEl?.addEventListener('click', (e) => {
  const card = e.target.closest('.g-card');
  if (!card) return;
  const index = Number(card.dataset.index);
  const move = e.target.closest('[data-move]');
  if (move) {
    const to = index + Number(move.dataset.move);
    if (to < 0 || to >= workingGallery.length) return;
    [workingGallery[index], workingGallery[to]] = [workingGallery[to], workingGallery[index]];
    paintGallery();
    setDirty('gallery', true);
    return;
  }
  if (e.target.closest('.g-remove')) {
    card.style.transform = 'scale(0.9)';
    card.style.opacity = '0';
    setTimeout(() => {
      workingGallery.splice(index, 1);
      paintGallery();
      setDirty('gallery', true);
    }, 200);
  }
});

galleryEditorEl?.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.g-handle');
  if (handle) handle.closest('.g-card').draggable = true;
});

galleryEditorEl?.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.g-card');
  if (!card || !card.draggable) return;
  dragIndex = Number(card.dataset.index);
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragIndex));
});

galleryEditorEl?.addEventListener('dragover', (e) => {
  if (dragIndex === null) return;
  const card = e.target.closest('.g-card');
  if (!card) return;
  e.preventDefault();
  $$('.g-card.drop-target').forEach((c) => c !== card && c.classList.remove('drop-target'));
  card.classList.add('drop-target');
});

galleryEditorEl?.addEventListener('drop', (e) => {
  if (dragIndex === null) return;
  const card = e.target.closest('.g-card');
  if (!card) return;
  e.preventDefault();
  const to = Number(card.dataset.index);
  if (to !== dragIndex) {
    const [moved] = workingGallery.splice(dragIndex, 1);
    workingGallery.splice(to, 0, moved);
    setDirty('gallery', true);
  }
  dragIndex = null;
  paintGallery();
});

galleryEditorEl?.addEventListener('dragend', () => {
  dragIndex = null;
  $$('.g-card').forEach((c) => {
    c.draggable = false;
    c.classList.remove('dragging', 'drop-target');
  });
});

async function addGalleryFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith('image/'));
  if (!images.length) return toast('Please choose image files.', 'error');
  const zone = $('#galleryDrop');
  zone.classList.add('busy');
  let added = 0;
  for (const file of images) {
    try {
      const url = await uploadImage(file, 1600);
      workingGallery.push({ url, title: '', titleDe: '', titleEn: '' });
      added += 1;
      paintGallery();
    } catch (e) {
      toast(`${file.name}: ${e.message}`, 'error');
    }
  }
  zone.classList.remove('busy');
  if (added) {
    setDirty('gallery', true);
    toast(`${added} photo${added === 1 ? '' : 's'} saved in the images folder. Add captions, then save.`);
  }
}

$('#galleryImageFile')?.addEventListener('change', (e) => {
  addGalleryFiles(e.target.files);
  e.target.value = '';
});

$('#addFromLibrary')?.addEventListener('click', async () => {
  const path = await pickFromLibrary();
  if (!path) return;
  workingGallery.push({ url: path, title: '', titleDe: '', titleEn: '' });
  paintGallery();
  setDirty('gallery', true);
});

$('#addImageUrl')?.addEventListener('click', () => {
  workingGallery.push({ url: '', title: '', titleDe: '', titleEn: '' });
  paintGallery();
  setDirty('gallery', true);
  const inputs = $$('#galleryEditor .g-url');
  const last = inputs[inputs.length - 1];
  last?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
  setTimeout(() => last?.focus(), 300);
});

$('#resetGallery')?.addEventListener('click', async () => {
  const ok = await confirmAction('Restore the default gallery?', 'Your current photo list in the editor will be replaced. Nothing changes on the website until you save.', 'Restore');
  if (!ok) return;
  workingGallery = clone(defaultGalleryItems);
  paintGallery();
  setDirty('gallery', true);
});

async function saveGallery() {
  const items = workingGallery.filter((item) => item.url && item.url.trim());
  if (await saveContent('gallery', items, $('#saveGallery'))) {
    workingGallery = clone(items);
    paintGallery();
    setDirty('gallery', false);
    toast(`Gallery saved with ${items.length} photo${items.length === 1 ? '' : 's'}.`);
  }
}

$('#saveGallery')?.addEventListener('click', saveGallery);

(function wireDropzone() {
  const zone = $('#galleryDrop');
  if (!zone) return;
  ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    zone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((type) => zone.addEventListener(type, () => zone.classList.remove('dragover')));
  zone.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    addGalleryFiles(e.dataTransfer.files);
  });
})();

// ==========================================================================
// VIEW: Users
// ==========================================================================
async function renderUsers() {
  const list = $('#userList');
  try {
    const result = await api('users');
    mailReady = result.mailReady;
    $('#mailBanner').hidden = mailReady;
    list.innerHTML = result.users.map((u) => `
      <div class="user-row" data-user="${escapeHtml(u.username)}">
        <span class="initials" style="--tone:${u.username === me.username ? 'var(--saffron)' : 'var(--lapis-light)'}">${escapeHtml(initialsOf(u.username))}</span>
        <div class="user-main">
          <strong>${escapeHtml(u.username)}${u.username === me.username ? ' <span class="type-pill" style="--tone:var(--emerald)">You</span>' : ''}</strong>
          <small>${escapeHtml(u.email || 'no email')} · last sign-in ${relativeTime(u.lastLogin)}${u.createdBy && u.createdBy !== 'system' ? ` · added by ${escapeHtml(u.createdBy)}` : ''}</small>
        </div>
        ${u.username === me.username ? '' : `
          <button class="mini-btn" type="button" data-reset-user title="Reset password and email it" aria-label="Reset password"><svg class="ico"><use href="#i-refresh"/></svg></button>
          <button class="mini-btn danger" type="button" data-delete-user title="Delete account" aria-label="Delete account"><svg class="ico"><use href="#i-trash"/></svg></button>`}
      </div>`).join('');
  } catch (e) {
    list.innerHTML = emptyState('i-users', 'Could not load accounts', escapeHtml(e.message));
  }
}

function showCredentials({ title, text, username, password, email }) {
  $('#credTitle').textContent = title;
  $('#credText').textContent = text;
  $('#credUser').textContent = username;
  $('#credPass').textContent = password;
  const loginUrl = `${location.origin}/admin.html`;
  const body = `Salaam!\n\nHere are your Neuer Blick Content Studio login details:\n\nLogin page: ${loginUrl}\nUsername: ${username}\nPassword: ${password}\n\nPlease change your password after signing in (Users → Change my password).`;
  $('#credMail').href = `mailto:${encodeURIComponent(email || '')}?subject=${encodeURIComponent('Your Neuer Blick Content Studio account')}&body=${encodeURIComponent(body)}`;
  $('#credCopy').onclick = async () => {
    await copyText(`Login page: ${loginUrl}\nUsername: ${username}\nPassword: ${password}`);
    toast('Login details copied.');
  };
  const dialog = $('#credDialog');
  dialog.hidden = false;
  const close = (e) => {
    if (!e.target.closest('[data-close-cred]')) return;
    dialog.hidden = true;
    dialog.removeEventListener('click', close);
  };
  dialog.addEventListener('click', close);
}

$('#nuGenerate')?.addEventListener('click', () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const values = crypto.getRandomValues(new Uint32Array(12));
  $('#nuPassword').value = [...values].map((v) => chars[v % chars.length]).join('');
});

$('#newUserForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('#nuSubmit');
  button.disabled = true;
  const email = $('#nuEmail').value.trim();
  try {
    const result = await api('users', {
      method: 'POST',
      body: {
        username: $('#nuUsername').value.trim(),
        email,
        password: $('#nuPassword').value,
        sendEmail: $('#nuSendEmail').checked
      }
    });
    $('#newUserForm').reset();
    $('#nuSendEmail').checked = true;
    renderUsers();
    showCredentials({
      title: 'Account created',
      text: result.emailed
        ? `The login details were emailed to ${email}. A copy is shown here.`
        : `${result.emailError ? `Email could not be sent: ${result.emailError} ` : ''}Pass these details on to the new admin, for example with “Open in email app”.`,
      username: result.user.username,
      password: result.password,
      email
    });
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#userList')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.user-row');
  if (!row) return;
  const username = row.dataset.user;
  try {
    if (e.target.closest('[data-delete-user]')) {
      const ok = await confirmAction(`Delete ${username}?`, 'This account will no longer be able to sign in.', 'Delete');
      if (!ok) return;
      await api(`users/${encodeURIComponent(username)}`, { method: 'DELETE' });
      toast(`${username} deleted.`);
      renderUsers();
    } else if (e.target.closest('[data-reset-user]')) {
      const ok = await confirmAction(`Reset the password of ${username}?`, 'A new password is created and emailed to them. Their current password stops working.', 'Reset password');
      if (!ok) return;
      const result = await api(`users/${encodeURIComponent(username)}/reset`, { method: 'POST' });
      showCredentials({
        title: 'Password reset',
        text: result.emailed ? 'The new password was emailed. A copy is shown here.' : `${result.emailError ? `Email could not be sent: ${result.emailError} ` : ''}Pass the new password on to ${username}.`,
        username,
        password: result.password,
        email: ''
      });
    }
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#pwForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('#pwNext').value !== $('#pwRepeat').value) return toast('The new passwords do not match.', 'error');
  try {
    await api('me/password', { method: 'POST', body: { current: $('#pwCurrent').value, next: $('#pwNext').value } });
    $('#pwForm').reset();
    toast('Your password was updated.');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ==========================================================================
// VIEW: Settings (stats, email, backup)
// ==========================================================================
async function renderSettings() {
  const stats = getStats();
  $('#statYears').value = stats.years;
  $('#statMembers').value = stats.members;
  $('#statEvents').value = stats.events;
  setDirty('settings', false);

  $('#importBrowser').hidden = !LEGACY_KEYS.some((k) => { try { return localStorage.getItem(k) !== null; } catch (e) { return false; } });

  try {
    const m = await api('mail');
    $('#mailHost').value = m.host || '';
    $('#mailPort').value = m.port || 465;
    $('#mailSecure').checked = m.secure !== false;
    $('#mailUser').value = m.user || '';
    $('#mailPass').value = '';
    $('#mailPass').placeholder = m.hasPassword ? 'Saved. Type to replace' : '••••••••';
    $('#mailFrom').value = m.from || '';
    setMailStatus(m.installed && m.host && m.user && m.hasPassword, m.installed);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function setMailStatus(ready, installed = true) {
  const pill = $('#mailStatus');
  mailReady = Boolean(ready);
  pill.textContent = !installed ? 'Run npm install' : (ready ? 'Ready' : 'Not set up');
  pill.classList.toggle('ok', Boolean(ready));
}

async function saveStats() {
  const read = (id) => Math.max(0, parseInt($(`#${id}`).value, 10) || 0);
  if (await saveContent('stats', { years: read('statYears'), members: read('statMembers'), events: read('statEvents') }, $('#saveStats'))) {
    setDirty('settings', false);
    toast('Statistics saved.');
  }
}

$('#saveStats')?.addEventListener('click', saveStats);

$('#mailPreset')?.addEventListener('change', (e) => {
  if (!e.target.value) return;
  const [host, port, secure] = e.target.value.split('|');
  $('#mailHost').value = host;
  $('#mailPort').value = port;
  $('#mailSecure').checked = secure === '1';
});

$('#mailForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const result = await api('mail', {
      method: 'PUT',
      body: {
        host: $('#mailHost').value.trim(),
        port: Number($('#mailPort').value) || 465,
        secure: $('#mailSecure').checked,
        user: $('#mailUser').value.trim(),
        pass: $('#mailPass').value,
        from: $('#mailFrom').value.trim()
      }
    });
    setMailStatus(result.ready);
    $('#mailPass').value = '';
    $('#mailPass').placeholder = 'Saved. Type to replace';
    toast(result.ready ? 'Email settings saved. Send a test email to check them.' : 'Saved. Fill in server, username and password to enable email.');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#mailTest')?.addEventListener('click', async () => {
  const button = $('#mailTest');
  const to = me.email || $('#mailUser').value.trim();
  button.disabled = true;
  try {
    await api('mail/test', { method: 'POST', body: { to } });
    toast(`Test email sent to ${to}.`);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

async function exportBackup() {
  try {
    const data = await api('backup');
    downloadFile(`neuer-blick-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('Backup downloaded.');
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#exportBackup')?.addEventListener('click', exportBackup);

$('#importBackup')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed?.content) throw new Error('format');
    const ok = await confirmAction('Restore this backup?', 'Website content, requests and subscribers will be replaced with the backup.', 'Restore');
    if (!ok) return;
    await api('restore', { method: 'POST', body: parsed });
    content = await api('content');
    await refreshInbox();
    channel?.postMessage({ type: 'content-updated' });
    dirtyViews.clear();
    $$('.nav-item').forEach((n) => n.classList.remove('dirty'));
    go(activeView, { force: true });
    toast('Backup restored.');
  } catch (err) {
    toast(err.message === 'format' || err instanceof SyntaxError ? 'That file is not a valid studio backup.' : err.message, 'error');
  }
});

// Bring over edits made with the earlier, browser-only version of the studio
$('#importBrowser')?.addEventListener('click', async () => {
  const read = (k) => {
    try {
      const v = localStorage.getItem(k);
      if (v === null) return null;
      return k === 'newerBlickCalloutImage' ? v : JSON.parse(v);
    } catch (e) {
      return null;
    }
  };
  const ok = await confirmAction('Import edits from this browser?', 'Texts, announcements, event, stats, background and gallery saved by the old studio version are copied to the server.', 'Import');
  if (!ok) return;
  try {
    const toFile = async (url, name) => {
      if (!String(url).startsWith('data:')) return url;
      return (await api('upload', { method: 'POST', body: { filename: name, data: url } })).path;
    };
    const legacyOverrides = read('newerBlickTranslationOverrides');
    if (legacyOverrides) await saveContent('overrides', { ...(content.overrides || {}), ...legacyOverrides });
    const messages = read('newerBlickMessages');
    if (messages) await saveContent('messages', messages);
    const event = read('newerBlickEvent');
    if (event) await saveContent('event', event);
    const stats = read('newerBlickStats');
    if (stats) await saveContent('stats', stats);
    const callout = read('newerBlickCalloutImage');
    if (callout) await saveContent('images', { ...(content.images || {}), calloutBg: await toFile(callout, 'hero-background') });
    const gallery = read('newerBlickGallery');
    if (Array.isArray(gallery) && gallery.length) {
      const items = [];
      for (const [i, item] of gallery.entries()) {
        const entry = typeof item === 'string' ? { url: item } : item;
        items.push({ title: '', titleDe: '', titleEn: '', ...entry, url: await toFile(entry.url, `gallery-${i + 1}`) });
      }
      await saveContent('gallery', items);
    }
    LEGACY_KEYS.forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
    $('#importBrowser').hidden = true;
    toast('Old browser edits imported to the server.');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#resetAll')?.addEventListener('click', async () => {
  const ok = await confirmAction('Reset all website content?', 'Texts, announcements, event, contact, images, gallery and statistics go back to their defaults. The inbox, accounts and image files are kept.', 'Reset content');
  if (!ok) return;
  try {
    content = await api('content', { method: 'PUT', body: Object.fromEntries(['overrides', 'messages', 'contact', 'social', 'images', 'gallery', 'event', 'stats'].map((k) => [k, null])) });
    channel?.postMessage({ type: 'content-updated' });
    dirtyViews.clear();
    $$('.nav-item').forEach((n) => n.classList.remove('dirty'));
    go(activeView, { force: true });
    toast('All content restored to defaults.');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ==========================================================================
// Command Palette (Ctrl/⌘ + K)
// ==========================================================================
const palette = $('#palette');
const paletteInput = $('#paletteInput');
const paletteList = $('#paletteList');
let paletteIndex = 0;
let paletteItems = [];

const paletteActions = [
  ...Object.entries(VIEWS).map(([id, v]) => ({ label: v.title, hint: 'Go to', icon: v.icon, run: () => go(id) })),
  { label: 'Add an admin', hint: 'Action', icon: 'i-plus', run: () => { go('users'); setTimeout(() => $('#nuUsername').focus(), 300); } },
  { label: 'Toggle dark mode', hint: 'Action', icon: 'i-moon', run: toggleTheme },
  { label: 'Open the website', hint: 'Action', icon: 'i-external', run: () => window.open('index.html', '_blank', 'noopener') },
  { label: 'Export inbox as CSV', hint: 'Action', icon: 'i-download', run: () => { inboxFilter = 'all'; inboxQuery = ''; exportCsv(); } },
  { label: 'Download backup', hint: 'Action', icon: 'i-save', run: exportBackup },
  { label: 'Log out', hint: 'Action', icon: 'i-logout', run: () => $('#logoutButton').click() }
];

function paintPalette() {
  const q = paletteInput.value.trim().toLowerCase();
  paletteItems = paletteActions.filter((a) => !q || a.label.toLowerCase().includes(q));
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
  paletteList.innerHTML = paletteItems.length
    ? paletteItems.map((a, i) => `<li role="option" data-i="${i}" class="${i === paletteIndex ? 'active' : ''}" aria-selected="${i === paletteIndex}"><svg class="ico"><use href="#${a.icon}"/></svg>${escapeHtml(a.label)}<small>${a.hint}</small></li>`).join('')
    : '<li>No matches</li>';
}

function openPalette() {
  palette.hidden = false;
  paletteInput.value = '';
  paletteIndex = 0;
  paintPalette();
  setTimeout(() => paletteInput.focus(), 20);
}

function closePalette() {
  palette.hidden = true;
}

function runPalette(i) {
  const action = paletteItems[i];
  if (!action) return;
  closePalette();
  action.run();
}

$('#openPalette')?.addEventListener('click', openPalette);
paletteInput?.addEventListener('input', () => { paletteIndex = 0; paintPalette(); });
paletteInput?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = (paletteIndex + 1) % Math.max(1, paletteItems.length); paintPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = (paletteIndex - 1 + paletteItems.length) % Math.max(1, paletteItems.length); paintPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteIndex); }
  else if (e.key === 'Escape') closePalette();
});
paletteList?.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) runPalette(Number(li.dataset.i));
});
palette?.addEventListener('click', (e) => { if (e.target.matches('[data-close-palette]')) closePalette(); });

// ==========================================================================
// Boot
// ==========================================================================
updateClocks();
setInterval(updateClocks, 1000);
setInterval(updateLastSaved, 30000);

if (location.protocol === 'file:') {
  showLoginError(SERVER_HINT);
  loginSubmit.disabled = true;
} else if (token) {
  enterStudio(false);
} else {
  setTimeout(() => usernameInput?.focus(), reducedMotion ? 0 : 700);
}
