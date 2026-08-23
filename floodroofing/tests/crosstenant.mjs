// One tenant must never reach another's rows through an :id in a URL.
//
// The specific hole this was written for: job_revisions was the one table the
// multi-tenant migration forgot to backfill, so every snapshot taken before it
// kept company_id = null. A null company_id is matched by the user_id fallback
// in _scopeCompany — so those rows were scoped to a PERSON, not to the business
// — and the restore route then wrote to rev.job_id without scoping the write.
// Someone who had left a company could restore their old snapshot straight over
// that company's current job.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { startFakePostgrest } from './fakepgrst.mjs';
// jsonwebtoken lives in the backend's node_modules, same as the other suites
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const A = { user: 'user-a', company: 'company-a' };   // left company B a while back
const B = { user: 'user-b', company: 'company-b' };

const { port } = await startFakePostgrest({
  profiles: [{ id: A.user, company_id: A.company }, { id: B.user, company_id: B.company }],
  company_users: [{ company_id: A.company, user_id: A.user, role: 'owner' },
                  { company_id: B.company, user_id: B.user, role: 'owner' }],
  user_settings: [], invoices: [],
  jobs: [
    { id: 'job-b', user_id: B.user, company_id: B.company, client_name: 'B current',
      site_address: 'B street', draw_state: { state: { v: 'B CURRENT WORK' } }, status: 'draft' },
    { id: 'job-a', user_id: A.user, company_id: A.company, client_name: 'A job',
      site_address: 'A street', draw_state: { state: { v: 'a' } }, status: 'draft' },
  ],
  // The legacy snapshot: A wrote it, it points at what is now B's job, and it
  // carries no company_id because the migration never backfilled this table.
  job_revisions: [
    { id: 1, job_id: 'job-b', company_id: null, user_id: A.user, client_name: 'A old',
      site_address: 'A old street', draw_state: { state: { v: 'A OLD SNAPSHOT' } }, status: 'draft' },
    { id: 2, job_id: 'job-a', company_id: A.company, user_id: A.user, client_name: 'A job',
      site_address: 'A street', draw_state: { state: { v: 'a' } }, status: 'draft' },
  ],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34602';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const tok = w => jwt.sign({ id: w.user, email: w.user + '@x.co.nz', cid: w.company }, 'test-secret');
const as = (w, path, opts) => fetch(BASE + path, {
  ...(opts || {}),
  headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok(w), ...((opts || {}).headers || {}) },
});

// ── the attack the fix exists for ─────────────────────────────────
let r = await as(A, '/jobs/job-b/revisions/1/restore', { method: 'POST' });
check('A cannot restore a legacy snapshot over B\'s current job',
  r.status === 404, 'status ' + r.status);

const after = await (await as(B, '/jobs/job-b')).json();
check('…and B\'s job is untouched',
  JSON.stringify(after.draw_state || {}).indexOf('A OLD SNAPSHOT') < 0 &&
  JSON.stringify(after.draw_state || {}).indexOf('B CURRENT WORK') >= 0,
  JSON.stringify(after.draw_state || {}).slice(0, 60));

// ── and the ordinary case still works ─────────────────────────────
r = await as(A, '/jobs/job-a/revisions/2/restore', { method: 'POST' });
check('…while A restoring A\'s own snapshot still works', r.status === 200, 'status ' + r.status);

// ── the rest of the :id surface ───────────────────────────────────
// What matters is that no row of B's crosses the boundary — a 200 carrying
// null or [] leaks nothing. Assert on the DATA, not the status code, or a
// route that answers 200-with-nothing reads as a hole when it is not.
const LEAKY = /B CURRENT WORK|B current|B street/;
for (const [label, path, opts] of [
  ['read',   '/jobs/job-b', null],
  ['update', '/jobs/job-b', { method: 'PUT', body: JSON.stringify({ client_name: 'taken over' }) }],
  ['list its revisions', '/jobs/job-b/revisions', null],
  ['list its invoices',  '/jobs/job-b/invoices', null],
  ['raise an invoice on it', '/jobs/job-b/invoices',
    { method: 'POST', body: JSON.stringify({ type: 'deposit', total_incl: 100 }) }],
]) {
  const rr = await as(A, path, opts);
  const body = await rr.text();
  check('A gets nothing of B\'s when trying to ' + label,
    !LEAKY.test(body), rr.status + ' ' + body.slice(0, 70));
}

// A delete that deleted nothing must not answer ok:true — that told the client
// a delete had happened when the scope had quietly matched no rows.
{
  const rr = await as(A, '/jobs/job-b', { method: 'DELETE' });
  const body = await rr.text();
  check('A deleting B\'s job is refused, not silently reported as done',
    rr.status === 404 && !/"ok":true/.test(body), rr.status + ' ' + body.slice(0, 60));
}
// Writes that touch nothing must say so. Both of these answered a cheerful
// success for a job belonging to someone else — the office would have been
// told an order was marked sent, or a job updated, with nothing written.
for (const [label, path, opts] of [
  ['mark an order sent on', '/jobs/job-b/order-sent', { method: 'POST', body: '{}' }],
  ['update',                '/jobs/job-b', { method: 'PUT', body: JSON.stringify({ client_name: 'taken over' }) }],
]) {
  const rr = await as(A, path, opts);
  const body = await rr.text();
  check('A trying to ' + label + " B's job is refused, not reported as done",
    rr.status === 404 && !/"ok":true/.test(body), rr.status + ' ' + body.slice(0, 60));
}

const still = await (await as(B, '/jobs/job-b')).json();
check('B\'s job survived all of that intact — name, status and order stamp',
  (still.client_name || '') === 'B current' && !still.order_sent && still.status !== 'ordered',
  still.client_name + ' / ' + still.status + ' / order_sent=' + JSON.stringify(still.order_sent || null));

// ── nobody adds an unscoped :id route back ────────────────────────
// Cheap structural guard: every authenticated route carrying a :param has to
// go through one of the scoping helpers, or say in a comment why it does not.
const src = await readFile(_j(_ROOT, 'backend', 'server.js'), 'utf8');
const lines = src.split('\n');
const starts = lines.map((l, i) => [i, l]).filter(([, l]) => /^app\.(get|post|put|patch|delete)\(/.test(l));
const unscoped = [];
starts.forEach(([i, l], n) => {
  const end = n + 1 < starts.length ? starts[n + 1][0] : lines.length;
  const body = lines.slice(i, end).join('\n');
  const m = l.match(/^app\.(\w+)\('([^']+)'/);
  if (!m || !/requireAuth/.test(body) || !m[2].includes(':')) return;
  if (!/_scopeCompany|_scopeInvoices|company_id/.test(body)) unscoped.push(m[1] + ' ' + m[2]);
});
check('every authenticated :id route still scopes to a company',
  unscoped.length === 0, unscoped.length ? 'UNSCOPED: ' + unscoped.join(', ') : '16 routes checked');

check('the restore route scopes its WRITE, not just its read',
  /_scopeCompany\(\s*supabase\.from\('jobs'\)\.update\(fields\)/.test(src));
check('and the migration now backfills the table it forgot',
  /update public\.job_revisions r set company_id = j\.company_id/.test(src));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
