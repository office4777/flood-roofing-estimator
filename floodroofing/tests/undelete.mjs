// "I just accidentally deleted job 3231 — are you able to bring it back?"
//
// It always was recoverable: deleting a job fires a database trigger that
// writes one final snapshot of the whole job into job_revisions, and the
// restore route re-creates a job that no longer exists. But that was a thing
// only we could do, by hand, if somebody asked — so an accident meant losing
// the work until somebody noticed and wrote in. The snapshots a delete leaves
// are listed on the Home board now, and putting one back is a button.
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

const now = new Date().toISOString();
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const C1 = 'cccccccc-0000-0000-0000-000000000001';
const C2 = 'cccccccc-0000-0000-0000-000000000002';
const U1 = 'uuuuuuuu-0000-0000-0000-000000000001';
const U2 = 'uuuuuuuu-0000-0000-0000-000000000002';
const J_LIVE = '11111111-1111-1111-1111-111111111111';
const J_GONE = '22222222-2222-2222-2222-222222222222';
const J_OTHER = '33333333-3333-3333-3333-333333333333';
const J_BACK = '44444444-4444-4444-4444-444444444444';

// The whole job, as the delete trigger copies it: drawing, quote and all.
const drawState = { state: { quote: { ref: '3231', client: 'Matawaia Marae', gstRate: 15,
  lineItems: [{ desc: 'Labour', qty: 1, unit: 9000 }, { desc: 'Materials', qty: 1, unit: 12000 }],
  share: { token: 'tok3231', status: 'sent' } } },
  draw: { outline: [[0,0],[10,0],[10,10],[0,10]], roofs: [{ name: 'Main Roof' }, { name: 'Roof 2' }], lines: [] } };

const db = {
  __missing: [],
  companies: [{ id: C1, name: 'Flood Roofing', plan: 'team' }, { id: C2, name: 'Someone Else', plan: 'team' }],
  profiles: [{ id: U1, company_id: C1, email: 'aron@floodroofing.co.nz' },
             { id: U2, company_id: C2, email: 'other@example.co.nz' }],
  company_users: [{ company_id: C1, user_id: U1, role: 'owner' },
                  { company_id: C2, user_id: U2, role: 'owner' }],
  user_settings: [], subscriptions: [], invoices: [], platform_state: [], usage_events: [],
  jobs: [
    { id: J_LIVE, user_id: U1, company_id: C1, client_name: 'Still Here', site_address: '1 Live St',
      status: 'draft', created_at: now, updated_at: now, order_sent: null, draw_state: {} },
  ],
  job_revisions: [
    // The job the owner deleted by accident, with its final snapshot.
    { id: 501, job_id: J_GONE, company_id: C1, user_id: U1, client_name: 'Matawaia Marae',
      site_address: '1888 Matawaia-Maromaku Road', status: 'quoted', draw_state: drawState,
      settings: {}, reason: 'delete', saved_at: ago(5) },
    // An ordinary update snapshot of the same job, from before it went.
    { id: 500, job_id: J_GONE, company_id: C1, user_id: U1, client_name: 'Matawaia Marae',
      site_address: '1888 Matawaia-Maromaku Road', status: 'quoted', draw_state: { state: {}, draw: {} },
      settings: {}, reason: 'update', saved_at: ago(40) },
    // A job that WAS deleted and has already been put back: it is alive, so
    // it must not be offered again.
    { id: 502, job_id: J_LIVE, company_id: C1, user_id: U1, client_name: 'Still Here',
      site_address: '1 Live St', status: 'draft', draw_state: {}, settings: {}, reason: 'delete', saved_at: ago(90) },
    // Another company's deleted job. Never ours to see or to restore.
    { id: 503, job_id: J_OTHER, company_id: C2, user_id: U2, client_name: 'Not Your Job',
      site_address: '9 Other Rd', status: 'draft', draw_state: {}, settings: {}, reason: 'delete', saved_at: ago(10) },
    // Deleted twice: the newest delete is the one that undoes what just happened.
    { id: 504, job_id: J_BACK, company_id: C1, user_id: U1, client_name: 'Twice Deleted',
      site_address: '2 Repeat Rd', status: 'draft', draw_state: { v: 'old' }, settings: {}, reason: 'delete', saved_at: ago(300) },
    { id: 505, job_id: J_BACK, company_id: C1, user_id: U1, client_name: 'Twice Deleted',
      site_address: '2 Repeat Rd', status: 'draft', draw_state: { v: 'new' }, settings: {}, reason: 'delete', saved_at: ago(3) },
  ],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34655';
process.env.PORT = PORT;
process.env.BILLING_ENABLED = 'false';
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn, cerr = console.error;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn; console.error = cerr;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const tok = (id, cid) => jwt.sign({ id, email: 'x@y.nz', cid }, 'test-secret', { expiresIn: '1h' });
const api = async (m, path, who) => {
  const r = await fetch(BASE + path, { method: m, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + who } });
  let b = null; try { b = await r.json(); } catch(e){}
  return { status: r.status, body: b };
};
const MINE = tok(U1, C1), THEIRS = tok(U2, C2);

// ── the board lists what was deleted ──
let r = await api('GET', '/jobs/deleted', MINE);
check('the deleted jobs are listed', r.status === 200 && Array.isArray(r.body), String(r.status));
const list = r.body || [];
const gone = list.find(x => x.job_id === J_GONE);
check('THE FIX: the job deleted by accident is there, by name and address',
  !!gone && gone.client_name === 'Matawaia Marae' && /Matawaia-Maromaku/.test(gone.site_address), JSON.stringify(gone));
check('…with the snapshot that puts it back, and when it went', !!gone && gone.revision_id === 501 && !!gone.deleted_at, JSON.stringify(gone && { rev: gone.revision_id, at: gone.deleted_at }));
check('…and a job already back on the board is not offered again', !list.some(x => x.job_id === J_LIVE), JSON.stringify(list.map(x => x.client_name)));
check('…nor another company’s deleted job', !list.some(x => x.job_id === J_OTHER), JSON.stringify(list.map(x => x.client_name)));
const twice = list.find(x => x.job_id === J_BACK);
check('…and a job deleted twice offers the NEWEST snapshot, not the first', !!twice && twice.revision_id === 505, JSON.stringify(twice));
check('the list never carries the snapshots themselves — they are the whole job, photos and all',
  list.every(x => x.draw_state === undefined), JSON.stringify(Object.keys(list[0] || {})));
r = await api('GET', '/jobs/deleted', THEIRS);
check('the other company sees only its own', (r.body || []).length === 1 && r.body[0].job_id === J_OTHER, JSON.stringify((r.body||[]).map(x => x.client_name)));

// ── putting it back ──
r = await api('POST', '/jobs/' + J_GONE + '/revisions/501/restore', MINE);
check('THE FIX: restoring it answers ok, and says it re-created the job', r.status === 200 && r.body.ok === true && r.body.recreated === true, JSON.stringify(r.body));
const back = db.jobs.find(j => j.id === J_GONE);
check('…the job is on the board again, under its own id', !!back && back.client_name === 'Matawaia Marae', JSON.stringify(back && { id: back.id, client: back.client_name }));
check('…with the drawing it had', !!back && back.draw_state.draw.roofs.length === 2 && back.draw_state.draw.outline.length === 4, JSON.stringify(back && back.draw_state.draw && Object.keys(back.draw_state.draw)));
check('…and the quote it had, priced, with its customer link still working',
  !!back && back.draw_state.state.quote.ref === '3231' && back.draw_state.state.quote.lineItems.length === 2 && back.draw_state.state.quote.share.token === 'tok3231',
  JSON.stringify(back && back.draw_state.state.quote && { ref: back.draw_state.state.quote.ref, token: back.draw_state.state.quote.share.token }));
check('…belonging to the business that lost it', !!back && back.company_id === C1 && back.user_id === U1);
r = await api('GET', '/jobs/deleted', MINE);
check('…and it drops off the deleted list, being alive again', !(r.body || []).some(x => x.job_id === J_GONE), JSON.stringify((r.body||[]).map(x => x.client_name)));

// ── nobody else can put it back ──
r = await api('POST', '/jobs/' + J_BACK + '/revisions/505/restore', THEIRS);
check('another company cannot restore a job that is not theirs', r.status === 404, String(r.status));
check('…and nothing was created', !db.jobs.some(j => j.id === J_BACK));

// ── signed out ──
r = await fetch(BASE + '/jobs/deleted');
check('the deleted list needs a login', r.status === 401 || r.status === 403, String(r.status));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
