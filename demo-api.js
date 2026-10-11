/* ==========================================================================
   Neuer Blick Verein e.V. - Demo mode for static hosting (e.g. GitHub Pages)

   When the site runs without its Node.js server, this file answers the
   website's /api/ requests inside the visitor's browser, so testers can try
   the admin studio (adminobaidi / adminobaidi), the membership form and the
   member area. Everything is stored in that browser's localStorage only:
   other visitors never see it, and nothing here is secure. On the real
   server (npm start) this file detects the server and does nothing.
   ========================================================================== */
(function () {
  const realFetch = window.fetch.bind(window);
  const PREFIX = 'nbDemo:';
  const SEED_VERSION = '1';
  const NO_MAIL = 'Emails are not sent in the demo version.';
  const CONTENT_SECTIONS = ['overrides', 'messages', 'contact', 'social', 'images', 'gallery', 'event', 'stats', 'news', 'articles', 'videos', 'documents'];
  const FEES = { employed: 60, 'low-income': 24, student: 24, family: 120 };
  const MEMBER_TYPES = ['ordinary', 'supporting', 'family', 'other'];
  const LANGS = ['fa', 'ps', 'de', 'en'];
  const IMAGE_FILES = [['1-mus938ud.jpg', 204129], ['2-musa5sde.jpg', 181402], ['2.jpg', 723252], ['3-musa5sej.jpg', 378918], ['3.jpg', 1063082], ['4-musa5sfh.jpg', 367621], ['4.jpg', 1048264], ['5.jpg', 204039], ['activity-culture.jpg', 192232], ['activity-dialogue.jpg', 162559], ['activity-education.jpg', 158893], ['activity-family.jpg', 422891], ['community-munster.jpg', 174811], ['event-dinner.jpg', 448501], ['hero-background.jpg', 796258], ['journey-afghanistan.svg', 5240], ['journey-germany.svg', 6380], ['kabul-muenster-bridge.jpg', 814910], ['kb2-murlt12j.jpg', 385422]];

  // ---------- Is the real server there? ----------
  let modePromise = null;
  function demoMode() {
    if (modePromise) return modePromise;
    if (location.protocol === 'file:' || /\.github\.io$/i.test(location.hostname)) {
      modePromise = Promise.resolve(true);
    } else {
      modePromise = realFetch('/api/health', { cache: 'no-store' })
        .then((r) => !(r.ok && (r.headers.get('content-type') || '').includes('json')))
        .catch(() => true);
    }
    modePromise.then((demo) => {
      window.NB_DEMO = demo;
      if (demo) showBadge();
    });
    return modePromise;
  }

  // ---------- Storage ----------
  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) {
      throw Object.assign(new Error('The demo storage in this browser is full. Use smaller pictures, or reset the demo.'), { status: 507 });
    }
  };

  const rid = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
  const isoDay = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
  const clip = (v, max) => String(v ?? '').trim().slice(0, max);
  const round2 = (n) => Math.round(Number(n) * 100) / 100;

  function seed() {
    if (read('seeded') === SEED_VERSION) return;
    const year = new Date().getFullYear();
    const pay = (amount, date, note = '') => ({ id: rid(6), amount, date, method: 'transfer', note, recordedBy: 'adminobaidi', recordedAt: new Date().toISOString() });
    const member = (first, last, email, extra) => ({
      id: rid(8), email, password: 'demo1234', firstName: first, lastName: last, birthDate: '1990-04-12', phone: '+49 151 0000000',
      street: 'Musterstraße 1', zip: '48149', city: 'Münster', memberType: 'ordinary', otherType: '', feeCategory: 'employed', fee: 60,
      lang: 'fa', status: 'active', createdAt: new Date(`${year - 1}-03-01`).toISOString(), payments: [], ...extra
    });
    write('users', [{ username: 'adminobaidi', email: '', password: 'adminobaidi', createdAt: new Date().toISOString(), createdBy: 'system' }]);
    write('members', [
      member('Demo', 'Rahimi', 'demo.rahimi@example.com', { memberNumber: `NB-${year}-001`, joinedAt: `${year - 1}-03-01`, approvedBy: 'adminobaidi', payments: [pay(60, `${year - 1}-03-04`, `Beitrag ${year - 1}`), pay(60, `${year}-03-02`, `Beitrag ${year}`)] }),
      member('Demo', 'Karimi', 'demo.karimi@example.com', { memberNumber: `NB-${year}-002`, memberType: 'family', feeCategory: 'family', fee: 120, joinedAt: `${year - 1}-05-10`, approvedBy: 'adminobaidi', lang: 'de', payments: [pay(120, `${year - 1}-05-12`)] }),
      member('Demo', 'Noori', 'demo.noori@example.com', { memberNumber: `NB-${year}-003`, feeCategory: 'student', fee: 24, joinedAt: isoDay(Date.now() - 20 * 86400000), approvedBy: 'adminobaidi', lang: 'ps' }),
      member('Demo', 'Sahar', 'demo.sahar@example.com', { status: 'pending', createdAt: new Date(Date.now() - 2 * 3600000).toISOString(), lang: 'en' })
    ]);
    write('seeded', SEED_VERSION);
  }

  // ---------- Membership fees (same rules as members.js on the server) ----------
  function addYears(iso, years) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return isoDay(d);
  }
  function fullYearsBetween(fromIso, to) {
    let years = to.getUTCFullYear() - Number(fromIso.slice(0, 4));
    if (addYears(fromIso, years) > isoDay(to)) years -= 1;
    return Math.max(0, years);
  }
  function memberFinance(m, now = new Date()) {
    const payments = m.payments || [];
    const paid = round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
    const year = String(now.getUTCFullYear());
    const paidThisYear = round2(payments.filter((p) => String(p.date).startsWith(year)).reduce((s, p) => s + (Number(p.amount) || 0), 0));
    const fee = Number(m.fee) || 0;
    const lastPayment = payments.map((p) => p.date).sort().pop() || null;
    if (m.status !== 'active' || !m.joinedAt) return { fee, paid, paidThisYear, owed: 0, balance: 0, nextDueDate: null, status: m.status === 'active' ? 'paid' : 'none', lastPayment, periods: 0 };
    if (fee <= 0) return { fee, paid, paidThisYear, owed: 0, balance: 0, nextDueDate: null, status: 'free', lastPayment, periods: 0 };
    const periods = fullYearsBetween(m.joinedAt, now) + 1;
    const owed = round2(fee * periods);
    const balance = round2(owed - paid);
    const nextDueDate = addYears(m.joinedAt, Math.floor(paid / fee + 1e-9));
    let status = 'paid';
    if (balance > 0) status = (now - new Date(`${nextDueDate}T12:00:00Z`)) / 86400000 > 30 ? 'overdue' : 'due';
    return { fee, paid, paidThisYear, owed, balance, nextDueDate, status, lastPayment, periods };
  }
  function publicMember(m, admin = false) {
    const { password, adminNotes, statusNote, statusChangedAt, statusChangedBy, approvedBy, lastLogin, ...base } = m;
    const out = { ...base, phone: m.phone || '', otherType: m.otherType || '', avatar: m.avatar || '', memberNumber: m.memberNumber || '', joinedAt: m.joinedAt || null, payments: (m.payments || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))), finance: memberFinance(m) };
    return admin ? { ...out, approvedBy: approvedBy || '', statusNote: statusNote || '', statusChangedAt: statusChangedAt || null, statusChangedBy: statusChangedBy || '', adminNotes: adminNotes || '', lastLogin: lastLogin || null } : out;
  }
  function nextMemberNumber(list) {
    const prefix = `NB-${new Date().getFullYear()}-`;
    const highest = list.map((m) => m.memberNumber || '').filter((n) => n.startsWith(prefix)).map((n) => Number(n.slice(prefix.length)) || 0).reduce((a, b) => Math.max(a, b), 0);
    return `${prefix}${String(highest + 1).padStart(3, '0')}`;
  }
  const publicUser = (u) => ({ username: u.username, email: u.email || '', createdAt: u.createdAt, createdBy: u.createdBy || '', lastLogin: u.lastLogin || null });
  const newPassword = () => `Demo-${rid(3)}`;

  // ---------- Sessions (token = kind + random, kept in this browser) ----------
  function createSession(kind, who) {
    const token = `demo-${kind}-${rid(16)}`;
    const sessions = read('sessions', {});
    sessions[token] = { kind, who };
    write('sessions', sessions);
    return token;
  }
  function session(headers, kind) {
    const auth = headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const s = read('sessions', {})[token];
    return s && s.kind === kind ? { ...s, token } : null;
  }
  function endSession(token) {
    const sessions = read('sessions', {});
    delete sessions[token];
    write('sessions', sessions);
  }
  function endSessionsFor(kind, who) {
    const sessions = read('sessions', {});
    Object.keys(sessions).forEach((t) => { if (sessions[t].kind === kind && sessions[t].who === who) delete sessions[t]; });
    write('sessions', sessions);
  }

  // ---------- Router ----------
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  async function handle(path, method, headers, body) {
    const [resource, id, action, subId] = path.split('/').filter(Boolean).map(decodeURIComponent);
    seed();

    // Public
    if (resource === 'health') return json(200, { ok: true, demo: true });
    if (resource === 'content' && method === 'GET') return json(200, read('content', {}));
    if (resource === 'submissions' && method === 'POST' && !id) {
      if (!clip(body.name, 120) || !/^\S+@\S+\.\S+$/.test(clip(body.email, 200))) return json(400, { error: 'Name and a valid email are required.' });
      const list = read('submissions', []);
      list.unshift({ id: rid(8), type: body.type || 'general', name: clip(body.name, 120), email: clip(body.email, 200), phone: clip(body.phone, 60), notes: clip(body.notes, 4000), details: body.details, lang: body.lang || 'fa', date: new Date().toISOString(), read: false });
      write('submissions', list);
      return json(201, { ok: true });
    }
    if (resource === 'subscribers' && method === 'POST' && !id) {
      const email = clip(body.email, 200).toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: 'A valid email is required.' });
      const list = read('subscribers', []);
      if (!list.some((s) => s.email === email)) list.unshift({ email, lang: body.lang || 'fa', date: new Date().toISOString() });
      write('subscribers', list);
      return json(201, { ok: true });
    }
    if (resource === 'login' && method === 'POST') {
      const users = read('users', []);
      const user = users.find((u) => u.username === clip(body.username, 64).toLowerCase());
      if (!user || user.password !== String(body.password || '')) return json(401, { error: 'Incorrect username or password.', attemptsLeft: 5 });
      user.lastLogin = new Date().toISOString();
      write('users', users);
      return json(200, { token: createSession('admin', user.username), user: publicUser(user) });
    }

    // Membership applications & the member area
    if (resource === 'members' && id === 'register' && method === 'POST') {
      const d = body.details || {};
      const email = clip(body.email, 200).toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email) || ['firstName', 'lastName', 'birthDate', 'street', 'zip', 'city'].some((k) => !clip(d[k], 200))) return json(400, { error: 'Please fill in all required fields.', code: 'invalid' });
      if (String(body.password || '').length < 8) return json(400, { error: 'The password needs at least 8 characters.', code: 'password' });
      const list = read('members', []);
      if (list.some((m) => m.email === email)) return json(409, { error: 'An account with this email already exists.', code: 'exists' });
      const feeCategory = FEES[d.feeCategory] !== undefined ? d.feeCategory : 'employed';
      list.unshift({
        id: rid(8), email, password: String(body.password), firstName: clip(d.firstName, 80), lastName: clip(d.lastName, 80), birthDate: clip(d.birthDate, 10),
        phone: clip(body.phone, 60), street: clip(d.street, 160), zip: clip(d.zip, 12), city: clip(d.city, 80),
        memberType: MEMBER_TYPES.includes(d.memberType) ? d.memberType : 'ordinary', otherType: clip(d.otherType, 200), feeCategory, fee: FEES[feeCategory],
        lang: LANGS.includes(body.lang) ? body.lang : 'fa', status: 'pending', createdAt: new Date().toISOString(), payments: []
      });
      write('members', list);
      return json(201, { ok: true });
    }
    if (resource === 'member') {
      const list = read('members', []);
      if (id === 'login' && method === 'POST') {
        const m = list.find((x) => x.email === clip(body.email, 200).toLowerCase());
        if (!m || m.password !== String(body.password || '')) return json(401, { error: 'Incorrect email or password.', code: 'credentials' });
        if (m.status !== 'active') return json(403, { error: 'This account cannot sign in.', code: m.status });
        m.lastLogin = new Date().toISOString();
        write('members', list);
        return json(200, { token: createSession('member', m.id), member: publicMember(m) });
      }
      const s = session(headers, 'member');
      const m = s && list.find((x) => x.id === s.who);
      if (!m || m.status !== 'active') return json(401, { error: 'Please sign in again.', code: 'session' });
      if (id === 'me' && method === 'GET') return json(200, { member: publicMember(m) });
      if (id === 'me' && method === 'PUT') {
        ['phone', 'street', 'zip', 'city'].forEach((k) => { if (k in body) m[k] = clip(body[k], 160); });
        if (LANGS.includes(body.lang)) m.lang = body.lang;
        write('members', list);
        return json(200, { member: publicMember(m) });
      }
      if (id === 'avatar' && method === 'POST') {
        if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(body.data || ''))) return json(400, { error: 'Please choose a JPG, PNG or WebP picture.' });
        m.avatar = body.data;
        write('members', list);
        return json(200, { member: publicMember(m) });
      }
      if (id === 'password' && method === 'POST') {
        if (m.password !== String(body.current || '')) return json(400, { error: 'Your current password is not correct.', code: 'current' });
        if (String(body.next || '').length < 8) return json(400, { error: 'The new password needs at least 8 characters.', code: 'password' });
        m.password = String(body.next);
        write('members', list);
        endSessionsFor('member', m.id);
        return json(200, { token: createSession('member', m.id) });
      }
      if (id === 'logout' && method === 'POST') {
        endSession(s.token);
        return json(200, { ok: true });
      }
      return json(404, { error: 'Unknown member route.' });
    }

    // Everything below needs the studio login
    const auth = session(headers, 'admin');
    const users = read('users', []);
    const me = auth && users.find((u) => u.username === auth.who);
    if (!me) return json(401, { error: 'Please sign in again.' });

    if (resource === 'logout' && method === 'POST') {
      endSession(auth.token);
      return json(200, { ok: true });
    }
    if (resource === 'me' && method === 'GET') return json(200, { user: publicUser(me), mailReady: false });
    if (resource === 'me' && id === 'password' && method === 'POST') {
      if (me.password !== String(body.current || '')) return json(400, { error: 'Your current password is not correct.' });
      if (String(body.next || '').length < 8) return json(400, { error: 'The new password needs at least 8 characters.' });
      me.password = String(body.next);
      write('users', users);
      return json(200, { ok: true });
    }
    if (resource === 'content' && method === 'PUT') {
      const current = read('content', {});
      CONTENT_SECTIONS.forEach((k) => {
        if (k in body) {
          if (body[k] === null) delete current[k];
          else current[k] = body[k];
        }
      });
      current.updatedAt = new Date().toISOString();
      current.updatedBy = me.username;
      write('content', current);
      return json(200, current);
    }
    if (resource === 'upload' && method === 'POST') {
      if (!/^data:image\//.test(String(body.data || ''))) return json(400, { error: 'Please upload a JPG, PNG, WebP, GIF or AVIF image.' });
      const uploads = read('uploads', []);
      const name = `${clip(body.filename, 60).replace(/\.\w+$/, '') || 'image'}-${rid(3)}.jpg`;
      uploads.unshift({ name, path: body.data, size: Math.round(body.data.length * 0.75), modified: new Date().toISOString() });
      write('uploads', uploads);
      return json(201, { path: body.data });
    }
    if (resource === 'upload-file') return json(400, { error: 'Video and document uploads need the real server. In the demo, paste a YouTube link instead.' });
    if (resource === 'images' && method === 'GET') {
      const stamp = new Date(0).toISOString();
      return json(200, [...read('uploads', []), ...IMAGE_FILES.map(([name, size]) => ({ name, path: `images/${name}`, size, modified: stamp }))]);
    }
    if (resource === 'images' && id && method === 'DELETE') {
      const uploads = read('uploads', []);
      if (!uploads.some((u) => u.name === id)) return json(409, { error: 'Pictures that come with the website cannot be deleted in the demo.' });
      write('uploads', uploads.filter((u) => u.name !== id));
      return json(200, { ok: true });
    }

    if (resource === 'users') {
      if (method === 'GET' && !id) return json(200, { users: users.map(publicUser), mailReady: false });
      if (method === 'POST' && !id) {
        const username = clip(body.username, 32).toLowerCase();
        if (!/^[a-z0-9._-]{3,32}$/.test(username)) return json(400, { error: 'Usernames need 3–32 characters: letters, numbers, dot, dash or underscore.' });
        if (users.some((u) => u.username === username)) return json(409, { error: 'That username is already taken.' });
        const password = body.password ? String(body.password) : newPassword();
        if (password.length < 8) return json(400, { error: 'Passwords need at least 8 characters.' });
        users.push({ username, email: clip(body.email, 200), password, createdAt: new Date().toISOString(), createdBy: me.username });
        write('users', users);
        return json(201, { user: publicUser(users[users.length - 1]), password, emailed: false, emailError: body.sendEmail !== false ? NO_MAIL : '' });
      }
      const target = users.find((u) => u.username === id);
      if (!target) return json(404, { error: 'User not found.' });
      if (method === 'DELETE' && !action) {
        if (target === me) return json(400, { error: 'You cannot delete your own account while signed in.' });
        write('users', users.filter((u) => u !== target));
        endSessionsFor('admin', target.username);
        return json(200, { ok: true });
      }
      if (method === 'POST' && action === 'reset') {
        target.password = newPassword();
        write('users', users);
        endSessionsFor('admin', target.username);
        return json(200, { password: target.password, emailed: false, emailError: target.email ? NO_MAIL : '' });
      }
    }

    if (resource === 'submissions') {
      const list = read('submissions', []);
      if (method === 'GET' && !id) return json(200, list);
      if (method === 'POST' && id === 'read-all') {
        list.forEach((s) => { s.read = true; });
        write('submissions', list);
        return json(200, { ok: true });
      }
      const entry = list.find((s) => s.id === id);
      if (!entry) return json(404, { error: 'Not found.' });
      if (method === 'PATCH') {
        entry.read = Boolean(body.read);
        write('submissions', list);
        return json(200, entry);
      }
      if (method === 'DELETE') {
        write('submissions', list.filter((s) => s !== entry));
        return json(200, { ok: true });
      }
    }
    if (resource === 'subscribers') {
      if (method === 'GET' && !id) return json(200, read('subscribers', []));
      if (method === 'DELETE' && id) {
        write('subscribers', read('subscribers', []).filter((s) => s.email !== id));
        return json(200, { ok: true });
      }
    }
    if (resource === 'mail') {
      if (method === 'GET') return json(200, { host: '', port: 465, secure: true, user: '', from: '', hasPassword: false, installed: false });
      if (method === 'PUT') return json(200, { ok: true, ready: false });
      if (method === 'POST') return json(400, { error: NO_MAIL });
    }
    if (resource === 'backup' && method === 'GET') {
      return json(200, { app: 'neuer-blick-studio', version: 3, exportedAt: new Date().toISOString(), demo: true, content: read('content', {}), submissions: read('submissions', []), subscribers: read('subscribers', []), members: read('members', []).map((m) => publicMember(m, true)) });
    }
    if (resource === 'restore' && method === 'POST') {
      if (!body.content || typeof body.content !== 'object') return json(400, { error: 'This is not a valid studio backup.' });
      write('content', body.content);
      if (Array.isArray(body.submissions)) write('submissions', body.submissions);
      if (Array.isArray(body.subscribers)) write('subscribers', body.subscribers);
      return json(200, { ok: true });
    }

    if (resource === 'members') {
      const list = read('members', []);
      if (!id && method === 'GET') return json(200, { members: list.map((m) => publicMember(m, true)), mailReady: false, fees: FEES });
      const m = list.find((x) => x.id === id);
      if (!m) return json(404, { error: 'Member not found.' });
      const stamp = (status, note = '') => Object.assign(m, { status, statusNote: note, statusChangedAt: new Date().toISOString(), statusChangedBy: me.username });
      const reply = (notify) => {
        write('members', list);
        return json(200, { member: publicMember(m, true), mail: notify ? { sent: false, reason: NO_MAIL } : { sent: false, skipped: true } });
      };
      if (action === 'approve' && method === 'POST') {
        if (m.status !== 'pending') return json(409, { error: 'Only pending applications can be approved.' });
        Object.assign(m, { memberNumber: m.memberNumber || nextMemberNumber(list), joinedAt: isoDay(), approvedBy: me.username });
        stamp('active');
        return reply(body.notify !== false);
      }
      if (action === 'reject' && method === 'POST') {
        if (m.status !== 'pending') return json(409, { error: 'Only pending applications can be rejected.' });
        stamp('rejected', clip(body.reason, 500));
        return reply(Boolean(body.notify));
      }
      if (action === 'deactivate' && method === 'POST') {
        if (m.status !== 'active') return json(409, { error: 'Only active members can be deactivated.' });
        stamp('deactivated', clip(body.reason, 500));
        endSessionsFor('member', m.id);
        return reply(Boolean(body.notify));
      }
      if (action === 'reactivate' && method === 'POST') {
        if (!['deactivated', 'rejected'].includes(m.status)) return json(409, { error: 'This member is already active or pending.' });
        if (!m.joinedAt) Object.assign(m, { joinedAt: isoDay(), memberNumber: m.memberNumber || nextMemberNumber(list), approvedBy: me.username });
        stamp('active');
        return reply(Boolean(body.notify));
      }
      if (action === 'payments' && method === 'POST' && !subId) {
        const amount = round2(body.amount);
        if (!(amount > 0) || amount > 100000) return json(400, { error: 'Please enter an amount greater than 0.' });
        m.payments = m.payments || [];
        m.payments.push({ id: rid(6), amount, date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) ? body.date : isoDay(), method: ['transfer', 'cash', 'other'].includes(body.method) ? body.method : 'transfer', note: clip(body.note, 300), recordedBy: me.username, recordedAt: new Date().toISOString() });
        write('members', list);
        return json(201, { member: publicMember(m, true) });
      }
      if (action === 'payments' && subId && method === 'DELETE') {
        m.payments = (m.payments || []).filter((p) => p.id !== subId);
        write('members', list);
        return json(200, { member: publicMember(m, true) });
      }
      if (!action && method === 'PUT') {
        ['firstName', 'lastName', 'phone', 'street', 'zip', 'city', 'otherType', 'adminNotes'].forEach((k) => { if (k in body) m[k] = clip(body[k], k === 'adminNotes' ? 2000 : 160); });
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(body.birthDate || ''))) m.birthDate = body.birthDate;
        if (MEMBER_TYPES.includes(body.memberType)) m.memberType = body.memberType;
        if (FEES[body.feeCategory] !== undefined) m.feeCategory = body.feeCategory;
        if (body.fee !== undefined && Number(body.fee) >= 0) m.fee = round2(body.fee);
        if (m.status === 'active' && /^\d{4}-\d{2}-\d{2}$/.test(String(body.joinedAt || ''))) m.joinedAt = body.joinedAt;
        write('members', list);
        return json(200, { member: publicMember(m, true) });
      }
      if (!action && method === 'DELETE') {
        endSessionsFor('member', m.id);
        write('members', list.filter((x) => x !== m));
        return json(200, { ok: true });
      }
    }

    return json(404, { error: 'This feature is not available in the demo version.' });
  }

  // ---------- Intercept the site's /api/ requests ----------
  window.fetch = async function demoAwareFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const match = /\/api\/(.*)$/.exec(url.pathname);
    if (!match || url.origin !== location.origin || !(await demoMode())) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch (e) { body = {}; }
    try {
      return await handle(match[1], method, new Headers(init.headers || {}), body);
    } catch (e) {
      return json(e.status || 500, { error: e.message || 'Demo error.' });
    }
  };

  // ---------- "Demo version" badge ----------
  function showBadge() {
    const add = () => {
      if (document.getElementById('nbDemoBadge')) return;
      const badge = document.createElement('div');
      badge.id = 'nbDemoBadge';
      badge.setAttribute('role', 'note');
      badge.innerHTML = '<b>DEMO</b><span>Changes are saved only in this browser.</span><button type="button">Reset demo</button>';
      badge.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:10px;padding:6px 8px 6px 12px;border-radius:999px;background:rgba(10,35,53,.92);color:#fff;font:600 12px/1.2 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);direction:ltr';
      badge.querySelector('b').style.cssText = 'color:#ffd37e;letter-spacing:.08em';
      badge.querySelector('button').style.cssText = 'border:0;border-radius:999px;padding:5px 10px;background:#e27d1d;color:#fff;font:700 11px system-ui,sans-serif;cursor:pointer';
      badge.querySelector('button').addEventListener('click', () => {
        if (!confirm('Reset the demo? All changes made in this browser are removed.')) return;
        Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
        ['nbStudioToken', 'nbMemberToken'].forEach((k) => { localStorage.removeItem(k); sessionStorage.removeItem(k); });
        location.reload();
      });
      document.body.appendChild(badge);
    };
    if (document.body) add();
    else document.addEventListener('DOMContentLoaded', add);
  }

  demoMode();
})();
