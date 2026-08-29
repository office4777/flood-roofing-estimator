require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3456;

// Railway terminates TLS at its edge and forwards to us over plain HTTP, so
// without this every request arrives reporting the edge's address as req.ip.
// That is not a cosmetic logging problem: every bucket in the rate limiter
// below is keyed on req.ip, so ALL traffic shared one bucket — five password
// resets per 15 minutes across the entire platform, and an attacker
// indistinguishable from everybody else. '1' = trust exactly one hop, the
// Railway edge, so a client cannot forge the address by sending its own
// X-Forwarded-For.
app.set('trust proxy', 1);

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
// `keyFn` lets a route add a dimension of its own. Login uses it to count per
// email as well as per IP, so one attacker cannot lock out a whole office
// sitting behind one address, and cannot spray a single account from many
// addresses either — both limits have to pass.
function rateLimit(maxPerWindow, windowMs, keyFn) {
  return function (req, res, next) {
    const key = (keyFn ? keyFn(req) : req.ip) + '|' + req.route.path;
    const now = Date.now();
    let b = _rateBuckets.get(key);
    if (!b || now - b.start > windowMs) { b = { start: now, n: 0, w: windowMs }; _rateBuckets.set(key, b); }
    b.n++;
    // Memory backstop. Drop windows that have already expired rather than
    // wiping the map: a blanket clear() is itself the bypass, because anyone
    // able to push the map past the cap resets everybody's counter — including
    // their own. Each bucket remembers its own window so a long-window route
    // is not pruned early by a short-window one.
    if (_rateBuckets.size > 5000) {
      for (const [k, v] of _rateBuckets) if (now - v.start > v.w) _rateBuckets.delete(k);
      if (_rateBuckets.size > 20000) _rateBuckets.clear();   // last resort
    }
    if (b.n > maxPerWindow) return res.status(429).json({ error: 'Too many requests — slow down.' });
    next();
  };
}

// Normalised so BOB@x.co.nz and bob@x.co.nz cannot be counted separately.
// Falls back to the address when no email was sent, so a malformed request
// still lands in a bucket rather than a shared empty-string one.
function _emailKey(req) {
  const e = (((req.body || {}).email) || '').toString().trim().toLowerCase();
  return e ? 'email:' + e : 'ip:' + req.ip;
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

// Domains the app itself is served from. The office app and the customer quote
// both call this backend cross-origin, so a domain missing from here loads the
// page fine and then fails EVERY api() call — which reads as "the app is
// broken", not as a CORS problem. Each entry covers the apex and any subdomain
// of it (roofmap.co.nz, www.roofmap.co.nz, quote.roofmap.co.nz …).
const APP_DOMAINS = [
  'floodroofing.co.nz',   // quote.floodroofing.co.nz — Flood Roofing's own
  'roofmap.co.nz',        // the product, New Zealand
  'roofmap.com',          // the product, international
];

function isAllowedOrigin(origin) {
  if (!origin) return true;                       // same-origin / non-browser
  if (allowedOrigins.includes(origin)) return true;
  try {
    var host = new URL(origin).hostname;
    if (host.endsWith('.vercel.app')) {
      return VERCEL_PROJECT_PREFIXES.some(function(p){ return host.startsWith(p); });
    }
    // The office app and the customer-facing quote are served from these,
    // then call this backend cross-origin — apex and any subdomain.
    if (APP_DOMAINS.some(function(d){ return host === d || host.endsWith('.' + d); })) return true;
    // A subscriber's own verified domain — they may run the office app there
    // too, not just serve their customers' quotes from it.
    if (typeof _isVerifiedCompanyDomain === 'function' && _isVerifiedCompanyDomain(host)) return true;
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

// The PUBLIC customer-quote routes are served from whatever domain each
// business points at the app — a roofer's quote.acme.co.nz is as legitimate as
// roofmap.co.nz, and we can't know the list in advance. Those routes carry no
// cookies, are guarded by the share token in the URL, and are equally callable
// from any server, so CORS was never what protected them and reflecting the
// caller's origin gives nothing away. Every AUTHENTICATED office route stays on
// the fixed allowlist above.
function _publicQuoteRoute(req){ return /^\/q\//.test(req.path || ''); }
const corsDelegate = function(req, cb){
  if (_publicQuoteRoute(req)) return cb(null, { origin: true, credentials: false });
  cb(null, corsOptions);
};
// Security headers. Hand-rolled rather than pulling in helmet: this process
// answers JSON and nothing else — no HTML, no static assets — so the handful
// of headers that actually apply are easier to read than a dependency's
// defaults, and match how rateLimit above is done.
//
// The pages a person actually looks at are served by Vercel, not from here,
// so the anti-framing that protects the customer quote page is set in
// frontend/vercel.json as well. This covers the API responses.
app.use(function (req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // A quote share token travels in the URL path, so never let it ride out in
  // a Referer header to somebody else's server.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Nothing here is a document: if a browser is pointed straight at an API
  // response, it may not load anything or be framed by anyone.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (req.secure || req.headers['x-forwarded-proto'] === 'https')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(cors(corsDelegate));
app.options('*', cors(corsDelegate));
// Stripe signs the exact bytes it sends, so its webhook must see the RAW
// body — registered before the JSON parser, delegating to the handler in
// the billing section below (functions hoist; the route only runs later).
app.post('/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }),
  function (req, res) { return _stripeWebhook(req, res); });

// Body size. A single 25mb cap across the whole API meant ANY path would
// buffer 25mb into memory before a single line of the handler ran — including
// unauthenticated ones like /auth/login and /client-error, and paths that do
// not exist. A handful of concurrent posts is then a memory-exhaustion DoS
// that costs the attacker nothing and needs no account.
//
// So the default is small, and the large cap is granted only to the routes
// that have earned it: a whole job (photos + the aerial live in draw_state), a
// price book with a logo and gallery, an emailed PDF, a file upload, or an
// image on its way to the AI.
const jsonSmall = express.json({ limit: '256kb' });
const jsonLarge = express.json({ limit: '25mb' });
const BIG_BODY = [
  ['POST', /^\/jobs\/?$/],                        // create, carries draw_state
  ['PUT',  /^\/jobs\/[^/]+\/?$/],                 // save, spreads the whole body
  ['PUT',  /^\/jobs\/[^/]+\/quote\/?$/],          // quote holds its own photos
  ['PUT',  /^\/settings\/?$/],                    // logo, gallery, price book
  ['POST', /^\/q\/[^/]+\/accept-email\/?$/],      // the accepted-quote PDF
  ['POST', /^\/fergus-files\/upload\/?$/],
  ['POST', /^\/email\/send-order\/?$/],            // order PDF attachment
  ['POST', /^\/feedback\/?$/],                    // bug report + screenshot PDF
  ['POST', /^\/claude\//],                        // aerial image to the model
];
function _wantsBigBody(req){
  return BIG_BODY.some(function (e) { return req.method === e[0] && e[1].test(req.path); });
}
app.use(function (req, res, next) {
  return (_wantsBigBody(req) ? jsonLarge : jsonSmall)(req, res, next);
});
// Over the cap is the caller's problem, not a crash: answer JSON, so the app
// shows something useful instead of Express's HTML error page.
app.use(function (err, req, res, next) {
  // The browser hung up mid-upload — tab closed, network dropped, page
  // navigated away during an autosave. Nothing broke at our end and there is
  // nobody left to answer, so close quietly instead of paging the error
  // monitor with "request aborted" every time someone shuts their laptop.
  if (err && (err.type === 'request.aborted' || err.code === 'ECONNABORTED')) {
    if (!res.headersSent) { try { res.status(400).end(); } catch (e) {} }
    return;
  }
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      error: 'That request is too large for this endpoint.',
      code: 'PAYLOAD_TOO_LARGE',
    });
  }
  return next(err);
});

// ══════════════════════════════════════════════════════════════════
// ERROR MONITORING — so a subscriber hitting a bug is not a secret
// ══════════════════════════════════════════════════════════════════
// Until now a crash went to the container's stdout and stayed there. With
// one company using this that was survivable — Aron would ring. With a
// hundred, a broken save is a silent cancellation: they hit it, they don't
// report it, they leave.
//
// This is the smallest thing that fixes that, with no SDK and no account to
// sign up for:
//   • every unhandled route error, uncaught exception and rejected promise
//     lands in one recorder;
//   • so does every frontend crash, posted from the browser;
//   • the last 200 are kept in memory and readable at /admin/errors;
//   • each distinct error is announced ONCE per quiet period, to a webhook
//     (Slack, Discord, anything that takes a JSON POST) and/or an email.
//
// Nothing here can throw its way into a request: every path is wrapped.
const ERR_KEEP        = 200;                                     // ring buffer size
const ERR_QUIET_MS    = 15 * 60 * 1000;                          // re-announce the same error at most this often
const ERR_MAX_PER_HR  = 20;                                      // total notifications an hour, whatever happens
const ERR_WEBHOOK     = process.env.ERROR_WEBHOOK_URL || '';
const ERR_EMAIL_TO    = process.env.ERROR_EMAIL_TO || '';
const ADMIN_TOKEN     = process.env.ADMIN_TOKEN || '';

const _errRing  = [];              // newest last
const _errSeen  = new Map();       // fingerprint → { count, first, last, announced }
let   _errSentThisHour = 0, _errHourStartedAt = Date.now();

// Two errors are "the same" when they'd be fixed by the same change: same
// kind, same message shape, same first line of the stack. Numbers and ids in
// the message are stripped so "job 41 not found" and "job 92 not found" don't
// read as two separate problems.
function _errFingerprint(kind, message, stack){
  const shape = String(message || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b\d+\b/g, '<n>')
    .slice(0, 200);
  const top = String(stack || '').split('\n')[1] || '';
  return crypto.createHash('sha1').update(kind + '|' + shape + '|' + top.trim()).digest('hex').slice(0, 12);
}
function _errRedact(v){
  // Never let a token, a password or a base64 photo into a log line or a
  // Slack channel. Errors get read by people who shouldn't need clearance.
  return String(v == null ? '' : v)
    // A JWT is recognisable on its own, wherever it turns up — which matters,
    // because "Authorization: Bearer <jwt>" hides the token one word further
    // along than a naive keyword match reaches.
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>')
    .replace(/(authorization|password|passwd|token|api[-_]?key|secret)\s*[:=]\s*(bearer\s+)?\S+/gi, '$1: <redacted>')
    .replace(/\bbearer\s+\S+/gi, 'bearer <redacted>')
    .replace(/data:[a-z/+]+;base64,[A-Za-z0-9+/=]{40,}/gi, '<data-uri>')
    .slice(0, 4000);
}
function _errAllowNotify(){
  if (Date.now() - _errHourStartedAt > 3600e3){ _errHourStartedAt = Date.now(); _errSentThisHour = 0; }
  return _errSentThisHour < ERR_MAX_PER_HR;
}
async function _errNotify(rec, seen){
  if (!_errAllowNotify()) return;
  _errSentThisHour++;
  const where = rec.route || rec.url || '—';
  const title = '[RoofMap ' + rec.kind + '] ' + rec.message.slice(0, 140);
  const lines = [
    title,
    'Build:   ' + BUILD_SHA,
    'Where:   ' + where,
    'Who:     ' + (rec.company || '—') + (rec.user ? ' · ' + rec.user : ''),
    'Seen:    ' + seen.count + '× since ' + new Date(seen.first).toISOString(),
    'Print:   ' + rec.fingerprint,
    '',
    rec.stack || '(no stack)',
  ].join('\n');
  if (ERR_WEBHOOK){
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      await fetch(ERR_WEBHOOK, { method:'POST', headers:{'content-type':'application/json'},
        // `text` suits Slack and Discord; the rest is there for anything that
        // wants the structure instead.
        body: JSON.stringify({ text: lines, kind: rec.kind, fingerprint: rec.fingerprint,
                               message: rec.message, where, build: BUILD_SHA, count: seen.count }),
        signal: ctl.signal }).catch(function(){});
      clearTimeout(t);
    } catch(e){ /* a failed alert must never become a second incident */ }
  }
  if (ERR_EMAIL_TO){
    try { await _dispatchMail({ to: ERR_EMAIL_TO, subject: title, text: lines }); } catch(e){}
  }
}
function recordError(kind, err, ctx){
  try {
    ctx = ctx || {};
    const message = _errRedact((err && err.message) || err || 'unknown error');
    const stack   = _errRedact((err && err.stack) || '');
    const fingerprint = _errFingerprint(kind, message, stack);
    const rec = {
      at: new Date().toISOString(), kind, fingerprint, message, stack,
      route: ctx.route || '', url: _errRedact(ctx.url || '').slice(0, 300),
      method: ctx.method || '', status: ctx.status || 0,
      company: ctx.company || '', user: _errRedact(ctx.user || '').slice(0, 120),
      agent: _errRedact(ctx.agent || '').slice(0, 200), build: BUILD_SHA,
    };
    _errRing.push(rec);
    while (_errRing.length > ERR_KEEP) _errRing.shift();

    const seen = _errSeen.get(fingerprint) || { count: 0, first: Date.now(), last: 0, announced: 0 };
    seen.count++; seen.last = Date.now();
    _errSeen.set(fingerprint, seen);

    console.error('[error:' + kind + '] ' + fingerprint + ' ' + (rec.route || rec.url) + ' — ' + message);
    if (stack) console.error(stack);

    if (Date.now() - seen.announced > ERR_QUIET_MS){
      seen.announced = Date.now();
      _errNotify(rec, seen).catch(function(){});
    }
    return fingerprint;
  } catch(e){ try { console.error('[error:recorder-failed]', e && e.message); } catch(e2){} return ''; }
}

// Forty-nine routes catch their own database error and answer with a
// hand-rolled 500. Those never reach the error middleware at the bottom, and
// they are exactly the failures that matter — a save that didn't save. So
// every 5xx is recorded on the way OUT, whoever wrote it.
app.use(function (req, res, next) {
  const send = res.json.bind(res);
  res.json = function (body) {
    try {
      if (res.statusCode >= 500){
        const msg = (body && (body.error || body.message)) || ('HTTP ' + res.statusCode);
        const e = new Error(String(msg));
        e.stack = '';   // there is no throw site — the route handled it itself
        const id = recordError('server-5xx', e, {
          route: (req.route && req.route.path) || '', url: req.originalUrl,
          method: req.method, status: res.statusCode,
          company: req.companyId || '', user: (req.user && req.user.email) || '',
          agent: req.headers['user-agent'] || '',
        });
        // Give the caller something to quote, the same as the middleware does.
        if (body && typeof body === 'object' && !body.incident) body.incident = id;
      }
    } catch(e){}
    return send(body);
  };
  next();
});

// Express 4 does not catch an async handler that rejects — it hangs the
// request instead. Rather than wrap 90 route bodies by hand, wrap the
// REGISTRATION, so every route declared below is covered whether or not
// somebody remembers.
['get','post','put','patch','delete','all'].forEach(function(verb){
  const orig = app[verb].bind(app);
  app[verb] = function(path){
    const handlers = Array.prototype.slice.call(arguments, 1).map(function(h){
      if (typeof h !== 'function' || h.length >= 4) return h;
      return function(req, res, next){
        let out;
        try { out = h(req, res, next); }
        catch(e){ return next(e); }
        if (out && typeof out.then === 'function') out.catch(next);
        return out;
      };
    });
    return orig.apply(null, [path].concat(handlers));
  };
});

// A crash that kills the process must be seen before the platform restarts
// it — otherwise it looks like a mysterious blip in the logs.
process.on('unhandledRejection', function(reason){
  recordError('unhandled-rejection', reason instanceof Error ? reason : new Error(String(reason)), {});
});
process.on('uncaughtException', function(err){
  recordError('uncaught-exception', err, {});
  // Keep going only long enough to get the alert out. The process state is
  // not trustworthy after this, so let the platform restart us.
  setTimeout(function(){ process.exit(1); }, 1500).unref();
});

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
const RESEND_API_BASE = (process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '');
const RESEND_ENABLED = !!RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '';
const EMAIL_REPLYTO = process.env.EMAIL_REPLYTO || '';
// ── THE PLATFORM'S OWN MAILBOXES ────────────────────────────────────
// Not everything the platform sends is the same kind of message. A
// subscription invoice is the accounts department writing; a bug report is
// the support desk being written TO. Sending both out of one anonymous
// noreply@ address means a subscriber who hits Reply on their invoice
// reaches nobody, and a support reply arrives from the wrong mailbox.
//
// These are OUR addresses on OUR sending domain, so they are safe to put in
// the From line — unlike a tenant's address, which we can only ever put in
// Reply-To (see _tenantMailIdentity). Overridable per deployment because the
// domain is not hardcoded anywhere else either.
const MAIL_ACCOUNTS = (process.env.ACCOUNTS_EMAIL || 'accounts@roofmap.co.nz').trim();
const MAIL_SUPPORT  = (process.env.SUPPORT_EMAIL  || 'support@roofmap.co.nz').trim();
// Where a new early-access lead lands. A roofer asking for access is a sales
// conversation, not a support ticket, and mixing the two means the one that
// needs answering today sits under the one that does not.
const MAIL_SALES    = (process.env.SALES_EMAIL    || 'sales@roofmap.co.nz').trim();
// The domain we are actually authorised to send from — whatever EMAIL_FROM
// was verified as, falling back to the platform domain.
function _mailSendingDomain(){
  const m = /@([^>\s]+)/.exec(_mailFromAddress() || MAIL_ACCOUNTS);
  return (m && m[1] || '').toLowerCase();
}
// A From address is only honoured when it is ours. Anything else — a
// subscriber's address, a homeowner's — is silently dropped back to the
// verified default, because sending as a domain we do not own is forgery
// that lands in spam. Their address belongs in Reply-To.
function _allowedFromAddress(addr){
  const a = String(addr || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) return null;
  const dom = _mailSendingDomain();
  return (dom && a.endsWith('@' + dom)) ? a : null;
}
// ── SENDING AS THE SUBSCRIBER — their domain, verified ──────────────
// The one exception to "the From address is always ours": a business that
// has proven it owns its domain (SPF + DKIM added at their registrar,
// confirmed by Resend) may send from an address on it. That is not forgery
// — it is exactly what the verification authorised. Only the Resend pipe
// honours it: the Google relay is one Gmail account that can only send as
// its own aliases, and SMTP is a single login — handing either a foreign
// From line would bounce or silently misfire, so they keep the platform
// address and the fallback path stays exactly yesterday's behaviour.
//
// Held in memory like the CORS domain allowlist above it: the send path is
// hot and must not pay a database round-trip per message. A domain lands
// here only after an owner added it AND Resend confirmed the DNS.
const _mailDomains = { at: 0, byCompany: new Map(), domains: new Set(), loading: false };
// ── THE SHARED TENANT SUBDOMAIN — their name, our DNS ───────────────
// The middle rung between "our address with their display name" and "their
// own verified domain": a sending subdomain WE own (quotes.roofmap.co.nz),
// verified once in Resend with records in OUR DNS, on which every business
// gets an address made from its name — "Flood Roofing" becomes
// floodroofing@quotes.roofmap.co.nz. Zero subscriber setup, every plan, and
// a subdomain keeps the quote-mail reputation separate from the root
// domain's own mailboxes. The address is identity only — it is not a real
// mailbox, which is fine because replies follow Reply-To to the roofer.
// Off until the env var names a subdomain that is actually verified.
const TENANT_MAIL_DOMAIN = String(process.env.TENANT_MAIL_DOMAIN || '').trim().toLowerCase().replace(/^@/, '');
// A company name flattened into a mailbox name: lowercase letters and
// digits only, legal-suffix words dropped ("Hemi's Roofing Ltd" →
// hemisroofing). Too short to be meaningful → none, and the caller keeps
// the platform default.
function _tenantLocalPart(name){
  let s = ' ' + String(name || '').toLowerCase() + ' ';
  s = s.replace(/[^a-z0-9]+(limited|ltd|nz)(?=[^a-z0-9])/g, ' ');
  s = s.replace(/[^a-z0-9]+/g, '').slice(0, 30);
  return s.length >= 2 ? s : '';
}
function _resendFromAddress(addr){
  const platform = _allowedFromAddress(addr);
  if (platform) return platform;
  const a = String(addr || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) return null;
  const dom = a.slice(a.lastIndexOf('@') + 1);
  if (TENANT_MAIL_DOMAIN && dom === TENANT_MAIL_DOMAIN) return a;
  return _mailDomains.domains.has(dom) ? a : null;
}
// The address a company's outgoing mail should wear. Its own verified
// domain wins; otherwise its name on the shared tenant subdomain; otherwise
// none and the caller keeps the platform default. Company-scoped so one
// business can never ride another's verification: the map is keyed by the
// company that verified the domain, not by whatever address a caller typed.
function _tenantSendAddress(companyId, companyName, replyTo){
  if (!RESEND_ENABLED) return null;
  if (companyId) {
    _refreshMailDomains();   // fire and forget; this call reads what we have
    const own = _mailDomains.byCompany.get(String(companyId));
    if (own) return own;
  }
  // The subdomain address is identity, not a mailbox — a customer who
  // ignores Reply-To and writes to it directly would bounce. So it is only
  // worn when there IS a Reply-To to catch that customer: a business that
  // has not filled in its branding email keeps the platform address, which
  // at least reaches a monitored inbox. (A company's OWN verified domain
  // above needs no such guard — that address is their real office mailbox.)
  if (TENANT_MAIL_DOMAIN && replyTo) {
    const lp = _tenantLocalPart(companyName);
    if (lp) return lp + '@' + TENANT_MAIL_DOMAIN;
  }
  return null;
}
// Google Workspace relay (Apps Script web app that sends as office@ via
// Gmail). The fallback when Resend is not configured: it sends from the real
// address over HTTPS with no DNS work, but it is one Gmail account with a
// shared daily quota — a single-tenant pipe, not a platform one.
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
  const resp = await fetch(RESEND_API_BASE + '/domains', {
    headers: { Authorization: 'Bearer ' + RESEND_API_KEY } });
  const r = { status: resp.status, body: await resp.text() };
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
async function _gasSendMail({ to, cc, subject, text, html, attachment, fromName, replyTo, fromAddress }) {
  // The relay already took a display name and a reply-to; it was only ever
  // handed the platform's.
  const payload = {
    token: GAS_MAIL_TOKEN,
    to, cc: cc || '',
    subject, text: text || '',
    fromName: _mailFromName(fromName),
    replyTo: replyTo || EMAIL_REPLYTO || '',
  };
  // Sent as one of our own mailboxes (accounts@, support@) when asked for.
  // The Apps Script relay passes this to GmailApp as `from`, which Gmail
  // honours only for an alias the sending account actually owns — so a
  // mailbox that has not been set up as an alias simply falls back to the
  // account's own address rather than failing the send.
  const _fa = _allowedFromAddress(fromAddress);
  if (_fa) payload.from = _fa;
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
async function _resendSendMail({ to, cc, subject, text, html, attachment, fromName, replyTo, fromAddress }) {
  if (!EMAIL_FROM) throw new Error('RESEND_API_KEY is set but EMAIL_FROM is missing — add EMAIL_FROM="RoofMap <noreply@roofmap.co.nz>" (once that domain is verified in Resend → Domains).');
  const _split = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  // Their name, a verified address — Resend will not send from a domain
  // nobody has proven ownership of, and nor should it. A platform mailbox on
  // our own domain (accounts@, support@) may replace the default, and so may
  // a subscriber's address on a domain THEY have verified (_resendFromAddress
  // checks both). Anything else falls back to the platform identity.
  const _addr = _resendFromAddress(fromAddress) || _mailFromAddress();
  const from = (fromName || _resendFromAddress(fromAddress))
    ? ('"' + _mailFromName(fromName).replace(/"/g, '') + '" <' + _addr + '>')
    : EMAIL_FROM;
  const payload = { from: from, to: _split(to), subject, text };
  if (replyTo || EMAIL_REPLYTO) payload.reply_to = _split(replyTo || EMAIL_REPLYTO);
  if (html) payload.html = html;
  if (cc) payload.cc = _split(cc);
  if (attachment && attachment.base64) {
    payload.attachments = [{ filename: attachment.filename || 'order.pdf', content: attachment.base64 }];
  }
  const resp = await fetch(RESEND_API_BASE + '/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload) });
  const r = { status: resp.status, body: await resp.text() };
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
// One place that picks whichever mail transport is configured (Resend →
// Google relay → SMTP) and sends. Shared by /email/send-order and the
// customer accept-notification route so both behave identically.
// ── WHOSE NAME IS ON THE EMAIL ──────────────────────────────────────
// Every message the platform sent went out under one global address, so a
// subscriber's tax invoice reached THEIR customer from ours. For a product
// sold to roofers by a roofing company that is worse than impersonal: the
// homeowner gets an invoice for their job, apparently from a competitor.
//
// We cannot send AS the roofer. Sending from their domain needs SPF and DKIM
// on a domain we do not control, and forging it just lands in spam. What we
// can do is what every SaaS does before per-tenant domain verification: keep
// the envelope address ours, put THEIR business name on it, and point replies
// at them. The homeowner sees their roofer's name and replies to their roofer.
//
// `fromName` and `replyTo` are per-message. Platform mail — password resets,
// team invites, error alerts — passes neither and keeps the global identity,
// which is correct: those really are from us.
function _mailFromName(fallback){
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(EMAIL_FROM || '');
  return String(fallback || (m && m[1].trim()) || 'RoofMap').slice(0, 120);
}
// The bare address out of EMAIL_FROM ("Name <a@b>" → "a@b").
function _mailFromAddress(){
  const m = /<\s*([^>\s]+)\s*>/.exec(EMAIL_FROM || '');
  return (m && m[1]) || String(EMAIL_FROM || '').trim();
}
async function _dispatchMail({ to, cc, subject, text, html, attachment, fromName, replyTo, fromAddress }) {
  if (attachment && attachment.base64) {
    attachment.filename = String(attachment.filename || 'attachment.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
  }
  const subj = String(subject || '').slice(0, 300);
  const body = String(text || '');
  const htmlBody = html ? String(html) : undefined;
  // Resend first: the Google relay is ONE Gmail account with a shared daily
  // cap and one sending identity — fine for one roofing company, wrong for a
  // platform full of them. The relay stays as the fallback, so removing the
  // Resend key (or a Resend outage taking EMAIL_ENABLED paths down) degrades
  // to exactly yesterday's behaviour instead of silence.
  if (RESEND_ENABLED) {
    try {
      return await _resendSendMail({ to, cc, subject: subj, text: body, html: htmlBody, attachment, fromName, replyTo, fromAddress });
    } catch (e) {
      // A stale key or an unverified domain must not take the platform's mail
      // down while a working relay is configured. Degrade, and page about it —
      // this is a misconfiguration someone needs to fix, not a steady state.
      if (!GAS_ENABLED) throw e;
      try { recordError('server', new Error('Resend send failed, fell back to the Google relay: ' + (e && e.message)), { route: '_dispatchMail' }); } catch (e2) {}
      return _gasSendMail({ to, cc, subject: subj, text: body, html: htmlBody, attachment, fromName, replyTo, fromAddress });
    }
  } else if (GAS_ENABLED) {
    return _gasSendMail({ to, cc, subject: subj, text: body, html: htmlBody, attachment, fromName, replyTo, fromAddress });
  }
  // The display name is the tenant's; the address stays ours, because it is the
  // only one we are authorised to send from.
  const addr = _allowedFromAddress(fromAddress) || process.env.SMTP_FROM || process.env.SMTP_USER;
  const from = (fromName || _allowedFromAddress(fromAddress))
    ? ('"' + _mailFromName(fromName).replace(/"/g, '') + '" <' + addr + '>') : addr;
  const attachments = (attachment && attachment.base64)
    ? [{ filename: attachment.filename, content: Buffer.from(attachment.base64, 'base64'), contentType: 'application/pdf' }]
    : [];
  const resolved = await _resolveMailTransport();
  return resolved.transporter.sendMail({ from, to, cc: cc || undefined, subject: subj,
    text: body, html: htmlBody, attachments, replyTo: replyTo || EMAIL_REPLYTO || undefined });
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
    corsAllow: 'localhost + *.vercel.app (flood-roofing-estimator-*) + FRONTEND_URL + ' + APP_DOMAINS.join(', '),
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

// Where every emailed link points. This is deliberately NOT FRONTEND_URL:
// that variable predates the real domain and still holds the *.vercel.app
// address in Railway, which is how an invited teammate ended up signing up
// on the Vercel host instead of roofmap.co.nz. Links in emails outlive any
// deploy, so they get the canonical domain, full stop — PUBLIC_APP_URL
// exists only for staging.
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || 'https://roofmap.co.nz').replace(/\/+$/, '');

// The BUSINESS's subscription. One licence covers everyone in the company, so
// an invited teammate is already paid for and never needs a trial of their own.
// Falls back to a row keyed on the user for accounts that predate the change.
async function _companySubscription(companyId, userId){
  if (companyId){
    try {
      const { data } = await supabase.from('subscriptions').select('*')
        .eq('company_id', companyId).order('created_at', { ascending: false }).limit(1);
      if (data && data[0]) return data[0];
    } catch (e) { console.warn('[billing] company lookup failed:', e.message); }
  }
  if (!userId) return null;
  try {
    const { data } = await supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
    return data || null;
  } catch (e) { return null; }
}
// Is this business entitled to use the product right now?
//
// 'trialing' used to short-circuit to true, which meant a trial never ended:
// registration writes status 'trialing' and nothing has ever written it back,
// so the trial_ends_at date below was never reached. Harmless while billing
// was off — and a permanent free account for everybody the day it goes on.
// A trial is live until its end date and not one minute longer.
function _subscriptionLive(sub){
  if (!sub) return false;
  if (sub.status === 'active') return true;                    // paying
  if (sub.status === 'canceled' || sub.status === 'unpaid') return false;
  return _trialRemainingMs(sub) > 0;                           // trialing / past_due / anything else
}
// Milliseconds left on the trial — negative once it's over, 0 when there
// isn't one. Shared with /subscription so the app and the gate can never
// disagree about how long somebody has left.
function _trialRemainingMs(sub){
  if (!sub || !sub.trial_ends_at) return 0;
  return new Date(sub.trial_ends_at).getTime() - Date.now();
}
async function requireSubscription(req, res, next) {
  if (!BILLING_ENABLED) return next();
  try {
    const sub = await _companySubscription(req.companyId, req.user.id);
    if (!sub) return res.status(403).json({ error: 'No subscription found', code: 'SUBSCRIPTION_REQUIRED' });
    if (!_subscriptionLive(sub)) return res.status(403).json({ error: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED' });
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// Where a business stands: what it's on, and how long it has. The app has had
// no way to ask this, which is why a trial could run out with no warning — the
// first anybody knew was a 403 on a job save.
app.get('/subscription', requireAuth, async (req, res) => {
  const sub = await _companySubscription(req.companyId, req.user.id);
  const ms = _trialRemainingMs(sub);
  const onTrial = !!(sub && sub.status !== 'active' && sub.trial_ends_at);
  res.json({
    status: (sub && sub.status) || 'none',
    billing: BILLING_ENABLED,        // false = the gate is open regardless
    live: !BILLING_ENABLED || _subscriptionLive(sub),
    trial: !onTrial ? null : {
      ends_at: sub.trial_ends_at,
      // Round UP: with 6 hours left a roofer should read "1 day", not "0".
      days_left: Math.max(0, Math.ceil(ms / 864e5)),
      expired: ms <= 0,
    },
    plan: await _planOf(req.companyId),
    // Which plans have a yearly price configured — the billing screen offers
    // the two-months-free toggle only when there is something to buy.
    annual: {
      solo:     !!STRIPE_PRICES_ANNUAL.solo,
      team:     !!STRIPE_PRICES_ANNUAL.team,
      business: !!STRIPE_PRICES_ANNUAL.business,
    },
  });
});

// ══════════════════════════════════════════════════════════════════
// PLANS — what each tier actually includes
// ══════════════════════════════════════════════════════════════════
// The boundaries here are the ones the pricing page sells, and they are
// checked on the SERVER: a limit enforced only by a hidden button is not a
// limit. A trial gets everything, so a business can judge the whole product
// before choosing — and so that every account that predates plans keeps
// working unchanged.
const PLANS = {
  trial:    { label: 'Trial',    seats: Infinity, slug: true,  domain: true,  jms: true,  activity: true,  reminders: true,  maildomain: true  },
  solo:     { label: 'Solo',     seats: 1,        slug: false, domain: false, jms: false, activity: false, reminders: false, maildomain: false },
  team:     { label: 'Team',     seats: 5,        slug: true,  domain: false, jms: false, activity: true,  reminders: true,  maildomain: true  },
  business: { label: 'Business', seats: Infinity, slug: true,  domain: true,  jms: true,  activity: true,  reminders: true,  maildomain: true  },
};
function _limitsFor(plan){ return PLANS[String(plan || '').toLowerCase()] || PLANS.trial; }
// Cached briefly so a per-request plan check isn't a per-request query. The
// cost is that a plan change (a Stripe webhook, say) takes up to this long to
// bite, which is fine for an upgrade and acceptable for a downgrade.
// PLAN_CACHE_MS=0 turns it off, which is what the tests do so they can move a
// company between plans and see it immediately.
const PLAN_CACHE_MS = process.env.PLAN_CACHE_MS != null ? Number(process.env.PLAN_CACHE_MS) : 60000;
const _planCache = new Map();   // companyId → { at, plan }
async function _planOf(companyId){
  if (!companyId) return 'trial';
  const hit = _planCache.get(companyId);
  if (hit && PLAN_CACHE_MS > 0 && Date.now() - hit.at < PLAN_CACHE_MS) return hit.plan;
  let plan = 'trial';
  try {
    const { data } = await supabase.from('companies').select('plan').eq('id', companyId).maybeSingle();
    if (data && data.plan) plan = data.plan;
  } catch (e) { /* column not migrated yet — treat as trial */ }
  _planCache.set(companyId, { at: Date.now(), plan: plan });
  return plan;
}
// How many seats a business is using: people in it, plus invitations still
// outstanding. Counting only accepted members would let an owner invite ten
// people onto a five-seat plan and have them all land.
async function _seatsUsed(companyId){
  let members = 0, pending = 0;
  try {
    const { data } = await supabase.from('company_users').select('user_id').eq('company_id', companyId);
    members = (data || []).length;
  } catch (e) {}
  try {
    const { data } = await supabase.from('company_invites').select('expires_at')
      .eq('company_id', companyId).is('accepted_at', null);
    pending = (data || []).filter(function (i) { return new Date(i.expires_at) > new Date(); }).length;
  } catch (e) {}
  return { members: members, pending: pending, total: members + pending };
}
function _planBlocked(res, what, needs){
  return res.status(403).json({
    error: what + ' isn\'t included on your plan — ' + needs + ' covers it.',
    code: 'PLAN_LIMIT', needs: needs,
  });
}
// Gate a whole route on a plan capability.
function requirePlan(capability, what, needs){
  return async function (req, res, next) {
    try {
      const lim = _limitsFor(await _planOf(req.companyId));
      if (!lim[capability]) return _planBlocked(res, what, needs);
      next();
    } catch (e) { next(); }   // never let the check itself lock someone out
  };
}

// ══════════════════════════════════════════════════════════════════
// TEAM — a business invites its OWN staff
// ══════════════════════════════════════════════════════════════════
// Someone's role in their company. 'owner' can invite, remove and rename;
// 'member' can do the work but not change who's in the business.
async function _roleOf(userId){
  if (!userId) return '';
  try {
    const { data } = await supabase.from('company_users').select('role').eq('user_id', userId).maybeSingle();
    return (data && data.role) || '';
  } catch (e) { return ''; }
}
async function requireOwner(req, res, next){
  if (!req.companyId) return res.status(403).json({ error: 'You are not part of a company yet.' });
  const role = await _roleOf(req.user.id);
  if (role !== 'owner') return res.status(403).json({ error: 'Only the account owner can change who is in the business.', code: 'OWNER_ONLY' });
  req.role = role;
  next();
}
// The business's address on RoofMap: <slug>.roofmap.co.nz. Lowercase letters,
// digits and dashes only, and not one of the hostnames the product itself uses
// — "www.roofmap.co.nz" must never belong to a subscriber.
const SLUG_RESERVED = ['www', 'app', 'api', 'admin', 'quote', 'quotes', 'mail', 'support',
                       'help', 'blog', 'status', 'staging', 'dev', 'test', 'roofmap', 'office'];
function _normSlug(v){
  const t = String(v == null ? '' : v).trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(t)) return '';
  if (t.indexOf('--') >= 0) return '';
  if (SLUG_RESERVED.indexOf(t) >= 0) return '';
  return t;
}
async function _slugTaken(slug, exceptCompanyId){
  try {
    const { data } = await supabase.from('companies').select('id, slug').ilike('slug', slug);
    return (data || []).some(function (c) { return String(c.id) !== String(exceptCompanyId || ''); });
  } catch (e) { return false; }
}
const _sha256 = (v) => require('crypto').createHash('sha256').update(String(v)).digest('hex');
// The business, as the app needs to know it at sign-in: its name, its RoofMap
// address (which quote links are built from) and the caller's role (which
// decides whether the Team screen is read-only).
async function _companyBrief(cid, userId){
  if (!cid) return null;
  try {
    const { data } = await supabase.from('companies').select('id, name, slug').eq('id', cid).maybeSingle();
    const brief = data || { id: cid };
    brief.role = await _roleOf(userId);
    // The business's own verified domain, if it has one — quote links prefer it
    // over the roofmap.co.nz address.
    try {
      const { data: doms } = await supabase.from('company_domains').select('domain')
        .eq('company_id', cid).eq('status', 'verified').limit(1);
      brief.domain = (doms && doms[0] && doms[0].domain) || '';
    } catch (e) { brief.domain = ''; }
    // The plan, so the app can shape itself to it without another round trip.
    try {
      const plan = await _planOf(cid);
      const lim = _limitsFor(plan);
      brief.plan = plan;
      brief.limits = { seats: lim.seats === Infinity ? null : lim.seats, slug: !!lim.slug, domain: !!lim.domain, jms: !!lim.jms };
    } catch (e) {}
    return brief;
  } catch (e) { return { id: cid, role: '' }; }
}

// Everything the Team screen needs in one call.
app.get('/team', requireAuth, async (req, res) => {
  if (!req.companyId) return res.json({ company: null, me: { id: req.user.id, role: '' }, members: [], invites: [] });
  try {
    const [{ data: co }, { data: links }, { data: profs }] = await Promise.all([
      supabase.from('companies').select('id, name, slug').eq('id', req.companyId).maybeSingle(),
      supabase.from('company_users').select('user_id, role').eq('company_id', req.companyId),
      supabase.from('profiles').select('id, name, email').eq('company_id', req.companyId),
    ]);
    const byId = {}; (profs || []).forEach(function (p) { byId[p.id] = p; });
    const members = (links || []).map(function (l) {
      const p = byId[l.user_id] || {};
      return { id: l.user_id, role: l.role || 'member', name: p.name || '', email: p.email || '', you: l.user_id === req.user.id };
    });
    let invites = [];
    try {
      const { data } = await supabase.from('company_invites')
        .select('id, email, role, created_at, expires_at, accepted_at')
        .eq('company_id', req.companyId).is('accepted_at', null);
      invites = (data || []).filter(function (i) { return new Date(i.expires_at) > new Date(); });
    } catch (e) { /* table not migrated yet — show the members we have */ }
    const plan = await _planOf(req.companyId);
    const lim = _limitsFor(plan);
    const seats = { used: members.length + invites.length, allowed: lim.seats === Infinity ? null : lim.seats };
    res.json({
      company: co || { id: req.companyId },
      me: { id: req.user.id, role: await _roleOf(req.user.id) },
      members, invites,
      plan: { id: plan, label: lim.label, seats: seats,
              slug: !!lim.slug, domain: !!lim.domain, jms: !!lim.jms },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Invite a teammate. The token is emailed; only its hash is stored, so the
// invite can be revoked and a leaked database can't be used to join.
app.post('/team/invites', requireAuth, requireOwner, rateLimit(20, 3600000), async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const role = (req.body && req.body.role) === 'owner' ? 'owner' : 'member';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That doesn\'t look like an email address.' });
  try {
    const { data: existing } = await supabase.from('profiles').select('id, company_id').eq('email', email).maybeSingle();
    if (existing && String(existing.company_id) === String(req.companyId))
      return res.status(400).json({ error: 'They are already in your business.' });
    const lim = _limitsFor(await _planOf(req.companyId));
    if (lim.seats !== Infinity) {
      const seats = await _seatsUsed(req.companyId);
      if (seats.total >= lim.seats) {
        return res.status(403).json({
          error: 'Your plan covers ' + lim.seats + (lim.seats === 1 ? ' person' : ' people') +
                 ' and you have ' + seats.total + ' (' + seats.members + ' in the business, ' +
                 seats.pending + ' invited). Upgrade to add more.',
          code: 'PLAN_SEATS', seats: seats, allowed: lim.seats,
        });
      }
    }
    const raw = require('crypto').randomBytes(32).toString('hex');
    const row = { company_id: req.companyId, email: email, role: role, token_hash: _sha256(raw), created_by: req.user.id };
    const { data, error } = await supabase.from('company_invites').insert(row).select('id, email, role, created_at, expires_at').single();
    if (error) return res.status(500).json({ error: error.message });
    const link = PUBLIC_APP_URL + '/?invite=' + encodeURIComponent(raw);
    const { data: co } = await supabase.from('companies').select('name').eq('id', req.companyId).maybeSingle();
    const coName = (co && co.name) || 'your team';
    const who = req.user.email || 'a colleague';
    let emailed = false;
    try {
      await _dispatchMail({
        to: email,
        subject: 'You have been added to ' + coName + ' on RoofMap',
        text: who + ' has invited you to join ' + coName + ' on RoofMap.\n\n' +
              'Open this link to set your password and get started (it works for 14 days):\n' + link + '\n\n' +
              'If you weren\'t expecting this, you can ignore this email.',
        html: '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;color:#1c2733;line-height:1.6">' +
              '<p><strong>' + who + '</strong> has invited you to join <strong>' + coName + '</strong> on RoofMap.</p>' +
              '<p><a href="' + link + '" style="display:inline-block;background:#0a1628;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600">Set your password</a></p>' +
              '<p style="color:#667">The link works for 14 days. If you weren\'t expecting this, ignore this email.</p></div>',
      });
      emailed = true;
    } catch (e) { console.warn('[team] invite email failed (link still valid):', e.message); }
    // The link comes back either way — if email isn't configured the owner can
    // still hand it over, rather than the invite silently going nowhere.
    res.json({ invite: data, link: link, emailed: emailed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/team/invites/:id', requireAuth, requireOwner, async (req, res) => {
  try {
    const { error } = await supabase.from('company_invites').delete()
      .eq('id', req.params.id).eq('company_id', req.companyId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove someone. Their JOBS stay with the business — they always belonged to
// the company, not to them — so nothing is lost when a person leaves.
app.delete('/team/members/:userId', requireAuth, requireOwner, async (req, res) => {
  const target = req.params.userId;
  if (target === req.user.id) return res.status(400).json({ error: 'You can\'t remove yourself.' });
  try {
    const { data: links } = await supabase.from('company_users').select('user_id, role').eq('company_id', req.companyId);
    const row = (links || []).find(function (l) { return l.user_id === target; });
    if (!row) return res.status(404).json({ error: 'They are not in your business.' });
    const owners = (links || []).filter(function (l) { return l.role === 'owner'; });
    if (row.role === 'owner' && owners.length <= 1)
      return res.status(400).json({ error: 'That is the only owner — make someone else an owner first.' });
    await supabase.from('company_users').delete().eq('company_id', req.companyId).eq('user_id', target);
    await supabase.from('profiles').update({ company_id: null }).eq('id', target);
    _companyCache.delete(target);
    _membersCache.delete(req.companyId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/team/members/:userId/role', requireAuth, requireOwner, async (req, res) => {
  const role = (req.body && req.body.role) === 'owner' ? 'owner' : 'member';
  const target = req.params.userId;
  try {
    const { data: links } = await supabase.from('company_users').select('user_id, role').eq('company_id', req.companyId);
    const row = (links || []).find(function (l) { return l.user_id === target; });
    if (!row) return res.status(404).json({ error: 'They are not in your business.' });
    const owners = (links || []).filter(function (l) { return l.role === 'owner'; });
    if (row.role === 'owner' && role !== 'owner' && owners.length <= 1)
      return res.status(400).json({ error: 'A business needs at least one owner.' });
    const { error } = await supabase.from('company_users').update({ role: role })
      .eq('company_id', req.companyId).eq('user_id', target);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, role: role });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// The business's RoofMap address.
app.get('/team/slug-available', requireAuth, async (req, res) => {
  const slug = _normSlug(req.query.slug);
  if (!slug) return res.json({ slug: '', ok: false, reason: 'invalid' });
  const taken = await _slugTaken(slug, req.companyId);
  res.json({ slug: slug, ok: !taken, reason: taken ? 'taken' : '' });
});
app.post('/team/slug', requireAuth, requireOwner,
  requirePlan('slug', 'Your own RoofMap address', 'Team'), async (req, res) => {
  const slug = _normSlug(req.body && req.body.slug);
  if (!slug) return res.status(400).json({ error: 'Use 3–30 letters, numbers or dashes — and not a name RoofMap reserves.' });
  if (await _slugTaken(slug, req.companyId)) return res.status(409).json({ error: 'Another business already has that address.' });
  try {
    const { error } = await supabase.from('companies').update({ slug: slug }).eq('id', req.companyId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, slug: slug });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// What an invite link points at — shown before the invitee commits to anything.
app.get('/auth/invite/:token', rateLimit(30, 900000), async (req, res) => {
  try {
    const { data } = await supabase.from('company_invites')
      .select('id, company_id, email, role, expires_at, accepted_at')
      .eq('token_hash', _sha256(req.params.token)).maybeSingle();
    if (!data || data.accepted_at || new Date(data.expires_at) <= new Date())
      return res.status(404).json({ error: 'This invitation has expired or already been used.' });
    const { data: co } = await supabase.from('companies').select('name').eq('id', data.company_id).maybeSingle();
    res.json({ email: data.email, role: data.role, company: (co && co.name) || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Accept an invitation: join THAT company. No trial is created — the business
// already has one subscription and it covers everybody in it.
app.post('/auth/accept-invite', rateLimit(10, 900000), async (req, res) => {
  const { token, password, name } = req.body || {};
  if (!token || !password || String(password).length < 8)
    return res.status(400).json({ error: 'An invitation link and a password of at least 8 characters are required.' });
  try {
    const { data: inv } = await supabase.from('company_invites')
      .select('*').eq('token_hash', _sha256(token)).maybeSingle();
    if (!inv || inv.accepted_at || new Date(inv.expires_at) <= new Date())
      return res.status(401).json({ error: 'This invitation has expired or already been used.' });
    // Re-checked here, not just at invite time: an invitation is good for 14
    // days, and a business can downgrade in between. Without this, a plan could
    // be quietly exceeded by an old link being clicked.
    const lim = _limitsFor(await _planOf(inv.company_id));
    if (lim.seats !== Infinity) {
      const { data: mem } = await supabase.from('company_users').select('user_id').eq('company_id', inv.company_id);
      if ((mem || []).length >= lim.seats) {
        return res.status(403).json({
          error: 'That business has filled every seat on its plan. Ask them to upgrade, then use this link again.',
          code: 'PLAN_SEATS',
        });
      }
    }
    const email = String(inv.email).toLowerCase();
    let userId = null;
    const { data: existing } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
    if (existing) {
      // Already has a RoofMap login — set the password they just chose and move
      // them into this business rather than refusing and stranding the invite.
      userId = existing.id;
      await supabase.auth.admin.updateUserById(userId, { password: String(password) });
    } else {
      const { data, error } = await supabase.auth.admin.createUser({ email, password: String(password), email_confirm: true });
      if (error) return res.status(400).json({ error: error.message });
      userId = data.user.id;
      await supabase.from('profiles').insert({ id: userId, email, name: String(name || '').slice(0, 120) });
    }
    await supabase.from('company_users').delete().eq('user_id', userId);
    await supabase.from('company_users').insert({ company_id: inv.company_id, user_id: userId, role: inv.role || 'member' });
    await supabase.from('profiles').update({ company_id: inv.company_id }).eq('id', userId);
    await supabase.from('company_invites').update({ accepted_at: new Date().toISOString(), accepted_by: userId }).eq('id', inv.id);
    _companyCache.set(userId, inv.company_id);
    _membersCache.delete(inv.company_id);
    const authToken = jwt.sign({ id: userId, email, cid: inv.company_id }, JWT_SECRET, { expiresIn: '30d' });
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    const sub = await _companySubscription(inv.company_id, userId);
    res.json({ token: authToken, user: profile || { id: userId, email }, subscription: sub, company: await _companyBrief(inv.company_id, userId) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// CUSTOM DOMAINS — a subscriber points its own domain at RoofMap
// ══════════════════════════════════════════════════════════════════
// Registering the domain with Vercel is something only we can do (it needs our
// project token), so the subscriber types the domain, we register it, and they
// just add one DNS record at their registrar. Without this the owner has to ask
// us to do it by hand, which is not self-onboarding.
// Verified subscriber domains, held in memory so the CORS check — which is
// synchronous — can consult them without a database round-trip per request.
// A domain only lands here after an owner added it AND Vercel confirmed they
// control it, so it is a legitimate origin for their own office app, not just
// for the customer quote page.
const _verifiedDomains = { at: 0, set: new Set(), loading: false };
// Reload NOW and wait for it. Called after a domain is added, verified or
// removed so the new state is in place before the response goes back — a lazy
// refresh would have blocked the very first request from a domain that had
// just verified, which is exactly when someone is watching.
async function _reloadVerifiedDomains(){
  try {
    const { data, error } = await supabase.from('company_domains').select('domain').eq('status', 'verified');
    if (error) return;
    _verifiedDomains.set = new Set((data || []).map(function (d) { return String(d.domain || '').toLowerCase(); }));
    _verifiedDomains.at = Date.now();
  } catch (e) { console.warn('[domains] verified reload failed:', e.message); }
}
function _refreshVerifiedDomains(){
  if (_verifiedDomains.loading) return;
  if (Date.now() - _verifiedDomains.at < 5 * 60 * 1000) return;
  _verifiedDomains.loading = true;
  _reloadVerifiedDomains().then(function () { _verifiedDomains.loading = false; });
}
function _isVerifiedCompanyDomain(host){
  _refreshVerifiedDomains();   // fire and forget; this call reads what we have
  if (_verifiedDomains.set.has(host)) return true;
  // A verified apex also covers the www of it, which is how people type them.
  if (host.indexOf('www.') === 0 && _verifiedDomains.set.has(host.slice(4))) return true;
  return false;
}

const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'flood-roofing-estimator';
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || '';
// The CNAME target Vercel wants for a subdomain. Kept as an env var rather than
// hardcoded because Vercel has changed it before and a redeploy shouldn't be
// needed to correct what subscribers are told.
const VERCEL_CNAME_TARGET = process.env.VERCEL_CNAME_TARGET || 'cname.vercel-dns.com';
const VERCEL_APEX_IP = process.env.VERCEL_APEX_IP || '76.76.21.21';
const VERCEL_API = process.env.VERCEL_API || 'https://api.vercel.com';
const DOMAINS_ENABLED = !!VERCEL_TOKEN;

async function _vercel(method, path, body){
  const sep = path.indexOf('?') >= 0 ? '&' : '?';
  const url = VERCEL_API + path + (VERCEL_TEAM_ID ? (sep + 'teamId=' + encodeURIComponent(VERCEL_TEAM_ID)) : '');
  const r = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + VERCEL_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  return { ok: r.ok, status: r.status, data: data };
}
function _vercelErr(r){
  return (r && r.data && r.data.error && r.data.error.message) || (r && r.data && r.data.message) || ('Vercel returned ' + (r && r.status));
}
// Normalised to a bare hostname. An apex (acme.co.nz) and a subdomain
// (quote.acme.co.nz) need different DNS records, so which one it is matters.
function _normHost(v){
  let t = String(v == null ? '' : v).trim().toLowerCase();
  if (!t) return '';
  if (t.indexOf('://') >= 0) { try { t = new URL(t).hostname; } catch (e) { return ''; } }
  t = t.replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(t)) return '';
  if (t.length > 253) return '';
  // Our own domains are not up for grabs.
  if (APP_DOMAINS.some(function (d) { return t === d || t.endsWith('.' + d); })) return '';
  return t;
}
// Is this the domain itself, or a subdomain of it? It decides which DNS record
// the subscriber is told to add, and "count the dots" gets New Zealand wrong:
// acmeroofing.co.nz is an apex with three labels, not a subdomain. These are
// the second-level suffixes a NZ/AU/UK roofing company actually registers under.
const MULTI_PART_TLDS = [
  'co.nz','net.nz','org.nz','govt.nz','ac.nz','school.nz','geek.nz','kiwi.nz','maori.nz','iwi.nz',
  'com.au','net.au','org.au','id.au','co.uk','org.uk','me.uk','ltd.uk','plc.uk',
  'co.za','com.sg','co.in','com.br','co.jp',
];
function _isApex(host){
  const parts = String(host || '').split('.');
  if (parts.length <= 2) return true;
  if (parts.length === 3 && MULTI_PART_TLDS.indexOf(parts.slice(1).join('.')) >= 0) return true;
  return false;
}
// The one record the subscriber has to add, in plain terms.
function _dnsInstruction(host){
  if (_isApex(host)) return { type: 'A', name: '@', value: VERCEL_APEX_IP };
  const parts = String(host).split('.');
  return { type: 'CNAME', name: parts[0], value: VERCEL_CNAME_TARGET };
}
// Ask Vercel where a domain stands. Anything unexpected is reported as "not
// ready yet" with Vercel's own words attached, rather than throwing.
async function _vercelDomainStatus(host){
  const out = { verified: false, misconfigured: true, verification: [], error: '' };
  try {
    const v = await _vercel('POST', '/v9/projects/' + encodeURIComponent(VERCEL_PROJECT_ID) + '/domains/' + encodeURIComponent(host) + '/verify');
    if (v.ok && v.data && v.data.verified) out.verified = true;
    else if (v.data && v.data.verification) out.verification = v.data.verification;
    else if (!v.ok) out.error = _vercelErr(v);
  } catch (e) { out.error = e.message; }
  try {
    const c = await _vercel('GET', '/v6/domains/' + encodeURIComponent(host) + '/config');
    if (c.ok && c.data) out.misconfigured = !!c.data.misconfigured;
  } catch (e) { /* config is advisory — verify is what decides */ }
  return out;
}
function _domainRow(d){
  return {
    id: d.id, domain: d.domain, status: d.status,
    verification: d.verification || null, error: d.last_error || '',
    dns: _dnsInstruction(d.domain),
    created_at: d.created_at, verified_at: d.verified_at,
  };
}

app.get('/team/domains', requireAuth, async (req, res) => {
  if (!req.companyId) return res.json({ enabled: DOMAINS_ENABLED, domains: [] });
  try {
    const { data } = await supabase.from('company_domains').select('*')
      .eq('company_id', req.companyId).order('created_at', { ascending: true });
    res.json({ enabled: DOMAINS_ENABLED, domains: (data || []).map(_domainRow) });
  } catch (e) { res.json({ enabled: DOMAINS_ENABLED, domains: [] }); }
});

// Claim a domain: register it with Vercel and hand back the record to add.
app.post('/team/domains', requireAuth, requireOwner,
  requirePlan('domain', 'Connecting your own domain', 'Business'), rateLimit(20, 3600000), async (req, res) => {
  if (!DOMAINS_ENABLED) return res.status(503).json({ error: 'Custom domains are not switched on yet.', code: 'DOMAINS_DISABLED' });
  const host = _normHost(req.body && req.body.domain);
  if (!host) return res.status(400).json({ error: 'Enter a domain like quote.yourcompany.co.nz.' });
  try {
    const { data: claimed } = await supabase.from('company_domains').select('id, company_id').ilike('domain', host);
    if ((claimed || []).some(function (c) { return String(c.company_id) !== String(req.companyId); }))
      return res.status(409).json({ error: 'That domain is already connected to another RoofMap account.' });
    if ((claimed || []).length) return res.status(400).json({ error: 'You have already added that domain.' });
    const add = await _vercel('POST', '/v10/projects/' + encodeURIComponent(VERCEL_PROJECT_ID) + '/domains', { name: host });
    // 409 = already on the project (a retry, or left over from a removal we
    // didn't see) — that's fine, carry on and let verification decide.
    if (!add.ok && add.status !== 409) return res.status(400).json({ error: _vercelErr(add) });
    const verified = !!(add.data && add.data.verified);
    const row = {
      company_id: req.companyId, domain: host, created_by: req.user.id,
      status: verified ? 'verified' : 'pending',
      verification: (add.data && add.data.verification) || null,
      verified_at: verified ? new Date().toISOString() : null,
      last_checked_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('company_domains').insert(row).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    await _reloadVerifiedDomains();
    res.json({ domain: _domainRow(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// "I've added the record" — re-check with Vercel.
app.post('/team/domains/:id/verify', requireAuth, requireOwner, rateLimit(60, 3600000), async (req, res) => {
  if (!DOMAINS_ENABLED) return res.status(503).json({ error: 'Custom domains are not switched on yet.' });
  try {
    const { data: row } = await supabase.from('company_domains').select('*')
      .eq('id', req.params.id).eq('company_id', req.companyId).maybeSingle();
    if (!row) return res.status(404).json({ error: 'Domain not found.' });
    const st = await _vercelDomainStatus(row.domain);
    const ready = st.verified && !st.misconfigured;
    const patch = {
      status: ready ? 'verified' : 'pending',
      verification: st.verification && st.verification.length ? st.verification : null,
      last_error: ready ? null : (st.error || (st.misconfigured ? 'The DNS record isn\'t visible yet. It can take a few minutes — up to 24 hours on some registrars.' : '')),
      last_checked_at: new Date().toISOString(),
      verified_at: ready ? (row.verified_at || new Date().toISOString()) : null,
    };
    const { data } = await supabase.from('company_domains').update(patch).eq('id', row.id).select('*').single();
    await _reloadVerifiedDomains();
    res.json({ domain: _domainRow(data || Object.assign({}, row, patch)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/team/domains/:id', requireAuth, requireOwner, async (req, res) => {
  try {
    const { data: row } = await supabase.from('company_domains').select('*')
      .eq('id', req.params.id).eq('company_id', req.companyId).maybeSingle();
    if (!row) return res.status(404).json({ error: 'Domain not found.' });
    if (DOMAINS_ENABLED) {
      // Best effort — if Vercel refuses, still let go of it our side rather
      // than leaving the owner stuck with a domain they can't remove.
      try { await _vercel('DELETE', '/v9/projects/' + encodeURIComponent(VERCEL_PROJECT_ID) + '/domains/' + encodeURIComponent(row.domain)); }
      catch (e) { console.warn('[domains] Vercel removal failed:', e.message); }
    }
    await supabase.from('company_domains').delete().eq('id', row.id);
    await _reloadVerifiedDomains();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Registration creates a company and starts a trial, and sends mail. Teams
// arrive through /auth/accept-invite rather than here, so a human never needs
// more than a handful an hour.
app.post('/auth/register', rateLimit(5, 3600000), async (req, res) => {
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
    // Registering ALWAYS creates your own business. Joining an existing one
    // happens only through a per-company invitation (POST /team/invites →
    // /auth/accept-invite), which is what makes self-onboarding possible:
    // INVITE_COMPANY_ID could only ever name ONE company, so every person who
    // signed up with the shared code landed in that same business — fine while
    // there was one, wrong the moment RoofMap has subscribers.
    const cid = await _companyOf(userId);
    // No trial. Registration is invite-gated — by the time somebody reaches this
    // line we have read their waitlist entry and decided they are a fit, so a
    // fortnight's grace is a stranger-mechanism applied to somebody we already
    // know. It also had a cliff in it: set up the price book, get busy on the
    // tools, and the account died on day 15 without anybody noticing.
    //
    // 'pending' has no trial_ends_at, so _trialRemainingMs returns 0 and
    // _subscriptionLive is false — the existing gate handles this with no
    // change. requireSubscription covers POST /jobs and the integrations but
    // NOT GET /jobs, so a pending account can log in, run the tutorial and read
    // the worked demo job. The wall lands where it should: on keeping a roof.
    //
    // Accounts already mid-trial keep their trial_ends_at and run it out. This
    // changes what new businesses get, not what existing ones were promised.
    const subRow = { user_id: userId, company_id: cid || null, status: 'pending', trial_ends_at: null };
    let { error: serr } = await supabase.from('subscriptions').insert(subRow);
    if (serr && /company_id/.test(serr.message || '')) {
      delete subRow.company_id;   // column not migrated yet
      ({ error: serr } = await supabase.from('subscriptions').insert(subRow));
    }
    if (serr) console.warn('[auth] subscription row insert failed:', serr.message);
    const token = jwt.sign({ id: userId, email, cid }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: userId, email, name, company, company_id: cid }, company: await _companyBrief(cid, userId) });
    recordUsage('signed_up', { companyId: cid, user: { id: userId } });
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
    const link = PUBLIC_APP_URL + '/?reset=' + encodeURIComponent(t);
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
    res.json({ token: authToken, user: profile || { id: payload.id, email: payload.email }, company: await _companyBrief(cid, payload.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Two limits, both of which must pass: 20 attempts per address per 15 minutes
// stops a single machine grinding, and 10 per email per 15 minutes stops a
// distributed attempt at one account. Neither reveals whether the account
// exists — a 429 comes back the same either way.
app.post('/auth/login', rateLimit(20, 900000), rateLimit(10, 900000, _emailKey), async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid email or password' });
    const userId = data.user.id;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    const cid = await _companyOf(userId);
    const sub = await _companySubscription(cid, userId);
    const token = jwt.sign({ id: userId, email, cid }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { ...profile, company_id: cid }, subscription: sub, company: await _companyBrief(cid, userId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/auth/me', requireAuth, async (req, res) => {
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
  const sub = await _companySubscription(req.companyId, req.user.id);
  res.json({ user: profile, subscription: sub, company: await _companyBrief(req.companyId, req.user.id) });
});

// The old "Billing not configured yet" stubs lived here — the real
// /billing/checkout, /billing/portal and /billing/webhook are in the
// STRIPE section further down. (The stubs answered first and made the
// real routes unreachable.)

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
  // .select('id') so we can tell a real update from a scope that matched no
  // rows. Without it this answered ok:true — and handed back a stamp — for a
  // job belonging to someone else, telling the office an order had been marked
  // sent when nothing was written.
  let { data, error } = await _scopeCompany(supabase.from('jobs')
    .update({ order_sent: stamp, status: 'ordered', updated_at: stamp.at }).eq('id', req.params.id), req).select('id');
  if (error && /order_sent/.test(error.message || '')) {
    ({ data, error } = await _scopeCompany(supabase.from('jobs')
      .update({ status: 'ordered', updated_at: stamp.at }).eq('id', req.params.id), req).select('id'));
  }
  if (error) return res.status(500).json({ error: error.message });
  if (!data || !data.length) return res.status(404).json({ error: 'Job not found' });
  res.json({ ok: true, order_sent: Object.assign({}, stamp, { by_name: await _nameOf(req.user.id, req) }) });
  recordUsage('order_sent', req);
});

// The job number a save is carrying, which lives inside the quote.
function _jobRefOf(drawState){
  try { return String(((drawState || {}).state || {}).quote.ref || '').trim(); } catch (e) { return ''; }
}

// Creating a job is where duplicates are born: a save that has lost track of
// which job it was editing arrives with no id, so it becomes a SECOND record
// carrying the same job number. You only notice later — a quote link dies, or
// a search for the number returns two hits, and the work looks lost even
// though it isn't. If the number is already in use, refuse and hand back the
// job that has it, so the app can offer to open that one instead. A deliberate
// second record is still possible with allowDuplicateRef.
app.post('/jobs', requireAuth, requireSubscription, async (req, res) => {
  const { client_name, site_address, draw_state, settings } = req.body;
  const ref = _jobRefOf(draw_state);
  if (ref && !(req.body && req.body.allowDuplicateRef)) {
    try {
      const { data: clash } = await _scopeCompany(supabase.from('jobs')
        .select('id, client_name, site_address, updated_at')
        .eq('draw_state->state->quote->>ref', ref), req).limit(1);
      if (clash && clash[0]) {
        return res.status(409).json({
          error: 'Job ' + ref + ' already exists.',
          code: 'DUPLICATE_JOB_NO',
          jobNo: ref,
          existing: clash[0],
        });
      }
    } catch (e) {
      // A failed check must not block saving — losing the save would be worse
      // than the duplicate this is trying to prevent.
      console.warn('[jobs] duplicate-number check failed, allowing save:', e.message);
    }
  }
  // Light columns for the same reason as the PUT: the caller wants the new id
  // and the labels, not the drawing it just uploaded sent straight back.
  const { data, error } = await supabase.from('jobs').insert({ user_id: req.user.id, company_id: req.companyId || null, client_name: client_name || '', site_address: site_address || '', draw_state: draw_state || {}, settings: settings || {}, status: 'draft' }).select(JOB_LIGHT_COLS).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(_jobLight(data));
  recordUsage('job_saved', req);
});

// What a save actually needs back. The old .select() returned the WHOLE row,
// so every save shipped the multi-MB draw_state — aerial, site photos and all
// — back down the wire for nothing: the two callers use id, the labels and the
// timestamp, and already hold the drawing they just sent. Naming the columns
// is most of the fix.
const JOB_LIGHT_COLS = 'id, user_id, client_name, site_address, status, order_sent, created_at, updated_at';
// Everything a client is allowed to write. Anything else in the body is
// dropped rather than passed through to SQL.
const JOB_WRITABLE = ['client_name','site_address','draw_state','settings','status','order_sent','updated_at'];
const JOB_JSON_COLS = { draw_state:1, settings:1, order_sent:1 };

// Whatever the row came back as, only these columns leave the building. The
// .select() below already asks for them, but a projection here makes it true
// of every path — including any future one that forgets.
function _jobLight(row){
  if (!row || typeof row !== 'object') return row;
  const out = {};
  JOB_LIGHT_COLS.split(',').forEach(k => { k = k.trim(); if (k in row) out[k] = row[k]; });
  return out;
}

app.put('/jobs/:id', requireAuth, async (req, res) => {
  // Build the patch from the WHITELIST, not from the body. Filtering a copy
  // and then sending the original is how a stray key reaches SQL.
  // A whole-job save carries the quote inside draw_state — keep the durable
  // token→job map current so the customer link resolves by primary key.
  try {
    const _tk = req.body && req.body.draw_state && req.body.draw_state.state &&
                req.body.draw_state.state.quote && req.body.draw_state.state.quote.share &&
                req.body.draw_state.state.quote.share.token;
    if (_tk) _tokenCachePut(String(_tk), req.params.id);
  } catch (e) {}
  const patch = {};
  Object.keys(req.body || {}).forEach(k => { if (JOB_WRITABLE.indexOf(k) >= 0) patch[k] = req.body[k]; });
  delete patch.updated_at;                       // ours to set, not theirs to claim
  const cols = Object.keys(patch);
  // A save with nothing in it but a new timestamp is a caller bug worth
  // hearing about, not a row to touch.
  if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });
  patch.updated_at = new Date().toISOString();
  cols.push('updated_at');

  // A job row runs to tens of MB once site photos and the aerial land in
  // draw_state, and the PostgREST role carries Supabase's 8-second
  // statement_timeout — which is how SAVING a big job produced "canceling
  // statement due to statement timeout". GET already went round this; the
  // write did not. The direct connection has no such ceiling, and the WHERE
  // mirrors _scopeCompany exactly.
  const pool = _pgPool();
  if (pool) {
    try {
      const vals = cols.map(k => JOB_JSON_COLS[k] ? JSON.stringify(patch[k] == null ? null : patch[k]) : patch[k]);
      const sets = cols.map((k, i) => '"' + k + '" = $' + (i + 1) + (JOB_JSON_COLS[k] ? '::jsonb' : ''));
      const p = vals.slice();
      let where;
      if (req.companyId) {
        p.push(req.params.id, req.companyId, req.user.id);
        where = 'id = $' + (p.length - 2) + ' and (company_id = $' + (p.length - 1) +
                ' or (company_id is null and user_id = $' + p.length + '))';
      } else {
        p.push(req.params.id, req.user.id);
        where = 'id = $' + (p.length - 1) + ' and user_id = $' + p.length;
      }
      const r = await pool.query(
        'update public.jobs set ' + sets.join(', ') + ' where ' + where +
        ' returning ' + JOB_LIGHT_COLS, p);
      if (!r.rows.length) return res.status(404).json({ error: 'Job not found' });
      res.json(_jobLight(r.rows[0]));
      return;
    } catch (e) {
      // Never lose a save to a bad pool — fall through to PostgREST, which is
      // slower but is the path that worked before this existed.
      console.warn('[jobs] direct write failed, falling back to PostgREST:', e.message);
    }
  }

  const { data, error } = await _scopeCompany(supabase.from('jobs').update(patch).eq('id', req.params.id), req).select(JOB_LIGHT_COLS);
  if (error) return res.status(500).json({ error: error.message });
  // No row matched: the job is gone, or it is not this company's. Either way
  // 404 — .single() used to turn that into a 500, which reads as our fault.
  if (!data || !data.length) return res.status(404).json({ error: 'Job not found' });
  res.json(_jobLight(data[0]));
});

app.get('/jobs/:id', requireAuth, async (req, res) => {
  // A job row runs to tens of MB once site photos and the aerial land in
  // draw_state, and the PostgREST role carries Supabase's 8-second
  // statement_timeout — which is how a first job-open produced
  // "canceling statement due to statement timeout". The direct connection
  // has no such ceiling, so the heavy read goes there when it exists; the
  // WHERE mirrors _scopeCompany exactly.
  let data = null, error = null;
  const pool = _pgPool();
  if (pool) {
    try {
      const r = req.companyId
        ? await pool.query(
            'select * from public.jobs where id = $1 and (company_id = $2 or (company_id is null and user_id = $3))',
            [req.params.id, req.companyId, req.user.id])
        : await pool.query(
            'select * from public.jobs where id = $1 and user_id = $2',
            [req.params.id, req.user.id]);
      if (r.rows.length) data = r.rows[0];
      else error = { message: 'not found', code: 'PGRST116' };
    } catch (e) {
      console.warn('[jobs] direct read failed, falling back to PostgREST:', e.message);
      data = null; error = null;
    }
  }
  if (!data && !error) {
    const r = await _scopeCompany(supabase.from('jobs').select('*').eq('id', req.params.id), req).single();
    data = r.data; error = r.error;
  }
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
      res.json({ ok: true, id: req.params.id, fast: true });
      if (quote.share && quote.share.token) { recordUsage('quote_sent', req); _tokenCachePut(quote.share.token, req.params.id); }
      return;
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
  if (quote.share && quote.share.token) { recordUsage('quote_sent', req); _tokenCachePut(quote.share.token, job.id); }
});

app.delete('/jobs/:id', requireAuth, async (req, res) => {
  // .select() so the deleted rows come back and we can tell "deleted it" from
  // "matched nothing". The scope means another company's job matches nothing —
  // which used to answer ok:true, telling the client a delete happened that
  // did not. 404 rather than 403, so this still says nothing about whether a
  // job with that id exists somewhere else.
  const { data, error } = await _scopeCompany(
    supabase.from('jobs').delete().eq('id', req.params.id), req).select('id');
  if (error) return res.status(500).json({ error: error.message });
  if (!data || !data.length) return res.status(404).json({ error: 'Job not found' });
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

// One revision's GEOMETRY, and nothing else. The list above deliberately
// never carries draw_state — a job's snapshot is multi-MB once photos are in
// it — but a roof map must never be restored blind: putting the wrong
// snapshot over a live job is just a second way to lose the drawing. So this
// returns draw_state.draw on its own, which is the outline, lines, roofs and
// penetrations with no photos anywhere near it, and the app draws it for the
// user to look at before they commit.
app.get('/jobs/:id/revisions/:revId/geometry', requireAuth, async (req, res) => {
  const { data: rev, error } = await _scopeCompany(
    supabase.from('job_revisions').select('id, job_id, saved_at, reason, draw_state')
      .eq('id', req.params.revId).eq('job_id', req.params.id), req).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!rev) return res.status(404).json({ error: 'Revision not found' });
  const draw = (rev.draw_state && rev.draw_state.draw) || {};
  const roofs = Array.isArray(draw.roofs) ? draw.roofs : [];
  // Counted here so the list can mark a blank snapshot as blank without
  // fetching every one of them.
  res.json({
    id: rev.id, saved_at: rev.saved_at, reason: rev.reason,
    draw,
    summary: {
      roofs: roofs.length,
      outline: Array.isArray(draw.outline) ? draw.outline.length : 0,
      lines: Array.isArray(draw.lines) ? draw.lines.length : 0,
      penetrations: Array.isArray(draw.penetrations) ? draw.penetrations.length : 0,
      // The same test _drawIsEmpty applies in the browser, so "blank" means
      // the same thing on both sides of the wire.
      blank: !(roofs.some(r => r && ((Array.isArray(r.outline) && r.outline.length >= 3) ||
                                     (Array.isArray(r.lines) && r.lines.length > 0)))
               || (Array.isArray(draw.outline) && draw.outline.length >= 3)
               || (Array.isArray(draw.lines) && draw.lines.length > 0)),
    },
  });
});

app.post('/jobs/:id/revisions/:revId/restore', requireAuth, async (req, res) => {
  try {
    const { data: rev, error } = await _scopeCompany(
      supabase.from('job_revisions').select('*').eq('id', req.params.revId).eq('job_id', req.params.id), req).single();
    if (error || !rev) return res.status(404).json({ error: 'Revision not found' });
    // rev.job_id is only as trustworthy as the revision it came from, and a
    // revision predating the multi-tenant migration carries a null company_id
    // — which _scopeCompany matches through its user_id fallback. Without this
    // check such a revision could be restored straight over a job that now
    // belongs to a different company, destroying their work. 404 rather than
    // 403 on somebody else's job, so this does not confirm it exists.
    const { data: existing } = await _scopeCompany(
      supabase.from('jobs').select('id').eq('id', rev.job_id), req).maybeSingle();
    if (!existing) {
      const { data: elsewhere } = await supabase.from('jobs').select('id').eq('id', rev.job_id).maybeSingle();
      if (elsewhere) return res.status(404).json({ error: 'Revision not found' });
    }
    const fields = {
      client_name: rev.client_name || '', site_address: rev.site_address || '',
      draw_state: rev.draw_state || {}, settings: rev.settings || {},
      status: rev.status || 'draft', updated_at: new Date().toISOString(),
    };
    if (existing) {
      const { error: uerr } = await _scopeCompany(
        supabase.from('jobs').update(fields).eq('id', rev.job_id), req);
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
    // ── The flashing library must survive writers that don't know it ──
    // The library (materials catalog) rides INSIDE price_book as
    // __materials_catalog, and settings saves are whole-document: a writer
    // that doesn't carry the catalog — an older build still cached on one
    // machine, the setup wizard's direct save, a tab opened before the
    // library was drawn — used to overwrite price_book wholesale and take
    // the library with it. Nine hand-drawn flashings died exactly that way.
    //
    // Rule: an incoming save that carries NO saved flashings does not get to
    // destroy saved flashings that exist. The stored library is folded into
    // such a save instead. A save that carries a non-empty library is
    // trusted verbatim (that is how deletes work); emptying the library
    // deliberately requires the explicit __cleared flag the delete-last-one
    // path sends.
    try {
      const prevCat = existing && existing.price_book && existing.price_book.__materials_catalog;
      const prevSaved = (prevCat && Array.isArray(prevCat.savedFlashings)) ? prevCat.savedFlashings : [];
      if (prevSaved.length){
        const inCat = payload.price_book.__materials_catalog;
        const inSaved = (inCat && Array.isArray(inCat.savedFlashings)) ? inCat.savedFlashings : [];
        const cleared = !!(inCat && inCat.__cleared);
        if (!inSaved.length && !cleared){
          payload.price_book = Object.assign({}, payload.price_book);
          payload.price_book.__materials_catalog = Object.assign({}, prevCat, inCat || {},
            { savedFlashings: prevSaved });
        }
      }
      if (payload.price_book.__materials_catalog && payload.price_book.__materials_catalog.__cleared){
        payload.price_book.__materials_catalog = Object.assign({}, payload.price_book.__materials_catalog);
        delete payload.price_book.__materials_catalog.__cleared;
      }
    } catch (e) { /* the guard must never break an ordinary save */ }
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
    // Two milestones ride on this one save. "setup_done" is the business
    // putting its own name and a way to be contacted on its quotes — the
    // point at which anything it sends is its own. "price_book_saved" is the
    // roofer replacing our sample figures with their supplier's rates.
    const _b = payload.branding || {};
    if (_b.company_name && (_b.phone || _b.email)) recordUsage('setup_done', req);
    if (payload.price_book && payload.price_book.list_prices === false) recordUsage('price_book_saved', req);
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
  const had = _tokenIdCache.get(token);
  if (_tokenIdCache.size > 500) _tokenIdCache.delete(_tokenIdCache.keys().next().value);
  _tokenIdCache.set(token, id);
  // Persist the mapping so it survives a restart. The in-memory cache dies
  // with the process, and without it a customer open fell back to scanning
  // every job's multi-MB draw_state for the token — which Supabase's
  // 8-second PostgREST statement timeout killed, over and over, until the
  // page's retry loop gave up a minute later. platform_state is written via
  // plain REST: no DDL, no direct DB connection required. Best-effort — on
  // an account whose platform_state table doesn't exist yet this quietly
  // does nothing, and the scan (or the &i= hint) still resolves the link.
  if (had !== id){
    supabase.from('platform_state').upsert(
      { key: 'qtok:' + token, value: { jobId: id }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    ).then(r => { if (r.error) console.warn('token map persist failed:', r.error.message); })
     .catch(e => console.warn('token map persist failed:', e.message));
  }
}
async function _tokenMapGet(token){
  try {
    const { data } = await supabase.from('platform_state')
      .select('value').eq('key', 'qtok:' + token).maybeSingle();
    const id = data && data.value && data.value.jobId;
    return (id && /^[0-9a-fA-F-]{10,}$/.test(String(id))) ? id : null;
  } catch (e) { return null; }
}
async function _findJobByToken(token, jobIdHint){
  if (!token) return null;
  if (!jobIdHint && _tokenIdCache.has(token)) jobIdHint = _tokenIdCache.get(token);
  if (!jobIdHint) jobIdHint = await _tokenMapGet(token);   // durable map — survives restarts
  // Select ONLY the quote subtree, not the whole draw_state — the customer view
  // needs just the quote, and NOT the job's photos / drawing aerial (state.photos
  // + state.img64), which are megabytes. Writes go back via _saveQuoteBack's
  // targeted jsonb update, so the full draw_state is never round-tripped.
  // company_id rides along: the accepted event stamps the roofer's company
  // on the usage milestone and the deposit invoice — without it both fell
  // back to the owner's personal scope.
  const cols = 'id, user_id, company_id, client_name, site_address, quote:draw_state->state->quote';
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
// ── HOW LONG A QUOTE LINK STAYS A CREDENTIAL ────────────────────────
// The link in a customer's inbox is a bearer credential, and since invoicing
// went in, accepting raises a deposit invoice and may auto-send it. So an old
// link forwarded on, or sitting in a mailbox someone else now reads, is a live
// financial instrument.
//
// The "Valid until" box on a quote is free text a roofer types ("30 days"),
// not a date, so it cannot be enforced — this is a backstop on the link's own
// age instead. Opening an old link still WORKS, so a customer can re-read what
// they were sent and what they accepted; it is only the state-changing actions
// that stop, with a message telling them to get in touch.
const SHARE_ACTION_DAYS = 90;

function _shareSentAt(job, quote){
  const sh = ((quote || {}).share) || {};
  // sentAt is stamped by the office when the link is made. Links that predate
  // it fall back to their first recorded event, then to the job's own age —
  // never to now(), which would hand every ancient link a fresh 90 days.
  const first = (Array.isArray(sh.events) && sh.events.length) ? sh.events[0].at : null;
  const v = sh.sentAt || first || (job || {}).created_at || (job || {}).updated_at;
  const d = v ? new Date(v) : null;
  return (d && !isNaN(d.getTime())) ? d : null;
}
function _shareExpiresAt(job, quote){
  const sent = _shareSentAt(job, quote);
  return sent ? new Date(sent.getTime() + SHARE_ACTION_DAYS * 86400000) : null;
}
function _shareActionsExpired(job, quote){
  const exp = _shareExpiresAt(job, quote);
  // No usable date anywhere: leave the link working rather than locking a
  // customer out on a guess.
  return exp ? Date.now() > exp.getTime() : false;
}

// The customer's browser reports the total it computed. That figure decides a
// deposit invoice, so it is checked against what the office actually sent
// rather than taken on trust. The band is wide on purpose — a customer
// legitimately drops a roof or picks a dearer grade — it is there to catch a
// figure that cannot be a real answer to this quote.
// Recompute what the picked options SHOULD cost, from the sell prices the
// office stored at send. Mirrors _qpSelectionChangesPriced in the frontend;
// pricegold.mjs is what holds the two together.
// Returns null when the quote carries no priced block — nothing to check
// against, so nothing is rejected on a guess.
function _expectedTotalFor(quote, opts){
  const P = ((quote || {}).share || {}).priced;
  if (!P || P.v !== 1) return null;
  const p = opts || {};
  let sub = Number(P.base) || 0;
  const sel = (p.extraRoofsSel && typeof p.extraRoofsSel === 'object') ? p.extraRoofsSel : {};
  (P.extraRoof || []).forEach(function (price, i) { if (sel[i] && price > 0) sub += Number(price) || 0; });
  const baseG = quote.baseGrade || 'maxam';
  if (p.steelGrade && p.steelGrade !== baseG && P.grade && P.grade[p.steelGrade] != null)
    sub += Number(P.grade[p.steelGrade]) || 0;
  const lock = (P.profileLocks || {})[p.profile] || '';
  if (lock) sub += Number(P.gaugeUpgrade) || 0;
  else if (p.steelThickness && p.steelThickness !== '40') sub += Number(P.gaugeUpgrade) || 0;
  if (p.gutterType && P.gutter && P.gutter[p.gutterType] != null) {
    sub += (P.gutterOverride != null && !P.gutterExcluded)
      ? Number(P.gutterOverride) || 0
      : Number(P.gutter[p.gutterType]) || 0;
    if ((P.gutterUplift || {})[p.gutterType] !== false) sub += Number(P.scaffoldUplift) || 0;
    if ((p.gutterBracket || 'internal') === 'external') sub += Number((P.bracketExt || {})[p.gutterType]) || 0;
    if (p.downpipes === 'yes') sub += Number(P.downpipes) || 0;
  }
  return sub * (1 + (Number(P.gstRate) || 0) / 100);
}
// The customer's browser reports the total it computed, and that figure sizes a
// deposit invoice. With a priced block we can check it exactly rather than
// guess at a plausible band — a cent of tolerance for floating point, no more.
// Without one (a quote sent before this shipped) fall back to the band.
function _acceptedTotalPlausible(quote, acceptedTotal, opts){
  const expected = _expectedTotalFor(quote, opts || (quote || {}).proposalOptions);
  if (expected != null && expected > 0) {
    if (!isFinite(acceptedTotal) || acceptedTotal <= 0) return false;
    return Math.abs(acceptedTotal - expected) <= 0.01;
  }
  const sent = Number((((quote || {}).share) || {}).sentTotal);
  if (!isFinite(sent) || sent <= 0) return true;      // no anchor to judge against
  if (!isFinite(acceptedTotal) || acceptedTotal <= 0) return false;
  return acceptedTotal >= sent * 0.2 && acceptedTotal <= sent * 5;
}

// ── WHAT A CUSTOMER'S BROWSER IS ALLOWED TO SEE ─────────────────────
// This route used to answer with the whole quote object, and the customer's
// page recomputed every option price locally from it. That meant the JSON in
// their browser carried the roofer's cost basis and margin: materialBase,
// roofMaterialMarkup, gutterMaterialMarkup, scaffoldBase, labourRatesCustom,
// roofLabour. Open devtools on a quote you were sent and you could read what
// the job cost to buy and what the roofer was making on it.
//
// The office now prices every option before sending (share.priced), so the page
// adds up stored sell prices and needs none of that. These fields are removed
// on the way out.
//
// A DENYLIST rather than an allowlist, deliberately: the proposal is a large,
// still-growing document — photos, maps, scope, terms, layout — and an
// allowlist would silently blank a new display field the day someone added
// one. The list below is the commercially sensitive set, and the test asserts
// each name individually so adding a cost field without thinking about it
// fails the suite.
const CUSTOMER_HIDDEN_FIELDS = [
  'materialBase', 'scaffoldBase', 'scaffoldCustom',
  'roofMaterialMarkup', 'gutterMaterialMarkup',
  'roofMatQtyBuffer', 'gutterMatQtyBuffer',
  'labourRatesCustom', 'labourCalc', 'labourHrsManual', 'labour',
  'roofLabour', 'roofLabourCalc', 'gutterLabour',
  'gutterPrices', 'gutterUnitPrices', 'selectionPrices',
  'psSubtotal', 'shedEst', 'showLabourCalc',
];
function _customerQuoteView(quote){
  if (!quote || typeof quote !== 'object') return quote;
  // Only strip once the quote actually carries sell prices. A quote sent
  // before this shipped has no priced block, so its page still recomputes —
  // stripping those would leave a customer looking at a broken proposal.
  const priced = ((quote.share || {}).priced);
  if (!priced || priced.v !== 1) return quote;
  const out = {};
  for (const k of Object.keys(quote)) {
    if (CUSTOMER_HIDDEN_FIELDS.indexOf(k) < 0) out[k] = quote[k];
  }
  return out;
}

app.get('/q/:token', rateLimit(60, 60000), async (req, res) => {
  try {
    const job = await _findJobByToken(req.params.token, req.query.job);
    const quote = _quoteOf(job);
    if (!job || !quote) return res.status(404).json({ error: 'Quote not found' });
    // The COMPANY's settings row, not the job owner's. A job made by a
    // teammate carries the teammate's user_id, and the company settings row
    // lives under whoever set the business up — looking up by owner sent a
    // teammate's quote to the customer as "Your company" placeholders while
    // the office preview looked perfectly branded.
    const settings = await _settingsRowForJob(job);
    const share = quote.share || {};
    if (!Array.isArray(share.events)) share.events = [];
    // The office previewing its own link is NOT the customer opening the
    // quote. The app's Open button and its link-verify fetch pass preview=1,
    // and such a hit is served in full but leaves no analytics behind — no
    // status flip, no openCount, no event, no notification. Only real
    // customer opens reach the office's bell.
    const isPreview = String(req.query.preview) === '1';
    // Persisting the "opened" analytics rewrites the WHOLE draw_state (photos and
    // all) back to the DB, so only do it when something meaningful actually
    // changed — a status transition, or a fresh open outside the 2-min throttle.
    // Rapid reloads / link-verify hits then don't trigger a heavy write each time.
    let changed = false;
    if (!isPreview) {
    if (!share.status || share.status === 'sent') { share.status = 'opened'; changed = true; }
    const last = share.events[share.events.length - 1];
    if (!last || last.type !== 'opened' || (Date.now() - new Date(last.at).getTime()) > 120000) {
      share.openCount = (share.openCount || 0) + 1;
      share.lastOpenedAt = new Date().toISOString();
      share.events.push({ type: 'opened', at: share.lastOpenedAt });
      if (share.events.length > 80) share.events = share.events.slice(-80);
      changed = true;
    }
    }
    // Respond FIRST, persist the "opened" analytics in the background — the
    // customer's page load must never wait on the write (without a pg pool
    // the fallback save round-trips the whole multi-MB draw_state, which is
    // exactly what made the quote link feel slow to open).
    if (changed) { quote.share = share; _saveQuoteBack(job, quote).catch(e => console.error('open-analytics save failed:', e.message)); }
    // Still served past 90 days — the customer may be re-reading what they
    // accepted. The flag lets the page say so and hide the Accept button.
    const _exp = _shareExpiresAt(job, quote);
    res.json({
      quote: _customerQuoteView(quote),
      branding: (settings && settings.branding) || {},
      expired: _shareActionsExpired(job, quote),
      expiresAt: _exp ? _exp.toISOString() : null,
    });
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
    // 'opened' is just analytics and stays allowed; everything else changes
    // the state of a quote and is refused once the link is past its window.
    if (String(type) !== 'opened') {
      const _j = await _findJobByToken(req.params.token, req.query.job);
      const _q = _quoteOf(_j);
      if (_j && _q && _shareActionsExpired(_j, _q)) {
        return res.status(410).json({
          error: 'This quote link has expired. Please get in touch with us and we will send you a current one.',
          code: 'QUOTE_LINK_EXPIRED',
        });
      }
    }
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
      // Both numbers are kept: what the customer's browser reported, and what
      // the office sent. The office screen can then show a disagreement rather
      // than it being invisible.
      quote.accepted = { name: name || quote.client || 'Customer', at: now, total: total || 0,
        sentTotal: Number((share || {}).sentTotal) || null,
        totalVerified: _acceptedTotalPlausible(quote, total),
        options: acceptedOptions || [], gutter: quote.gutterChoice || 'none' };
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
    // A customer accepting is the milestone that matters most, and it belongs
    // to the ROOFER's company, not to whoever opened the link.
    if (type === 'accepted') {
      recordUsage('quote_accepted', { companyId: job.company_id || null });
      // Raise (and maybe send) the deposit invoice — after the response, so
      // an invoicing hiccup can never break the customer's accept.
      _autoDepositInvoice(job, quote);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public, token-guarded: when a customer accepts their online quote the
// frontend calls this with the rendered proposal PDF. We email the office a
// one-off notification containing the accepted details AND the PDF that shows
// the customer's chosen options. The recipient is fixed to the office address
// (never taken from the request), so this can't be abused as an open relay.
// Last-resort recipient only — every acceptance should reach the business that
// sent the quote (see the lookup in /q/:token/accept-email). This is what's
// used when that business has no email on file at all.
const ACCEPT_NOTIFY_EMAIL = process.env.ACCEPT_NOTIFY_EMAIL || '';
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
    if (_shareActionsExpired(job, quote)) {
      return res.status(410).json({
        error: 'This quote link has expired. Please get in touch with us and we will send you a current one.',
        code: 'QUOTE_LINK_EXPIRED',
      });
    }
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
    // Who hears about this acceptance. It has to be the business that SENT the
    // quote — a fixed address here mailed every subscriber's acceptances to one
    // inbox, which is a leak between competitors, not just a wrong recipient.
    // Order: the recipient the office configured on the quote → that company's
    // settings → the person whose job it is → the server default, last.
    let acceptTo = (quote.acceptNotify && String(quote.acceptNotify).trim()) || '';
    if (!acceptTo) {
      try {
        // Company row first — same reason as the branding lookup: a job made
        // by a teammate must still notify the address the BUSINESS set.
        const st = await _settingsRowForJob(job);
        acceptTo = String((((st || {}).quote_defaults || {}).email || {}).accept_to || '').trim();
      } catch (e) {}
    }
    if (!acceptTo) {
      try {
        const { data: prof } = await supabase.from('profiles').select('email').eq('id', job.user_id).maybeSingle();
        acceptTo = String((prof && prof.email) || '').trim();
      } catch (e) {}
    }
    if (!acceptTo) acceptTo = ACCEPT_NOTIFY_EMAIL;
    if (!acceptTo) {
      console.warn('[accept-email] no recipient for job ' + job.id + ' — acceptance is still recorded');
      return res.json({ ok: false, code: 'NO_RECIPIENT' });
    }
    await _dispatchMail({ to: acceptTo, subject, text: lines.join('\n'), attachment });
    res.json({ ok: true });
  } catch (e) {
    console.error('accept-email failed:', e.message);
    res.status(502).json({ error: 'Email send failed: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// STRIPE — the money side of the plans
// ══════════════════════════════════════════════════════════════════
// Checkout happens on Stripe's page, the webhook writes the result into the
// subscriptions row, and everything else in the product already keys off
// that row (_subscriptionLive, _planOf, the seat limits). No Stripe SDK —
// two POSTs and an HMAC don't need a dependency, and the tests can point
// STRIPE_API_BASE at a local stand-in.
//
// Runs entirely in TEST MODE until real keys land: a Stripe account needs
// no company, no bank account and no fee until live payments are activated,
// so the whole flow can be exercised with test cards today and switched to
// real money by swapping STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET and the
// three price ids in Railway.
const STRIPE_API_BASE = process.env.STRIPE_API_BASE || 'https://api.stripe.com';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICES = {
  solo:     process.env.STRIPE_PRICE_SOLO     || '',
  team:     process.env.STRIPE_PRICE_TEAM     || '',
  business: process.env.STRIPE_PRICE_BUSINESS || '',
};
// Paid yearly: two months free — the Stripe Prices are 10x the monthly rate
// ($1,490 / $2,990 / $5,490 + GST), created as yearly recurring prices on the
// same Products. Unset is a valid state: no yearly price simply means the
// billing screen never offers yearly for that plan.
const STRIPE_PRICES_ANNUAL = {
  solo:     process.env.STRIPE_PRICE_SOLO_ANNUAL     || '',
  team:     process.env.STRIPE_PRICE_TEAM_ANNUAL     || '',
  business: process.env.STRIPE_PRICE_BUSINESS_ANNUAL || '',
};
// The founding offer: 30% off for the first 12 months, for the businesses who
// came in through early access. This is the id of a Stripe coupon created with
// duration:'repeating' and duration_in_months:12 — Stripe then rolls them back
// to the standard rate at month 13 by itself, with nothing to remember here.
//
// Unset is a valid state: no coupon simply means nobody is discounted, and
// checkout carries on exactly as it did before.
const EARLY_ACCESS_COUPON = (process.env.EARLY_ACCESS_COUPON || '').trim();
function _stripePlanOfPrice(priceId){
  // Both cycles resolve to the same plan — a portal switch from monthly to
  // yearly must not change what the business is entitled to.
  return Object.keys(STRIPE_PRICES).find(function(k){ return STRIPE_PRICES[k] && STRIPE_PRICES[k] === priceId; })
      || Object.keys(STRIPE_PRICES_ANNUAL).find(function(k){ return STRIPE_PRICES_ANNUAL[k] && STRIPE_PRICES_ANNUAL[k] === priceId; })
      || '';
}
// One POST to Stripe, form-encoded the way its API wants. params is a flat
// object whose keys may already carry Stripe's bracket syntax.
async function _stripeCall(path, params){
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) { const e = new Error('Billing is not switched on yet.'); e.status = 400; throw e; }
  const body = new URLSearchParams();
  Object.keys(params || {}).forEach(function(k){
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') body.append(k, String(params[k]));
  });
  const r = await fetch(STRIPE_API_BASE + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j = await r.json().catch(function(){ return {}; });
  if (!r.ok) {
    const e = new Error((j.error && j.error.message) || ('Stripe refused (' + r.status + ')'));
    e.status = 502; throw e;
  }
  return j;
}
// Did this business come in through early access? The waitlist row is the
// record of that: somebody who was invited, or who went on to join, gets the
// founding rate. Anyone who found the pricing page on their own does not.
//
// Looked up on the owner's email rather than stored on the company, because
// the waitlist row predates the company by definition — there was no account
// when they filled the form in.
async function _earlyAccessEligible(email){
  if (!EARLY_ACCESS_COUPON) return false;
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) return false;
  try {
    const { data } = await supabase.from('waitlist')
      .select('status').ilike('email', addr).maybeSingle();
    return !!data && ['invited', 'joined'].indexOf(String(data.status || '')) >= 0;
  } catch (e) {
    // A lookup failure must not stop somebody paying. They fall through to the
    // promotion-code box and we can apply the coupon by hand afterwards.
    console.warn('[billing] early-access lookup failed:', e.message);
    return false;
  }
}

// Billing is the owner's to touch — requireOwner's wording is about the team,
// so this carries its own.
async function _requireBillingOwner(req, res){
  if (!req.companyId){ res.status(403).json({ error: 'You are not part of a company yet.' }); return false; }
  const role = await _roleOf(req.user.id);
  if (role !== 'owner'){ res.status(403).json({ error: 'Only the account owner can change the subscription.', code: 'OWNER_ONLY' }); return false; }
  return true;
}

// Start a Checkout for a plan. Stripe hosts the card page; we hand back its
// URL and wait for the webhook.
app.post('/billing/checkout', requireAuth, async (req, res) => {
  try {
    if (!(await _requireBillingOwner(req, res))) return;
    const plan = String((req.body || {}).plan || '').toLowerCase();
    if (!PLANS[plan] || plan === 'trial') return res.status(400).json({ error: 'Pick a plan: solo, team or business.' });
    // Yearly = two months free; anything that isn't exactly 'annual' bills
    // monthly, so an old client that never sends the field changes nothing.
    const annual = String((req.body || {}).billing || '').toLowerCase() === 'annual';
    const priceId = annual ? STRIPE_PRICES_ANNUAL[plan] : STRIPE_PRICES[plan];
    if (!priceId) return res.status(400).json({ error: annual
      ? ('Yearly billing for that plan isn\'t configured yet (STRIPE_PRICE_' + plan.toUpperCase() + '_ANNUAL).')
      : ('That plan has no Stripe price configured yet (STRIPE_PRICE_' + plan.toUpperCase() + ').') });
    // Don't sell a plan the business already doesn't fit in.
    const lim = _limitsFor(plan);
    const seats = await _seatsUsed(req.companyId);
    if (seats.members > lim.seats)
      return res.status(400).json({ error: 'Your business has ' + seats.members + ' people and ' + PLANS[plan].label + ' covers ' + lim.seats + '. Pick a bigger plan or remove members first.' });
    const sub = await _companySubscription(req.companyId, req.user.id);
    const params = {
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      success_url: PUBLIC_APP_URL + '/index.html?billing=success',
      cancel_url:  PUBLIC_APP_URL + '/index.html?billing=cancelled',
      client_reference_id: req.companyId,
      'metadata[company_id]': req.companyId,
      'metadata[user_id]': req.user.id,
      'metadata[plan]': plan,
      'subscription_data[metadata][company_id]': req.companyId,
      'subscription_data[metadata][plan]': plan,
    };
    // The founding discount, applied without anybody having to remember a code.
    //
    // allow_promotion_codes and discounts are MUTUALLY EXCLUSIVE at Stripe —
    // a session carrying both comes back 400 "You may only specify one of
    // these parameters", which _stripeCall turns into a hard failure. So this
    // is an either/or, never both, and the test suite asserts exactly that:
    // the local Stripe stand-in answers any request, so it cannot catch the
    // combination the real API refuses.
    if (await _earlyAccessEligible(req.user.email)) {
      params['discounts[0][coupon]'] = EARLY_ACCESS_COUPON;
    } else {
      params.allow_promotion_codes = 'true';
    }
    if (sub && sub.stripe_customer_id) params.customer = sub.stripe_customer_id;
    else params.customer_email = req.user.email || undefined;
    const session = await _stripeCall('/v1/checkout/sessions', params);
    res.json({ url: session.url });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Stripe's customer portal: update the card, change plan, cancel. Their UI,
// our link.
app.post('/billing/portal', requireAuth, async (req, res) => {
  try {
    if (!(await _requireBillingOwner(req, res))) return;
    const sub = await _companySubscription(req.companyId, req.user.id);
    if (!sub || !sub.stripe_customer_id) return res.status(400).json({ error: 'No billing account yet — subscribe first.' });
    const session = await _stripeCall('/v1/billing_portal/sessions', {
      customer: sub.stripe_customer_id,
      return_url: PUBLIC_APP_URL + '/index.html',
    });
    res.json({ url: session.url });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ── THE SUBSCRIPTION RECEIPT, FROM ACCOUNTS ─────────────────────────
// Stripe emails its own receipt from its own servers, which no amount of
// dashboard configuration turns into a message from us — and a NZ business
// putting a SaaS subscription through its books wants a tax invoice with a
// GST line on it, not a Stripe receipt. So the platform sends its own, out of
// accounts@, with replies landing where an accounts question should land.
//
// GST: Stripe's own `tax` figure wins whenever Stripe Tax is switched on. It
// usually isn't, so the fallback treats the charged amount as GST-INCLUSIVE
// at SUBSCRIPTION_GST_RATE (15 by default, matching the advertised plan
// prices). Set SUBSCRIPTION_GST_RATE=0 for a deployment that is not GST
// registered and the tax lines disappear entirely rather than being wrong.
const SUB_GST_RATE = (function(){
  const v = Number(process.env.SUBSCRIPTION_GST_RATE);
  return isFinite(v) && v >= 0 ? v : 15;
})();
const SUB_GST_NUMBER = String(process.env.SUBSCRIPTION_GST_NUMBER || '').trim();
// Stripe retries a webhook until it gets a 2xx, and a retry must not put a
// second invoice in somebody's inbox. Keyed by what was SENT rather than by
// event id, because one payment arrives as two different events. Bounded so a
// long-running process cannot grow this without limit.
const _mailedStripeEvents = new Set();
function _stripeEventSeen(id){
  if (!id) return false;
  if (_mailedStripeEvents.has(id)) return true;
  _mailedStripeEvents.add(id);
  if (_mailedStripeEvents.size > 500) _mailedStripeEvents.delete(_mailedStripeEvents.values().next().value);
  return false;
}
function _subInvoiceNumbers(inv){
  const cents = (v) => (Number(v) || 0) / 100;
  const total = cents(inv.amount_paid != null ? inv.amount_paid : (inv.total != null ? inv.total : inv.amount_due));
  // Stripe Tax on → believe it. Off → derive from the GST-inclusive total.
  const stripeTax = inv.tax != null ? cents(inv.tax) : null;
  let gst, net;
  if (stripeTax != null && stripeTax > 0) { gst = stripeTax; net = Math.round((total - gst) * 100) / 100; }
  else if (SUB_GST_RATE > 0) { net = Math.round((total / (1 + SUB_GST_RATE / 100)) * 100) / 100; gst = Math.round((total - net) * 100) / 100; }
  else { net = total; gst = 0; }
  return { total, net, gst, currency: String(inv.currency || 'nzd').toUpperCase() };
}
function _subInvoiceEmail(inv){
  const n = _subInvoiceNumbers(inv);
  const num = inv.number || inv.id || '';
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const when = inv.status_transitions && inv.status_transitions.paid_at
    ? new Date(inv.status_transitions.paid_at * 1000) : new Date();
  const period = (inv.lines && inv.lines.data && inv.lines.data[0] && inv.lines.data[0].period) || null;
  const periodTxt = period && period.start && period.end
    ? new Date(period.start * 1000).toLocaleDateString('en-NZ') + ' – ' + new Date(period.end * 1000).toLocaleDateString('en-NZ')
    : '';
  const desc = (inv.lines && inv.lines.data && inv.lines.data[0] && inv.lines.data[0].description) || 'RoofMap subscription';
  const rows = [['Description', desc]];
  if (periodTxt) rows.push(['Period', periodTxt]);
  rows.push(['Invoice', num]);
  rows.push(['Paid', when.toLocaleDateString('en-NZ')]);
  const gstLine = n.gst > 0 ? ('GST (' + (SUB_GST_RATE || '') + '%)') : null;
  const lines = [
    'RoofMap — subscription tax invoice',
    '',
    desc,
    periodTxt ? ('Period: ' + periodTxt) : '',
    'Invoice: ' + num,
    'Paid: ' + when.toLocaleDateString('en-NZ'),
    '',
    n.gst > 0 ? ('Subtotal: ' + _money(n.net) + ' ' + n.currency) : '',
    n.gst > 0 ? (gstLine + ': ' + _money(n.gst) + ' ' + n.currency) : '',
    'Total paid: ' + _money(n.total) + ' ' + n.currency,
    SUB_GST_NUMBER ? ('GST number: ' + SUB_GST_NUMBER) : '',
    '',
    inv.invoice_pdf ? ('Stripe PDF: ' + inv.invoice_pdf) : '',
    inv.hosted_invoice_url ? ('View online: ' + inv.hosted_invoice_url) : '',
    '',
    'Questions about this invoice — just reply to this email.',
  ].filter(function(x){ return x !== ''; });
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0a1628;max-width:640px">' +
    '<div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#0099cc">RoofMap — tax invoice</div>' +
    '<h2 style="font-size:19px;margin:8px 0 14px">' + esc(_money(n.total)) + ' ' + esc(n.currency) + ' paid — thank you</h2>' +
    '<table style="border-collapse:collapse;font-size:13px;margin-bottom:14px">' +
      rows.map(function(r){ return '<tr><td style="padding:3px 18px 3px 0;color:#5f6b7a">' + esc(r[0]) +
        '</td><td style="padding:3px 0"><strong>' + esc(r[1]) + '</strong></td></tr>'; }).join('') +
    '</table>' +
    '<table style="border-collapse:collapse;font-size:13px;border-top:1px solid #e2e8f0;padding-top:8px">' +
      (n.gst > 0 ? '<tr><td style="padding:3px 18px 3px 0;color:#5f6b7a">Subtotal</td><td style="padding:3px 0">' + esc(_money(n.net)) + '</td></tr>' +
                   '<tr><td style="padding:3px 18px 3px 0;color:#5f6b7a">' + esc(gstLine) + '</td><td style="padding:3px 0">' + esc(_money(n.gst)) + '</td></tr>' : '') +
      '<tr><td style="padding:5px 18px 3px 0;color:#5f6b7a"><strong>Total paid</strong></td><td style="padding:5px 0"><strong>' + esc(_money(n.total)) + ' ' + esc(n.currency) + '</strong></td></tr>' +
    '</table>' +
    (SUB_GST_NUMBER ? '<p style="font-size:12px;color:#5f6b7a">GST number: ' + esc(SUB_GST_NUMBER) + '</p>' : '') +
    (inv.hosted_invoice_url ? '<p><a href="' + esc(inv.hosted_invoice_url) + '" style="display:inline-block;background:#0a1628;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">View or download the invoice</a></p>' : '') +
    '<p style="font-size:12px;color:#5f6b7a">Questions about this invoice — just reply to this email.</p>' +
  '</div>';
  return { subject: 'RoofMap tax invoice ' + num + ' — ' + _money(n.total) + ' ' + n.currency,
           text: lines.join('\n'), html: html };
}
function _subFailedEmail(inv){
  const n = _subInvoiceNumbers(inv);
  const when = inv.next_payment_attempt ? new Date(inv.next_payment_attempt * 1000) : null;
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const retry = when ? ('We will try the card again on ' + when.toLocaleDateString('en-NZ') + '.') : '';
  const text = ['RoofMap — subscription payment did not go through', '',
    'The payment of ' + _money(n.total) + ' ' + n.currency + ' for your RoofMap subscription was declined.',
    retry, '',
    inv.hosted_invoice_url ? ('Update the card or pay it here:\n' + inv.hosted_invoice_url) : '',
    '', 'Reply to this email if something looks wrong — it reaches our accounts desk.'].filter(Boolean).join('\n');
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0a1628;max-width:640px">' +
    '<div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#b45309">RoofMap — payment declined</div>' +
    '<p>The payment of <strong>' + esc(_money(n.total)) + ' ' + esc(n.currency) + '</strong> for your RoofMap subscription did not go through.' +
    (retry ? ' ' + esc(retry) : '') + '</p>' +
    (inv.hosted_invoice_url ? '<p><a href="' + esc(inv.hosted_invoice_url) + '" style="display:inline-block;background:#0a1628;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Update the card</a></p>' : '') +
    '<p style="font-size:12px;color:#5f6b7a">Reply to this email if something looks wrong — it reaches our accounts desk.</p></div>';
  return { subject: 'RoofMap subscription payment declined', text: text, html: html };
}
// Send it as accounts@, with replies going to accounts@ too. Never throws:
// a mail problem must not make the webhook fail and be retried forever.
async function _sendSubscriptionMail(inv, build){
  const to = String((inv && (inv.customer_email || (inv.customer_address && inv.customer_address.email))) || '').trim();
  if (!to) { console.warn('[stripe] no customer_email on invoice ' + (inv && inv.id) + ' — nothing emailed'); return false; }
  if (!EMAIL_ENABLED) { console.warn('[stripe] email not configured — subscription invoice not sent'); return false; }
  const mail = build(inv);
  try {
    await _dispatchMail({ to: to, subject: mail.subject, text: mail.text, html: mail.html,
                          fromName: 'RoofMap Accounts', fromAddress: MAIL_ACCOUNTS, replyTo: MAIL_ACCOUNTS });
    console.log('[stripe] subscription mail sent to ' + to + ' from ' + MAIL_ACCOUNTS);
    return true;
  } catch (e) { console.error('[stripe] subscription mail failed:', e.message); return false; }
}

// Stripe's word on what happened, verified by signature over the raw bytes.
// v1 = HMAC-SHA256(secret, "<timestamp>.<payload>") per their scheme.
function _stripeSigOk(rawBody, header){
  if (!STRIPE_WEBHOOK_SECRET || !header) return false;
  const parts = {};
  String(header).split(',').forEach(function(p){ const i = p.indexOf('='); if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;   // 5-minute replay window
  const crypto = require('crypto');
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(parts.t + '.' + rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(parts.v1, 'hex'));
  } catch (e) { return false; }
}
async function _stripeWebhook(req, res){
  try {
    const raw = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
    if (!_stripeSigOk(raw, req.headers['stripe-signature']))
      return res.status(400).json({ error: 'Bad signature' });
    let event; try { event = JSON.parse(raw); } catch (e) { return res.status(400).json({ error: 'Bad payload' }); }
    const obj = (event.data && event.data.object) || {};

    if (event.type === 'checkout.session.completed'){
      const meta = obj.metadata || {};
      const companyId = meta.company_id || obj.client_reference_id || null;
      const userId = meta.user_id || null;
      const plan = PLANS[meta.plan] && meta.plan !== 'trial' ? meta.plan : null;
      if (userId){
        const row = {
          user_id: userId, company_id: companyId,
          status: 'active', plan: plan || 'monthly',
          stripe_customer_id: obj.customer || null,
          stripe_subscription_id: obj.subscription || null,
          trial_ends_at: null,
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('subscriptions').upsert(row, { onConflict: 'user_id' });
        if (error) console.warn('[stripe] subscription upsert failed:', error.message);
      }
      if (companyId && plan){
        await supabase.from('companies').update({ plan: plan }).eq('id', companyId);
        _planCache.delete(companyId);
      }
      console.log('[stripe] checkout completed — company ' + companyId + ' on ' + plan);
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted'){
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : String(obj.status || 'active');
      const patch = { status: status, updated_at: new Date().toISOString() };
      if (obj.current_period_end) patch.current_period_end = new Date(obj.current_period_end * 1000).toISOString();
      // A plan changed through the portal shows up as a new price on the sub.
      const priceId = obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].price && obj.items.data[0].price.id;
      const newPlan = _stripePlanOfPrice(priceId);
      if (newPlan && status === 'active') patch.plan = newPlan;
      const { data: rows } = await supabase.from('subscriptions').update(patch)
        .eq('stripe_subscription_id', obj.id).select('company_id');
      const companyId = rows && rows[0] && rows[0].company_id;
      if (companyId){
        if (newPlan && status === 'active') await supabase.from('companies').update({ plan: newPlan }).eq('id', companyId);
        _planCache.delete(companyId);
      }
      console.log('[stripe] subscription ' + obj.id + ' → ' + status + (newPlan ? ' (' + newPlan + ')' : ''));
    }

    // The money side. A paid invoice gets a RoofMap tax invoice out of
    // accounts@; a failed one gets a heads-up from the same desk, so a
    // subscriber never has to work out who to ask about their billing.
    // Keyed on the INVOICE, not the event: Stripe fires both
    // invoice.paid and invoice.payment_succeeded for the same payment, with
    // different event ids, and nobody wants the same invoice twice.
    if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid'){
      if (!_stripeEventSeen('paid:' + (obj.id || event.id))) await _sendSubscriptionMail(obj, _subInvoiceEmail);
    }
    if (event.type === 'invoice.payment_failed'){
      if (!_stripeEventSeen('failed:' + (obj.id || event.id) + ':' + (obj.attempt_count || 0)))
        await _sendSubscriptionMail(obj, _subFailedEmail);
    }

    res.json({ received: true });
  } catch (e) {
    console.error('[stripe] webhook error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// INVOICING — deposit on acceptance, progress claims, final on completion
// ══════════════════════════════════════════════════════════════════
// A quote that gets accepted and then never invoiced is the gap this closes.
// The money fields are STORED at creation, never recomputed — an invoice is a
// document, and a document that silently changes after it went out is how an
// accountant loses a morning. What the business charges up front, whether the
// deposit goes out by itself, and where the money lands all live in settings
// (quote_defaults.invoicing):
//   { deposit_percent: 50, auto_send_deposit: false, progress_enabled: false,
//     due_days: 7, bank_account: '', footer: '' }
const INVOICE_TYPES = ['deposit', 'progress', 'final'];
const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'];

// The settings row that governs a job — needed on the UNAUTHENTICATED accept
// path where there is no req, only the job row. Company row first (newest
// wins, same rule as _companySettingsRow), then the job owner's.
async function _settingsRowForJob(job){
  try {
    if (job.company_id){
      const { data } = await supabase.from('user_settings').select('*')
        .eq('company_id', job.company_id).order('updated_at', { ascending: false }).limit(1);
      if (data && data[0]) return data[0];
    }
    const { data } = await supabase.from('user_settings').select('*').eq('user_id', job.user_id).maybeSingle();
    return data || null;
  } catch (e) { return null; }
}
function _invoiceSettingsOf(settingsRow){
  const inv = (((settingsRow || {}).quote_defaults) || {}).invoicing || {};
  const pct = Number(inv.deposit_percent);
  return {
    deposit_percent: (isFinite(pct) && pct > 0 && pct <= 100) ? pct : 50,
    auto_send_deposit: inv.auto_send_deposit === true,
    progress_enabled: inv.progress_enabled === true,
    due_days: (isFinite(Number(inv.due_days)) && Number(inv.due_days) >= 0) ? Number(inv.due_days) : 7,
    bank_account: String(inv.bank_account || '').slice(0, 60),
    footer: String(inv.footer || '').slice(0, 1000),
  };
}
// From a GST-inclusive figure to the stored triple. NZ practice on customer
// invoices is to show the inclusive total with the GST called out.
function _invoiceMoney(totalIncl, gstRate){
  const rate = (isFinite(Number(gstRate)) && Number(gstRate) >= 0) ? Number(gstRate) : 15;
  const total = Math.round(Number(totalIncl) * 100) / 100;
  const amount = Math.round((total / (1 + rate / 100)) * 100) / 100;
  return { amount: amount, gst: Math.round((total - amount) * 100) / 100, total: total, gst_rate: rate };
}
// Next number for the company: INV-1001, INV-1002… Read the highest suffix
// and try the next; the UNIQUE (company_id, number) index turns a race into a
// retry instead of a duplicate in somebody's accounts.
async function _nextInvoiceNumber(companyId, userId){
  let q = supabase.from('invoices').select('number');
  q = companyId ? q.eq('company_id', companyId) : q.eq('user_id', userId);
  const { data } = await q;
  let max = 1000;
  (data || []).forEach(function(r){
    const m = /^INV-(\d+)$/.exec(String(r.number || ''));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'INV-' + (max + 1);
}
async function _createInvoice({ job, type, percent, totalIncl, gstRate, description, settingsRow }){
  const money = _invoiceMoney(totalIncl, gstRate);
  const quote = _quoteOf(job) || {};
  const inv = _invoiceSettingsOf(settingsRow);
  for (let attempt = 0; attempt < 3; attempt++){
    const number = await _nextInvoiceNumber(job.company_id, job.user_id);
    const row = {
      id: require('crypto').randomUUID(),   // generated here, not left to the DB default — the id is in the response either way
      company_id: job.company_id || null,
      user_id: job.user_id,
      job_id: job.id,
      number: number,
      type: type,
      status: 'draft',
      percent: (isFinite(Number(percent)) && Number(percent) > 0) ? Number(percent) : null,
      amount: money.amount, gst: money.gst, total: money.total, gst_rate: money.gst_rate,
      description: String(description || '').slice(0, 500),
      client_name: String(job.client_name || quote.client || '').slice(0, 200),
      client_email: String(quote.email || '').slice(0, 200),
      site_address: String(job.site_address || quote.addr || '').slice(0, 300),
      due_at: new Date(Date.now() + inv.due_days * 864e5).toISOString(),
    };
    const { data, error } = await supabase.from('invoices').insert(row).select('*').single();
    if (!error) return data;
    if (!/duplicate|unique/i.test(error.message || '')) throw new Error(error.message);
  }
  throw new Error('could not allocate an invoice number');
}
// The email the customer gets. Plain, bankable, no tracking pixels.
function _invoiceEmail(invRow, branding, invSettings){
  const b = branding || {};
  const coName = String(b.company_name || 'Your roofer');
  const lines = [
    'Tax invoice ' + invRow.number + ' from ' + coName,
    '',
    'Site: ' + (invRow.site_address || '—'),
    (invRow.description ? invRow.description : ''),
    '',
    'Amount (ex GST): ' + _money(invRow.amount),
    'GST (' + invRow.gst_rate + '%): ' + _money(invRow.gst),
    'TOTAL DUE: ' + _money(invRow.total),
    '',
    'Due: ' + (invRow.due_at ? new Date(invRow.due_at).toLocaleDateString('en-NZ') : 'on receipt'),
    invSettings.bank_account ? 'Pay by bank transfer to: ' + invSettings.bank_account : '',
    'Reference: ' + invRow.number,
    '',
    invSettings.footer || '',
    b.gst_number ? 'GST number: ' + b.gst_number : '',
  ].filter(function(l){ return l !== null; });
  const esc = function(x){ return String(x == null ? '' : x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  const rowHtml = function(k, v, strong){
    return '<tr><td style="padding:6px 14px 6px 0;color:#5f6b7a">' + esc(k) + '</td>' +
           '<td style="padding:6px 0;text-align:right;font-weight:' + (strong ? '800' : '500') + ';color:#0a1628">' + esc(v) + '</td></tr>';
  };
  const html =
    '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;color:#1c2733;line-height:1.6;max-width:560px">' +
    '<h2 style="margin:0 0 2px;color:#0a1628">Tax invoice ' + esc(invRow.number) + '</h2>' +
    '<div style="color:#5f6b7a;margin-bottom:14px">' + esc(coName) + (b.gst_number ? ' · GST ' + esc(b.gst_number) : '') + '</div>' +
    '<div style="margin-bottom:6px"><strong>Site:</strong> ' + esc(invRow.site_address || '—') + '</div>' +
    (invRow.description ? '<div style="margin-bottom:12px">' + esc(invRow.description) + '</div>' : '') +
    '<table style="border-collapse:collapse;width:100%;border-top:1px solid #e2e8f0;border-bottom:2px solid #0a1628;margin:10px 0">' +
    rowHtml('Amount (ex GST)', _money(invRow.amount)) +
    rowHtml('GST (' + invRow.gst_rate + '%)', _money(invRow.gst)) +
    rowHtml('Total due', _money(invRow.total), true) +
    '</table>' +
    '<div><strong>Due:</strong> ' + esc(invRow.due_at ? new Date(invRow.due_at).toLocaleDateString('en-NZ') : 'on receipt') + '</div>' +
    (invSettings.bank_account ? '<div><strong>Pay by bank transfer to:</strong> ' + esc(invSettings.bank_account) + '</div>' : '') +
    '<div><strong>Reference:</strong> ' + esc(invRow.number) + '</div>' +
    (invSettings.footer ? '<p style="color:#5f6b7a;font-size:12.5px">' + esc(invSettings.footer) + '</p>' : '') +
    '</div>';
  return { subject: 'Invoice ' + invRow.number + ' from ' + coName + (invRow.site_address ? ' — ' + invRow.site_address : ''),
           text: lines.join('\n'), html: html };
}
// The business a message should appear to come from, out of their branding.
// Both blank (a tenant who has not filled in Settings → Branding) falls back
// to the platform identity rather than sending something nameless.
function _tenantMailIdentity(settingsRow){
  const b = ((settingsRow || {}).branding) || {};
  const name = String(b.company_name || '').trim();
  const email = String(b.email || '').trim();
  return { fromName: name || null, replyTo: /.@./.test(email) ? email : null };
}
async function _sendInvoice(invRow, settingsRow, to){
  const invSettings = _invoiceSettingsOf(settingsRow);
  const branding = (settingsRow || {}).branding || {};
  const recipient = String(to || invRow.client_email || '').trim();
  if (!recipient) throw new Error('No customer email on this invoice — add one and send again');
  const mail = _invoiceEmail(invRow, branding, invSettings);
  // A tax invoice for their job, from their roofer — not from us. A business
  // with a verified sending domain goes the whole way: their address too.
  const who = _tenantMailIdentity(settingsRow);
  await _dispatchMail({ to: recipient, subject: mail.subject, text: mail.text, html: mail.html,
                        fromName: who.fromName, replyTo: who.replyTo,
                        fromAddress: _tenantSendAddress(invRow.company_id, who.fromName, who.replyTo) });
  const patch = { status: 'sent', sent_at: new Date().toISOString(), client_email: recipient, updated_at: new Date().toISOString() };
  const { data } = await supabase.from('invoices').update(patch).eq('id', invRow.id).select('*').single();
  return data || Object.assign({}, invRow, patch);
}
function _scopeInvoices(q, req){
  if (req.companyId) {
    return q.or('company_id.eq.' + req.companyId + ',and(company_id.is.null,user_id.eq.' + req.user.id + ')');
  }
  return q.eq('user_id', req.user.id);
}

// All the company's invoices, newest first — the office overview.
app.get('/invoices', requireAuth, async (req, res) => {
  const { data, error } = await _scopeInvoices(
    supabase.from('invoices').select('*'), req).order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// This job's invoices.
app.get('/jobs/:id/invoices', requireAuth, async (req, res) => {
  const { data: job, error: je } = await _scopeCompany(
    supabase.from('jobs').select('id').eq('id', req.params.id), req).single();
  if (je || !job) return res.status(404).json({ error: 'Job not found' });
  const { data, error } = await supabase.from('invoices').select('*')
    .eq('job_id', req.params.id).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Raise an invoice on a job. The office passes the GST-inclusive figure it is
// charging (it knows the accepted total); percent is informational.
app.post('/jobs/:id/invoices', requireAuth, async (req, res) => {
  try {
    const { type, percent, total_incl, gst_rate, description } = req.body || {};
    if (INVOICE_TYPES.indexOf(String(type)) < 0) return res.status(400).json({ error: 'type must be deposit, progress or final' });
    const totalIncl = Number(total_incl);
    if (!isFinite(totalIncl) || totalIncl <= 0 || totalIncl > 10000000) return res.status(400).json({ error: 'total_incl must be a positive dollar figure' });
    const { data: job, error: je } = await _scopeCompany(
      supabase.from('jobs').select('id, user_id, company_id, client_name, site_address, draw_state').eq('id', req.params.id), req).single();
    if (je || !job) return res.status(404).json({ error: 'Job not found' });
    const settingsRow = await _companySettingsRow(req);
    const row = await _createInvoice({ job: job, type: String(type), percent: percent, totalIncl: totalIncl,
      gstRate: gst_rate, description: description, settingsRow: settingsRow });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Edits: drafts can change; a sent invoice can only move to paid or void.
app.put('/invoices/:id', requireAuth, async (req, res) => {
  try {
    const { data: cur, error: ce } = await _scopeInvoices(
      supabase.from('invoices').select('*').eq('id', req.params.id), req).single();
    if (ce || !cur) return res.status(404).json({ error: 'Invoice not found' });
    const b = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if (b.status != null){
      const to = String(b.status);
      if (INVOICE_STATUSES.indexOf(to) < 0) return res.status(400).json({ error: 'Unknown status' });
      const allowed = { draft: ['void', 'paid', 'sent'], sent: ['paid', 'void'], paid: [], void: [] };
      if (to !== cur.status && (allowed[cur.status] || []).indexOf(to) < 0)
        return res.status(400).json({ error: 'A ' + cur.status + ' invoice cannot become ' + to });
      patch.status = to;
      if (to === 'paid') patch.paid_at = new Date().toISOString();
      if (to === 'sent' && !cur.sent_at) patch.sent_at = new Date().toISOString();
    }
    if (cur.status === 'draft'){
      if (b.total_incl != null){
        const t = Number(b.total_incl);
        if (!isFinite(t) || t <= 0 || t > 10000000) return res.status(400).json({ error: 'total_incl must be a positive dollar figure' });
        Object.assign(patch, _invoiceMoney(t, b.gst_rate != null ? b.gst_rate : cur.gst_rate));
      }
      if (b.description != null) patch.description = String(b.description).slice(0, 500);
      if (b.client_email != null) patch.client_email = String(b.client_email).slice(0, 200);
      if (b.due_at != null && !isNaN(new Date(b.due_at))) patch.due_at = new Date(b.due_at).toISOString();
    }
    const { data, error } = await supabase.from('invoices').update(patch).eq('id', cur.id).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Email the invoice to the customer and mark it sent.
app.post('/invoices/:id/send', requireAuth, async (req, res) => {
  try {
    const { data: cur, error: ce } = await _scopeInvoices(
      supabase.from('invoices').select('*').eq('id', req.params.id), req).single();
    if (ce || !cur) return res.status(404).json({ error: 'Invoice not found' });
    if (cur.status === 'void') return res.status(400).json({ error: 'This invoice is void' });
    if (cur.status === 'paid') return res.status(400).json({ error: 'This invoice is already paid' });
    const settingsRow = await _companySettingsRow(req);
    const sent = await _sendInvoice(cur, settingsRow, (req.body || {}).to);
    res.json(sent);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// The acceptance hook: when a customer accepts and the business has a deposit
// configured, the deposit invoice raises itself — and goes straight out if
// auto-send is on and there is an address to send it to. Idempotent: a second
// accept event never raises a second deposit.
async function _autoDepositInvoice(job, quote){
  try {
    const settingsRow = await _settingsRowForJob(job);
    const inv = _invoiceSettingsOf(settingsRow);
    const acceptedTotal = Number(((quote || {}).accepted || {}).total);
    if (!isFinite(acceptedTotal) || acceptedTotal <= 0) return;
    const { data: existing } = await supabase.from('invoices').select('id')
      .eq('job_id', job.id).eq('type', 'deposit').limit(1);
    if (existing && existing.length) return;
    const row = await _createInvoice({
      job: job, type: 'deposit', percent: inv.deposit_percent,
      totalIncl: Math.round(acceptedTotal * inv.deposit_percent) / 100,
      gstRate: (quote && quote.gstRate) || 15,
      description: inv.deposit_percent + '% deposit on acceptance' + (job.site_address ? ' — ' + job.site_address : ''),
      settingsRow: settingsRow,
    });
    // An accepted total that cannot be a real answer to this quote still gets
    // an invoice raised — nothing is lost, and the roofer can see it — but it
    // is NEVER auto-emailed to the customer. Auto-send is the one step with no
    // human between a number from someone else's browser and a bill.
    const trustworthy = _acceptedTotalPlausible(quote, acceptedTotal);
    if (!trustworthy) {
      console.warn('[invoice] deposit left as a draft: accepted total ' + acceptedTotal +
        ' is not plausible against the ' + (((quote || {}).share) || {}).sentTotal + ' that was sent');
    }
    if (trustworthy && inv.auto_send_deposit && (row.client_email || '').trim()){
      try { await _sendInvoice(row, settingsRow); }
      catch (e) { console.warn('[invoice] deposit raised but auto-send failed:', e.message); }
    }
  } catch (e) { console.warn('[invoice] auto-deposit failed:', e.message); }
}

// Every job in the caller's scope that has a SHARED quote, as light rows:
// { id, client_name, share, ref, client, accepted }. One reader for the
// notification feed and the analytics endpoint, so the two can't disagree.
// Narrow JSON-path select first — the quote subtree carries roofMapGeom.bg
// (a ~1 MB base64 aerial each) and pulling it whole for a hundred jobs ran
// to hundreds of MB and timed out. Falls back to the whole-subtree shape for
// environments that choke on deep JSON-path selects.
async function _quoteShareRows(req, limit){
  const primary = await _scopeCompany(supabase.from('jobs')
    .select('id, client_name, ' +
            'q_share:draw_state->state->quote->share, ' +
            'q_ref:draw_state->state->quote->ref, ' +
            'q_client:draw_state->state->quote->client, ' +
            'q_accepted:draw_state->state->quote->accepted'), req)
    // Only jobs that have actually been SHARED — filtered on the token
    // expression (there's a functional index on it), so Postgres doesn't
    // decompress every job's multi-MB draw_state.
    .not('draw_state->state->quote->share->>token', 'is', null)
    .order('updated_at', { ascending: false }).limit(limit);
  if (!primary.error) {
    return (primary.data || []).map(function(j){
      return { id: j.id, client_name: j.client_name,
               share: j.q_share, ref: j.q_ref, client: j.q_client, accepted: j.q_accepted };
    }).filter(function(r){ return r.share && r.share.token; });
  }
  console.error('quote share rows narrow select failed, falling back:', primary.error.message, primary.error.hint || '');
  const fb = await _scopeCompany(supabase.from('jobs')
    .select('id, client_name, quote:draw_state->state->quote'), req)
    .not('draw_state->state->quote->share->>token', 'is', null)
    .order('updated_at', { ascending: false }).limit(limit);
  if (fb.error) { const err = new Error(fb.error.message); err.http = 500; throw err; }
  return (fb.data || []).map(function(j){
    const q = j.quote || {};
    return { id: j.id, client_name: j.client_name,
             share: q.share, ref: q.ref, client: q.client, accepted: q.accepted };
  }).filter(function(r){ return r.share && r.share.token; });
}

// Office home-screen feed: every job that has a shared quote, with its
// current status + last activity. Team and up — this is the quote
// notifications feature the Team tier sells.
app.get('/quote-activity', requireAuth, requirePlan('activity', 'Quote notifications', 'Team'), async (req, res) => {
  try {
    const rows = await _quoteShareRows(req, 120);
    const feed = rows.map(function(r){
      const sh = r.share;
      const lastEv = (sh.events && sh.events.length) ? sh.events[sh.events.length - 1] : null;
      return {
        jobId: r.id,
        client: r.client_name || r.client || '—',
        ref: r.ref || '',
        status: sh.status || 'sent',
        token: sh.token,
        openCount: sh.openCount || 0,
        lastOpenedAt: sh.lastOpenedAt || null,
        query: sh.query || null,
        accepted: r.accepted || null,
        lastEventAt: lastEv ? lastEv.at : (sh.lastOpenedAt || null),
        // The stamped history the in-app notification bell reads: every
        // customer open, question, acceptance and decline, each with its
        // ISO timestamp. Capped — the bell shows recent, not forever.
        events: (sh.events || []).slice(-12),
      };
    });
    res.json(feed);
  } catch (e) { console.error('quote-activity threw:', e && e.message); res.status(500).json({ error: e.message }); }
});

// The numbers behind the feed: of the quotes SENT in the window, how many
// were opened, accepted, declined — and how long acceptance takes. Kept
// server-side rather than derived from /quote-activity in the browser: that
// feed truncates to 120 jobs and 12 events, which is right for a bell and
// silently wrong for a rate.
function _quoteAnalyticsFrom(rows, days){
  const since = Date.now() - days * 86400000;
  let sent = 0, opened = 0, accepted = 0, declined = 0;
  const acceptDays = [];
  (rows || []).forEach(function(r){
    const sh = r.share || {};
    const sentAt = Date.parse(sh.sentAt || ((sh.events && sh.events[0]) || {}).at || '');
    if (!isFinite(sentAt) || sentAt < since) return;
    sent++;
    const evs = sh.events || [];
    const status = sh.status || 'sent';
    if ((sh.openCount || 0) > 0 || sh.lastOpenedAt ||
        evs.some(function(e){ return e && e.type === 'opened'; }) || status !== 'sent') opened++;
    const accAt = Date.parse(sh.acceptedAt || (r.accepted && r.accepted.at) || '');
    if (isFinite(accAt) || status === 'accepted' || r.accepted){
      accepted++;
      if (isFinite(accAt)) acceptDays.push((accAt - sentAt) / 86400000);
    } else if (status === 'declined' || sh.declinedAt) declined++;
  });
  acceptDays.sort(function(a, b){ return a - b; });
  const median = acceptDays.length
    ? acceptDays[Math.floor((acceptDays.length - 1) / 2)] : null;
  const pct = function(n){ return sent ? Math.round(100 * n / sent) : 0; };
  return { days: days, sent: sent, opened: opened, accepted: accepted, declined: declined,
           open_rate: pct(opened), accept_rate: pct(accepted),
           median_days_to_accept: median != null ? Math.round(median * 10) / 10 : null };
}
app.get('/quote-analytics', requireAuth, requirePlan('activity', 'Quote analytics', 'Team'), async (req, res) => {
  try {
    const days = String(req.query.days) === '90' ? 90 : 30;
    const rows = await _quoteShareRows(req, 500);
    res.json(_quoteAnalyticsFrom(rows, days));
  } catch (e) { console.error('quote-analytics threw:', e && e.message); res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// AUTOMATED QUOTE REMINDERS (Team+) — the follow-up a busy office forgets.
// A quote still sitting at 'sent' or 'opened' N days after it went out gets
// ONE polite nudge, from the roofer's own name, with the same live link.
// Never for 'queried' (the ball is in the office's court — nudging someone
// who asked a question reads as ignoring it), never for accepted/declined,
// never past the 90-day window the Accept button itself enforces, and never
// twice: share.remindedAt is the claim, written BEFORE the send, so a crash
// or a double-run can lose a reminder but can never duplicate one.
const REMINDER_EMAIL_DEFAULT = {
  subject: 'Following up on your roofing quote {ref} — {company}',
  body: 'Hi {client},\n\n' +
    'Just checking in on the roofing quote we sent{address}.\n\n' +
    'You can view it, pick your options and accept online any time:\n' +
    '{link}\n' +
    '{valid_until}' +
    'If anything is unclear, or you would like to talk it through, just reply ' +
    'to this email or give us a call — happy to help.\n\n' +
    'Kind regards,\n{company}\n{phone}{email}{website}',
};
// The same {placeholder} fill the office's quote email uses client-side.
function _fillEmailTemplate(tpl, vars){
  return String(tpl || '').replace(/\{(client|address|link|ref|company|valid_until|phone|email|website)\}/g,
    function(m, k){ return vars[k] != null ? vars[k] : ''; });
}
// Plain text → HTML with the customer link swapped for the big green button —
// the same rendering the original quote email got, so the follow-up matches.
function _reminderEmailHtml(message){
  const esc = function(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  const m = String(message || '').match(/https?:\/\/[^\s<]+/);
  const link = m ? m[0] : '';
  let htmlMsg = esc(message).replace(/\n/g, '<br>');
  if (link){
    const btn = '<div style="margin:16px 0"><a href="' + esc(link) + '" style="display:inline-block;background:#2eaa46;color:#ffffff;text-decoration:none;font-weight:800;font-size:19px;padding:17px 46px;border-radius:8px;font-family:Arial,Helvetica,sans-serif;letter-spacing:.2px">View this Quote</a></div>';
    htmlMsg = htmlMsg.split(esc(link)).join(btn);
  }
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0a1628;max-width:600px">' + htmlMsg + '</div>';
}
// The customer link, rebuilt with the same precedence the office's send
// uses: the business's verified custom domain → their RoofMap subdomain →
// the platform address. The old free-typed quote-domain setting is ignored
// on purpose: a typo'd domain with no DNS behind it once sent a real
// customer a link that resolved to nothing, and a reminder must never
// repeat that.
async function _reminderQuoteLink(job, share){
  let base = '';
  if (job.company_id){
    try {
      const { data } = await supabase.from('company_domains').select('domain')
        .eq('company_id', job.company_id).eq('status', 'verified').limit(1);
      if (data && data[0] && data[0].domain) base = 'https://' + String(data[0].domain).toLowerCase();
    } catch (e) {}
    if (!base){
      try {
        const { data } = await supabase.from('companies').select('slug').eq('id', job.company_id).maybeSingle();
        if (data && data.slug) base = 'https://' + String(data.slug).toLowerCase() + '.roofmap.co.nz';
      } catch (e) {}
    }
  }
  if (!base) base = PUBLIC_APP_URL;
  let link = base + '/?q=' + share.token;
  if (job.ref) link += '&j=' + encodeURIComponent(String(job.ref).replace(/[^A-Za-z0-9\-]/g, ''));
  link += '&i=' + encodeURIComponent(String(job.id));
  return link;
}
const REMINDERS_ENABLED = String(process.env.QUOTE_REMINDERS_ENABLED || 'true') !== 'false';
async function _reminderSweep(){
  const out = { checked: 0, sent: 0, skipped: 0, errors: 0 };
  // Every shared, never-reminded quote across ALL companies, as light rows.
  // Status and age are judged in JS: legacy shares have no status key and a
  // PostgREST filter on it would silently drop them.
  const q = await supabase.from('jobs')
    .select('id, user_id, company_id, client_name, ' +
            'q_share:draw_state->state->quote->share, ' +
            'q_ref:draw_state->state->quote->ref, ' +
            'q_client:draw_state->state->quote->client, ' +
            'q_email:draw_state->state->quote->email, ' +
            'q_addr:draw_state->state->quote->addr, ' +
            'q_valid:draw_state->state->quote->validUntil, ' +
            'f_email:draw_state->form->jobEmail')
    .not('draw_state->state->quote->share->>token', 'is', null)
    .is('draw_state->state->quote->share->>remindedAt', null)
    .gte('updated_at', new Date(Date.now() - 120 * 86400000).toISOString())
    .order('updated_at', { ascending: false }).limit(500);
  if (q.error) { console.error('[reminders] candidate query failed: ' + q.error.message); out.errors++; return out; }
  const rows = (q.data || []).filter(function(r){ return r.q_share && r.q_share.token; });
  if (!rows.length) return out;
  // One plan lookup per company, not per job. Solo companies send nothing —
  // reminders are a Team feature, and the server is where that is true.
  const planByCo = new Map();
  const coIds = Array.from(new Set(rows.map(function(r){ return r.company_id; }).filter(Boolean)));
  if (coIds.length){
    try {
      const { data } = await supabase.from('companies').select('id, plan').in('id', coIds);
      (data || []).forEach(function(c){ planByCo.set(c.id, c.plan || 'trial'); });
    } catch (e) {}
  }
  const settingsCache = new Map();   // company_id|user_id → settings row (or null)
  for (const r of rows){
    out.checked++;
    try {
      const plan = r.company_id ? (planByCo.get(r.company_id) || 'trial') : 'trial';
      if (!_limitsFor(plan).reminders) { out.skipped++; continue; }
      const sKey = r.company_id || ('u:' + r.user_id);
      if (!settingsCache.has(sKey)) settingsCache.set(sKey, await _settingsRowForJob(r));
      const settingsRow = settingsCache.get(sKey);
      const em = (((settingsRow || {}).quote_defaults) || {}).email || {};
      if (em.reminder_enabled !== true) { out.skipped++; continue; }
      let days = Number(em.reminder_days);
      days = (isFinite(days) && days >= 1 && days <= 30) ? days : 3;
      const sh = r.q_share;
      const status = sh.status || 'sent';
      if (status !== 'sent' && status !== 'opened') { out.skipped++; continue; }
      const sentAt = Date.parse(sh.sentAt || ((sh.events && sh.events[0]) || {}).at || '');
      if (!isFinite(sentAt)) { out.skipped++; continue; }          // no send date — never guess
      const age = Date.now() - sentAt;
      if (age < days * 86400000) { out.skipped++; continue; }      // too young
      if (age > SHARE_ACTION_DAYS * 86400000) { out.skipped++; continue; }  // Accept refuses anyway
      const to = String(sh.sentTo || r.q_email || r.f_email || '').trim();
      if (!/.@./.test(to)) { out.skipped++; continue; }            // nowhere to send it
      // Claim-then-send on a FRESH copy: a customer may have accepted (or the
      // office reminded from another box) between the list query and now.
      const fresh = await supabase.from('jobs')
        .select('id, company_id, quote:draw_state->state->quote').eq('id', r.id).single();
      if (fresh.error || !fresh.data || !fresh.data.quote) { out.skipped++; continue; }
      const quote = fresh.data.quote;
      const fsh = quote.share || {};
      const fStatus = fsh.status || 'sent';
      if (fsh.remindedAt || (fStatus !== 'sent' && fStatus !== 'opened')) { out.skipped++; continue; }
      const now = new Date().toISOString();
      fsh.remindedAt = now;
      fsh.events = Array.isArray(fsh.events) ? fsh.events : [];
      fsh.events.push({ type: 'reminded', at: now });
      if (fsh.events.length > 80) fsh.events = fsh.events.slice(-80);
      quote.share = fsh;
      await _saveQuoteBack({ id: r.id }, quote);
      // The claim is down; from here a failure loses one reminder, never
      // duplicates one.
      const br = ((settingsRow || {}).branding) || {};
      const company = String(br.company_name || '').trim() || 'the team';
      const link = await _reminderQuoteLink({ id: r.id, company_id: r.company_id, ref: r.q_ref }, fsh);
      const vars = {
        client: quote.client || r.q_client || r.client_name || '',
        address: (quote.addr || r.q_addr) ? (' at ' + (quote.addr || r.q_addr)) : '',
        link: link + '\n',
        ref: quote.ref || r.q_ref || '',
        company: company,
        valid_until: (quote.validUntil || r.q_valid) ? ('\nQuote valid until: ' + (quote.validUntil || r.q_valid) + '\n') : '',
        phone: br.phone ? (br.phone + '\n') : '',
        email: br.email ? (br.email + '\n') : '',
        website: br.website || '',
      };
      const subject = _fillEmailTemplate(em.reminder_subject || REMINDER_EMAIL_DEFAULT.subject, vars)
        .replace(/\s{2,}/g, ' ').trim();
      const body = _fillEmailTemplate(em.reminder_body || REMINDER_EMAIL_DEFAULT.body, vars)
        .replace(/\n{3,}/g, '\n\n');
      const who = _tenantMailIdentity(settingsRow);
      const cc = String(em.quote_cc || '').trim() || undefined;
      await _dispatchMail({ to: to, cc: cc, subject: subject, text: body,
                            html: _reminderEmailHtml(body),
                            fromName: who.fromName, replyTo: who.replyTo,
                            fromAddress: _tenantSendAddress(r.company_id, who.fromName, who.replyTo) });
      out.sent++;
    } catch (e) {
      out.errors++;
      console.error('[reminders] job ' + r.id + ': ' + (e && e.message));
    }
  }
  return out;
}
// The watermark keeps the cadence to a few sweeps a day across redeploys;
// per-quote idempotence lives in remindedAt, not here.
async function _reminderDue(){
  try {
    const r = await supabase.from('platform_state').select('value').eq('key', 'quote_reminders').maybeSingle();
    const last = Date.parse(((r.data || {}).value || {}).last_run_at || '');
    return !isFinite(last) || (Date.now() - last) > 6 * 3600e3;
  } catch (e) { return false; }
}
async function _reminderTick(){
  try {
    if (!EMAIL_ENABLED || !REMINDERS_ENABLED) return;
    if (!(await _reminderDue())) return;
    await supabase.from('platform_state').upsert(
      { key: 'quote_reminders', value: { last_run_at: new Date().toISOString() },
        updated_at: new Date().toISOString() }, { onConflict: 'key' });
    const r = await _reminderSweep();
    if (r.sent || r.errors) console.log('[reminders] checked ' + r.checked + ', sent ' + r.sent +
      ', skipped ' + r.skipped + ', errors ' + r.errors);
  } catch (e) { console.error('[reminders] tick failed: ' + (e && e.message)); }
}
// Ops/tests: run the sweep NOW, ignoring the watermark. Same lock as the
// other admin routes — no token, no route.
app.post('/admin/reminders/run', async (req, res) => {
  if (!_adminOk(req)) return res.status(404).json({ error: 'Not found' });
  try { res.json(await _reminderSweep()); }
  catch (e) { res.status(500).json({ error: e.message }); }
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
app.all('/fergus/*', requireAuth, requireSubscription,
  requirePlan('jms', 'The Fergus job-system link', 'Business'), async (req, res) => {
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

app.post('/fergus-files/upload', requireAuth, requireSubscription,
  requirePlan('jms', 'The Fergus job-system link', 'Business'), async (req, res) => {
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
  const method = RESEND_ENABLED ? 'resend' : (GAS_ENABLED ? 'google' : 'smtp');
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
    if (RESEND_ENABLED) {
      const keyCheck = await _resendVerifyKey();
      if (!EMAIL_FROM) throw new Error('RESEND_API_KEY is set but EMAIL_FROM is missing — add EMAIL_FROM="RoofMap <noreply@roofmap.co.nz>" (the domain must be verified in Resend → Domains).');
      res.json(Object.assign({}, info, { verify: true,
        note: (keyCheck.note ? keyCheck.note + ' ' : '') + 'Sending via Resend as ' + EMAIL_FROM +
              (GAS_ENABLED ? ' — Google relay standing by as fallback.' : '') }));
    } else if (GAS_ENABLED) {
      await _gasVerify();
      res.json(Object.assign({}, info, { verify: true, note: 'Sending via Google Workspace relay as ' + (EMAIL_FROM || 'office@floodroofing.co.nz') + '.' }));
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

// ══════════════════════════════════════════════════════════════════
// OWN-DOMAIN SENDING — a business's quotes from its OWN address
// ══════════════════════════════════════════════════════════════════
// Today every message leaves on the platform's verified domain wearing the
// subscriber's display name, with replies pointed at them. Good, but the
// From line still says roofmap.co.nz. A business that owns its domain can do
// better: we register the domain with Resend on their behalf, show them the
// DNS records to add (same self-onboarding shape as the quote-domain flow
// above), and once Resend confirms the records, their mail genuinely sends
// from office@theircompany.co.nz — DKIM-signed by their own domain.
async function _resendDomainsApi(method, path, body){
  const resp = await fetch(RESEND_API_BASE + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + RESEND_API_KEY },
                           body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined });
  const txt = await resp.text();
  let data = null; try { data = JSON.parse(txt); } catch (e) {}
  // A key scoped to "Sending access" can send mail but not manage domains.
  // That is a platform misconfiguration, not the subscriber's fault — name
  // the fix instead of surfacing Resend's cryptic 401.
  if (resp.status === 401 && data && data.name === 'restricted_api_key') {
    const err = new Error('The platform\'s email key can send but not manage domains — RESEND_API_KEY needs "Full access" for this feature. Tell support.');
    err.status = 503; throw err;
  }
  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error((data && data.message) || ('Resend responded ' + resp.status));
    err.status = resp.status; throw err;
  }
  return data || {};
}
// The DNS records a subscriber must add, passed through from Resend
// verbatim — inventing our own rendering of SPF/DKIM values is how typos
// happen. Only the fields the settings screen needs.
function _mailDomainRow(d){
  return {
    id: d.id, domain: d.domain, from_email: d.from_email, status: d.status,
    records: d.records || null, error: d.last_error || '',
    created_at: d.created_at, verified_at: d.verified_at,
  };
}
// Mailbox providers whose DNS a roofer cannot edit. An address there can
// never verify — say so up front instead of handing them SPF records for
// gmail.com.
const _FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'outlook.co.nz',
  'hotmail.com', 'hotmail.co.nz', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.nz',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'xtra.co.nz', 'gmx.com', 'gmx.net', 'zoho.com', 'slingshot.co.nz', 'orcon.net.nz']);
// Reload NOW and wait for it — called after add/verify/remove so the send
// path sees the new state before the owner's next click.
async function _reloadMailDomains(){
  try {
    const { data, error } = await supabase.from('company_mail_domains')
      .select('company_id, domain, from_email').eq('status', 'verified');
    if (error) return;
    const by = new Map(), set = new Set();
    (data || []).forEach(function (d) {
      const dom = String(d.domain || '').toLowerCase();
      const em = String(d.from_email || '').toLowerCase();
      if (!dom || !em) return;
      set.add(dom); by.set(String(d.company_id), em);
    });
    _mailDomains.byCompany = by; _mailDomains.domains = set; _mailDomains.at = Date.now();
  } catch (e) { console.warn('[maildomain] reload failed:', e.message); }
}
function _refreshMailDomains(){
  if (_mailDomains.loading) return;
  if (Date.now() - _mailDomains.at < 5 * 60 * 1000) return;
  _mailDomains.loading = true;
  _reloadMailDomains().then(function () { _mailDomains.loading = false; });
}

// ── WHO ACTUALLY MANAGES THEIR DNS ──────────────────────────────────
// "Add these records where your domain is managed" is a riddle to most
// roofers — they don't know where that is. The nameservers answer it: look
// them up, name the company, and hand over that host's exact login door and
// menu path. Covers the handful of hosts behind nearly every NZ domain;
// anything else gets honest generic advice rather than a wrong guess.
const _NS_PROVIDERS = [
  { re: /cloudflare\.com$/i,     name: 'Cloudflare',    url: 'https://dash.cloudflare.com',          path: 'pick the domain → DNS → Records → Add record (set Proxy status to "DNS only" — the grey cloud)' },
  { re: /domaincontrol\.com$/i,  name: 'GoDaddy',       url: 'https://dcc.godaddy.com/domains',      path: 'pick the domain → DNS → Add New Record' },
  { re: /1stdomains/i,           name: '1stDomains',    url: 'https://1stdomains.nz',                path: 'log in → Domain manager → the domain → DNS Zone Records' },
  { re: /freeparking/i,          name: 'Freeparking',   url: 'https://www.freeparking.co.nz',        path: 'log in → My Domains → the domain → Manage DNS' },
  { re: /crazydomains/i,         name: 'Crazy Domains', url: 'https://www.crazydomains.co.nz',       path: 'log in → My Account → Domains → the domain → DNS Settings' },
  { re: /rocketspark/i,          name: 'Rocketspark',   url: 'https://www.rocketspark.com',          path: 'log in → Settings → Domains → the domain → DNS Settings' },
  { re: /vercel-dns\.com$/i,     name: 'Vercel',        url: 'https://vercel.com/dashboard/domains', path: 'pick the domain → DNS Records' },
  { re: /sitehost/i,             name: 'SiteHost',      url: 'https://cp.sitehost.nz',               path: 'log in → Domains → DNS Zones → the domain' },
  { re: /onlydomains/i,          name: 'OnlyDomains',   url: 'https://www.onlydomains.com',          path: 'log in → My Domains → the domain → DNS Management' },
  { re: /metaname/i,             name: 'Metaname',      url: 'https://metaname.net',                 path: 'log in → the domain → DNS records' },
  { re: /squarespace/i,          name: 'Squarespace',   url: 'https://account.squarespace.com',      path: 'Domains → the domain → DNS Settings → Custom Records' },
  { re: /wixdns/i,               name: 'Wix',           url: 'https://manage.wix.com',               path: 'Domains → the domain → Manage DNS Records' },
  { re: /registrar-servers\.com$/i, name: 'Namecheap',  url: 'https://ap.www.namecheap.com',         path: 'Domain List → Manage → Advanced DNS' },
];
function _mailDnsProviderFromNs(nsList){
  for (const ns of (nsList || [])) {
    const h = String(ns || '').toLowerCase().replace(/\.$/, '');
    for (const p of _NS_PROVIDERS) if (p.re.test(h)) return { name: p.name, url: p.url, path: p.path, ns: h };
  }
  return null;
}
const _nsCache = new Map();   // domain → { at, provider }
async function _mailDnsProvider(domain){
  const d = String(domain || '').toLowerCase();
  if (!d) return null;
  const hit = _nsCache.get(d);
  if (hit && Date.now() - hit.at < 3600e3) return hit.provider;
  let provider = null;
  try {
    // Tests hand in a fixture; production asks the resolver.
    let nsList;
    if (process.env.NS_FIXTURE) nsList = (JSON.parse(process.env.NS_FIXTURE) || {})[d] || [];
    else nsList = await require('dns').promises.resolveNs(d);
    provider = _mailDnsProviderFromNs(nsList);
  } catch (e) { /* NXDOMAIN, timeouts, no resolver — the hint is optional */ }
  _nsCache.set(d, { at: Date.now(), provider: provider });
  return provider;
}
async function _mailDomainRowFull(d){
  const row = _mailDomainRow(d);
  try { row.provider = await _mailDnsProvider(d.domain); } catch (e) { row.provider = null; }
  return row;
}

app.get('/email/domain', requireAuth, async (req, res) => {
  const allowed = !!_limitsFor(await _planOf(req.companyId)).maildomain;
  if (!req.companyId) return res.json({ enabled: RESEND_ENABLED, allowed: allowed, domain: null });
  try {
    const { data } = await supabase.from('company_mail_domains').select('*')
      .eq('company_id', req.companyId).maybeSingle();
    res.json({ enabled: RESEND_ENABLED, allowed: allowed, domain: data ? await _mailDomainRowFull(data) : null });
  } catch (e) { res.json({ enabled: RESEND_ENABLED, allowed: allowed, domain: null }); }
});

// The roofer rarely does their own DNS — but they all know SOMEBODY who
// does. One button mails that person a self-contained copy of the records,
// with replies going back to the roofer, so the roofer's whole job is
// typing one email address.
app.post('/email/domain/instructions', requireAuth, requireOwner, rateLimit(10, 3600000), async (req, res) => {
  if (!EMAIL_ENABLED) return res.status(503).json({ error: 'Email is not configured on the server yet.' });
  const to = String((req.body || {}).to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Enter the email address of whoever manages your website or domain.' });
  try {
    const { data: row } = await supabase.from('company_mail_domains').select('*')
      .eq('company_id', req.companyId).maybeSingle();
    if (!row) return res.status(404).json({ error: 'No sending domain set up yet.' });
    const provider = await _mailDnsProvider(row.domain);
    const recs = row.records || [];
    const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const who = String((req.user && req.user.email) || '').trim();
    const lines = [
      'Hi,', '',
      who + ' has asked for ' + row.domain + ' to be set up so their quoting system (RoofMap) can send email from ' + row.from_email + '.',
      '', 'That needs these DNS records added to ' + row.domain +
      (provider ? (' — its nameservers point at ' + provider.name + ' (' + provider.url + '; ' + provider.path + ')') : '') + ':', ''];
    recs.forEach(function (r) {
      lines.push('  Type: ' + (r.type || '') + '   Name/Host: ' + (r.name || '') +
        (r.priority != null ? ('   Priority: ' + r.priority) : '') + '\n  Value: ' + (r.value || ''), '');
    });
    lines.push('Notes: enter the Name exactly as shown (the DNS host usually appends the domain itself); leave TTL at its default; on Cloudflare set Proxy status to "DNS only" (grey cloud).',
      '', 'Once the records are in, ' + (who || 'the requester') + ' taps "Check now" in RoofMap and verification completes automatically. Replying to this email reaches ' + (who || 'them') + ' directly.');
    const rowsHtml = recs.map(function (r) {
      return '<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:monospace">' + esc(r.type) + '</td>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:monospace;word-break:break-all">' + esc(r.name) + '</td>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:monospace;word-break:break-all">' + esc(r.value) + '</td>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:monospace">' + esc(r.priority != null ? r.priority : '—') + '</td></tr>';
    }).join('');
    const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;color:#1c2733;line-height:1.6;max-width:640px">' +
      '<p><strong>' + esc(who) + '</strong> has asked for <strong>' + esc(row.domain) + '</strong> to be set up so their quoting system (RoofMap) can send email from <strong>' + esc(row.from_email) + '</strong>.</p>' +
      '<p>That needs these DNS records added to ' + esc(row.domain) +
      (provider ? (' — its nameservers point at <strong>' + esc(provider.name) + '</strong> (<a href="' + esc(provider.url) + '">' + esc(provider.url) + '</a>; ' + esc(provider.path) + ')') : '') + ':</p>' +
      '<table style="border-collapse:collapse;font-size:12.5px"><tr>' +
      '<th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left">Type</th><th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left">Name / Host</th><th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left">Value</th><th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left">Priority</th></tr>' +
      rowsHtml + '</table>' +
      '<p style="font-size:12.5px;color:#5f6b7a">Enter the Name exactly as shown (the DNS host usually appends the domain itself); leave TTL at its default; on Cloudflare set Proxy status to “DNS only” (grey cloud).</p>' +
      '<p>Once the records are in, ' + esc(who || 'the requester') + ' taps <em>Check now</em> in RoofMap and verification completes automatically. Replying to this email reaches ' + esc(who || 'them') + ' directly.</p></div>';
    await _dispatchMail({ to: to, cc: who || undefined,
      subject: 'DNS records for ' + row.domain + ' — email setup for ' + row.from_email,
      text: lines.join('\n'), html: html, replyTo: who || undefined });
    res.json({ ok: true, sent_to: to });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Claim it: register the domain with Resend and hand back the DNS records.
app.post('/email/domain', requireAuth, requireOwner,
  requirePlan('maildomain', 'Sending from your own email address', 'Team'), rateLimit(10, 3600000), async (req, res) => {
  if (!RESEND_ENABLED) return res.status(503).json({ error: 'Own-domain sending is not switched on for this server yet.', code: 'MAILDOMAIN_DISABLED' });
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter the address you send from, like office@yourcompany.co.nz.' });
  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (_FREEMAIL.has(domain)) return res.status(400).json({ error: 'That is a ' + domain + ' mailbox — only a domain you own (and can add DNS records to) can be verified. A Gmail or Xtra address can\'t send this way; it stays as your reply-to address instead.' });
  if (domain === _mailSendingDomain() || (TENANT_MAIL_DOMAIN && domain === TENANT_MAIL_DOMAIN)) return res.status(400).json({ error: 'That domain is the platform\'s own — your mail already sends from it.' });
  try {
    const { data: claimed } = await supabase.from('company_mail_domains').select('id, company_id').ilike('domain', domain);
    if ((claimed || []).some(function (c) { return String(c.company_id) !== String(req.companyId); }))
      return res.status(409).json({ error: 'That domain is already verified by another RoofMap account.' });
    if ((claimed || []).length) return res.status(400).json({ error: 'You have already added that domain — remove it first to start over.' });
    const { data: mine } = await supabase.from('company_mail_domains').select('id').eq('company_id', req.companyId);
    if ((mine || []).length) return res.status(400).json({ error: 'You already have a sending domain set up — remove it before adding a different one.' });
    let created;
    try { created = await _resendDomainsApi('POST', '/domains', { name: domain }); }
    catch (e) {
      // Resend's "You have reached the domain limit of your plan. Upgrade to
      // add more." is about OUR Resend account, but shown verbatim it reads
      // as the subscriber's RoofMap plan — an owner on the right tier being
      // told to upgrade for a problem that is ours to fix. Translate it, and
      // page the platform: this is a capacity ceiling someone has to raise.
      if (/domain limit/i.test(e.message || '')) {
        try { recordError('server', new Error('Resend domain limit reached — a subscriber tried to add ' + domain + ' and was turned away. Upgrade the Resend plan (Dashboard → Billing) to raise the domain allowance.'), { route: '/email/domain' }); } catch (e2) {}
        return res.status(503).json({ error: 'Own-domain sending is temporarily at capacity on our side — nothing wrong with your account or your plan. We\'ve been notified; please try again in a day or two.' });
      }
      throw e;
    }
    const row = {
      company_id: req.companyId, domain: domain, from_email: email,
      resend_id: created.id || null, status: 'pending',
      records: created.records || null, created_by: req.user.id,
      last_checked_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('company_mail_domains').insert(row).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ domain: await _mailDomainRowFull(data) });
  } catch (e) { res.status(e.status && e.status < 500 ? 400 : (e.status || 500)).json({ error: e.message }); }
});

// "I've added the records" — ask Resend to re-check, then read the result.
app.post('/email/domain/verify', requireAuth, requireOwner, rateLimit(60, 3600000), async (req, res) => {
  if (!RESEND_ENABLED) return res.status(503).json({ error: 'Own-domain sending is not switched on for this server yet.' });
  try {
    const { data: row } = await supabase.from('company_mail_domains').select('*')
      .eq('company_id', req.companyId).maybeSingle();
    if (!row || !row.resend_id) return res.status(404).json({ error: 'No sending domain set up yet.' });
    // The verify call kicks Resend's DNS check; the GET reads where it got to.
    // Both, because verify alone answers "started", not "passed".
    try { await _resendDomainsApi('POST', '/domains/' + encodeURIComponent(row.resend_id) + '/verify'); } catch (e) { /* a check already running answers 4xx — the GET below is the truth */ }
    const d = await _resendDomainsApi('GET', '/domains/' + encodeURIComponent(row.resend_id));
    const ready = String(d.status || '') === 'verified';
    const patch = {
      status: ready ? 'verified' : 'pending',
      records: d.records || row.records || null,
      last_error: ready ? null : 'The DNS records aren\'t all visible yet. It can take a few minutes — up to 24 hours on some registrars.',
      last_checked_at: new Date().toISOString(),
      verified_at: ready ? (row.verified_at || new Date().toISOString()) : null,
    };
    const { data } = await supabase.from('company_mail_domains').update(patch).eq('id', row.id).select('*').single();
    await _reloadMailDomains();
    res.json({ domain: await _mailDomainRowFull(data || Object.assign({}, row, patch)) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.delete('/email/domain', requireAuth, requireOwner, async (req, res) => {
  try {
    const { data: row } = await supabase.from('company_mail_domains').select('*')
      .eq('company_id', req.companyId).maybeSingle();
    if (!row) return res.status(404).json({ error: 'No sending domain set up.' });
    if (RESEND_ENABLED && row.resend_id) {
      // Best effort — if Resend refuses, still let go of it our side rather
      // than leaving the owner stuck with a domain they can't remove.
      try { await _resendDomainsApi('DELETE', '/domains/' + encodeURIComponent(row.resend_id)); }
      catch (e) { console.warn('[maildomain] Resend removal failed:', e.message); }
    }
    await supabase.from('company_mail_domains').delete().eq('id', row.id);
    await _reloadMailDomains();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    // Sent on the subscriber's behalf — to a supplier, their crew, or their
    // customer — so it goes out under their name with replies pointed at them,
    // not at us. A tenant who has not filled in Branding keeps the platform
    // identity rather than sending something nameless.
    let _who = { fromName: null, replyTo: null };
    try { _who = _tenantMailIdentity(await _companySettingsRow(req)); } catch (e) {}
    const mail = { to, cc, subject, text, html: (html ? String(html).slice(0, 200000) : undefined),
                   attachment, fromName: _who.fromName, replyTo: _who.replyTo,
                   fromAddress: _tenantSendAddress(req.companyId, _who.fromName, _who.replyTo) };
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

// ══════════════════════════════════════════════════════════════════
// FEEDBACK — a bug report or an idea, straight to the support desk
// ══════════════════════════════════════════════════════════════════
// This used to ride on /email/send-order, which exists to send mail ON THE
// SUBSCRIBER'S BEHALF: it stamps the message with their business name and
// points replies at their branding address. That is exactly wrong here.
// A bug report is addressed TO us, and the one thing support needs is to be
// able to hit Reply and reach the person who hit the button — not the
// company's generic office mailbox, and not a hardcoded address of ours.
//
// So: fixed recipient (the support desk), From our own support mailbox, and
// Reply-To taken from the AUTHENTICATED session rather than the request body,
// because a reply-to a caller can choose is a reply-to an attacker can choose.
app.post('/feedback', requireAuth, rateLimit(6, 60000), async (req, res) => {
  if (!EMAIL_ENABLED) {
    return res.status(503).json({ error: 'Email is not configured on the server yet.', code: 'EMAIL_NOT_CONFIGURED' });
  }
  try {
    const b = req.body || {};
    const kind = String(b.kind || 'feedback').toLowerCase() === 'jms' ? 'jms' : 'feedback';
    const title = String(b.title || '').trim().slice(0, 200);
    if (!title) return res.status(400).json({ error: 'A short title is required' });
    const attachment = (b.attachment && b.attachment.base64) ? b.attachment : null;
    if (attachment && String(attachment.base64).length > 20 * 1024 * 1024) {
      return res.status(413).json({ error: 'Attachment too large' });
    }
    if (attachment) attachment.filename = String(attachment.filename || 'feedback.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
    // Who sent it, from the token — not from anything the page claimed.
    const from = String((req.user && req.user.email) || '').trim();
    let company = '';
    try {
      const row = await _companySettingsRow(req);
      company = String((((row || {}).branding) || {}).company_name || '').trim();
    } catch (e) {}
    const subject = (kind === 'jms' ? 'RoofMap JMS request: ' : 'RoofMap Feedback: ') + title;
    // The support desk's inbox list is the first thing read, so the sender's
    // name goes in the display name and their address in Reply-To.
    const who = [company, from].filter(Boolean).join(' · ') || 'a RoofMap user';
    const mail = {
      to: MAIL_SUPPORT,
      subject: subject,
      text: String(b.text || title),
      html: b.html ? String(b.html).slice(0, 200000) : undefined,
      attachment: attachment || undefined,
      fromName: 'RoofMap Feedback — ' + who,
      fromAddress: MAIL_SUPPORT,
      replyTo: /.@./.test(from) ? from : undefined,
    };
    const info = await _dispatchMail(mail);
    res.json({ ok: true, id: (info && info.messageId) || null, to: MAIL_SUPPORT, replyTo: mail.replyTo || null });
  } catch (e) {
    console.error('feedback email failed:', e.message);
    res.status(502).json({ error: 'Email send failed: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// EARLY ACCESS — the waitlist, and getting people off it
// ══════════════════════════════════════════════════════════════════
// RoofMap is invite-gated (see /auth/register). This is the front door to
// that gate: a roofer asks for access, somebody looks at who they are, and
// they get invited in a batch. The qualifying answers are the point — a
// five-quotes-a-week outfit on spreadsheets is a different lead from a
// one-man band on paper, and "what do you run now?" decides what gets built.
const WAITLIST_VOLUMES = ['1-2', '3-5', '6-10', '10+', 'unsure'];
const WAITLIST_SOFTWARE = ['fergus', 'tradify', 'servicem8', 'simpro', 'spreadsheet', 'paper', 'other'];
const WAITLIST_STATUSES = ['new', 'invited', 'joined', 'declined'];
function _wlClean(v, max){ return String(v == null ? '' : v).trim().slice(0, max || 200); }
function _wlPick(v, allowed){
  const x = _wlClean(v, 40).toLowerCase();
  return allowed.indexOf(x) >= 0 ? x : '';
}

// Public. Rate-limited per IP — but not so tightly that a real person gets
// locked out: a rejected address still counts against the window, so somebody
// who mistypes their email twice and corrects it has already spent three. A
// whole roofing company can also share one address behind NAT. Spam volume is
// bounded by the unique-email upsert rather than by this number anyway, so the
// limit is here to stop a flood, not to ration honest use.
app.post('/waitlist', rateLimit(10, 3600000), async (req, res) => {
  try {
    const b = req.body || {};
    // The honeypot. A field no human sees and no human fills in; a bot fills
    // in everything. Answer 200 either way — telling a bot it was caught just
    // teaches whoever wrote it to stop filling that field in.
    if (_wlClean(b.website, 100)) {
      console.log('[waitlist] honeypot tripped — discarded');
      return res.json({ ok: true });
    }
    const email = _wlClean(b.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    const row = {
      email: email,
      name: _wlClean(b.name, 120),
      business: _wlClean(b.business, 160),
      phone: _wlClean(b.phone, 40),
      region: _wlClean(b.region, 60),
      volume: _wlPick(b.volume, WAITLIST_VOLUMES),
      current_software: _wlPick(b.current_software, WAITLIST_SOFTWARE),
      headache: _wlClean(b.headache, 1000),
      source: _wlClean(b.source, 300),
      updated_at: new Date().toISOString(),
    };
    // Upsert on the email. Somebody who fills the form in twice — a month
    // later, with a better answer — should improve their entry, not appear
    // twice in a list that gets worked by hand.
    const { data, error } = await supabase.from('waitlist')
      .upsert(row, { onConflict: 'email' }).select('id, created_at').single();
    if (error) {
      console.error('[waitlist] store failed:', error.message);
      return res.status(500).json({ error: 'Could not save that — try again in a moment.' });
    }

    // Two emails, neither of which blocks the response: a slow relay must not
    // make the form feel broken to somebody standing on a roof.
    const who = [row.business, row.name].filter(Boolean).join(' · ') || email;
    const nice = (k, v) => v ? (k + ': ' + v + '\n') : '';
    const lead =
      'New RoofMap early-access request\n\n' +
      nice('Business', row.business) + nice('Name', row.name) +
      'Email: ' + email + '\n' +
      nice('Phone', row.phone) + nice('Region', row.region) +
      nice('Roofs quoted a month', row.volume) +
      nice('Runs on now', row.current_software) +
      (row.headache ? ('\nBiggest headache:\n' + row.headache + '\n') : '') +
      nice('\nCame from', row.source) +
      '\nInvite them: POST /admin/waitlist/' + (data && data.id) + '/invite\n';
    if (EMAIL_ENABLED) {
      _dispatchMail({
        to: MAIL_SALES, subject: 'Early access: ' + who,
        text: lead, fromName: 'RoofMap Early Access',
        fromAddress: MAIL_SALES, replyTo: email,
      }).catch(function(e){ console.error('[waitlist] lead alert failed:', e.message); });

      // And a receipt for them, with something in it. A confirmation that
      // only says "thanks, we'll be in touch" wastes the one moment they are
      // definitely paying attention.
      const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const theirs =
        'Thanks — you are on the list for RoofMap early access.\n\n' +
        'We are letting roofing businesses in a batch at a time so everyone gets set up\n' +
        'properly rather than left to work it out alone. You will hear from us directly.\n\n' +
        'In the meantime, this is a real quote produced by RoofMap, start to finish:\n' +
        PUBLIC_APP_URL + '/\n\n' +
        'Reply to this email if you want to tell us anything else about your setup —\n' +
        'it reaches a person.\n\n' +
        '— RoofMap, by Flood Roofing\n';
      _dispatchMail({
        to: email, subject: 'You are on the list — RoofMap early access',
        text: theirs,
        html: '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#0a1628;max-width:560px">' +
          '<div style="font-size:12px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#0099cc">RoofMap early access</div>' +
          '<h2 style="font-size:20px;margin:10px 0 14px">You are on the list' + (row.name ? (', ' + esc(row.name)) : '') + '.</h2>' +
          '<p style="margin:0 0 14px">We are letting roofing businesses in a batch at a time, so everyone gets set up properly rather than left to work it out alone. You will hear from us directly.</p>' +
          '<p style="margin:0 0 18px">In the meantime, have a look at what RoofMap actually produces — a measured roof, a cut list and a quote a customer can accept online.</p>' +
          '<p style="margin:0 0 20px"><a href="' + esc(PUBLIC_APP_URL) + '/" style="display:inline-block;background:#0a1628;color:#fff;padding:12px 22px;border-radius:9px;text-decoration:none;font-weight:700">See what it produces</a></p>' +
          '<p style="font-size:13px;color:#5f6b7a;margin:0">Reply to this email if you want to tell us anything else about your setup — it reaches a person.</p>' +
          '</div>',
        fromName: 'RoofMap', fromAddress: MAIL_SUPPORT, replyTo: MAIL_SUPPORT,
      }).catch(function(e){ console.error('[waitlist] confirmation failed:', e.message); });
    }
    // No req passed: this is a public route, so there is no company or user to
    // attribute it to. What is worth counting is the shape of the demand.
    recordUsage('waitlist_submit', null, { region: row.region, volume: row.volume, software: row.current_software });
    res.json({ ok: true, id: (data && data.id) || null });
  } catch (e) {
    console.error('[waitlist] failed:', e.message);
    res.status(500).json({ error: 'Could not save that — try again in a moment.' });
  }
});

// The list, for working it. Gated on ADMIN_TOKEN like /admin/errors, and shut
// rather than open when no token is configured.
app.get('/admin/waitlist', async (req, res) => {
  if (!_adminOk(req)) return res.status(404).json({ error: 'Not found' });
  try {
    let q = supabase.from('waitlist').select('*').order('created_at', { ascending: false }).limit(2000);
    const status = _wlPick(req.query.status, WAITLIST_STATUSES);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    const rows = data || [];
    if (String(req.query.format || '').toLowerCase() === 'csv') {
      const cols = ['id','created_at','status','email','name','business','phone','region','volume','current_software','headache','source','invited_at','notes'];
      // Excel is the destination, so quote everything and double the quotes.
      const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => esc(r[c])).join(','))).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="roofmap-waitlist.csv"');
      return res.send(csv);
    }
    const counts = {};
    rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    res.json({ total: rows.length, counts, rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Invite one of them in. Sends the signup link and the registration code, and
// marks the row — which is what makes "approved in batches" a process rather
// than a promise. The code is the one /auth/register already checks; there is
// no second gate to keep in step.
app.post('/admin/waitlist/:id/invite', async (req, res) => {
  if (!_adminOk(req)) return res.status(404).json({ error: 'Not found' });
  const code = process.env.REGISTRATION_INVITE_CODE || '';
  if (!code && process.env.OPEN_REGISTRATION !== 'true') {
    return res.status(400).json({ error: 'No REGISTRATION_INVITE_CODE is set, so an invite would not let anyone in.' });
  }
  try {
    const { data: row, error } = await supabase.from('waitlist').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Not on the list.' });
    if (!EMAIL_ENABLED) return res.status(503).json({ error: 'Email is not configured on the server yet.', code: 'EMAIL_NOT_CONFIGURED' });

    const link = PUBLIC_APP_URL + '/signup';
    const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const hello = row.name ? ('Hi ' + row.name + ',\n\n') : 'Hi,\n\n';
    await _dispatchMail({
      to: row.email,
      subject: 'Your RoofMap access is open',
      text: hello +
        'You are in. Set your business up here:\n' + link + '\n\n' +
        (code ? ('Your access code: ' + code + '\n\n') : '') +
        'It takes about a minute — business name, your name, a password. There is a\n' +
        'finished sample job waiting inside so you can see a completed quote, cut list\n' +
        'and material order before you do your own.\n\n' +
        (EARLY_ACCESS_COUPON
          ? ('As a founding business you get 30% off for your first 12 months, then the\n' +
             'standard rate. It comes off automatically when you subscribe — there is no\n' +
             'code to enter.\n\n')
          : '') +
        'Reply to this email if anything is in your way.\n\n— RoofMap, by Flood Roofing\n',
      html: '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#0a1628;max-width:560px">' +
        '<div style="font-size:12px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#0099cc">RoofMap</div>' +
        '<h2 style="font-size:21px;margin:10px 0 14px">You are in' + (row.name ? (', ' + esc(row.name)) : '') + '.</h2>' +
        '<p style="margin:0 0 18px">Setting your business up takes about a minute — business name, your name, a password. There is a finished sample job waiting inside, so you can see a completed quote, cut list and material order before you do your own.</p>' +
        '<p style="margin:0 0 16px"><a href="' + esc(link) + '" style="display:inline-block;background:#0099cc;color:#fff;padding:13px 26px;border-radius:9px;text-decoration:none;font-weight:700">Set up your business</a></p>' +
        (code ? ('<p style="margin:0 0 18px;font-size:14px">Your access code: <strong style="font-family:ui-monospace,Consolas,monospace;background:#f4f7fa;border:1px solid #dde5ee;border-radius:6px;padding:3px 8px">' + esc(code) + '</strong></p>') : '') +
        // No code to paste, so no code to forget — but say so, because an
        // unmentioned discount is one somebody assumes they have missed.
        (EARLY_ACCESS_COUPON
          ? ('<p style="margin:0 0 18px;padding:14px 16px;background:#f4f7fa;border-left:3px solid #0099cc;border-radius:0 8px 8px 0;font-size:14px;line-height:1.6">' +
             '<strong>Founding rate: 30% off your first 12 months</strong>, then the standard rate. ' +
             'It comes off automatically when you subscribe — there is no code to enter.</p>')
          : '') +
        '<p style="font-size:13px;color:#5f6b7a;margin:0">Reply to this email if anything is in your way — it reaches a person.</p>' +
        '</div>',
      fromName: 'RoofMap', fromAddress: MAIL_SALES, replyTo: MAIL_SALES,
    });
    const patch = { status: 'invited', invited_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data: updated } = await supabase.from('waitlist').update(patch).eq('id', row.id).select('*').single();
    res.json({ ok: true, row: updated || Object.assign({}, row, patch) });
  } catch (e) {
    console.error('[waitlist] invite failed:', e.message);
    res.status(502).json({ error: 'Invite email failed: ' + e.message });
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
  // Each business's RoofMap address: <slug>.roofmap.co.nz. Unique, case-blind.
  "alter table public.companies add column if not exists slug text",
  // Which plan a business is on. Everything already in use predates plans, so
  // the default is 'trial' — full access — and nobody loses a feature the day
  // this ships.
  "alter table public.companies add column if not exists plan text not null default 'trial'",
  "create unique index if not exists idx_companies_slug on public.companies (lower(slug)) where slug is not null",
  // Per-company invitations. Replaces INVITE_COMPANY_ID, which could only ever
  // point at ONE company — so every invited person landed in that same
  // business, which is the opposite of what selling this to others needs.
  // Only a hash of the token is stored, so a database leak can't be used to
  // join anybody's company.
  "create table if not exists public.company_invites (" +
  "  id uuid primary key default gen_random_uuid()," +
  "  company_id uuid not null references public.companies(id) on delete cascade," +
  "  email text not null," +
  "  role text not null default 'member'," +
  "  token_hash text not null," +
  "  created_by uuid," +
  "  created_at timestamptz not null default now()," +
  "  expires_at timestamptz not null default (now() + interval '14 days')," +
  "  accepted_at timestamptz," +
  "  accepted_by uuid)",
  "create index if not exists idx_company_invites_company on public.company_invites (company_id)",
  // A subscriber's OWN quote domain, registered with Vercel on their behalf.
  // status: pending → (they add the DNS record) → verified. Unique on the
  // domain so two businesses can't both claim one.
  "create table if not exists public.company_domains (" +
  "  id uuid primary key default gen_random_uuid()," +
  "  company_id uuid not null references public.companies(id) on delete cascade," +
  "  domain text not null," +
  "  status text not null default 'pending'," +
  "  verification jsonb," +
  "  last_error text," +
  "  created_by uuid," +
  "  created_at timestamptz not null default now()," +
  "  verified_at timestamptz," +
  "  last_checked_at timestamptz)",
  "create unique index if not exists idx_company_domains_domain on public.company_domains (lower(domain))",
  "create index if not exists idx_company_domains_company on public.company_domains (company_id)",
  // A subscriber's OWN email sending domain, registered with Resend on their
  // behalf. status: pending → (they add SPF + DKIM records) → verified, at
  // which point their quotes send genuinely from from_email. One per company;
  // unique on the domain so two businesses can't both claim one.
  "create table if not exists public.company_mail_domains (" +
  "  id uuid primary key default gen_random_uuid()," +
  "  company_id uuid not null references public.companies(id) on delete cascade," +
  "  domain text not null," +
  "  from_email text not null," +
  "  resend_id text," +
  "  status text not null default 'pending'," +
  "  records jsonb," +
  "  last_error text," +
  "  created_by uuid," +
  "  created_at timestamptz not null default now()," +
  "  verified_at timestamptz," +
  "  last_checked_at timestamptz)",
  "create unique index if not exists idx_company_mail_domains_domain on public.company_mail_domains (lower(domain))",
  "create unique index if not exists idx_company_mail_domains_company on public.company_mail_domains (company_id)",
  "create unique index if not exists idx_company_invites_token on public.company_invites (token_hash)",
  // Billing is per BUSINESS, not per login — three office staff are one
  // subscription, and an invited teammate must not need their own.
  "alter table public.subscriptions add column if not exists company_id uuid",
  "create index if not exists idx_subscriptions_company on public.subscriptions (company_id)",
  "update public.subscriptions s set company_id = cu.company_id from public.company_users cu" +
  "  where s.company_id is null and cu.user_id = s.user_id",
  "alter table public.user_settings add column if not exists company_id uuid",
  "alter table public.profiles add column if not exists company_id uuid",
  "create index if not exists idx_jobs_company on public.jobs (company_id)",
  // Job number lookup — backs the duplicate-job-number guard on create.
  "create index if not exists idx_jobs_quote_ref on public.jobs ((draw_state->'state'->'quote'->>'ref'))",
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
  // The other backfills run before this table exists, so job_revisions was
  // missed and every pre-migration snapshot kept a null company_id. That is
  // not cosmetic: a null company_id is matched by the user_id fallback in
  // _scopeCompany, so those rows were scoped to a PERSON rather than to the
  // business they belong to. Take the company from the job wherever the job
  // is still there, and fall back to the author's company for snapshots whose
  // job has since been deleted (which they deliberately outlive).
  "update public.job_revisions r set company_id = j.company_id from public.jobs j" +
  "  where r.company_id is null and j.id = r.job_id and j.company_id is not null",
  "update public.job_revisions r set company_id = cu.company_id from public.company_users cu" +
  "  where r.company_id is null and cu.user_id = r.user_id",
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

  // 6. Usage events — the answer to "did that trialist draw a roof, or did
  //    they open the app once and never come back?". Nine event names, no
  //    third party, no cookie, no page tracking. What is stored is which of a
  //    handful of milestones a business reached and when; nothing about the
  //    customer, the address or the price.
  "create table if not exists public.usage_events (" +
  "  id bigserial primary key," +
  "  at timestamptz not null default now()," +
  "  company_id uuid," +
  "  user_id uuid," +
  "  name text not null," +
  "  props jsonb not null default '{}'::jsonb)",
  "create index if not exists idx_usage_events_at on public.usage_events (at desc)",
  "create index if not exists idx_usage_events_co on public.usage_events (company_id, name)",
  "alter table public.usage_events enable row level security",
  // Nobody reads this through PostgREST — it is written and read by the
  // backend with the service key, so no policy grants access to a client.

  // 8. invoices — deposit on acceptance, progress claims, final on
  //    completion. A row per invoice; the money fields are stored, not
  //    recomputed, so an invoice never changes after it's sent.
  "create table if not exists public.invoices (" +
  "  id uuid primary key default gen_random_uuid()," +
  "  company_id uuid references public.companies(id) on delete cascade," +
  "  user_id uuid," +
  "  job_id uuid references public.jobs(id) on delete set null," +
  "  number text not null," +
  "  type text not null default 'progress'," +          // deposit | progress | final
  "  status text not null default 'draft'," +           // draft | sent | paid | void
  "  percent numeric," +
  "  amount numeric not null default 0," +              // ex GST
  "  gst numeric not null default 0," +
  "  total numeric not null default 0," +               // incl GST
  "  gst_rate numeric not null default 15," +
  "  description text not null default ''," +
  "  client_name text not null default ''," +
  "  client_email text not null default ''," +
  "  site_address text not null default ''," +
  "  issued_at timestamptz not null default now()," +
  "  due_at timestamptz," +
  "  sent_at timestamptz," +
  "  paid_at timestamptz," +
  "  created_at timestamptz not null default now()," +
  "  updated_at timestamptz not null default now())",
  "create unique index if not exists idx_invoices_co_no on public.invoices (company_id, number)",
  "create index if not exists idx_invoices_job on public.invoices (job_id)",
  "create index if not exists idx_invoices_co on public.invoices (company_id, created_at desc)",
  "alter table public.invoices enable row level security",
  "do $pol$ begin" +
  "  if not exists (select 1 from pg_policies where schemaname='public' and tablename='invoices' and policyname='invoices_company') then" +
  "    create policy invoices_company on public.invoices for all" +
  "      using (company_id in (select company_id from public.company_users where user_id = auth.uid()));" +
  "  end if; end $pol$",

  // 9. waitlist — early access. RoofMap is not open self-serve: a roofer
  //    asks for access, and gets invited in a batch once somebody has looked
  //    at who they are. This is that list.
  //
  //    email is unique so a second submission updates the row rather than
  //    landing twice; somebody who fills the form in again a month later with
  //    a better answer should improve their entry, not duplicate it.
  //
  //    No policy is created. Like usage_events, this is written and read only
  //    by the backend with the service key — there is no client-side read of
  //    other people's contact details, so RLS with no policy is exactly right.
  "create table if not exists public.waitlist (" +
  "  id bigserial primary key," +
  "  created_at timestamptz not null default now()," +
  "  updated_at timestamptz not null default now()," +
  "  email text not null," +
  "  name text not null default ''," +
  "  business text not null default ''," +
  "  phone text not null default ''," +
  "  region text not null default ''," +
  "  volume text not null default ''," +              // roofs quoted per month, as a band
  "  current_software text not null default ''," +
  "  headache text not null default ''," +
  "  source text not null default ''," +              // where they came from (utm / referrer)
  "  status text not null default 'new'," +           // new | invited | joined | declined
  "  invited_at timestamptz," +
  "  notes text not null default '')",
  "create unique index if not exists idx_waitlist_email on public.waitlist (lower(email))",
  "create index if not exists idx_waitlist_new on public.waitlist (created_at desc)",
  "alter table public.waitlist enable row level security",

  // 10. platform_state — one row per thing the platform needs to remember
  //     ACROSS RESTARTS. Right now that is exactly one thing: the date the
  //     weekly metrics email last went out.
  //
  //     It has to be in the database rather than in memory because Railway
  //     redeploys, and a weekly timer that resets on every deploy is a weekly
  //     email that never arrives during a busy fortnight. A date in a table is
  //     the difference between "it fires every Monday" and "it fires every
  //     Monday we didn't happen to push on Sunday".
  //
  //     Like usage_events and waitlist: RLS on, no policy, so it is reachable
  //     only by the backend with the service key. Nothing here is a customer's.
  "create table if not exists public.platform_state (" +
  "  key text primary key," +
  "  value jsonb not null default '{}'::jsonb," +
  "  updated_at timestamptz not null default now())",
  "alter table public.platform_state enable row level security",
];

async function _ensureSchema(){
  if (!process.env.DATABASE_URL) { console.warn('[migrate] DATABASE_URL not set — multi-tenant schema NOT ensured'); return { skipped: 'DATABASE_URL not set' }; }
  let Client;
  try { Client = require('pg').Client; } catch(e){ console.log('[migrate] pg not installed — skipping (run the SQL manually)'); return { skipped: 'pg not installed' }; }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  let ok = 0, failed = 0; const errors = [];
  try {
    await c.connect();
    for (const sql of _MIGRATION_SQL) {
      try { await c.query(sql); ok++; }
      catch(e){ failed++; errors.push({ sql: sql.slice(0, 90), error: e.message }); console.warn('[migrate] statement failed (continuing): ' + e.message + ' — SQL: ' + sql.slice(0, 90)); }
    }
    console.log('[migrate] schema ensured: ' + ok + ' ok, ' + failed + ' failed');
    // A statement that fails at every boot is a hole someone is standing in
    // — the share-token index missing was felt as customers waiting a minute
    // for a quote. Say it where it will be read.
    if (failed) { try { recordError('config', new Error('[migrate] ' + failed + ' schema statement(s) failing at boot: ' + errors.map(e => e.error).join(' | ').slice(0, 300)), { route: 'boot' }); } catch(e){} }
    return { ok, failed, errors };
  } catch(e){
    console.warn('[migrate] schema ensure skipped:', e.message);
    try { recordError('config', new Error('[migrate] could not connect with DATABASE_URL: ' + e.message + ' — the share-token index and fast saves depend on it'), { route: 'boot' }); } catch(e2){}
    return { connectError: e.message };
  }
  finally { try { await c.end(); } catch(e){} }
}

// The truth about the database, on demand — because /health's pg flag only
// says the VARIABLE exists. This answers what actually matters: does the
// connection work, is the share-token index really there, how heavy has the
// jobs table grown, and does a token lookup through PostgREST come back in
// index time or seq-scan time. ?migrate=1 re-runs the schema migration right
// now and reports per-statement results — so a missing index can be repaired
// from a phone.
app.get('/admin/db-health', async (req, res) => {
  if (!_adminOk(req)) return res.status(404).end();
  const out = { pg: !!process.env.DATABASE_URL };
  const pool = _pgPool();
  if (pool) {
    try {
      const t0 = Date.now();
      await pool.query('select 1');
      out.poolConnect = { ok: true, ms: Date.now() - t0 };
      const idx = await pool.query(
        "select indexname from pg_indexes where schemaname = 'public' and tablename = 'jobs'");
      out.jobsIndexes = idx.rows.map(r => r.indexname);
      out.hasShareTokenIndex = out.jobsIndexes.indexOf('idx_jobs_share_token') >= 0;
      const sz = await pool.query(
        "select count(*)::int as jobs, coalesce(max(pg_column_size(draw_state)),0)::int as max_bytes, " +
        "coalesce(avg(pg_column_size(draw_state)),0)::int as avg_bytes, " +
        "pg_size_pretty(pg_total_relation_size('public.jobs')) as table_size from public.jobs");
      out.jobsTable = sz.rows[0];
    } catch (e) { out.poolConnect = { ok: false, error: e.message }; }
  }
  if (String(req.query.migrate) === '1') out.migrate = await _ensureSchema();
  // How a token lookup actually performs through PostgREST — the path the
  // customer link's fallback takes. A no-such-token probe returns nothing,
  // fast when the index serves it, in seq-scan time (or a timeout) when not.
  try {
    const t1 = Date.now();
    const probe = await supabase.from('jobs').select('id')
      .eq('draw_state->state->quote->share->>token', 'db-health-probe-no-such-token').limit(1);
    out.tokenScanProbe = { ms: Date.now() - t1, error: probe.error ? probe.error.message : null };
  } catch (e) { out.tokenScanProbe = { error: e.message }; }
  res.json(out);
});

// ══════════════════════════════════════════════════════════════════
// USAGE — did they actually get anywhere?
// ══════════════════════════════════════════════════════════════════
// Before this there was no way to tell a trialist who drew a roof, priced it
// and sent a quote from one who signed up, saw an empty screen and closed the
// tab. Both looked identical: one row in `companies`. That is the difference
// between "the product doesn't work" and "the first ten minutes don't work",
// and it is not a question to answer by guessing.
//
// This is deliberately small. Nine milestone names, no third party, no
// cookie, no page tracking, no funnel of everything anybody clicked. What
// gets stored is which milestone a business reached and when — never a
// customer, an address or a price.
const USAGE_EVENTS = [
  'signed_up',        // a business was created
  'setup_done',       // they put their own name and contact details in
  'sample_opened',    // they looked at the worked example
  'roof_drawn',       // a roof with a scale on it — the first real milestone
  'job_saved',        // it made it to the server
  'price_book_saved', // they entered their own supplier rates
  'quote_sent',       // a customer link went out
  'quote_accepted',   // a customer accepted one
  'order_sent',       // material ordered — the far end of the workflow
  'waitlist_submit',  // a roofer asked for early access — the top of the funnel
];
async function recordUsage(name, req, props){
  try {
    if (USAGE_EVENTS.indexOf(name) < 0) return;   // an allow-list, so this can never become page tracking
    await supabase.from('usage_events').insert({
      name,
      company_id: (req && req.companyId) || null,
      user_id: (req && req.user && req.user.id) || null,
      props: props || {},
    });
  } catch(e){ /* never let a metric break a request */ }
}

// The two milestones only the browser knows about: opening the sample, and
// finishing a roof. Everything else is recorded server-side where it happens.
app.post('/usage', requireAuth, (req, res) => {
  const name = String((req.body && req.body.name) || '');
  // Only these two — every other name is recorded at the route that does the
  // thing, and accepting arbitrary names here is how an event pipe turns into
  // page tracking.
  if (name !== 'sample_opened' && name !== 'roof_drawn') return res.status(400).json({ error: 'Unknown event' });
  res.json({ ok: true });
  recordUsage(name, req);
});

// The privacy policy says these are kept for 24 months. A retention period
// nobody enforces is not a retention period, so this enforces it: once at
// boot and daily after, anything older goes. Cheap — the table is nine event
// names and a timestamp, and it is indexed on `at`.
const USAGE_KEEP_DAYS = 730;
async function _pruneUsage(){
  try {
    const cutoff = new Date(Date.now() - USAGE_KEEP_DAYS * 864e5).toISOString();
    const { error } = await supabase.from('usage_events').delete().lt('at', cutoff);
    if (error && !/does not exist/i.test(error.message || '')) throw new Error(error.message);
  } catch(e){ console.warn('[usage] prune skipped:', e.message); }
}

// The funnel, and nothing else: of the businesses that signed up in a window,
// how many reached each milestone. Gated on ADMIN_TOKEN like /admin/errors.
app.get('/admin/usage', async (req, res) => {
  if (!_adminOk(req)) return res.status(404).json({ error: 'Not found' });
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  let rows = [];
  try {
    const { data, error } = await supabase.from('usage_events')
      .select('company_id, name, at').gte('at', since).limit(50000);
    if (error) throw new Error(error.message);
    rows = data || [];
  } catch(e){
    return res.status(500).json({ error: 'usage_events not available: ' + e.message });
  }
  // A company counts once per milestone, however many times it hit it —
  // otherwise one busy subscriber drowns out ten who never got started.
  const reached = new Map();   // milestone → Set(companyId)
  for (const r of rows){
    if (!reached.has(r.name)) reached.set(r.name, new Set());
    reached.get(r.name).add(r.company_id || 'anon');
  }
  const signed = (reached.get('signed_up') || new Set()).size;
  const funnel = USAGE_EVENTS.map(function (n){
    const c = (reached.get(n) || new Set()).size;
    return { milestone: n, businesses: c,
             of_signups: signed ? Math.round((c / signed) * 100) + '%' : '—' };
  });
  res.json({ window_days: days, since, events: rows.length, signups: signed, funnel });
});

// ══════════════════════════════════════════════════════════════════
// THE MONDAY EMAIL
// ══════════════════════════════════════════════════════════════════
// /admin/usage above answers "how is the funnel doing" — but only if somebody
// goes and asks it, which is the same as not knowing. This is the same numbers
// plus the money and the marketing, pushed rather than pulled, once a week.
// The collectors live in metrics.js; everything here is wiring.
const METRICS = require('./metrics').createMetrics({
  supabase: supabase,
  dispatchMail: _dispatchMail,
  usageEvents: USAGE_EVENTS,
  buildSha: BUILD_SHA,
  warn: function(m){ console.warn(m); },
});

// The report as JSON, for looking at it without waiting until Monday.
app.get('/admin/metrics', async (req, res) => {
  if (!_adminOk(req)) return res.status(404).json({ error: 'Not found' });
  try { res.json(await METRICS.collect()); }
  catch (e){ res.status(500).json({ error: e.message }); }
});
// Send it now. A weekly job that has never once been fired by hand is not a
// job anybody has verified, so this exists to be pressed on the day it ships.
app.post('/admin/metrics/send', async (req, res) => {
  if (!_adminOk(req)) return res.status(404).json({ error: 'Not found' });
  try {
    const rep = await METRICS.sendNow();
    res.json({ ok: true, to: METRICS.config.to, week_ending: rep.week_ending,
               sections: rep.sections.map(function(s){ return { key: s.key, connected: !!s.connected, error: s.error || null }; }) });
  } catch (e){ res.status(500).json({ error: e.message }); }
});
// Same view as the email, in a browser, for checking how it looks.
app.get('/admin/metrics/preview', async (req, res) => {
  if (!_adminOk(req)) return res.status(404).json({ error: 'Not found' });
  try {
    const rep = await METRICS.collect();
    if (String(req.query.format || '') === 'text'){
      res.type('text/plain').send(METRICS.renderText(rep));
    } else {
      res.type('html').send(METRICS.renderHtml(rep));
    }
  } catch (e){ res.status(500).json({ error: e.message }); }
});

// ── Reading and receiving errors ────────────────────────────────────
// A frontend crash is the half that was completely invisible: it happens on
// somebody else's laptop and nothing about it ever reaches us. The app posts
// here (see _reportClientError in index.html). Deliberately unauthenticated —
// a crash on the login screen is exactly the one worth hearing about — so it
// is size-capped and rate-limited instead.
const _clientErrHits = new Map();   // ip → { n, since }
app.post('/client-error', (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const hit = _clientErrHits.get(ip) || { n: 0, since: Date.now() };
    if (Date.now() - hit.since > 60e3){ hit.n = 0; hit.since = Date.now(); }
    hit.n++; _clientErrHits.set(ip, hit);
    if (_clientErrHits.size > 5000) _clientErrHits.clear();
    if (hit.n > 30) return res.status(429).json({ ok: false });

    const b = req.body || {};
    const err = new Error(String(b.message || 'client error').slice(0, 500));
    err.stack = String(b.stack || '').slice(0, 4000);
    recordError('client', err, {
      url: b.url, route: b.where || '', company: b.company || '', user: b.user || '',
      agent: req.headers['user-agent'] || '',
    });
  } catch(e){ /* never fail a crash report */ }
  res.json({ ok: true });
});

// What has gone wrong lately, newest first. Gated on ADMIN_TOKEN — without
// one set, the route stays shut rather than defaulting to open.
function _adminOk(req){
  if (!ADMIN_TOKEN) return false;
  const given = String(req.headers['x-admin-token'] || req.query.token || '');
  if (given.length !== ADMIN_TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(ADMIN_TOKEN));
}
app.get('/admin/errors', (req, res) => {
  if (!_adminOk(req)) return res.status(404).json({ error: 'Not found' });
  const groups = Array.from(_errSeen.entries()).map(function(e){
    const last = _errRing.slice().reverse().find(function(r){ return r.fingerprint === e[0]; }) || {};
    return { fingerprint: e[0], count: e[1].count,
             first: new Date(e[1].first).toISOString(), last: new Date(e[1].last).toISOString(),
             kind: last.kind || '', message: last.message || '', route: last.route || last.url || '' };
  }).sort(function(a, b){ return new Date(b.last) - new Date(a.last); });
  res.json({ build: BUILD_SHA, distinct: groups.length, total: _errRing.length,
             notified_this_hour: _errSentThisHour,
             alerting: { webhook: !!ERR_WEBHOOK, email: !!ERR_EMAIL_TO },
             groups,
             recent: _errRing.slice(-50).reverse() });
});

// ── The last word on any request ────────────────────────────────────
// Anything a route threw, or handed to next(err), ends here. The caller gets
// an incident id they can quote instead of a stack trace they can't use.
// Must be registered AFTER every route, and must take four arguments —
// that arity is how Express knows it is an error handler.
app.use(function (err, req, res, next) {
  const status = (err && (err.status || err.statusCode)) || 500;
  const id = recordError('server', err, {
    route: (req.route && req.route.path) || '', url: req.originalUrl,
    method: req.method, status,
    company: (req.companyId || ''), user: (req.user && req.user.email) || '',
    agent: req.headers['user-agent'] || '',
  });
  if (res.headersSent) return next(err);
  // A 4xx is the caller's own doing and its message is meant for them; a 5xx
  // is ours, and its message is for the log, not the customer.
  res.status(status).json(status < 500
    ? { error: String((err && err.message) || 'Request failed'), incident: id }
    : { error: 'Something went wrong at our end. Quote this if you get in touch.', incident: id });
});

if (!process.env.DATABASE_URL) {
  // Not a crash — a configuration hole with customer-visible consequences:
  // no share-token index migration, no fast jsonb saves, token lookups fall
  // back to a scan the 8-second PostgREST timeout kills. Say it through the
  // same alert channel that reports the resulting 5xx storms.
  try {
    recordError('config', new Error(
      'DATABASE_URL is not set on this service. Customer quote links fall back to a ' +
      'full-table token scan that times out (the 60-second "Loading your quote"), and ' +
      'job saves round-trip the whole multi-MB draw_state. Fix: Railway service → ' +
      'Variables → add DATABASE_URL = the Supabase connection string (Project Settings ' +
      '→ Database → Connection string, URI). The boot migration then creates the ' +
      'share-token index automatically.'), { route: 'boot' });
  } catch (e) {}
}
app.listen(PORT, () => {
  console.log('RoofMap backend running on port ' + PORT + ' · build: email-recipients-v7');
  console.log('Supabase: ' + (process.env.SUPABASE_URL ? 'OK' : 'NOT SET'));
  console.log('Stripe: disabled');
  console.log('Error alerts: ' + [ERR_WEBHOOK && 'webhook', ERR_EMAIL_TO && 'email'].filter(Boolean).join(' + ')
    + (ERR_WEBHOOK || ERR_EMAIL_TO ? '' : 'log only — set ERROR_WEBHOOK_URL or ERROR_EMAIL_TO')
    + ' · /admin/errors ' + (ADMIN_TOKEN ? 'open with ADMIN_TOKEN' : 'closed (no ADMIN_TOKEN)'));
  try { _keepWarm(); } catch(e){}
  // Load the verified subscriber domains up front — after a restart the CORS
  // allowlist must not start empty for whoever asks first. Same for the
  // sending domains: the first quote sent after a deploy must already wear
  // the right From address.
  _reloadVerifiedDomains().catch(function(){});
  _reloadMailDomains().catch(function(){});
  _ensureSchema().catch(function(){});
  // Enforce the retention period the privacy policy promises.
  _pruneUsage().catch(function(){});
  setInterval(function(){ _pruneUsage().catch(function(){}); }, 24 * 3600e3).unref();
  // The weekly digest. Checks hourly and sends when it is due in NZ time and
  // hasn't gone out in six days — deliberately NOT on boot, so a Monday
  // morning redeploy can't send a second copy of an email already sent.
  try { METRICS.start(); } catch(e){ console.warn('[metrics] schedule not started: ' + e.message); }
  // Quote follow-up reminders: hourly check, DB watermark, deliberately not
  // on boot — a deploy storm must not turn into an email storm.
  const _remKick = setTimeout(function(){ _reminderTick(); }, 5 * 60e3);
  if (_remKick.unref) _remKick.unref();
  setInterval(function(){ _reminderTick(); }, 3600e3).unref();
  console.log('Weekly metrics: ' + (String(process.env.METRICS_ENABLED || 'true') === 'false'
    ? 'disabled (METRICS_ENABLED=false)'
    : METRICS.config.to + ' every ' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][METRICS.config.day]
      + ' ' + METRICS.config.hour + ':00 NZ'));
});
