// "i just send a job pack/order roof, but it's not showing on the home page
//  as orders sent … show the delivery date, also automatically transfer the
//  delivery date over to the schedule … if the job isn't on the list then
//  auto add the job to the list"
//
// The delivery date is the first hard date a job has, and it is the one the
// crew plans around. Until now it was typed into the order email and thrown
// away with the modal: the office read it back off the sent email, and the
// schedule board never heard about it at all.
//
// Ordering the roof now stamps the date on the job AND puts the job on the
// board for that day — updating the row if the job is already there, adding
// one if it is not. Best effort by design: the order HAS gone to the
// supplier, so a board that is off the plan, or a job with no name to show,
// must not turn a sent order into an error the office sees.
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

const CO = 'co-1', ME = 'user-1', MATE = 'user-2';
const NEWJOB = 'job-new', ONBOARD = 'job-onboard', NONAME = 'job-noname';
const db = {
  profiles: [{ id: ME, company_id: CO, name: 'Aron' }, { id: MATE, company_id: CO, name: 'Lizzie' }],
  company_users: [{ company_id: CO, user_id: ME, role: 'owner' },
                  { company_id: CO, user_id: MATE, role: 'member' }],
  companies: [{ id: CO, name: 'Flood Roofing', plan: 'business' }],
  user_settings: [], subscriptions: [],
  jobs: [
    { id: NEWJOB,  user_id: ME, company_id: CO, client_name: 'M. & R. Whitiora',
      site_address: '24 Kauri Rd, Kerikeri', status: 'draft', order_sent: null, draw_state: {} },
    { id: ONBOARD, user_id: ME, company_id: CO, client_name: 'D. Ngawaka',
      site_address: '112 Waipapa Rd', status: 'draft', order_sent: null, draw_state: {} },
    { id: NONAME,  user_id: ME, company_id: CO, client_name: '',
      site_address: '3 Marsden Rd', status: 'draft', order_sent: null, draw_state: {} },
  ],
  // D. Ngawaka is already on the board; the others are not.
  schedule_rows: [{ id: 'row-1', company_id: CO, user_id: ME, job_id: ONBOARD,
    client_name: 'D. Ngawaka', site_address: '112 Waipapa Rd', email: '', length_days: 4,
    notes: '', progress_pct: null, deposit_paid: null, ordered: null, delivery_check: false,
    confirmed_delivery: null, requested_delivery: null, sort_pos: null, archived: false,
    last_notified: null, handover_done: false, created_at: '2026-08-20T00:00:00Z' }],
  schedule_blocks: [],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.BILLING_ENABLED = 'false';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34823';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const tok = (id) => jwt.sign({ id, email: id + '@x.co.nz', cid: CO }, 'test-secret', { expiresIn: '1d' });
const post = (path, who, body) => fetch(BASE + path, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(who) },
  body: JSON.stringify(body || {}) });
const get = (path, who) => fetch(BASE + path, { headers: { Authorization: 'Bearer ' + tok(who) } });
const rowFor = (jobId) => db.schedule_rows.find(r => r.job_id === jobId);

// ── the stamp carries the delivery date ───────────────────────────
let r = await post('/jobs/' + NEWJOB + '/order-sent', ME,
  { to: 'orders@steel.co.nz', supplier: 'Example Steel', delivery_date: '2026-09-17' });
let body = await r.json();
check('ordering the roof is accepted', r.status === 200, 'status ' + r.status);
check('THE REPORT: the job is stamped as ordered so the home board can see it',
  db.jobs[0].status === 'ordered' && !!db.jobs[0].order_sent, JSON.stringify(db.jobs[0].order_sent));
check('…and the stamp carries the delivery date, so the board can show it',
  db.jobs[0].order_sent.delivery_date === '2026-09-17', JSON.stringify(db.jobs[0].order_sent));
check('…and says who sent it', body.order_sent && body.order_sent.by_name === 'Aron',
  JSON.stringify(body.order_sent));

// ── a job that was not on the board gets added ────────────────────
let added = rowFor(NEWJOB);
check('THE ASK: a job that was not on the schedule is put on it',
  !!added, db.schedule_rows.length + ' rows');
check('…on the day the delivery was asked for, and marked as requested only',
  !!added && added.requested_delivery === '2026-09-17' && !added.confirmed_delivery,
  added ? (added.requested_delivery + ' / confirmed ' + added.confirmed_delivery) : '');
check('…carrying the job\'s own name and address, so it reads on the board',
  !!added && added.client_name === 'M. & R. Whitiora' && /Kauri/.test(added.site_address || ''),
  added ? added.client_name : '');
check('…and linked to the job, not floating', !!added && added.job_id === NEWJOB);
check('…and the answer says so, so the app can refresh the board',
  !!body.scheduled && body.scheduled.job_id === NEWJOB, JSON.stringify(body.scheduled || null));

// ── a job already on the board is moved, not duplicated ───────────
const before = db.schedule_rows.length;
r = await post('/jobs/' + ONBOARD + '/order-sent', ME,
  { to: 'orders@steel.co.nz', supplier: 'Example Steel', delivery_date: '2026-10-02' });
check('ordering a job that is already on the board is accepted', r.status === 200, 'status ' + r.status);
check('…does not add a second row for the same job',
  db.schedule_rows.length === before, db.schedule_rows.length + ' rows, was ' + before);
check('…it moves the one that is there', rowFor(ONBOARD).requested_delivery === '2026-10-02',
  String(rowFor(ONBOARD).requested_delivery));

// ── ordering again with a new date moves it again ─────────────────
await post('/jobs/' + ONBOARD + '/order-sent', ME,
  { to: 'orders@steel.co.nz', supplier: 'Example Steel', delivery_date: '2026-10-09' });
check('re-ordering with a later date moves the delivery again',
  rowFor(ONBOARD).requested_delivery === '2026-10-09', String(rowFor(ONBOARD).requested_delivery));

// ── confirming is a date, not a second flag ───────────────────────
r = await fetch(BASE + '/schedule/rows/row-1', { method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(ME) },
  body: JSON.stringify({ confirmed_delivery: '2026-10-09' }) });
check('the supplier confirming the day is saved', r.status === 200, 'status ' + r.status);
check('…as the confirmed date itself, which is what turns the board green',
  rowFor(ONBOARD).confirmed_delivery === '2026-10-09', String(rowFor(ONBOARD).confirmed_delivery));

// ── the awkward inputs ────────────────────────────────────────────
r = await post('/jobs/' + NEWJOB + '/order-sent', ME, { to: 'o@x.co.nz', delivery_date: 'next tuesday' });
check('a date that is not a date is dropped rather than stored',
  r.status === 200 && db.jobs[0].order_sent.delivery_date === '', JSON.stringify(db.jobs[0].order_sent));
const n2 = db.schedule_rows.length;
r = await post('/jobs/' + NONAME + '/order-sent', ME, { to: 'o@x.co.nz', delivery_date: '2026-09-20' });
check('a job with no name is still ordered', r.status === 200 &&
  db.jobs[2].status === 'ordered', 'status ' + r.status);
check('…but is not added to the board as a blank row nobody can click',
  db.schedule_rows.length === n2, db.schedule_rows.length + ' rows, was ' + n2);

// ── somebody else's job is still nobody else's ────────────────────
r = await post('/jobs/does-not-exist/order-sent', ME, { to: 'o@x.co.nz', delivery_date: '2026-09-20' });
check('ordering a job that does not exist is refused, not silently accepted',
  r.status === 404, 'status ' + r.status);

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
