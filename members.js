/* ==========================================================================
   Neuer Blick Verein e.V. - Member accounts & membership fees
   Members apply through the website's membership form, wait for a studio
   admin to approve them, then sign in at member.html to see their profile,
   payments and the next due date. Stored in data/members.json.
   ========================================================================== */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MEMBER_SESSION_HOURS = 12;
const MEMBER_REMEMBER_DAYS = 30;
const OVERDUE_GRACE_DAYS = 30;
const FEES = { employed: 60, 'low-income': 24, student: 24, family: 120 };
const MEMBER_TYPES = ['ordinary', 'supporting', 'family', 'other'];
const LANGS = ['fa', 'ps', 'de', 'en'];
const PAYMENT_METHODS = ['transfer', 'cash', 'other'];

// Messages sent to members, in the language they applied in
const MAIL = {
  approved: {
    fa: { subject: 'عضویت شما در انجمن نگاه نو تأیید شد', body: 'درخواست عضویت شما تأیید شد. شماره عضویت شما {number} است. اکنون می‌توانید با ایمیل و رمز عبور خود وارد حساب کاربری شوید.' },
    ps: { subject: 'په نوي نظر ټولنه کې ستاسو غړیتوب تایید شو', body: 'ستاسو د غړیتوب غوښتنه تایید شوه. ستاسو د غړیتوب شمېره {number} ده. اوس کولای شئ په خپل ایمیل او پټنوم خپل حساب ته ننوځئ.' },
    de: { subject: 'Deine Mitgliedschaft bei Neuer Blick ist bestätigt', body: 'Dein Mitgliedsantrag wurde angenommen. Deine Mitgliedsnummer ist {number}. Du kannst dich jetzt mit deiner E-Mail-Adresse und deinem Passwort anmelden.' },
    en: { subject: 'Your Neuer Blick membership is approved', body: 'Your membership application has been approved. Your member number is {number}. You can now sign in with your email address and password.' }
  },
  rejected: {
    fa: { subject: 'درباره درخواست عضویت شما در انجمن نگاه نو', body: 'متأسفانه درخواست عضویت شما در حال حاضر پذیرفته نشد.' },
    ps: { subject: 'په نوي نظر ټولنه کې ستاسو د غړیتوب غوښتنې په اړه', body: 'له بده مرغه ستاسو د غړیتوب غوښتنه اوس مهال ونه منل شوه.' },
    de: { subject: 'Zu deinem Mitgliedsantrag bei Neuer Blick', body: 'Leider können wir deinen Mitgliedsantrag derzeit nicht annehmen.' },
    en: { subject: 'About your Neuer Blick membership application', body: 'Unfortunately we cannot accept your membership application at this time.' }
  },
  deactivated: {
    fa: { subject: 'حساب عضویت شما در انجمن نگاه نو غیرفعال شد', body: 'حساب عضویت شما غیرفعال شده است و فعلاً نمی‌توانید وارد شوید.' },
    ps: { subject: 'په نوي نظر ټولنه کې ستاسو د غړیتوب حساب غیرفعال شو', body: 'ستاسو د غړیتوب حساب غیرفعال شوی او اوس مهال نشئ ننوتلای.' },
    de: { subject: 'Dein Mitgliedskonto bei Neuer Blick wurde deaktiviert', body: 'Dein Mitgliedskonto wurde deaktiviert. Eine Anmeldung ist derzeit nicht möglich.' },
    en: { subject: 'Your Neuer Blick member account has been deactivated', body: 'Your member account has been deactivated and you cannot sign in at the moment.' }
  },
  reactivated: {
    fa: { subject: 'حساب عضویت شما دوباره فعال شد', body: 'حساب عضویت شما در انجمن نگاه نو دوباره فعال شد. خوش برگشتید!' },
    ps: { subject: 'ستاسو د غړیتوب حساب بیا فعال شو', body: 'په نوي نظر ټولنه کې ستاسو د غړیتوب حساب بیا فعال شو. بیا ښه راغلاست!' },
    de: { subject: 'Dein Mitgliedskonto ist wieder aktiv', body: 'Dein Mitgliedskonto bei Neuer Blick ist wieder aktiv. Willkommen zurück!' },
    en: { subject: 'Your member account is active again', body: 'Your Neuer Blick member account is active again. Welcome back!' }
  }
};
const MAIL_LABELS = {
  fa: { hello: 'سلام {name} عزیز،', note: 'پیام انجمن:', login: 'ورود به حساب کاربری' },
  ps: { hello: 'ګرانه {name}، سلام،', note: 'د ټولنې پیغام:', login: 'خپل حساب ته ننوځئ' },
  de: { hello: 'Salaam {name},', note: 'Nachricht des Vereins:', login: 'Zum Mitgliederbereich' },
  en: { hello: 'Salaam {name},', note: 'Message from the association:', login: 'Open the member area' }
};

// ---------- Dates & money ----------
const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

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

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Yearly dues: one fee per membership year, starting on the join date.
 * The next due date is the first membership year the payments do not cover yet.
 */
function memberFinance(member, now = new Date()) {
  const payments = Array.isArray(member.payments) ? member.payments : [];
  const paid = round2(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  const year = String(now.getUTCFullYear());
  const paidThisYear = round2(payments.filter((p) => String(p.date).startsWith(year)).reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  const fee = Number(member.fee) || 0;
  const lastPayment = payments.map((p) => p.date).sort().pop() || null;

  if (member.status !== 'active' || !member.joinedAt) {
    return { fee, paid, paidThisYear, owed: 0, balance: 0, nextDueDate: null, status: member.status === 'active' ? 'paid' : 'none', lastPayment, periods: 0 };
  }
  if (fee <= 0) {
    return { fee, paid, paidThisYear, owed: 0, balance: 0, nextDueDate: null, status: 'free', lastPayment, periods: 0 };
  }
  const periods = fullYearsBetween(member.joinedAt, now) + 1;
  const owed = round2(fee * periods);
  const balance = round2(owed - paid);
  const covered = Math.floor(paid / fee + 1e-9);
  const nextDueDate = addYears(member.joinedAt, covered);
  let status = 'paid';
  if (balance > 0) {
    const daysLate = (now - new Date(`${nextDueDate}T12:00:00Z`)) / 86400000;
    status = daysLate > OVERDUE_GRACE_DAYS ? 'overdue' : 'due';
  }
  return { fee, paid, paidThisYear, owed, balance, nextDueDate, status, lastPayment, periods };
}

module.exports = function createMembers(deps) {
  const { readJson, writeJson, send, readBody, clip, hashPassword, verifyPassword, sendMail, mailReady, siteUrl, allowForm, clientIp, ROOT } = deps;
  const AVATAR_DIR = path.join(ROOT, 'avatars');
  const sessions = new Map();
  const loginFails = new Map();

  const getMembers = () => readJson('members.json', []);
  const saveMembers = (list) => writeJson('members.json', list);
  const fullName = (m) => `${m.firstName || ''} ${m.lastName || ''}`.trim();

  function publicMember(m, { admin = false } = {}) {
    const base = {
      id: m.id,
      email: m.email,
      firstName: m.firstName,
      lastName: m.lastName,
      birthDate: m.birthDate,
      phone: m.phone || '',
      street: m.street,
      zip: m.zip,
      city: m.city,
      memberType: m.memberType,
      otherType: m.otherType || '',
      fee: Number(m.fee) || 0,
      feeCategory: m.feeCategory,
      status: m.status,
      memberNumber: m.memberNumber || '',
      avatar: m.avatar || '',
      lang: m.lang,
      createdAt: m.createdAt,
      joinedAt: m.joinedAt || null,
      payments: (m.payments || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))),
      finance: memberFinance(m)
    };
    if (!admin) return base;
    return {
      ...base,
      approvedBy: m.approvedBy || '',
      statusNote: m.statusNote || '',
      statusChangedAt: m.statusChangedAt || null,
      statusChangedBy: m.statusChangedBy || '',
      adminNotes: m.adminNotes || '',
      lastLogin: m.lastLogin || null
    };
  }

  function createSession(memberId, remember) {
    const token = crypto.randomBytes(32).toString('hex');
    const ttl = remember ? MEMBER_REMEMBER_DAYS * 86400000 : MEMBER_SESSION_HOURS * 3600000;
    sessions.set(token, { memberId, expires: Date.now() + ttl });
    return token;
  }

  function endSessionsFor(memberId) {
    [...sessions].forEach(([token, s]) => { if (s.memberId === memberId) sessions.delete(token); });
  }

  // The signed-in, active member for this request (or null)
  function sessionMember(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = token && sessions.get(token);
    if (!session) return null;
    if (session.expires < Date.now()) {
      sessions.delete(token);
      return null;
    }
    const list = getMembers();
    const member = list.find((m) => m.id === session.memberId);
    if (!member || member.status !== 'active') {
      sessions.delete(token);
      return null;
    }
    return { member, list, token };
  }

  async function notify(member, kind, message, req) {
    if (!mailReady()) return { sent: false, reason: 'Email is not configured (Settings → Email).' };
    const lang = LANGS.includes(member.lang) ? member.lang : 'de';
    const tpl = MAIL[kind][lang];
    const labels = MAIL_LABELS[lang];
    const rtl = lang === 'fa' || lang === 'ps';
    const loginUrl = `${siteUrl(req)}/member.html`;
    const greeting = labels.hello.replace('{name}', member.firstName || '');
    const body = tpl.body.replace('{number}', member.memberNumber || '');
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const showLogin = kind === 'approved' || kind === 'reactivated';
    const text = [greeting, '', body, message ? `\n${labels.note}\n${message}` : '', showLogin ? `\n${loginUrl}` : '', '\nNeuer Blick Verein e.V. · Münster'].join('\n');
    const html = `
    <div dir="${rtl ? 'rtl' : 'ltr'}" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:540px;margin:auto;border-radius:16px;overflow:hidden;border:1px solid #e5e0d4">
      <div style="background:linear-gradient(135deg,#0a2335,#0f364f);color:#fff;padding:24px 28px">
        <div style="font-size:12px;letter-spacing:2px;color:#ffd166;font-weight:700">NEUER BLICK VEREIN E.V.</div>
        <div style="font-size:20px;font-weight:800;margin-top:6px">${esc(tpl.subject)}</div>
      </div>
      <div style="padding:24px 28px;background:#fffcf6;color:#14201c;line-height:1.9">
        <p style="margin-top:0">${esc(greeting)}</p>
        <p>${esc(body)}</p>
        ${message ? `<div style="margin:18px 0;padding:14px 16px;border-radius:12px;background:#f1ebd8"><div style="font-size:12px;color:#687870;font-weight:700">${esc(labels.note)}</div><div style="white-space:pre-wrap">${esc(message)}</div></div>` : ''}
        ${showLogin ? `<a href="${esc(loginUrl)}" style="display:inline-block;background:#e27d1d;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">${esc(labels.login)}</a>` : ''}
        <p style="font-size:12px;color:#687870;margin-top:22px">Neuer Blick Verein e.V. · Münster</p>
      </div>
    </div>`;
    try {
      await sendMail({ to: member.email, subject: tpl.subject, text, html });
      return { sent: true };
    } catch (e) {
      return { sent: false, reason: e.message };
    }
  }

  function nextMemberNumber(list) {
    const year = new Date().getFullYear();
    const prefix = `NB-${year}-`;
    const highest = list
      .map((m) => m.memberNumber || '')
      .filter((n) => n.startsWith(prefix))
      .map((n) => Number(n.slice(prefix.length)) || 0)
      .reduce((a, b) => Math.max(a, b), 0);
    return `${prefix}${String(highest + 1).padStart(3, '0')}`;
  }

  // ---------- Public & member routes (no studio login) ----------
  async function handlePublic(req, res, resource, id, action) {
    const method = req.method;

    // A new membership application creates a pending account
    if (resource === 'members' && id === 'register' && method === 'POST') {
      if (!allowForm(req)) return send(res, 429, { error: 'Too many requests. Please try again later.' }), true;
      const body = await readBody(req);
      const d = body.details || {};
      const email = clip(body.email, 200).toLowerCase();
      const password = String(body.password || '');
      const required = ['firstName', 'lastName', 'birthDate', 'street', 'zip', 'city'];
      if (!/^\S+@\S+\.\S+$/.test(email) || required.some((k) => !clip(d[k], 200))) {
        return send(res, 400, { error: 'Please fill in all required fields.', code: 'invalid' }), true;
      }
      if (password.length < 8) return send(res, 400, { error: 'The password needs at least 8 characters.', code: 'password' }), true;
      const list = getMembers();
      if (list.some((m) => m.email === email)) {
        return send(res, 409, { error: 'An account with this email already exists.', code: 'exists' }), true;
      }
      const feeCategory = Object.keys(FEES).includes(d.feeCategory) ? d.feeCategory : 'employed';
      const member = {
        id: crypto.randomBytes(8).toString('hex'),
        email,
        ...hashPassword(password),
        firstName: clip(d.firstName, 80),
        lastName: clip(d.lastName, 80),
        birthDate: clip(d.birthDate, 10),
        phone: clip(body.phone, 60),
        street: clip(d.street, 160),
        zip: clip(d.zip, 12),
        city: clip(d.city, 80),
        memberType: MEMBER_TYPES.includes(d.memberType) ? d.memberType : 'ordinary',
        otherType: clip(d.otherType, 200),
        feeCategory,
        fee: FEES[feeCategory],
        lang: LANGS.includes(body.lang) ? body.lang : 'fa',
        status: 'pending',
        createdAt: new Date().toISOString(),
        payments: []
      };
      list.unshift(member);
      saveMembers(list);
      return send(res, 201, { ok: true }), true;
    }

    if (resource !== 'member') return false;

    if (id === 'login' && method === 'POST') {
      const ip = `m:${clientIp(req)}`;
      const fail = loginFails.get(ip) || { count: 0, until: 0 };
      if (fail.until > Date.now()) return send(res, 429, { error: 'Too many attempts. Please wait a moment.', code: 'locked' }), true;
      const body = await readBody(req);
      const email = clip(body.email, 200).toLowerCase();
      const list = getMembers();
      const member = list.find((m) => m.email === email);
      if (!member || !verifyPassword(String(body.password || ''), member)) {
        fail.count += 1;
        if (fail.count >= 5) {
          fail.count = 0;
          fail.until = Date.now() + 30000;
        }
        loginFails.set(ip, fail);
        return send(res, 401, { error: 'Incorrect email or password.', code: 'credentials' }), true;
      }
      loginFails.delete(ip);
      if (member.status !== 'active') {
        return send(res, 403, { error: 'This account cannot sign in.', code: member.status }), true;
      }
      member.lastLogin = new Date().toISOString();
      saveMembers(list);
      return send(res, 200, { token: createSession(member.id, Boolean(body.remember)), member: publicMember(member) }), true;
    }

    const auth = sessionMember(req);
    if (!auth) return send(res, 401, { error: 'Please sign in again.', code: 'session' }), true;
    const { member, list } = auth;

    if (id === 'me' && method === 'GET') return send(res, 200, { member: publicMember(member) }), true;

    if (id === 'me' && method === 'PUT') {
      const body = await readBody(req);
      ['phone', 'street', 'zip', 'city'].forEach((key) => {
        if (key in body) member[key] = clip(body[key], key === 'street' ? 160 : 80);
      });
      if (LANGS.includes(body.lang)) member.lang = body.lang;
      if (!member.street || !member.zip || !member.city) return send(res, 400, { error: 'Address fields cannot be empty.' }), true;
      saveMembers(list);
      return send(res, 200, { member: publicMember(member) }), true;
    }

    if (id === 'avatar' && method === 'POST') {
      const body = await readBody(req);
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ''));
      if (!match) return send(res, 400, { error: 'Please choose a JPG, PNG or WebP picture.' }), true;
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 3 * 1024 * 1024) return send(res, 413, { error: 'That picture is too large.' }), true;
      fs.mkdirSync(AVATAR_DIR, { recursive: true });
      const name = `${crypto.randomBytes(12).toString('hex')}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
      fs.writeFileSync(path.join(AVATAR_DIR, name), buffer);
      if (member.avatar) fs.rmSync(path.join(ROOT, member.avatar), { force: true });
      member.avatar = `avatars/${name}`;
      saveMembers(list);
      return send(res, 200, { member: publicMember(member) }), true;
    }

    if (id === 'password' && method === 'POST') {
      const body = await readBody(req);
      if (!verifyPassword(String(body.current || ''), member)) return send(res, 400, { error: 'Your current password is not correct.', code: 'current' }), true;
      if (String(body.next || '').length < 8) return send(res, 400, { error: 'The new password needs at least 8 characters.', code: 'password' }), true;
      Object.assign(member, hashPassword(String(body.next)));
      saveMembers(list);
      endSessionsFor(member.id);
      return send(res, 200, { token: createSession(member.id, false) }), true;
    }

    if (id === 'logout' && method === 'POST') {
      sessions.delete(auth.token);
      return send(res, 200, { ok: true }), true;
    }

    return send(res, 404, { error: 'Unknown member route.' }), true;
  }

  // ---------- Studio routes (admin is signed in) ----------
  async function handleAdmin(req, res, parts, me) {
    const [resource, id, action, subId] = parts;
    if (resource !== 'members') return false;
    const method = req.method;
    const list = getMembers();

    if (!id && method === 'GET') {
      return send(res, 200, { members: list.map((m) => publicMember(m, { admin: true })), mailReady: mailReady(), fees: FEES }), true;
    }

    const member = list.find((m) => m.id === id);
    if (!member) return send(res, 404, { error: 'Member not found.' }), true;
    const stamp = (status, note = '') => {
      member.status = status;
      member.statusNote = note;
      member.statusChangedAt = new Date().toISOString();
      member.statusChangedBy = me.username;
    };
    const reply = async (kind, notifyMember, message) => {
      saveMembers(list);
      const mail = notifyMember ? await notify(member, kind, message, req) : { sent: false, skipped: true };
      return send(res, 200, { member: publicMember(member, { admin: true }), mail }), true;
    };

    if (action === 'approve' && method === 'POST') {
      const body = await readBody(req);
      if (member.status !== 'pending') return send(res, 409, { error: 'Only pending applications can be approved.' }), true;
      member.memberNumber = member.memberNumber || nextMemberNumber(list);
      member.joinedAt = isoDay(new Date());
      member.approvedBy = me.username;
      stamp('active');
      return reply('approved', body.notify !== false, clip(body.message, 2000));
    }

    if (action === 'reject' && method === 'POST') {
      const body = await readBody(req);
      if (member.status !== 'pending') return send(res, 409, { error: 'Only pending applications can be rejected.' }), true;
      stamp('rejected', clip(body.reason, 500));
      return reply('rejected', Boolean(body.notify), clip(body.message, 2000));
    }

    if (action === 'deactivate' && method === 'POST') {
      const body = await readBody(req);
      if (member.status !== 'active') return send(res, 409, { error: 'Only active members can be deactivated.' }), true;
      stamp('deactivated', clip(body.reason, 500));
      endSessionsFor(member.id);
      return reply('deactivated', Boolean(body.notify), clip(body.message, 2000));
    }

    if (action === 'reactivate' && method === 'POST') {
      const body = await readBody(req);
      if (!['deactivated', 'rejected'].includes(member.status)) return send(res, 409, { error: 'This member is already active or pending.' }), true;
      const wasRejected = member.status === 'rejected';
      if (!member.joinedAt) {
        member.joinedAt = isoDay(new Date());
        member.memberNumber = member.memberNumber || nextMemberNumber(list);
        member.approvedBy = me.username;
      }
      stamp('active');
      return reply(wasRejected ? 'approved' : 'reactivated', Boolean(body.notify), clip(body.message, 2000));
    }

    if (action === 'payments' && method === 'POST' && !subId) {
      const body = await readBody(req);
      const amount = round2(body.amount);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) ? body.date : isoDay(new Date());
      if (!(amount > 0) || amount > 100000) return send(res, 400, { error: 'Please enter an amount greater than 0.' }), true;
      member.payments = member.payments || [];
      member.payments.push({
        id: crypto.randomBytes(6).toString('hex'),
        amount,
        date,
        method: PAYMENT_METHODS.includes(body.method) ? body.method : 'transfer',
        note: clip(body.note, 300),
        recordedBy: me.username,
        recordedAt: new Date().toISOString()
      });
      saveMembers(list);
      return send(res, 201, { member: publicMember(member, { admin: true }) }), true;
    }

    if (action === 'payments' && subId && method === 'DELETE') {
      const before = (member.payments || []).length;
      member.payments = (member.payments || []).filter((p) => p.id !== subId);
      if (member.payments.length === before) return send(res, 404, { error: 'Payment not found.' }), true;
      saveMembers(list);
      return send(res, 200, { member: publicMember(member, { admin: true }) }), true;
    }

    if (!action && method === 'PUT') {
      const body = await readBody(req);
      ['firstName', 'lastName', 'phone', 'street', 'zip', 'city', 'otherType', 'adminNotes'].forEach((key) => {
        if (key in body) member[key] = clip(body[key], key === 'adminNotes' ? 2000 : 160);
      });
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(body.birthDate || ''))) member.birthDate = body.birthDate;
      if (MEMBER_TYPES.includes(body.memberType)) member.memberType = body.memberType;
      if (Object.keys(FEES).includes(body.feeCategory)) member.feeCategory = body.feeCategory;
      if (body.fee !== undefined && Number(body.fee) >= 0 && Number(body.fee) <= 100000) member.fee = round2(body.fee);
      if (member.status === 'active' && /^\d{4}-\d{2}-\d{2}$/.test(String(body.joinedAt || ''))) member.joinedAt = body.joinedAt;
      saveMembers(list);
      return send(res, 200, { member: publicMember(member, { admin: true }) }), true;
    }

    if (!action && method === 'DELETE') {
      if (member.avatar) fs.rmSync(path.join(ROOT, member.avatar), { force: true });
      endSessionsFor(member.id);
      saveMembers(list.filter((m) => m.id !== member.id));
      return send(res, 200, { ok: true }), true;
    }

    return send(res, 404, { error: 'Unknown member route.' }), true;
  }

  return { handlePublic, handleAdmin, getMembers, fullName };
};

module.exports.memberFinance = memberFinance;
