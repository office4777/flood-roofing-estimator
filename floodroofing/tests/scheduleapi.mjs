// The schedule board's backend: the office's forward-workflow calendar.
// Pencil a job in dark red when a rough window is promised, repaint it in
// a crew colour when solid-booked. This suite holds the tenancy lines
// (one business never sees another's board), the Business-tier gate, the
// auto-filled admin columns, the working-day arithmetic, the customer
// email composition, and the signed calendar feed.
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

const A = { user: 'user-a', company: 'company-a' };   // Business — has the board
const B = { user: 'user-b', company: 'company-b' };   // Business — the rival next door
const T = { user: 'user-t', company: 'company-t' };   // Team — priced out of the board

const JOB = 'job-a1';
const { port } = await startFakePostgrest({
  profiles: [{ id: A.user, company_id: A.company }, { id: B.user, company_id: B.company },
             { id: T.user, company_id: T.company }],
  company_users: [{ company_id: A.company, user_id: A.user, role: 'owner' },
                  { company_id: B.company, user_id: B.user, role: 'owner' },
                  { company_id: T.company, user_id: T.user, role: 'owner' }],
  companies: [{ id: A.company, name: 'Flood Roofing', plan: 'business' },
              { id: B.company, name: 'Rival Roofing', plan: 'business' },
              { id: T.company, name: 'Small Roofing', plan: 'team' }],
  user_settings: [{ user_id: A.user, company_id: A.company,
    branding: { company_name: 'Flood Roofing', email: 'office@floodroofing.co.nz' },
    quote_defaults: {}, jms_keys: {}, updated_at: new Date().toISOString() }],
  jobs: [{ id: JOB, user_id: A.user, company_id: A.company, client_name: 'Brian Lewis',
    site_address: '148 Horeke Road, Okaihau', status: 'ordered',
    order_sent: { at: '2026-08-01T00:00:00Z', by: A.user },
    draw_state: { state: { quote: { accepted: { at: '2026-07-20T09:00:00Z' },
                                    client: { email: 'brian@lewis.co.nz' } } } } }],
  invoices: [{ id: 'inv-1', company_id: A.company, user_id: A.user, job_id: JOB,
    type: 'deposit', status: 'paid', number: 'INV-1001' }],
  schedule_rows: [], schedule_blocks: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34755';
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
const j = r => r.json();

// ── the tier gate ─────────────────────────────────────────────────
let r = await as(T, '/schedule');
let body = await j(r);
check('a Team-plan business is told the board is Business tier',
  r.status === 402 || r.status === 403, 'status ' + r.status + ' ' + JSON.stringify(body).slice(0, 90));
check('…and the refusal names Business', /Business/i.test(JSON.stringify(body)));

// ── the board reads, with auto-filled admin columns ───────────────
r = await as(A, '/schedule/rows', { method: 'POST', body: JSON.stringify({ job_id: JOB, length_days: 8 }) });
const rowA = await j(r);
check('a linked row snapshots the job identity', r.status === 200 &&
  rowA.client_name === 'Brian Lewis' && /Horeke/.test(rowA.site_address), JSON.stringify(rowA).slice(0, 100));

r = await as(A, '/schedule/rows', { method: 'POST', body: JSON.stringify({
  client_name: 'Modspace', site_address: 'Whetu Rau', length_days: 3, email: 'site@modspace.co.nz' }) });
const rowQ = await j(r);
check('a quick row needs only a name', r.status === 200 && rowQ.id, JSON.stringify(rowQ).slice(0, 80));

r = await as(A, '/schedule'); body = await j(r);
check('the board lists both rows', (body.rows || []).length === 2, (body.rows || []).length + ' rows');
const linked = (body.rows || []).find(x => x.job_id === JOB) || {};
check('acceptance date auto-fills from the accepted quote',
  String(linked.accepted_at || '').startsWith('2026-07-20'), String(linked.accepted_at));
check('Deposit Paid auto-fills from the paid deposit invoice', linked.deposit_paid === true, String(linked.deposit_paid));
check('Ordered auto-fills from the sent order', linked.ordered === true, String(linked.ordered));
check('the customer email auto-fills from the quote client', linked.email === 'brian@lewis.co.nz', linked.email);
check('weekends are non-working days', (body.nonwork || []).includes('2026-09-05'), 'sample Sat 2026-09-05');
check('NZ public holidays are non-working days', (body.nonwork || []).includes('2026-12-25'), 'Christmas Day');
check('the feed URL is signed', /\/schedule\/feed\.ics\?c=.*&sig=[0-9a-f]{64}/.test(body.feed_url || ''), body.feed_url);
const FEED_URL = body.feed_url;

// An override beats the auto-fill.
r = await as(A, '/schedule/rows/' + linked.id, { method: 'PATCH', body: JSON.stringify({ deposit_paid: false }) });
check('an office override sticks', r.status === 200, 'status ' + r.status);
body = await j(await as(A, '/schedule'));
check('…and beats the auto-fill on the next read',
  (body.rows.find(x => x.id === linked.id) || {}).deposit_paid === false);

// ── blocks: pencil, then solid-book ───────────────────────────────
// Fri 2026-09-04: an 8-working-day pencil must span the weekend.
r = await as(A, '/schedule/blocks', { method: 'POST', body: JSON.stringify({
  row_id: rowA.id, kind: 'pencil', start_date: '2026-09-04', work_days: 8 }) });
const pencil = await j(r);
check('a pencil block paints', r.status === 200 && pencil.kind === 'pencil', JSON.stringify(pencil).slice(0, 80));

r = await as(A, '/schedule/blocks/' + pencil.id, { method: 'PATCH', body: JSON.stringify({
  kind: 'crew', crew_id: 'crew1' }) });
check('repainting the pencil with a crew solid-books it', r.status === 200 && (await j(r)).kind === 'crew');

// ── the customer emails ───────────────────────────────────────────
r = await as(A, '/schedule/rows/' + rowA.id + '/compose', { method: 'POST', body: JSON.stringify({ kind: 'confirm' }) });
body = await j(r);
check('the confirm email carries the exact start date',
  r.status === 200 && /Friday|4 September/.test(body.subject + body.body), (body.subject || '') + ' | ' + String(body.body).slice(0, 80));
check('…addressed to the customer', body.to === 'brian@lewis.co.nz', body.to);

// Month-part wording: early / mid / late.
r = await as(A, '/schedule/blocks', { method: 'POST', body: JSON.stringify({
  row_id: rowQ.id, kind: 'pencil', start_date: '2026-10-27', work_days: 3 }) });
check('second pencil painted', r.status === 200);
r = await as(A, '/schedule/rows/' + rowQ.id + '/compose', { method: 'POST', body: JSON.stringify({ kind: 'pencil' }) });
body = await j(r);
check('a pencil email promises only "late October" — no exact date',
  r.status === 200 && /late October/.test(body.body) && !/27/.test(body.body), String(body.body).slice(0, 120));

r = await as(A, '/schedule/rows/' + rowQ.id + '/compose', { method: 'POST', body: JSON.stringify({ kind: 'confirm' }) });
check('confirm refuses when nothing is solid-booked', r.status === 400, 'status ' + r.status);

// ── one business never sees another's board ───────────────────────
body = await j(await as(B, '/schedule'));
check("B's board is empty — A's rows are invisible", (body.rows || []).length === 0, (body.rows || []).length + ' rows');
r = await as(B, '/schedule/rows/' + rowA.id, { method: 'PATCH', body: JSON.stringify({ notes: 'hijack' }) });
check("B cannot edit A's row", r.status === 404, 'status ' + r.status);
r = await as(B, '/schedule/blocks/' + pencil.id, { method: 'DELETE' });
check("B cannot delete A's block", r.status === 404, 'status ' + r.status);

// ── the calendar feed ─────────────────────────────────────────────
const feedPath = FEED_URL.replace(/^https?:\/\/[^/]+/, '');
r = await fetch(BASE + feedPath);
let ics = await r.text();
check('the signed feed serves solid bookings', r.status === 200 &&
  /BEGIN:VCALENDAR/.test(ics) && /Brian Lewis/.test(ics), ics.slice(0, 60).replace(/\r?\n/g, ' '));
check('…as all-day events spanning working days over the weekend',
  /DTSTART;VALUE=DATE:20260904/.test(ics) && /DTEND;VALUE=DATE:20260916/.test(ics),
  (ics.match(/DTSTART[^\r\n]*/) || [''])[0] + ' ' + (ics.match(/DTEND[^\r\n]*/) || [''])[0]);
check('…and pencilled jobs stay off the customer-visible calendar', !/Modspace/.test(ics));

r = await fetch(BASE + feedPath.replace(/sig=\w{10}/, 'sig=0000000000'));
check('a tampered signature gets nothing', r.status === 404, 'status ' + r.status);

r = await as(A, '/schedule/feed-secret', { method: 'POST' });
body = await j(r);
check('regenerating the secret issues a new link', r.status === 200 && body.feed_url && body.feed_url !== FEED_URL);
r = await fetch(BASE + feedPath);
check('…and the old link dies', r.status === 404, 'status ' + r.status);

// ── config round-trip ─────────────────────────────────────────────
r = await as(A, '/schedule/config', { method: 'PUT', body: JSON.stringify({
  crews: [{ id: 'troy', name: 'Troy', colour: '#4472c4' }, { id: 'scaffold', name: 'Scaffold', colour: '#0a1628' }],
  cap: 3, region: 'auckland',
  shutdowns: [{ from: '2026-12-21', to: '2027-01-09', label: 'Christmas break' }] }) });
check('config saves', r.status === 200, 'status ' + r.status);
body = await j(await as(A, '/schedule'));
check('…and the shutdown becomes non-working days', (body.nonwork || []).includes('2026-12-23'));
check('…and crews round-trip', (body.cfg.crews || []).some(c => c.name === 'Troy'), JSON.stringify(body.cfg.crews));
check('…and the feed secret never leaves the server', body.cfg.feed_secret === undefined);

const pass = results.filter(Boolean).length;
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
