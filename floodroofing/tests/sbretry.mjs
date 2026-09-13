// "[RoofMap server-5xx] Upstream returned an HTML error page (database or
// proxy outage)" — 26 of them off one account's home screen, plus a save
// refused with "Could not read the job to keep its photos". Supabase's proxy
// answers an ordinary READ with a 5xx and a page of HTML during a database
// blip, and the very next request works.
//
// So a read gets ONE retry before the roofer sees an error. A write never
// does: a repeated insert is worse than an error. This drives the real
// server through a proxy that fails the first hit of each kind.
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

const U = { user: 'user-a', company: 'company-a' };
const { port: realPort } = await startFakePostgrest({
  profiles: [{ id: U.user, company_id: U.company }],
  company_users: [{ company_id: U.company, user_id: U.user, role: 'owner' }],
  user_settings: [], invoices: [],
  jobs: [{ id: 'job-1', user_id: U.user, company_id: U.company, client_name: 'Sharon',
           site_address: '2 Bank St', created_at: '2026-01-01T00:00:00.000Z',
           updated_at: '2026-01-02T00:00:00.000Z', status: 'draft', order_sent: null,
           draw_state: { state: {} } }],
});

// A proxy in front of the fake: the first GET of a table, and the first POST,
// come back as Cloudflare's HTML error page. Everything after passes through.
const failedGet = {}, seenWrites = [];
let injectedGets = 0, injectedWrites = 0;
const HTML = '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>err</body></html>';
const proxy = http.createServer((req, res) => {
  const table = String(req.url || '').split('?')[0];
  const isRead = req.method === 'GET';
  if (isRead && !failedGet[table]) {
    failedGet[table] = 1; injectedGets++;
    res.writeHead(502, { 'content-type': 'text/html' }); res.end(HTML); return;
  }
  if (!isRead) {
    seenWrites.push(req.method + ' ' + table);
    if (req.method === 'POST' && injectedWrites === 0) {
      injectedWrites++;
      res.writeHead(502, { 'content-type': 'text/html' }); res.end(HTML); return;
    }
  }
  const fwd = http.request({ host: '127.0.0.1', port: realPort, path: req.url,
    method: req.method, headers: req.headers }, up => {
    res.writeHead(up.statusCode, up.headers); up.pipe(res);
  });
  fwd.on('error', () => { try { res.writeHead(500); res.end('{}'); } catch(e){} });
  req.pipe(fwd);
});
await new Promise(r => proxy.listen(0, '127.0.0.1', r));

process.env.SUPABASE_URL = 'http://127.0.0.1:' + proxy.address().port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34656';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const tok = jwt.sign({ id: U.user, email: 'a@x.co.nz', cid: U.company }, 'test-secret');
const as = (path, opts) => fetch(BASE + path, { ...(opts || {}),
  headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok,
             ...((opts || {}).headers || {}) } });

// ── a read rides through the blip ─────────────────────────────────
const r = await as('/jobs');
const rows = await r.json().catch(() => null);
check('a read that hits the outage page still answers the roofer',
  r.status === 200 && Array.isArray(rows) && rows.length === 1,
  'status ' + r.status + ' ' + JSON.stringify(rows).slice(0, 70));
check('…and the outage really was injected, so that means something',
  injectedGets > 0, injectedGets + ' injected');

// ── a write is not repeated behind the user's back ────────────────
const before = seenWrites.filter(w => w.startsWith('POST')).length;
const w = await as('/jobs', { method: 'POST',
  body: JSON.stringify({ client_name: 'New job', site_address: '5 Rust Ave' }) });
const posts = seenWrites.filter(x => x.startsWith('POST')).length - before;
check('a failed write is NOT retried — one job asked for is one job created',
  posts === 1, posts + ' POSTs upstream, status ' + w.status);
check('…and the caller is told, rather than left to wonder',
  w.status >= 400, 'status ' + w.status);

proxy.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
