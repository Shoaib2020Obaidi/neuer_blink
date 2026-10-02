/* ==========================================================================
   Neuer Blick Verein e.V. - Website server & Content Studio API
   Run:  npm install   (once, for email support)
         npm start     → http://localhost:3000  ·  admin: /admin.html

   Everything the studio edits is written to disk:
     data/content.json      texts, contact, images, gallery, event, stats
     data/users.json        studio accounts (passwords are scrypt-hashed)
     data/submissions.json  requests sent from the website forms
     data/subscribers.json  newsletter sign-ups
     data/mail.json         SMTP settings for sending emails
     images/                every website photo, including uploads
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { /* email disabled until `npm install` */ }

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const IMAGES_DIR = path.join(ROOT, 'images');
const PORT = Number(process.env.PORT) || 3000;

const DEFAULT_ADMIN = { username: 'adminobaidi', password: 'adminobaidi' };
const SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;
const MAX_LOGIN_FAILS = 5;
const LOCK_MS = 30 * 1000;
const MAX_BODY = 20 * 1024 * 1024;
const CONTENT_SECTIONS = ['overrides', 'messages', 'contact', 'social', 'images', 'gallery', 'event', 'stats'];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });

// ==========================================================================
// JSON file storage
// ==========================================================================
function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(name, value) {
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

// ==========================================================================
// Accounts & sessions
// ==========================================================================
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(length);
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}

function getUsers() {
  let users = readJson('users.json', null);
  if (!Array.isArray(users) || !users.length) {
    users = [{ username: DEFAULT_ADMIN.username, email: '', ...hashPassword(DEFAULT_ADMIN.password), createdAt: new Date().toISOString(), createdBy: 'system' }];
    writeJson('users.json', users);
  }
  return users;
}

const publicUser = (u) => ({ username: u.username, email: u.email || '', createdAt: u.createdAt, createdBy: u.createdBy || '', lastLogin: u.lastLogin || null });

const sessions = new Map();
const loginFails = new Map();

function createSession(username, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = remember ? REMEMBER_DAYS * 86400000 : SESSION_HOURS * 3600000;
  sessions.set(token, { username, expires: Date.now() + ttl });
  return token;
}

function sessionUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = getUsers().find((u) => u.username === session.username);
  if (!user) {
    sessions.delete(token);
    return null;
  }
  return { user, token };
}

// ==========================================================================
// Email
// ==========================================================================
function mailSettings() {
  return readJson('mail.json', { host: '', port: 465, secure: true, user: '', pass: '', from: '' });
}

function mailReady() {
  const m = mailSettings();
  return Boolean(nodemailer && m.host && m.user && m.pass);
}

async function sendMail({ to, subject, text, html }) {
  if (!nodemailer) throw new Error('Email support is not installed. Run "npm install" in the website folder.');
  const m = mailSettings();
  if (!m.host || !m.user || !m.pass) throw new Error('Email is not configured yet (Studio → Settings → Email).');
  const transport = nodemailer.createTransport({
    host: m.host,
    port: Number(m.port) || 465,
    secure: Boolean(m.secure),
    auth: { user: m.user, pass: m.pass }
  });
  await transport.sendMail({ from: m.from || m.user, to, subject, text, html });
}

function credentialsEmail({ username, password, loginUrl, invitedBy, reset }) {
  const intro = reset
    ? 'Your password for the Neuer Blick Content Studio has been reset.'
    : `${invitedBy} has created a Neuer Blick Content Studio account for you.`;
  const text = `Salaam!\n\n${intro}\n\nLogin page: ${loginUrl}\nUsername: ${username}\nPassword: ${password}\n\nPlease change your password after signing in (Studio → Users → Change my password).\n\nNeuer Blick Verein e.V. · Münster`;
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;border-radius:16px;overflow:hidden;border:1px solid #e5e0d4">
    <div style="background:linear-gradient(135deg,#0a2335,#0f364f);color:#fff;padding:24px 28px">
      <div style="font-size:12px;letter-spacing:2px;color:#ffd166;font-weight:700">NEUER BLICK VEREIN E.V.</div>
      <div style="font-size:22px;font-weight:800;margin-top:6px">Content Studio access</div>
    </div>
    <div style="padding:24px 28px;background:#fffcf6;color:#14201c">
      <p style="margin-top:0">Salaam!</p>
      <p>${esc(intro)}</p>
      <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:15px">
        <tr><td style="padding:8px 0;color:#687870">Username</td><td style="padding:8px 0;font-weight:700">${esc(username)}</td></tr>
        <tr><td style="padding:8px 0;color:#687870">Password</td><td style="padding:8px 0;font-weight:700;font-family:Consolas,monospace">${esc(password)}</td></tr>
      </table>
      <a href="${esc(loginUrl)}" style="display:inline-block;background:#e27d1d;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">Open the Content Studio</a>
      <p style="font-size:13px;color:#687870;margin-top:22px">Please change your password after signing in (Studio → Users → Change my password).</p>
    </div>
  </div>`;
  return { subject: reset ? 'Your new Neuer Blick Studio password' : 'Your Neuer Blick Content Studio account', text, html };
}

// ==========================================================================
// HTTP helpers
// ==========================================================================
function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
const clip = (v, max) => String(v ?? '').trim().slice(0, max);
const siteUrl = (req) => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

// Simple fixed-window limiter for the public form endpoints
const formHits = new Map();
function allowForm(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = formHits.get(ip) || { count: 0, start: now };
  if (now - entry.start > 10 * 60000) { entry.count = 0; entry.start = now; }
  entry.count += 1;
  formHits.set(ip, entry);
  return entry.count <= 15;
}

// ==========================================================================
// API
// ==========================================================================
async function handleApi(req, res, pathname) {
  const method = req.method;
  const parts = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [resource, id, action] = parts;

  // ---------- Public ----------
  if (resource === 'health') return send(res, 200, { ok: true });

  if (resource === 'content' && method === 'GET') return send(res, 200, readJson('content.json', {}));

  if (resource === 'submissions' && method === 'POST' && !id) {
    if (!allowForm(req)) return send(res, 429, { error: 'Too many requests. Please try again later.' });
    const body = await readBody(req);
    const email = clip(body.email, 200);
    if (!clip(body.name, 120) || !/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Name and a valid email are required.' });
    const list = readJson('submissions.json', []);
    const entry = {
      id: crypto.randomBytes(8).toString('hex'),
      type: ['membership', 'event', 'job', 'study', 'volunteer', 'general'].includes(body.type) ? body.type : 'general',
      name: clip(body.name, 120),
      email,
      phone: clip(body.phone, 60),
      notes: clip(body.notes, 4000),
      lang: ['fa', 'de', 'en'].includes(body.lang) ? body.lang : 'fa',
      date: new Date().toISOString(),
      read: false
    };
    list.unshift(entry);
    writeJson('submissions.json', list.slice(0, 5000));
    return send(res, 201, { ok: true });
  }

  if (resource === 'subscribers' && method === 'POST' && !id) {
    if (!allowForm(req)) return send(res, 429, { error: 'Too many requests. Please try again later.' });
    const body = await readBody(req);
    const email = clip(body.email, 200).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'A valid email is required.' });
    const list = readJson('subscribers.json', []);
    if (!list.some((s) => s.email === email)) {
      list.unshift({ email, lang: ['fa', 'de', 'en'].includes(body.lang) ? body.lang : 'fa', date: new Date().toISOString() });
      writeJson('subscribers.json', list);
    }
    return send(res, 201, { ok: true });
  }

  if (resource === 'login' && method === 'POST') {
    const ip = clientIp(req);
    const fail = loginFails.get(ip) || { count: 0, until: 0 };
    if (fail.until > Date.now()) {
      return send(res, 429, { error: 'Too many attempts. Please wait.', retryIn: Math.ceil((fail.until - Date.now()) / 1000) });
    }
    const body = await readBody(req);
    const username = clip(body.username, 64).toLowerCase();
    const users = getUsers();
    const user = users.find((u) => u.username === username);
    if (!user || !verifyPassword(String(body.password || ''), user)) {
      fail.count += 1;
      if (fail.count >= MAX_LOGIN_FAILS) {
        fail.count = 0;
        fail.until = Date.now() + LOCK_MS;
        loginFails.set(ip, fail);
        return send(res, 429, { error: 'Too many attempts. Please wait.', retryIn: LOCK_MS / 1000 });
      }
      loginFails.set(ip, fail);
      return send(res, 401, { error: 'Incorrect username or password.', attemptsLeft: MAX_LOGIN_FAILS - fail.count });
    }
    loginFails.delete(ip);
    user.lastLogin = new Date().toISOString();
    writeJson('users.json', users);
    return send(res, 200, { token: createSession(user.username, Boolean(body.remember)), user: publicUser(user) });
  }

  // ---------- Everything below requires a signed-in studio user ----------
  const auth = sessionUser(req);
  if (!auth) return send(res, 401, { error: 'Please sign in again.' });
  const me = auth.user;

  if (resource === 'logout' && method === 'POST') {
    sessions.delete(auth.token);
    return send(res, 200, { ok: true });
  }

  if (resource === 'me' && method === 'GET') return send(res, 200, { user: publicUser(me), mailReady: mailReady() });

  if (resource === 'me' && id === 'password' && method === 'POST') {
    const body = await readBody(req);
    if (!verifyPassword(String(body.current || ''), me)) return send(res, 400, { error: 'Your current password is not correct.' });
    if (String(body.next || '').length < 8) return send(res, 400, { error: 'The new password needs at least 8 characters.' });
    const users = getUsers();
    const target = users.find((u) => u.username === me.username);
    Object.assign(target, hashPassword(body.next));
    writeJson('users.json', users);
    return send(res, 200, { ok: true });
  }

  if (resource === 'content' && method === 'PUT') {
    const body = await readBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Invalid content.' });
    const current = readJson('content.json', {});
    CONTENT_SECTIONS.forEach((key) => {
      if (key in body) {
        if (body[key] === null) delete current[key];
        else current[key] = body[key];
      }
    });
    current.updatedAt = new Date().toISOString();
    current.updatedBy = me.username;
    writeJson('content.json', current);
    return send(res, 200, current);
  }

  if (resource === 'upload' && method === 'POST') {
    const body = await readBody(req);
    const match = /^data:image\/(jpeg|png|webp|gif|avif);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ''));
    if (!match) return send(res, 400, { error: 'Please upload a JPG, PNG, WebP, GIF or AVIF image.' });
    const ext = { jpeg: '.jpg', png: '.png', webp: '.webp', gif: '.gif', avif: '.avif' }[match[1]];
    const base = path.basename(String(body.filename || 'image'), path.extname(String(body.filename || '')))
      .normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'image';
    const name = `${base}-${Date.now().toString(36)}${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, name), Buffer.from(match[2], 'base64'));
    return send(res, 201, { path: `images/${name}` });
  }

  if (resource === 'images' && method === 'GET') {
    const content = JSON.stringify(readJson('content.json', {}));
    const files = fs.readdirSync(IMAGES_DIR)
      .filter((f) => /\.(jpe?g|png|webp|gif|avif|svg)$/i.test(f))
      .map((f) => {
        const stat = fs.statSync(path.join(IMAGES_DIR, f));
        return { name: f, path: `images/${f}`, size: stat.size, modified: stat.mtime.toISOString(), used: content.includes(`images/${f}`) };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return send(res, 200, files);
  }

  if (resource === 'images' && id && method === 'DELETE') {
    const name = path.basename(id);
    const file = path.join(IMAGES_DIR, name);
    if (!fs.existsSync(file)) return send(res, 404, { error: 'Image not found.' });
    const inUse = JSON.stringify(readJson('content.json', {})).includes(`images/${name}`);
    const isDefault = fs.readFileSync(path.join(ROOT, 'site-data.js'), 'utf8').includes(`images/${name}`);
    if (inUse || isDefault) return send(res, 409, { error: 'This image is used on the website. Replace it first, then delete it.' });
    fs.unlinkSync(file);
    return send(res, 200, { ok: true });
  }

  if (resource === 'users') {
    const users = getUsers();
    if (method === 'GET' && !id) return send(res, 200, { users: users.map(publicUser), mailReady: mailReady() });

    if (method === 'POST' && !id) {
      const body = await readBody(req);
      const username = clip(body.username, 32).toLowerCase();
      const email = clip(body.email, 200);
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) return send(res, 400, { error: 'Usernames need 3–32 characters: letters, numbers, dot, dash or underscore.' });
      if (users.some((u) => u.username === username)) return send(res, 409, { error: 'That username is already taken.' });
      if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Please enter a valid email address.' });
      const password = body.password ? String(body.password) : generatePassword();
      if (password.length < 8) return send(res, 400, { error: 'Passwords need at least 8 characters.' });

      users.push({ username, email, ...hashPassword(password), createdAt: new Date().toISOString(), createdBy: me.username });
      writeJson('users.json', users);

      let emailed = false;
      let emailError = '';
      if (body.sendEmail !== false) {
        try {
          await sendMail({ to: email, ...credentialsEmail({ username, password, loginUrl: `${siteUrl(req)}/admin.html`, invitedBy: me.username }) });
          emailed = true;
        } catch (e) {
          emailError = e.message;
        }
      }
      return send(res, 201, { user: publicUser(users[users.length - 1]), password, emailed, emailError });
    }

    const target = users.find((u) => u.username === id);
    if (!target) return send(res, 404, { error: 'User not found.' });

    if (method === 'DELETE' && !action) {
      if (target.username === me.username) return send(res, 400, { error: 'You cannot delete your own account while signed in.' });
      if (users.length <= 1) return send(res, 400, { error: 'At least one account must remain.' });
      writeJson('users.json', users.filter((u) => u !== target));
      [...sessions].forEach(([token, s]) => { if (s.username === target.username) sessions.delete(token); });
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && action === 'reset') {
      const password = generatePassword();
      Object.assign(target, hashPassword(password));
      writeJson('users.json', users);
      [...sessions].forEach(([token, s]) => { if (s.username === target.username) sessions.delete(token); });
      let emailed = false;
      let emailError = '';
      if (target.email) {
        try {
          await sendMail({ to: target.email, ...credentialsEmail({ username: target.username, password, loginUrl: `${siteUrl(req)}/admin.html`, reset: true }) });
          emailed = true;
        } catch (e) {
          emailError = e.message;
        }
      }
      return send(res, 200, { password, emailed, emailError });
    }
  }

  if (resource === 'submissions') {
    const list = readJson('submissions.json', []);
    if (method === 'GET' && !id) return send(res, 200, list);
    if (method === 'POST' && id === 'read-all') {
      list.forEach((s) => { s.read = true; });
      writeJson('submissions.json', list);
      return send(res, 200, { ok: true });
    }
    const entry = list.find((s) => s.id === id);
    if (!entry) return send(res, 404, { error: 'Not found.' });
    if (method === 'PATCH') {
      const body = await readBody(req);
      entry.read = Boolean(body.read);
      writeJson('submissions.json', list);
      return send(res, 200, entry);
    }
    if (method === 'DELETE') {
      writeJson('submissions.json', list.filter((s) => s !== entry));
      return send(res, 200, { ok: true });
    }
  }

  if (resource === 'subscribers') {
    const list = readJson('subscribers.json', []);
    if (method === 'GET' && !id) return send(res, 200, list);
    if (method === 'DELETE' && id) {
      writeJson('subscribers.json', list.filter((s) => s.email !== id));
      return send(res, 200, { ok: true });
    }
  }

  if (resource === 'mail') {
    if (method === 'GET' && !id) {
      const m = mailSettings();
      return send(res, 200, { host: m.host, port: m.port, secure: m.secure, user: m.user, from: m.from, hasPassword: Boolean(m.pass), installed: Boolean(nodemailer) });
    }
    if (method === 'PUT' && !id) {
      const body = await readBody(req);
      const current = mailSettings();
      writeJson('mail.json', {
        host: clip(body.host, 200),
        port: Number(body.port) || 465,
        secure: Boolean(body.secure),
        user: clip(body.user, 200),
        pass: body.pass ? String(body.pass) : current.pass,
        from: clip(body.from, 200)
      });
      return send(res, 200, { ok: true, ready: mailReady() });
    }
    if (method === 'POST' && id === 'test') {
      const body = await readBody(req);
      const to = clip(body.to, 200) || me.email;
      if (!to) return send(res, 400, { error: 'Enter an address to send the test email to.' });
      try {
        await sendMail({ to, subject: 'Neuer Blick Studio · test email', text: 'Email sending works. 🎉', html: '<p>Email sending from the Neuer Blick Content Studio works. 🎉</p>' });
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 502, { error: e.message });
      }
    }
  }

  if (resource === 'backup' && method === 'GET') {
    return send(res, 200, {
      app: 'neuer-blick-studio', version: 3, exportedAt: new Date().toISOString(),
      content: readJson('content.json', {}), submissions: readJson('submissions.json', []), subscribers: readJson('subscribers.json', [])
    });
  }

  if (resource === 'restore' && method === 'POST') {
    const body = await readBody(req);
    if (!body.content || typeof body.content !== 'object') return send(res, 400, { error: 'This is not a valid studio backup.' });
    writeJson('content.json', body.content);
    if (Array.isArray(body.submissions)) writeJson('submissions.json', body.submissions);
    if (Array.isArray(body.subscribers)) writeJson('subscribers.json', body.subscribers);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Unknown API route.' });
}

// ==========================================================================
// Static files
// ==========================================================================
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const BLOCKED = new Set(['server.js', 'package.json', 'package-lock.json']);

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const relative = path.relative(ROOT, file);
  const top = relative.split(path.sep)[0];

  if (relative.startsWith('..') || path.isAbsolute(relative) || ['data', 'node_modules'].includes(top)
    || BLOCKED.has(relative) || relative.split(path.sep).some((seg) => seg.startsWith('.'))) {
    res.writeHead(404);
    return res.end('Not found');
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ==========================================================================
// Server
// ==========================================================================
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname.startsWith('/api/') || pathname === '/api') {
    try {
      await handleApi(req, res, pathname);
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error.' });
      if (!e.status) console.error(e);
    }
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405);
    return res.end();
  }
  serveStatic(req, res, pathname);
});

getUsers();
server.listen(PORT, () => {
  console.log(`\n  Neuer Blick website  →  http://localhost:${PORT}`);
  console.log(`  Content Studio       →  http://localhost:${PORT}/admin.html`);
  console.log(`  Email sending        →  ${nodemailer ? 'installed' : 'not installed (run "npm install")'}\n`);
});
