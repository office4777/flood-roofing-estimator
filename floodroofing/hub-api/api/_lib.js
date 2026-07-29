// Shared helpers for the Flood Roofing Hub team-mode API (state store + login).
// Read-only-ish: it stores ONE company's dashboard state blob + a tiny user list.
// Auth is a signed bearer token (no cookies) so the Hub works whether it's opened
// as a local file or hosted — no CORS/cookie/SameSite headaches.
const crypto = require('crypto');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cron-Secret');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
}

// token = base64url(JSON payload) + "." + HMAC-SHA256(payload, SESSION_SECRET)
function sign(payload) {
  const secret = process.env.SESSION_SECRET || '';
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return body + '.' + mac;
}
function verifyToken(tok) {
  try {
    const secret = process.env.SESSION_SECRET || '';
    const parts = String(tok).split('.');
    if (parts.length !== 2) return null;
    const expected = b64url(crypto.createHmac('sha256', secret).update(parts[0]).digest());
    const a = Buffer.from(parts[1]), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const p = JSON.parse(unb64url(parts[0]));
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch (e) { return null; }
}

function bearer(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : '';
}
function requireUser(req) { return verifyToken(bearer(req)); }

// Upstash Redis via REST (the env vars Vercel's KV / Upstash integration sets).
async function kv(cmd) {
  const url = process.env.KV_REST_API_URL, tok = process.env.KV_REST_API_TOKEN;
  if (!url || !tok) { const e = new Error('KV store not configured (KV_REST_API_URL / KV_REST_API_TOKEN).'); e.code = 'NOKV'; throw e; }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('KV error: ' + (j.error || r.status));
  return j.result;
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b || {};
}

module.exports = { cors, sign, verifyToken, bearer, requireUser, kv, readBody };
