// Phone (SMS one-time code) and Google sign-in for the Luqta commerce server.
// Providers are configured on the server only; nothing secret ships in the app.
//   SMS:    BIRD_ACCESS_KEY + BIRD_WORKSPACE_ID + BIRD_SMS_CHANNEL_ID   (Bird / MessageBird)
//           or TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM
//           or AUTH_OTP_DEV=1 (non-production only: the code is returned to the caller, labelled)
//   Google: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_CALLBACK_URL  (web OAuth code flow)
//           GOOGLE_CLIENT_IDS (comma list) also accepted as audiences for native ID tokens.
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const OTP_TTL_MS = 5 * 60_000, OTP_MAX_ATTEMPTS = 5, OTP_PER_PHONE_HOUR = 5;

/** Normalise to E.164; local Jordanian numbers (07XXXXXXXX) default to +962. */
export function normalizePhone(raw, defaultCountry = '962') {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^0\d{8,10}$/.test(s)) s = `+${defaultCountry}${s.slice(1)}`;
  else if (/^7\d{8}$/.test(s) && defaultCountry === '962') s = `+962${s}`;
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  if (s.startsWith('+962') && !/^\+9627[789]\d{7}$/.test(s)) return null; // Jordanian mobiles: 077/078/079
  return s;
}

export function installAuthProviders(ctx) {
  const { db, get, run, all, transaction, id, now, fail, text, rate, session, issueRecoveryCode, notify, passwordHash, identityOptional, publicUser, options } = ctx;
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_identities(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,email TEXT,created_at TEXT NOT NULL,PRIMARY KEY(provider,subject));
    CREATE INDEX IF NOT EXISTS user_identities_user ON user_identities(user_id);
    CREATE TABLE IF NOT EXISTS otp_codes(phone TEXT PRIMARY KEY,code_hash TEXT NOT NULL,expires_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS otp_sends(phone TEXT NOT NULL,at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_states(state_hash TEXT PRIMARY KEY,provider TEXT NOT NULL,return_url TEXT NOT NULL,expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_codes(code_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL,is_new INTEGER NOT NULL DEFAULT 0);
  `);
  const env = { ...process.env, ...(options.authEnv || {}) };
  const fetcher = options.authFetch || fetch;
  const production = env.NODE_ENV === 'production';
  const sms = env.BIRD_ACCESS_KEY && env.BIRD_WORKSPACE_ID && env.BIRD_SMS_CHANNEL_ID ? 'bird'
    : env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM ? 'twilio'
    : (env.AUTH_OTP_DEV === '1' && !production) ? 'dev' : null;
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CALLBACK_URL ? { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET, callback: env.GOOGLE_CALLBACK_URL } : null;
  const audiences = new Set([env.GOOGLE_CLIENT_ID, ...(env.GOOGLE_CLIENT_IDS || '').split(',')].map((s) => (s || '').trim()).filter(Boolean));
  // Browser redirects carry a one-time login code: NEVER send them to an arbitrary HTTPS origin.
  // GOOGLE_ALLOWED_RETURN_ORIGINS is a comma-separated list of exact HTTPS origins (no paths).
  const callbackOrigin = google ? new URL(google.callback).origin : null;
  const approvedOrigins = new Set([callbackOrigin, ...(env.GOOGLE_ALLOWED_RETURN_ORIGINS || '').split(',')]
    .map((input) => {
      if (!input) return null;
      try {
        const u = new URL(input.trim());
        return u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password ? u.origin : null;
      } catch { return null; }
    }).filter(Boolean));
  const allowedReturn = (target) => {
    if (typeof target !== 'string' || target.length > 300) return false;
    // Native return targets may only be the app's dedicated authentication screen.
    if (target === 'luqta://auth' || target === 'luqta:///auth') return true;
    if (!production && /^exp\+luqta[\w-]*:\/\/\/?auth$/.test(target)) return true;
    try {
      const u = new URL(target);
      if (u.pathname !== '/auth' || u.search || u.hash || u.username || u.password) return false;
      if (!production && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) return true;
      return u.protocol === 'https:' && approvedOrigins.has(u.origin);
    } catch { return false; }
  };

  async function sendSms(phone, message) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      if (sms === 'bird') {
        const r = await fetcher(`https://api.bird.com/workspaces/${encodeURIComponent(env.BIRD_WORKSPACE_ID)}/channels/${encodeURIComponent(env.BIRD_SMS_CHANNEL_ID)}/messages`, { method: 'POST', signal: controller.signal, headers: { Authorization: `AccessKey ${env.BIRD_ACCESS_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ receiver: { contacts: [{ identifierValue: phone, identifierKey: 'phonenumber' }] }, body: { type: 'text', text: { text: message } } }) });
        if (!r.ok) fail(502, 'تعذّر إرسال رسالة الرمز؛ حاول لاحقًا', 'sms_failed');
      } else if (sms === 'twilio') {
        const body = new URLSearchParams({ To: phone, From: env.TWILIO_FROM, Body: message });
        const r = await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`, { method: 'POST', signal: controller.signal, headers: { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        if (!r.ok) fail(502, 'تعذّر إرسال رسالة الرمز؛ حاول لاحقًا', 'sms_failed');
      }
    } catch (e) { if (e.status) throw e; fail(502, 'تعذّر الاتصال بمزود الرسائل', 'sms_failed'); } finally { clearTimeout(timer); }
  }

  /** Find the user for an external identity, linking by verified email or creating one. */
  async function userFor(provider, subject, { name, email, emailVerified, linkTo }) {
    const existing = get('SELECT u.* FROM user_identities i JOIN users u ON u.id=i.user_id WHERE i.provider=? AND i.subject=?', provider, subject);
    if (existing) { if (linkTo && existing.id !== linkTo.id) fail(409, 'هذا الحساب مرتبط بمستخدم آخر', 'identity_in_use'); return { user: existing, isNew: false }; }
    if (linkTo) { run('INSERT INTO user_identities VALUES(?,?,?,?,?)', provider, subject, linkTo.id, email || null, now()); return { user: get('SELECT * FROM users WHERE id=?', linkTo.id), isNew: false }; }
    if (email && emailVerified) {
      const byEmail = get('SELECT * FROM users WHERE email=?', email.toLowerCase());
      if (byEmail) { run('INSERT INTO user_identities VALUES(?,?,?,?,?)', provider, subject, byEmail.id, email, now()); return { user: byEmail, isNew: false }; }
    }
    const pw = await passwordHash(randomBytes(24).toString('base64url'));
    const userEmail = email && emailVerified ? email.toLowerCase() : `${provider}.${sha(subject).slice(0, 20)}@${provider}.luqta.local`;
    const userId = id('usr');
    transaction(() => {
      run('INSERT INTO users VALUES(?,?,?,?,?,?)', userId, (name || 'عميل لُقطة').slice(0, 100), userEmail, pw, 'customer', now());
      run('INSERT INTO user_identities VALUES(?,?,?,?,?)', provider, subject, userId, email || null, now());
      notify(userId, 'مرحبًا بك في لُقطة', provider === 'phone' ? 'أُنشئ حسابك برقم هاتفك.' : 'أُنشئ حسابك بحساب Google.');
    });
    return { user: get('SELECT * FROM users WHERE id=?', userId), isNew: true };
  }

  async function handle(method, path, body, req, url) {
    if (method === 'GET' && path === '/api/auth/providers') return { status: 200, body: { phone: { enabled: !!sms, provider: sms, demo: sms === 'dev' }, google: { enabled: !!google, nativeAudiences: audiences.size } } };
    // ---- phone OTP ----
    if (method === 'POST' && path === '/api/auth/phone/start') {
      rate(req, 'otp-start', 10);
      const phone = normalizePhone(body.phone); if (!phone) fail(400, 'رقم الهاتف غير صالح؛ استخدم صيغة 07XXXXXXXX أو +9627XXXXXXXX', 'invalid_phone');
      if (!sms) fail(503, 'الدخول بالهاتف يحتاج ربط مزود رسائل SMS على الخادم', 'sms_not_configured');
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      run('DELETE FROM otp_sends WHERE at<?', hourAgo);
      if (get('SELECT COUNT(*) AS n FROM otp_sends WHERE phone=?', phone).n >= OTP_PER_PHONE_HOUR) fail(429, 'طلبت رموزًا كثيرة لهذا الرقم؛ حاول بعد ساعة', 'rate_limited');
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      run('INSERT INTO otp_codes VALUES(?,?,?,0,?) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,created_at=excluded.created_at', phone, sha(`${phone}:${code}`), new Date(Date.now() + OTP_TTL_MS).toISOString(), now());
      run('INSERT INTO otp_sends VALUES(?,?)', phone, now());
      if (sms !== 'dev') await sendSms(phone, `رمز الدخول إلى لُقطة: ${code}\nلا تشاركه مع أحد. صالح 5 دقائق.`);
      return { status: 200, body: { sent: true, phone, expiresIn: OTP_TTL_MS / 1000, provider: sms, ...(sms === 'dev' ? { devCode: code } : {}) } };
    }
    if (method === 'POST' && path === '/api/auth/phone/verify') {
      rate(req, 'otp-verify', 30);
      const phone = normalizePhone(body.phone); if (!phone) fail(400, 'رقم الهاتف غير صالح', 'invalid_phone');
      const code = String(body.code || '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).trim();
      const row = get('SELECT * FROM otp_codes WHERE phone=?', phone);
      if (!row || row.expires_at <= now()) fail(400, 'انتهت صلاحية الرمز؛ اطلب رمزًا جديدًا', 'otp_expired');
      if (row.attempts >= OTP_MAX_ATTEMPTS) { run('DELETE FROM otp_codes WHERE phone=?', phone); fail(429, 'محاولات كثيرة؛ اطلب رمزًا جديدًا', 'otp_locked'); }
      const expected = Buffer.from(row.code_hash, 'hex'), actual = Buffer.from(sha(`${phone}:${code}`), 'hex');
      if (!/^\d{6}$/.test(code) || !timingSafeEqual(expected, actual)) { run('UPDATE otp_codes SET attempts=attempts+1 WHERE phone=?', phone); fail(400, 'الرمز غير صحيح', 'otp_invalid'); }
      run('DELETE FROM otp_codes WHERE phone=?', phone);
      const linkTo = identityOptional(req);
      const { user, isNew } = await userFor('phone', phone, { name: body.name ? text(body.name, 'الاسم', 2, 100) : null, linkTo: linkTo?.kind === 'user' ? linkTo : null });
      if (linkTo?.kind === 'user') return { status: 200, body: { linked: true, provider: 'phone', phone, user: publicUser(user) } };
      return { status: 200, body: { ...session(user), isNew, ...(isNew ? { recoveryCode: issueRecoveryCode(user.id) } : {}) } };
    }
    // ---- Google (web OAuth code flow → one-time app code) ----
    if (method === 'POST' && path === '/api/auth/google/start') {
      rate(req, 'google-start', 20);
      if (!google) fail(503, 'الدخول بـ Google يحتاج إعداد معرّف وسر تطبيق Google على الخادم', 'google_not_configured');
      const returnUrl = body.returnUrl || 'luqta://auth'; if (!allowedReturn(returnUrl)) fail(400, 'عنوان العودة غير مسموح');
      const state = randomBytes(32).toString('base64url');
      run('DELETE FROM login_states WHERE expires_at<?', now());
      run('INSERT INTO login_states VALUES(?,?,?,?)', sha(state), 'google', returnUrl, new Date(Date.now() + 10 * 60_000).toISOString());
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      for (const [k, v] of Object.entries({ client_id: google.id, redirect_uri: google.callback, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' })) auth.searchParams.set(k, v);
      return { status: 200, body: { url: auth.toString() } };
    }
    if (method === 'GET' && path === '/api/auth/google/callback') {
      if (!google) fail(503, 'الدخول بـ Google غير معدّ', 'google_not_configured');
      const state = url.searchParams.get('state'), code = url.searchParams.get('code');
      const st = state ? get('SELECT * FROM login_states WHERE state_hash=? AND provider=?', sha(state), 'google') : null;
      if (!st || st.expires_at <= now() || !code) fail(400, 'طلب الدخول غير صالح أو انتهت مدته', 'invalid_state');
      run('DELETE FROM login_states WHERE state_hash=?', st.state_hash);
      const profile = await exchangeGoogleCode(code);
      const { user, isNew } = await userFor('google', profile.sub, { name: profile.name, email: profile.email, emailVerified: profile.email_verified });
      const appCode = randomBytes(24).toString('base64url');
      run('INSERT INTO login_codes VALUES(?,?,?,?)', sha(appCode), user.id, new Date(Date.now() + 2 * 60_000).toISOString(), isNew ? 1 : 0);
      const back = new URL(st.return_url); back.searchParams.set('code', appCode);
      return { status: 302, redirect: back.toString() };
    }
    if (method === 'POST' && path === '/api/auth/exchange') {
      rate(req, 'auth-exchange', 30);
      const code = text(body.code, 'رمز الدخول', 10, 200), row = get('SELECT * FROM login_codes WHERE code_hash=?', sha(code));
      if (!row || row.expires_at <= now()) fail(400, 'انتهت صلاحية رمز الدخول؛ أعد المحاولة', 'invalid_code');
      run('DELETE FROM login_codes WHERE code_hash=?', row.code_hash);
      const user = get('SELECT * FROM users WHERE id=?', row.user_id);
      return { status: 200, body: { ...session(user), isNew: !!row.is_new, ...(row.is_new ? { recoveryCode: issueRecoveryCode(user.id) } : {}) } };
    }
    if (method === 'POST' && path === '/api/auth/google/id-token') {
      rate(req, 'google-idtoken', 20);
      if (!audiences.size) fail(503, 'الدخول بـ Google غير معدّ', 'google_not_configured');
      const profile = await verifyIdToken(text(body.idToken, 'رمز Google', 20, 5000));
      const { user, isNew } = await userFor('google', profile.sub, { name: profile.name, email: profile.email, emailVerified: profile.email_verified });
      return { status: 200, body: { ...session(user), isNew, ...(isNew ? { recoveryCode: issueRecoveryCode(user.id) } : {}) } };
    }
    if (method === 'GET' && path === '/api/auth/identities') {
      const actor = identityOptional(req); if (actor?.kind !== 'user') fail(401, 'يرجى تسجيل الدخول', 'unauthorized');
      return { status: 200, body: { identities: all('SELECT provider,subject,email,created_at AS createdAt FROM user_identities WHERE user_id=?', actor.id).map((x) => ({ ...x, subject: x.provider === 'phone' ? x.subject : undefined })) } };
    }
    return undefined;
  }

  async function verifyIdToken(idToken) {
    const r = await fetcher(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    const p = await r.json().catch(() => ({}));
    if (!r.ok || !audiences.has(p.aud) || !['accounts.google.com', 'https://accounts.google.com'].includes(p.iss) || Number(p.exp) * 1000 < Date.now()) fail(401, 'تعذّر التحقق من حساب Google', 'google_invalid');
    return { sub: String(p.sub), email: p.email, email_verified: p.email_verified === true || p.email_verified === 'true', name: p.name };
  }
  async function exchangeGoogleCode(code) {
    const r = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: google.id, client_secret: google.secret, redirect_uri: google.callback, grant_type: 'authorization_code' }) });
    const t = await r.json().catch(() => ({}));
    if (!r.ok || !t.id_token) fail(502, 'لم يمنح Google رمز الدخول', 'google_failed');
    return verifyIdToken(t.id_token);
  }

  return { handle, providers: () => ({ phone: !!sms, google: !!google }) };
}
