// The job board 500'd with "canceling statement due to statement timeout" on
// a real account. Same shape as the quote feed before it: _scopeCompany's
// `company_id = X OR (company_id is null AND user_id = me)` stops Postgres
// using either index, so the board walked the whole jobs table.
//
// GET /jobs now reads the two scope arms as two separately indexed queries
// and merges them. That is only safe if the merge still shows exactly the
// jobs the one query showed — every one of the company's, the caller's own
// pre-company rows, each job once, newest first, and nothing of anyone
// else's. That is what this pins.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const A = { user: 'user-a', company: 'company-a' };
const B = { user: 'user-b', company: 'company-b' };
const mate = 'user-a2';                       // A's workmate, same company
const job = (id, user_id, company_id, updated_at) => ({
  id, user_id, company_id, client_name: id, site_address: id + ' street',
  created_at: '2026-01-01T00:00:00.000Z', updated_at, status: 'draft',
  order_sent: null, draw_state: { state: {} },
});

const { port, db } = await startFakePostgrest({
  profiles: [{ id: A.user, company_id: A.company }, { id: B.user, company_id: B.company },
             { id: mate, company_id: A.company }],
  company_users: [{ company_id: A.company, user_id: A.user, role: 'owner' },
                  { company_id: A.company, user_id: mate, role: 'staff' },
                  { company_id: B.company, user_id: B.user, role: 'owner' }],
  user_settings: [], invoices: [],
  jobs: [
    job('a-new',    A.user, A.company, '2026-03-03T00:00:00.000Z'),
    job('mate-mid', mate,   A.company, '2026-02-02T00:00:00.000Z'),
    // Predates companies: no company_id, owned by A. The legacy arm.
    job('a-legacy', A.user, null,      '2026-01-05T00:00:00.000Z'),
    // Someone else's legacy row — matched by NEITHER arm.
    job('b-legacy', B.user, null,      '2026-04-04T00:00:00.000Z'),
    job('b-own',    B.user, B.company, '2026-05-05T00:00:00.000Z'),
  ],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34655';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const tok = w => jwt.sign({ id: w.user, email: w.user + '@x.co.nz', cid: w.company }, 'test-secret');
const list = async w => (await fetch(BASE + '/jobs', {
  headers: { Authorization: 'Bearer ' + tok(w) } })).json();

const rows = await list(A);
const ids = (rows || []).map(j => j.id);
check('the board still answers', Array.isArray(rows), JSON.stringify(rows).slice(0, 80));
check('the company\'s jobs are all there, workmates\' included',
  ids.indexOf('a-new') >= 0 && ids.indexOf('mate-mid') >= 0, ids.join(','));
check('…and so is a row from before companies existed',
  ids.indexOf('a-legacy') >= 0, ids.join(','));
check('…each exactly once', ids.length === new Set(ids).size, ids.join(','));
check('…newest first', ids.join(',') === 'a-new,mate-mid,a-legacy', ids.join(','));
check('and no other business\'s job rides in — not even their legacy one',
  ids.indexOf('b-own') < 0 && ids.indexOf('b-legacy') < 0, ids.join(','));

const bRows = await list(B);
check('the other business sees its own board, unchanged',
  (bRows || []).map(j => j.id).sort().join(',') === 'b-legacy,b-own',
  (bRows || []).map(j => j.id).join(','));

// ── a big board does not take the whole table with it ────────────
// The read had no LIMIT, so it had to find EVERY matching row before it could
// answer — and an office with a few thousand jobs on a churned table ran past
// the PostgREST role's 8-second statement_timeout. A subscriber in their
// first week got a 500 where their job list should be.
for (let i = 0; i < 620; i++)
  db.jobs.push(job('bulk-' + i, A.user, A.company, '2026-02-' + String((i % 27) + 1).padStart(2, '0') + 'T00:00:00.000Z'));
const big = await list(A);
check('a board of hundreds of jobs comes back capped, not whole',
  Array.isArray(big) && big.length <= 500, String((big || []).length));
const ten = await (await fetch(BASE + '/jobs?limit=10', { headers: { Authorization: 'Bearer ' + tok(A) } })).json();
check('…and the caller can ask for fewer', Array.isArray(ten) && ten.length === 10, String((ten || []).length));
check('…newest first is still what it means', ten[0] && ten[0].id === 'a-new', ten[0] && ten[0].id);

// A timed-out read is not an empty job list and not a dead app: it comes back
// once for the most recent handful, so the office is working rather than
// ringing us.
db.__fail500 = 'jobs'; db.__fail500Once = true; db.__failMsg = 'canceling statement due to statement timeout';
const afterTimeout = await list(A);
db.__fail500 = null; db.__failMsg = null;
check('a statement timeout on the board is retried, not served as a 500',
  Array.isArray(afterTimeout) && afterTimeout.length > 0,
  Array.isArray(afterTimeout) ? (afterTimeout.length + ' jobs') : JSON.stringify(afterTimeout).slice(0, 80));

// ── and the indexes each arm needs are in the boot migration ──────
const src = await readFile(_j(_ROOT, 'backend', 'server.js'), 'utf8');
check('the boot migration indexes the company arm, newest first',
  /idx_jobs_company_recent on public\.jobs \(company_id, updated_at desc\)/.test(src));
check('…and the user arm too', 
  /idx_jobs_user_recent on public\.jobs \(user_id, updated_at desc\)/.test(src));
check('the board no longer reads through the un-indexable OR',
  !/_scopeCompany\(supabase\.from\('jobs'\)\.select\(COLS\)/.test(src));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
