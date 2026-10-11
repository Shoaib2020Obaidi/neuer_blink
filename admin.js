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
  members: { title: 'Members & finance', icon: 'i-chart', render: renderMembers },
  translations: { title: 'Texts & translations', icon: 'i-globe', render: renderTranslations, save: saveTranslations },
  announcements: { title: 'Announcements', icon: 'i-megaphone', render: renderAnnouncements, save: saveMessages },
  event: { title: 'Upcoming event', icon: 'i-calendar', render: renderEventView, save: saveEvent },
  contact: { title: 'Contact & social', icon: 'i-phone', render: renderContact, save: saveContact },
  media: { title: 'Website images', icon: 'i-image', render: renderImages, save: saveImages },
  gallery: { title: 'Photo gallery', icon: 'i-grid', render: renderGalleryEditor, save: saveGallery },
  library: { title: 'News & media', icon: 'i-sparkle', render: renderLibraryView },
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
  refreshMembersBadge();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    refreshInbox(true);
    refreshMembersBadge();
  }, 30000);
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
const LANG_FLAGS = { fa: '🇦🇫 FA', ps: '🇦🇫 PS', de: '🇩🇪 DE', en: '🇬🇧 EN' };

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
  return list.map((item) => ({ url: item.url || '', title: item.title || '', titleDe: item.titleDe || '', titleEn: item.titleEn || '', titlePs: item.titlePs || '' }));
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
  ['Membership form', /^jf/],
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
  const rtl = transLang === 'fa' || transLang === 'ps';

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
  { key: 'calloutBg', label: 'Hero background', where: 'Large photo at the top, behind the main headline (used when no slideshow photos are ticked)', max: 2200 },
  { key: 'heroMain', label: 'Community photo', where: 'Section under the hero, next to the statistics', max: 1600 },
  { key: 'activity1', label: 'Activity 1 · Culture', where: 'Activities section, first card', max: 1200 },
  { key: 'activity2', label: 'Activity 2 · Education', where: 'Activities section, second card', max: 1200 },
  { key: 'activity3', label: 'Activity 3 · Youth & family', where: 'Activities section, third card', max: 1200 },
  { key: 'activity4', label: 'Activity 4 · Dialogue', where: 'Activities section, fourth card', max: 1200 },
  { key: 'eventImage', label: 'Event photo', where: 'Upcoming event card', max: 1600 },
  { key: 'footerArt', label: 'Footer illustration', where: 'Kabul ↔ Münster artwork above the footer', max: 2200 },
  { key: 'journeyAfghanistan', label: 'Journey · Afghanistan', where: 'First scene of the scrolling journey under the hero (a wide landscape photo works best)', max: 2400 },
  { key: 'journeyGermany', label: 'Journey · Germany', where: 'Last scene of the scrolling journey, after the clouds', max: 2400 }
];
let workingImages = {};

const heroList = () => (Array.isArray(workingImages.heroSlides) ? workingImages.heroSlides : []);

function renderImages() {
  workingImages = { ...getImages() };
  workingImages.heroSlides = [...(Array.isArray(workingImages.heroSlides) ? workingImages.heroSlides : [])];
  paintSlots();
  paintHeroSlides();
  renderLibrary();
  setDirty('media', false);
}

// Hero slideshow: the photos ticked in the images folder, in the order they were ticked
function paintHeroSlides() {
  const list = heroList();
  $('#heroCount').textContent = `${list.length} selected`;
  $('#heroSlides').innerHTML = list.length
    ? list.map((path, i) => `
        <div class="hero-slide">
          <img src="${escapeHtml(path)}" alt="" loading="lazy" />
          <span class="hero-num">${i + 1}</span>
          <button class="mini-btn" type="button" data-hero-remove="${escapeHtml(path)}" title="Remove from slideshow" aria-label="Remove from slideshow"><svg class="ico"><use href="#i-x"/></svg></button>
          <code title="${escapeHtml(path)}">${escapeHtml(path.split('/').pop())}</code>
        </div>`).join('')
    : '<p class="hint">No photos ticked yet. The website uses the “Hero background” photo.</p>';
  syncHeroChecks();
}

function syncHeroChecks() {
  const list = heroList();
  $$('#libraryGrid [data-hero-path]').forEach((input) => {
    const index = list.indexOf(input.dataset.heroPath);
    input.checked = index !== -1;
    const item = input.closest('.lib-item');
    item.classList.toggle('is-hero', index !== -1);
    $('.lib-hero b', item).textContent = index === -1 ? '' : String(index + 1);
  });
}

function setHeroSlides(list) {
  workingImages.heroSlides = list;
  setDirty('media', true);
  paintHeroSlides();
}

$('#heroAll')?.addEventListener('click', () => {
  const paths = $$('#libraryGrid [data-hero-path]').map((input) => input.dataset.heroPath);
  setHeroSlides([...heroList(), ...paths.filter((p) => !heroList().includes(p))]);
});

$('#heroNone')?.addEventListener('click', () => setHeroSlides([]));

$('#heroSlides')?.addEventListener('click', (e) => {
  const remove = e.target.closest('[data-hero-remove]');
  if (remove) setHeroSlides(heroList().filter((p) => p !== remove.dataset.heroRemove));
});

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
    const live = new Set([...Object.values(getImages()).flat(), ...getGallery().map((g) => g.url)]);
    grid.innerHTML = files.map((f) => `
        <div class="lib-item">
          <label class="lib-hero" title="Use in the hero slideshow">
            <input type="checkbox" data-hero-path="${escapeHtml(f.path)}" aria-label="Use ${escapeHtml(f.name)} in the hero slideshow" />
            <span class="lib-hero-box"><svg class="ico"><use href="#i-check"/></svg><b></b></span>
            <span class="lib-hero-text">Hero</span>
          </label>
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
    syncHeroChecks();
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

$('#libraryGrid')?.addEventListener('change', (e) => {
  const input = e.target.closest('[data-hero-path]');
  if (!input) return;
  const path = input.dataset.heroPath;
  const list = heroList();
  setHeroSlides(input.checked ? [...list, path] : list.filter((p) => p !== path));
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
      const deletedPath = `images/${del.dataset.deleteFile}`;
      if (heroList().includes(deletedPath)) {
        setHeroSlides(heroList().filter((p) => p !== deletedPath));
        toast('The deleted photo was removed from the hero slideshow. Click “Save images” to publish.');
      }
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
    if (Array.isArray(value)) {
      if (value.length) changed[key] = value;
    } else if (value && value !== DEFAULT_IMAGES[key]) {
      changed[key] = value;
    }
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
          <label>PS<input data-field="titlePs" dir="rtl" value="${escapeHtml(item.titlePs)}" placeholder="پښتو سرلیک" /></label>
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
      workingGallery.push({ url, title: '', titleDe: '', titleEn: '', titlePs: '' });
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
  workingGallery.push({ url: path, title: '', titleDe: '', titleEn: '', titlePs: '' });
  paintGallery();
  setDirty('gallery', true);
});

$('#addImageUrl')?.addEventListener('click', () => {
  workingGallery.push({ url: '', title: '', titleDe: '', titleEn: '', titlePs: '' });
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
// VIEW: Members & finance
// ==========================================================================
const MEMBER_STATUS = {
  pending: { label: 'Pending', tone: 'var(--saffron)' },
  active: { label: 'Active', tone: 'var(--emerald)' },
  deactivated: { label: 'Deactivated', tone: 'var(--muted)' },
  rejected: { label: 'Rejected', tone: 'var(--pomegranate)' }
};
// Fixed status palette: each state also carries an icon and a label, never colour alone
const PAY_STATUS = {
  paid: { label: 'Paid up', icon: '✓', color: '#0ca30c' },
  due: { label: 'Due', icon: '!', color: '#fab219' },
  overdue: { label: 'Overdue', icon: '⚠', color: '#d03b3b' },
  free: { label: 'No fee', icon: '∞', color: '#8a9a93' }
};
const MEMBER_TYPE_LABELS = { ordinary: 'Ordinary', supporting: 'Supporting', family: 'Family', other: 'Other' };
const FEE_CATEGORY_LABELS = { employed: 'Employed', 'low-income': 'Unemployed / low income', student: 'Student / trainee', family: 'Family (> 2 children)' };
const METHOD_LABELS = { transfer: 'Bank transfer', cash: 'Cash', other: 'Other' };
const MEMBER_FILTERS = [['all', 'All'], ['active', 'Active'], ['pending', 'Pending'], ['unpaid', 'Fees due'], ['overdue', 'Overdue'], ['deactivated', 'Deactivated'], ['rejected', 'Rejected']];

let membersData = [];
let memberFees = {};
let membersMailReady = false;
let memberFilter = 'all';
let memberQuery = '';
let drawerMemberId = null;

const euro = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n) || 0);
const shortDate = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const memberName = (m) => `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email;

function memberAvatar(m, size = '') {
  return m.avatar
    ? `<span class="m-avatar ${size}"><img src="${escapeHtml(m.avatar)}" alt="" /></span>`
    : `<span class="m-avatar ${size}">${escapeHtml(initialsOf(memberName(m)))}</span>`;
}

function payPill(m) {
  if (m.status !== 'active') return '';
  const s = PAY_STATUS[m.finance.status] || PAY_STATUS.paid;
  return `<span class="pay-pill" style="--c:${s.color}"><b aria-hidden="true">${s.icon}</b>${s.label}</span>`;
}

function statusPill(m) {
  const s = MEMBER_STATUS[m.status] || MEMBER_STATUS.pending;
  return `<span class="m-status" style="--c:${s.tone}">${s.label}</span>`;
}

async function refreshMembersBadge() {
  try {
    const data = await api('members');
    membersData = data.members;
    paintMembersBadge();
  } catch (e) { /* the badge is optional */ }
}

function paintMembersBadge() {
  const pending = membersData.filter((m) => m.status === 'pending').length;
  const badge = $('#membersBadge');
  if (!badge) return;
  badge.hidden = !pending;
  badge.textContent = pending;
}

async function renderMembers() {
  try {
    const data = await api('members');
    membersData = data.members;
    memberFees = data.fees;
    membersMailReady = data.mailReady;
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  repaintMembers();
  if (drawerMemberId) openMemberDrawer(drawerMemberId);
}

function paintMemberKpis() {
  const active = membersData.filter((m) => m.status === 'active');
  const year = String(new Date().getFullYear());
  const payments = membersData.flatMap((m) => m.payments || []);
  const thisYear = payments.filter((p) => String(p.date).startsWith(year));
  const unpaid = active.filter((m) => m.finance.balance > 0);
  $('#mkActive').textContent = active.length;
  $('#mkActiveSub').textContent = `of ${membersData.length} accounts`;
  $('#mkPending').textContent = membersData.filter((m) => m.status === 'pending').length;
  $('#mkCollectedLabel').textContent = `Collected in ${year}`;
  $('#mkCollected').textContent = euro(thisYear.reduce((s, p) => s + Number(p.amount), 0));
  $('#mkCollectedSub').textContent = `${thisYear.length} payment${thisYear.length === 1 ? '' : 's'}`;
  $('#mkOutstanding').textContent = euro(unpaid.reduce((s, m) => s + m.finance.balance, 0));
  $('#mkOutstandingSub').textContent = `${unpaid.length} member${unpaid.length === 1 ? '' : 's'} with fees due`;
  $('#mkOverdue').textContent = active.filter((m) => m.finance.status === 'overdue').length;
}

// Monthly collections: one series, bars anchored to the baseline, hover tooltip per month
function paintFinanceChart() {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-GB', { month: 'short' }), full: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), total: 0, count: 0 });
  }
  membersData.forEach((m) => (m.payments || []).forEach((p) => {
    const month = months.find((x) => x.key === String(p.date).slice(0, 7));
    if (month) {
      month.total += Number(p.amount) || 0;
      month.count += 1;
    }
  }));

  const W = 720;
  const H = 250;
  const pad = { top: 22, right: 12, bottom: 30, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const max = Math.max(...months.map((m) => m.total));
  const step = max <= 0 ? 50 : [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find((s) => s * 4 >= max) || Math.ceil(max / 4);
  const top = step * 4;
  const slot = plotW / months.length;
  const barW = Math.min(34, slot * 0.58);
  const y = (v) => pad.top + plotH - (v / top) * plotH;
  const maxIndex = max > 0 ? months.findIndex((m) => m.total === max) : -1;

  const grid = [0, 1, 2, 3, 4].map((i) => {
    const v = step * i;
    return `<line class="fc-grid" x1="${pad.left}" x2="${W - pad.right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="fc-axis" x="${pad.left - 8}" y="${y(v) + 4}" text-anchor="end">${euro(v)}</text>`;
  }).join('');

  const bars = months.map((m, i) => {
    const x = pad.left + slot * i + (slot - barW) / 2;
    const h = (m.total / top) * plotH;
    const r = Math.min(4, h / 2);
    const baseY = pad.top + plotH;
    // Rounded data end, square at the baseline
    const shape = h > 0
      ? `<path class="fc-bar" d="M${x},${baseY} V${baseY - h + r} Q${x},${baseY - h} ${x + r},${baseY - h} H${x + barW - r} Q${x + barW},${baseY - h} ${x + barW},${baseY - h + r} V${baseY} Z"/>`
      : '';
    const label = (i === maxIndex || i === months.length - 1) && m.total > 0
      ? `<text class="fc-value" x="${x + barW / 2}" y="${baseY - h - 6}" text-anchor="middle">${euro(m.total)}</text>` : '';
    return `<g class="fc-col" data-i="${i}">
        <rect class="fc-hit" x="${pad.left + slot * i}" y="${pad.top}" width="${slot}" height="${plotH}"/>
        ${shape}${label}
        <text class="fc-axis" x="${x + barW / 2}" y="${H - 10}" text-anchor="middle">${m.label}</text>
      </g>`;
  }).join('');

  $('#finChart').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fees collected per month over the last 12 months">
      ${grid}
      <line class="fc-base" x1="${pad.left}" x2="${W - pad.right}" y1="${pad.top + plotH}" y2="${pad.top + plotH}"/>
      ${bars}
    </svg>
    <div class="fc-tip" id="fcTip" hidden></div>
    ${max <= 0 ? '<p class="fc-empty">No payments recorded in the last 12 months yet.</p>' : ''}`;
  $('#finTable').innerHTML = `<caption>Fees collected per month</caption><tr><th>Month</th><th>Total</th><th>Payments</th></tr>${months.map((m) => `<tr><td>${m.full}</td><td>${euro(m.total)}</td><td>${m.count}</td></tr>`).join('')}`;

  const chart = $('#finChart');
  const tip = $('#fcTip');
  chart.onmousemove = (e) => {
    const col = e.target.closest('.fc-col');
    $$('.fc-col', chart).forEach((c) => c.classList.toggle('hover', c === col));
    if (!col) {
      tip.hidden = true;
      return;
    }
    const m = months[Number(col.dataset.i)];
    tip.innerHTML = `<strong>${m.full}</strong><span>${euro(m.total)}</span><small>${m.count} payment${m.count === 1 ? '' : 's'}</small>`;
    tip.hidden = false;
    const box = chart.getBoundingClientRect();
    const left = Math.min(box.width - tip.offsetWidth - 4, Math.max(4, e.clientX - box.left - tip.offsetWidth / 2));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, e.clientY - box.top - tip.offsetHeight - 14)}px`;
  };
  chart.onmouseleave = () => {
    tip.hidden = true;
    $$('.fc-col', chart).forEach((c) => c.classList.remove('hover'));
  };
}

function paintStatusBar() {
  const active = membersData.filter((m) => m.status === 'active');
  const counts = Object.fromEntries(Object.keys(PAY_STATUS).map((k) => [k, active.filter((m) => m.finance.status === k).length]));
  $('#statusSub').textContent = `${active.length} active member${active.length === 1 ? '' : 's'}`;
  $('#statusBar').innerHTML = active.length
    ? Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `<span class="sb-seg" style="flex:${n};--c:${PAY_STATUS[k].color}" title="${PAY_STATUS[k].label}: ${n}" aria-label="${PAY_STATUS[k].label}: ${n}"></span>`).join('')
    : '<span class="sb-empty"></span>';
  $('#statusLegend').innerHTML = Object.entries(PAY_STATUS).map(([k, s]) => `
    <li><button type="button" data-member-filter="${k === 'paid' || k === 'free' ? 'active' : k === 'due' ? 'unpaid' : 'overdue'}">
      <span class="lg-icon" style="--c:${s.color}">${s.icon}</span>${s.label}
      <b>${counts[k]}</b><small>${active.length ? Math.round((counts[k] / active.length) * 100) : 0}%</small>
    </button></li>`).join('');
}

function paintTypeBars() {
  const pool = membersData.filter((m) => m.status === 'active' || m.status === 'pending');
  const counts = Object.keys(MEMBER_TYPE_LABELS).map((k) => [k, pool.filter((m) => m.memberType === k).length]);
  const max = Math.max(1, ...counts.map(([, n]) => n));
  $('#memberTypeBars').innerHTML = counts.map(([k, n]) => `
    <div class="hbar" title="${MEMBER_TYPE_LABELS[k]}: ${n}">
      <span>${MEMBER_TYPE_LABELS[k]}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${(n / max) * 100}%"></span></span>
      <b>${n}</b>
    </div>`).join('');
}

function paintPending() {
  const pending = membersData.filter((m) => m.status === 'pending');
  $('#pendingPanel').hidden = !pending.length;
  $('#pendingCount').textContent = pending.length;
  $('#pendingList').innerHTML = pending.map((m) => `
    <article class="pending-card" data-member="${escapeHtml(m.id)}">
      <div class="pending-top">
        ${memberAvatar(m)}
        <div>
          <strong>${escapeHtml(memberName(m))}</strong>
          <a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a>
        </div>
        <span class="pending-time" title="${escapeHtml(new Date(m.createdAt).toLocaleString('en-GB'))}">${relativeTime(m.createdAt)}</span>
      </div>
      <dl class="pending-facts">
        <div><dt>Membership</dt><dd>${MEMBER_TYPE_LABELS[m.memberType] || '–'}${m.otherType ? `: ${escapeHtml(m.otherType)}` : ''}</dd></div>
        <div><dt>Fee</dt><dd>${euro(m.fee)} / year · ${FEE_CATEGORY_LABELS[m.feeCategory] || ''}</dd></div>
        <div><dt>Born</dt><dd>${shortDate(m.birthDate)}</dd></div>
        <div><dt>Phone</dt><dd dir="ltr">${escapeHtml(m.phone || '–')}</dd></div>
        <div class="wide"><dt>Address</dt><dd>${escapeHtml(`${m.street}, ${m.zip} ${m.city}`)}</dd></div>
      </dl>
      <div class="pending-actions">
        <button class="btn btn-soft sm" type="button" data-member-open="${escapeHtml(m.id)}">Details</button>
        <button class="btn btn-soft sm danger-text" type="button" data-member-action="reject" data-id="${escapeHtml(m.id)}">Reject</button>
        <button class="btn btn-primary sm" type="button" data-member-action="approve" data-id="${escapeHtml(m.id)}"><svg class="ico"><use href="#i-check"/></svg> Approve</button>
      </div>
    </article>`).join('');
}

function filteredMembers() {
  const q = memberQuery.toLowerCase();
  return membersData
    .filter((m) => {
      if (memberFilter === 'all') return true;
      if (memberFilter === 'unpaid') return m.status === 'active' && m.finance.balance > 0;
      if (memberFilter === 'overdue') return m.status === 'active' && m.finance.status === 'overdue';
      return m.status === memberFilter;
    })
    .filter((m) => !q || [memberName(m), m.email, m.memberNumber, m.city, m.phone].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => {
      const order = { pending: 0, active: 1, deactivated: 2, rejected: 3 };
      return (order[a.status] - order[b.status]) || memberName(a).localeCompare(memberName(b));
    });
}

function paintMemberTable() {
  const count = (key) => membersData.filter((m) => {
    if (key === 'all') return true;
    if (key === 'unpaid') return m.status === 'active' && m.finance.balance > 0;
    if (key === 'overdue') return m.status === 'active' && m.finance.status === 'overdue';
    return m.status === key;
  }).length;
  $('#memberFilters').innerHTML = MEMBER_FILTERS.map(([key, label]) => `<button class="chip ${memberFilter === key ? 'active' : ''}" type="button" data-member-filter="${key}">${label}<span class="count">${count(key)}</span></button>`).join('');

  const rows = filteredMembers();
  $('#memberRows').innerHTML = rows.length ? rows.map((m) => {
    const f = m.finance;
    const active = m.status === 'active';
    return `
      <tr data-member-open="${escapeHtml(m.id)}" tabindex="0">
        <td><div class="m-cell">${memberAvatar(m)}<div><strong>${escapeHtml(memberName(m))}</strong><small>${escapeHtml(m.email)}</small></div></div></td>
        <td class="mono">${escapeHtml(m.memberNumber || '–')}</td>
        <td>${MEMBER_TYPE_LABELS[m.memberType] || '–'}</td>
        <td class="num">${euro(m.fee)}</td>
        <td class="num">${active ? euro(f.paidThisYear) : '–'}</td>
        <td class="num ${active && f.balance > 0 ? 'neg' : ''}">${active ? euro(Math.max(0, f.balance)) : '–'}</td>
        <td>${active && f.nextDueDate ? shortDate(f.nextDueDate) : '–'}</td>
        <td><div class="m-pills">${statusPill(m)}${payPill(m)}</div></td>
      </tr>`;
  }).join('') : `<tr><td colspan="8">${emptyState('i-users', membersData.length ? 'Nobody matches' : 'No members yet', membersData.length ? 'Try another filter or search.' : 'Applications from the website’s membership form appear here.')}</td></tr>`;
}

// ---------- Member drawer ----------
function openMemberDrawer(id) {
  const m = membersData.find((x) => x.id === id);
  if (!m) return closeMemberDrawer();
  drawerMemberId = id;
  const f = m.finance;
  const active = m.status === 'active';
  const today = new Date().toISOString().slice(0, 10);
  const actions = {
    pending: `<button class="btn btn-soft sm danger-text" type="button" data-member-action="reject" data-id="${m.id}">Reject</button>
              <button class="btn btn-primary sm" type="button" data-member-action="approve" data-id="${m.id}"><svg class="ico"><use href="#i-check"/></svg> Approve</button>`,
    active: `<button class="btn btn-soft sm danger-text" type="button" data-member-action="deactivate" data-id="${m.id}">Deactivate</button>`,
    deactivated: `<button class="btn btn-primary sm" type="button" data-member-action="reactivate" data-id="${m.id}">Reactivate</button>`,
    rejected: `<button class="btn btn-primary sm" type="button" data-member-action="reactivate" data-id="${m.id}">Approve after all</button>`
  }[m.status];

  $('#drawerBody').innerHTML = `
    <header class="dr-head">
      ${memberAvatar(m, 'lg')}
      <div>
        <h3 id="drawerTitle">${escapeHtml(memberName(m))}</h3>
        <a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a>
        <div class="m-pills">${statusPill(m)}${payPill(m)}${m.memberNumber ? `<span class="m-num">${escapeHtml(m.memberNumber)}</span>` : ''}</div>
      </div>
      <button class="mini-btn" type="button" data-drawer-close aria-label="Close"><svg class="ico"><use href="#i-x"/></svg></button>
    </header>
    <div class="dr-actions">${actions}</div>
    ${m.statusNote ? `<p class="dr-note"><b>${MEMBER_STATUS[m.status]?.label} note:</b> ${escapeHtml(m.statusNote)} <small>${m.statusChangedBy ? `by ${escapeHtml(m.statusChangedBy)}` : ''} ${m.statusChangedAt ? relativeTime(m.statusChangedAt) : ''}</small></p>` : ''}

    ${active ? `
    <section class="dr-section">
      <h4>Fees</h4>
      <div class="dr-stats">
        <div><small>Fee / year</small><b>${euro(f.fee)}</b></div>
        <div><small>Total paid</small><b>${euro(f.paid)}</b></div>
        <div class="${f.balance > 0 ? 'neg' : ''}"><small>Balance due</small><b>${euro(Math.max(0, f.balance))}</b></div>
        <div><small>Next due</small><b>${f.nextDueDate ? shortDate(f.nextDueDate) : '–'}</b></div>
      </div>
      <form class="dr-pay" id="payForm">
        <label class="input-label">Amount (€)<input name="amount" type="number" min="0.01" step="0.01" value="${f.balance > 0 ? f.balance : f.fee}" required /></label>
        <label class="input-label">Date<input name="date" type="date" value="${today}" max="${today}" required /></label>
        <label class="input-label">Method<select name="method">${Object.entries(METHOD_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="input-label wide">Note <small>(optional, the member can see it)</small><input name="note" maxlength="300" placeholder="e.g. Beitrag 2026" /></label>
        <button class="btn btn-primary" type="submit"><svg class="ico"><use href="#i-plus"/></svg> Record payment</button>
      </form>
      <div class="dr-payments">
        ${(m.payments || []).length ? m.payments.map((p) => `
          <div class="dr-payment">
            <span class="dr-pay-amount">${euro(p.amount)}</span>
            <span>${shortDate(p.date)} · ${METHOD_LABELS[p.method] || p.method}${p.note ? ` · ${escapeHtml(p.note)}` : ''}<small>recorded by ${escapeHtml(p.recordedBy || '–')}</small></span>
            <button class="mini-btn danger" type="button" data-payment-delete="${escapeHtml(p.id)}" title="Remove payment" aria-label="Remove payment"><svg class="ico"><use href="#i-trash"/></svg></button>
          </div>`).join('') : '<p class="hint">No payments recorded yet.</p>'}
      </div>
    </section>` : ''}

    <section class="dr-section">
      <h4>Details</h4>
      <form class="form-grid" id="memberEditForm">
        <label class="input-label">First name<input name="firstName" value="${escapeHtml(m.firstName)}" /></label>
        <label class="input-label">Last name<input name="lastName" value="${escapeHtml(m.lastName)}" /></label>
        <label class="input-label">Date of birth<input name="birthDate" type="date" value="${escapeHtml(m.birthDate)}" /></label>
        <label class="input-label">Phone<input name="phone" dir="ltr" value="${escapeHtml(m.phone)}" /></label>
        <label class="input-label full">Street &amp; house number<input name="street" value="${escapeHtml(m.street)}" /></label>
        <label class="input-label">Postcode<input name="zip" value="${escapeHtml(m.zip)}" /></label>
        <label class="input-label">City<input name="city" value="${escapeHtml(m.city)}" /></label>
        <label class="input-label">Membership<select name="memberType">${Object.entries(MEMBER_TYPE_LABELS).map(([v, l]) => `<option value="${v}" ${m.memberType === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="input-label">Fee category<select name="feeCategory">${Object.entries(FEE_CATEGORY_LABELS).map(([v, l]) => `<option value="${v}" ${m.feeCategory === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="input-label">Fee per year (€)<input name="fee" type="number" min="0" step="0.01" value="${m.fee}" /></label>
        ${active ? `<label class="input-label">Member since<input name="joinedAt" type="date" value="${escapeHtml(m.joinedAt || '')}" /></label>` : ''}
        <label class="input-label full">Admin notes <small>(only admins see this)</small><textarea name="adminNotes" rows="3">${escapeHtml(m.adminNotes)}</textarea></label>
        <div class="full dr-form-foot">
          <span class="hint">Applied ${relativeTime(m.createdAt)}${m.lastLogin ? ` · last sign-in ${relativeTime(m.lastLogin)}` : ''}</span>
          <button class="btn btn-primary" type="submit"><svg class="ico"><use href="#i-save"/></svg> Save details</button>
        </div>
      </form>
    </section>

    <section class="dr-section dr-danger">
      <button class="btn btn-danger" type="button" data-member-delete="${m.id}"><svg class="ico"><use href="#i-trash"/></svg> Delete member permanently</button>
    </section>`;
  $('#memberDrawer').hidden = false;
  document.body.classList.add('drawer-open');
}

function closeMemberDrawer() {
  drawerMemberId = null;
  $('#memberDrawer').hidden = true;
  document.body.classList.remove('drawer-open');
}

function repaintMembers() {
  paintMembersBadge();
  paintMemberKpis();
  paintFinanceChart();
  paintStatusBar();
  paintTypeBars();
  paintPending();
  paintMemberTable();
}

function replaceMember(updated) {
  const index = membersData.findIndex((m) => m.id === updated.id);
  if (index === -1) membersData.push(updated);
  else membersData[index] = updated;
  repaintMembers();
  if (drawerMemberId === updated.id) openMemberDrawer(updated.id);
}

// ---------- Approve / reject / deactivate / reactivate ----------
const MEMBER_ACTIONS = {
  approve: { title: 'Approve this application?', text: (m) => `${memberName(m)} gets a member number and can sign in to the member area.`, confirm: 'Approve', notify: true, reason: false, icon: '✓' },
  reject: { title: 'Reject this application?', text: (m) => `${memberName(m)} will not be able to sign in. You can still approve them later.`, confirm: 'Reject', notify: false, reason: true, icon: '!' },
  deactivate: { title: 'Deactivate this member?', text: (m) => `${memberName(m)} is signed out and cannot sign in until you reactivate the account. Payments and details are kept.`, confirm: 'Deactivate', notify: false, reason: true, icon: '!' },
  reactivate: { title: 'Reactivate this member?', text: (m) => `${memberName(m)} can sign in to the member area again.`, confirm: 'Reactivate', notify: true, reason: false, icon: '✓' }
};

function askMemberAction(action, id) {
  const m = membersData.find((x) => x.id === id);
  const def = MEMBER_ACTIONS[action];
  if (!m || !def) return;
  $('#maTitle').textContent = def.title;
  $('#maText').textContent = def.text(m);
  $('#maIcon').textContent = def.icon;
  $('#maIcon').classList.toggle('ok', def.icon === '✓');
  $('#maReasonWrap').hidden = !def.reason;
  $('#maReason').value = '';
  $('#maMessage').value = '';
  $('#maNotify').checked = def.notify && membersMailReady;
  $('#maNotify').disabled = !membersMailReady;
  $('#maMessageWrap').hidden = !$('#maNotify').checked;
  $('#maMailHint').textContent = membersMailReady
    ? 'The email is written in the language the member applied in. Your message is added as it is.'
    : 'Email is not set up yet (Settings → Email), so the member will not be notified.';
  $('#maConfirm').textContent = def.confirm;
  $('#maConfirm').className = `btn ${def.reason ? 'btn-danger' : 'btn-primary'}`;
  const form = $('#memberActionForm');
  form.dataset.action = action;
  form.dataset.id = id;
  $('#memberActionDialog').hidden = false;
  setTimeout(() => (def.reason ? $('#maReason') : $('#maConfirm')).focus(), 50);
}

$('#maNotify')?.addEventListener('change', (e) => { $('#maMessageWrap').hidden = !e.target.checked; });
$$('[data-action-cancel]').forEach((el) => el.addEventListener('click', () => { $('#memberActionDialog').hidden = true; }));

$('#memberActionForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const { action, id } = form.dataset;
  const button = $('#maConfirm');
  button.disabled = true;
  try {
    const data = await api(`members/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: { notify: $('#maNotify').checked, message: $('#maMessage').value.trim(), reason: $('#maReason').value.trim() }
    });
    $('#memberActionDialog').hidden = true;
    replaceMember(data.member);
    const done = { approve: 'Application approved', reject: 'Application rejected', deactivate: 'Member deactivated', reactivate: 'Member reactivated' }[action];
    if (data.mail?.sent) toast(`${done}. Email sent to ${data.member.email}.`);
    else if ($('#maNotify').checked) toast(`${done}, but the email could not be sent: ${data.mail?.reason || 'unknown error'}`, 'error');
    else toast(`${done}.`);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

// ---------- Events ----------
document.addEventListener('click', (e) => {
  if (!$('.view[data-view="members"]')?.classList.contains('active') && !e.target.closest('#memberDrawer')) return;
  const filter = e.target.closest('[data-member-filter]');
  if (filter) {
    memberFilter = filter.dataset.memberFilter;
    paintMemberTable();
    if (!filter.closest('#memberFilters')) $('#memberRows').closest('.panel').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    return;
  }
  const action = e.target.closest('[data-member-action]');
  if (action) {
    askMemberAction(action.dataset.memberAction, action.dataset.id);
    return;
  }
  const open = e.target.closest('[data-member-open]');
  if (open && !e.target.closest('a')) {
    openMemberDrawer(open.dataset.memberOpen);
    return;
  }
  if (e.target.closest('[data-drawer-close]')) closeMemberDrawer();
});

$('#memberRows')?.addEventListener('keydown', (e) => {
  const row = e.target.closest('[data-member-open]');
  if (row && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openMemberDrawer(row.dataset.memberOpen);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#memberActionDialog').hidden) $('#memberActionDialog').hidden = true;
  else if (!$('#memberDrawer').hidden) closeMemberDrawer();
});

$('#memberSearch')?.addEventListener('input', (e) => {
  memberQuery = e.target.value.trim();
  paintMemberTable();
});

$('#drawerBody')?.addEventListener('change', (e) => {
  // Picking a fee category fills in its standard fee
  if (e.target.name === 'feeCategory' && memberFees[e.target.value] !== undefined) {
    e.target.form.fee.value = memberFees[e.target.value];
  }
});

$('#drawerBody')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  try {
    if (form.id === 'payForm') {
      const data = await api(`members/${encodeURIComponent(drawerMemberId)}/payments`, {
        method: 'POST',
        body: { amount: Number(form.amount.value), date: form.date.value, method: form.method.value, note: form.note.value.trim() }
      });
      replaceMember(data.member);
      toast(`Payment of ${euro(form.amount.value)} recorded.`);
    }
    if (form.id === 'memberEditForm') {
      const body = Object.fromEntries(new FormData(form).entries());
      body.fee = Number(body.fee);
      const data = await api(`members/${encodeURIComponent(drawerMemberId)}`, { method: 'PUT', body });
      replaceMember(data.member);
      toast('Member details saved.');
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#drawerBody')?.addEventListener('click', async (e) => {
  const pay = e.target.closest('[data-payment-delete]');
  if (pay) {
    const ok = await confirmAction('Remove this payment?', 'The member’s balance and next due date are recalculated.', 'Remove');
    if (!ok) return;
    try {
      const data = await api(`members/${encodeURIComponent(drawerMemberId)}/payments/${encodeURIComponent(pay.dataset.paymentDelete)}`, { method: 'DELETE' });
      replaceMember(data.member);
      toast('Payment removed.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  const del = e.target.closest('[data-member-delete]');
  if (del) {
    const m = membersData.find((x) => x.id === del.dataset.memberDelete);
    const ok = await confirmAction('Delete this member permanently?', `${memberName(m)}, their payments and profile photo are removed for good. To keep the history, deactivate them instead.`, 'Delete');
    if (!ok) return;
    try {
      await api(`members/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      membersData = membersData.filter((x) => x.id !== m.id);
      closeMemberDrawer();
      repaintMembers();
      toast('Member deleted.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

$('#exportMembers')?.addEventListener('click', () => {
  const cols = ['Member number', 'Status', 'First name', 'Last name', 'Email', 'Phone', 'Street', 'Postcode', 'City', 'Date of birth', 'Membership', 'Fee category', 'Fee per year', 'Member since', 'Total paid', 'Paid this year', 'Balance', 'Next due', 'Payment status'];
  const rows = filteredMembers().map((m) => [
    m.memberNumber, MEMBER_STATUS[m.status]?.label, m.firstName, m.lastName, m.email, m.phone, m.street, m.zip, m.city, m.birthDate,
    MEMBER_TYPE_LABELS[m.memberType], FEE_CATEGORY_LABELS[m.feeCategory], m.fee, m.joinedAt || '', m.finance.paid, m.finance.paidThisYear,
    m.status === 'active' ? Math.max(0, m.finance.balance) : '', m.finance.nextDueDate || '', m.status === 'active' ? PAY_STATUS[m.finance.status]?.label : ''
  ]);
  const csv = [cols, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  downloadFile(`neuer-blick-members-${new Date().toISOString().slice(0, 10)}.csv`, `﻿${csv}`, 'text/csv;charset=utf-8');
});

// ==========================================================================
// VIEW: News & media (news, articles, videos, documents)
// ==========================================================================
const LIB_TYPES = {
  news: { single: 'news item', label: 'News', image: true },
  articles: { single: 'article', label: 'Articles', image: true, categories: { article: 'Article', educational: 'Educational', analysis: 'Analysis', writing: 'Writing' }, author: true },
  videos: { single: 'video', label: 'Videos', image: true, video: true },
  documents: { single: 'document', label: 'Documents & resolutions', image: true, categories: { report: 'Report', resolution: 'Resolution', announcement: 'Announcement', file: 'File' }, file: true }
};
const LIB_LANGS = [['fa', 'فارسی', 'rtl'], ['ps', 'پښتو', 'rtl'], ['de', 'Deutsch', 'ltr'], ['en', 'English', 'ltr']];
let libType = 'news';
let libQuery = '';
let libDraft = null;

function getLib(type) {
  const list = Array.isArray(content[type]) ? content[type] : (DEFAULT_LIBRARY[type] || []);
  return clone(list).filter((item) => item && item.id);
}

const firstText = (field) => (field && (field.fa || field.ps || field.de || field.en)) || '';
const todayIso = () => new Date().toISOString().slice(0, 10);

function youtubeThumb(url) {
  const match = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  return match ? `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg` : '';
}

const isVideoLink = (url) => Boolean(youtubeThumb(url)) || /vimeo\.com\/(video\/)?\d+/i.test(url) || /^(https?:\/\/|docs\/|images\/|media\/).+\.(mp4|webm|m4v|ogg)(\?.*)?$/i.test(url);

function renderLibraryView() {
  libDraft = null;
  $('#libEditor').hidden = true;
  $('#libEditor').innerHTML = '';
  paintLibList();
}

function paintLibList() {
  const def = LIB_TYPES[libType];
  Object.keys(LIB_TYPES).forEach((type) => { $(`[data-count="${type}"]`).textContent = getLib(type).length; });
  $$('#libTabs .seg-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.type === libType));
  $('#libAdd span').textContent = `Add ${def.single}`;
  $('#libListTitle').textContent = def.label;
  $('#libViewSite').href = `index.html#${libType}`;

  const q = libQuery.toLowerCase();
  const items = getLib(libType)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .filter((item) => !q || Object.values(item.title || {}).some((v) => String(v).toLowerCase().includes(q)));

  $('#libList').innerHTML = items.length ? items.map((item) => {
    const thumb = item.image || youtubeThumb(item.url);
    const ext = def.file ? ((String(item.url || '').match(/\.(\w+)$/) || [])[1] || 'file').toUpperCase().slice(0, 4) : '';
    const title = firstText(item.title) || '(untitled)';
    return `
      <div class="lib-row" data-id="${escapeHtml(item.id)}">
        <div class="lib-thumb">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" />` : `<span>${escapeHtml(ext || def.label[0])}</span>`}</div>
        <div class="lib-main">
          <strong dir="auto">${escapeHtml(title)}</strong>
          <div class="lib-meta-row">
            <span>${escapeHtml(item.date || '–')}</span>
            ${def.categories ? `<span class="lib-cat">${escapeHtml(def.categories[item.category] || Object.values(def.categories)[0])}</span>` : ''}
            <span class="lib-langs">${LIB_LANGS.map(([code]) => `<i class="${item.title?.[code] ? 'on' : ''}" title="${item.title?.[code] ? 'Written' : 'Missing'} in ${code.toUpperCase()}">${code.toUpperCase()}</i>`).join('')}</span>
          </div>
        </div>
        <div class="lib-actions-row">
          <button class="btn btn-soft sm" type="button" data-lib-edit="${escapeHtml(item.id)}">Edit</button>
          <button class="mini-btn danger" type="button" data-lib-delete="${escapeHtml(item.id)}" title="Delete" aria-label="Delete"><svg class="ico"><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
  }).join('') : emptyState('i-sparkle', q ? 'Nothing matches' : `No ${def.label.toLowerCase()} yet`, q ? 'Try another search.' : `Click “Add ${def.single}” to publish the first one.`);
}

function openLibEditor(item) {
  const def = LIB_TYPES[libType];
  libDraft = item ? clone(item) : { id: `${libType}-${Date.now().toString(36)}`, date: todayIso(), title: {}, text: {}, ...(def.categories ? { category: Object.keys(def.categories)[0] } : {}) };
  libDraft.title = libDraft.title || {};
  libDraft.text = libDraft.text || {};
  const isNew = !item;
  const textLabel = libType === 'videos' ? 'Description' : 'Text';

  $('#libEditor').innerHTML = `
    <div class="panel-head">
      <div>
        <h3>${isNew ? `New ${def.single}` : `Edit ${def.single}`}</h3>
        <p>Fill in at least one language. Blank lines in the text start a new paragraph.</p>
      </div>
      <button class="mini-btn" type="button" data-lib-cancel title="Close" aria-label="Close"><svg class="ico"><use href="#i-x"/></svg></button>
    </div>
    <div class="form-grid">
      <label class="input-label">Date<input type="date" data-lib-field="date" value="${escapeHtml(libDraft.date || '')}" /></label>
      ${def.categories ? `<label class="input-label">Type<select data-lib-field="category">${Object.entries(def.categories).map(([v, l]) => `<option value="${v}" ${libDraft.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
      ${def.author ? `<label class="input-label">Author <small>(optional)</small><input data-lib-field="author" value="${escapeHtml(libDraft.author || '')}" placeholder="Neuer Blick Verein e.V." /></label>` : ''}
      <div class="input-label full">${def.video ? 'Video <small>upload an MP4/WebM file, or paste a YouTube or Vimeo link</small>' : 'Video <small>(optional) upload an MP4/WebM file, or paste a YouTube or Vimeo link</small>'}
        <div class="lib-file">
          <input data-lib-field="${def.video ? 'url' : 'video'}" dir="ltr" value="${escapeHtml((def.video ? libDraft.url : libDraft.video) || '')}" placeholder="https://www.youtube.com/watch?v=… or media/…" />
          <label class="btn btn-soft"><svg class="ico"><use href="#i-upload"/></svg> Upload video<input type="file" id="libVideoInput" accept="video/mp4,video/webm,.m4v" hidden /></label>
        </div>
        <div class="lib-progress" id="libVideoProgress" hidden><span></span><b></b></div>
      </div>
      ${def.file ? `
      <div class="input-label full">File <small>(optional) PDF, Word, Excel or PowerPoint, up to 300 MB</small>
        <div class="lib-file">
          <input data-lib-field="url" dir="ltr" value="${escapeHtml(libDraft.url || '')}" placeholder="docs/… or https://…" />
          <label class="btn btn-soft"><svg class="ico"><use href="#i-upload"/></svg> Upload file<input type="file" id="libFileInput" accept=".pdf,.doc,.docx,.xlsx,.pptx" hidden /></label>
        </div>
        <div class="lib-progress" id="libFileProgress" hidden><span></span><b></b></div>
      </div>` : ''}
      <div class="input-label full">More pictures <small>(optional) shown as a gallery inside the item</small>
        <div class="lib-gallery" id="libGallery"></div>
        <div class="lib-image-actions">
          <label class="btn btn-soft sm"><svg class="ico"><use href="#i-upload"/></svg> Upload pictures<input type="file" id="libGalleryInput" accept="image/png,image/jpeg,image/webp,image/avif" multiple hidden /></label>
          <button class="btn btn-soft sm" type="button" id="libGalleryPick"><svg class="ico"><use href="#i-grid"/></svg> From folder</button>
        </div>
      </div>
      ${def.image ? `
      <div class="input-label full">Cover picture ${def.video ? '<small>(optional, YouTube videos get their own picture)</small>' : '<small>(optional)</small>'}
        <div class="lib-image">
          <div class="lib-image-preview" id="libImagePreview"></div>
          <div class="lib-image-actions">
            <label class="btn btn-soft sm"><svg class="ico"><use href="#i-upload"/></svg> Upload<input type="file" id="libImageInput" accept="image/png,image/jpeg,image/webp,image/avif" hidden /></label>
            <button class="btn btn-soft sm" type="button" id="libImagePick"><svg class="ico"><use href="#i-grid"/></svg> Folder</button>
            <button class="btn btn-soft sm" type="button" id="libImageClear"><svg class="ico"><use href="#i-x"/></svg> Remove</button>
          </div>
        </div>
      </div>` : ''}
    </div>

    <div class="lib-lang-tabs" role="tablist">
      ${LIB_LANGS.map(([code, name], i) => `<button type="button" class="lib-lang ${i === 0 ? 'active' : ''}" data-lang-tab="${code}" role="tab"><i></i>${name}</button>`).join('')}
    </div>
    ${LIB_LANGS.map(([code, , dir], i) => `
      <div class="lib-lang-panel" data-lang-panel="${code}" ${i === 0 ? '' : 'hidden'}>
        <label class="input-label">Title<input data-lib-lang="title" data-code="${code}" dir="${dir}" value="${escapeHtml(libDraft.title[code] || '')}" /></label>
        <label class="input-label">${textLabel}<textarea data-lib-lang="text" data-code="${code}" dir="${dir}" rows="${libType === 'videos' ? 4 : 9}">${escapeHtml(libDraft.text[code] || '')}</textarea></label>
      </div>`).join('')}

    <div class="lib-editor-foot">
      ${isNew ? '' : '<button class="btn btn-danger" type="button" data-lib-delete-draft><svg class="ico"><use href="#i-trash"/></svg> Delete</button>'}
      <span class="lib-spacer"></span>
      <button class="btn btn-soft" type="button" data-lib-cancel>Cancel</button>
      <button class="btn btn-primary" type="button" id="libSave"><svg class="ico"><use href="#i-save"/></svg> ${isNew ? 'Publish' : 'Save changes'}</button>
    </div>`;
  $('#libEditor').hidden = false;
  paintLibImage();
  paintLibGallery();
  markLangTabs();
  $('#libEditor').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
}

function paintLibImage() {
  const box = $('#libImagePreview');
  if (!box) return;
  const src = libDraft.image || youtubeThumb(libDraft.url);
  box.innerHTML = src ? `<img src="${escapeHtml(src)}" alt="" />` : '<span>No picture</span>';
  $('#libImageClear').hidden = !libDraft.image;
}

function paintLibGallery() {
  const box = $('#libGallery');
  if (!box) return;
  const images = Array.isArray(libDraft.images) ? libDraft.images : [];
  box.innerHTML = images.length
    ? images.map((src, i) => `
        <div class="lib-gallery-item">
          <img src="${escapeHtml(src)}" alt="" loading="lazy" />
          <button type="button" class="mini-btn" data-gallery-remove="${i}" title="Remove picture" aria-label="Remove picture"><svg class="ico"><use href="#i-x"/></svg></button>
        </div>`).join('')
    : '<span class="lib-gallery-empty">No extra pictures yet</span>';
}

function addLibImages(paths) {
  libDraft.images = [...(Array.isArray(libDraft.images) ? libDraft.images : []), ...paths];
  paintLibGallery();
}

function markLangTabs() {
  $$('#libEditor [data-lang-tab]').forEach((tab) => tab.classList.toggle('filled', Boolean(libDraft.title[tab.dataset.langTab]?.trim())));
}

// Streams a large file to the server with a progress bar (videos up to 300 MB)
function uploadLargeFile(file, progressEl) {
  return new Promise((resolve, reject) => {
    if (window.NB_DEMO) {
      reject(new Error('Video and document uploads need the real server. In the demo, paste a YouTube link instead.'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload-file?name=${encodeURIComponent(file.name)}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    if (progressEl) {
      progressEl.hidden = false;
      progressEl.querySelector('span').style.width = '0%';
      progressEl.querySelector('b').textContent = '0%';
    }
    xhr.upload.onprogress = (e) => {
      if (!progressEl || !e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      progressEl.querySelector('span').style.width = `${pct}%`;
      progressEl.querySelector('b').textContent = `${pct}%`;
    };
    xhr.onload = () => {
      if (progressEl) progressEl.hidden = true;
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
      if (xhr.status === 401) sessionExpired();
      if (xhr.status >= 200 && xhr.status < 300 && data?.path) resolve(data.path);
      else reject(new Error(data?.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => {
      if (progressEl) progressEl.hidden = true;
      reject(new Error(SERVER_HINT));
    };
    xhr.send(file);
  });
}

async function saveLibList(list, button) {
  const ok = await saveContent(libType, list, button);
  if (ok) paintLibList();
  return ok;
}

async function saveLibDraft() {
  const def = LIB_TYPES[libType];
  LIB_LANGS.forEach(([code]) => {
    if (!libDraft.title[code]?.trim()) delete libDraft.title[code];
    if (!libDraft.text[code]?.trim()) delete libDraft.text[code];
  });
  if (!Object.keys(libDraft.title).length) {
    toast('Please write a title in at least one language.', 'error');
    $('#libEditor [data-lib-lang="title"]')?.focus();
    return;
  }
  if (def.video && !isVideoLink(libDraft.url || '')) {
    toast('Please upload a video, or paste a YouTube or Vimeo link.', 'error');
    return;
  }
  if (!def.video && String(libDraft.video || '').trim() && !isVideoLink(libDraft.video)) {
    toast('The video must be an uploaded file or a YouTube or Vimeo link.', 'error');
    return;
  }
  if (def.file && String(libDraft.url || '').trim() && !/^(https?:\/\/|docs\/|images\/|media\/)/i.test(libDraft.url)) {
    toast('The file link must start with https:// or be an uploaded file.', 'error');
    return;
  }
  ['url', 'image', 'author', 'video'].forEach((key) => { if (!String(libDraft[key] || '').trim()) delete libDraft[key]; });
  if (!libDraft.images?.length) delete libDraft.images;

  const list = getLib(libType);
  const index = list.findIndex((item) => item.id === libDraft.id);
  const isNew = index === -1;
  if (isNew) list.push(libDraft);
  else list[index] = libDraft;
  if (await saveLibList(list, $('#libSave'))) {
    toast(isNew ? `Published. The ${def.single} is now on the website.` : 'Changes saved.');
    renderLibraryView();
  }
}

async function deleteLibItem(id) {
  const def = LIB_TYPES[libType];
  const item = getLib(libType).find((entry) => entry.id === id);
  if (!item) return;
  const ok = await confirmAction(`Delete this ${def.single}?`, `“${firstText(item.title) || 'Untitled'}” will be removed from the website.`, 'Delete');
  if (!ok) return;
  if (await saveLibList(getLib(libType).filter((entry) => entry.id !== id))) {
    toast(`${def.single[0].toUpperCase()}${def.single.slice(1)} deleted.`);
    renderLibraryView();
  }
}

$('#libTabs')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-type]');
  if (!btn || btn.dataset.type === libType) return;
  if (libDraft && !(await confirmAction('Discard this draft?', 'The item you are editing has not been saved.', 'Discard'))) return;
  libType = btn.dataset.type;
  renderLibraryView();
});

$('#libSearch')?.addEventListener('input', (e) => {
  libQuery = e.target.value.trim();
  paintLibList();
});

$('#libAdd')?.addEventListener('click', () => openLibEditor(null));

$('#libList')?.addEventListener('click', (e) => {
  const edit = e.target.closest('[data-lib-edit]');
  const del = e.target.closest('[data-lib-delete]');
  if (edit) openLibEditor(getLib(libType).find((item) => item.id === edit.dataset.libEdit));
  if (del) deleteLibItem(del.dataset.libDelete);
});

$('#libEditor')?.addEventListener('input', (e) => {
  if (!libDraft) return;
  const field = e.target.closest('[data-lib-field]');
  const lang = e.target.closest('[data-lib-lang]');
  if (field) {
    libDraft[field.dataset.libField] = field.value;
    if (field.dataset.libField === 'url') paintLibImage();
  }
  if (lang) {
    libDraft[lang.dataset.libLang][lang.dataset.code] = lang.value;
    markLangTabs();
  }
});

$('#libEditor')?.addEventListener('change', async (e) => {
  if (!libDraft) return;
  if (e.target.id === 'libImageInput' && e.target.files[0]) {
    const file = e.target.files[0];
    e.target.value = '';
    try {
      libDraft.image = await uploadImage(file, 1600);
      paintLibImage();
      toast('Picture uploaded.');
    } catch (err) {
      toast(err.message || 'That picture could not be uploaded.', 'error');
    }
  }
  if (e.target.id === 'libGalleryInput' && e.target.files.length) {
    const files = [...e.target.files];
    e.target.value = '';
    const uploaded = [];
    for (const file of files) {
      try {
        uploaded.push(await uploadImage(file, 1800));
      } catch (err) {
        toast(`${file.name}: ${err.message}`, 'error');
      }
    }
    if (uploaded.length) {
      addLibImages(uploaded);
      toast(`${uploaded.length} picture${uploaded.length === 1 ? '' : 's'} added.`);
    }
  }
  if (e.target.id === 'libVideoInput' && e.target.files[0]) {
    const file = e.target.files[0];
    e.target.value = '';
    const field = LIB_TYPES[libType].video ? 'url' : 'video';
    try {
      const path = await uploadLargeFile(file, $('#libVideoProgress'));
      libDraft[field] = path;
      $(`#libEditor [data-lib-field="${field}"]`).value = path;
      toast('Video uploaded.');
    } catch (err) {
      toast(err.message || 'That video could not be uploaded.', 'error');
    }
  }
  if (e.target.id === 'libFileInput' && e.target.files[0]) {
    const file = e.target.files[0];
    e.target.value = '';
    try {
      const path = await uploadLargeFile(file, $('#libFileProgress'));
      libDraft.url = path;
      $('#libEditor [data-lib-field="url"]').value = path;
      if (!Object.keys(libDraft.title).length) {
        const name = file.name.replace(/\.\w+$/, '').replace(/[_-]+/g, ' ');
        libDraft.title.de = name;
        $('#libEditor [data-lib-lang="title"][data-code="de"]').value = name;
        markLangTabs();
      }
      toast('File uploaded.');
    } catch (err) {
      toast(err.message || 'That file could not be uploaded.', 'error');
    }
  }
});

$('#libEditor')?.addEventListener('click', async (e) => {
  if (!libDraft) return;
  const tab = e.target.closest('[data-lang-tab]');
  if (tab) {
    $$('#libEditor [data-lang-tab]').forEach((t) => t.classList.toggle('active', t === tab));
    $$('#libEditor [data-lang-panel]').forEach((p) => { p.hidden = p.dataset.langPanel !== tab.dataset.langTab; });
    $(`#libEditor [data-lang-panel="${tab.dataset.langTab}"] input`)?.focus();
    return;
  }
  if (e.target.closest('#libImagePick')) {
    const path = await pickFromLibrary();
    if (path) {
      libDraft.image = path;
      paintLibImage();
    }
    return;
  }
  if (e.target.closest('#libImageClear')) {
    delete libDraft.image;
    paintLibImage();
    return;
  }
  if (e.target.closest('#libGalleryPick')) {
    const path = await pickFromLibrary();
    if (path) addLibImages([path]);
    return;
  }
  const removePic = e.target.closest('[data-gallery-remove]');
  if (removePic) {
    libDraft.images.splice(Number(removePic.dataset.galleryRemove), 1);
    paintLibGallery();
    return;
  }
  if (e.target.closest('[data-lib-cancel]')) {
    renderLibraryView();
    return;
  }
  if (e.target.closest('[data-lib-delete-draft]')) {
    deleteLibItem(libDraft.id);
    return;
  }
  if (e.target.closest('#libSave')) saveLibDraft();
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
        items.push({ title: '', titleDe: '', titleEn: '', titlePs: '', ...entry, url: await toFile(entry.url, `gallery-${i + 1}`) });
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
    content = await api('content', { method: 'PUT', body: Object.fromEntries(['overrides', 'messages', 'contact', 'social', 'images', 'gallery', 'event', 'stats', 'news', 'articles', 'videos', 'documents'].map((k) => [k, null])) });
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
