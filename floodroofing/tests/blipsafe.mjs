// A FAILED READ IS NOT AN EMPTY ANSWER.
//
// Reported after a database blip: "my fergus stopped being connected and I
// had to re-enter my api key, it also showed nothing on my home tab and now
// the fergus connection failed (No subscription found)".
//
// All three came from the same habit. The Supabase client returns
// { data: null, error } for a proxy 502 exactly as it does for "no rows", and
// the code looked only at `data`:
//   · settings  → a blank settings object, 200: the Fergus key and the price
//                 book gone from the screen, and the app happy to save over them;
//   · billing   → "No subscription found", 403, on a paying account;
//   · company   → "this user has no company", which had the service CREATE A
//                 NEW EMPTY ONE and move the account into it, leaving every
//                 job, setting and subscription behind on the real company.
//
// The real server is driven here through a proxy that fails whichever table
// is named, for as long as it is named — retries included.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const U = 'user-a', CO = 'company-a';
const db = {
  profiles: [{ id: U, company_id: CO, company: 'Flood Roofing', name: 'Aron', email: 'a@x.co.nz' }],
  company_users: [{ company_id: CO, user_id: U, role: 'owner' }],
  companies: [{ id: CO, name: 'Flood Roofing' }],
  user_settings: [{ user_id: U, company_id: CO, branding: {}, quote_defaults: {},
                    jms_keys: { fergus: 'enc:the-real-key' }, price_book: { x: 1 },
                    updated_at: '2026-09-01T00:00:00.000Z' }],
  subscriptions: [{ id: 's1', company_id: CO, user_id: U, status: 'active',
                    created_at: '2026-01-01T00:00:00.000Z' }],
  jobs: [], invoices: [],
};
const { port: realPort } = await startFakePostgrest(db);

// The proxy: every GET whose path starts with a named table fails, both the
// first attempt and the retry. Writes are recorded so an invented company
// cannot hide.
let failing = null;
const writes = [];
const HTML = '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>';
const proxy = http.createServer((req, res) => {
  const path = String(req.url || '').split('?')[0];
  if (req.method !== 'GET') writes.push(req.method + ' ' + path);
  if (failing && req.method === 'GET' && path.indexOf(failing) >= 0) {
    res.writeHead(502, { 'content-type': 'text/html' }); res.end(HTML); return;
  }
  const fwd = http.request({ host:'127.0.0.1', port: realPort, path: req.url,
    method: req.method, headers: req.headers }, up => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
  fwd.on('error', () => { try { res.writeHead(500); res.end('{}'); } catch(e){} });
  req.pipe(fwd);
});
await new Promise(r => proxy.listen(0, '127.0.0.1', r));

process.env.SUPABASE_URL = 'http://127.0.0.1:' + proxy.address().port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.BILLING_ENABLED = 'true';
const PORT = process.env.TEST_PORT || '34657';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn, err = console.error;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn; console.error = err;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
// With cid: the ordinary session token. Without: forces the company lookup.
const tokCid = jwt.sign({ id: U, email: 'a@x.co.nz', cid: CO }, 'test-secret');
const tokBare = jwt.sign({ id: U, email: 'a@x.co.nz' }, 'test-secret');
const get = (path, tok) => fetch(BASE + path, { headers: { Authorization: 'Bearer ' + (tok || tokCid) } });

// ── settings: the Fergus key does not vanish because of a blip ─────
let r = await get('/settings');
let body = await r.json();
check('settings read normally', r.status === 200 && body.jms_keys && body.jms_keys.fergus,
  'status ' + r.status);

failing = 'user_settings';
r = await get('/settings');
body = await r.json().catch(() => ({}));
check('a settings read that FAILED is not answered with blank settings',
  r.status === 503 && body.code === 'UPSTREAM_UNAVAILABLE',
  'status ' + r.status + ' ' + JSON.stringify(body).slice(0, 90));
check('…so the app is never told the Fergus key is gone',
  !(r.status === 200 && body.jms_keys && !body.jms_keys.fergus), 'status ' + r.status);
failing = null;

// ── billing: a blip is not "you have no subscription" ──────────────
failing = 'subscriptions';
// /fergus/* is exactly the route the reported "Connection failed (No
// subscription found)" came through.
r = await get('/fergus/jobs', tokCid);
body = await r.json().catch(() => ({}));
check('a billing read that FAILED does not read as "No subscription found"',
  body.code !== 'SUBSCRIPTION_REQUIRED' && !/No subscription found/.test(body.error || ''),
  'status ' + r.status + ' ' + JSON.stringify(body).slice(0, 90));
check('…it says the database did not answer', r.status === 503,
  'status ' + r.status);
failing = null;

// ── company: a blip must never start a second business ─────────────
const cosBefore = db.companies.length;
writes.length = 0;
// A user this process has not resolved before — _companyOf caches per user,
// so re-using one already looked up would skip the lookup entirely.
const tokFresh = jwt.sign({ id: 'user-fresh', email: 'f@x.co.nz' }, 'test-secret');
db.profiles.push({ id: 'user-fresh', company_id: CO, company: 'Flood Roofing', name: 'F', email: 'f@x.co.nz' });
db.company_users.push({ company_id: CO, user_id: 'user-fresh', role: 'staff' });
failing = 'company_users';
r = await get('/jobs', tokFresh);                    // no cid → the company lookup runs
body = await r.json().catch(() => ({}));
check('a company read that FAILED does not create a new company',
  db.companies.length === cosBefore && !writes.some(w => /^POST .*\/companies$/.test(w)),
  db.companies.length + ' companies, writes: ' + (writes.join(' | ') || 'none'));
check('…and the caller is told to try again, not shown an empty app',
  r.status === 503 && body.code === 'UPSTREAM_UNAVAILABLE',
  'status ' + r.status + ' ' + JSON.stringify(body).slice(0, 80));
check('…and the account is not moved off its company',
  db.profiles.every(p => p.company_id === CO), JSON.stringify(db.profiles.map(p => p.company_id)));
failing = null;

// ── a genuinely missing membership adopts the profile's company ────
db.company_users.length = 0;                         // membership row lost, profile still names it
const cos2 = db.companies.length;
const tokBare2 = jwt.sign({ id: 'user-b', email: 'b@x.co.nz' }, 'test-secret');
db.profiles.push({ id: 'user-b', company_id: CO, company: 'Flood Roofing', name: 'B', email: 'b@x.co.nz' });
r = await get('/jobs', tokBare2);
check('a missing membership is repaired onto the company the profile names',
  db.companies.length === cos2 &&
  db.company_users.some(m => m.user_id === 'user-b' && m.company_id === CO),
  db.companies.length + ' companies, members: ' + JSON.stringify(db.company_users));

// ── an account this bug already moved finds its way home ───────────
// Two memberships: the real company (older) and the empty one a blip
// invented. The oldest wins, and the profile is put back onto it.
db.companies.push({ id: 'company-ghost', name: 'My Company' });
db.company_users.push({ company_id: CO, user_id: 'user-moved', role: 'owner',
                        created_at: '2026-01-01T00:00:00.000Z' });
db.company_users.push({ company_id: 'company-ghost', user_id: 'user-moved', role: 'owner',
                        created_at: '2026-09-13T22:30:00.000Z' });
db.profiles.push({ id: 'user-moved', company_id: 'company-ghost', name: 'Moved', email: 'm@x.co.nz' });
db.jobs.push({ id: 'their-job', user_id: 'user-moved', company_id: CO, client_name: 'Alfred Crawford',
               site_address: '12 Kamo Road', created_at: '2026-09-01T00:00:00.000Z',
               updated_at: '2026-09-12T00:00:00.000Z', status: 'draft', order_sent: null,
               draw_state: { state: {} } });
const tokMoved = jwt.sign({ id: 'user-moved', email: 'm@x.co.nz' }, 'test-secret');
r = await get('/jobs', tokMoved);
body = await r.json().catch(() => []);
check('an account a blip already moved sees its real jobs again',
  r.status === 200 && (body || []).some(x => x.id === 'their-job'),
  'status ' + r.status + ' ' + JSON.stringify(body).slice(0, 70));
check('…and its profile is put back on the company it belongs to',
  (db.profiles.find(p => p.id === 'user-moved') || {}).company_id === CO,
  String((db.profiles.find(p => p.id === 'user-moved') || {}).company_id));

proxy.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
