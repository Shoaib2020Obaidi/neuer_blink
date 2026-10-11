let currentLanguage = 'fa';
const languageLabels = { fa: '🇦🇫', ps: '🇦🇫', de: '🇩🇪', en: '🇬🇧' };
const isRtl = (lang = currentLanguage) => lang === 'fa' || lang === 'ps';
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
  const slides = Array.isArray(images.heroSlides) ? images.heroSlides.filter(Boolean) : [];
  applyHeroSlides(slides.length ? slides : [images.calloutBg]);
}

function t(key) {
  return dictionary[key] ?? translations.en[key] ?? key;
}

function renderLanguage() {
  dictionary = buildDictionary();

  document.documentElement.lang = currentLanguage;
  document.body.dir = isRtl() ? 'rtl' : 'ltr';

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
  startNameRotator();
  renderEventDetails();
  renderLibrary();
  if (galleryReady) renderGallery(true);
}

// Hero background: one photo, or any number chosen in the studio that cross-fade every 10 seconds
const HERO_SLIDE_INTERVAL = 10000;
let heroSlideKey = '';
let heroSlideTimer = null;

// Photos load only when they are about to be shown, so a long slideshow stays light
function loadSlide(slide) {
  if (slide && !slide.style.backgroundImage) slide.style.backgroundImage = `url("${slide.dataset.src.replace(/"/g, '%22')}")`;
}

function applyHeroSlides(list) {
  const layer = document.getElementById('calloutBgLayer');
  const images = list.filter(Boolean);
  const key = images.join('|');
  if (!layer || !images.length || key === heroSlideKey) return;
  heroSlideKey = key;
  clearInterval(heroSlideTimer);

  layer.innerHTML = images
    .map((src, i) => `<div class="callout-slide${i === 0 ? ' active' : ''}" data-src="${escapeHtml(src)}"></div>`)
    .join('');
  const slides = layer.querySelectorAll('.callout-slide');
  loadSlide(slides[0]);
  if (slides.length < 2) return;
  loadSlide(slides[1]);

  let current = 0;
  heroSlideTimer = setInterval(() => {
    slides[current].classList.remove('active');
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
    loadSlide(slides[(current + 1) % slides.length]);
  }, HERO_SLIDE_INTERVAL);
}

// Hero headline: the association's name, written out in every language in turn
const NAME_LANGS = ['fa', 'ps', 'de', 'en'];
const NAME_INTERVAL = 4000;
let nameTimer = null;
let nameRun = 0;

function nameFor(lang) {
  const overrides = siteContent.overrides || {};
  return stripTags(overrides[lang]?.brandName || translations[lang]?.brandName || '');
}

// Erase the current name, then type the next one character by character
function writeName(el, text, onDone) {
  const run = ++nameRun;
  const from = [...el.textContent];
  const to = [...text];
  const eraseStep = Math.min(28, 320 / Math.max(1, from.length));
  const typeStep = Math.min(75, 1100 / Math.max(1, to.length));
  el.classList.add('typing');

  const type = (i) => {
    if (run !== nameRun) return;
    el.textContent = to.slice(0, i).join('');
    if (i < to.length) setTimeout(() => type(i + 1), typeStep);
    else {
      el.classList.remove('typing');
      if (onDone) onDone();
    }
  };
  const erase = (i) => {
    if (run !== nameRun) return;
    el.textContent = from.slice(0, i).join('');
    if (i > 0) setTimeout(() => erase(i - 1), eraseStep);
    else {
      el.lang = el.dataset.nextLang;
      el.dir = isRtl(el.dataset.nextLang) ? 'rtl' : 'ltr';
      type(1);
    }
  };
  erase(from.length);
}

function startNameRotator() {
  const heading = document.getElementById('afghanistan-title');
  if (!heading) return;
  clearTimeout(nameTimer);
  nameRun += 1;

  const order = [currentLanguage, ...NAME_LANGS.filter((lang) => lang !== currentLanguage)];
  const dirOf = (lang) => (isRtl(lang) ? 'rtl' : 'ltr');
  // Invisible copies of every name keep the heading height steady while it changes
  heading.innerHTML = order
    .map((lang) => `<span class="name-sizer" aria-hidden="true" lang="${lang}" dir="${dirOf(lang)}">${escapeHtml(nameFor(lang))}</span>`)
    .join('') + `<span class="name-live" aria-hidden="true" lang="${currentLanguage}" dir="${dirOf(currentLanguage)}"></span>`;
  heading.setAttribute('aria-label', nameFor(currentLanguage));

  let dots = document.getElementById('nameLangs');
  if (!dots) {
    dots = document.createElement('div');
    dots.id = 'nameLangs';
    dots.className = 'name-langs';
    dots.setAttribute('aria-hidden', 'true');
    heading.after(dots);
  }
  dots.innerHTML = order.map((lang) => `<span data-lang="${lang}">${lang.toUpperCase()}</span>`).join('');

  const live = heading.querySelector('.name-live');
  let index = 0;
  const showNext = () => {
    const lang = order[index % order.length];
    index += 1;
    dots.querySelectorAll('span').forEach((dot) => dot.classList.toggle('active', dot.dataset.lang === lang));
    live.dataset.nextLang = lang;
    if (prefersReducedMotion) {
      live.lang = lang;
      live.dir = dirOf(lang);
      live.textContent = nameFor(lang);
    } else {
      writeName(live, nameFor(lang));
    }
    nameTimer = setTimeout(showNext, NAME_INTERVAL);
  };
  showNext();
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
  <a href="#news" data-i18n="navNews">اخبار</a>
  <a href="#articles" data-i18n="navArticles">مقالات و مطالب</a>
  <a href="#videos" data-i18n="navVideos">ویدیوها</a>
  <a href="#documents" data-i18n="navDocs">اسناد و نشرات</a>
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

  const locale = { fa: 'fa-AF-u-ca-gregory', ps: 'ps-AF-u-ca-gregory', de: 'de-DE', en: 'en-GB' }[currentLanguage] || 'en-GB';
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
        titleEn: `Neuer Blick Gallery Image ${idx + 1}`,
        titlePs: `د نوي نظر ګالري انځور ${idx + 1}`
      };
    }
    return item;
  }).filter((item) => item && item.url);
}

function captionFor(item) {
  if (currentLanguage === 'de') return item.titleDe || item.title || '';
  if (currentLanguage === 'en') return item.titleEn || item.title || '';
  if (currentLanguage === 'ps') return item.titlePs || item.title || '';
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
  const forward = isRtl() ? dx > 0 : dx < 0;
  forward ? nextLightboxImage() : prevLightboxImage();
});

document.addEventListener('keydown', (e) => {
  if (!lightboxModal?.classList.contains('active')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowRight') isRtl() ? prevLightboxImage() : nextLightboxImage();
  else if (e.key === 'ArrowLeft') isRtl() ? nextLightboxImage() : prevLightboxImage();
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
  btn.addEventListener('click', () => {
    if (btn.dataset.modalType === 'membership') openJoinModal();
    else openActionModal(btn.dataset.modalType === 'contact' ? 'general' : btn.dataset.modalType);
  });
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
// News, Articles, Videos & Documents (managed in the studio: News & media)
// ==========================================================================
const LIBRARY_TYPES = ['news', 'articles', 'videos', 'documents'];
const LIBRARY_LIMIT = { news: 3, articles: 4, videos: 3, documents: 5 };
const ARTICLE_CATS = { article: 'catArticle', educational: 'catEducational', analysis: 'catAnalysis', writing: 'catWriting' };
const DOC_CATS = { report: 'docReport', resolution: 'docResolution', announcement: 'docAnnouncement', file: 'docFile' };
const libraryExpanded = new Set();

function getLibrary(type) {
  const list = Array.isArray(siteContent[type]) ? siteContent[type] : (DEFAULT_LIBRARY[type] || []);
  return list.filter((item) => item && item.id).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

// Text in the visitor's language, or the first language that has it
function localized(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field[currentLanguage] || field.fa || field.ps || field.de || field.en || '';
}

function formatDate(iso) {
  const date = new Date(`${iso}T12:00:00`);
  if (!iso || Number.isNaN(date.getTime())) return '';
  const locale = { fa: 'fa-AF-u-ca-gregory', ps: 'ps-AF-u-ca-gregory', de: 'de-DE', en: 'en-GB' }[currentLanguage] || 'en-GB';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function excerpt(text, max = 150) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).replace(/\s+\S*$/, '')}…` : flat;
}

const readingMinutes = (text) => Math.max(1, Math.round(String(text).split(/\s+/).filter(Boolean).length / 200));
const localNumber = (n) => new Intl.NumberFormat({ fa: 'fa-AF', ps: 'ps-AF', de: 'de-DE', en: 'en-GB' }[currentLanguage] || 'en-GB').format(n);

// Only web links and files from this site's own folders
function safeUrl(url) {
  const value = String(url || '').trim();
  return /^(https?:\/\/|docs\/|images\/|media\/)/i.test(value) ? value : '';
}

function videoSource(url) {
  const value = String(url || '').trim();
  let match = value.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  if (match) {
    return { kind: 'frame', src: `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1&rel=0`, thumb: `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg` };
  }
  match = value.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (match) return { kind: 'frame', src: `https://player.vimeo.com/video/${match[1]}?autoplay=1`, thumb: '' };
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(value) && safeUrl(value)) return { kind: 'file', src: value, thumb: '' };
  return null;
}

function fileBadge(url) {
  const ext = (String(url).split('?')[0].match(/\.(\w+)$/) || [])[1] || 'file';
  return ext.toUpperCase().slice(0, 4);
}

function paragraphs(text) {
  return String(text).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br />')}</p>`).join('');
}

const arrow = () => '<span class="link-arrow" aria-hidden="true">←</span>';

const LIBRARY_CARDS = {
  news: (item, i) => {
    const title = localized(item.title);
    const image = safeUrl(item.image);
    return `
      <article class="news-card" style="--i:${i}">
        <button type="button" class="library-open" data-open="news" data-id="${escapeHtml(item.id)}">
          <span class="news-media">
            ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />` : '<span class="media-placeholder" aria-hidden="true">✦</span>'}
            <span class="news-date">${escapeHtml(formatDate(item.date))}</span>
          </span>
          <span class="news-body">
            <strong dir="auto">${escapeHtml(title)}</strong>
            <span class="news-excerpt" dir="auto">${escapeHtml(excerpt(localized(item.text)))}</span>
            <span class="library-link">${escapeHtml(stripTags(t('readMoreBtn')))} ${arrow()}</span>
          </span>
        </button>
      </article>`;
  },
  articles: (item, i) => {
    const text = localized(item.text);
    const image = safeUrl(item.image);
    const cat = ARTICLE_CATS[item.category] || 'catArticle';
    return `
      <article class="article-card${i === 0 ? ' featured' : ''}" style="--i:${i}">
        <button type="button" class="library-open" data-open="articles" data-id="${escapeHtml(item.id)}">
          <span class="article-media">
            ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />` : '<span class="media-placeholder" aria-hidden="true">✎</span>'}
          </span>
          <span class="article-body">
            <span class="pill pill-${escapeHtml(item.category || 'article')}">${escapeHtml(stripTags(t(cat)))}</span>
            <strong dir="auto">${escapeHtml(localized(item.title))}</strong>
            <span class="article-excerpt" dir="auto">${escapeHtml(excerpt(text, i === 0 ? 260 : 130))}</span>
            <span class="article-meta">
              ${item.author ? `<span dir="auto">${escapeHtml(item.author)}</span>` : ''}
              <span>${escapeHtml(formatDate(item.date))}</span>
              <span>${localNumber(readingMinutes(text))} ${escapeHtml(stripTags(t('minRead')))}</span>
            </span>
          </span>
        </button>
      </article>`;
  },
  videos: (item, i) => {
    const source = videoSource(item.url);
    const thumb = safeUrl(item.image) || source?.thumb || '';
    return `
      <article class="video-card-item" style="--i:${i}">
        <button type="button" class="library-open" data-open="videos" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(stripTags(t('watchVideo')))}: ${escapeHtml(localized(item.title))}">
          <span class="video-thumb">
            ${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" />`
              : source?.kind === 'file' ? `<video src="${escapeHtml(source.src)}#t=1" preload="metadata" muted playsinline tabindex="-1"></video>`
              : '<span class="media-placeholder" aria-hidden="true">▶</span>'}
            <span class="video-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
          </span>
          <span class="video-info">
            <strong dir="auto">${escapeHtml(localized(item.title))}</strong>
            <small>${escapeHtml(formatDate(item.date))}</small>
          </span>
        </button>
      </article>`;
  },
  documents: (item, i) => {
    const url = safeUrl(item.url);
    const cat = DOC_CATS[item.category] || 'docFile';
    const description = localized(item.text);
    const image = safeUrl(item.image);
    // Resolutions and announcements can carry their own text, pictures and video
    const hasDetail = description.length > 180 || (item.images || []).length || item.video || image;
    const badge = url ? fileBadge(url) : (item.video ? '▶' : '¶');
    const media = (item.images || []).length + (item.video ? 1 : 0);
    return `
      <article class="doc-row" style="--i:${i}">
        ${image ? `<span class="doc-thumb"><img src="${escapeHtml(image)}" alt="" loading="lazy" /></span>`
          : `<span class="doc-icon" data-ext="${escapeHtml(badge)}" aria-hidden="true">${escapeHtml(badge)}</span>`}
        <div class="doc-info">
          <span class="pill pill-${escapeHtml(item.category || 'file')}">${escapeHtml(stripTags(t(cat)))}</span>
          ${hasDetail
            ? `<button type="button" class="doc-title-btn" data-open="documents" data-id="${escapeHtml(item.id)}"><strong dir="auto">${escapeHtml(localized(item.title))}</strong></button>`
            : `<strong dir="auto">${escapeHtml(localized(item.title))}</strong>`}
          ${description ? `<small dir="auto">${escapeHtml(excerpt(description, 180))}</small>` : ''}
          <span class="doc-date">${escapeHtml(formatDate(item.date))}${media ? ` · <span class="doc-media">${(item.images || []).length ? `🖼 ${localNumber(item.images.length)}` : ''}${item.video ? ' ▶' : ''}</span>` : ''}</span>
        </div>
        <div class="doc-actions">
          ${hasDetail ? `<button type="button" class="doc-btn" data-open="documents" data-id="${escapeHtml(item.id)}">${escapeHtml(stripTags(t('readMoreBtn')))}</button>` : ''}
          ${url ? `
          ${hasDetail ? '' : `<a class="doc-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(stripTags(t('docOpen')))}</a>`}
          <a class="doc-btn primary" href="${escapeHtml(url)}" download>${escapeHtml(stripTags(t('docDownload')))} <span aria-hidden="true">↓</span></a>` : ''}
        </div>
      </article>`;
  }
};

function renderLibrary() {
  LIBRARY_TYPES.forEach((type) => {
    const host = document.getElementById(`${type}List`);
    if (!host) return;
    const all = getLibrary(type);
    const expanded = libraryExpanded.has(type);
    const shown = expanded ? all : all.slice(0, LIBRARY_LIMIT[type]);

    const toggle = document.querySelector(`[data-library-toggle="${type}"]`);
    if (toggle) {
      toggle.hidden = all.length <= LIBRARY_LIMIT[type];
      toggle.firstElementChild.textContent = stripTags(t(expanded ? 'showLess' : 'showAll'));
    }

    if (!all.length) {
      const youtube = type === 'videos' ? getSocial().youtube : '';
      host.innerHTML = `
        <div class="library-empty">
          <span aria-hidden="true">${{ news: '✦', articles: '✎', videos: '▶', documents: '❏' }[type]}</span>
          <p>${escapeHtml(stripTags(t(host.dataset.emptyKey)))}</p>
          ${youtube ? `<a class="doc-btn primary" href="${escapeHtml(youtube)}" target="_blank" rel="noopener">YouTube ↗</a>` : ''}
        </div>`;
      return;
    }
    host.innerHTML = shown.map((item, i) => LIBRARY_CARDS[type](item, i)).join('');
  });
}

const readerModal = document.getElementById('readerModal');
const videoModal = document.getElementById('videoModal');
let libraryLastFocused = null;

function showLibraryModal(modal) {
  libraryLastFocused = document.activeElement;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => modal.querySelector('.modal-close-btn')?.focus(), 200);
}

function hideLibraryModal(modal) {
  if (!modal?.classList.contains('active')) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (modal === videoModal) document.getElementById('videoFrame').innerHTML = '';
  if (modal === readerModal) {
    document.getElementById('readerExtras').innerHTML = '';
    document.getElementById('readerZoom').hidden = true;
  }
  libraryLastFocused?.focus?.();
}

function openReader(type, item) {
  const text = localized(item.text);
  const image = safeUrl(item.image);
  document.getElementById('readerMedia').innerHTML = image ? `<img src="${escapeHtml(image)}" alt="" />` : '';
  document.getElementById('readerMedia').hidden = !image;
  const cat = type === 'articles' ? (ARTICLE_CATS[item.category] || 'catArticle')
    : type === 'documents' ? (DOC_CATS[item.category] || 'docFile') : 'navNews';
  document.getElementById('readerMeta').innerHTML = [
    `<span class="pill">${escapeHtml(stripTags(t(cat)))}</span>`,
    `<span>${escapeHtml(formatDate(item.date))}</span>`,
    item.author ? `<span dir="auto">${escapeHtml(stripTags(t('byAuthor')))} ${escapeHtml(item.author)}</span>` : '',
    type === 'articles' ? `<span>${localNumber(readingMinutes(text))} ${escapeHtml(stripTags(t('minRead')))}</span>` : ''
  ].join('');
  document.getElementById('readerTitle').textContent = localized(item.title);
  document.getElementById('readerText').innerHTML = paragraphs(text);
  document.getElementById('readerExtras').innerHTML = readerExtras(item, type);
  readerModal.querySelector('.reader-card').scrollTop = 0;
  showLibraryModal(readerModal);
}

// Pictures, video and the attached file shown under the text
function readerExtras(item, type) {
  const images = (item.images || []).map(safeUrl).filter(Boolean);
  const source = videoSource(item.video);
  const file = type === 'documents' ? safeUrl(item.url) : '';
  const title = escapeHtml(localized(item.title));
  return [
    source ? `
      <div class="reader-video">
        ${source.kind === 'frame'
          ? `<iframe src="${escapeHtml(source.src.replace('autoplay=1', 'autoplay=0'))}" title="${title}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`
          : `<video src="${escapeHtml(source.src)}" controls preload="metadata" playsinline></video>`}
      </div>` : '',
    images.length ? `
      <div class="reader-gallery">
        ${images.map((src) => `<button type="button" data-zoom="${escapeHtml(src)}"><img src="${escapeHtml(src)}" alt="" loading="lazy" /></button>`).join('')}
      </div>` : '',
    file ? `
      <div class="reader-file">
        <span class="doc-icon" data-ext="${escapeHtml(fileBadge(file))}" aria-hidden="true">${escapeHtml(fileBadge(file))}</span>
        <strong dir="auto">${title}</strong>
        <a class="doc-btn" href="${escapeHtml(file)}" target="_blank" rel="noopener">${escapeHtml(stripTags(t('docOpen')))}</a>
        <a class="doc-btn primary" href="${escapeHtml(file)}" download>${escapeHtml(stripTags(t('docDownload')))} <span aria-hidden="true">↓</span></a>
      </div>` : ''
  ].join('');
}

const readerZoom = document.getElementById('readerZoom');
document.getElementById('readerExtras')?.addEventListener('click', (e) => {
  const pic = e.target.closest('[data-zoom]');
  if (!pic || !readerZoom) return;
  readerZoom.querySelector('img').src = pic.dataset.zoom;
  readerZoom.hidden = false;
  readerZoom.focus();
});
readerZoom?.addEventListener('click', () => { readerZoom.hidden = true; });

function openVideo(item) {
  const source = videoSource(item.url);
  if (!source) {
    const url = safeUrl(item.url);
    if (url) window.open(url, '_blank', 'noopener');
    return;
  }
  const title = localized(item.title);
  document.getElementById('videoFrame').innerHTML = source.kind === 'frame'
    ? `<iframe src="${escapeHtml(source.src)}" title="${escapeHtml(title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`
    : `<video src="${escapeHtml(source.src)}" controls autoplay playsinline></video>`;
  document.getElementById('videoTitle').textContent = title;
  showLibraryModal(videoModal);
}

document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) {
    const item = getLibrary(open.dataset.open).find((entry) => entry.id === open.dataset.id);
    if (!item) return;
    if (open.dataset.open === 'videos') openVideo(item);
    else openReader(open.dataset.open, item);
    return;
  }
  const toggle = e.target.closest('[data-library-toggle]');
  if (toggle) {
    const type = toggle.dataset.libraryToggle;
    if (libraryExpanded.has(type)) libraryExpanded.delete(type);
    else libraryExpanded.add(type);
    renderLibrary();
    if (!libraryExpanded.has(type)) document.getElementById(type)?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    return;
  }
  if (e.target.closest('[data-reader-close]')) hideLibraryModal(readerModal);
  if (e.target.closest('[data-video-close]')) hideLibraryModal(videoModal);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const zoom = document.getElementById('readerZoom');
  if (zoom && !zoom.hidden) {
    zoom.hidden = true;
    return;
  }
  hideLibraryModal(readerModal);
  hideLibraryModal(videoModal);
});

// "Media" dropdown in the header: hover on desktop, tap on touch screens
document.querySelectorAll('.nav-drop').forEach((drop) => {
  const btn = drop.querySelector('.nav-drop-btn');
  btn.addEventListener('click', () => {
    const open = drop.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  drop.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    drop.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }));
  document.addEventListener('click', (e) => {
    if (!drop.contains(e.target)) {
      drop.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
});

// ==========================================================================
// Member area link in the header (shows the member's photo when signed in)
// ==========================================================================
let headerMember = null;

function paintMemberLink() {
  const text = document.getElementById('memberLinkText');
  const avatar = document.getElementById('memberAvatar');
  if (!text || !avatar) return;
  text.dataset.i18n = headerMember ? 'mbHeaderProfile' : 'mbHeaderLogin';
  text.textContent = stripTags(t(text.dataset.i18n));
  if (headerMember?.avatar) avatar.innerHTML = `<img src="${escapeHtml(headerMember.avatar)}" alt="" />`;
  else if (headerMember) avatar.textContent = `${headerMember.firstName?.[0] || ''}${headerMember.lastName?.[0] || ''}`.toUpperCase();
  document.getElementById('memberLink')?.classList.toggle('signed-in', Boolean(headerMember));
}

(async () => {
  let memberToken = null;
  try { memberToken = sessionStorage.getItem('nbMemberToken') || localStorage.getItem('nbMemberToken'); } catch (e) { /* ignore */ }
  if (!memberToken) return;
  try {
    const response = await fetch('/api/member/me', { headers: { Authorization: `Bearer ${memberToken}` } });
    if (!response.ok) return;
    headerMember = (await response.json()).member;
    paintMemberLink();
  } catch (e) { /* offline: keep the login link */ }
})();

// ==========================================================================
// Membership Application (three steps, mirrors the Mitgliedsantrag PDF)
// ==========================================================================
const joinModal = document.getElementById('joinModal');
const joinForm = document.getElementById('joinForm');
const JOIN_STEPS = 3;
let joinStep = 1;
let joinLastFocused = null;

const MEMBER_TYPE_LABELS = { ordinary: 'Ordentliches Mitglied', supporting: 'Fördermitglied', family: 'Familienmitgliedschaft', other: 'Sonstiges' };
const FEE_LABELS = { employed: 'Berufstätige', 'low-income': 'Arbeitslose / geringes Einkommen', student: 'Studierende / Auszubildende', family: 'Familie mit mehr als 2 Kindern' };

function showJoinStep(step) {
  joinStep = step;
  joinModal.querySelectorAll('.join-panel').forEach((panel) => panel.classList.toggle('active', Number(panel.dataset.step) === step));
  joinModal.querySelectorAll('.join-steps li').forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle('active', n === step);
    li.classList.toggle('done', n < step);
  });
  document.getElementById('joinProgress').style.width = `${(step / JOIN_STEPS) * 100}%`;
  document.getElementById('joinBack').hidden = step === 1;
  document.getElementById('joinNext').hidden = step === JOIN_STEPS;
  document.getElementById('joinSubmit').hidden = step !== JOIN_STEPS;
  document.getElementById('joinError').hidden = true;
  joinModal.querySelector('.join-card').scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
}

// Checks the required fields of one step and points at the first one that is missing
function validateJoinStep(step) {
  const panel = joinModal.querySelector(`.join-panel[data-step="${step}"]`);
  const fields = [...panel.querySelectorAll('input[required]')];
  const otherInput = document.getElementById('jfOther');
  if (step === 2 && joinForm.memberType.value === 'other') fields.push(otherInput);

  const invalid = fields.find((field) => {
    if (field.type === 'radio') return !joinForm[field.name].value;
    if (field.type === 'checkbox') return !field.checked;
    return !field.value.trim() || !field.checkValidity();
  });
  panel.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  if (!invalid && step === 1) {
    const pass = joinForm.elements.password;
    const repeat = joinForm.elements.password2;
    if (pass.value.length < 8) return showJoinFieldError(pass, 'jfErrShort');
    if (pass.value !== repeat.value) return showJoinFieldError(repeat, 'jfErrMismatch');
  }
  if (!invalid) return true;

  const target = invalid.type === 'radio' ? invalid.closest('.choice-grid, .fee-list') : (invalid.closest('.consent') || invalid);
  target.classList.add('invalid');
  const error = document.getElementById('joinError');
  error.textContent = stripTags(t('jfRequired'));
  error.hidden = false;
  if (invalid.type !== 'radio') invalid.focus();
  return false;
}

function showJoinFieldError(field, key) {
  field.classList.add('invalid');
  const error = document.getElementById('joinError');
  error.textContent = stripTags(t(key));
  error.hidden = false;
  field.focus();
  return false;
}

function updateFeeTotal() {
  const fee = joinForm.fee.value;
  document.getElementById('jfFeeTotal').textContent = fee || '–';
}

function openJoinModal() {
  if (!joinModal) return;
  joinLastFocused = document.activeElement;
  joinForm.hidden = false;
  document.getElementById('joinDone').hidden = true;
  joinModal.querySelector('.join-steps').hidden = false;
  joinModal.querySelector('.join-progress').hidden = false;
  showJoinStep(1);
  joinModal.classList.add('active');
  joinModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('jfFirst')?.focus(), 300);
}

function closeJoinModal() {
  if (!joinModal) return;
  joinModal.classList.remove('active');
  joinModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  joinLastFocused?.focus?.();
}

if (joinModal && joinForm) {
  joinModal.querySelectorAll('[data-join-close]').forEach((el) => el.addEventListener('click', closeJoinModal));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && joinModal.classList.contains('active')) closeJoinModal();
  });

  document.getElementById('joinNext').addEventListener('click', () => {
    if (validateJoinStep(joinStep)) showJoinStep(Math.min(JOIN_STEPS, joinStep + 1));
  });
  document.getElementById('joinBack').addEventListener('click', () => showJoinStep(Math.max(1, joinStep - 1)));

  // Enter in a text field moves to the next step instead of submitting early
  joinForm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && joinStep < JOIN_STEPS) {
      e.preventDefault();
      document.getElementById('joinNext').click();
    }
  });

  joinForm.addEventListener('change', (e) => {
    e.target.closest('.invalid')?.classList.remove('invalid');
    if (e.target.name === 'memberType') {
      const other = joinModal.querySelector('.join-other');
      other.hidden = e.target.value !== 'other';
      if (!other.hidden) document.getElementById('jfOther').focus();
      // A family membership has its own fee, so pick it for them
      if (e.target.value === 'family') joinForm.querySelector('[data-fee="family"]').checked = true;
    }
    updateFeeTotal();
  });

  document.getElementById('jfCopyIban').addEventListener('click', async () => {
    await copyText(document.getElementById('jfIbanText').textContent.trim());
    showToast(stripTags(t('copied')));
  });

  joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateJoinStep(3)) return;
    const submitBtn = document.getElementById('joinSubmit');
    const f = joinForm.elements;
    const name = `${f.firstName.value.trim()} ${f.lastName.value.trim()}`.trim();
    const feeInput = joinForm.querySelector('[name="fee"]:checked');
    const memberType = f.memberType.value;
    const typeLabel = memberType === 'other' ? `${MEMBER_TYPE_LABELS.other}: ${f.otherType.value.trim()}` : MEMBER_TYPE_LABELS[memberType];
    const details = {
      firstName: f.firstName.value.trim(),
      lastName: f.lastName.value.trim(),
      birthDate: f.birthDate.value,
      street: f.street.value.trim(),
      zip: f.zip.value.trim(),
      city: f.city.value.trim(),
      memberType,
      otherType: memberType === 'other' ? f.otherType.value.trim() : '',
      fee: feeInput.value,
      feeCategory: feeInput.dataset.fee,
      payment: 'transfer',
      consent: 'yes',
      privacy: 'yes'
    };
    const notes = [
      'Mitgliedsantrag / Membership application',
      `Name: ${details.lastName}, ${details.firstName}`,
      `Geburtsdatum: ${details.birthDate}`,
      `Adresse: ${details.street}, ${details.zip} ${details.city}`,
      `Mitgliedschaft: ${typeLabel}`,
      `Beitrag: ${details.fee} € / Jahr (${FEE_LABELS[details.feeCategory]})`,
      'Zahlung: Überweisung',
      'Einverständnis & Datenschutz: bestätigt'
    ].join('\n');

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    try {
      const email = f.email.value.trim();
      const phone = f.phone.value.trim();
      // The member account waits for an admin to approve it in the studio
      const [register] = await Promise.all([
        fetch('/api/members/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: f.password.value, phone, details, lang: currentLanguage })
        }),
        new Promise((r) => setTimeout(r, 700))
      ]);
      if (register.status === 409) {
        showJoinStep(1);
        showJoinFieldError(f.email, 'jfErrExists');
        return;
      }
      if (!register.ok) throw new Error(`HTTP ${register.status}`);
      await postJson('/api/submissions', {
        type: 'membership', name, email, phone, details, lang: currentLanguage,
        notes: `${notes}\nMitgliedskonto: wartet auf Freigabe (Studio → Members)`
      }).catch(() => {});
      joinForm.reset();
      joinModal.querySelector('.join-other').hidden = true;
      updateFeeTotal();
      joinForm.hidden = true;
      joinModal.querySelector('.join-steps').hidden = true;
      joinModal.querySelector('.join-progress').hidden = true;
      document.getElementById('joinDoneText').textContent = stripTags(t('jfDoneText')).replace('{name}', name);
      document.getElementById('joinDone').hidden = false;
    } catch (err) {
      const error = document.getElementById('joinError');
      error.textContent = stripTags(t('sendError'));
      error.hidden = false;
    } finally {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
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

// ==========================================================================
// Cinematic journey: Afghanistan → through the clouds → Münster
// ==========================================================================
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => v * v * (3 - 2 * v);
// 0 → 1 → 0 across [start, end], with soft shoulders
const bump = (p, start, end, fade = 0.08) => clamp01((p - start) / fade) * clamp01((end - p) / fade);

const journey = document.getElementById('journey');
const journeyStage = document.getElementById('journeyStage');
const jrAf = journeyStage?.querySelector('.jr-af');
const jrDe = journeyStage?.querySelector('.jr-de');
const jrSky = journeyStage?.querySelector('.jr-sky');
const jrClouds = journeyStage ? [...journeyStage.querySelectorAll('.jr-cloud')] : [];
const jrRoute = journeyStage?.querySelector('.jr-route');
const jrPath = document.getElementById('jrPath');
const jrPlane = document.getElementById('jrPlane');
const jrCaps = journeyStage ? [...journeyStage.querySelectorAll('.jr-cap')] : [];
const jrFill = document.getElementById('jrProgressFill');
const jrHint = journeyStage?.querySelector('.jr-hint');
const zoom = prefersReducedMotion ? 0 : 1;

function renderJourney() {
  if (!journey || !journeyStage) return;
  const rect = journey.getBoundingClientRect();
  const travel = rect.height - window.innerHeight;
  if (rect.bottom < -50 || rect.top > window.innerHeight + 50) return;
  const p = clamp01(-rect.top / Math.max(1, travel));

  // 1. Afghanistan: the camera pulls back from a close-up as the clouds roll in
  //    (scenes never shrink below the screen, so their edges are never seen)
  const a = ease(clamp01(p / 0.42));
  jrAf.style.transform = `scale(${1.34 - a * 0.32 * zoom - (1 - zoom) * 0.32})`;
  jrAf.style.opacity = 1 - ease(clamp01((p - 0.26) / 0.14));

  // 2. Clouds rush past the camera, the sky deepens, the plane crosses the route
  const c = clamp01((p - 0.18) / 0.56);
  jrSky.style.opacity = bump(p, 0.24, 0.74, 0.1);
  jrClouds.forEach((cloud) => {
    const d = Number(cloud.style.getPropertyValue('--d')) || 1;
    const spread = 1 + c * 2.4 * d * zoom;
    const x = Number(cloud.style.getPropertyValue('--x')) * spread;
    const y = Number(cloud.style.getPropertyValue('--y')) * spread;
    const s = Number(cloud.style.getPropertyValue('--s')) * (0.5 + c * 2.6 * d * zoom + (1 - zoom) * 0.6);
    cloud.style.transform = `translate(-50%, -50%) translate3d(${x}vw, ${y}vh, 0) scale(${s})`;
    cloud.style.opacity = Math.sin(Math.PI * c) * 0.95;
  });
  const r = clamp01((p - 0.36) / 0.26);
  jrRoute.style.opacity = bump(p, 0.34, 0.64, 0.06);
  if (jrPath && jrPlane) {
    const length = jrPath.getTotalLength();
    const at = jrPath.getPointAtLength(r * length);
    const ahead = jrPath.getPointAtLength(Math.min(length, r * length + 1));
    const angle = Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180 / Math.PI;
    jrPlane.setAttribute('transform', `translate(${at.x} ${at.y}) rotate(${angle})`);
    jrPath.style.strokeDashoffset = `${-r * 60}`;
  }

  // 3. Münster: the camera descends and zooms in
  const g = ease(clamp01((p - 0.6) / 0.4));
  jrDe.style.opacity = ease(clamp01((p - 0.58) / 0.12));
  jrDe.style.transform = `scale(${1.02 + g * 0.26 * zoom})`;

  // Captions for each chapter
  const caps = [bump(p, -0.1, 0.3), bump(p, 0.36, 0.64), bump(p, 0.7, 1.2)];
  jrCaps.forEach((cap, i) => {
    cap.style.opacity = caps[i];
    cap.style.transform = `translate3d(0, ${(1 - caps[i]) * 24}px, 0)`;
    cap.style.visibility = caps[i] > 0.01 ? 'visible' : 'hidden';
  });
  if (jrFill) jrFill.style.transform = `scaleX(${p})`;
  if (jrHint) jrHint.style.opacity = 1 - clamp01(p / 0.06);
}

// ==========================================================================
// Flight rail: the plane follows the page; scrolling back up scatters flowers
// ==========================================================================
const flightRail = document.getElementById('flightRail');
const frPlane = document.getElementById('frPlane');
const frTrail = document.getElementById('frTrail');
let lastScrollY = window.scrollY;
let lastPetal = 0;
const PETAL_COLORS = ['#f7a6c1', '#ffd37e', '#f4c2d7', '#ffb38a', '#ffffff'];

function spawnPetals(x, y) {
  for (let i = 0; i < 3; i += 1) {
    const petal = document.createElement('span');
    petal.className = 'fr-petal';
    petal.style.left = `${x + (Math.random() - 0.5) * 14}px`;
    petal.style.top = `${y + (Math.random() - 0.5) * 10}px`;
    petal.style.setProperty('--dx', `${(Math.random() - 0.5) * 90}px`);
    petal.style.setProperty('--dy', `${50 + Math.random() * 80}px`);
    petal.style.setProperty('--rot', `${(Math.random() - 0.5) * 540}deg`);
    petal.style.setProperty('--size', `${7 + Math.random() * 7}px`);
    petal.style.background = PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)];
    document.body.appendChild(petal);
    petal.addEventListener('animationend', () => petal.remove());
  }
}

function renderFlightRail() {
  if (!flightRail || !frPlane) return;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const progress = docHeight > 0 ? clamp01(window.scrollY / docHeight) : 0;
  const line = flightRail.querySelector('.fr-line');
  const span = line.offsetHeight;
  frPlane.style.transform = `translate(-50%, ${progress * span}px)`;
  if (frTrail) frTrail.style.transform = `scaleY(${progress})`;

  const delta = window.scrollY - lastScrollY;
  if (Math.abs(delta) > 2) {
    const goingUp = delta < 0;
    frPlane.classList.toggle('up', goingUp);
    // Flying home to Afghanistan: leave a trail of petals behind the plane
    const now = performance.now();
    if (goingUp && !prefersReducedMotion && now - lastPetal > 70) {
      lastPetal = now;
      const box = frPlane.getBoundingClientRect();
      spawnPetals(box.left + box.width / 2, box.bottom);
    }
  }
  lastScrollY = window.scrollY;
}

let cineTicking = false;
function onCineScroll() {
  if (cineTicking) return;
  cineTicking = true;
  requestAnimationFrame(() => {
    cineTicking = false;
    renderJourney();
    renderFlightRail();
  });
}
window.addEventListener('scroll', onCineScroll, { passive: true });
window.addEventListener('resize', onCineScroll);
renderJourney();
renderFlightRail();

// Section headings rise out of a soft blur as they reach the screen
if ('IntersectionObserver' in window && !prefersReducedMotion) {
  const headings = document.querySelectorAll('main .section h2, main .library-head h2');
  document.body.classList.add('cine-ready');
  const cineObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('cine-in');
      cineObserver.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -12% 0px' });
  headings.forEach((h) => cineObserver.observe(h));
}

// Links like index.html?join=1 (from the member area) open the membership form
if (new URLSearchParams(location.search).has('join')) setTimeout(openJoinModal, 900);
