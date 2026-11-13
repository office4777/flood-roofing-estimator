// THE CREW APP, the server half (2026-11-13, the owner: "a phone app ...
// links up to the schedule ... the job address ... customer name ... phone
// number ... customer selections and the scope of work ... photos ... files
// ... checklists ... a timesheet ... on-site hours versus the travel hours";
// "start the timer from 7 a.m. until 7 p.m. just on those days that they're
// working ... Definitely not any days that aren't scheduled").
// Against the real server with fakepgrst: who has it, the crew's days off the
// board, a job's details, clock events and positions (kept only 7–7 on a
// booked day), resends kept once, a site learned from a clock-on, the
// checklists, the hours on site vs travelling, and the office's views.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { createRequire } from 'node:module';
import { startFakePostgrest } from './fakepgrst.mjs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const crewLib = require('./crew.js');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  — ' + d : '')); }

// A working day a few days back (the GPS rule is checked on it), the weekday
// before it (not booked), and a time on it in NZ.
const HOL = ['2026-10-26', '2026-12-25', '2026-12-28', '2027-01-01', '2027-01-04'];
const iso = (t) => new Date(t).toISOString().slice(0, 10);
function weekdayBack(fromMs){
  for (let t = fromMs; ; t -= 86400000) { const d = new Date(t); const w = d.getUTCDay(); if (w > 0 && w < 6 && !HOL.includes(iso(t))) return iso(t); }
}
const D = weekdayBack(Date.now() - 3 * 86400000);
const D2 = weekdayBack(Date.parse(D + 'T00:00:00Z') - 86400000);
function nzAt(date, h, m){
  for (const off of [13, 12]) {
    const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h - off, m || 0);
    const p = crewLib.nzParts(new Date(t)); if (p.date === date && p.hour === h) return new Date(t).toISOString();
  }
  throw new Error('no NZ time for ' + date);
}

const quote = { ref: '3351', phone: '021 555 0101', client: { email: 'arran@example.nz' },
  proposalOptions: { steelGrade: 'maxam', profile: 'corrugate', colour: 'Ironsand' },
  custDesc: ['Strip the old roof and take it away', 'Supply & install new MAXAM corrugate'], custExcl: ['Spouting'], custNotes: ['Dog on site'] };
const { db, port } = await startFakePostgrest({
  companies: [ { id: 'c1', name: 'Flood Roofing Ltd', plan: 'business' }, { id: 'c2', name: 'Rival Roofing', plan: 'business' } ],
  profiles: [ { id: 'u1', company_id: 'c1', email: 'Aron@floodroofing.co.nz', name: 'Aron' }, { id: 'u3', company_id: 'c1', email: 'nick@floodroofing.co.nz', name: 'Nick Example' },
    { id: 'u2', company_id: 'c2', email: 'office@rival.nz', name: 'Rival' } ],
  company_users: [ { company_id: 'c1', user_id: 'u1', role: 'owner' }, { company_id: 'c1', user_id: 'u3', role: 'member' }, { company_id: 'c2', user_id: 'u2', role: 'owner' } ],
  user_settings: [ { user_id: 'u1', company_id: 'c1', updated_at: '2026-11-01T00:00:00Z', schedule_cfg: { feed_secret: 'x',
    crews: [ { id: 'crew1', name: 'Crew 1', colour: '#f87d20' }, { id: 'crew2', name: 'Crew 2', colour: '#22c55e' } ] } } ],
  jobs: [ { id: 'j1', user_id: 'u1', company_id: 'c1', client_name: 'Arran Simpson', site_address: '12 Kauri Lane, Kerikeri', version_of: null,
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', draw_state: { form: { jobPhone: '021 555 0101' }, state: { quote } } } ],
  job_files: [
    { id: 'f1', company_id: 'c1', user_id: 'u1', job_id: 'j1', name: 'Job Pack 3351.pdf', mime: 'application/pdf', size: 1000, kind: 'export', source: 'job-pack', author: 'office', status: 'ready', storage_path: 'p', created_at: '2026-11-03T00:00:00Z' },
    { id: 'f2', company_id: 'c1', user_id: 'u1', job_id: 'j1', name: 'half.jpg', mime: 'image/jpeg', size: 10, kind: 'upload', source: 'site', author: 'x', status: 'pending', storage_path: 'q', created_at: '2026-11-03T00:00:00Z' } ],
  schedule_rows: [
    { id: 'r1', company_id: 'c1', user_id: 'u1', job_id: 'j1', client_name: 'Arran Simpson', site_address: '12 Kauri Lane, Kerikeri', email: '', length_days: 1, notes: 'Key under the mat', archived: false, job_ref: '', created_at: '2026-11-01T00:00:00Z' },
    { id: 'r2', company_id: 'c1', user_id: 'u1', job_id: null, client_name: 'Deb Allen', site_address: '52 Kerikeri Road', email: '', length_days: 1, notes: '', archived: false, job_ref: '3228', created_at: '2026-11-01T00:00:00Z' },
    { id: 'rx', company_id: 'c2', user_id: 'u2', job_id: null, client_name: 'Not yours', site_address: '9 Other Road', email: '', length_days: 1, notes: '', archived: false, job_ref: '', created_at: '2026-11-01T00:00:00Z' } ],
  schedule_blocks: [
    { id: 'b1', company_id: 'c1', user_id: 'u1', row_id: 'r1', kind: 'crew', crew_id: 'crew1', start_date: D, work_days: 1, created_at: '2026-11-01T00:00:00Z' },
    { id: 'b2', company_id: 'c1', user_id: 'u1', row_id: 'r2', kind: 'crew', crew_id: 'crew2', start_date: D, work_days: 1, created_at: '2026-11-01T00:00:00Z' },
    { id: 'b3', company_id: 'c1', user_id: 'u1', row_id: 'r2', kind: 'pencil', crew_id: 'crew1', start_date: D2, work_days: 1, created_at: '2026-11-01T00:00:00Z' } ],
  crew_members: [], crew_events: [], crew_points: [], crew_sites: [], crew_settings: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
delete process.env.CREW_USERS; delete process.env.CREW_ALL; delete process.env.SUPINV_USERS;
const PORT = process.env.TEST_PORT || '35127';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn, err = console.error;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn; console.error = err;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const call = (tok) => async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = {}; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j };
};
const aron = call(jwt.sign({ id: 'u1', email: 'Aron@floodroofing.co.nz', cid: 'c1' }, 'test-secret'));
const nick = call(jwt.sign({ id: 'u3', email: 'nick@floodroofing.co.nz', cid: 'c1' }, 'test-secret'));
const rival = call(jwt.sign({ id: 'u2', email: 'office@rival.nz', cid: 'c2' }, 'test-secret'));

// ── who has it ──
let r = await nick('GET', '/crew/enabled');
check('a roofer in the owner’s business has the crew app (not the office side), though the owner’s address is stored “Aron@…”', r.body.enabled === true && r.body.office === false, JSON.stringify(r.body));
r = await aron('GET', '/crew/enabled');
check('the owner has both', r.body.enabled === true && r.body.office === true, JSON.stringify(r.body));
r = await rival('GET', '/crew/me');
check('another business is refused until it is switched on', r.status === 403 && r.body.code === 'CREW_OFF', JSON.stringify(r.body));
r = await nick('GET', '/crew/office/now');
check('a roofer cannot see where everyone is', r.status === 403 && r.body.code === 'CREW_OFFICE_ONLY', String(r.status));

// ── the person and their crew ──
r = await nick('GET', '/crew/me');
check('the phone learns the business, the crews and the GPS rule', r.status === 200 && r.body.company === 'Flood Roofing Ltd' &&
  r.body.crews.length === 2 && /7 am – 7 pm/.test(r.body.gps.rule) && r.body.crew_id === '', JSON.stringify(r.body).slice(0, 300));
r = await nick('PUT', '/crew/me', { crew_id: 'nope' });
check('a crew that is not on the board is refused', r.status === 400);
r = await nick('PUT', '/crew/me', { crew_id: 'crew1', phone: '021 1' });
check('…and his own crew is kept', r.status === 200 && db.crew_members.some(m => m.user_id === 'u3' && m.crew_id === 'crew1'));

// ── the calendar ──
r = await nick('GET', '/crew/week?from=' + D2 + '&days=3');
const dD = (r.body.days || []).find(x => x.date === D), dD2 = (r.body.days || []).find(x => x.date === D2);
check('his crew’s job is on its day, and the day reads booked', dD && dD.booked && dD.jobs.length === 1 && dD.jobs[0].row_id === 'r1' &&
  dD.jobs[0].client === 'Arran Simpson' && dD.jobs[0].crew === 'Crew 1' && dD.jobs[0].notes === 'Key under the mat', JSON.stringify(dD));
check('another crew’s job is not his, and a pencilled day is not a booked day', dD && !dD.jobs.some(j => j.row_id === 'r2') && dD2 && !dD2.booked && !dD2.jobs.length, JSON.stringify(dD2));
r = await nick('GET', '/crew/week?from=' + D + '&days=1&all=1');
check('“every crew” shows the other crew’s job too, and never another business’s', r.body.days[0].jobs.length === 2 && !r.body.days[0].jobs.some(j => j.row_id === 'rx'));

// ── one job ──
r = await nick('GET', '/crew/row/r1');
check('the job carries the customer, their phone and the address', r.body.client === 'Arran Simpson' && r.body.phone === '021 555 0101' &&
  r.body.site === '12 Kauri Lane, Kerikeri' && r.body.job_ref === '3351' && r.body.email === 'arran@example.nz', JSON.stringify(r.body).slice(0, 300));
check('…the scope, what is not included and the notes', r.body.scope.length === 2 && r.body.exclusions[0] === 'Spouting' && r.body.quoteNotes[0] === 'Dog on site');
check('…what the customer chose', Array.isArray(r.body.choices) && r.body.choices.length > 0, JSON.stringify(r.body.choices));
check('…the job’s files (only the ones that landed)', r.body.files.length === 1 && r.body.files[0].name === 'Job Pack 3351.pdf');
check('…and the days it is booked', r.body.days.includes(D));
r = await nick('GET', '/crew/row/rx');
check('another business’s job is not found', r.status === 404);

// ── clock events and positions ──
const at = (h, m) => nzAt(D, h, m);
const ev = [
  { client_id: 'e1', kind: 'travel', at: at(7, 15), lat: -35.2, lng: 173.9 },
  { client_id: 'e2', kind: 'on', row_id: 'r1', job_id: 'j1', at: at(8, 0), lat: -35.22, lng: 173.95, acc: 8 },
  { client_id: 'e3', kind: 'off', row_id: 'r1', at: at(12, 0) },
  { client_id: 'e4', kind: 'on', row_id: 'r2', at: at(12, 30), lat: -35.23, lng: 173.96 },
  { client_id: 'e5', kind: 'end', at: at(16, 0) },
  { client_id: 'e6', kind: 'check', row_id: 'r1', at: at(8, 5), data: { list: 'start', item: 1, done: true } },
  { client_id: 'e7', kind: 'note', row_id: 'r1', at: at(9, 0), data: { text: 'Rotten fascia at the back' } },
  { client_id: 'e8', kind: 'on', row_id: 'r1', at: nzAt(D2, 9, 0), lat: -35.2, lng: 173.9 },
  { client_id: 'e8b', kind: 'end', at: nzAt(D2, 10, 0) },
];
const pts = [ { at: at(10, 0), lat: -35.22, lng: 173.95, acc: 6 }, { at: at(20, 0), lat: -35.22, lng: 173.95 },
  { at: at(6, 30), lat: -35.22, lng: 173.95 }, { at: nzAt(D2, 10, 0), lat: -35.2, lng: 173.9 } ];
r = await nick('POST', '/crew/sync', { events: ev, points: pts });
check('every event is kept', r.status === 200 && r.body.kept.length === ev.length, JSON.stringify(r.body));
check('a position at 10 am on a booked day is kept; 8 pm, 6:30 am and an unbooked day are refused',
  r.body.points === 1 && r.body.refused === 3 && db.crew_points.length === 1, JSON.stringify(r.body));
const e2 = db.crew_events.find(e => e.client_id === 'e2'), e8 = db.crew_events.find(e => e.client_id === 'e8');
check('a clock-on on a booked day keeps where it was made', e2 && e2.lat === -35.22);
check('…a clock-on on a day his crew is not booked keeps no position at all', e8 && e8.lat == null && e8.lng == null);
r = await nick('POST', '/crew/sync', { events: [ev[1], { client_id: 'bad', kind: 'nap', at: at(9) }] });
check('a resend is kept once, and a made-up kind is turned away', r.body.dup.includes('e2') && r.body.bad.includes('bad') &&
  db.crew_events.filter(e => e.client_id === 'e2').length === 1, JSON.stringify(r.body));
check('the first clock-on with a position teaches the job where its site is', db.crew_sites.some(s => s.row_id === 'r1' && s.lat === -35.22) && !db.crew_sites.some(s => s.row_id === 'r1' && s.lat === -35.2));

// ── hours ──
r = await nick('GET', '/crew/hours?from=' + D + '&to=' + D);
const day = (r.body.days || [])[0] || {};
check('on site: 4 h at the first job, 3.5 h at the second', day.onsite && day.onsite.r1 === 4 && day.onsite.r2 === 3.5, JSON.stringify(day));
check('travel: 45 min to the first site + 30 min between sites', day.travel === 1.25 && day.total === 8.75, JSON.stringify(day));
check('…and the job names come with it', r.body.rows.r2 && r.body.rows.r2.client === 'Deb Allen');
const cd = crewLib.computeDays([{ kind: 'on', row_id: 'a', at: '2026-01-05T20:00:00Z' }], [{ at: '2026-01-05T23:00:00Z' }], Date.now());
check('a past day left clocked on counts to the last position and says it was left open', cd[0].onsiteTotal === 3 && cd[0].open === true, JSON.stringify(cd));

// ── checklists ──
r = await nick('PUT', '/crew/office/settings', { checklists: [] });
check('a roofer cannot change the checklists', r.status === 403);
r = await aron('PUT', '/crew/office/settings', { checklists: [ { id: 'start', name: 'Before we start', when: 'start', items: ['Scaffold tagged', 'Edge protection up', ''] },
  { name: 'Empty', items: [] } ] });
check('the office sets a checklist (blank items and empty lists dropped)', r.status === 200 && r.body.checklists.length === 1 && r.body.checklists[0].items.length === 2);
r = await nick('GET', '/crew/me');
check('…and the phone gets it', r.body.checklists[0].name === 'Before we start');
r = await nick('GET', '/crew/row/r1');
check('a tick made on site is on the job', r.body.checks['start:1'] && r.body.checks['start:1'].done === true, JSON.stringify(r.body.checks));
check('…and so is the note', r.body.notesFromCrew[0] && /Rotten fascia/.test(r.body.notesFromCrew[0].text));

// ── the office ──
r = await aron('GET', '/crew/office/now');
const pn = (r.body.people || []).find(p => p.id === 'u3');
check('the office sees each person, their crew and colour', pn && pn.crew === 'Crew 1' && pn.colour === '#f87d20', JSON.stringify(pn));
check('…and the sites learned', (r.body.sites || []).some(s => s.row_id === 'r1' && s.client === 'Arran Simpson'));
r = await aron('GET', '/crew/office/hours?from=' + D + '&to=' + D);
const ph = (r.body.people || []).find(p => p.id === 'u3');
check('the office reads everyone’s hours', ph && ph.days[0].total === 8.75, JSON.stringify(ph));
r = await aron('GET', '/crew/office/members');
check('the office lists the business’s people with their crew', r.body.members.length === 2 && r.body.members.some(m => m.id === 'u3' && m.crew_id === 'crew1'));
r = await aron('PUT', '/crew/office/members/u3', { crew_id: 'crew2' });
check('the office moves him to another crew', r.status === 200 && db.crew_members.find(m => m.user_id === 'u3').crew_id === 'crew2');
r = await aron('PUT', '/crew/office/members/u2', { crew_id: 'crew2' });
check('…never somebody from another business', r.status === 404);

const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
