let currentLanguage = 'fa';
const languageLabels = { fa: '🇦🇫', de: '🇩🇪', en: '🇬🇧' };
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// ==========================================================================
// Safe Storage Helpers
// ==========================================================================
const store = {
  raw(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  get(key, fallback = null) {
    const raw = this.raw(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }
};

const siteChannel = 'BroadcastChannel' in window ? new BroadcastChannel('newer-blick-site') : null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stripTags(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

const pad2 = (n) => String(n).padStart(2, '0');

const savedLanguage = store.raw('newerBlickLang');
if (translations[savedLanguage]) currentLanguage = savedLanguage;

// ==========================================================================
// Translation Rendering
// ==========================================================================
let dictionary = translations[currentLanguage];

// ==========================================================================
// Site Content (saved by the Content Studio in data/content.json)
// ==========================================================================
let siteContent = {};

async function loadContent() {
  try {
    const response = await fetch('/api/content', { cache: 'no-store' });
    if (response.ok) siteContent = await response.json();
  } catch (e) {
    // Opened without the server (e.g. double-clicked file): use the defaults
  }
}

const getContact = () => ({ ...DEFAULT_CONTACT, ...(siteContent.contact || {}) });
const getSocial = () => ({ ...DEFAULT_SOCIAL, ...(siteContent.social || {}) });
const getImages = () => ({ ...DEFAULT_IMAGES, ...(siteContent.images || {}) });

function buildDictionary() {
  const overrides = siteContent.overrides || {};
  const messages = siteContent.messages || {};
  const base = translations[currentLanguage] || translations.en;
  return {
    ...base,
    ...(overrides[currentLanguage] || {}),
    ...(messages.one ? { messageText: messages.one } : {}),
    ...(messages.two ? { messageTextTwo: messages.two } : {}),
    ...(messages.three ? { messageTextThree: messages.three } : {}),
    ...(messages.four ? { messageTextFour: messages.four } : {})
  };
}

// Contact details, social links and photos edited in the studio
function applyContactAndMedia() {
  const c = getContact();
  const phoneDigits = c.phone.replace(/[^\d+]/g, '');
  const whatsapp = (c.whatsapp || c.phone).replace(/\D/g, '');
  const addressLine = [c.addressStreet, c.addressCity].filter(Boolean).join(', ');
  const fullAddress = [c.addressStreet, c.addressCity, c.addressCountry].filter(Boolean).join(', ');
  const values = {
    phone: c.phone,
    email: c.email,
    addressLine,
    fullAddress
  };
  const hrefs = {
    phone: `tel:${phoneDigits}`,
    email: `mailto:${c.email}`,
    whatsapp: `https://wa.me/${whatsapp}`,
    directions: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}`
  };

  document.querySelectorAll('[data-contact-text]').forEach((el) => { el.textContent = values[el.dataset.contactText] || ''; });
  document.querySelectorAll('[data-contact-href]').forEach((el) => {
    el.href = hrefs[el.dataset.contactHref] || el.href;
    el.hidden = (el.dataset.contactHref === 'phone' || el.dataset.contactHref === 'whatsapp') ? !c.phone : (el.dataset.contactHref === 'email' ? !c.email : false);
  });
  document.querySelectorAll('[data-contact-html="address"]').forEach((el) => {
    el.innerHTML = [c.addressStreet, [c.addressCity, c.addressCountry].filter(Boolean).join(', ')].filter(Boolean).map(escapeHtml).join('<br />');
  });
  document.querySelectorAll('[data-copy-contact]').forEach((el) => { el.dataset.copy = values[el.dataset.copyContact] || ''; });
  document.querySelectorAll('[data-contact-map]').forEach((el) => {
    const src = `https://www.google.com/maps?q=${encodeURIComponent(fullAddress)}&output=embed`;
    if (el.src !== src) el.src = src;
  });

  const social = getSocial();
  document.querySelectorAll('[data-social]').forEach((el) => {
    const link = social[el.dataset.social];
    el.hidden = !link;
    if (link) el.href = link;
  });

  const images = getImages();
  document.querySelectorAll('[data-img]').forEach((img) => {
    const src = images[img.dataset.img];
    if (src && img.getAttribute('src') !== src) img.src = src;
  });
  applyCalloutImage(images.calloutBg);
}

function t(key) {
  return dictionary[key] ?? translations.en[key] ?? key;
}

function renderLanguage() {
  dictionary = buildDictionary();

  document.documentElement.lang = currentLanguage;
  document.body.dir = currentLanguage === 'fa' ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const val = dictionary[element.dataset.i18n];
    if (val) element.innerHTML = val;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    const val = dictionary[element.dataset.i18nPlaceholder];
    if (val) element.placeholder = stripTags(val);
  });

  const currentLangFlag = document.getElementById('currentLangFlag');
  const currentLangCode = document.getElementById('currentLangCode');
  if (currentLangFlag) currentLangFlag.textContent = languageLabels[currentLanguage] || '🇦🇫';
  if (currentLangCode) currentLangCode.textContent = currentLanguage.toUpperCase();

  document.querySelectorAll('.language-option').forEach((option) => {
    option.classList.toggle('active', option.dataset.language === currentLanguage);
  });

  document.title = `${stripTags(dictionary.brandName)} | ${stripTags(dictionary.brandSub)}`;

  applyContactAndMedia();
  prepareMarquee();
  animateHeadline();
  renderEventDetails();
  if (galleryReady) renderGallery(true);
}

function applyCalloutImage(image) {
  if (!image) return;
  const layer = document.getElementById('calloutBgLayer');
  if (layer) layer.style.backgroundImage = `url("${image.replace(/"/g, '%22')}")`;
}

function animateHeadline() {
  const heading = document.getElementById('afghanistan-title');
  if (!heading) return;
  const words = heading.textContent.trim().split(/\s+/);
  heading.innerHTML = words
    .map((word, i) => `<span class="word" style="--i:${i}"><span>${escapeHtml(word)}</span></span>`)
    .join(' ');
}

// Live updates when the studio saves in another tab of this browser
if (siteChannel) {
  siteChannel.addEventListener('message', async (event) => {
    if (event.data?.type !== 'content-updated') return;
    await loadContent();
    applyStats();
    renderLanguage();
  });
}

// ==========================================================================
// Language Picker
// ==========================================================================
const languageToggle = document.getElementById('languageToggle');
const languageMenu = document.getElementById('languageMenu');

if (languageToggle && languageMenu) {
  languageToggle.addEventListener('click', () => {
    const isOpen = languageMenu.classList.toggle('open');
    languageToggle.setAttribute('aria-expanded', isOpen);
  });

  document.querySelectorAll('.language-option').forEach((option) => {
    option.addEventListener('click', () => {
      currentLanguage = option.dataset.language;
      store.set('newerBlickLang', currentLanguage);
      languageMenu.classList.remove('open');
      languageToggle.setAttribute('aria-expanded', 'false');
      renderLanguage();
      if (window.AOS) AOS.refresh();
    });
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.language-picker')) {
      languageMenu.classList.remove('open');
      languageToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// ==========================================================================
// Theme Toggle
// ==========================================================================
const themeToggle = document.getElementById('themeToggle');
const savedTheme = store.raw('newerBlickTheme');
if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.body.classList.add('dark');
}
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark');
    store.set('newerBlickTheme', isDark ? 'dark' : 'light');
  });
}

// ==========================================================================
// Mobile Navigation Drawer
// ==========================================================================
const mobileMenu = document.createElement('nav');
mobileMenu.className = 'mobile-nav';
mobileMenu.setAttribute('aria-label', 'Mobile navigation');
mobileMenu.innerHTML = `
  <a href="#about" data-i18n="navAbout">درباره ما</a>
  <a href="#activities" data-i18n="navActivities">فعالیت‌ها</a>
  <a href="#opportunities" data-i18n="navOpportunities">کار و تحصیل در آلمان</a>
  <a href="#events" data-i18n="navEvents">رویدادها</a>
  <a href="#stories" data-i18n="navStories">داستان‌های ما</a>
  <a href="#gallery" data-i18n="navGallery">گالری</a>
  <a href="#membership" data-i18n="navMembership">عضویت</a>
  <a href="#faq" data-i18n="labelFaq">پرسش‌های پرتکرار</a>
  <a href="#contact" data-i18n="navContact">تماس با ما</a>
`;
const header = document.querySelector('.site-header');
if (header) header.appendChild(mobileMenu);

const menuToggle = document.getElementById('menuToggle');
function setMobileMenu(open) {
  mobileMenu.classList.toggle('open', open);
  if (menuToggle) {
    menuToggle.classList.toggle('open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
  }
}
if (menuToggle) {
  menuToggle.addEventListener('click', () => setMobileMenu(!mobileMenu.classList.contains('open')));
  mobileMenu.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMobileMenu(false);
  });
}

// ==========================================================================
// Scroll: Progress, Header, Back-to-Top & Hero Parallax
// ==========================================================================
const backToTop = document.getElementById('backToTop');
const scrollProgressBar = document.getElementById('scrollProgress');
const progressCircle = document.querySelector('.progress-ring-circle');
const calloutSection = document.querySelector('.afghanistan-callout');
const calloutLayer = document.getElementById('calloutBgLayer');
let scrollTicking = false;

function onScrollFrame() {
  scrollTicking = false;
  const scrollY = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const scrollPercent = docHeight > 0 ? scrollY / docHeight : 0;

  if (header) header.classList.toggle('scrolled', scrollY > 60);
  if (scrollProgressBar) scrollProgressBar.style.width = `${Math.min(100, Math.max(0, scrollPercent * 100))}%`;

  if (backToTop) {
    backToTop.classList.toggle('visible', scrollY > 350);
    if (progressCircle) progressCircle.style.strokeDashoffset = Math.max(0, 132 - scrollPercent * 132);
  }

  if (calloutLayer && !prefersReducedMotion && scrollY < window.innerHeight * 1.2) {
    calloutLayer.style.setProperty('--sy', `${scrollY * 0.28}px`);
  }
}

window.addEventListener('scroll', () => {
  if (!scrollTicking) {
    scrollTicking = true;
    requestAnimationFrame(onScrollFrame);
  }
}, { passive: true });

if (backToTop) backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// Scroll Spy: highlight the nav link of the section in view
const navLinks = [...document.querySelectorAll('.desktop-nav a, .mobile-nav a')];
if ('IntersectionObserver' in window) {
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const href = `#${entry.target.id}`;
      navLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === href));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('main section[id]').forEach((section) => spy.observe(section));
}

// ==========================================================================
// Announcement Marquee
// ==========================================================================
function prepareMarquee() {
  const track = document.getElementById('messageTrack');
  if (!track || track.dataset.cloned) return;
  track.innerHTML += track.innerHTML;
  track.dataset.cloned = 'true';
}

// ==========================================================================
// Floating Saffron Particles
// ==========================================================================
function spawnParticles() {
  const host = document.getElementById('particles');
  if (!host || prefersReducedMotion) return;
  const count = window.innerWidth < 768 ? 10 : 22;
  for (let i = 0; i < count; i += 1) {
    const particle = document.createElement('span');
    const duration = 16 + Math.random() * 18;
    particle.style.setProperty('--x', `${Math.random() * 100}%`);
    particle.style.setProperty('--size', `${3 + Math.random() * 6}px`);
    particle.style.setProperty('--dur', `${duration}s`);
    particle.style.setProperty('--delay', `${-Math.random() * duration}s`);
    particle.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`);
    host.appendChild(particle);
  }
}

// ==========================================================================
// Card Spotlight & Tilt
// ==========================================================================
function initCardEffects() {
  if (!finePointer || prefersReducedMotion) return;
  document.querySelectorAll('.value-card, .activity-card, .opportunity-card, .tilt-card, .contact-details, .faq-item').forEach((card) => {
    card.classList.add('spotlight');
    const tilts = card.matches('.value-card, .activity-card, .tilt-card');
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      card.style.setProperty('--px', `${x * 100}%`);
      card.style.setProperty('--py', `${y * 100}%`);
      if (tilts) {
        card.classList.add('is-tilting');
        card.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 7}deg) rotateY(${(x - 0.5) * 9}deg) translateY(-6px)`;
      }
    });
    card.addEventListener('pointerleave', () => {
      card.classList.remove('is-tilting');
      card.style.transform = '';
    });
  });
}

// ==========================================================================
// Animated Statistics Counters (values editable in admin)
// ==========================================================================
function applyStats() {
  const stats = { ...DEFAULT_STATS, ...(siteContent.stats || {}) };
  const values = [stats.years, stats.members, stats.events];
  document.querySelectorAll('.counter').forEach((counter, i) => {
    const value = parseInt(values[i], 10);
    if (Number.isFinite(value)) {
      counter.dataset.target = value;
      if (counter.dataset.done) counter.textContent = value;
    }
  });
}

function initStatsCounters() {
  const counters = document.querySelectorAll('.counter');
  if (!counters.length || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseInt(el.dataset.target, 10) || 0;
      const duration = 1800;
      const startTime = performance.now();

      function updateCounter(currentTime) {
        const progress = Math.min((currentTime - startTime) / duration, 1);
        el.textContent = Math.floor((1 - Math.pow(1 - progress, 3)) * target);
        if (progress < 1) requestAnimationFrame(updateCounter);
        else {
          el.textContent = parseInt(el.dataset.target, 10) || target;
          el.dataset.done = 'true';
        }
      }

      requestAnimationFrame(updateCounter);
      obs.unobserve(el);
    });
  }, { threshold: 0.3 });

  counters.forEach((counter) => observer.observe(counter));
}

// ==========================================================================
// Time Zone Helpers
// ==========================================================================
const zoneFormatters = {};
function zoneParts(timeZone, date = new Date()) {
  if (!zoneFormatters[timeZone]) {
    zoneFormatters[timeZone] = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  const parts = {};
  zoneFormatters[timeZone].formatToParts(date).forEach((p) => {
    if (p.type !== 'literal') parts[p.type] = parseInt(p.value, 10);
  });
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

function zoneOffsetMinutes(timeZone, date = new Date()) {
  const p = zoneParts(timeZone, date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// "2026-11-21T18:00" interpreted as Münster wall-clock time
function fromBerlinWallTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  try {
    return new Date(guess - zoneOffsetMinutes('Europe/Berlin', new Date(guess)) * 60000);
  } catch (e) {
    return new Date(guess - 60 * 60000);
  }
}

// ==========================================================================
// Compact World Clocks (Münster & Kabul)
// ==========================================================================
const worldClocks = [
  { el: document.getElementById('clockMunster'), time: document.getElementById('munsterTime'), tz: 'Europe/Berlin', fallback: 60 },
  { el: document.getElementById('clockKabul'), time: document.getElementById('kabulTime'), tz: 'Asia/Kabul', fallback: 270 }
];
const clockDiff = document.getElementById('clockDiff');

function updateWorldClocks() {
  const now = new Date();
  const offsets = [];

  worldClocks.forEach((clock) => {
    if (!clock.el || !clock.time) return;
    let p;
    let offset;
    try {
      p = zoneParts(clock.tz, now);
      offset = zoneOffsetMinutes(clock.tz, now);
    } catch (e) {
      const shifted = new Date(now.getTime() + clock.fallback * 60000);
      p = { hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(), second: shifted.getUTCSeconds() };
      offset = clock.fallback;
    }
    offsets.push(offset);

    clock.time.innerHTML = `${pad2(p.hour)}<span class="colon">:</span>${pad2(p.minute)}`;
    clock.time.setAttribute('datetime', `${pad2(p.hour)}:${pad2(p.minute)}`);
    clock.el.style.setProperty('--h', `${((p.hour % 12) + p.minute / 60) * 30}deg`);
    clock.el.style.setProperty('--m', `${(p.minute + p.second / 60) * 6}deg`);
    clock.el.style.setProperty('--s', `${p.second * 6}deg`);
    clock.el.classList.toggle('is-night', p.hour < 6 || p.hour >= 19);
  });

  if (clockDiff && offsets.length === 2) {
    const diff = offsets[1] - offsets[0];
    const abs = Math.abs(diff);
    clockDiff.textContent = `${diff >= 0 ? '+' : '−'}${Math.floor(abs / 60)}:${pad2(abs % 60)}`;
  }

  tickCountdown(now);
}

// ==========================================================================
// Upcoming Event: Date, Countdown, Calendar & Share
// ==========================================================================

let eventStart = null;

function getEvent() {
  return { ...DEFAULT_EVENT, ...(siteContent.event || {}) };
}

function renderEventDetails() {
  eventStart = fromBerlinWallTime(getEvent().date);
  const dateText = document.getElementById('eventDateText');
  const badgeMonth = document.getElementById('badgeMonth');
  const badgeDay = document.getElementById('badgeDay');

  if (!eventStart) {
    if (dateText) dateText.innerHTML = t('eventDate');
    return;
  }

  const locale = { fa: 'fa-AF-u-ca-gregory', de: 'de-DE', en: 'en-GB' }[currentLanguage] || 'en-GB';
  try {
    const formatted = new Intl.DateTimeFormat(locale, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
    }).format(eventStart);
    if (dateText) dateText.textContent = `${formatted} · ${stripTags(t('munsterCity'))}`;
    if (badgeMonth) badgeMonth.textContent = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'Europe/Berlin' }).format(eventStart).toUpperCase();
    if (badgeDay) badgeDay.textContent = new Intl.DateTimeFormat('en', { day: 'numeric', timeZone: 'Europe/Berlin' }).format(eventStart);
  } catch (e) {
    if (dateText) dateText.textContent = eventStart.toLocaleString();
  }
  tickCountdown(new Date());
}

const countdownEl = document.getElementById('eventCountdown');
const countdownSoon = document.getElementById('countdownSoon');
const countdownLabel = document.querySelector('.countdown-label');
const countdownCells = {
  days: document.getElementById('cdDays'),
  hours: document.getElementById('cdHours'),
  minutes: document.getElementById('cdMinutes'),
  seconds: document.getElementById('cdSeconds')
};

function tickCountdown(now) {
  if (!countdownEl) return;
  const remaining = eventStart ? eventStart.getTime() - now.getTime() : -1;
  const upcoming = remaining > 0;

  countdownEl.hidden = !upcoming;
  if (countdownLabel) countdownLabel.hidden = !upcoming;
  if (countdownSoon) countdownSoon.hidden = upcoming;
  if (!upcoming) return;

  const totalSeconds = Math.floor(remaining / 1000);
  const values = {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60
  };

  Object.entries(values).forEach(([unit, value]) => {
    const cell = countdownCells[unit];
    if (!cell) return;
    const text = pad2(value);
    if (cell.textContent !== text) {
      cell.textContent = text;
      const box = cell.parentElement;
      box.classList.remove('tick');
      void box.offsetWidth;
      box.classList.add('tick');
    }
  });
}

function icsEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function downloadEventIcs() {
  if (!eventStart) return showToast(t('cdSoon'));
  const ev = getEvent();
  const end = new Date(eventStart.getTime() + (Number(ev.durationHours) || 4) * 3600000);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Neuer Blick Verein e.V.//Website//DE', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${eventStart.getTime()}@neuerblick-verein.de`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(eventStart)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${icsEscape(stripTags(t('eventTitle')))}`,
    `DESCRIPTION:${icsEscape(stripTags(t('eventText')))}`,
    `LOCATION:${icsEscape(ev.location || [getContact().addressStreet, getContact().addressCity, getContact().addressCountry].filter(Boolean).join(', '))}`,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');

  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'neuer-blick-event.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareEvent() {
  const url = `${location.href.split('#')[0]}#events`;
  const data = { title: stripTags(t('eventTitle')), text: stripTags(t('eventText')), url };
  if (navigator.share) {
    try {
      await navigator.share(data);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  await copyText(url);
  showToast(t('linkCopied'));
}

document.getElementById('addToCalendar')?.addEventListener('click', downloadEventIcs);
document.getElementById('shareEvent')?.addEventListener('click', shareEvent);

// ==========================================================================
// Clipboard
// ==========================================================================
function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try { document.execCommand('copy'); } catch (e) { /* ignore */ }
  area.remove();
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  fallbackCopy(text);
  return Promise.resolve();
}

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    await copyText(button.dataset.copy);
    button.classList.add('copied');
    showToast(t('copied'));
    setTimeout(() => button.classList.remove('copied'), 1600);
  });
});

// ==========================================================================
// Gallery & Interactive Lightbox
// ==========================================================================


let galleryReady = false;
let galleryPage = 0;
let galleryPerPage = 0;
let currentLightboxIndex = 0;
let activeGalleryItems = [];

function getSavedGallery() {
  const parsed = siteContent.gallery;
  if (!Array.isArray(parsed) || !parsed.length) return defaultGalleryItems;
  return parsed.map((item, idx) => {
    if (typeof item === 'string') {
      return {
        url: item,
        title: `تصویر گالری نگاه نو ${idx + 1}`,
        titleDe: `Galeriebild Neuer Blick ${idx + 1}`,
        titleEn: `Neuer Blick Gallery Image ${idx + 1}`
      };
    }
    return item;
  }).filter((item) => item && item.url);
}

function captionFor(item) {
  if (currentLanguage === 'de') return item.titleDe || item.title || '';
  if (currentLanguage === 'en') return item.titleEn || item.title || '';
  return item.title || '';
}

function currentPerPage() {
  return window.innerWidth < 768 ? 1 : (window.innerWidth < 1120 ? 2 : 3);
}

function renderGallery(instant = false) {
  activeGalleryItems = getSavedGallery();
  galleryPerPage = currentPerPage();
  const totalPages = Math.max(1, Math.ceil(activeGalleryItems.length / galleryPerPage));
  galleryPage = ((galleryPage % totalPages) + totalPages) % totalPages;

  const grid = document.getElementById('galleryGrid');
  if (!grid) return;

  const pageIndicator = document.getElementById('galleryPage');
  if (pageIndicator) pageIndicator.textContent = `${galleryPage + 1} / ${totalPages}`;

  const paint = () => {
    const pageItems = activeGalleryItems.slice(galleryPage * galleryPerPage, galleryPage * galleryPerPage + galleryPerPage);
    grid.innerHTML = pageItems.map((item, localIdx) => {
      const globalIdx = galleryPage * galleryPerPage + localIdx;
      const caption = escapeHtml(captionFor(item));
      return `
        <div class="gallery-item" data-index="${globalIdx}" role="button" tabindex="0" aria-label="${caption}" style="--i:${localIdx}">
          <img src="${escapeHtml(item.url)}" alt="${caption}" loading="lazy" />
          <div class="gallery-item-overlay">
            <span class="gallery-zoom-icon"><b>⤢</b> ${caption}</span>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.gallery-item').forEach((itemEl) => {
      const open = () => openLightbox(parseInt(itemEl.dataset.index, 10));
      itemEl.addEventListener('click', open);
      itemEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });

    grid.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    grid.style.opacity = '1';
    grid.style.transform = 'none';
  };

  if (instant) return paint();
  grid.style.opacity = '0';
  grid.style.transform = 'translateY(8px)';
  setTimeout(paint, 160);
}

const lightboxModal = document.getElementById('lightboxModal');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxCaption = document.getElementById('lightboxCaption');

function openLightbox(index) {
  if (!activeGalleryItems.length || !lightboxModal) return;
  const total = activeGalleryItems.length;
  currentLightboxIndex = ((index % total) + total) % total;
  const item = activeGalleryItems[currentLightboxIndex];
  const caption = captionFor(item);

  lightboxImage.classList.add('swapping');
  setTimeout(() => {
    lightboxImage.src = item.url;
    lightboxImage.alt = caption;
    lightboxImage.classList.remove('swapping');
  }, lightboxModal.classList.contains('active') ? 140 : 0);
  lightboxCaption.innerHTML = `<b>${currentLightboxIndex + 1} / ${total}</b> ${escapeHtml(caption)}`;

  lightboxModal.classList.add('active');
  lightboxModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  if (!lightboxModal) return;
  lightboxModal.classList.remove('active');
  lightboxModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

const nextLightboxImage = () => openLightbox(currentLightboxIndex + 1);
const prevLightboxImage = () => openLightbox(currentLightboxIndex - 1);

document.getElementById('lightboxClose')?.addEventListener('click', closeLightbox);
document.getElementById('lightboxBackdrop')?.addEventListener('click', closeLightbox);
document.getElementById('lightboxNext')?.addEventListener('click', nextLightboxImage);
document.getElementById('lightboxPrev')?.addEventListener('click', prevLightboxImage);

// Swipe support in the lightbox
let touchStartX = null;
lightboxModal?.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
lightboxModal?.addEventListener('touchend', (e) => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  touchStartX = null;
  if (Math.abs(dx) < 40) return;
  const forward = currentLanguage === 'fa' ? dx > 0 : dx < 0;
  forward ? nextLightboxImage() : prevLightboxImage();
});

document.addEventListener('keydown', (e) => {
  if (!lightboxModal?.classList.contains('active')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowRight') currentLanguage === 'fa' ? prevLightboxImage() : nextLightboxImage();
  else if (e.key === 'ArrowLeft') currentLanguage === 'fa' ? nextLightboxImage() : prevLightboxImage();
});

document.getElementById('galleryPrev')?.addEventListener('click', () => { galleryPage -= 1; renderGallery(); });
document.getElementById('galleryNext')?.addEventListener('click', () => { galleryPage += 1; renderGallery(); });

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentPerPage() !== galleryPerPage) renderGallery(true);
  }, 150);
});

// ==========================================================================
// Registration / Contact Modal (requests are kept for the admin inbox)
// ==========================================================================
const actionModal = document.getElementById('actionModal');
const actionForm = document.getElementById('actionForm');
const modalTitle = document.getElementById('modalTitle');
const modalSubtitle = document.getElementById('modalSubtitle');
const formInterest = document.getElementById('formInterest');
const toastNotification = document.getElementById('toastNotification');
const toastText = document.getElementById('toastText');
let toastTimer;
let lastFocused = null;

function showToast(message) {
  if (!toastNotification) return;
  if (toastText) toastText.textContent = message;
  toastNotification.classList.remove('show');
  void toastNotification.offsetWidth;
  toastNotification.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNotification.classList.remove('show'), 4200);
}

const modalKeys = { membership: 'Membership', event: 'Event', job: 'Job', study: 'Study', general: 'General' };

async function postJson(url, data) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function openActionModal(type = 'general') {
  if (!actionModal) return;
  const key = modalKeys[type] ? type : 'general';
  modalTitle.textContent = stripTags(t(`modal${modalKeys[key]}Title`));
  modalSubtitle.textContent = stripTags(t(`modal${modalKeys[key]}Sub`));
  if (formInterest) formInterest.value = key;

  lastFocused = document.activeElement;
  actionModal.classList.add('active');
  actionModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('formName')?.focus(), 250);
}

function closeActionModal() {
  if (!actionModal) return;
  actionModal.classList.remove('active');
  actionModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  lastFocused?.focus?.();
}

document.querySelectorAll('.open-modal-btn').forEach((btn) => {
  btn.addEventListener('click', () => openActionModal(btn.dataset.modalType === 'contact' ? 'general' : btn.dataset.modalType));
});

document.getElementById('actionModalClose')?.addEventListener('click', closeActionModal);
document.getElementById('actionModalBackdrop')?.addEventListener('click', closeActionModal);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && actionModal?.classList.contains('active')) closeActionModal();
});

if (actionForm) {
  actionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = actionForm.querySelector('.submit-btn');
    const name = document.getElementById('formName')?.value.trim() || '';

    submitBtn?.classList.add('loading');
    if (submitBtn) submitBtn.disabled = true;

    try {
      await Promise.all([
        postJson('/api/submissions', {
          type: formInterest?.value || 'general',
          name,
          email: document.getElementById('formEmail')?.value.trim() || '',
          phone: document.getElementById('formPhone')?.value.trim() || '',
          notes: document.getElementById('formNotes')?.value.trim() || '',
          lang: currentLanguage
        }),
        new Promise((r) => setTimeout(r, 600))
      ]);
      closeActionModal();
      actionForm.reset();
      showToast(stripTags(t('thanksMsg')).replace('{name}', name || stripTags(t('friendWord'))));
    } catch (err) {
      showToast(stripTags(t('sendError')));
    } finally {
      submitBtn?.classList.remove('loading');
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

// ==========================================================================
// Footer: Newsletter, Illustration Reveal & Year
// ==========================================================================
const newsletterForm = document.getElementById('newsletterForm');
if (newsletterForm) {
  newsletterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('newsletterEmail');
    const email = input?.value.trim().toLowerCase();
    if (!email) return;
    postJson('/api/subscribers', { email, lang: currentLanguage })
      .then(() => showToast(t('newsletterDone')))
      .catch(() => showToast(stripTags(t('sendError'))));
    newsletterForm.classList.add('sent');
    setTimeout(() => newsletterForm.classList.remove('sent'), 1800);
    newsletterForm.reset();
  });
}

const footerArt = document.getElementById('footerArt');
if (footerArt) {
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          footerArt.classList.add('in-view');
          obs.disconnect();
        }
      });
    }, { threshold: 0.25 }).observe(footerArt);
  } else {
    footerArt.classList.add('in-view');
  }

  if (finePointer && !prefersReducedMotion) {
    footerArt.addEventListener('pointermove', (e) => {
      const rect = footerArt.getBoundingClientRect();
      footerArt.style.setProperty('--ax', ((e.clientX - rect.left) / rect.width - 0.5).toFixed(3));
      footerArt.style.setProperty('--ay', ((e.clientY - rect.top) / rect.height - 0.5).toFixed(3));
    });
    footerArt.addEventListener('pointerleave', () => {
      footerArt.style.setProperty('--ax', 0);
      footerArt.style.setProperty('--ay', 0);
    });
  }
}

const footerYear = document.getElementById('footerYear');
if (footerYear) footerYear.textContent = new Date().getFullYear();

// ==========================================================================
// Initialization
// ==========================================================================
applyStats();
renderLanguage();
renderGallery(true);
galleryReady = true;
loadContent().then(() => {
  applyStats();
  renderLanguage();
});
initStatsCounters();
spawnParticles();
initCardEffects();
updateWorldClocks();
setInterval(updateWorldClocks, 1000);

if (window.AOS) {
  AOS.init({ duration: 850, once: true, offset: 60, easing: 'ease-out-cubic' });
}

// FAQ: keep one answer open at a time
const faqItems = document.querySelectorAll('.faq-item');
faqItems.forEach((item) => {
  item.addEventListener('toggle', () => {
    if (item.open) faqItems.forEach((other) => { if (other !== item) other.open = false; });
  });
});

function hideLoader() {
  document.getElementById('pageLoader')?.classList.add('hidden');
  // Later headline re-renders (language switch) animate without the intro delay
  setTimeout(() => document.body.classList.add('loaded'), 1800);
}
window.addEventListener('load', hideLoader);
setTimeout(hideLoader, 1200);
