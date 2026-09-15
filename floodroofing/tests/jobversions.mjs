// Two people, one job, two versions.
//
// A job was one row, so two people working the same job meant whoever saved
// last won and the other's afternoon was gone. A version is a full job row of
// its own — its own drawing, quote and cut list — tied to the first one by
// version_of. Everything that already works on a job works on a version,
// because it IS a job.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const CO = 'company-flood', OTHER = 'company-other';
const ARON  = { user: 'user-aron',  company: CO };
const ETHAN = { user: 'user-ethan', company: CO };
const RIVAL = { user: 'user-rival', company: OTHER };

const { port, db } = await startFakePostgrest({
  profiles: [{ id: ARON.user, company_id: CO }, { id: ETHAN.user, company_id: CO }, { id: RIVAL.user, company_id: OTHER }],
  company_users: [{ company_id: CO, user_id: ARON.user, role: 'owner' },
                  { company_id: CO, user_id: ETHAN.user, role: 'member' },
                  { company_id: OTHER, user_id: RIVAL.user, role: 'owner' }],
  companies: [{ id: CO, name: 'Flood Roofing', plan: 'business' }, { id: OTHER, name: 'Rival', plan: 'business' }],
  user_settings: [], invoices: [],
  jobs: [{
    id: 'job-3045', user_id: ARON.user, company_id: CO,
    client_name: 'Test (Aron)', site_address: '23 Don Buck Road, Auckland',
    status: 'draft', created_at: '2026-09-01T01:00:00.000Z', updated_at: '2026-09-01T01:00:00.000Z',
    version_of: null, version_name: null, order_sent: null, settings: {},
    draw_state: { draw: { lines: [{ type: 'ridge' }] },
                  state: { quote: { ref: '3045', share: 'tok-live', accepted: { name: 'Mrs Henry' } } } },
  }],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34811';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const tok = w => jwt.sign({ id: w.user, email: w.user.replace('user-', '') + '@floodroofing.co.nz', cid: w.company }, 'test-secret');
const as = (w, path, opts) => fetch(BASE + path, {
  ...(opts || {}),
  headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok(w), ...((opts || {}).headers || {}) },
});

// ── one job, one version ─────────────────────────────────────────
let v = await (await as(ARON, '/jobs/job-3045/versions')).json();
check('a job that has never been branched has exactly one version',
  v.versions && v.versions.length === 1 && v.versions[0].id === 'job-3045', JSON.stringify(v.versions));
check('…and it is the first one, named so there is something to point at',
  v.versions[0].is_root === true && v.versions[0].name === 'Original', JSON.stringify(v.versions[0]));

// ── Ethan takes his own copy ─────────────────────────────────────
const made = await (await as(ETHAN, '/jobs/job-3045/versions', { method: 'POST', body: '{}' })).json();
check('a second person can take a version of the job', !!made.id && made.id !== 'job-3045', JSON.stringify(made));
check('…named after whoever made it, so the list says who is who',
  made.name === "Ethan's version", made.name);
const copy = db.jobs.find(j => j.id === made.id);
check('…carrying the drawing across', copy && JSON.stringify(copy.draw_state.draw) === JSON.stringify({ lines: [{ type: 'ridge' }] }));
// The customer's link and their acceptance belong to the version they were
// sent. A copy that carried them would show a second job as accepted, and
// two jobs would answer the same customer link.
check('…but NOT the customer\'s live link or their acceptance',
  copy && copy.draw_state.state.quote.share === null && copy.draw_state.state.quote.accepted === null,
  JSON.stringify(copy && copy.draw_state.state.quote));
check('…hung off the first version, not off itself', copy && copy.version_of === 'job-3045', copy && copy.version_of);
check('…and owned by the person who made it', copy && copy.user_id === ETHAN.user);

// ── both of them see both versions ───────────────────────────────
for (const [who, label] of [[ARON, 'Aron'], [ETHAN, 'Ethan']]){
  const g = await (await as(who, '/jobs/' + made.id + '/versions')).json();
  check(label + ' sees both versions of the job, from either one',
    g.versions && g.versions.length === 2 &&
    g.versions.map(x => x.id).sort().join(',') === ['job-3045', made.id].sort().join(','),
    JSON.stringify((g.versions || []).map(x => x.name)));
}
const g2 = await (await as(ARON, '/jobs/job-3045/versions')).json();
check('the first version keeps the first slot, whichever one you ask from',
  g2.versions[0].id === 'job-3045' && g2.versions[0].is_root === true);
check('…and the answer says which one you are on', g2.current === 'job-3045', g2.current);

// ── working on one does not touch the other ──────────────────────
await as(ETHAN, '/jobs/' + made.id, { method: 'PUT', body: JSON.stringify({
  client_name: 'Test (Ethan)', draw_state: { draw: { lines: [{ type: 'ridge' }, { type: 'hip' }] }, state: {} } }) });
const aronRow = db.jobs.find(j => j.id === 'job-3045');
check('Ethan working on his version leaves Aron\'s alone',
  aronRow.client_name === 'Test (Aron)' && aronRow.draw_state.draw.lines.length === 1,
  aronRow.client_name + ' / ' + aronRow.draw_state.draw.lines.length + ' lines');

// ── a third version does not collide on the name ─────────────────
const third = await (await as(ETHAN, '/jobs/job-3045/versions', { method: 'POST', body: '{}' })).json();
check('a second version from the same person gets its own name',
  third.name === "Ethan's version 2", third.name);
const named = await (await as(ARON, '/jobs/job-3045/versions', { method: 'POST', body: JSON.stringify({ name: 'Priced high' }) })).json();
check('…and a version can be named outright', named.name === 'Priced high', named.name);

// ── renaming ─────────────────────────────────────────────────────
let r = await as(ARON, '/jobs/' + made.id + '/version-name', { method: 'PUT', body: JSON.stringify({ name: 'Ethan — steel option' }) });
check('a version can be renamed', r.status === 200 && db.jobs.find(j => j.id === made.id).version_name === 'Ethan — steel option');
r = await as(ARON, '/jobs/' + made.id + '/version-name', { method: 'PUT', body: JSON.stringify({ name: '   ' }) });
check('…but not to nothing', r.status === 400);

// ── another business cannot see or branch it ─────────────────────
r = await as(RIVAL, '/jobs/job-3045/versions');
check('another business cannot list this job\'s versions', r.status === 404, 'status ' + r.status);
r = await as(RIVAL, '/jobs/job-3045/versions', { method: 'POST', body: '{}' });
check('…nor take a copy of it', r.status === 404, 'status ' + r.status);
const before = db.jobs.length;
r = await as(RIVAL, '/jobs/' + made.id + '/version-name', { method: 'PUT', body: JSON.stringify({ name: 'mine now' }) });
check('…nor rename one', r.status === 404 && db.jobs.length === before, 'status ' + r.status);

// ── the board carries the labels, so a list can group them ───────
const board = await (await as(ARON, '/jobs')).json();
const row = (board || []).find(j => j.id === made.id);
check('the job list carries the version name and its group',
  row && row.version_name === 'Ethan — steel option' && row.version_of === 'job-3045',
  JSON.stringify(row && { n: row.version_name, of: row.version_of }));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
