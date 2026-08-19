require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3456;

// Auth signing secret. NEVER fall back to a hardcoded string — a known
// default would let anyone forge a token for any user_id and read/write
// every job. If the env var is missing we generate a random per-boot
// secret instead: existing sessions just have to log in again after a
// restart, which beats forgeable tokens.
const JWT_SECRET = process.env.JWT_SECRET || (function () {
  console.error('WARNING: JWT_SECRET is not set — using a random per-boot secret. ' +
    'Set JWT_SECRET on Railway so logins survive restarts.');
  return crypto.randomBytes(32).toString('hex');
})();

// Tiny in-memory rate limiter for the PUBLIC quote routes (they have no
// auth by design — the token IS the credential — so cap how fast anyone
// can hammer them per IP+route).  Single-process is fine on Railway.
const _rateBuckets = new Map();
function rateLimit(maxPerWindow, windowMs) {
  return function (req, res, next) {
    const key = req.ip + '|' + req.route.path;
    const now = Date.now();
    let b = _rateBuckets.get(key);
    if (!b || now - b.start > windowMs) { b = { start: now, n: 0 }; _rateBuckets.set(key, b); }
    b.n++;
    if (_rateBuckets.size > 5000) _rateBuckets.clear();   // memory backstop
    if (b.n > maxPerWindow) return res.status(429).json({ error: 'Too many requests — slow down.' });
    next();
  };
}

// Supabase data client — ALL .from() queries run through this. It must stay on
// the service_role key so it bypasses RLS. `persistSession:false` keeps it
// stateless (no stored session, no refresh timers) on the server.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
// SEPARATE client for password sign-in. signInWithPassword() mutates the calling
// client's auth to the signed-in USER (role: authenticated), which RLS then
// restricts — so if we signed in on `supabase` above, every later query would
// stop bypassing RLS and fail (e.g. saving user_settings). Isolating sign-in
// here keeps the data client permanently on service_role.
const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:3456',
].filter(Boolean);

// Any *.vercel.app origin owned by this project's account is also
// trusted — that covers the production alias plus every PR / branch
// preview URL Vercel auto-generates.  Strict enough that random
// *.vercel.app subdomains owned by someone else still get rejected
// (we whitelist by project name prefix).
const VERCEL_PROJECT_PREFIXES = [
  'flood-roofing-estimator',
];

function isAllowedOrigin(origin) {
  if (!origin) return true;                       // same-origin / non-browser
  if (allowedOrigins.includes(origin)) return true;
  try {
    var host = new URL(origin).hostname;
    if (host.endsWith('.vercel.app')) {
      return VERCEL_PROJECT_PREFIXES.some(function(p){ return host.startsWith(p); });
    }
    // The customer-facing quote is served on the company's own domain
    // (e.g. quote.floodroofing.co.nz), which then calls this backend
    // cross-origin — allow the apex and any of its subdomains.
    if (host === 'floodroofing.co.nz' || host.endsWith('.floodroofing.co.nz')) return true;
    // The Finance Hub is hosted on GitHub Pages and calls this backend
    // cross-origin only to pull Fergus job photos (list + download).
    if (host === 'office4777.github.io') return true;
  } catch (e) {}
  return false;
}

const _corsBlockedSeen = {};
const corsOptions = {
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true);
    // Log each blocked origin once so a legitimate new domain can be added to
    // the allowlist, and DECLINE gracefully (cb(null,false)) rather than
    // throwing — throwing produced a 500 error stack on every blocked request.
    var key = origin || '(none)';
    if (!_corsBlockedSeen[key]) { _corsBlockedSeen[key] = 1; console.warn('CORS: blocked origin →', key); }
    return cb(null, false);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
// 25mb cap so saved jobs can include a base64 roof image + photos
app.use(express.json({ limit: '25mb' }));

// Health-check + visible status root.  `/` is the easiest URL to type
// in a browser and it now returns JSON so we can confirm which build
// of the backend is live without having to dig into a real route.
const BUILD_SHA = (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_SHA || 'unknown').slice(0, 7);
// ── Outbound email (order emails with the PDF attached) ────────────
// TWO delivery methods, tried in this order:
//
//  1. Resend (RESEND_API_KEY) — an HTTP API over HTTPS (port 443), which
//     is essentially never blocked by a hosting platform's egress rules.
//     Preferred whenever it's configured.  Sign up at resend.com, grab
//     an API key, and set EMAIL_FROM to an address on a domain you've
//     verified there (Resend → Domains) — an unverified domain can only
//     send to the account's own signup address, not real suppliers.
//       RESEND_API_KEY=re_xxx
//       EMAIL_FROM="Flood Roofing <office@floodroofing.co.nz>"
//
//  2. Raw SMTP (SMTP_USER/SMTP_PASS) — kept as a fallback for hosts that
//     don't restrict outbound SMTP.  Some platforms (Railway included,
//     confirmed by /email/debug's "Connection timeout" on every port)
//     block raw SMTP outright, in which case only Resend will work.
//       SMTP_HOST=smtp.gmail.com   SMTP_PORT=465
//       SMTP_USER=office@floodroofing.co.nz
//       SMTP_PASS=<16-char Google App Password>
//       SMTP_FROM="Flood Roofing <office@floodroofing.co.nz>"
//
// Until one of these is fully configured, /email/send-order answers 503
// EMAIL_NOT_CONFIGURED and the frontend falls back to Gmail compose.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_ENABLED = !!RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '';
const EMAIL_REPLYTO = process.env.EMAIL_REPLYTO || '';
// Google Workspace relay (Apps Script web app that sends as office@ via
// Gmail). Preferred when configured: it sends from the real address over
// HTTPS, leans on the domain's already-live Google SPF/DKIM, and needs no
// DNS changes or third-party domain verification.
const GAS_MAIL_URL = process.env.GAS_MAIL_URL || '';
const GAS_MAIL_TOKEN = process.env.GAS_MAIL_TOKEN || '';
const GAS_ENABLED = !!(GAS_MAIL_URL && GAS_MAIL_TOKEN);
const EMAIL_ENABLED = GAS_ENABLED || RESEND_ENABLED || !!(process.env.SMTP_USER && process.env.SMTP_PASS);
// Checks the API key is genuinely valid WITHOUT requiring "Full access"
// scope. GET /domains needs that elevated scope, so a key deliberately
// restricted to "Sending access" (the more secure, recommended choice —
// it can send mail but can't read/manage your domains or other data)
// 401s on this call with name:"restricted_api_key". That specific error
// means the key IS valid, just scoped down — treat it as success, not a
// failure, and only ANY OTHER error (invalid/missing/revoked key, or a
// network problem) counts as a real "not working" result.
async function _resendVerifyKey() {
  const r = await httpsRequest('api.resend.com', '/domains', 'GET', { Authorization: 'Bearer ' + RESEND_API_KEY }, null);
  if (r.status >= 200 && r.status < 300) return { ok: true, note: null };
  let parsed = null; try { parsed = JSON.parse(r.body); } catch (e) {}
  if (r.status === 401 && parsed && parsed.name === 'restricted_api_key') {
    return { ok: true, note: 'Key is scoped to "Sending access" only (can\'t list domains, which is fine — that\'s the more secure setting).' };
  }
  throw new Error('Resend API responded ' + r.status + ': ' + (r.body || '').slice(0, 200));
}
async function _gasVerify() {
  const r = await fetch(GAS_MAIL_URL, { method: 'GET', redirect: 'follow' });
  const txt = await r.text();
  let parsed = null; try { parsed = JSON.parse(txt); } catch (e) {}
  if (r.ok && parsed && parsed.ok) return { ok: true };
  throw new Error('Google relay URL did not respond as expected (' + r.status + '). Make sure GAS_MAIL_URL is the deployed Apps Script web-app URL.');
}
async function _gasSendMail({ to, cc, subject, text, html, attachment }) {
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(EMAIL_FROM || '');
  const fromName = (m && m[1].trim()) || 'Flood Roofing';
  const payload = {
    token: GAS_MAIL_TOKEN,
    to, cc: cc || '',
    subject, text: text || '',
    fromName,
    replyTo: EMAIL_REPLYTO || '',
  };
  // Send the HTML body under both common keys so whichever the Apps Script
  // relay reads (html / htmlBody) picks it up and calls GmailApp with htmlBody.
  if (html) { payload.html = html; payload.htmlBody = html; }
  if (attachment && attachment.base64) {
    payload.attachment = {
      base64: attachment.base64,
      filename: attachment.filename || 'order.pdf',
      mimeType: 'application/pdf',
    };
  }
  const r = await fetch(GAS_MAIL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  const txt = await r.text();
  let parsed = null; try { parsed = JSON.parse(txt); } catch (e) {}
  if (!r.ok || !parsed || parsed.ok !== true) {
    throw new Error('Google relay send failed (' + r.status + '): ' + (parsed && parsed.error ? parsed.error : (txt || '').slice(0, 200)));
  }
  return { messageId: parsed.id || null };
}
async function _resendSendMail({ to, cc, subject, text, html, attachment }) {
  if (!EMAIL_FROM) throw new Error('RESEND_API_KEY is set but EMAIL_FROM is missing — add EMAIL_FROM="Flood Roofing <office@floodroofing.co.nz>" (once that domain is verified in Resend → Domains).');
  const _split = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  const payload = { from: EMAIL_FROM, to: _split(to), subject, text };
  if (html) payload.html = html;
  if (cc) payload.cc = _split(cc);
  if (attachment && attachment.base64) {
    payload.attachments = [{ filename: attachment.filename || 'order.pdf', content: attachment.base64 }];
  }
  const r = await httpsRequest('api.resend.com', '/emails', 'POST',
    { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' }, payload);
  if (r.status >= 200 && r.status < 300) {
    let id = null; try { id = JSON.parse(r.body).id; } catch (e) {}
    return { messageId: id };
  }
  throw new Error('Resend send failed (' + r.status + '): ' + (r.body || '').slice(0, 300));
}
// Format a number as NZ money without depending on ICU locale data.
function _money(n) {
  n = Number(n) || 0;
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '$' + parts.join('.');
}
// One place that picks whichever mail transport is configured (Google
// relay → Resend → SMTP) and sends. Shared by /email/send-order and the
// customer accept-notification route so both behave identically.
async function _dispatchMail({ to, cc, subject, text, html, attachment }) {
  if (attachment && attachment.base64) {
    attachment.filename = String(attachment.filename || 'attachment.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
  }
  const subj = String(subject || '').slice(0, 300);
  const body = String(text || '');
  const htmlBody = html ? String(html) : undefined;
  if (GAS_ENABLED) {
    return _gasSendMail({ to, cc, subject: subj, text: body, html: htmlBody, attachment });
  } else if (RESEND_ENABLED) {
    return _resendSendMail({ to, cc, subject: subj, text: body, html: htmlBody, attachment });
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const attachments = (attachment && attachment.base64)
    ? [{ filename: attachment.filename, content: Buffer.from(attachment.base64, 'base64'), contentType: 'application/pdf' }]
    : [];
  const resolved = await _resolveMailTransport();
  return resolved.transporter.sendMail({ from, to, cc: cc || undefined, subject: subj, text: body, html: htmlBody, attachments });
}
function _buildSmtpTransport(port, secure) {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: port,
    secure: secure,
    requireTLS: !secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // family:4 forces IPv4 — some container platforms (Railway included)
    // have broken or unroutable IPv6 egress, which makes an SMTP
    // connection to Gmail hang until it times out ("Connection timeout")
    // even though the credentials and network are otherwise fine.
    family: 4,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
}
let _cachedTransport = null;   // { transporter, portUsed }
// Finds a working SMTP route to the mail provider instead of trusting a
// single hardcoded port. Gmail accepts mail on both 465 (implicit TLS)
// and 587 (STARTTLS); a platform that blocks or mishandles one often
// allows the other, so trying both (with the configured SMTP_PORT tried
// first) resolves the "correct credentials, still times out" case
// without the user needing to guess at a port number in Railway.
async function _resolveMailTransport(forceRefresh) {
  if (_cachedTransport && !forceRefresh) return _cachedTransport;
  const configuredPort = parseInt(process.env.SMTP_PORT || '465', 10);
  const candidates = [{ port: configuredPort, secure: configuredPort === 465 }];
  if (configuredPort !== 587) candidates.push({ port: 587, secure: false });
  if (configuredPort !== 465) candidates.push({ port: 465, secure: true });
  let lastErr = null;
  for (const c of candidates) {
    const t = _buildSmtpTransport(c.port, c.secure);
    try {
      await t.verify();
      _cachedTransport = { transporter: t, portUsed: c.port };
      return _cachedTransport;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No SMTP transport could connect');
}

// Feature flags so you can confirm from a browser which build is live.
// `customerQuote` ships with the public /q/:token + /quote-activity routes.
const FEATURES = { customerQuote: true, orderEmail: EMAIL_ENABLED };
// Railway auto-injects these (non-secret) identifiers into every
// service's environment. Surfacing them lets anyone confirm — from a
// plain browser hit on the public URL, no auth, no dashboard digging —
// that the service they're editing Variables on in the Railway UI is
// the SAME one actually answering that URL. Used to debug a case where
// SMTP_USER/SMTP_PASS were confirmed present in the dashboard's Variables
// tab, on a deployment confirmed fresh, yet the running process still
// reported them unset — pointing at a project/environment/service
// mismatch rather than a stale-deploy problem.
function _railwayIdentity(){
  return {
    projectId:  process.env.RAILWAY_PROJECT_ID || null,
    projectName:process.env.RAILWAY_PROJECT_NAME || null,
    environment:process.env.RAILWAY_ENVIRONMENT_NAME || null,
    serviceId:  process.env.RAILWAY_SERVICE_ID || null,
    serviceName:process.env.RAILWAY_SERVICE_NAME || null,
    publicDomain: process.env.RAILWAY_PUBLIC_DOMAIN || null,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
  };
}
app.get('/', (req, res) => {
  res.json({
    service: 'flood-roofing-estimator-backend',
    status: 'ok',
    build: BUILD_SHA,
    features: FEATURES,
    railway: _railwayIdentity(),
    corsAllow: 'localhost + *.vercel.app (flood-roofing-estimator-*) + FRONTEND_URL',
    time: new Date().toISOString(),
  });
});
// Which Supabase role the backend is actually running as. Reveals only the
// role name (anon vs service_role) + key shape — never the key itself — so we
// can confirm RLS-bypass without guessing which look-alike eyJ… key got pasted.
function _supabaseKeyInfo(){
  const k = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
  const from = process.env.SUPABASE_SERVICE_KEY ? 'SUPABASE_SERVICE_KEY' : (process.env.SUPABASE_ANON_KEY ? 'SUPABASE_ANON_KEY' : 'none');
  if (!k) return { role: 'none', from, bypassesRls: false };
  if (k.startsWith('sb_secret_')) return { role: 'new-secret-key', from, bypassesRls: 'unknown-to-old-client' };
  if (k.startsWith('sb_publishable_')) return { role: 'new-publishable-key', from, bypassesRls: false };
  try {
    const payload = JSON.parse(Buffer.from(k.split('.')[1] || '', 'base64').toString('utf8'));
    return { role: payload.role || 'unknown', from, bypassesRls: payload.role === 'service_role' };
  } catch (e) { return { role: 'unparseable-jwt', from, bypassesRls: false }; }
}

app.get('/health', (req, res) => res.json({ ok: true, build: BUILD_SHA, features: FEATURES, railway: _railwayIdentity(), supabase: _supabaseKeyInfo(),
  // pg=true means DATABASE_URL is set: the share-token index migration ran and
  // quote writes use the targeted jsonb update instead of round-tripping the
  // whole multi-MB draw_state. If this reads false, set DATABASE_URL on the
  // Railway service (Supabase connection string) or run the index SQL by hand.
  pg: !!process.env.DATABASE_URL, tokenCache: _tokenIdCache.size }));

// user_id → company_id, cached per process. Newer JWTs carry the company id
// (payload.cid) so this is only hit for legacy 30-day tokens minted before the
// multi-tenant upgrade; those self-heal here (a company is created on the fly
// if the boot migration hasn't backfilled one yet) so nobody is logged out or
// loses access to their jobs by the upgrade.
const _companyCache = new Map();
async function _companyOf(userId){
  if (!userId) return null;
  if (_companyCache.has(userId)) return _companyCache.get(userId);
  let cid = null;
  try {
    const { data } = await supabase.from('company_users').select('company_id').eq('user_id', userId).maybeSingle();
    cid = (data && data.company_id) || null;
    if (!cid) {
      let cname = '';
      try {
        const { data: prof } = await supabase.from('profiles').select('company, name, email').eq('id', userId).maybeSingle();
        cname = (prof && (prof.company || prof.name || prof.email)) || '';
      } catch(e){}
      const { data: co, error } = await supabase.from('companies').insert({ name: cname || 'My Company' }).select('id').single();
      if (!error && co) {
        cid = co.id;
        await supabase.from('company_users').insert({ company_id: cid, user_id: userId, role: 'owner' });
        await supabase.from('profiles').update({ company_id: cid }).eq('id', userId);
      }
    }
  } catch(e){ console.warn('_companyOf failed (continuing per-user):', e.message); }
  if (cid) {
    if (_companyCache.size > 2000) _companyCache.clear();
    _companyCache.set(userId, cid);
  }
  return cid;
}

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  // Single-purpose tokens (e.g. the emailed password-reset link) are signed
  // with the same secret but are NOT session tokens — a leaked reset email
  // must never grant API access.
  if (req.user && req.user.purpose) return res.status(401).json({ error: 'Invalid token' });
  // Tenant scope: from the token when present, otherwise resolved (and cached).
  // On any failure fall back to null — every query then scopes by user_id, the
  // pre-upgrade behaviour, so auth NEVER breaks because company lookup did.
  try {
    req.companyId = req.user.cid || await _companyOf(req.user.id);
  } catch(e){ req.companyId = null; }
  next();
}

// user_id → display name for everyone in a company. The board has to be able
// to say WHO made a job, and doing that with a lookup per row would be a query
// storm; this is one query per company, cached, and a name changes about never.
const _membersCache = new Map();   // companyId → { at, map }
async function _companyMembers(companyId){
  if (!companyId) return {};
  const hit = _membersCache.get(companyId);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.map;
  const map = {};
  try {
    const { data } = await supabase.from('profiles').select('id, name, email').eq('company_id', companyId);
    (data || []).forEach(function (p) {
      map[p.id] = (p.name || '').trim() || String(p.email || '').split('@')[0] || '';
    });
  } catch (e) { console.warn('[members] lookup failed:', e.message); }
  _membersCache.set(companyId, { at: Date.now(), map });
  return map;
}
// Name for one user, falling back to the caller's own identity (so a job made
// before the company existed still reads as someone rather than blank).
async function _nameOf(userId, req){
  if (!userId) return '';
  const map = await _companyMembers(req.companyId);
  if (map[userId]) return map[userId];
  if (userId === req.user.id) return (req.user.name || String(req.user.email || '').split('@')[0] || '');
  return '';
}

// Company-scope filter for supabase job/settings queries. Matches rows stamped
// with the user's company PLUS legacy rows that predate the backfill
// (company_id null, owned by this user) so nothing disappears mid-upgrade.
function _scopeCompany(q, req){
  if (req.companyId) {
    return q.or('company_id.eq.' + req.companyId + ',and(company_id.is.null,user_id.eq.' + req.user.id + ')');
  }
  return q.eq('user_id', req.user.id);
}

// Billing flag: when no Stripe key is present (or BILLING_ENABLED is not
// explicitly set true) we treat billing as "not yet configured" — and
// the subscription gate becomes a no-op so a missing/expired trial row
// in Supabase doesn't 403 every JMS/AI call.
const BILLING_ENABLED = process.env.BILLING_ENABLED === 'true' || !!process.env.STRIPE_SECRET_KEY;

async function requireSubscription(req, res, next) {
  if (!BILLING_ENABLED) return next();
  try {
    const { data } = await supabase
      .from('subscriptions')
      .select('status, trial_ends_at')
      .eq('user_id', req.user.id)
      .single();
    if (!data) return res.status(403).json({ error: 'No subscription found' });
    const isActive = data.status === 'active' || data.status === 'trialing';
    const inTrial = data.trial_ends_at && new Date(data.trial_ends_at) > new Date();
    if (!isActive && !inTrial) return res.status(403).json({ error: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED' });
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

app.post('/auth/register', async (req, res) => {
  const { email, password, name, company } = req.body;
  // Self-registration is invite-gated: with it open, a stranger could
  // mint a trial account and spend the owner's Anthropic / Fergus keys
  // through the authenticated proxies.  Set REGISTRATION_INVITE_CODE on
  // Railway and share it when onboarding someone; set
  // OPEN_REGISTRATION=true to deliberately restore open signup.
  let invitedViaCode = false;
  if (process.env.OPEN_REGISTRATION !== 'true') {
    const invite = (req.body || {}).invite || '';
    const expected = process.env.REGISTRATION_INVITE_CODE || '';
    if (!expected || invite !== expected) {
      return res.status(403).json({ error: 'Registration is invite-only — contact Flood Roofing for access.' });
    }
    invitedViaCode = true;
  }
  try {
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return res.status(400).json({ error: error.message });
    const userId = data.user.id;
    await supabase.from('profiles').insert({ id: userId, email, name: name || '', company: company || '' });
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);
    await supabase.from('subscriptions').insert({ user_id: userId, status: 'trialing', trial_ends_at: trialEnd.toISOString() });
    // Every new account gets its own company (its tenant): jobs, photos and
    // settings are scoped to it, and teammates can be attached to the same
    // company later. Falls back to per-user scoping if the tables aren't there.
    // If INVITE_COMPANY_ID is set, people who sign up with the invite code join
    // THAT company as members instead of getting their own — that's how the
    // Flood Roofing team shares one set of jobs.
    let cid = null;
    if (invitedViaCode && process.env.INVITE_COMPANY_ID) {
      const { error: merr } = await supabase.from('company_users').insert({ company_id: process.env.INVITE_COMPANY_ID, user_id: userId, role: 'member' });
      if (!merr) {
        cid = process.env.INVITE_COMPANY_ID;
        await supabase.from('profiles').update({ company_id: cid }).eq('id', userId);
        _companyCache.set(userId, cid);
      } else { console.warn('[auth] INVITE_COMPANY_ID join failed, giving own company:', merr.message); }
    }
    if (!cid) cid = await _companyOf(userId);
    const token = jwt.sign({ id: userId, email, cid }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: userId, email, name, company, company_id: cid } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Password reset ─────────────────────────────────────────────────
// POST /auth/forgot { email } → emails a signed, 30-minute reset link
// (https://<frontend>/?reset=<token>). Always answers ok so the endpoint
// can't be used to probe which emails have accounts. Uses the same mail
// transports as order emails (Resend / GAS / SMTP).
app.post('/auth/forgot', rateLimit(5, 900000), async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  res.json({ ok: true });
  if (!email || !EMAIL_ENABLED) {
    if (email && !EMAIL_ENABLED) console.warn('[auth] reset requested for ' + email + ' but no mail transport is configured');
    return;
  }
  try {
    let userId = null;
    const { data: prof } = await supabase.from('profiles').select('id').ilike('email', email).maybeSingle();
    if (prof) userId = prof.id;
    if (!userId) {
      // profiles row can be missing for accounts created directly in Supabase
      const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const u = ((data && data.users) || []).find(u => (u.email || '').toLowerCase() === email);
      if (u) userId = u.id;
    }
    if (!userId) { console.log('[auth] reset requested for unknown email (no mail sent)'); return; }
    const t = jwt.sign({ id: userId, email, purpose: 'pwreset' }, JWT_SECRET, { expiresIn: '30m' });
    const base = (process.env.FRONTEND_URL || 'https://quote.floodroofing.co.nz').replace(/\/+$/, '');
    const link = base + '/?reset=' + encodeURIComponent(t);
    await _dispatchMail({
      to: email,
      subject: 'Reset your RoofMap password',
      text: 'Someone (hopefully you) asked to reset the RoofMap password for ' + email + '.\n\n' +
            'Open this link to choose a new password (it works for 30 minutes):\n' + link + '\n\n' +
            'If this wasn\'t you, you can ignore this email — your password is unchanged.',
      html: '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;color:#1c2733;line-height:1.6">' +
            '<p>Someone (hopefully you) asked to reset the RoofMap password for <strong>' + email + '</strong>.</p>' +
            '<p><a href="' + link + '" style="display:inline-block;background:#0a1628;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600">Choose a new password</a></p>' +
            '<p style="color:#667">The link works for 30 minutes. If this wasn\'t you, ignore this email — your password is unchanged.</p></div>',
    });
    console.log('[auth] password reset email sent');
  } catch (e) { console.error('[auth] forgot-password failed:', e.message); }
});

// POST /auth/reset { token, password } → verifies the emailed token, sets the
// new password via the Supabase admin API, and signs the user straight in.
app.post('/auth/reset', rateLimit(10, 900000), async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || String(password).length < 8) {
    return res.status(400).json({ error: 'A reset link and a password of at least 8 characters are required.' });
  }
  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); }
  catch { return res.status(401).json({ error: 'This reset link has expired or already been used — request a new one.' }); }
  if (payload.purpose !== 'pwreset') return res.status(401).json({ error: 'Invalid reset link.' });
  try {
    const { error } = await supabase.auth.admin.updateUserById(payload.id, { password: String(password) });
    if (error) return res.status(400).json({ error: error.message });
    const cid = await _companyOf(payload.id);
    const authToken = jwt.sign({ id: payload.id, email: payload.email, cid }, JWT_SECRET, { expiresIn: '30d' });
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', payload.id).maybeSingle();
    res.json({ token: authToken, user: profile || { id: payload.id, email: payload.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid email or password' });
    const userId = data.user.id;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).single();
    const cid = await _companyOf(userId);
    const token = jwt.sign({ id: userId, email, cid }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { ...profile, company_id: cid }, subscription: sub });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/auth/me', requireAuth, async (req, res) => {
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
  const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', req.user.id).single();
  res.json({ user: profile, subscription: sub });
});

app.post('/billing/checkout', requireAuth, (req, res) => res.status(503).json({ error: 'Billing not configured yet' }));
app.post('/billing/portal', requireAuth, (req, res) => res.status(503).json({ error: 'Billing not configured yet' }));
app.post('/webhook', (req, res) => res.status(503).json({ error: 'Webhooks not configured yet' }));

// The list every board and job-picker reads. Jobs belong to the COMPANY, so a
// teammate sees them all — but each row now says who made it, and who sent the
// material order, which is the whole point of several people sharing one set of
// jobs. Names are resolved here rather than stored on the row, so renaming a
// person fixes every job at once.
app.get('/jobs', requireAuth, async (req, res) => {
  const COLS = 'id, client_name, site_address, created_at, updated_at, status, user_id, order_sent';
  let { data, error } = await _scopeCompany(supabase.from('jobs').select(COLS), req).order('updated_at', { ascending: false });
  if (error && /order_sent/.test(error.message || '')) {
    // Column not migrated on this database yet — serve the list without it
    // rather than failing the whole board.
    ({ data, error } = await _scopeCompany(supabase.from('jobs')
      .select('id, client_name, site_address, created_at, updated_at, status, user_id'), req)
      .order('updated_at', { ascending: false }));
  }
  if (error) return res.status(500).json({ error: error.message });
  const names = await _companyMembers(req.companyId);
  const me = (req.user.name || String(req.user.email || '').split('@')[0] || '');
  res.json((data || []).map(function (j) {
    const os = j.order_sent && typeof j.order_sent === 'object' ? j.order_sent : null;
    return Object.assign({}, j, {
      created_by: names[j.user_id] || (j.user_id === req.user.id ? me : ''),
      order_sent: os ? Object.assign({}, os, { by_name: names[os.by] || '' }) : (j.order_sent || null),
    });
  }));
});

// The office emails a material order. Stamped SERVER-side so the "who" is the
// authenticated user and can't be spoofed or lost by a client that forgot to
// send it. Also flips the cheap status column the board filters on.
app.post('/jobs/:id/order-sent', requireAuth, async (req, res) => {
  const b = req.body || {};
  const stamp = {
    at: new Date().toISOString(),
    to: String(b.to || '').slice(0, 300),
    supplier: String(b.supplier || '').slice(0, 200),
    by: req.user.id,
  };
  let { error } = await _scopeCompany(supabase.from('jobs')
    .update({ order_sent: stamp, status: 'ordered', updated_at: stamp.at }).eq('id', req.params.id), req);
  if (error && /order_sent/.test(error.message || '')) {
    ({ error } = await _scopeCompany(supabase.from('jobs')
      .update({ status: 'ordered', updated_at: stamp.at }).eq('id', req.params.id), req));
  }
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, order_sent: Object.assign({}, stamp, { by_name: await _nameOf(req.user.id, req) }) });
});

app.post('/jobs', requireAuth, requireSubscription, async (req, res) => {
  const { client_name, site_address, draw_state, settings } = req.body;
  const { data, error } = await supabase.from('jobs').insert({ user_id: req.user.id, company_id: req.companyId || null, client_name: client_name || '', site_address: site_address || '', draw_state: draw_state || {}, settings: settings || {}, status: 'draft' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/jobs/:id', requireAuth, async (req, res) => {
  const patch = { ...req.body, updated_at: new Date().toISOString() };
  delete patch.user_id; delete patch.company_id; delete patch.id;   // ownership fields are never client-writable
  const { data, error } = await _scopeCompany(supabase.from('jobs').update(patch).eq('id', req.params.id), req).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/jobs/:id', requireAuth, async (req, res) => {
  const { data, error } = await _scopeCompany(supabase.from('jobs').select('*').eq('id', req.params.id), req).single();
  if (!error && data) {
    // Same attribution the list carries, so opening a job shows who made it.
    try {
      data.created_by = await _nameOf(data.user_id, req);
      if (data.order_sent && typeof data.order_sent === 'object')
        data.order_sent = Object.assign({}, data.order_sent, { by_name: await _nameOf(data.order_sent.by, req) });
    } catch (e) {}
  }
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Lazy shared Postgres pool (for targeted jsonb updates that don't round-trip
// the whole multi-MB draw_state). Null when DATABASE_URL isn't set.
let _pgPoolInst = null, _pgPoolTried = false;
function _pgPool(){
  if (_pgPoolTried) return _pgPoolInst;
  _pgPoolTried = true;
  if (!process.env.DATABASE_URL) return null;
  try {
    const { Pool } = require('pg');
    _pgPoolInst = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4, idleTimeoutMillis: 30000, connectionTimeoutMillis: 8000 });
    _pgPoolInst.on('error', function(e){ console.warn('pg pool error:', e.message); });
  } catch(e){ console.warn('pg pool init failed:', e.message); _pgPoolInst = null; }
  return _pgPoolInst;
}

// Publish ONLY the quote onto an existing job. The customer /q/:token view reads
// exactly this quote, so the customer link / Fergus push don't need the heavy
// photo+aerial upload. FAST PATH: a single UPDATE with a jsonb merge so the
// multi-MB draw_state never travels DB→server→DB (the old read-modify-write
// round-tripped the whole aerial + photos on EVERY publish — that was the "takes
// ages" regression). Falls back to the supabase read-modify-write if there's no
// direct DB connection.
app.put('/jobs/:id/quote', requireAuth, async (req, res) => {
  const quote = req.body && req.body.quote;
  if (!quote || typeof quote !== 'object') return res.status(400).json({ error: 'quote object required' });
  const clientName = req.body.client_name ? String(req.body.client_name).slice(0, 300) : null;
  const siteAddr   = req.body.site_address ? String(req.body.site_address).slice(0, 500) : null;
  const pool = _pgPool();
  if (pool) {
    try {
      // Merge quote into draw_state.state.quote, preserving every other key.
      const sql = "UPDATE public.jobs SET draw_state = " +
        "coalesce(draw_state,'{}'::jsonb) || jsonb_build_object('state', " +
        "coalesce(draw_state->'state','{}'::jsonb) || jsonb_build_object('quote', $1::jsonb)), " +
        "client_name = coalesce($2, client_name), site_address = coalesce($3, site_address), " +
        "updated_at = now() WHERE id = $4 AND (user_id = $5 OR ($6::uuid IS NOT NULL AND company_id = $6::uuid))";
      const r = await pool.query(sql, [JSON.stringify(quote), clientName, siteAddr, req.params.id, req.user.id, req.companyId || null]);
      if (r.rowCount === 0) return res.status(404).json({ error: 'Job not found' });
      return res.json({ ok: true, id: req.params.id, fast: true });
    } catch (e) {
      console.error('quote fast-update failed, falling back to read-modify-write:', e.message);
      // fall through
    }
  }
  const { data: job, error } = await _scopeCompany(supabase.from('jobs')
    .select('id, draw_state').eq('id', req.params.id), req).single();
  if (error || !job) return res.status(404).json({ error: 'Job not found' });
  const ds = job.draw_state || {};
  ds.state = ds.state || {};
  ds.state.quote = quote;
  const patch = { draw_state: ds, updated_at: new Date().toISOString() };
  if (clientName) patch.client_name = clientName;
  if (siteAddr) patch.site_address = siteAddr;
  const { error: uerr } = await supabase.from('jobs').update(patch).eq('id', job.id);
  if (uerr) return res.status(500).json({ error: uerr.message });
  res.json({ ok: true, id: job.id });
});

app.delete('/jobs/:id', requireAuth, async (req, res) => {
  const { error } = await _scopeCompany(supabase.from('jobs').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Job revision history (automatic DB snapshots — see _MIGRATION_SQL) ──
// GET lists the snapshots for a job (metadata only, never the multi-MB
// draw_state); POST restores one — onto the existing job row (the update
// trigger snapshots the current state first, so a restore is itself
// undoable) or by re-creating the job if it was deleted.
app.get('/jobs/:id/revisions', requireAuth, async (req, res) => {
  const { data, error } = await _scopeCompany(
    supabase.from('job_revisions').select('id, job_id, client_name, site_address, status, reason, saved_at').eq('job_id', req.params.id), req)
    .order('saved_at', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/jobs/:id/revisions/:revId/restore', requireAuth, async (req, res) => {
  try {
    const { data: rev, error } = await _scopeCompany(
      supabase.from('job_revisions').select('*').eq('id', req.params.revId).eq('job_id', req.params.id), req).single();
    if (error || !rev) return res.status(404).json({ error: 'Revision not found' });
    const { data: existing } = await supabase.from('jobs').select('id').eq('id', rev.job_id).maybeSingle();
    const fields = {
      client_name: rev.client_name || '', site_address: rev.site_address || '',
      draw_state: rev.draw_state || {}, settings: rev.settings || {},
      status: rev.status || 'draft', updated_at: new Date().toISOString(),
    };
    if (existing) {
      const { error: uerr } = await supabase.from('jobs').update(fields).eq('id', rev.job_id);
      if (uerr) return res.status(500).json({ error: uerr.message });
    } else {
      const { error: ierr } = await supabase.from('jobs').insert({ id: rev.job_id, user_id: rev.user_id || req.user.id, company_id: rev.company_id || req.companyId || null, ...fields });
      if (ierr) return res.status(500).json({ error: ierr.message });
    }
    res.json({ ok: true, id: rev.job_id, recreated: !existing });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Per-user settings: branding, quote defaults, JMS API keys. A user with no
// settings row yet inherits their company's most recent one (so a teammate
// joining an existing company starts with the company branding + price book).
// The company's ONE settings row. Price book, branding, labour rates and the
// job-number counter belong to the BUSINESS, not to whoever happens to be
// logged in: three office staff each editing a private copy is exactly how
// price books drift apart and how two people hand out job 06121 on the same
// morning. Canonical = the company's most recently updated row, so existing
// per-user rows converge on one the first time anybody saves. Nothing is
// deleted — an old row just stops being the one that's read.
async function _companySettingsRow(req){
  if (req.companyId){
    const { data } = await supabase.from('user_settings').select('*')
      .eq('company_id', req.companyId).order('updated_at', { ascending: false }).limit(1);
    if (data && data[0]) return data[0];
  }
  const { data } = await supabase.from('user_settings').select('*').eq('user_id', req.user.id).maybeSingle();
  return data || null;
}

app.get('/settings', requireAuth, async (req, res) => {
  try {
    const row = await _companySettingsRow(req);
    res.json(row || { user_id: req.user.id, branding: {}, quote_defaults: {}, jms_keys: {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/settings', requireAuth, async (req, res) => {
  const { branding, quote_defaults, jms_keys, price_book, labour_pricing } = req.body;
  const payload = {
    branding: branding || {},
    quote_defaults: quote_defaults || {},
    jms_keys: jms_keys || {},
    price_book: price_book || {},
    labour_pricing: labour_pricing || {},
    updated_at: new Date().toISOString(),
  };
  try {
    const existing = await _companySettingsRow(req);
    let data, error;
    if (existing && existing.user_id){
      // Update the company's row IN PLACE, keyed on the row's own owner —
      // never on the caller — so a teammate saving doesn't try to take the row
      // over and collide with their own legacy row's unique user_id.
      const patch = Object.assign({}, payload, { updated_by: req.user.id });
      if (req.companyId) patch.company_id = req.companyId;
      ({ data, error } = await supabase.from('user_settings').update(patch).eq('user_id', existing.user_id).select().single());
      if (error && /updated_by/.test(error.message || '')){
        delete patch.updated_by;
        ({ data, error } = await supabase.from('user_settings').update(patch).eq('user_id', existing.user_id).select().single());
      }
    } else {
      const row = Object.assign({ user_id: req.user.id, company_id: req.companyId || null }, payload);
      ({ data, error } = await supabase.from('user_settings').upsert(row, { onConflict: 'user_id' }).select().single());
      if (error && /company_id/.test(error.message || '')){
        delete row.company_id;
        ({ data, error } = await supabase.from('user_settings').upsert(row, { onConflict: 'user_id' }).select().single());
      }
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Hand out the next job number — ATOMICALLY. A shared counter isn't enough on
// its own: two people opening "New job" at the same moment both read 06121 and
// both use it. This bumps and returns in ONE locked statement, so the number
// each caller gets is theirs alone. Falls back to read-modify-write when
// there's no direct DB connection (still shared, just not race-proof).
app.post('/settings/next-job-no', requireAuth, async (req, res) => {
  const pool = _pgPool();
  if (pool && req.companyId){
    try {
      const sql =
        "WITH cur AS (" +
        "  SELECT user_id, coalesce(quote_defaults->>'next_job_no','06121') AS n" +
        "    FROM public.user_settings WHERE company_id = $1" +
        "   ORDER BY updated_at DESC NULLS LAST LIMIT 1 FOR UPDATE)" +
        " UPDATE public.user_settings s" +
        "    SET quote_defaults = jsonb_set(coalesce(s.quote_defaults,'{}'::jsonb), '{next_job_no}'," +
        "        to_jsonb(CASE WHEN cur.n ~ '^[0-9]+$'" +
        "                      THEN lpad(((cur.n)::bigint + 1)::text, length(cur.n), '0')" +
        "                      ELSE cur.n END))," +
        "        updated_at = now()" +
        "   FROM cur WHERE s.user_id = cur.user_id" +
        " RETURNING cur.n AS allocated, s.quote_defaults->>'next_job_no' AS next";
      const r = await pool.query(sql, [req.companyId]);
      if (r.rowCount) return res.json({ jobNo: r.rows[0].allocated, next: r.rows[0].next, atomic: true });
    } catch (e) { console.warn('[jobno] atomic allocation failed, falling back:', e.message); }
  }
  try {
    const row = await _companySettingsRow(req);
    const qd = (row && row.quote_defaults) || {};
    const cur = String(qd.next_job_no || '06121').trim() || '06121';
    let next = cur;
    if (/^[0-9]+$/.test(cur)){
      next = String(parseInt(cur, 10) + 1);
      while (next.length < cur.length) next = '0' + next;
    }
    if (row && row.user_id && next !== cur){
      const patch = { quote_defaults: Object.assign({}, qd, { next_job_no: next }), updated_at: new Date().toISOString() };
      await supabase.from('user_settings').update(patch).eq('user_id', row.user_id);
    }
    res.json({ jobNo: cur, next: next, atomic: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// PUBLIC CUSTOMER QUOTE VIEW — token-based, no auth.  Lets a customer
// open a shareable link, change the options/grades, and accept /
// decline / query the quote.  All writes go back onto the owning job so
// the office app sees the status + selections.  Uses the service-key
// Supabase client so it can read/write across users without a JWT.
// ══════════════════════════════════════════════════════════════════
function _quoteOf(job){
  if (!job) return null;
  if (job.quote !== undefined) return job.quote || null;                 // narrowed select
  return (((job.draw_state||{}).state)||{}).quote || null;               // full select
}
// token → job id cache: once ANY lookup resolves a share token, later opens
// use the primary-key fast path even when the link carries no &i= hint (old
// links) and no expression index exists — the slow token scan runs at most
// once per token per process lifetime.
const _tokenIdCache = new Map();
function _tokenCachePut(token, id){
  if (!token || !id) return;
  if (_tokenIdCache.size > 500) _tokenIdCache.delete(_tokenIdCache.keys().next().value);
  _tokenIdCache.set(token, id);
}
async function _findJobByToken(token, jobIdHint){
  if (!token) return null;
  if (!jobIdHint && _tokenIdCache.has(token)) jobIdHint = _tokenIdCache.get(token);
  // Select ONLY the quote subtree, not the whole draw_state — the customer view
  // needs just the quote, and NOT the job's photos / drawing aerial (state.photos
  // + state.img64), which are megabytes. Writes go back via _saveQuoteBack's
  // targeted jsonb update, so the full draw_state is never round-tripped.
  const cols = 'id, user_id, client_name, site_address, quote:draw_state->state->quote';
  // Fast path: the office link carries the job id (&i=), so we can fetch that
  // one row by primary key and just check the token matches — no full-table
  // scan that would decompress every job's photo-heavy draw_state. Falls back
  // to the token scan if the hint is missing or doesn't match (e.g. stale link).
  if (jobIdHint && /^[0-9a-fA-F-]{10,}$/.test(String(jobIdHint))) {
    const { data, error } = await supabase.from('jobs').select(cols).eq('id', jobIdHint).limit(1);
    if (!error && data && data[0]) {
      const q = _quoteOf(data[0]);
      if (q && q.share && q.share.token === token){ _tokenCachePut(token, data[0].id); return data[0]; }
    }
  }
  const { data, error } = await supabase.from('jobs')
    .select(cols)
    .eq('draw_state->state->quote->share->>token', token).limit(1);
  if (error) throw new Error(error.message);
  if (data && data[0]) _tokenCachePut(token, data[0].id);
  return (data && data[0]) || null;
}
async function _saveQuoteBack(job, quote){
  // Fast path: targeted jsonb merge so the multi-MB draw_state (photos + aerial)
  // is never round-tripped just to update the quote — this is what made customer
  // opens / accepts drag. Falls back to read-modify-write without a pg pool.
  const pool = _pgPool();
  if (pool) {
    try {
      const sql = "UPDATE public.jobs SET draw_state = " +
        "coalesce(draw_state,'{}'::jsonb) || jsonb_build_object('state', " +
        "coalesce(draw_state->'state','{}'::jsonb) || jsonb_build_object('quote', $1::jsonb)), " +
        "updated_at = now() WHERE id = $2";
      await pool.query(sql, [JSON.stringify(quote), job.id]);
      return;
    } catch (e) { console.error('_saveQuoteBack fast-update failed, falling back:', e.message); }
  }
  // Fallback (no pg pool): the token lookup now selects only the quote subtree,
  // so re-fetch the full draw_state before merging to avoid wiping it.
  let ds = job.draw_state;
  if (!ds) {
    const { data } = await supabase.from('jobs').select('draw_state').eq('id', job.id).single();
    ds = (data && data.draw_state) || {};
  }
  ds.state = ds.state || {};
  ds.state.quote = quote;
  await supabase.from('jobs').update({ draw_state: ds, updated_at: new Date().toISOString() }).eq('id', job.id);
}

// Customer opens the quote.  Rate-limited: the token is the only
// credential, so cap per-IP guessing speed.
app.get('/q/:token', rateLimit(60, 60000), async (req, res) => {
  try {
    const job = await _findJobByToken(req.params.token, req.query.job);
    const quote = _quoteOf(job);
    if (!job || !quote) return res.status(404).json({ error: 'Quote not found' });
    const { data: settings } = await supabase.from('user_settings').select('branding').eq('user_id', job.user_id).maybeSingle();
    const share = quote.share || {};
    if (!Array.isArray(share.events)) share.events = [];
    // Persisting the "opened" analytics rewrites the WHOLE draw_state (photos and
    // all) back to the DB, so only do it when something meaningful actually
    // changed — a status transition, or a fresh open outside the 2-min throttle.
    // Rapid reloads / link-verify hits then don't trigger a heavy write each time.
    let changed = false;
    if (!share.status || share.status === 'sent') { share.status = 'opened'; changed = true; }
    const last = share.events[share.events.length - 1];
    if (!last || last.type !== 'opened' || (Date.now() - new Date(last.at).getTime()) > 120000) {
      share.openCount = (share.openCount || 0) + 1;
      share.lastOpenedAt = new Date().toISOString();
      share.events.push({ type: 'opened', at: share.lastOpenedAt });
      if (share.events.length > 80) share.events = share.events.slice(-80);
      changed = true;
    }
    // Respond FIRST, persist the "opened" analytics in the background — the
    // customer's page load must never wait on the write (without a pg pool
    // the fallback save round-trips the whole multi-MB draw_state, which is
    // exactly what made the quote link feel slow to open).
    if (changed) { quote.share = share; _saveQuoteBack(job, quote).catch(e => console.error('open-analytics save failed:', e.message)); }
    res.json({ quote: quote, branding: (settings && settings.branding) || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Customer changes selections / accepts / declines / asks a question.
// Everything in the body is UNTRUSTED (anyone holding the link can call
// this): whitelist the event type, clamp every string, force numeric
// fields to numbers, and cap array sizes before it touches the job.
app.post('/q/:token/event', rateLimit(20, 60000), async (req, res) => {
  try {
    let { type, selections, name, message, total, acceptedOptions } = req.body || {};
    const ALLOWED_TYPES = ['accepted', 'declined', 'queried', 'opened', 'update'];
    if (type != null && ALLOWED_TYPES.indexOf(String(type)) < 0) {
      return res.status(400).json({ error: 'Unknown event type' });
    }
    name = String(name || '').slice(0, 120);
    total = Number(total);
    if (!isFinite(total) || total < 0 || total > 10000000) total = 0;
    if (!Array.isArray(acceptedOptions)) acceptedOptions = [];
    acceptedOptions = acceptedOptions.slice(0, 20).map(function (o) {
      o = o || {};
      return {
        title: String(o.title || '').slice(0, 200),
        grade: String(o.grade || '').slice(0, 200),
        total: isFinite(Number(o.total)) ? Number(o.total) : 0,
      };
    });
    const job = await _findJobByToken(req.params.token, req.query.job);
    const quote = _quoteOf(job);
    if (!job || !quote) return res.status(404).json({ error: 'Quote not found' });
    const share = quote.share || {};
    if (!Array.isArray(share.events)) share.events = [];
    const now = new Date().toISOString();
    // Apply customer selections (only the safe, customer-controlled fields).
    if (selections) {
      if (Array.isArray(selections.options)) {
        selections.options.slice(0, 20).forEach(function(sel){
          sel = sel || {};
          const o = (quote.options || []).find(function(x){ return x.id === sel.id; });
          if (o) { o.selected = sel.selected !== false; o.selectedUpgrade = String(sel.selectedUpgrade || '').slice(0, 80); }
        });
      }
      if (['none', 'box', 'marley'].indexOf(selections.gutterChoice) >= 0) quote.gutterChoice = selections.gutterChoice;
      // Spec choices from the proposal page (steel grade, profile, gauge,
      // guttering, brackets, downpipes, disposal) plus which optional extra
      // roofs the customer kept. Strictly allow-listed — the payload is
      // untrusted, and these values drive pricing and the material order.
      const po = selections.proposalOptions;
      if (po && typeof po === 'object' && !Array.isArray(po)) {
        const ALLOW = {
          profile:        ['corrugate', '5rib'],
          steelGrade:     ['maxam', 'colorzen', 'colourcote', 'zincalume'],
          steelThickness: ['40', '55'],
          gutterType:     ['none', 'box125', 'marley_classic', 'marley_typhoon'],
          gutterBracket:  ['internal', 'external'],
          downpipes:      ['yes', 'no'],
          disposal:       ['dispose', 'keep'],
        };
        if (!quote.proposalOptions || typeof quote.proposalOptions !== 'object') quote.proposalOptions = {};
        Object.keys(ALLOW).forEach(function (k) {
          const v = String(po[k] == null ? '' : po[k]);
          if (v && ALLOW[k].indexOf(v) >= 0) quote.proposalOptions[k] = v;
        });
        if (po.colour != null) {
          const c = String(po.colour).slice(0, 60);
          if (c) quote.proposalOptions.colour = c;
        }
        // Index-keyed booleans. Bounded by the extra roofs this quote actually
        // carries (older quotes that predate the stash fall back to a hard cap)
        // so a crafted payload can't grow the stored object. Only the ticked
        // ones are kept — every reader treats a missing key as "not included".
        if (po.extraRoofsSel && typeof po.extraRoofsSel === 'object' && !Array.isArray(po.extraRoofsSel)) {
          const nExtra = Array.isArray(quote.extraRoofs) ? quote.extraRoofs.length : 20;
          const sel = {};
          Object.keys(po.extraRoofsSel).slice(0, 40).forEach(function (k) {
            const i = Number(k);
            if (Number.isInteger(i) && i >= 0 && i < nExtra && po.extraRoofsSel[k]) sel[i] = true;
          });
          quote.proposalOptions.extraRoofsSel = sel;
        }
      }
    }
    if (type === 'accepted') {
      quote.accepted = { name: name || quote.client || 'Customer', at: now, total: total || 0, options: acceptedOptions || [], gutter: quote.gutterChoice || 'none' };
      share.status = 'accepted'; share.acceptedAt = now;
    } else if (type === 'declined') {
      share.status = 'declined'; share.declinedAt = now;
    } else if (type === 'queried') {
      share.status = 'queried'; share.query = { message: String(message || '').slice(0, 2000), at: now };
    } else if (type === 'opened') {
      if (!share.status || share.status === 'sent') share.status = 'opened';
    }
    share.events.push({ type: type || 'update', at: now, message: message ? String(message).slice(0, 2000) : undefined });
    if (share.events.length > 80) share.events = share.events.slice(-80);
    quote.share = share;
    await _saveQuoteBack(job, quote);
    res.json({ ok: true, status: share.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public, token-guarded: when a customer accepts their online quote the
// frontend calls this with the rendered proposal PDF. We email the office a
// one-off notification containing the accepted details AND the PDF that shows
// the customer's chosen options. The recipient is fixed to the office address
// (never taken from the request), so this can't be abused as an open relay.
const ACCEPT_NOTIFY_EMAIL = process.env.ACCEPT_NOTIFY_EMAIL || 'office@floodroofing.co.nz';
app.post('/q/:token/accept-email', rateLimit(10, 60000), async (req, res) => {
  try {
    if (!EMAIL_ENABLED) return res.status(503).json({ error: 'Email is not configured on the server yet.', code: 'EMAIL_NOT_CONFIGURED' });
    // Validate the request body before touching the database — cheap checks
    // first, and it means an oversized upload is rejected without a DB round-trip.
    let { pdfBase64, filename } = req.body || {};
    let attachment = null;
    if (pdfBase64 && typeof pdfBase64 === 'string') {
      if (pdfBase64.length > 20 * 1024 * 1024) return res.status(413).json({ error: 'Attachment too large' });
      attachment = { base64: pdfBase64, filename: filename || 'Accepted quote.pdf' };
    }
    const job = await _findJobByToken(req.params.token, req.query.job);
    const quote = _quoteOf(job);
    if (!job || !quote) return res.status(404).json({ error: 'Quote not found' });
    const acc = quote.accepted || {};
    const client = job.client_name || quote.client || acc.name || 'Customer';
    const addr = job.site_address || quote.addr || '';
    const ref = quote.ref || '';
    const lines = ['A customer has accepted their quote online.', ''];
    if (ref) lines.push('Quote reference: ' + ref);
    lines.push('Customer: ' + client);
    if (addr) lines.push('Address: ' + addr);
    if (acc.name && acc.name !== client) lines.push('Accepted by: ' + acc.name);
    if (acc.at) lines.push('Accepted: ' + acc.at);
    lines.push('', 'Accepted total (incl. GST): ' + _money(acc.total));
    if (Array.isArray(acc.options) && acc.options.length) {
      lines.push('', 'Selected options:');
      acc.options.forEach(function (o) {
        o = o || {};
        lines.push('  • ' + (o.title || 'Option') +
          (o.grade && o.grade !== 'Standard' ? ' — ' + o.grade : '') +
          '   ' + _money(o.total));
      });
    }
    lines.push('', attachment
      ? 'The accepted quote PDF (showing the customer\'s selections) is attached.'
      : '(The quote PDF could not be attached automatically — see the customer link in the app.)');
    const subject = 'Quote accepted' + (ref ? ' — ' + ref : '') + ' — ' + client;
    // Prefer the office's configured recipient(s) stashed on the quote
    // (Settings → Email), falling back to the server default.
    const acceptTo = (quote.acceptNotify && String(quote.acceptNotify).trim()) || ACCEPT_NOTIFY_EMAIL;
    await _dispatchMail({ to: acceptTo, subject, text: lines.join('\n'), attachment });
    res.json({ ok: true });
  } catch (e) {
    console.error('accept-email failed:', e.message);
    res.status(502).json({ error: 'Email send failed: ' + e.message });
  }
});

// Office home-screen feed: every job that has a shared quote, with its
// current status + last activity.
app.get('/quote-activity', requireAuth, async (req, res) => {
  try {
    // Build one feed row from a quote object (+ the job's top-level columns).
    const rowFrom = function(j, q){
      const sh = q && q.share;
      if (!sh || !sh.token) return null;
      const lastEv = (sh.events && sh.events.length) ? sh.events[sh.events.length - 1] : null;
      return {
        jobId: j.id,
        client: j.client_name || q.client || '—',
        ref: q.ref || '',
        status: sh.status || 'sent',
        token: sh.token,
        openCount: sh.openCount || 0,
        lastOpenedAt: sh.lastOpenedAt || null,
        query: sh.query || null,
        accepted: q.accepted || null,
        lastEventAt: lastEv ? lastEv.at : (sh.lastOpenedAt || null),
      };
    };
    // Primary: select ONLY the specific quote fields this feed needs — NOT the
    // whole quote subtree.  The quote now carries roofMapGeom.bg (a base64
    // aerial JPEG, ~1 MB each); pulling the full quote for 120 jobs ran to
    // hundreds of MB and timed the request out (recent activity stopped
    // loading).  These narrow JSON paths keep the payload at kilobytes.
    const primary = await _scopeCompany(supabase.from('jobs')
      .select('id, client_name, ' +
              'q_share:draw_state->state->quote->share, ' +
              'q_ref:draw_state->state->quote->ref, ' +
              'q_client:draw_state->state->quote->client, ' +
              'q_accepted:draw_state->state->quote->accepted'), req)
      // Only jobs that have actually been SHARED appear in the feed — filter to
      // them (there's a functional index on this token expression), so Postgres
      // doesn't have to decompress every job's multi-MB draw_state.
      .not('draw_state->state->quote->share->>token', 'is', null)
      .order('updated_at', { ascending: false }).limit(120);
    if (!primary.error) {
      const feed = (primary.data || []).map(function(j){
        return rowFrom({ id: j.id, client_name: j.client_name },
                       { share: j.q_share, ref: j.q_ref, client: j.q_client, accepted: j.q_accepted });
      }).filter(Boolean);
      return res.json(feed);
    }
    // Fallback: some environments choke on the deep JSON-path select. Pull the
    // whole quote subtree (the original, proven query shape) and strip the
    // heavy roofMapGeom before responding, so the client transfer stays small.
    console.error('quote-activity narrow select failed, falling back:', primary.error.message, primary.error.hint || '');
    const fb = await _scopeCompany(supabase.from('jobs')
      .select('id, client_name, quote:draw_state->state->quote'), req)
      .not('draw_state->state->quote->share->>token', 'is', null)
      .order('updated_at', { ascending: false }).limit(120);
    if (fb.error) { console.error('quote-activity fallback failed:', fb.error.message, fb.error.hint || ''); return res.status(500).json({ error: fb.error.message }); }
    const feed = (fb.data || []).map(function(j){ return rowFrom(j, j.quote || {}); }).filter(Boolean);
    res.json(feed);
  } catch (e) { console.error('quote-activity threw:', e && e.message); res.status(500).json({ error: e.message }); }
});

function httpsPost(host, path, headers, body) {
  return httpsRequest(host, path, 'POST', headers, body);
}

function httpsRequest(host, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const hasBody = body != null && method !== 'GET' && method !== 'HEAD';
    const data = hasBody ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (hasBody) h['Content-Length'] = Buffer.byteLength(data);
    const req = https.request({ hostname: host, path, method, headers: h }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    req.on('error', reject);
    if (hasBody) req.write(data);
    req.end();
  });
}

app.post('/claude/*', requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured' });
  const p = req.path.replace(/^\/claude/, '');
  try {
    const r = await httpsPost('api.anthropic.com', p, { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, req.body);
    res.status(r.status).json(JSON.parse(r.body));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Fergus proxy. Honors the caller's HTTP method (GET/POST/PUT/DELETE) and
// only sends a JSON body when the method allows one. Host + path prefix
// are env-configurable so they can be fixed without a code change.
const FERGUS_HOST   = process.env.FERGUS_HOST        || 'api.fergus.com';
const FERGUS_PREFIX = process.env.FERGUS_PATH_PREFIX || '';
app.all('/fergus/*', requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.FERGUS_API_KEY) return res.status(500).json({ error: 'Fergus not configured' });
  const tail = req.url.replace(/^\/fergus/, '');           // keep the querystring
  const upstreamPath = FERGUS_PREFIX + tail;
  try {
    const r = await httpsRequest(FERGUS_HOST, upstreamPath, req.method, {
      'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    }, req.body);
    res.status(r.status);
    if (!r.body)                       return res.json({});
    try { return res.json(JSON.parse(r.body)); }
    catch {
      // Fergus's edge can return HTML on auth/403; surface the raw text so
      // the caller can see what went wrong instead of a generic JSON-parse
      // crash on the proxy side.
      return res.type('text/plain').send(r.body.slice(0, 1000));
    }
  } catch (e) {
    res.status(502).json({ error: e.message, host: FERGUS_HOST, path: upstreamPath });
  }
});

// Fergus file uploads. The generic /fergus/* proxy above forwards JSON
// bodies only — but file attachments need multipart/form-data, so this
// route accepts the file as base64 JSON from the browser, decodes it,
// and re-encodes as multipart on the way out to Fergus.
//
// Fergus does not publish public docs for files, so when
// FERGUS_FILES_PATH is unset we try a list of candidate paths in order
// (project_gallery first, since the UI surfaces uploads under that
// section). A 2xx response is only treated as success when the body
// looks like a created file resource (id / uuid / attachment_id /
// data) — that avoids being fooled by GET-style list endpoints that
// happen to return 200 on POST. Every attempt is reported back so the
// caller can see exactly what Fergus said for each candidate.
//
// Once we know the right path, lock it in by setting FERGUS_FILES_PATH
// (and FERGUS_FILES_FIELD if the multipart field name differs).
const FERGUS_FILE_CANDIDATES = [
  '/jobs/{jobId}/project_gallery',
  '/jobs/{jobId}/photos',
  '/jobs/{jobId}/files',
  '/jobs/{jobId}/attachments',
  '/jobs/{jobId}/documents',
  '/jobs/{jobId}/gallery',
];

function _fergusLooksCreated(parsed) {
  if (!parsed) return false;
  if (parsed.id || parsed.uuid || parsed.file_id || parsed.attachment_id || parsed.gallery_id) return true;
  if (parsed.success === true) return true;
  if (parsed.data && (parsed.data.id || parsed.data.uuid)) return true;
  return false;
}

// The real Fergus upload endpoint (discovered from their OpenAPI spec):
//   POST /attachments  (multipart/form-data: file, entityType, entityId)
// It attaches the file to any entity in one atomic call. entityType is an
// enum whose exact casing we try a few ways ('JOB' / 'job' / 'Job') unless
// pinned via FERGUS_ATTACH_ENTITY_TYPE. This is why every earlier
// job-NESTED path 404'd — the endpoint is top-level, not under /jobs/{id}.
async function _fergusAttachmentAttempt(entityType, entityId, buf, contentType, filename, fileField) {
  const path = FERGUS_PREFIX + (process.env.FERGUS_FILES_PATH || '/attachments');
  const url  = `https://${FERGUS_HOST}${path}`;
  try {
    const form = new FormData();
    form.append(fileField, new Blob([buf], { type: contentType || 'application/pdf' }), filename);
    form.append('entityType', entityType);
    form.append('entityId', String(entityId));
    form.append('name', filename);
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY,
        'Accept':        'application/json',
      },
      body: form,
    });
    const text = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return {
      endpoint: path, entityType, url, status: r.status, ok: r.ok,
      looksCreated: r.ok && _fergusLooksCreated(parsed),
      body: parsed || text.slice(0, 600),
    };
  } catch (e) {
    return { endpoint: path, entityType, url, error: e.message };
  }
}

// Legacy job-nested fallback (kept only as a safety net — every path here
// 404s on the current Fergus API, but harmless to try if /attachments ever
// changes).
async function _fergusUploadAttempt(pathTpl, jobId, buf, contentType, filename, field) {
  const path = FERGUS_PREFIX + pathTpl.replace('{jobId}', encodeURIComponent(jobId));
  const url  = `https://${FERGUS_HOST}${path}`;
  try {
    const form = new FormData();
    form.append(field, new Blob([buf], { type: contentType || 'application/pdf' }), filename);
    form.append('name', filename);
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY,
        'Accept':        'application/json',
      },
      body: form,
    });
    const text = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    const looksCreated = r.ok && _fergusLooksCreated(parsed);
    return {
      path: pathTpl, url, status: r.status, ok: r.ok,
      looksCreated, body: parsed || text.slice(0, 600),
    };
  } catch (e) {
    return { path: pathTpl, url, error: e.message };
  }
}

app.post('/fergus-files/upload', requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.FERGUS_API_KEY) return res.status(500).json({ error: 'Fergus not configured' });
  const { jobId, filename, contentType, base64, fieldName } = req.body || {};
  if (!jobId)    return res.status(400).json({ error: 'jobId required' });
  if (!filename) return res.status(400).json({ error: 'filename required' });
  if (!base64)   return res.status(400).json({ error: 'base64 required' });

  let buf;
  try { buf = Buffer.from(base64, 'base64'); }
  catch (e) { return res.status(400).json({ error: 'Invalid base64' }); }
  if (buf.length === 0) return res.status(400).json({ error: 'Empty file' });
  if (buf.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'File too large (max 25MB)' });

  const field = fieldName || process.env.FERGUS_FILES_FIELD || 'file';
  const attempts = [];

  // Primary: POST /attachments with the job as the entity. Fergus's enum is
  // lowercase — confirmed live: "entityType must be one of: customer, job,
  // site, enquiry, works_order" (uppercase 'JOB' 400s, 'job' returns 201).
  // Pin 'job' so every upload succeeds on the first try; the env var can
  // override if a different entity type is ever targeted.
  const entityTypes = process.env.FERGUS_ATTACH_ENTITY_TYPE
    ? [process.env.FERGUS_ATTACH_ENTITY_TYPE]
    : ['job'];
  for (const et of entityTypes) {
    const a = await _fergusAttachmentAttempt(et, jobId, buf, contentType, filename, field);
    attempts.push(a);
    if (a.ok && a.looksCreated) {
      return res.json({ ok: true, used: '/attachments', entityType: et, status: a.status, fergus: a.body, url: a.url, attempts });
    }
  }

  // Fallback: the old job-nested candidates (all 404 today, but cheap).
  const candidates = process.env.FERGUS_FILES_PATH ? [] : FERGUS_FILE_CANDIDATES;
  for (const tpl of candidates) {
    const a = await _fergusUploadAttempt(tpl, jobId, buf, contentType, filename, field);
    attempts.push(a);
    if (a.looksCreated) {
      return res.json({ ok: true, used: tpl, status: a.status, fergus: a.body, url: a.url, attempts });
    }
  }

  res.status(502).json({
    ok: false,
    error: 'Fergus did not accept the upload as a created file',
    attempts,
    hint: 'The real endpoint is POST /attachments (multipart: file, entityType, entityId). If it rejected the entityType, set FERGUS_ATTACH_ENTITY_TYPE on Railway to the exact value Fergus expects (see the attempt bodies).',
  });
});

// Diagnostic — shows what each candidate path returns to a GET (without
// touching upload). Lets the user see which paths exist on their
// tenant before we POST the real PDF. The probe list is intentionally
// wider than the upload candidates (cheap GETs, lots of patterns) so
// we can quickly map the tenant's actual surface area.
const FERGUS_PROBE_CANDIDATES = [
  '/jobs/{jobId}',
  '/jobs/{jobId}/project_gallery',
  '/jobs/{jobId}/photos',
  '/jobs/{jobId}/files',
  '/jobs/{jobId}/documents',
  '/jobs/{jobId}/attachments',
  '/jobs/{jobId}/gallery',
  '/jobs/{jobId}/notes',
  '/jobs/{jobId}/site_visits',
  '/jobs/{jobId}/uploads',
  '/v2/jobs/{jobId}',
  '/v2/jobs/{jobId}/files',
  '/v2/jobs/{jobId}/photos',
  '/v2/jobs/{jobId}/attachments',
  '/job/{jobId}',
  '/job/{jobId}/files',
];

app.get('/fergus-files/probe', requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.FERGUS_API_KEY) return res.status(500).json({ error: 'Fergus not configured' });
  const jobId = req.query.jobId;
  if (!jobId) return res.status(400).json({ error: 'jobId query param required' });

  const results = [];
  for (const tpl of FERGUS_PROBE_CANDIDATES) {
    const path = FERGUS_PREFIX + tpl.replace('{jobId}', encodeURIComponent(jobId));
    const url  = `https://${FERGUS_HOST}${path}`;
    try {
      const r = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY,
          'Accept':        'application/json',
        },
      });
      const text = await r.text();
      let parsed = null; try { parsed = JSON.parse(text); } catch {}
      // Truncate body deeply so probe responses stay readable on a
      // phone screen — full data is in the per-path GET if needed.
      let bodyOut = parsed || text.slice(0, 200);
      if (parsed && typeof parsed === 'object') {
        bodyOut = Array.isArray(parsed)
          ? { '_type': 'array', length: parsed.length, first: parsed[0] }
          : { keys: Object.keys(parsed).slice(0, 20) };
      }
      results.push({ path: tpl, status: r.status, body: bodyOut });
    } catch (e) {
      results.push({ path: tpl, error: e.message });
    }
  }
  res.json({ jobId, results });
});

// Read Fergus's own OpenAPI spec and report every file/upload-capable
// operation — the authoritative answer to "can the API attach a PDF to a
// job at all?".  Fergus is a Fastify service (its 404s read
// "Route POST:/api/partner/... not found"), and its docs live at
// api.fergus.com/docs (OAS 3.1), so the machine-readable spec is almost
// certainly one of the candidates below.  We fetch it server-side (the
// browser can't read cross-origin), then surface (a) any path/operation
// mentioning file/upload/photo/attachment/document/gallery/media/note and
// (b) the full list of write operations, so nothing is missed.
const FERGUS_SPEC_CANDIDATES = [
  '/docs/json', '/docs/json/', '/openapi.json', '/documentation/json',
  '/docs-json', '/swagger/json', '/swagger.json', '/api/partner/docs/json',
  '/api/partner/openapi.json', '/api-docs/json', '/docs/yaml',
];
const FERGUS_FILE_WORDS = /file|upload|photo|attach|document|gallery|media|image|note|asset/i;

app.get('/fergus-files/spec', requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.FERGUS_API_KEY) return res.status(500).json({ error: 'Fergus not configured' });
  const headers = {
    'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY,
    'Accept':        'application/json',
  };
  const tried = [];
  let spec = null, specUrl = null;
  for (const path of FERGUS_SPEC_CANDIDATES) {
    try {
      const r = await httpsRequest(FERGUS_HOST, path, 'GET', headers);
      let parsed = null;
      try { parsed = JSON.parse(r.body); } catch {}
      const looksSpec = parsed && (parsed.openapi || parsed.swagger) && parsed.paths;
      tried.push({ path, status: r.status, looksSpec: !!looksSpec, len: (r.body || '').length });
      if (looksSpec) { spec = parsed; specUrl = `https://${FERGUS_HOST}${path}`; break; }
    } catch (e) {
      tried.push({ path, error: e.message });
    }
  }

  if (!spec) {
    return res.status(502).json({
      ok: false,
      error: 'Could not locate the Fergus OpenAPI spec at any known path',
      tried,
      note: 'If the docs render at a different URL, tell us and we will add it.',
    });
  }

  // Shallow $ref resolver + property lister so the spec output names the
  // exact multipart fields and any enum values (e.g. the entityType casing).
  const resolveRef = (ref) => {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
    return ref.slice(2).split('/').reduce((o, k) => (o ? o[k] : null), spec);
  };
  const describeSchema = (schema) => {
    if (!schema) return null;
    if (schema.$ref) schema = resolveRef(schema.$ref) || {};
    const props = schema.properties || {};
    const out = {};
    for (const [name, def0] of Object.entries(props)) {
      const def = def0 && def0.$ref ? (resolveRef(def0.$ref) || def0) : (def0 || {});
      out[name] = { type: def.type, format: def.format, enum: def.enum, required: (schema.required || []).includes(name) };
    }
    return { properties: out, required: schema.required || [] };
  };

  const fileOps = [];
  const writeOps = [];
  for (const [p, methods] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(methods || {})) {
      const m = String(method).toUpperCase();
      if (!['GET','POST','PUT','PATCH','DELETE'].includes(m)) continue;
      const summary = (op && (op.summary || op.operationId || op.description) || '').toString();
      const hay = p + ' ' + summary;
      const consumesMultipart = op && op.requestBody && op.requestBody.content &&
        Object.keys(op.requestBody.content).some(ct => /multipart|octet-stream/i.test(ct));
      if (FERGUS_FILE_WORDS.test(hay) || consumesMultipart) {
        const entry = { method: m, path: p, summary: summary.slice(0, 400), multipart: !!consumesMultipart };
        // Include the full request-body field list for write ops so we see
        // the exact multipart fields + entityType enum without another round.
        if (['POST','PUT','PATCH'].includes(m) && op.requestBody && op.requestBody.content) {
          entry.requestFields = {};
          for (const [ct, media] of Object.entries(op.requestBody.content)) {
            entry.requestFields[ct] = describeSchema(media && media.schema);
          }
        }
        fileOps.push(entry);
      }
      if (['POST','PUT','PATCH'].includes(m)) writeOps.push(m + ' ' + p);
    }
  }

  res.json({
    ok: true,
    specUrl,
    title: (spec.info && spec.info.title) || null,
    version: (spec.info && spec.info.version) || null,
    totalPaths: Object.keys(spec.paths || {}).length,
    fileCapableOps: fileOps,
    fileCapableCount: fileOps.length,
    allWriteOps: writeOps.sort(),
    tried,
  });
});

// List the files / photos attached to a Fergus job so the frontend can
// show them in a picker.  Walks the same candidate paths the upload
// route knows about, accepts the first GET that returns an array (or a
// payload containing one), normalises it into a uniform shape, and
// passes the picked path back so subsequent /fergus-files/download
// calls don't have to re-discover it.
// Walk a wide net of candidate paths. Fergus does not publish a stable
// public files API and the right surface varies per tenant. We include
// v2 variants and the "job_files" path that Fergus's own UI labels
// "Files & Photos".  Order matters — we accept the FIRST array-shaped
// response that has at least one item.
const FERGUS_LIST_CANDIDATES = [
  '/jobs/{jobId}/project_gallery',
  '/jobs/{jobId}/photos',
  '/jobs/{jobId}/files',
  '/jobs/{jobId}/attachments',
  '/jobs/{jobId}/gallery',
  '/jobs/{jobId}/documents',
  '/jobs/{jobId}/job_files',
  '/jobs/{jobId}/job_photos',
  '/jobs/{jobId}/uploads',
  // The docs call this "API v1" — try an explicit /v1 prefix on the
  // file sub-resources even though bare /jobs/{id} works without one.
  '/v1/jobs/{jobId}/files',
  '/v1/jobs/{jobId}/photos',
  '/v1/jobs/{jobId}/attachments',
  '/v1/jobs/{jobId}/documents',
  '/v1/jobs/{jobId}/gallery',
  // Top-level file resources filtered by job id (query-param style) —
  // common in OAS-3 REST designs where files are a first-class resource.
  '/files?job_id={jobId}',
  '/files?jobId={jobId}',
  '/photos?job_id={jobId}',
  '/documents?job_id={jobId}',
  '/job_files?job_id={jobId}',
  '/v1/files?job_id={jobId}',
  // The /attachments resource requires camelCase entityType + entityId
  // (its 400 validation message named them). Job-card Files & Photos are
  // attachments on the Job entity; try the likely entityType casings.
  '/attachments?entityType=Job&entityId={jobId}',
  '/attachments?entityType=job&entityId={jobId}',
  '/v2/jobs/{jobId}/files',
  '/v2/jobs/{jobId}/photos',
  '/v2/jobs/{jobId}/attachments',
  '/v2/jobs/{jobId}/gallery',
  '/v2/jobs/{jobId}/job_files',
  '/job/{jobId}/files',
  '/job/{jobId}/photos',
];

// ── Fergus response caches (in-memory, best-effort) ────────────────
// The file endpoints re-fetch from Fergus every call, and the list
// endpoint blindly walks ~25 candidate paths until one works.  Once a
// path is discovered it's the SAME for every job on the tenant, so
// remember it and try it first; and cache each job's file list for a
// short window so re-opening the Map Roof tab (or the picker) is instant
// instead of another 25-call walk.  All best-effort: a miss just re-fetches.
let _fergusListPath = process.env.FERGUS_FILES_PATH || null;
const _fergusListCache = new Map();          // jobId -> { payload, ts }
const FERGUS_LIST_TTL  = 90 * 1000;
function _fergusListCacheGet(jobId) {
  const hit = _fergusListCache.get(String(jobId));
  if (hit && (Date.now() - hit.ts) < FERGUS_LIST_TTL) return hit.payload;
  if (hit) _fergusListCache.delete(String(jobId));
  return null;
}
function _fergusListCacheSet(jobId, payload) {
  // Only cache real hits (files present), and keep the map bounded.
  if (!payload || !payload.ok || !(payload.files || []).length) return;
  if (_fergusListCache.size > 200) _fergusListCache.clear();
  _fergusListCache.set(String(jobId), { payload, ts: Date.now() });
}

// Build a compact shape summary for a probed response. For error
// responses (4xx/5xx) it captures the `message`/`error` text so the
// picker can show WHY a request failed — e.g. a 400 that names the
// required query parameter — instead of just the key names.
function _fergusShapeSummary(parsed, text) {
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed)) {
      return { type: 'array', length: parsed.length, firstKeys: parsed[0] && typeof parsed[0] === 'object' ? Object.keys(parsed[0]).slice(0, 12) : null };
    }
    const s = { type: 'object', keys: Object.keys(parsed).slice(0, 15) };
    const msg = parsed.message || parsed.error || parsed.detail || parsed.title;
    if (msg && typeof msg === 'string') s.msg = msg.slice(0, 160);
    return s;
  }
  return { type: typeof parsed, sample: String(text).slice(0, 140) };
}
function _normaliseFergusFile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Cover the half-dozen field names Fergus uses across endpoints —
  // the picker needs at minimum an id, a display name, a content-type
  // hint and either a URL or a download path.
  const id   = raw.id || raw.uuid || raw.file_id || raw.fileId || raw.attachment_id || raw.attachmentId || raw.gallery_id || null;
  const name = raw.name || raw.filename || raw.fileName || raw.title || raw.original_name || raw.originalName || raw.file_name || raw.display_name || raw.displayName || ('file-' + (id || ''));
  // Fergus attachments carry no direct URL — the download reference is a
  // relative API path in a HATEOAS links[] array (rel:"download").
  let linkHref = null;
  if (Array.isArray(raw.links)) {
    const dl = raw.links.find(l => l && (l.rel === 'download' || /\/download(\?|$)/i.test(l.href || '')));
    if (dl) linkHref = dl.href;
  }
  const url  = raw.url || raw.public_url || raw.publicUrl || raw.download_url || raw.downloadUrl || raw.path || raw.file_url || raw.fileUrl || raw.original_url || raw.originalUrl || raw.signed_url || raw.signedUrl || raw.s3_url || raw.cdn_url || raw.cdnUrl || linkHref || null;
  const thumb= raw.thumbnail || raw.thumb_url || raw.thumbUrl || raw.preview_url || raw.previewUrl || raw.thumbnail_url || raw.thumbnailUrl || raw.thumb || null;
  const mime = raw.mime_type || raw.mimeType || raw.content_type || raw.contentType || raw.type || raw.file_type || raw.fileType || '';
  return { id, name, url, thumbnail: thumb || url, contentType: mime };
}

// Peel the file/photo array out of whatever shape Fergus wrapped it in.
function _extractFileArray(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.data)) return parsed.data;
  if (Array.isArray(parsed.files)) return parsed.files;
  if (Array.isArray(parsed.photos)) return parsed.photos;
  if (Array.isArray(parsed.attachments)) return parsed.attachments;
  if (Array.isArray(parsed.items)) return parsed.items;
  if (Array.isArray(parsed.records)) return parsed.records;
  if (parsed.value && Array.isArray(parsed.value.data)) return parsed.value.data;
  if (parsed.result && Array.isArray(parsed.result)) return parsed.result;
  if (parsed.result && Array.isArray(parsed.result.files)) return parsed.result.files;
  if (parsed.data && typeof parsed.data === 'object') {
    if (Array.isArray(parsed.data.attachments)) return parsed.data.attachments;
    if (Array.isArray(parsed.data.files)) return parsed.data.files;
    if (Array.isArray(parsed.data.photos)) return parsed.data.photos;
    if (Array.isArray(parsed.data.items)) return parsed.data.items;
  }
  return null;
}
// Read a "next page" cursor out of a Fergus list response (same field names
// the job-list pagination uses).
function _readListCursor(data) {
  if (!data || typeof data !== 'object') return null;
  return data.nextCursor || data.next_cursor || data.cursor ||
    (data.pagination && (data.pagination.nextCursor || data.pagination.next_cursor || data.pagination.cursor)) ||
    (data.meta && (data.meta.nextCursor || data.meta.next_cursor || data.meta.cursor)) || null;
}
// A stable key for de-duping files across pages.
function _fileDedupKey(it) {
  if (!it || typeof it !== 'object') return String(it);
  return String(it.id || it.uuid || it.file_id || it.fileId || it.attachment_id || it.attachmentId || it.gallery_id ||
    ((it.name || it.filename || '') + '|' + (it.url || it.download_url || it.downloadUrl || '')) ||
    JSON.stringify(it).slice(0, 140));
}

app.get('/fergus-files/list', requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.FERGUS_API_KEY) return res.status(500).json({ error: 'Fergus not configured' });
  const jobId = req.query.jobId;
  if (!jobId) return res.status(400).json({ error: 'jobId query param required' });

  // Fast path: recently-fetched list for this job (unless ?fresh=1).
  if (!req.query.fresh) {
    const cached = _fergusListCacheGet(jobId);
    if (cached) return res.json(Object.assign({}, cached, { cached: true }));
  }

  // Try the last path that worked first (env-pinned, or discovered at
  // runtime — it's the same for every job on the tenant), then the rest.
  const seen = new Set();
  const candidates = [_fergusListPath, ...FERGUS_LIST_CANDIDATES]
    .filter(p => p && !seen.has(p) && seen.add(p));

  const attempts = [];
  for (const tpl of candidates) {
    const path = FERGUS_PREFIX + tpl.replace('{jobId}', encodeURIComponent(jobId));
    const url  = `https://${FERGUS_HOST}${path}`;
    try {
      const fHeaders = { 'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY, 'Accept': 'application/json' };
      // Ask for a big page up-front (Fergus caps pageSize at 100) so a
      // single-page endpoint returns EVERY file instead of its ~10-item
      // default. If pageSize is rejected, fall back to the bare path.
      const sep0 = url.indexOf('?') >= 0 ? '&' : '?';
      let r = await fetch(url + sep0 + 'pageSize=100', { method: 'GET', headers: fHeaders });
      if (!r.ok && (r.status === 400 || r.status === 422)) {
        r = await fetch(url, { method: 'GET', headers: fHeaders });
      }
      const text = await r.text();
      let parsed = null; try { parsed = JSON.parse(text); } catch {}
      // Always stash a short shape summary so the picker can show the
      // user exactly why no files came back — keys present, array
      // length, status code.
      const summary = _fergusShapeSummary(parsed, text);
      attempts.push({ path: tpl, status: r.status, ok: r.ok, summary });
      if (!r.ok || !parsed) continue;
      let arr = _extractFileArray(parsed);
      if (!arr) continue;
      // Follow pagination — a job with more files than one page (Fergus
      // paginates the file list, default ~10) would otherwise drop the
      // rest. Walk pageCursor, de-duping, until it runs out.
      let cursor = _readListCursor(parsed);
      if (cursor) {
        const seen = new Set(); arr.forEach(function(it){ seen.add(_fileDedupKey(it)); });
        let prev = null, pages = 1;
        while (cursor && cursor !== prev && pages < 12) {
          const sepN = url.indexOf('?') >= 0 ? '&' : '?';
          const pageUrl = url + sepN + 'pageCursor=' + encodeURIComponent(cursor) + '&pageSize=100';
          let pr; try { pr = await fetch(pageUrl, { method: 'GET', headers: fHeaders }); } catch (e) { break; }
          if (!pr.ok) break;
          let pparsed = null; try { pparsed = JSON.parse(await pr.text()); } catch {}
          const parr = _extractFileArray(pparsed);
          if (!parr || !parr.length) break;
          let added = 0;
          parr.forEach(function(it){ const k = _fileDedupKey(it); if (!seen.has(k)) { seen.add(k); arr.push(it); added++; } });
          prev = cursor; cursor = _readListCursor(pparsed); pages++;
          if (!added) break;   // endpoint ignored the cursor — stop before looping
        }
      }
      const files = arr.map(_normaliseFergusFile).filter(Boolean);
      if (!files.length) continue;
      // Remember the winning path (skips the walk next time) and cache
      // the list for this job.
      _fergusListPath = tpl;
      const payload = { ok: true, used: tpl, count: files.length, files, attempts, sample: arr[0] };
      _fergusListCacheSet(jobId, payload);
      // Include the raw first item so the client can show the exact
      // attachment shape when a download field is missing/indirect.
      return res.json(payload);
    } catch (e) {
      attempts.push({ path: tpl, error: e.message });
    }
  }
  // Fallback strategy — when every sibling path 404s but /jobs/{id}
  // returns 200, two scenarios are still in play:
  //   A) the tenant exposes attachments INSIDE the job blob (walk for
  //      a nested file-shaped array); or
  //   B) the tenant routes file endpoints under a DIFFERENT id field
  //      than the api id we got from the job-search response — common
  //      on Fergus tenants where the web app's URL uses
  //      /jobs/view/<short_id>/project_gallery while the api id is a
  //      9-digit number. Extract every plausible id from the blob and
  //      retry the candidate paths with each.
  try {
    const jobPath = FERGUS_PREFIX + '/jobs/' + encodeURIComponent(jobId);
    const jobUrl  = `https://${FERGUS_HOST}${jobPath}`;
    const r = await fetch(jobUrl, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY,
        'Accept':        'application/json',
      },
    });
    const text = await r.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch {}
    if (parsed && r.ok) {
      // Unwrap nested envelopes — Fergus returns {result, data}, but
      // either field can carry the actual job depending on tenant.
      let job = parsed;
      const envs = [];
      for (let depth = 0; depth < 4; depth++) {
        if (!job || typeof job !== 'object' || Array.isArray(job)) break;
        if (job.data && typeof job.data === 'object')       { envs.push('data');   job = job.data; continue; }
        if (job.result && typeof job.result === 'object')   { envs.push('result'); job = job.result; continue; }
        if (job.value && typeof job.value === 'object')     { envs.push('value');  job = job.value; continue; }
        break;
      }
      // (B) Retry the candidate paths with every alternative id we
      // can find in the job blob. The Fergus web app uses
      //   /jobs/view/<internal_id>/project_gallery
      // for the gallery URL — that internal id is NOT the api id we
      // already tried, so a fresh round of GETs with each plausible
      // id often surfaces a real file array on tenants where the
      // sibling endpoints expect the internal/route flavour.
      const ID_HINT_KEYS = [
        'internal_job_id','internal_id','route_id','web_id','display_id',
        'job_no','job_number','jobNo','number','external_id',
        'short_id','public_id','customer_id'
      ];
      const altIds = new Set();
      function collectIds(node, depth){
        if (depth > 3 || !node || typeof node !== 'object') return;
        if (Array.isArray(node)){ node.slice(0, 30).forEach(v => collectIds(v, depth + 1)); return; }
        for (const k of Object.keys(node)){
          const lower = k.toLowerCase();
          if (ID_HINT_KEYS.some(h => h === lower) && (typeof node[k] === 'string' || typeof node[k] === 'number')){
            const v = String(node[k]).trim();
            if (v && v !== String(jobId)) altIds.add(v);
          }
          if (typeof node[k] === 'object') collectIds(node[k], depth + 1);
        }
      }
      collectIds(job, 0);
      const altIdsArr = Array.from(altIds);
      if (altIdsArr.length){
        for (const altId of altIdsArr){
          for (const tpl of candidates){
            const path = FERGUS_PREFIX + tpl.replace('{jobId}', encodeURIComponent(altId));
            const url  = `https://${FERGUS_HOST}${path}`;
            try {
              const ar = await fetch(url, {
                method: 'GET',
                headers: {
                  'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY,
                  'Accept':        'application/json',
                },
              });
              const atext = await ar.text();
              let aparsed = null; try { aparsed = JSON.parse(atext); } catch {}
              const asummary = aparsed && typeof aparsed === 'object'
                ? (Array.isArray(aparsed)
                    ? { type:'array', length: aparsed.length, firstKeys: aparsed[0] && typeof aparsed[0]==='object' ? Object.keys(aparsed[0]).slice(0,12) : null }
                    : { type:'object', keys: Object.keys(aparsed).slice(0,15) })
                : { type: typeof aparsed, sample: String(atext).slice(0,120) };
              attempts.push({ path: tpl + ' [altId=' + altId + ']', status: ar.status, ok: ar.ok, summary: asummary });
              if (!ar.ok || !aparsed) continue;
              let arr2 = null;
              if (Array.isArray(aparsed)) arr2 = aparsed;
              else if (Array.isArray(aparsed.data)) arr2 = aparsed.data;
              else if (Array.isArray(aparsed.files)) arr2 = aparsed.files;
              else if (Array.isArray(aparsed.photos)) arr2 = aparsed.photos;
              else if (Array.isArray(aparsed.attachments)) arr2 = aparsed.attachments;
              else if (Array.isArray(aparsed.items)) arr2 = aparsed.items;
              else if (Array.isArray(aparsed.records)) arr2 = aparsed.records;
              else if (aparsed.value && Array.isArray(aparsed.value.data)) arr2 = aparsed.value.data;
              else if (aparsed.result && Array.isArray(aparsed.result)) arr2 = aparsed.result;
              else if (aparsed.result && Array.isArray(aparsed.result.files)) arr2 = aparsed.result.files;
              else if (aparsed.result && Array.isArray(aparsed.result.data)) arr2 = aparsed.result.data;
              if (!arr2) continue;
              const files = arr2.map(_normaliseFergusFile).filter(Boolean);
              if (!files.length) continue;
              const payload = { ok: true, used: tpl + ' (altId ' + altId + ')', count: files.length, files, attempts };
              _fergusListCacheSet(jobId, payload);
              return res.json(payload);
            } catch (e) {
              attempts.push({ path: tpl + ' [altId=' + altId + ']', error: e.message });
            }
          }
        }
      }

      // Recursive search — walk up to 4 levels deep looking for an
      // array of objects whose first item has file-like fields.
      const FILE_HINT_KEYS = ['url','public_url','download_url','file_url','signed_url','s3_url','original_url','path','name','filename','file_name','original_name','mime_type','content_type','thumbnail','thumb_url'];
      function looksLikeFile(o){
        if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
        const keys = Object.keys(o);
        return FILE_HINT_KEYS.some(k => keys.includes(k));
      }
      const found = [];   // { path, items }
      function walk(node, path, depth){
        if (depth > 4 || !node || typeof node !== 'object') return;
        if (Array.isArray(node)){
          if (node.length && looksLikeFile(node[0])){ found.push({ path, items: node }); return; }
          // Don't descend into giant arrays of non-files (line items,
          // notes, etc.) — they balloon the search space.
          if (node.length <= 30) node.forEach((v, i) => walk(v, path + '[' + i + ']', depth + 1));
          return;
        }
        // Prefer obvious file-bucket keys first so the right array
        // wins even when sibling arrays exist.
        const HINT_KEY_ORDER = ['attachments','files','photos','documents','gallery','project_gallery','job_files','job_photos','uploads','images','media'];
        const keys = Object.keys(node).sort((a,b) => {
          const ai = HINT_KEY_ORDER.indexOf(a.toLowerCase());
          const bi = HINT_KEY_ORDER.indexOf(b.toLowerCase());
          if (ai >= 0 && bi < 0) return -1;
          if (bi >= 0 && ai < 0) return  1;
          if (ai >= 0 && bi >= 0) return ai - bi;
          return 0;
        });
        for (const k of keys){
          walk(node[k], path ? path + '.' + k : k, depth + 1);
          if (found.length) return;   // first match wins
        }
      }
      walk(job, '', 0);
      const summary = {
        type: 'object',
        envelopes: envs,
        topKeys: (typeof job === 'object' && job) ? Object.keys(job).slice(0, 40) : null,
        altIdsFound: altIdsArr,
        scannedFor: 'embedded file array + alternative job ids',
        matchedPath: found[0] ? found[0].path : null,
        matchedLength: found[0] ? found[0].items.length : 0,
      };
      attempts.push({ path: 'job-blob-scan', status: r.status, ok: r.ok, summary });

      // (C) Last-ditch sub-resource scan. The job blob's `links`
      // section + nested resources expose related entities:
      // customer, site, active quote, phases. Some Fergus tenants
      // surface attachments at /customers/{id}/files, /sites/{id}/
      // photos, /jobs/{id}/quotes/{qid}/files etc.  Try a curated
      // set of these against the ids we just collected.
      const subResources = [];
      if (job && job.customer && job.customer.id) {
        const cid = String(job.customer.id);
        subResources.push({ kind:'customer', id:cid, paths:[
          '/customers/{id}/files', '/customers/{id}/photos',
          '/customers/{id}/attachments', '/customers/{id}/documents',
        ] });
      }
      if (job && job.siteAddress && job.siteAddress.id) {
        const sid = String(job.siteAddress.id);
        subResources.push({ kind:'site', id:sid, paths:[
          '/sites/{id}/files', '/sites/{id}/photos',
          '/sites/{id}/attachments', '/sites/{id}/gallery',
        ] });
      }
      if (job && job.activeQuote && job.activeQuote.id) {
        const qid = String(job.activeQuote.id);
        subResources.push({ kind:'quote', id:qid, paths:[
          '/jobs/' + jobId + '/quotes/{id}/files',
          '/jobs/' + jobId + '/quotes/{id}/photos',
          '/jobs/' + jobId + '/quotes/{id}/attachments',
          '/quotes/{id}/files', '/quotes/{id}/photos',
        ] });
      }
      // Phases is a list — try the bare endpoint just in case it
      // returns something useful (some tenants stash uploads under
      // phase items).
      subResources.push({ kind:'phases', id:jobId, paths:[
        '/jobs/{id}/phases'
      ] });
      for (const sub of subResources) {
        for (const tpl of sub.paths) {
          const path = FERGUS_PREFIX + tpl.replace('{id}', encodeURIComponent(sub.id));
          const url  = `https://${FERGUS_HOST}${path}`;
          try {
            const sr = await fetch(url, {
              method: 'GET',
              headers: {
                'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY,
                'Accept':        'application/json',
              },
            });
            const stext = await sr.text();
            let sparsed = null; try { sparsed = JSON.parse(stext); } catch {}
            const ssummary = sparsed && typeof sparsed === 'object'
              ? (Array.isArray(sparsed)
                  ? { type:'array', length: sparsed.length, firstKeys: sparsed[0] && typeof sparsed[0]==='object' ? Object.keys(sparsed[0]).slice(0,12) : null }
                  : { type:'object', keys: Object.keys(sparsed).slice(0,15) })
              : { type: typeof sparsed, sample: String(stext).slice(0,120) };
            attempts.push({ path: tpl + ' [' + sub.kind + '=' + sub.id + ']', status: sr.status, ok: sr.ok, summary: ssummary });
            if (!sr.ok || !sparsed) continue;
            // Walk the sub-resource response for a file-shaped array.
            const subFound = [];
            (function subWalk(node, path, depth){
              if (depth > 3 || !node || typeof node !== 'object') return;
              if (Array.isArray(node)){
                if (node.length && looksLikeFile(node[0])){ subFound.push({ path, items: node }); return; }
                if (node.length <= 30) node.forEach((v, i) => subWalk(v, path + '[' + i + ']', depth + 1));
                return;
              }
              for (const k of Object.keys(node)){
                subWalk(node[k], path ? path + '.' + k : k, depth + 1);
                if (subFound.length) return;
              }
            })(sparsed.data || sparsed.result || sparsed, '', 0);
            if (subFound.length){
              const files = subFound[0].items.map(_normaliseFergusFile).filter(Boolean);
              if (files.length){
                const payload = { ok: true, used: tpl + ' (' + sub.kind + ' ' + sub.id + ')', count: files.length, files, attempts };
                _fergusListCacheSet(jobId, payload);
                return res.json(payload);
              }
            }
          } catch (e) {
            attempts.push({ path: tpl + ' [' + sub.kind + '=' + sub.id + ']', error: e.message });
          }
        }
      }
      if (found.length){
        const files = found[0].items.map(_normaliseFergusFile).filter(Boolean);
        if (files.length){
          return res.json({ ok: true, used: 'job-blob:' + found[0].path, count: files.length, files, attempts });
        }
      }
    } else {
      attempts.push({ path: 'job-blob-scan', status: r.status, ok: r.ok, summary: { type: typeof parsed, sample: String(text).slice(0,120) } });
    }
  } catch (e) {
    attempts.push({ path: 'job-blob-scan', error: e.message });
  }
  res.json({ ok: false, files: [], attempts, hint: 'No candidate path or job-blob scan returned a file array. Each attempt above shows the response status + body shape so we can pick the right one.' });
});

// Stream a single Fergus file back to the browser. The caller supplies
// the URL (from /fergus-files/list); we re-fetch with the API key so
// the bytes never expose the credential to the client. Used by the
// "Select photo from Fergus" flow to grab the picked image and pipe
// it into the roof-picture preview.
app.get('/fergus-files/download', requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.FERGUS_API_KEY) return res.status(500).json({ error: 'Fergus not configured' });
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url query param required' });

  const allowedHostSuffix = (FERGUS_HOST.replace(/^api\./, '')) || 'fergus.com';
  let fetchUrl, sendAuth = true;
  if (/^https?:\/\//i.test(url)) {
    // Absolute URL — SSRF guard: host must be a Fergus (sub)domain.
    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'invalid url' }); }
    if (!parsed.host.endsWith(allowedHostSuffix)) {
      return res.status(403).json({ error: 'host not allowed', host: parsed.host, allowedSuffix: allowedHostSuffix });
    }
    fetchUrl = url;
  } else if (url.charAt(0) === '/') {
    // Relative Fergus API path (e.g. /attachments/{id}/download from an
    // attachment's HATEOAS links) — resolve against the API host+prefix.
    fetchUrl = `https://${FERGUS_HOST}${FERGUS_PREFIX}${url}`;
  } else {
    return res.status(400).json({ error: 'invalid url' });
  }

  try {
    let r = await fetch(fetchUrl, {
      method: 'GET',
      headers: sendAuth ? { 'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY } : {},
    });
    // The download endpoint may hand back JSON describing a presigned
    // storage URL rather than the bytes themselves — follow it once,
    // WITHOUT the API key (presigned URLs carry their own auth).
    const ct0 = (r.headers.get('content-type') || '').toLowerCase();
    if (r.ok && ct0.indexOf('application/json') === 0) {
      const meta = await r.json().catch(() => null);
      const signed = meta && (meta.url || meta.downloadUrl || meta.signedUrl || meta.signed_url || meta.href ||
        (meta.data && (meta.data.url || meta.data.downloadUrl || meta.data.signedUrl)));
      if (signed && /^https?:\/\//i.test(signed)) {
        r = await fetch(signed, { method: 'GET' });
      } else {
        return res.status(502).json({ error: 'no downloadable url in response', keys: meta ? Object.keys(meta) : null });
      }
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'fergus returned ' + r.status, body: text.slice(0, 400) });
    }
    res.set('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    const cd = r.headers.get('content-disposition');
    if (cd) res.set('Content-Disposition', cd);
    // The bytes for a given Fergus file URL don't change — let the browser
    // keep them so re-viewing a photo (grid → lightbox, tab revisit) is
    // instant instead of another round-trip through the proxy.
    res.set('Cache-Control', 'private, max-age=86400');
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/jms/debug', requireAuth, (req, res) => {
  const k = process.env.FERGUS_API_KEY || '';
  // No key material in the response (length/tail were dropped) — the
  // setup UI only needs to know whether a key is present + looks right.
  res.json({
    fergus: {
      key_set: !!k,
      key_format_ok: k.startsWith('fergPAT_'),
      host: FERGUS_HOST,
      path_prefix: FERGUS_PREFIX,
      computed_test_url: `https://${FERGUS_HOST}${FERGUS_PREFIX}/jobs?page=1&per_page=1`,
    },
    backend_uptime_seconds: Math.round(process.uptime()),
    billing_enabled: BILLING_ENABLED,
    subscription_gate: BILLING_ENABLED ? 'enforced' : 'bypassed (billing not configured)',
  });
});

// Probe every endpoint we can think of for the Sales Account Codes list.
// Returns a one-row-per-URL summary so we can see which path actually
// responds with the user's chart of accounts.
app.get('/jms/debug/fergus-sales-accounts', requireAuth, async (req, res) => {
  if (!process.env.FERGUS_API_KEY) return res.status(500).json({ error: 'FERGUS_API_KEY not set' });
  const candidates = [
    '/sales-account-codes',
    '/salesAccountCodes',
    '/sales-accounts',
    '/salesAccounts',
    '/account-codes',
    '/accountCodes',
    '/accounts',
    '/chart-of-accounts',
    '/settings/sales-account-codes',
    '/company/sales-account-codes',
  ];
  const headers = { 'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY, 'Accept': 'application/json' };
  const out = await Promise.all(candidates.map(async (p) => {
    const upstream = FERGUS_PREFIX + p;
    try {
      const r = await httpsRequest(FERGUS_HOST, upstream, 'GET', headers);
      let summary = '';
      try {
        const j = JSON.parse(r.body || '{}');
        const payload = j.value || j.data || j.salesAccountCodes || j.salesAccounts || j.accounts || j;
        if (Array.isArray(payload)) {
          const names = payload.slice(0, 5).map(x => (x.title || x.name || '?')).join(' | ');
          const ids = payload.slice(0, 5).map(x => x.id).join(',');
          summary = 'array(' + payload.length + ') ids=[' + ids + '] names=[' + names + ']';
        } else if (payload && payload.message) {
          summary = 'error: ' + payload.message;
        } else {
          summary = '(' + (r.body || '').slice(0, 100) + ')';
        }
      } catch { summary = '(non-JSON: ' + (r.body || '').slice(0, 80) + ')'; }
      return { tag: 'GET ' + p, status: r.status, summary };
    } catch (e) { return { tag: 'GET ' + p, status: 'ERR', summary: e.message }; }
  }));
  res.json({ probes: out });
});

// Live Fergus probe — fires a real GET /jobs request and returns the raw
// status code, response headers, and first 2KB of the body. Lets the user
// see exactly what Fergus says when it 403s, instead of just a bare code.
app.get('/jms/debug/fergus-probe', requireAuth, async (req, res) => {
  if (!process.env.FERGUS_API_KEY) return res.status(500).json({ error: 'FERGUS_API_KEY not set' });
  const path = FERGUS_PREFIX + '/jobs?page=1&per_page=1';
  try {
    const r = await httpsRequest(FERGUS_HOST, path, 'GET', {
      'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY,
      'Accept':        'application/json',
    });
    res.json({
      url: `https://${FERGUS_HOST}${path}`,
      status: r.status,
      headers: r.headers,
      body_preview: (r.body || '').slice(0, 2000),
      body_length: (r.body || '').length,
    });
  } catch (e) {
    res.status(502).json({ error: e.message, url: `https://${FERGUS_HOST}${path}` });
  }
});

// Find-specific-job probe. Fires every plausible REST pattern + sort
// variant in parallel and returns a one-row-per-URL summary so we can
// see, in a single click, which pattern Fergus actually accepts on this
// account. Caller passes ?q=<jobNo>, e.g. ?q=2996.
app.get('/jms/debug/fergus-find', requireAuth, async (req, res) => {
  if (!process.env.FERGUS_API_KEY) return res.status(500).json({ error: 'FERGUS_API_KEY not set' });
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'pass ?q=<jobNo>' });
  const probes = [
    // Direct path attempts — does Fergus accept jobNo as a path param?
    { tag: 'GET /jobs/<q>',                path: '/jobs/' + encodeURIComponent(q) },
    { tag: 'GET /jobs/view/<q>',           path: '/jobs/view/' + encodeURIComponent(q) },
    { tag: 'GET /jobs/by-number/<q>',      path: '/jobs/by-number/' + encodeURIComponent(q) },
    // Query-string filter attempts.
    { tag: 'GET /jobs?jobNo=<q>',          path: '/jobs?page=1&per_page=5&jobNo=' + encodeURIComponent(q) },
    { tag: 'GET /jobs?job_no=<q>',         path: '/jobs?page=1&per_page=5&job_no=' + encodeURIComponent(q) },
    { tag: 'GET /jobs?search=<q>',         path: '/jobs?page=1&per_page=5&search=' + encodeURIComponent(q) },
    { tag: 'GET /jobs?q=<q>',              path: '/jobs?page=1&per_page=5&q=' + encodeURIComponent(q) },
    // Sort-check probes — does sort=-id flip the order?
    { tag: 'GET /jobs (default sort)',     path: '/jobs?page=1&per_page=3' },
    { tag: 'GET /jobs?sort=-id',           path: '/jobs?page=1&per_page=3&sort=-id' },
    { tag: 'GET /jobs?sort_by=id&order=desc', path: '/jobs?page=1&per_page=3&sort_by=id&order=desc' },
    // Status / scope filter probes — does /jobs filter by default and
    // hide jobs in other statuses?
    { tag: 'GET /jobs?status=active',      path: '/jobs?page=1&per_page=20&status=active' },
    { tag: 'GET /jobs?status=open',        path: '/jobs?page=1&per_page=20&status=open' },
    { tag: 'GET /jobs?status=quoted',      path: '/jobs?page=1&per_page=20&status=quoted' },
    { tag: 'GET /jobs?stage=open',         path: '/jobs?page=1&per_page=20&stage=open' },
    { tag: 'GET /jobs?archived=true',      path: '/jobs?page=1&per_page=20&archived=true' },
    { tag: 'GET /jobs?include_archived=true', path: '/jobs?page=1&per_page=20&include_archived=true' },
    { tag: 'GET /jobs?include_all=true',   path: '/jobs?page=1&per_page=20&include_all=true' },
    // Documented Fergus param names (from public docs): `limit` (not
    // `per_page`), status values 'active'/'to price'/etc.
    { tag: 'GET /jobs?limit=200',                 path: '/jobs?page=1&limit=200' },
    { tag: 'GET /jobs?limit=200&status=active',   path: '/jobs?page=1&limit=200&status=active' },
    { tag: 'GET /jobs?limit=200&status=to price', path: '/jobs?page=1&limit=200&status=to+price' },
    { tag: 'GET /jobs?limit=200&status=scheduled',path: '/jobs?page=1&limit=200&status=scheduled' },
    { tag: 'GET /jobs?limit=200&status=invoicing',path: '/jobs?page=1&limit=200&status=invoicing' },
    { tag: 'GET /jobs?per_page=500',              path: '/jobs?page=1&per_page=500' },
    // Documented Fergus partner-API parameters (from api.fergus.com/docs):
    // pageSize (max 100), pageCursor (cursor-based), sortField, sortOrder,
    // filterJobNo, filterJobStatus (CapitalCase values), filterSearchText.
    // These should actually work, unlike everything above.
    { tag: 'GET /jobs?filterJobNo=<q>',              path: '/jobs?pageSize=10&filterJobNo=' + encodeURIComponent(q) },
    { tag: 'GET /jobs?filterSearchText=<q>',         path: '/jobs?pageSize=10&filterSearchText=' + encodeURIComponent(q) },
    { tag: 'GET /jobs?pageSize=100&filterJobStatus=Active',   path: '/jobs?pageSize=100&filterJobStatus=Active' },
    { tag: 'GET /jobs?pageSize=100 sortField=createdAt desc', path: '/jobs?pageSize=100&sortField=createdAt&sortOrder=desc' },
    { tag: 'GET /jobs?pageSize=100&filterShowArchived=true',  path: '/jobs?pageSize=100&filterShowArchived=true' },
    // Different entity types — maybe #2996 is a quote or a customer.
    { tag: 'GET /quotes/<q>',              path: '/quotes/' + encodeURIComponent(q) },
    { tag: 'GET /quotes?q=<q>',            path: '/quotes?page=1&per_page=5&q=' + encodeURIComponent(q) },
    { tag: 'GET /customers/<q>',           path: '/customers/' + encodeURIComponent(q) },
    { tag: 'GET /site_visits/<q>',         path: '/site_visits/' + encodeURIComponent(q) },
    { tag: 'GET /sites/<q>',               path: '/sites/' + encodeURIComponent(q) },
  ];
  const headers = {
    'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY,
    'Accept':        'application/json',
  };
  const out = await Promise.all(probes.map(async (p) => {
    const upstream = FERGUS_PREFIX + p.path;
    try {
      const r = await httpsRequest(FERGUS_HOST, upstream, 'GET', headers);
      // Extract a tiny summary — first job's jobNo + customer if it looks like a list,
      // or the whole job if it's a single resource response.
      let summary = '';
      try {
        const j = JSON.parse(r.body || '{}');
        const payload = j.data || j.value || j;
        if (Array.isArray(payload)) {
          const nos = payload.slice(0, 5).map(x => x.jobNo).join(',');
          const statuses = Array.from(new Set(payload.map(x => x.status).filter(Boolean))).join('/');
          summary = 'array(' + payload.length + ') jobNos=[' + nos + ']' + (statuses ? ' statuses=[' + statuses + ']' : '');
        } else if (payload && (payload.id || payload.jobNo)) {
          summary = 'single id=' + payload.id + ' jobNo=' + payload.jobNo + ' customer=' + ((payload.customer || {}).customerFullName || '?');
        } else if (payload && payload.message) {
          summary = 'error: ' + payload.message;
        } else {
          summary = 'unknown body shape';
        }
      } catch { summary = '(non-JSON response: ' + (r.body || '').slice(0, 80) + ')'; }
      return { tag: p.tag, status: r.status, summary };
    } catch (e) {
      return { tag: p.tag, status: 'ERR', summary: e.message };
    }
  }));
  res.json({ query: q, probes: out });
});

// Diagnostic route so a "not configured" report can be resolved without
// anyone needing shell/dashboard access to Railway: it tells you exactly
// what THIS RUNNING PROCESS sees (env vars set? which host/port? does an
// actual SMTP login succeed?) instead of everyone guessing from a
// variables screenshot that might predate the last redeploy.
app.get('/email/debug', requireAuth, rateLimit(20, 60000), async (req, res) => {
  const method = GAS_ENABLED ? 'google' : (RESEND_ENABLED ? 'resend' : 'smtp');
  const info = {
    method,
    emailFrom: EMAIL_FROM || null,
    replyTo: EMAIL_REPLYTO || null,
    googleRelayConfigured: GAS_ENABLED,
    resendApiKeySet: RESEND_ENABLED,
    smtpUserSet: !!process.env.SMTP_USER,
    smtpPassSet: !!process.env.SMTP_PASS,
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com (default)',
    smtpPort: process.env.SMTP_PORT || '465 (default)',
    emailEnabled: EMAIL_ENABLED,
    buildDeployedAt: BUILD_SHA,
  };
  if (!EMAIL_ENABLED) {
    return res.json(Object.assign({}, info, {
      verify: null,
      verifyError: 'Neither RESEND_API_KEY nor SMTP_USER/SMTP_PASS are set on this running server. If you already added one in Railway → Variables, the service likely hasn’t redeployed since — add a throwaway variable to force a restart, or use Redeploy on the latest deployment. (Resend is recommended: it sends over HTTPS, which container platforms essentially never block, unlike raw SMTP.)',
    }));
  }
  try {
    if (GAS_ENABLED) {
      await _gasVerify();
      res.json(Object.assign({}, info, { verify: true, note: 'Sending via Google Workspace relay as ' + (EMAIL_FROM || 'office@floodroofing.co.nz') + '.' }));
    } else if (RESEND_ENABLED) {
      const keyCheck = await _resendVerifyKey();
      if (!EMAIL_FROM) throw new Error('RESEND_API_KEY is set but EMAIL_FROM is missing — add EMAIL_FROM="Flood Roofing <office@floodroofing.co.nz>".');
      res.json(Object.assign({}, info, { verify: true, note: keyCheck.note }));
    } else {
      const resolved = await _resolveMailTransport(true);   // fresh probe, ignore cache
      res.json(Object.assign({}, info, { verify: true, portUsed: resolved.portUsed }));
    }
  } catch (e) {
    const extra = RESEND_ENABLED ? '' :
      ' (tried port ' + (process.env.SMTP_PORT || '465') +
      ' and its ' + (parseInt(process.env.SMTP_PORT || '465', 10) === 465 ? '587' : '465') +
      ' fallback — both failed, which points at the hosting platform blocking outbound SMTP entirely. Set RESEND_API_KEY instead — it sends over HTTPS, which is essentially never blocked.)';
    res.json(Object.assign({}, info, { verify: false, verifyError: e.message + extra }));
  }
});

// Send an order email with the PDF attached, straight from the app —
// no Gmail tab, no manual attaching.  CC goes to the office mailbox so
// the sender always gets their copy.
app.post('/email/send-order', requireAuth, rateLimit(10, 60000), async (req, res) => {
  if (!EMAIL_ENABLED) {
    return res.status(503).json({ error: 'Email is not configured on the server yet.', code: 'EMAIL_NOT_CONFIGURED' });
  }
  try {
    const { to, cc, subject, text, html, attachment } = req.body || {};
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // to / cc may be a comma-separated list of addresses — validate each part.
    const validList = (v) => { const p = String(v || '').split(',').map(s => s.trim()).filter(Boolean); return p.length > 0 && p.every(a => emailRe.test(a)); };
    if (!to || !validList(to)) return res.status(400).json({ error: 'Valid "to" address required' });
    if (cc && !validList(cc))  return res.status(400).json({ error: 'CC address is not a valid email' });
    if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'Subject required' });
    if (attachment && attachment.base64) {
      // ~25MB JSON body cap upstream; belt-and-braces cap the decoded
      // attachment at 15MB so one request can't balloon memory.
      if (String(attachment.base64).length > 20 * 1024 * 1024) {
        return res.status(413).json({ error: 'Attachment too large' });
      }
      attachment.filename = String(attachment.filename || 'order.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
    }
    const mail = { to, cc, subject, text, html: (html ? String(html).slice(0, 200000) : undefined), attachment };
    // The Google Apps Script relay can take 10-20s to wake + send, which made
    // the office wait on the "Send" button. When the caller opts into
    // background mode, dispatch the send without blocking the response: this
    // process is long-lived (Railway), so the promise completes after we reply.
    // Failures are logged; the office is CC'd on quote emails as the human
    // safety net. Attachment sends stay synchronous so their result is known.
    if ((req.body && req.body.background === true) && !(attachment && attachment.base64)) {
      _dispatchMail(mail)
        .then(function(info){ console.log('send-order (bg) sent to', to, '·', (info && info.messageId) || ''); })
        .catch(function(e){ console.error('send-order (bg) email failed to', to, ':', e.message); });
      return res.status(202).json({ ok: true, queued: true });
    }
    const info = await _dispatchMail(mail);
    res.json({ ok: true, id: info.messageId || null });
  } catch (e) {
    console.error('send-order email failed:', e.message);
    res.status(502).json({ error: 'Email send failed: ' + e.message });
  }
});

app.get('/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url || !url.startsWith('https://api.mapbox.com')) return res.status(400).end();
  const chunks = [];
  https.get(url, (imgRes) => {
    imgRes.on('data', c => chunks.push(c));
    imgRes.on('end', () => {
      res.set('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
      res.set('Access-Control-Allow-Origin', '*');
      res.send(Buffer.concat(chunks));
    });
  }).on('error', () => res.status(502).end());
});

// Keep-warm: poke our own /health every few minutes so the container doesn't go
// idle — a cold start is what makes the customer quote link feel slow. The
// GitHub Action (keep-warm.yml) pings from outside too, which can wake a fully
// slept instance; this internal timer keeps a running one lively between those.
function _keepWarm(){
  // Prefer the platform-provided domain; fall back to the known public URL so
  // the self-ping runs even if RAILWAY_PUBLIC_DOMAIN isn't set on this service.
  const dom = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.KEEPWARM_HOST
    || 'flood-roofing-estimator-production.up.railway.app';
  if (!dom || typeof fetch !== 'function') return;
  const url = (/^https?:\/\//.test(dom) ? dom : 'https://' + dom).replace(/\/+$/, '') + '/health';
  const ping = () => { try { fetch(url, { cache: 'no-store' }).catch(function(){}); } catch(e){} };
  ping();                                   // warm immediately on boot
  const t = setInterval(ping, 150 * 1000);  // every 2.5 min — stay under the idle window
  if (t && t.unref) t.unref();
}

// ── Boot-time schema migration ─────────────────────────────────────
// Idempotent and STRICTLY ADDITIVE: every statement is create-if-not-exists /
// add-column-if-not-exists / create-or-replace, so re-running on every deploy
// is safe and NO existing data is ever dropped, renamed, or rewritten
// destructively. Runs only when DATABASE_URL is set; entirely non-fatal and
// never blocks the server (each statement is tried independently). Any of
// this SQL can also just be run by hand in the Supabase SQL editor.
//
// What it ensures, in order:
//   1. The share-token expression index for the customer /q lookup.
//   2. Multi-tenant tables: companies + company_users (one company per user
//      for now, enforced by a unique index), and a company_id column on
//      jobs / user_settings / profiles.
//   3. Backfill: every existing user gets their own company (named from
//      their profile) and their jobs/settings are stamped with it.
//   4. job_revisions: automatic point-in-time snapshots of each job, taken
//      by DB triggers on UPDATE (throttled, drawing/photo changes only) and
//      on DELETE (always) — so a bad save or an accidental delete can be
//      restored. Pruned to the 8 most recent per job.
//   5. Row Level Security on every tenant table, scoped per company. The
//      backend's service_role key (and the postgres-owned pg pool) bypass
//      RLS by design; the policies are defence-in-depth so the anon key /
//      PostgREST can never read another company's data.
const _MIGRATION_SQL = [
  "create extension if not exists pgcrypto",

  // 1. share-token index (pre-existing migration, kept)
  "create index if not exists idx_jobs_share_token on public.jobs ((draw_state -> 'state' -> 'quote' -> 'share' ->> 'token'))",

  // 2. tenant tables + columns
  "create table if not exists public.companies (" +
  "  id uuid primary key default gen_random_uuid()," +
  "  name text not null default ''," +
  "  created_at timestamptz not null default now())",
  "create table if not exists public.company_users (" +
  "  company_id uuid not null references public.companies(id) on delete cascade," +
  "  user_id uuid not null," +
  "  role text not null default 'member'," +
  "  created_at timestamptz not null default now()," +
  "  primary key (company_id, user_id))",
  "create unique index if not exists idx_company_users_user on public.company_users (user_id)",
  "alter table public.jobs add column if not exists company_id uuid",
  // Who sent the material order, and when — stamped server-side so the board
  // can say "Ethan ordered this" rather than just "ordered".
  "alter table public.jobs add column if not exists order_sent jsonb",
  // Last person to save the company's shared settings row.
  "alter table public.user_settings add column if not exists updated_by uuid",
  "alter table public.user_settings add column if not exists company_id uuid",
  "alter table public.profiles add column if not exists company_id uuid",
  "create index if not exists idx_jobs_company on public.jobs (company_id)",
  "create index if not exists idx_jobs_user on public.jobs (user_id)",

  // 3. backfill — a company for every user seen in profiles or jobs that has
  //    no membership yet, then stamp their jobs/settings/profile. All guarded
  //    by NOT EXISTS so re-runs are no-ops.
  "do $$ declare p record; cid uuid; begin" +
  "  for p in select pr.id, coalesce(nullif(pr.company,''), nullif(pr.name,''), pr.email, 'My Company') as cname" +
  "    from public.profiles pr" +
  "    where not exists (select 1 from public.company_users cu where cu.user_id = pr.id)" +
  "  loop" +
  "    insert into public.companies (name) values (p.cname) returning id into cid;" +
  "    insert into public.company_users (company_id, user_id, role) values (cid, p.id, 'owner');" +
  "  end loop;" +
  "end $$",
  "do $$ declare u record; cid uuid; begin" +
  "  for u in select distinct j.user_id from public.jobs j" +
  "    where j.user_id is not null" +
  "      and not exists (select 1 from public.company_users cu where cu.user_id = j.user_id)" +
  "  loop" +
  "    insert into public.companies (name) values ('My Company') returning id into cid;" +
  "    insert into public.company_users (company_id, user_id, role) values (cid, u.user_id, 'owner');" +
  "  end loop;" +
  "end $$",
  "update public.profiles p set company_id = cu.company_id from public.company_users cu" +
  "  where p.company_id is null and cu.user_id = p.id",
  "update public.jobs j set company_id = cu.company_id from public.company_users cu" +
  "  where j.company_id is null and cu.user_id = j.user_id",
  "update public.user_settings s set company_id = cu.company_id from public.company_users cu" +
  "  where s.company_id is null and cu.user_id = s.user_id",

  // 4. automatic job snapshots (survive bad saves AND deletes)
  "create table if not exists public.job_revisions (" +
  "  id bigserial primary key," +
  "  job_id uuid not null," +
  "  company_id uuid," +
  "  user_id uuid," +
  "  client_name text," +
  "  site_address text," +
  "  status text," +
  "  draw_state jsonb," +
  "  settings jsonb," +
  "  reason text not null default 'update'," +
  "  saved_at timestamptz not null default now())",
  "create index if not exists idx_jobrev_job on public.job_revisions (job_id, saved_at desc)",
  // UPDATE trigger: snapshot the OLD row before it's overwritten, but only
  // when the drawing actually changed (quote-share pings from customer opens
  // are excluded) and at most once per 10 minutes per job, so autosave churn
  // doesn't multiply multi-MB rows. Prune keeps the 8 newest per job.
  "create or replace function public._job_backup_upd() returns trigger" +
  " language plpgsql security definer set search_path = public as $$ begin" +
  "  if (old.draw_state is distinct from new.draw_state)" +
  "     and ((old.draw_state->'state') - 'quote' is distinct from (new.draw_state->'state') - 'quote')" +
  "     and not exists (select 1 from public.job_revisions r where r.job_id = old.id" +
  "                     and r.reason = 'update' and r.saved_at > now() - interval '10 minutes') then" +
  "    insert into public.job_revisions (job_id, company_id, user_id, client_name, site_address, status, draw_state, settings, reason)" +
  "    values (old.id, old.company_id, old.user_id, old.client_name, old.site_address, old.status, old.draw_state, old.settings, 'update');" +
  "    delete from public.job_revisions where job_id = old.id and id not in" +
  "      (select id from public.job_revisions where job_id = old.id order by saved_at desc, id desc limit 8);" +
  "  end if;" +
  "  return new;" +
  " end $$",
  "drop trigger if exists trg_job_backup_upd on public.jobs",
  "create trigger trg_job_backup_upd before update on public.jobs" +
  "  for each row execute function public._job_backup_upd()",
  // DELETE trigger: always keep a final snapshot so a deleted job is recoverable.
  "create or replace function public._job_backup_del() returns trigger" +
  " language plpgsql security definer set search_path = public as $$ begin" +
  "  insert into public.job_revisions (job_id, company_id, user_id, client_name, site_address, status, draw_state, settings, reason)" +
  "  values (old.id, old.company_id, old.user_id, old.client_name, old.site_address, old.status, old.draw_state, old.settings, 'delete');" +
  "  return old;" +
  " end $$",
  "drop trigger if exists trg_job_backup_del on public.jobs",
  "create trigger trg_job_backup_del before delete on public.jobs" +
  "  for each row execute function public._job_backup_del()",

  // 5. RLS per company. my_company_ids() is SECURITY DEFINER so the policies
  //    can consult company_users without recursing into its own policy.
  "create or replace function public.my_company_ids() returns setof uuid" +
  " language sql stable security definer set search_path = public as" +
  " $$ select company_id from public.company_users where user_id = auth.uid() $$",
  "alter table public.companies enable row level security",
  "alter table public.company_users enable row level security",
  "alter table public.profiles enable row level security",
  "alter table public.subscriptions enable row level security",
  "alter table public.jobs enable row level security",
  "alter table public.user_settings enable row level security",
  "alter table public.job_revisions enable row level security",
  "drop policy if exists companies_member on public.companies",
  "create policy companies_member on public.companies for all" +
  "  using (id in (select public.my_company_ids()))" +
  "  with check (id in (select public.my_company_ids()))",
  "drop policy if exists company_users_self on public.company_users",
  "create policy company_users_self on public.company_users for select" +
  "  using (user_id = auth.uid() or company_id in (select public.my_company_ids()))",
  "drop policy if exists profiles_self on public.profiles",
  "create policy profiles_self on public.profiles for all" +
  "  using (id = auth.uid()) with check (id = auth.uid())",
  "drop policy if exists subscriptions_self on public.subscriptions",
  "create policy subscriptions_self on public.subscriptions for select" +
  "  using (user_id = auth.uid())",
  "drop policy if exists jobs_company on public.jobs",
  "create policy jobs_company on public.jobs for all" +
  "  using (company_id in (select public.my_company_ids()) or user_id = auth.uid())" +
  "  with check (company_id in (select public.my_company_ids()) or user_id = auth.uid())",
  "drop policy if exists user_settings_company on public.user_settings",
  "create policy user_settings_company on public.user_settings for all" +
  "  using (company_id in (select public.my_company_ids()) or user_id = auth.uid())" +
  "  with check (company_id in (select public.my_company_ids()) or user_id = auth.uid())",
  "drop policy if exists job_revisions_company on public.job_revisions",
  "create policy job_revisions_company on public.job_revisions for select" +
  "  using (company_id in (select public.my_company_ids()) or user_id = auth.uid())",
];

async function _ensureSchema(){
  if (!process.env.DATABASE_URL) { console.warn('[migrate] DATABASE_URL not set — multi-tenant schema NOT ensured'); return; }
  let Client;
  try { Client = require('pg').Client; } catch(e){ console.log('[migrate] pg not installed — skipping (run the SQL manually)'); return; }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  let ok = 0, failed = 0;
  try {
    await c.connect();
    for (const sql of _MIGRATION_SQL) {
      try { await c.query(sql); ok++; }
      catch(e){ failed++; console.warn('[migrate] statement failed (continuing): ' + e.message + ' — SQL: ' + sql.slice(0, 90)); }
    }
    console.log('[migrate] schema ensured: ' + ok + ' ok, ' + failed + ' failed');
  } catch(e){ console.warn('[migrate] schema ensure skipped:', e.message); }
  finally { try { await c.end(); } catch(e){} }
}

app.listen(PORT, () => {
  console.log('RoofMap backend running on port ' + PORT + ' · build: email-recipients-v7');
  console.log('Supabase: ' + (process.env.SUPABASE_URL ? 'OK' : 'NOT SET'));
  console.log('Stripe: disabled');
  try { _keepWarm(); } catch(e){}
  _ensureSchema().catch(function(){});
});
