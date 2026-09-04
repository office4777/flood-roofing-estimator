// Exercises the REAL server.js against an in-memory stand-in for PostgREST.
// The question this answers: with three logins in ONE company, do they share
// jobs, settings and the job-number counter, and does every job say who did it?
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { pathToFileURL } from 'node:url';

import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');

const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const CO = '11111111-1111-1111-1111-111111111111';
const AARON = 'aaaaaaaa-0000-0000-0000-000000000001';
const ETHAN = 'eeeeeeee-0000-0000-0000-000000000002';
const MATT  = 'mmmmmmmm-0000-0000-0000-000000000003';

const db = {
  __missing: [],
  profiles: [
    { id: AARON, company_id: CO, name: 'Aaron', email: 'aaron@floodroofing.co.nz' },
    { id: ETHAN, company_id: CO, name: 'Ethan', email: 'ethan@floodroofing.co.nz' },
    { id: MATT,  company_id: CO, name: '',      email: 'matt@floodroofing.co.nz' },
  ],
  company_users: [
    { company_id: CO, user_id: AARON, role: 'owner' },
    { company_id: CO, user_id: ETHAN, role: 'member' },
    { company_id: CO, user_id: MATT,  role: 'member' },
  ],
  jobs: [
    { id: 'job-a', company_id: CO, user_id: MATT,  client_name: 'Mrs Hale',   site_address: '3 Kea St',  status: 'draft', updated_at: '2026-08-19T02:00:00Z', created_at: '2026-08-18T02:00:00Z', order_sent: null },
    { id: 'job-b', company_id: CO, user_id: AARON, client_name: 'Mr Aiono',   site_address: '9 Tui Rd',  status: 'ordered', updated_at: '2026-08-19T01:00:00Z', created_at: '2026-08-17T02:00:00Z',
      order_sent: { at: '2026-08-19T01:00:00Z', to: 'orders@steel.co.nz', supplier: 'Steel & Tube', by: ETHAN } },
  ],
  // Aaron's private settings row, and a stale one of Ethan's — the state a real
  // company is in right now, before anything is shared.
  user_settings: [
    { user_id: AARON, company_id: CO, updated_at: '2026-08-19T02:00:00Z',
      branding: { company_name: 'Flood Roofing' }, quote_defaults: { next_job_no: '06121', gst_rate: 15 }, price_book: { screw: 0.4 }, jms_keys: {}, labour_pricing: {} },
    { user_id: ETHAN, company_id: CO, updated_at: '2026-08-01T02:00:00Z',
      branding: { company_name: 'STALE' }, quote_defaults: { next_job_no: '00001' }, price_book: {}, jms_keys: {}, labour_pricing: {} },
  ],
};

const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'test-key';
process.env.JWT_SECRET = 'test-secret';
// TEST_PORT lets the runner give each suite its own, so suites can
// never collide with each other or with a run already going.
const PORT = process.env.TEST_PORT || '34567';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;          // force the read-modify-write path
delete process.env.STRIPE_SECRET_KEY;
process.env.BILLING_ENABLED = 'false';

const jwt = require('jsonwebtoken');
const tok = (id, email) => jwt.sign({ id, email, cid: CO }, 'test-secret', { expiresIn: '1h' });

// Boot the real app and grab its port.
const listenLog = [];
const origLog = console.log; console.log = (...a) => listenLog.push(a.join(' '));
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = origLog;
await new Promise(r => setTimeout(r, 700));
const api = async (method, path, body, who) => {
  const r = await fetch('http://127.0.0.1:' + PORT + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(who.id, who.email) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const aaron = { id: AARON, email: 'aaron@floodroofing.co.nz' };
const ethan = { id: ETHAN, email: 'ethan@floodroofing.co.nz' };
const matt  = { id: MATT,  email: 'matt@floodroofing.co.nz' };

// ── jobs are the company's, and each says who made it ──
let r = await api('GET', '/jobs', null, ethan);
check('Ethan sees jobs he did not create — the list is the company\'s', r.status === 200 && r.body.length === 2, JSON.stringify(r.body && r.body.map(j=>j.id)));
const byId = Object.fromEntries((r.body||[]).map(j => [j.id, j]));
check('a job made by Matt says so', byId['job-a'] && byId['job-a'].created_by === 'matt', 'created_by: ' + (byId['job-a']||{}).created_by);
check('…and one made by Aaron says Aaron', byId['job-b'] && byId['job-b'].created_by === 'Aaron', 'created_by: ' + (byId['job-b']||{}).created_by);
check('the material order names who sent it',
  byId['job-b'] && byId['job-b'].order_sent && byId['job-b'].order_sent.by_name === 'Ethan',
  JSON.stringify((byId['job-b']||{}).order_sent));

// ── the order stamp is written by the SERVER, not trusted from the client ──
r = await api('POST', '/jobs/job-a/order-sent', { to: 'orders@steel.co.nz', supplier: 'Steel & Tube', by: AARON }, matt);
check('sending an order stamps it', r.status === 200 && r.body.ok, JSON.stringify(r.body));
const stamped = db.jobs.find(j => j.id === 'job-a');
check('…with the authenticated user, ignoring whatever the client claimed',
  stamped.order_sent && stamped.order_sent.by === MATT && stamped.status === 'ordered',
  JSON.stringify(stamped.order_sent));

// ── settings are the business's, not the login's ──
r = await api('GET', '/settings', null, ethan);
check('Ethan reads the COMPANY price book, not his own stale copy',
  r.body && r.body.branding.company_name === 'Flood Roofing' && r.body.price_book.screw === 0.4,
  JSON.stringify(r.body && r.body.branding));
r = await api('GET', '/settings', null, matt);
check('…and so does Matt, who has no row of his own',
  r.body && r.body.branding.company_name === 'Flood Roofing', JSON.stringify(r.body && r.body.branding));

// a teammate's save lands on the shared row, not a private one
r = await api('PUT', '/settings', { branding: { company_name: 'Flood Roofing' }, quote_defaults: { next_job_no: '06121', gst_rate: 15 },
  price_book: { screw: 0.55 }, jms_keys: {}, labour_pricing: {} }, matt);
check('Matt saving the price book updates the company row', r.status === 200, JSON.stringify(r.body && r.body.price_book));
check('…without creating a private row of his own',
  db.user_settings.length === 2 && !db.user_settings.some(s => s.user_id === MATT), db.user_settings.length + ' settings rows');
check('…and it records that Matt was the one who changed it',
  (db.user_settings.find(s => s.user_id === AARON) || {}).updated_by === MATT);
r = await api('GET', '/settings', null, aaron);
check('Aaron immediately sees Matt\'s change', r.body && r.body.price_book.screw === 0.55, JSON.stringify(r.body && r.body.price_book));

// ── the job-number counter is one counter for the business ──
const a1 = await api('POST', '/settings/next-job-no', {}, matt);
const a2 = await api('POST', '/settings/next-job-no', {}, ethan);
const a3 = await api('POST', '/settings/next-job-no', {}, aaron);
check('three staff each get a DIFFERENT job number',
  a1.body.jobNo === '06121' && a2.body.jobNo === '06122' && a3.body.jobNo === '06123',
  [a1,a2,a3].map(x=>x.body.jobNo).join(', '));
check('…zero padding is preserved', /^\d{5}$/.test(a3.body.next), 'next: ' + a3.body.next);
r = await api('GET', '/settings', null, ethan);
check('…and the counter that everyone reads has moved with them',
  r.body.quote_defaults.next_job_no === '06124', r.body.quote_defaults.next_job_no);

// ── a database that hasn't run the migration yet must not break the board ──
db.__missing = ['order_sent'];
r = await api('GET', '/jobs', null, aaron);
check('the job list still loads on a database missing the new column',
  r.status === 200 && r.body.length === 2 && r.body[0].created_by, 'status ' + r.status);
db.__missing = [];

// ── two functions with one name ────────────────────────────────────────
// A helper added near the bottom of the file was called _companyMembers,
// which was already the name of the id → name map _nameOf reads. The second
// declaration silently won, and every "made by" and "sent by" line in the
// app went blank — no error, nothing in the log, four checks in this suite
// the only sign of it. The file is 9,000 lines; a person cannot hold its
// function names in their head, so the file is asked instead.
{
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(_j(_ROOT, 'backend', 'server.js'), 'utf8');
  const seen = {}, dupes = [];
  for (const m of src.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)\s*\(/gm)) {
    if (seen[m[1]]) dupes.push(m[1]); else seen[m[1]] = true;
  }
  check('no two functions in server.js share a name', dupes.length === 0, dupes.join(', '));
}

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.filter(x=>!x).length ? 1 : 0);
