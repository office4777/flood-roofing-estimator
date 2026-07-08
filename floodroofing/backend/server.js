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

// Supabase - uses SUPABASE_ANON_KEY (set on Railway)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
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
  } catch (e) {}
  return false;
}

const corsOptions = {
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
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
async function _gasSendMail({ to, cc, subject, text, attachment }) {
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(EMAIL_FROM || '');
  const fromName = (m && m[1].trim()) || 'Flood Roofing';
  const payload = {
    token: GAS_MAIL_TOKEN,
    to, cc: cc || '',
    subject, text: text || '',
    fromName,
    replyTo: EMAIL_REPLYTO || '',
  };
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
async function _resendSendMail({ to, cc, subject, text, attachment }) {
  if (!EMAIL_FROM) throw new Error('RESEND_API_KEY is set but EMAIL_FROM is missing — add EMAIL_FROM="Flood Roofing <office@floodroofing.co.nz>" (once that domain is verified in Resend → Domains).');
  const payload = { from: EMAIL_FROM, to: [to], subject, text };
  if (cc) payload.cc = [cc];
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
app.get('/health', (req, res) => res.json({ ok: true, build: BUILD_SHA, features: FEATURES, railway: _railwayIdentity() }));

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
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
  if (process.env.OPEN_REGISTRATION !== 'true') {
    const invite = (req.body || {}).invite || '';
    const expected = process.env.REGISTRATION_INVITE_CODE || '';
    if (!expected || invite !== expected) {
      return res.status(403).json({ error: 'Registration is invite-only — contact Flood Roofing for access.' });
    }
  }
  try {
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return res.status(400).json({ error: error.message });
    const userId = data.user.id;
    await supabase.from('profiles').insert({ id: userId, email, name: name || '', company: company || '' });
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);
    await supabase.from('subscriptions').insert({ user_id: userId, status: 'trialing', trial_ends_at: trialEnd.toISOString() });
    const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: userId, email, name, company } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid email or password' });
    const userId = data.user.id;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).single();
    const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { ...profile }, subscription: sub });
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

app.get('/jobs', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('jobs').select('id, client_name, site_address, created_at, updated_at, status').eq('user_id', req.user.id).order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/jobs', requireAuth, requireSubscription, async (req, res) => {
  const { client_name, site_address, draw_state, settings } = req.body;
  const { data, error } = await supabase.from('jobs').insert({ user_id: req.user.id, client_name: client_name || '', site_address: site_address || '', draw_state: draw_state || {}, settings: settings || {}, status: 'draft' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/jobs/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('jobs').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/jobs/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('jobs').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/jobs/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('jobs').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Per-user settings: branding, quote defaults, JMS API keys.
app.get('/settings', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('user_settings').select('*').eq('user_id', req.user.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || { user_id: req.user.id, branding: {}, quote_defaults: {}, jms_keys: {} });
});

app.put('/settings', requireAuth, async (req, res) => {
  const { branding, quote_defaults, jms_keys, price_book, labour_pricing } = req.body;
  const row = {
    user_id: req.user.id,
    branding: branding || {},
    quote_defaults: quote_defaults || {},
    jms_keys: jms_keys || {},
    price_book: price_book || {},
    labour_pricing: labour_pricing || {},
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('user_settings').upsert(row, { onConflict: 'user_id' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ══════════════════════════════════════════════════════════════════
// PUBLIC CUSTOMER QUOTE VIEW — token-based, no auth.  Lets a customer
// open a shareable link, change the options/grades, and accept /
// decline / query the quote.  All writes go back onto the owning job so
// the office app sees the status + selections.  Uses the service-key
// Supabase client so it can read/write across users without a JWT.
// ══════════════════════════════════════════════════════════════════
function _quoteOf(job){ return (((job||{}).draw_state||{}).state||{}).quote || null; }
async function _findJobByToken(token){
  if (!token) return null;
  const { data, error } = await supabase.from('jobs')
    .select('id, user_id, client_name, site_address, draw_state')
    .eq('draw_state->state->quote->share->>token', token).limit(1);
  if (error) throw new Error(error.message);
  return (data && data[0]) || null;
}
async function _saveQuoteBack(job, quote){
  const ds = job.draw_state || {};
  ds.state = ds.state || {};
  ds.state.quote = quote;
  await supabase.from('jobs').update({ draw_state: ds, updated_at: new Date().toISOString() }).eq('id', job.id);
}

// Customer opens the quote.  Rate-limited: the token is the only
// credential, so cap per-IP guessing speed.
app.get('/q/:token', rateLimit(60, 60000), async (req, res) => {
  try {
    const job = await _findJobByToken(req.params.token);
    const quote = _quoteOf(job);
    if (!job || !quote) return res.status(404).json({ error: 'Quote not found' });
    const { data: settings } = await supabase.from('user_settings').select('branding').eq('user_id', job.user_id).maybeSingle();
    const share = quote.share || {};
    share.openCount = (share.openCount || 0) + 1;
    share.lastOpenedAt = new Date().toISOString();
    if (!share.status || share.status === 'sent') share.status = 'opened';
    if (!Array.isArray(share.events)) share.events = [];
    // Only log a fresh "opened" event if the last one wasn't an open in the past 2 min.
    const last = share.events[share.events.length - 1];
    if (!last || last.type !== 'opened' || (Date.now() - new Date(last.at).getTime()) > 120000) {
      share.events.push({ type: 'opened', at: share.lastOpenedAt });
      if (share.events.length > 80) share.events = share.events.slice(-80);
    }
    quote.share = share;
    await _saveQuoteBack(job, quote);
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
    const job = await _findJobByToken(req.params.token);
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

// Office home-screen feed: every job that has a shared quote, with its
// current status + last activity.
app.get('/quote-activity', requireAuth, async (req, res) => {
  try {
    // Select ONLY the quote subtree.  draw_state holds the full drawing —
    // often megabytes of aerial-image data URLs — and pulling 120 whole
    // rows on every poll blew the request (the office console filled with
    // /quote-activity 500s).  The JSON-path select fetches kilobytes.
    const { data, error } = await supabase.from('jobs')
      .select('id, client_name, site_address, updated_at, quote:draw_state->state->quote')
      .eq('user_id', req.user.id).order('updated_at', { ascending: false }).limit(120);
    if (error) return res.status(500).json({ error: error.message });
    const feed = (data || []).map(function(j){
      const q = j.quote || {};
      const sh = q.share;
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
    }).filter(Boolean);
    res.json(feed);
  } catch (e) { res.status(500).json({ error: e.message }); }
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

  // Primary: POST /attachments with the job as the entity.
  const entityTypes = process.env.FERGUS_ATTACH_ENTITY_TYPE
    ? [process.env.FERGUS_ATTACH_ENTITY_TYPE]
    : ['JOB', 'job', 'Job'];
  for (const et of entityTypes) {
    const a = await _fergusAttachmentAttempt(et, jobId, buf, contentType, filename, field);
    attempts.push(a);
    if (a.ok && a.looksCreated) {
      return res.json({ ok: true, used: '/attachments', entityType: et, status: a.status, fergus: a.body, url: a.url, attempts });
    }
    // A 4xx that isn't 404 means the endpoint EXISTS but rejected this
    // entityType/field — no point trying more casings blindly if it's a
    // validation error naming the real problem; surface it.
    if (a.status && a.status !== 404 && a.status >= 400 && a.status < 500 && a.body && a.body.message) {
      // keep trying other casings, but this body is the useful clue
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
  '/v2/jobs/{jobId}/files',
  '/v2/jobs/{jobId}/photos',
  '/v2/jobs/{jobId}/attachments',
  '/v2/jobs/{jobId}/gallery',
  '/v2/jobs/{jobId}/job_files',
  '/job/{jobId}/files',
  '/job/{jobId}/photos',
];

function _normaliseFergusFile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Cover the half-dozen field names Fergus uses across endpoints —
  // the picker needs at minimum an id, a display name, a content-type
  // hint and either a URL or a download path.
  const id   = raw.id || raw.uuid || raw.file_id || raw.attachment_id || raw.gallery_id || null;
  const name = raw.name || raw.filename || raw.title || raw.original_name || raw.file_name || raw.display_name || ('file-' + (id || ''));
  const url  = raw.url || raw.public_url || raw.download_url || raw.path || raw.file_url || raw.original_url || raw.signed_url || raw.s3_url || raw.cdn_url || null;
  const thumb= raw.thumbnail || raw.thumb_url || raw.preview_url || raw.thumbnail_url || raw.thumb || null;
  const mime = raw.mime_type || raw.content_type || raw.contentType || raw.type || raw.file_type || '';
  return { id, name, url, thumbnail: thumb || url, contentType: mime };
}

app.get('/fergus-files/list', requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.FERGUS_API_KEY) return res.status(500).json({ error: 'Fergus not configured' });
  const jobId = req.query.jobId;
  if (!jobId) return res.status(400).json({ error: 'jobId query param required' });

  // If the env has pinned a known-good list path, use it directly;
  // otherwise walk the candidates and stop at the first array-shaped
  // response with at least one item.
  const candidates = process.env.FERGUS_FILES_PATH
    ? [process.env.FERGUS_FILES_PATH, ...FERGUS_LIST_CANDIDATES]
    : FERGUS_LIST_CANDIDATES;

  const attempts = [];
  for (const tpl of candidates) {
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
      // Always stash a short shape summary so the picker can show the
      // user exactly why no files came back — keys present, array
      // length, status code.
      const summary = parsed && typeof parsed === 'object'
        ? (Array.isArray(parsed)
            ? { type:'array', length: parsed.length, firstKeys: parsed[0] && typeof parsed[0]==='object' ? Object.keys(parsed[0]).slice(0,12) : null }
            : { type:'object', keys: Object.keys(parsed).slice(0,15) })
        : { type: typeof parsed, sample: String(text).slice(0,120) };
      attempts.push({ path: tpl, status: r.status, ok: r.ok, summary });
      if (!r.ok || !parsed) continue;
      // Find the array — Fergus wraps lists in several shapes (.data,
      // .files, .photos, …) so peel one level of nesting if needed.
      let arr = null;
      if (Array.isArray(parsed)) arr = parsed;
      else if (Array.isArray(parsed.data)) arr = parsed.data;
      else if (Array.isArray(parsed.files)) arr = parsed.files;
      else if (Array.isArray(parsed.photos)) arr = parsed.photos;
      else if (Array.isArray(parsed.attachments)) arr = parsed.attachments;
      else if (Array.isArray(parsed.items)) arr = parsed.items;
      else if (Array.isArray(parsed.records)) arr = parsed.records;
      else if (parsed.value && Array.isArray(parsed.value.data)) arr = parsed.value.data;
      else if (parsed.result && Array.isArray(parsed.result)) arr = parsed.result;
      else if (parsed.result && Array.isArray(parsed.result.files)) arr = parsed.result.files;
      if (!arr) continue;
      const files = arr.map(_normaliseFergusFile).filter(Boolean);
      if (!files.length) continue;
      return res.json({ ok: true, used: tpl, count: files.length, files, attempts });
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
              return res.json({ ok: true, used: tpl + ' (altId ' + altId + ')', count: files.length, files, attempts });
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
                return res.json({ ok: true, used: tpl + ' (' + sub.kind + ' ' + sub.id + ')', count: files.length, files, attempts });
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
  // Only allow URLs whose host matches the configured Fergus host (or a
  // sibling like cdn / media subdomain) so this proxy can't be turned
  // into an open redirect / SSRF.
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'invalid url' }); }
  const allowedHostSuffix = (FERGUS_HOST.replace(/^api\./, '')) || 'fergus.com';
  if (!parsed.host.endsWith(allowedHostSuffix)) {
    return res.status(403).json({ error: 'host not allowed', host: parsed.host, allowedSuffix: allowedHostSuffix });
  }
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + process.env.FERGUS_API_KEY },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'fergus returned ' + r.status, body: text.slice(0, 400) });
    }
    res.set('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    const cd = r.headers.get('content-disposition');
    if (cd) res.set('Content-Disposition', cd);
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
    const { to, cc, subject, text, attachment } = req.body || {};
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!to || !emailRe.test(String(to))) return res.status(400).json({ error: 'Valid "to" address required' });
    if (cc && !emailRe.test(String(cc)))  return res.status(400).json({ error: 'CC address is not a valid email' });
    if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'Subject required' });
    if (attachment && attachment.base64) {
      // ~25MB JSON body cap upstream; belt-and-braces cap the decoded
      // attachment at 15MB so one request can't balloon memory.
      if (String(attachment.base64).length > 20 * 1024 * 1024) {
        return res.status(413).json({ error: 'Attachment too large' });
      }
      attachment.filename = String(attachment.filename || 'order.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
    }
    var info;
    if (GAS_ENABLED) {
      info = await _gasSendMail({ to, cc, subject: String(subject).slice(0, 300), text: String(text || ''), attachment });
    } else if (RESEND_ENABLED) {
      info = await _resendSendMail({ to, cc, subject: String(subject).slice(0, 300), text: String(text || ''), attachment });
    } else {
      const from = process.env.SMTP_FROM || process.env.SMTP_USER;
      const attachments = (attachment && attachment.base64)
        ? [{ filename: attachment.filename, content: Buffer.from(attachment.base64, 'base64'), contentType: 'application/pdf' }]
        : [];
      const resolved = await _resolveMailTransport();
      info = await resolved.transporter.sendMail({
        from, to, cc: cc || undefined,
        subject: String(subject).slice(0, 300),
        text: String(text || ''),
        attachments,
      });
    }
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

app.listen(PORT, () => {
  console.log('RoofMap backend running on port ' + PORT);
  console.log('Supabase: ' + (process.env.SUPABASE_URL ? 'OK' : 'NOT SET'));
  console.log('Stripe: disabled');
});
