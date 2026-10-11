/* ==========================================================================
   Neuer Blick Verein e.V. - Member area (member.html)
   Sign in, see membership status, fees and payments, edit your details.
   ========================================================================== */
const TOKEN_KEY = 'nbMemberToken';
const RTL = ['fa', 'ps'];
const LOCALES = { fa: 'fa-AF-u-ca-gregory', ps: 'ps-AF-u-ca-gregory', de: 'de-DE', en: 'en-GB' };
const TYPE_KEYS = { ordinary: 'jfTypeOrdinary', supporting: 'jfTypeSupporting', family: 'jfTypeFamily', other: 'jfTypeOther' };
const FEE_KEYS = { employed: 'jfFee1', 'low-income': 'jfFee2', student: 'jfFee3', family: 'jfFee4' };
const METHOD_KEYS = { transfer: 'mbMethodTransfer', cash: 'mbMethodCash', other: 'mbMethodOther' };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get(key) {
    try { return sessionStorage.getItem(key) || localStorage.getItem(key); } catch (e) { return null; }
  },
  set(key, value, persist) {
    try {
      (persist ? localStorage : sessionStorage).setItem(key, value);
    } catch (e) { /* storage blocked: stays signed in for this page only */ }
  },
  clear(key) {
    try {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    } catch (e) { /* ignore */ }
  },
  raw(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  setRaw(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }
};

let lang = translations[store.raw('newerBlickLang')] ? store.raw('newerBlickLang') : 'fa';
let token = store.get(TOKEN_KEY);
let member = null;
let siteContent = {};

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stripTags = (html) => String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function t(key) {
  const overrides = siteContent.overrides?.[lang] || {};
  return overrides[key] ?? translations[lang]?.[key] ?? translations.en[key] ?? key;
}

const money = (n) => new Intl.NumberFormat(LOCALES[lang], { style: 'currency', currency: 'EUR', maximumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n) || 0);
const num = (n) => new Intl.NumberFormat(LOCALES[lang]).format(n);

function formatDate(iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) {
  if (!iso) return '–';
  const d = new Date(String(iso).length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '–' : new Intl.DateTimeFormat(LOCALES[lang], opts).format(d);
}

function addYears(iso, years) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

const daysUntil = (iso) => Math.round((new Date(`${iso}T12:00:00`) - new Date(new Date().toDateString() + ' 12:00')) / 86400000);

let toastTimer;
function toast(message, type = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `mb-toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await response.json(); } catch (e) { /* empty */ }
  if (!response.ok) {
    if (response.status === 401 && path !== 'member/login') signOut(false);
    throw Object.assign(new Error(data?.error || `HTTP ${response.status}`), { status: response.status, code: data?.code });
  }
  return data;
}

function setBusy(form, busy) {
  const btn = $('button[type="submit"]', form);
  btn.disabled = busy;
  btn.classList.toggle('loading', busy);
}

// ---------- Language & theme ----------
function applyLanguage() {
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.includes(lang) ? 'rtl' : 'ltr';
  $$('[data-i18n]').forEach((el) => {
    const value = t(el.dataset.i18n);
    if (value) el.innerHTML = value;
  });
  $$('.mb-langs button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
  document.title = `${stripTags(t('mbLoginTitle'))} | Neuer Blick Verein e.V.`;
  if (member) renderMember();
}

$$('.mb-langs button').forEach((btn) => btn.addEventListener('click', () => {
  lang = btn.dataset.lang;
  store.setRaw('newerBlickLang', lang);
  applyLanguage();
}));

if (store.raw('newerBlickTheme') === 'dark') document.body.classList.add('dark');
$('#themeToggle').addEventListener('click', () => {
  const dark = document.body.classList.toggle('dark');
  store.setRaw('newerBlickTheme', dark ? 'dark' : 'light');
});

// ---------- Sign in ----------
function showLogin() {
  $('#appView').hidden = true;
  $('#loginView').hidden = false;
  setTimeout(() => $('#loginForm [name="email"]').focus(), 50);
}

function signOut(callServer = true) {
  if (callServer && token) api('member/logout', { method: 'POST' }).catch(() => {});
  token = null;
  member = null;
  store.clear(TOKEN_KEY);
  showLogin();
}

$('[data-toggle-pass]').addEventListener('click', (e) => {
  const input = e.currentTarget.previousElementSibling;
  input.type = input.type === 'password' ? 'text' : 'password';
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const error = $('#loginError');
  error.hidden = true;
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email || !password) {
    error.textContent = stripTags(t('jfRequired'));
    error.hidden = false;
    return;
  }
  setBusy(form, true);
  try {
    const data = await api('member/login', { method: 'POST', body: { email, password, remember: form.remember.checked } });
    token = data.token;
    store.set(TOKEN_KEY, token, form.remember.checked);
    member = data.member;
    form.reset();
    showApp();
  } catch (err) {
    const key = { pending: 'mbErrPending', deactivated: 'mbErrDeactivated', rejected: 'mbErrRejected', locked: 'mbErrLocked', credentials: 'mbErrCredentials' }[err.code] || 'sendError';
    error.textContent = stripTags(t(key));
    error.className = `mb-alert ${err.code === 'pending' ? 'info' : ''}`;
    error.hidden = false;
  } finally {
    setBusy(form, false);
  }
});

// ---------- Member area ----------
function showApp() {
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  renderMember();
}

function paintAvatar() {
  const el = $('#avatar');
  if (member.avatar) {
    el.innerHTML = `<img src="${escapeHtml(member.avatar)}" alt="" />`;
  } else {
    el.textContent = `${member.firstName?.[0] || ''}${member.lastName?.[0] || ''}`.toUpperCase();
  }
}

function renderMember() {
  const f = member.finance;
  const name = `${member.firstName} ${member.lastName}`.trim();
  paintAvatar();
  $('#helloTitle').textContent = stripTags(t('mbHello')).replace('{name}', member.firstName);
  $('#heroNumber').textContent = member.memberNumber || '–';

  const statusKey = { paid: 'mbPaid', due: 'mbDue', overdue: 'mbOverdue', free: 'mbFree' }[f.status] || 'mbPaid';
  const chip = $('#payChip');
  chip.className = `mb-chip mb-chip-${f.status}`;
  chip.textContent = stripTags(t(statusKey));

  // Stats
  $('#statFee').textContent = money(f.fee);
  $('#statFeeCat').textContent = stripTags(t(FEE_KEYS[member.feeCategory] || 'jfFee1'));
  $('#statPaid').textContent = money(f.paid);
  $('#statPaidYear').textContent = money(f.paidThisYear);
  $('#statBalance').textContent = money(Math.max(0, f.balance));
  $('#balanceCard').classList.toggle('is-due', f.balance > 0);
  $('#statBalanceNote').textContent = f.balance > 0 ? stripTags(t(statusKey)) : (f.balance < 0 ? `+${money(-f.balance)}` : stripTags(t('mbPaid')));

  const ring = $('#dueRing');
  const circumference = 2 * Math.PI * 27;
  ring.style.strokeDasharray = `${circumference}`;
  if (f.nextDueDate) {
    const days = daysUntil(f.nextDueDate);
    $('#statNextDue').textContent = formatDate(f.nextDueDate);
    $('#statNextDueNote').textContent = days === 0 ? stripTags(t('mbToday'))
      : days > 0 ? stripTags(t('mbDaysLeft')).replace('{n}', num(days))
        : stripTags(t('mbDaysLate')).replace('{n}', num(-days));
    const remaining = Math.max(0, Math.min(1, days / 365));
    ring.style.strokeDashoffset = `${circumference * (1 - (days >= 0 ? remaining : 1))}`;
    ring.classList.toggle('late', days < 0 || f.balance > 0);
  } else {
    $('#statNextDue').textContent = '–';
    $('#statNextDueNote').textContent = stripTags(t(statusKey));
    ring.style.strokeDashoffset = '0';
  }

  // Membership card
  $('#cardName').textContent = name;
  $('#cardNumber').textContent = member.memberNumber || '';
  $('#cardType').textContent = stripTags(t(TYPE_KEYS[member.memberType] || 'jfTypeOrdinary'));
  $('#cardSince').textContent = formatDate(member.joinedAt, { month: 'short', year: 'numeric' });
  $('#cardValid').textContent = f.status === 'free' ? '∞' : (f.balance > 0 ? '–' : formatDate(f.nextDueDate, { month: 'short', year: 'numeric' }));
  $('#memberCard').classList.toggle('is-due', f.balance > 0);

  $('#payRef').textContent = `Mitgliedsbeitrag ${member.memberNumber} ${name}`;
  renderEvent();
  renderPayments();
  renderProfile();
}

function renderEvent() {
  const event = { ...DEFAULT_EVENT, ...(siteContent.event || {}) };
  const start = new Date(event.date);
  const valid = !Number.isNaN(start.getTime());
  $('#evDay').textContent = valid ? new Intl.DateTimeFormat(LOCALES[lang], { day: 'numeric' }).format(start) : '–';
  $('#evMonth').textContent = valid ? new Intl.DateTimeFormat(LOCALES[lang], { month: 'short' }).format(start) : '';
  $('#evWhen').textContent = valid ? new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(start) : stripTags(t('cdSoon'));
}

function renderPayments() {
  const f = member.finance;
  // One chip per membership year: covered by payments or still open
  const covered = f.fee > 0 ? Math.floor(f.paid / f.fee + 1e-9) : Infinity;
  const years = member.joinedAt && f.fee > 0 ? Math.max(f.periods, covered + 1, 1) : 0;
  $('#yearsList').innerHTML = Array.from({ length: Math.min(years, 12) }, (_, i) => {
    const from = addYears(member.joinedAt, i);
    const to = addYears(member.joinedAt, i + 1);
    const paid = i < covered;
    const future = i >= f.periods;
    return `
      <div class="mb-year ${paid ? 'paid' : future ? 'future' : 'open'}">
        <b>${paid ? '✓' : future ? '·' : '!'}</b>
        <span>${formatDate(from, { month: 'short', year: 'numeric' })} – ${formatDate(to, { month: 'short', year: 'numeric' })}</span>
        <small>${stripTags(t(paid ? 'mbPaid' : future ? 'mbNextDue' : 'mbDue'))}</small>
      </div>`;
  }).join('');

  $('#paymentsBody').innerHTML = member.payments.length
    ? member.payments.map((p) => `
        <tr>
          <td>${formatDate(p.date)}</td>
          <td class="mb-amount">${money(p.amount)}</td>
          <td>${escapeHtml(stripTags(t(METHOD_KEYS[p.method] || 'mbMethodOther')))}</td>
          <td dir="auto">${escapeHtml(p.note || '')}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" class="mb-empty">${escapeHtml(stripTags(t('mbNoPayments')))}</td></tr>`;
}

function renderProfile() {
  $('#pfName').textContent = `${member.firstName} ${member.lastName}`;
  $('#pfEmail').textContent = member.email;
  $('#pfBirth').textContent = formatDate(member.birthDate);
  $('#pfType').textContent = stripTags(t(TYPE_KEYS[member.memberType] || 'jfTypeOrdinary'));
  const form = $('#detailsForm');
  ['phone', 'street', 'zip', 'city'].forEach((key) => {
    if (document.activeElement !== form[key]) form[key].value = member[key] || '';
  });
}

// Tabs
$$('.mb-tabs button').forEach((btn) => btn.addEventListener('click', () => {
  $$('.mb-tabs button').forEach((b) => b.classList.toggle('active', b === btn));
  $$('.mb-tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === btn.dataset.tab));
}));

$('#logoutBtn').addEventListener('click', () => signOut());

document.addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy-from]');
  if (!copy) return;
  const text = $(`#${copy.dataset.copyFrom}`).textContent.trim();
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  toast(stripTags(t('copied')));
});

// Profile photo: cropped to a square and resized in the browser before upload
function squareImage(file, size = 400) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    img.src = url;
  });
}

$('#avatarInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('#avatar').classList.add('busy');
  try {
    const data = await api('member/avatar', { method: 'POST', body: { data: await squareImage(file) } });
    member = data.member;
    paintAvatar();
    toast(stripTags(t('mbPhotoSaved')));
  } catch (err) {
    toast(stripTags(t('sendError')), 'error');
  } finally {
    $('#avatar').classList.remove('busy');
  }
});

$('#detailsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const body = Object.fromEntries(['phone', 'street', 'zip', 'city'].map((k) => [k, form[k].value.trim()]));
  if (!body.street || !body.zip || !body.city) {
    toast(stripTags(t('jfRequired')), 'error');
    return;
  }
  setBusy(form, true);
  try {
    member = (await api('member/me', { method: 'PUT', body: { ...body, lang } })).member;
    renderMember();
    toast(stripTags(t('mbSaved')));
  } catch (err) {
    toast(err.message || stripTags(t('sendError')), 'error');
  } finally {
    setBusy(form, false);
  }
});

$('#passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  if (form.next.value.length < 8) return toast(stripTags(t('jfErrShort')), 'error');
  if (form.next.value !== form.repeat.value) return toast(stripTags(t('jfErrMismatch')), 'error');
  setBusy(form, true);
  try {
    const data = await api('member/password', { method: 'POST', body: { current: form.current.value, next: form.next.value } });
    token = data.token;
    store.set(TOKEN_KEY, token, Boolean(store.raw(TOKEN_KEY)));
    form.reset();
    toast(stripTags(t('mbPasswordSaved')));
  } catch (err) {
    toast(stripTags(t(err.code === 'current' ? 'mbErrCurrent' : err.code === 'password' ? 'jfErrShort' : 'sendError')), 'error');
  } finally {
    setBusy(form, false);
  }
});

// ---------- Start ----------
(async () => {
  try {
    siteContent = await (await fetch('/api/content', { cache: 'no-store' })).json();
  } catch (e) { /* defaults */ }
  applyLanguage();
  if (!token) return showLogin();
  try {
    member = (await api('member/me')).member;
    showApp();
  } catch (e) {
    showLogin();
  }
})();
