// WP-02 "MFA for admins": optional TOTP two-step verification (RFC 6238, compatible with
// Google Authenticator / Microsoft Authenticator). When an administrator enables it, every
// admin operation requires a session that was verified with a fresh code — regardless of how
// the admin signed in (password, phone or Google). Secrets are encrypted at rest; codes
// cannot be replayed.
import { createHmac, randomBytes } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) { let bits = 0, value = 0, out = ''; for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(value << (5 - bits)) & 31]; return out; }
export function unbase32(s) { const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, ''); let bits = 0, value = 0; const out = []; for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
export function totp(secret, timeMs = Date.now(), step = 30, counterOverride = null) {
  const counter = counterOverride ?? Math.floor(timeMs / 1000 / step);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, '0');
}

export function installMfa(ctx) {
  const { db, get, run, now, fail, requireUser, audit, rate, encrypt, decrypt, setting } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS admin_mfa(user_id TEXT PRIMARY KEY REFERENCES users(id),secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,last_counter INTEGER,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mfa_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,verified_at TEXT NOT NULL);`);
  const row = (userId) => get('SELECT * FROM admin_mfa WHERE user_id=?', userId);
  /** Verifies a code with ±1 step tolerance and blocks reuse of the same or an older step. */
  function check(userId, code) {
    const r = row(userId); if (!r) return false;
    const c = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) return false;
    const secret = decrypt(r.secret), cur = Math.floor(Date.now() / 30000);
    for (const d of [0, -1, 1]) {
      const counter = cur + d;
      if (r.last_counter != null && counter <= r.last_counter) continue;
      if (totp(secret, 0, 30, counter) === c) { run('UPDATE admin_mfa SET last_counter=? WHERE user_id=?', counter, userId); return true; }
    }
    return false;
  }
  const enabled = (userId) => !!row(userId)?.enabled;
  const verified = (tokenHash) => !!tokenHash && !!get('SELECT 1 FROM mfa_sessions WHERE token_hash=?', tokenHash);
  /** true when this admin session must still pass two-step verification. */
  const gate = (actor) => actor.kind === 'user' && actor.role === 'admin' && enabled(actor.id) && !verified(actor.tokenHash);
  const markVerified = (actor) => run('INSERT OR REPLACE INTO mfa_sessions VALUES(?,?,?)', actor.tokenHash, actor.id, now());

  async function handle(method, path, body, req) {
    if (!path.startsWith('/api/auth/mfa/')) return undefined;
    const actor = requireUser(req);
    if (method === 'GET' && path === '/api/auth/mfa/status') return { status: 200, body: { available: actor.role === 'admin', enabled: enabled(actor.id), verified: verified(actor.tokenHash), required: gate(actor) } };
    if (actor.role !== 'admin') fail(403, 'التحقق بخطوتين متاح لحسابات الإدارة', 'forbidden');
    rate(req, 'mfa', 10, 900_000);
    if (method === 'POST' && path === '/api/auth/mfa/setup') {
      if (enabled(actor.id)) fail(409, 'التحقق بخطوتين مفعّل مسبقًا', 'mfa_enabled');
      const secret = base32(randomBytes(20));
      run('INSERT INTO admin_mfa VALUES(?,?,0,NULL,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,enabled=0,last_counter=NULL,created_at=excluded.created_at', actor.id, encrypt(secret), now());
      const issuer = encodeURIComponent(setting('storeName', 'Luqta') || 'Luqta'), label = encodeURIComponent(actor.email);
      return { status: 201, body: { secret, otpauth: `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30` } };
    }
    if (method === 'POST' && path === '/api/auth/mfa/enable') {
      const r = row(actor.id); if (!r) fail(409, 'ابدأ الإعداد أولًا', 'mfa_not_setup'); if (r.enabled) fail(409, 'مفعّل مسبقًا', 'mfa_enabled');
      if (!check(actor.id, body.code)) fail(400, 'الرمز غير صحيح', 'invalid_code');
      run('UPDATE admin_mfa SET enabled=1 WHERE user_id=?', actor.id); markVerified(actor); audit(actor, 'mfa.enable', actor.id);
      return { status: 200, body: { enabled: true, verified: true } };
    }
    if (method === 'POST' && path === '/api/auth/mfa/verify') {
      if (!enabled(actor.id)) fail(409, 'التحقق بخطوتين غير مفعّل', 'mfa_disabled');
      if (!check(actor.id, body.code)) { audit(actor, 'mfa.failed', actor.id); fail(400, 'الرمز غير صحيح', 'invalid_code'); }
      markVerified(actor); return { status: 200, body: { verified: true } };
    }
    if (method === 'POST' && path === '/api/auth/mfa/disable') {
      if (!enabled(actor.id)) fail(409, 'غير مفعّل', 'mfa_disabled');
      if (!check(actor.id, body.code)) fail(400, 'الرمز غير صحيح', 'invalid_code');
      run('DELETE FROM admin_mfa WHERE user_id=?', actor.id); run('DELETE FROM mfa_sessions WHERE user_id=?', actor.id); audit(actor, 'mfa.disable', actor.id);
      return { status: 200, body: { enabled: false } };
    }
    return undefined;
  }
  return { handle, gate, deleteUser: (userId) => { run('DELETE FROM admin_mfa WHERE user_id=?', userId); run('DELETE FROM mfa_sessions WHERE user_id=?', userId); } };
}
