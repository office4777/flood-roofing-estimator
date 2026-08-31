// Brute-force protection and the headers a browser needs.
//
// Three holes this suite exists to keep shut:
//   1. /auth/login had no rate limit at all — the one endpoint an attacker
//      actually grinds. /auth/forgot and /auth/reset had one; login did not.
//   2. `trust proxy` was unset, so behind Railway's edge every request
//      reported the same req.ip and every bucket in the limiter was shared by
//      the whole platform: five password resets per 15 minutes for everybody.
//   3. No security headers, so a customer quote page could be framed
//      invisibly over another page and its Accept button clicked by a victim.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const { port } = await startFakePostgrest({ profiles: [], jobs: [], user_settings: [], company_users: [] });
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34599';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
delete process.env.FRONTEND_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
// A distinct forwarded address per caller. This only does anything if the app
// sets `trust proxy` — which is itself one of the things under test.
const post = (path, body, ip) => fetch(BASE + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Forwarded-For': ip || '203.0.113.1' },
  body: JSON.stringify(body || {}),
});

// ── the headers ──────────────────────────────────────────────────
const h = (await fetch(BASE + '/health')).headers;
check('API responses say they may not be framed',
  h.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(h.get('content-security-policy') || ''),
  h.get('x-frame-options') + ' / ' + h.get('content-security-policy'));
check('…and may not be MIME-sniffed', h.get('x-content-type-options') === 'nosniff');
check('…and do not leak a quote token in a Referer to a map tile host',
  h.get('referrer-policy') === 'strict-origin-when-cross-origin', h.get('referrer-policy'));

// ── login: the endpoint that had nothing ─────────────────────────
// 20 per address per 15 min. Vary the email so the per-email limit is not what
// trips first — this is measuring the per-address one.
let ipLimited = false, tried = 0;
for (let i = 0; i < 26 && !ipLimited; i++) {
  const r = await post('/auth/login', { email: 'u' + i + '@example.com', password: 'x' }, '198.51.100.7');
  tried++;
  if (r.status === 429) ipLimited = true;
}
check('a machine grinding logins is cut off', ipLimited, 'stopped after ' + tried + ' attempts');
check('…but not before a person could fat-finger a password a few times', tried > 5, tried + ' allowed');

// A DIFFERENT address is unaffected. This is the assertion that proves
// `trust proxy` is on: without it both callers collapse to the same req.ip
// and this one comes back 429 as collateral damage.
const other = await post('/auth/login', { email: 'someone@example.com', password: 'x' }, '198.51.100.99');
check('…while a different address is untouched (this is what trust proxy buys)',
  other.status !== 429, 'status ' + other.status);

// one account sprayed from many addresses is stopped by the per-email limit
let emailLimited = false, sprayed = 0;
for (let i = 0; i < 14 && !emailLimited; i++) {
  const r = await post('/auth/login', { email: 'victim@example.com', password: 'x' }, '192.0.2.' + (i + 1));
  sprayed++;
  if (r.status === 429) emailLimited = true;
}
check('one account sprayed from many addresses is stopped too', emailLimited, 'stopped after ' + sprayed);
const cased = await post('/auth/login', { email: 'VICTIM@Example.COM', password: 'x' }, '192.0.2.200');
check('…and changing the capitals does not buy a fresh allowance',
  cased.status === 429, 'status ' + cased.status);

// ── register: unlimited free trials, and it sends mail ────────────
let regLimited = false, regs = 0;
for (let i = 0; i < 9 && !regLimited; i++) {
  const r = await post('/auth/register',
    { email: 'new' + i + '@example.com', password: 'password123', name: 'A', company: 'B' }, '203.0.113.55');
  regs++;
  if (r.status === 429) regLimited = true;
}
check('signing up on repeat from one address is cut off', regLimited, 'stopped after ' + regs);

// ── the limiter cannot be reset by filling it ────────────────────
// The old memory backstop called clear() on the whole map, so anyone able to
// push it past the cap wiped everybody's counter — including their own.
const src = await readFile(_j(_ROOT, 'backend', 'server.js'), 'utf8');
check('the limiter prunes expired windows rather than wiping every counter',
  /for \(const \[k, v\] of _rateBuckets\) if \(now - v\.start > v\.w\) _rateBuckets\.delete\(k\)/.test(src));
check('…and each bucket remembers its own window, so a long one is not pruned early',
  /\{ start: now, n: 0, w: windowMs \}/.test(src));
check('trust proxy is set to exactly one hop, not blanket-true',
  /app\.set\('trust proxy', 1\)/.test(src));

// ── the pages a person looks at are served by Vercel, not from here ──
const vercel = JSON.parse(await readFile(_j(_ROOT, 'frontend', 'vercel.json'), 'utf8'));
const all = (vercel.headers || []).find(x => x.source === '/(.*)');
const hdr = k => ((all && all.headers) || []).find(x => x.key === k);
check('the served pages refuse to be framed as well',
  (hdr('X-Frame-Options') || {}).value === 'DENY' &&
  /frame-ancestors 'none'/.test((hdr('Content-Security-Policy') || {}).value || ''));
check('…and keep the share token out of a cross-origin Referer',
  (hdr('Referrer-Policy') || {}).value === 'strict-origin-when-cross-origin');
check('…and ask browsers to stay on HTTPS',
  /max-age=\d+/.test((hdr('Strict-Transport-Security') || {}).value || ''));

// ── /proxy-image is a proxy for Mapbox, not for the internet ─────
// The old guard was a prefix check on the raw URL string, so a hostname
// that merely STARTS with api.mapbox.com sailed through. Every one of
// these must be refused before any upstream request is made.
for (const u of [
  'https://api.mapbox.com.attacker.com/styles/v1/x',   // suffix trick
  'https://api.mapbox.com@attacker.com/x',             // userinfo trick
  'http://api.mapbox.com/x',                           // protocol downgrade
  'https://evil.com/api.mapbox.com',                   // host swap
  'not a url at all',
]) {
  const r = await fetch(BASE + '/proxy-image?url=' + encodeURIComponent(u));
  check('/proxy-image refuses ' + u, r.status === 400, 'status ' + r.status);
}

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
