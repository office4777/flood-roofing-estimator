// The schedule board's backend: the office's forward-workflow calendar.
// Pencil a job in dark red when a rough window is promised, repaint it in
// a crew colour when solid-booked. This suite holds the tenancy lines
// (one business never sees another's board), the plan gate, the
// auto-filled admin columns, the working-day arithmetic, the customer
// email composition, and the signed calendar feed.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
import http from 'node:http';
// The mail relay, captured: the suppliers' emails carry an attachment.
const sentMail = [];
const relay = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => { try { sentMail.push(JSON.parse(body)); } catch (e) { sentMail.push({ raw: body }); }
    res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));
const _mem = await require('./tender/storage').memory();
globalThis.__TEST_JOBFILES_STORAGE = _mem;
await _mem.upload('company-a/job-a1/f-pack/Job_Pack_FR-2996.pdf', Buffer.from('%PDF-1.4 the job pack'), 'application/pdf');
await _mem.upload('company-b/job-b1/f-rival/Rival.pdf', Buffer.from('%PDF-1.4 not yours'), 'application/pdf');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const A = { user: 'user-a', company: 'company-a' };   // Business — has the board
const B = { user: 'user-b', company: 'company-b' };   // Business — the rival next door
const T = { user: 'user-t', company: 'company-t' };   // Trade — priced out of the board

const JOB = 'job-a1';
const { port } = await startFakePostgrest({
  profiles: [{ id: A.user, company_id: A.company }, { id: B.user, company_id: B.company },
             { id: T.user, company_id: T.company }],
  company_users: [{ company_id: A.company, user_id: A.user, role: 'owner' },
                  { company_id: B.company, user_id: B.user, role: 'owner' },
                  { company_id: T.company, user_id: T.user, role: 'owner' }],
  companies: [{ id: A.company, name: 'Flood Roofing', plan: 'business' },
              { id: B.company, name: 'Rival Roofing', plan: 'business' },
              { id: T.company, name: 'Small Roofing', plan: 'solo' }],
  user_settings: [{ user_id: A.user, company_id: A.company,
    branding: { company_name: 'Flood Roofing', email: 'office@floodroofing.co.nz' },
    quote_defaults: {}, jms_keys: {}, updated_at: new Date().toISOString() }],
  jobs: [{ id: JOB, user_id: A.user, company_id: A.company, client_name: 'Brian Lewis',
    site_address: '148 Horeke Road, Okaihau', status: 'ordered',
    order_sent: { at: '2026-08-01T00:00:00Z', by: A.user },
    draw_state: { state: { quote: { ref: 'FR-2996', accepted: { at: '2026-07-20T09:00:00Z' },
                                    client: { email: 'brian@lewis.co.nz' } } } } }],
  invoices: [{ id: 'inv-1', company_id: A.company, user_id: A.user, job_id: JOB,
    type: 'deposit', status: 'paid', number: 'INV-1001' }],
  schedule_rows: [], schedule_blocks: [],
  job_files: [
    { id: 'f-pack', company_id: 'company-a', user_id: 'user-a', job_id: 'job-a1', name: 'Job Pack FR-2996.pdf', mime: 'application/pdf',
      size: 21, kind: 'export', source: 'jobpack-pdf', author: '', status: 'ready', storage_path: 'company-a/job-a1/f-pack/Job_Pack_FR-2996.pdf', created_at: '2026-11-01T00:00:00Z' },
    { id: 'f-rival', company_id: 'company-b', user_id: 'user-b', job_id: 'job-b1', name: 'Rival.pdf', mime: 'application/pdf',
      size: 18, kind: 'export', source: 'jobpack-pdf', author: '', status: 'ready', storage_path: 'company-b/job-b1/f-rival/Rival.pdf', created_at: '2026-11-01T00:00:00Z' } ],
});
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.GAS_RELAY_IS_PLATFORM = 'true';
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
// The board came down to Team: a calendar means nothing for one person and
// is hurting by three. So the plan it is refused on is the one-person one.
let r = await as(T, '/schedule');
let body = await j(r);
check('a one-person business is told the board is not on its plan',
  r.status === 402 || r.status === 403, 'status ' + r.status + ' ' + JSON.stringify(body).slice(0, 90));
check('…and the refusal names Team, the tier that now carries it',
  /Team/i.test(JSON.stringify(body)), JSON.stringify(body).slice(0, 120));

// ── the board reads, with auto-filled admin columns ───────────────
r = await as(A, '/schedule/rows', { method: 'POST', body: JSON.stringify({ job_id: JOB, length_days: 8 }) });
const rowA = await j(r);
check('a linked row snapshots the job identity', r.status === 200 &&
  rowA.client_name === 'Brian Lewis' && /Horeke/.test(rowA.site_address), JSON.stringify(rowA).slice(0, 100));
// _scopeCompany filters on user_id as well as company_id; real PostgREST
// refuses the whole query if the column is missing (the fake double
// doesn't validate columns — this pin is the closest it gets).
check('…and carries the author user_id the scoping helper filters on',
  rowA.user_id === A.user, String(rowA.user_id));

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
check('the job number rides along from the quote ref', linked.job_no === 'FR-2996', String(linked.job_no));
// Public holidays come with their names (2026-11-11): every one a day off,
// and over 420 days the board always holds Christmas and Labour Day.
{
  const hol = body.holidays || [], nw = new Set(body.nonwork || []);
  const names = hol.map(h => h.name);
  const xmas = hol.filter(h => h.name === 'Christmas Day');
  check('the board sends the public holidays by name, each one a day off',
    hol.length >= 10 && names.includes('Labour Day') && names.includes('Matariki') && names.includes('Easter Monday') &&
    xmas.length >= 1 && xmas.every(h => /-12-2[5-7]$/.test(h.date)) && hol.every(h => nw.has(h.date)),
    JSON.stringify(hol).slice(0, 300));
}
// Sampled from the range the board actually returned, not a date typed in
// on the day this was written: the calendar starts a week back, so a fixed
// Saturday silently walks out of the window and fails a year later.
const _sat = (() => {
  const d = new Date(String((body.range || {}).from) + 'T00:00:00Z');
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const _sun = (() => {
  const d = new Date(_sat + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
check('weekends are non-working days',
  (body.nonwork || []).includes(_sat) && (body.nonwork || []).includes(_sun),
  'sample Sat ' + _sat + ' / Sun ' + _sun);
check('NZ public holidays are non-working days', (body.nonwork || []).includes('2026-12-25'), 'Christmas Day');
check('the feed URL is signed', /\/schedule\/feed\.ics\?c=.*&sig=[0-9a-f]{64}/.test(body.feed_url || ''), body.feed_url);
const FEED_URL = body.feed_url;

// An override beats the auto-fill.
r = await as(A, '/schedule/rows/' + linked.id, { method: 'PATCH', body: JSON.stringify({ deposit_paid: false }) });
check('an office override sticks', r.status === 200, 'status ' + r.status);
body = await j(await as(A, '/schedule'));
check('…and beats the auto-fill on the next read',
  (body.rows.find(x => x.id === linked.id) || {}).deposit_paid === false);

// Handover done is office-only bookkeeping — no auto-fill, plain round-trip.
r = await as(A, '/schedule/rows/' + linked.id, { method: 'PATCH', body: JSON.stringify({ handover_done: true }) });
check('handover done saves', r.status === 200 && (await j(r)).handover_done === true);
body = await j(await as(A, '/schedule'));
check('…and round-trips on the next read',
  (body.rows.find(x => x.id === linked.id) || {}).handover_done === true);

// ── blocks: pencil, then solid-book ───────────────────────────────
// Fri 2026-09-04: an 8-working-day pencil must span the weekend.
r = await as(A, '/schedule/blocks', { method: 'POST', body: JSON.stringify({
  row_id: rowA.id, kind: 'pencil', start_date: '2026-09-04', work_days: 8 }) });
const pencil = await j(r);
check('a pencil block paints', r.status === 200 && pencil.kind === 'pencil', JSON.stringify(pencil).slice(0, 80));
check('…with the author user_id on it too', pencil.user_id === A.user, String(pencil.user_id));

r = await as(A, '/schedule/blocks/' + pencil.id, { method: 'PATCH', body: JSON.stringify({
  kind: 'crew', crew_id: 'crew1' }) });
check('repainting the pencil with a crew solid-books it', r.status === 200 && (await j(r)).kind === 'crew');

// ── the customer emails ───────────────────────────────────────────
r = await as(A, '/schedule/rows/' + rowA.id + '/compose', { method: 'POST', body: JSON.stringify({ kind: 'confirm' }) });
body = await j(r);
check('the confirm email carries the exact start date',
  r.status === 200 && /Friday|4 September/.test(body.subject + body.body), (body.subject || '') + ' | ' + String(body.body).slice(0, 80));
check('…and promises it weather depending', /weather depending/.test(body.body), String(body.body).slice(0, 100));

// The middle email: "the week of Monday …" — vaguer than a date, firmer
// than a month. 4 Sep 2026 is a Friday; its week starts Monday 31 August.
r = await as(A, '/schedule/rows/' + rowA.id + '/compose', { method: 'POST', body: JSON.stringify({ kind: 'week' }) });
body = await j(r);
check('the week-of email names the start week, not the day',
  r.status === 200 && /week of Monday, 31 August/.test(body.body) && !/4 September/.test(body.body),
  String(body.body).slice(0, 120));
check('…in the subject too', /week of Monday, 31 August/.test(body.subject), body.subject);
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
// The board looks one week back, not six — last month's jobs are not
// what the office opens the schedule to see.
{
  const d = new Date(); d.setUTCDate(d.getUTCDate() - 7);
  const wantFrom = d.toISOString().slice(0, 10);
  check('the visible range starts exactly 7 days back', body.range.from === wantFrom, body.range.from + ' vs ' + wantFrom);
}
// The folder order the office drags into place is company config, so
// it follows them to the next device.
r = await as(A, '/schedule/config', { method: 'PUT', body: JSON.stringify({ folder_order: ['poleshed', '', 'completed', 'checks'] }) });
body = await j(await as(A, '/schedule'));
check('the folder order saves with the config', JSON.stringify(body.cfg.folder_order) === '["poleshed","","completed","checks"]', JSON.stringify(body.cfg.folder_order));
check('…without touching the crews', (body.cfg.crews || []).some(c => c.name === 'Troy'), JSON.stringify(body.cfg.crews));
// A Fergus job number typed into the popup sticks to the row.
r = await as(A, '/schedule/rows/' + rowQ.id, { method: 'PATCH', body: JSON.stringify({ job_ref: '9123' }) });
body = await j(await as(A, '/schedule'));
check('a hand-typed Fergus job number saves on the row', r.status === 200 && (body.rows || []).some(x => x.id === rowQ.id && x.job_ref === '9123'),
  JSON.stringify((body.rows || []).map(x => x.job_ref)));

// ── a Fergus-only row (2026-11-11) ──────────────────────────────
r = await as(A, '/schedule/rows', { method: 'POST', body: JSON.stringify({ fergus_job_id: '15590001', job_ref: '3275', client_name: 'Alfred Crawford', site_address: '1622F Matauri Bay Road', email: 'alf@x.nz', length_days: 1 }) });
const fgRow = await j(r);
body = await j(await as(A, '/schedule'));
const fgOut = (body.rows || []).find(x => x.id === fgRow.id);
check('a Fergus-only row keeps its Fergus id and answers it as fergus_id with its number', r.status === 200 && fgOut && fgOut.fergus_id === '15590001' && fgOut.fergus_no === '3275' && fgOut.job_ref === '3275' && !fgOut.job_id, JSON.stringify(fgOut));

// ── live presence (2026-11-11) ──────────────────────────────────
// A heartbeat says what this person holds and hears who else is here (same
// company only) and the board's version, which every write moves.
const A2 = { user: 'user-a2', company: 'company-a' };
r = await as(A, '/schedule/presence', { method: 'POST', body: JSON.stringify({ name: 'Paula', hold: { what: 'drag', block: 'blk-1', row: rowQ.id, start: '2026-09-14', to: 'row-x', len: 3 } }) });
body = await j(r);
const ver0 = body.ver;
check('a heartbeat answers the board version and nobody else yet', r.status === 200 && typeof ver0 === 'number' && body.users.length === 0, JSON.stringify(body));
body = await j(await as(A2, '/schedule/presence', { method: 'POST', body: JSON.stringify({ name: 'Hannah' }) }));
check('a colleague hears who holds what', body.users.length === 1 && body.users[0].name === 'Paula' && body.users[0].hold.block === 'blk-1', JSON.stringify(body.users));
check('…and where the drag has got to: the day, the row under the pointer, the length', body.users[0] && body.users[0].hold.start === '2026-09-14' && body.users[0].hold.to === 'row-x' && body.users[0].hold.len === 3, JSON.stringify(body.users));
{ const rx = await j(await as(A, '/schedule/presence', { method: 'POST', body: JSON.stringify({ name: 'Paula', hold: { what: 'drag', block: 'blk-1', row: rowQ.id, start: '<b>soon</b>' } }) }));
  const bx = await j(await as(A2, '/schedule/presence', { method: 'POST', body: JSON.stringify({ name: 'Hannah' }) }));
  check('…and a day that is not a date is dropped', bx.users[0] && bx.users[0].hold.start === '', JSON.stringify(bx.users)); }
body = await j(await as(B, '/schedule/presence', { method: 'POST', body: JSON.stringify({ name: 'Rival' }) }));
check('the rival next door hears nobody', body.users.length === 0, JSON.stringify(body.users));
body = await j(await as(A2, '/schedule/presence', { method: 'POST', body: JSON.stringify({ name: 'Hannah' }) }));
check('heartbeats never move the version', body.ver === ver0, body.ver + ' vs ' + ver0);
await new Promise(res => setTimeout(res, 5));
r = await as(A, '/schedule/rows/' + rowQ.id, { method: 'PATCH', body: JSON.stringify({ notes: 'moved' }) });
body = await j(await as(A2, '/schedule/presence', { method: 'POST', body: JSON.stringify({ name: 'Hannah' }) }));
check('a write to the board moves the version', r.status === 200 && body.ver > ver0, body.ver + ' vs ' + ver0);
body = await j(await as(A, '/schedule/presence', { method: 'POST', body: JSON.stringify({ leave: true }) }));
body = await j(await as(A2, '/schedule/presence', { method: 'POST', body: JSON.stringify({ name: 'Hannah' }) }));
check('leaving takes the person off the list', body.users.length === 0, JSON.stringify(body.users));

// ── SUPPLIERS AND TRADES (2026-11-11) ────────────────────────────
{
  sentMail.length = 0;
  // the office's copy-to for scaffold bookings rides on that template's own CC
  await as(A, '/settings', { method: 'PUT', body: JSON.stringify({ quote_defaults: { email: { scaff_book_cc: 'yard@floodroofing.co.nz' } } }) });
  r = await as(A, '/schedule/rows/' + rowA.id + '/send', { method: 'POST', body: JSON.stringify({
    kind: 'ord_roofing', to: 'orders@ri.nz', subject: 'Order #FR-2996', body: 'Hi Sam, the order is attached.',
    supplier: 'Roofing Industries', date: '2026-11-20', asap: false, fileId: 'f-pack' }) });
  body = await j(r);
  await new Promise(res => setTimeout(res, 200));
  const m = sentMail[sentMail.length - 1] || {};
  const att = (m.attachments || [])[0] || {};
  check('a roofing material order goes to the supplier with the job\u2019s Job Pack attached',
    r.status === 200 && body.file === 'Job Pack FR-2996.pdf' && /orders@ri\.nz/.test(JSON.stringify(m.to || m)) &&
    (att.filename || att.name) === 'Job Pack FR-2996.pdf' && Buffer.from(String(att.base64 || att.content || att.data || ''), 'base64').toString().startsWith('%PDF-1.4 the job pack'),
    JSON.stringify({ status: r.status, body, keys: Object.keys(m), att: Object.keys(att) }).slice(0, 300));
  const brd = await j(await as(A, '/schedule'));
  const rw = (brd.rows || []).find(x => x.id === rowA.id) || {};
  const ent = (rw.notify_log || []).slice(-1)[0] || {};
  check('…logged on the row with the supplier, the date and the file — and the customer\u2019s "last told" untouched',
    ent.kind === 'ord_roofing' && ent.supplier === 'Roofing Industries' && ent.date === '2026-11-20' && ent.file === 'Job Pack FR-2996.pdf' &&
    String(rw.last_notified || '') !== String(ent.at), JSON.stringify({ ent, last: rw.last_notified }));
  r = await as(A, '/schedule/rows/' + rowA.id + '/send', { method: 'POST', body: JSON.stringify({
    kind: 'ord_roofing', to: 'orders@ri.nz', subject: 'x', body: 'y', fileId: 'f-rival' }) });
  check('another business\u2019s file is never attached — nothing is sent', r.status === 400 && sentMail.length === 1, r.status + ' / ' + sentMail.length);
  sentMail.length = 0;
  r = await as(A, '/schedule/rows/' + rowA.id + '/send', { method: 'POST', body: JSON.stringify({
    kind: 'scaff_book', to: 'book@northscaff.nz', subject: 'Scaffold booking', body: 'Installation date: at your earliest convenience.', supplier: 'North Scaffolding', asap: true }) });
  await new Promise(res => setTimeout(res, 200));
  const m2 = sentMail[0] || {};
  check('a scaffold booking sends with no attachment and the template\u2019s own copy-to',
    r.status === 200 && !(m2.attachments || []).length && /yard@floodroofing\.co\.nz/.test(JSON.stringify(m2.cc || '')), JSON.stringify(m2).slice(0, 300));
  r = await as(A, '/schedule/rows/' + rowA.id + '/send', { method: 'POST', body: JSON.stringify({ kind: 'trade_plumb', to: '', subject: 's', body: 'b' }) });
  body = await j(r);
  check('a trade email with no address is refused in plain words', r.status === 400 && /email address is needed/.test(body.error) && !/customer/.test(body.error), body.error);
}
// A block dragged onto another job's row (2026-11-11): the row must be this
// business's own.
{
  const blk = await j(await as(A, '/schedule/blocks', { method: 'POST', body: JSON.stringify({ row_id: rowA.id, kind: 'pencil', start_date: '2026-12-07', work_days: 1 }) }));
  r = await as(A, '/schedule/blocks/' + blk.id, { method: 'PATCH', body: JSON.stringify({ row_id: rowQ.id, start_date: '2026-12-08' }) });
  body = await j(r);
  check('a block dragged onto another job moves there', r.status === 200 && body.row_id === rowQ.id && body.start_date === '2026-12-08', JSON.stringify(body).slice(0, 160));
  const rival = await j(await as(B, '/schedule/rows', { method: 'POST', body: JSON.stringify({ client_name: 'Rival job' }) }));
  r = await as(A, '/schedule/blocks/' + blk.id, { method: 'PATCH', body: JSON.stringify({ row_id: rival.id }) });
  check('…but never onto another business\u2019s row', r.status === 400, String(r.status));
}

const pass = results.filter(Boolean).length;
console.log(pass + '/' + results.length + ' passed');
await new Promise(r2 => relay.close(r2)); try { _mem.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);
