// Live analytics: the daily report's numbers on a page, snapshotted every
// hour. The page and the morning email read the same collector, so they can
// never disagree; a failed read is an error, never a snapshot of zeros.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const { nzMidnightUtc, shiftDate } = require('./daily.js');
const jwt = require('jsonwebtoken');
const { nzParts } = require('./metrics.js');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Yesterday, in New Zealand, with timestamps inside it and just outside it.
const today = nzParts(new Date()).date;
const Y = shiftDate(today, -1);
const y0 = nzMidnightUtc(Y), y1 = nzMidnightUtc(today);
const inY = h => new Date(y0 + h * 3600e3).toISOString();
const NOW = Date.now(), d = n => new Date(NOW - n * 864e5).toISOString();

const C1 = 'cccccccc-0000-0000-0000-000000000001', C2 = 'cccccccc-0000-0000-0000-000000000002',
      C3 = 'cccccccc-0000-0000-0000-000000000003', C4 = 'cccccccc-0000-0000-0000-000000000004';
const db = {
  companies: [
    { id: C1, name: 'Northland Roofing', plan: 'team',     created_at: d(40) },   // paying, Team
    { id: C2, name: 'Kaipara Roofing',   plan: 'trial',    created_at: inY(10) }, // started yesterday
    { id: C3, name: 'Bay Roofing',       plan: 'trial',    created_at: d(9) },    // mid-trial
    { id: C4, name: 'Hokianga Roofing',  plan: 'business', created_at: d(60) },   // paying, Business
  ],
  profiles: [
    { id: 'u1', email: 'sam@northland.co.nz', name: 'Sam Tane',   phone: '021 111', company_id: C1, verify_pending: false },
    { id: 'u2', email: 'kiri@kaipara.co.nz',  name: 'Kiri Rewi',  phone: '027 222', company_id: C2, verify_pending: false },
    { id: 'u3', email: 'jo@bay.co.nz',        name: 'Jo Hemi',    phone: '',        company_id: C3, verify_pending: false },
    { id: 'u4', email: 'ana@hokianga.co.nz',  name: 'Ana Wiremu', phone: '022 444', company_id: C4, verify_pending: false },
    { id: 'u5', email: 'ben@northland.co.nz', name: 'Ben Tane',   phone: '',        company_id: C1, verify_pending: false },
    // The founding account: on the business by profile.company_id only —
    // there is no company_users row for it. Its owner's own activity was
    // missing from his own report.
    { id: 'u6', email: 'aron@northland.co.nz', name: 'Aron Tane', phone: '',        company_id: C1, verify_pending: false },
  ],
  company_users: [
    { company_id: C1, user_id: 'u1', role: 'owner' }, { company_id: C1, user_id: 'u5', role: 'member' },
    { company_id: C2, user_id: 'u2', role: 'owner' }, { company_id: C3, user_id: 'u3', role: 'owner' },
    { company_id: C4, user_id: 'u4', role: 'owner' },
  ],
  subscriptions: [
    { user_id: 'u1', company_id: C1, status: 'active',   plan: 'team',     stripe_customer_id: 'cus_1', trial_ends_at: null },
    { user_id: 'u2', company_id: C2, status: 'trialing', plan: null,       stripe_customer_id: null, trial_ends_at: d(-13) },
    { user_id: 'u3', company_id: C3, status: 'trialing', plan: null,       stripe_customer_id: null, trial_ends_at: d(-5) },
    { user_id: 'u4', company_id: C4, status: 'active',   plan: 'business', stripe_customer_id: 'cus_4', trial_ends_at: null },
  ],
  usage_events: [
    // tagged minutes: where u1 spent them
    { user_id: 'u1', company_id: C1, name: 'app_time',      at: inY(13), props: { minutes: 4, screen: 'roof' } },
    { user_id: 'u1', company_id: C1, name: 'app_time',      at: inY(14), props: { minutes: 2, screen: 'quote' } },
    { user_id: 'u1', company_id: C1, name: 'login',         at: inY(8),  props: {} },
    { user_id: 'u1', company_id: C1, name: 'login',         at: inY(14), props: {} },
    { user_id: 'u1', company_id: C1, name: 'canvas_used',   at: inY(9),  props: {} },
    { user_id: 'u1', company_id: C1, name: 'quote_sent',    at: inY(10), props: {} },
    { user_id: 'u1', company_id: C1, name: 'order_sent',    at: inY(11), props: {} },
    { user_id: 'u1', company_id: C1, name: 'feedback_sent', at: inY(12), props: {} },
    { user_id: 'u1', company_id: C1, name: 'app_time',      at: inY(9),  props: { minutes: 5 } },
    { user_id: 'u1', company_id: C1, name: 'app_time',      at: inY(10), props: { minutes: 5 } },
    { user_id: 'u1', company_id: C1, name: 'app_time',      at: inY(11), props: { minutes: 3 } },
    { user_id: 'u6', company_id: C1, name: 'canvas_used',   at: inY(15), props: {} },
    { user_id: 'u6', company_id: C1, name: 'app_time',      at: inY(15), props: { minutes: 5 } },
    // Somebody nobody's list knows: events with a user id and no profile.
    { user_id: 'u-stray', company_id: null, name: 'login',  at: inY(16), props: {} },
    { user_id: 'u2', company_id: C2, name: 'login',         at: inY(10), props: {} },
    { user_id: 'u2', company_id: C2, name: 'canvas_used',   at: inY(10), props: {} },
    // the day before, and today: not yesterday
    { user_id: 'u3', company_id: C3, name: 'login',         at: new Date(y0 - 3600e3).toISOString(), props: {} },
    { user_id: 'u4', company_id: C4, name: 'login',         at: new Date(y1 + 3600e3).toISOString(), props: {} },
  ],
  platform_state: [],
};

// A stand-in for the mail relay, so the email itself can be read.
const sent = [];
const relay = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { sent.push(JSON.parse(b)); } catch (e) { sent.push({ raw: b }); } res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }); });
await new Promise(r => relay.listen(0, '127.0.0.1', r));

const { port } = await startFakePostgrest(db);
const PORT = process.env.TEST_PORT || '34688';
process.env.PORT = PORT;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.BILLING_ENABLED = 'false';
process.env.ADMIN_TOKEN = 'let-me-in-please-0000';
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
delete process.env.DAILY_REPORT_TO; delete process.env.DAILY_REPORT_HOUR; delete process.env.DATABASE_URL;
const log = console.log, err = console.error; console.log = () => {}; console.error = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = err;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT, T = '?token=let-me-in-please-0000';


// ── the live page carries the daily report's numbers ─────────────
const H = { 'x-admin-token': 'let-me-in-please-0000' };
const first = await fetch(BASE + '/admin/analytics', { headers: H });
const a = await first.json();
check('the first read takes its own snapshot', first.status === 200 && a.latest && Array.isArray(a.series) && a.series.length === 1, first.status + ' ' + JSON.stringify(a).slice(0, 80));
const yd = await (await fetch(BASE + '/admin/daily' + T)).json();
const ys = a.latest.yesterday.summary;
check('yesterday on the page is the daily report, number for number',
  ys.mrr === yd.mrr && ys.trials === yd.trials.length && ys.new_trials === yd.new_trials.length && ys.active === yd.active_count && a.latest.yesterday.users.length === yd.users.length,
  JSON.stringify({ page: ys, mail: { mrr: yd.mrr, trials: yd.trials.length, nt: yd.new_trials.length, active: yd.active_count } }));
check('…MRR is Team + Business at list price', ys.mrr === 299 + 549, String(ys.mrr));
check('today so far counts today\'s login and no yesterday activity', a.latest.today.summary.logins === 1 && a.latest.today.summary.quotes === 0, JSON.stringify(a.latest.today.summary));
check('the users table is the same rows as the email, minus nothing the page shows',
  a.latest.yesterday.users[0].email === yd.users[0].email && a.latest.yesterday.users[0].minutes === yd.users[0].minutes);
check('the snapshot is in platform_state', db.platform_state.some(r => r.key === 'analytics_latest') && db.platform_state.some(r => r.key === 'analytics_series'));

// ── the hourly job ───────────────────────────────────────────────
const again = await (await fetch(BASE + '/admin/analytics', { headers: H })).json();
check('a second read within the hour does not add a point', again.series.length === 1, String(again.series.length));
const ref = await (await fetch(BASE + '/admin/analytics/refresh', { method: 'POST', headers: H })).json();
const after = await (await fetch(BASE + '/admin/analytics', { headers: H })).json();
check('Sync now takes a snapshot on the spot', ref.ok && after.series.length === 2, JSON.stringify(ref));
check('each point carries the headline numbers', ['at','date','hour','mrr','trials','paying_total','active','people','quotes','minutes','events'].every(k => after.series[1][k] != null), Object.keys(after.series[1]).join(','));

// ── the page and its gate ────────────────────────────────────────
const pg = await fetch(BASE + '/admin/analytics/page' + T);
const html = await pg.text();
check('the page is served with the token', pg.status === 200 && /RoofMap — live activity/.test(html) && /Sync now/.test(html));
check('…keeps the token in the browser and off the address bar', /localStorage\.setItem\('rm_admin_token'/.test(html) && /history\.replaceState/.test(html));
check('…and refreshes itself every hour', /setInterval\(load, 60 \* 60e3\)/.test(html));
check('…under a policy that lets its own style and script run', /style-src 'unsafe-inline'; script-src 'unsafe-inline' 'self'; img-src 'self' data:; connect-src 'self'/.test(pg.headers.get('content-security-policy') || ''), pg.headers.get('content-security-policy'));
check('no data answers without a token or an owner login', (await fetch(BASE + '/admin/analytics')).status === 404 &&
  (await fetch(BASE + '/admin/analytics/refresh', { method: 'POST' })).status === 404);

// ── any day, and a run of days ───────────────────────────────────
const dayR = await (await fetch(BASE + '/admin/analytics/day?date=' + Y, { headers: H })).json();
check('a picked day is that day\'s report', dayR.date === Y && dayR.summary.active === yd.active_count && dayR.users.length === yd.users.length, JSON.stringify(dayR.summary));
check('a bad date is refused', (await fetch(BASE + '/admin/analytics/day?date=nope', { headers: H })).status === 400);
const wk = await (await fetch(BASE + '/admin/analytics/days?end=' + today + '&n=7', { headers: H })).json();
check('seven days come back ending today', wk.days.length === 7 && wk.days[6].date === today && wk.days[5].date === Y, wk.days.map(d => d.date).join(','));
const yrow = wk.days[5], trow = wk.days[6];
check('yesterday\'s row counts every login, canvas, quote, order, feedback and minute across everyone',
  yrow.logins === 4 && yrow.canvas === 3 && yrow.quotes === 1 && yrow.orders === 1 && yrow.feedback === 1 && yrow.minutes === 24 && yrow.active === 4, JSON.stringify(yrow));
check('…and the business that signed up yesterday', yrow.signups === 1 && trow.signups === 0, yrow.signups + '/' + trow.signups);
check('today\'s row has today\'s one login and nothing borrowed', trow.logins === 1 && trow.quotes === 0, JSON.stringify(trow));
check('the first read already carries the week', Array.isArray(a.week && a.week.days) && a.week.days.length === 7);
check('the page has the day picker and the week table', /id="dayPick"/.test(html) && /moveWeek\(-7\)/.test(html) && /New sign-ups/.test(html));

// ── without Flood Roofing's own accounts ─────────────────────────
// The fixture has no Flood Roofing rows; make Northland the owner's business
// by name and one of its people by email, then everything under the toggle
// must leave them out.
db.profiles.find(p => p.id === 'u6').email = 'aron@floodroofing.co.nz';
db.companies.find(c => c.id === C1).name = 'Flood Roofing Ltd';
await fetch(BASE + '/admin/analytics/refresh', { method: 'POST', headers: H });
const ex = await (await fetch(BASE + '/admin/analytics', { headers: H })).json();
const yx = ex.latest.yesterday.ext;
check('the day\'s people without Flood Roofing leave out everyone on that business',
  yx.users.every(u => !/northland|floodroofing/.test(u.email) && u.company !== 'Flood Roofing Ltd') && yx.users.length === ex.latest.yesterday.users.length - 3, yx.users.map(u => u.email).join(','));
check('…and the numbers follow: no Team MRR, fewer active', ex.latest.today.ext.summary.mrr === 549 && yx.summary.active === ex.latest.yesterday.summary.active - 2, JSON.stringify({ mrr: ex.latest.today.ext.summary.mrr, act: yx.summary.active, all: ex.latest.yesterday.summary.active }));
check('the hourly point carries both views', ex.series[ex.series.length - 1].ext && ex.series[ex.series.length - 1].ext.mrr === 549 && ex.series[ex.series.length - 1].mrr === 848);
const wk2 = await (await fetch(BASE + '/admin/analytics/days?end=' + today + '&n=7', { headers: H })).json();
check('the week has a without-Flood-Roofing twin', Array.isArray(wk2.days_ext) && wk2.days_ext[5].logins === wk2.days[5].logins - 2 && wk2.days_ext[5].minutes === 0 && wk2.days_ext[5].active === 2, JSON.stringify(wk2.days_ext[5]));
const dx = await (await fetch(BASE + '/admin/analytics/day?date=' + Y, { headers: H })).json();
check('a picked day too, still knowing which day it is', dx.ext && dx.ext.users.length === dx.users.length - 3 && dx.ext.date === Y && dx.ext.nice === dx.nice);
check('the page has the toggle and the grouped bars', /Exclude Flood Roofing/.test(html) && /groupedBars/.test(html));

// ── screen time: which part of the app the minutes were spent in ──
const scr = await (await fetch(BASE + '/admin/analytics/day?date=' + Y, { headers: H })).json();
const sam = scr.users.find(u => u.email === 'sam@northland.co.nz');
check('a person\'s row says where the minutes went', sam && sam.screens && sam.screens.roof === 4 && sam.screens.quote === 2 && sam.minutes === 19, JSON.stringify(sam && sam.screens) + ' ' + (sam && sam.minutes));
const wk3 = await (await fetch(BASE + '/admin/analytics/days?end=' + today + '&n=7', { headers: H })).json();
check('the week carries minutes per screen per day', wk3.days[5].screens.roof === 4 && wk3.days[5].screens.quote === 2 && wk3.days[5].minutes === 24, JSON.stringify(wk3.days[5].screens));
check('the page shows a Screens column and where the time went', /<th>Screens<\/th>/.test(html) && /Where the time went/.test(html));

// ── an owner's RoofMap login opens it too; a stranger's does not ──
const ownerTok = jwt.sign({ id: 'u6', email: 'office@floodroofing.co.nz', cid: C1, tv: 0 }, 'test-secret');
const otherTok = jwt.sign({ id: 'u3', email: 'jo@bay.co.nz', cid: C3, tv: 0 }, 'test-secret');
check('a signed-in owner reads the analytics with no admin token', (await fetch(BASE + '/admin/analytics', { headers: { Authorization: 'Bearer ' + ownerTok } })).status === 200);
check('…and the days and a day', (await fetch(BASE + '/admin/analytics/days?end=' + today, { headers: { Authorization: 'Bearer ' + ownerTok } })).status === 200 &&
  (await fetch(BASE + '/admin/analytics/day?date=' + Y, { headers: { Authorization: 'Bearer ' + ownerTok } })).status === 200);
check('a customer\'s login is turned away', (await fetch(BASE + '/admin/analytics', { headers: { Authorization: 'Bearer ' + otherTok } })).status === 404);
check('a made-up token is turned away', (await fetch(BASE + '/admin/analytics', { headers: { Authorization: 'Bearer nope' } })).status === 404);
const openPage = await fetch(BASE + '/admin/analytics/page');
const openHtml = await openPage.text();
check('the page opens without any token and offers a sign-in', openPage.status === 200 && /id="login"/.test(openHtml) && /\/auth\/login/.test(openHtml));
const man = await fetch(BASE + '/admin/analytics/manifest.webmanifest');
const manJ = await man.json();
check('it is installable: a manifest with standalone display and an icon', man.status === 200 && manJ.display === 'standalone' && manJ.start_url === '/admin/analytics/page' && manJ.icons.length === 2, JSON.stringify(manJ).slice(0, 100));
const ic = await fetch(BASE + '/admin/analytics/icon.png');
const icB = Buffer.from(await ic.arrayBuffer());
check('…a real PNG icon', ic.status === 200 && icB.slice(1, 4).toString() === 'PNG' && icB.length > 500, icB.length + ' bytes');
const sw = await fetch(BASE + '/admin/analytics/sw.js');
check('…and a service worker scoped to the page', sw.status === 200 && /addEventListener\('fetch'/.test(await sw.text()) && /rel="manifest"/.test(openHtml) && /serviceWorker\.register/.test(openHtml));

// ── a database outage is not an empty morning ─────────────────────
db.__fail500 = 'companies';
const down = await fetch(BASE + '/admin/analytics/refresh', { method: 'POST', headers: H });
db.__fail500 = '';
const kept = await (await fetch(BASE + '/admin/analytics', { headers: H })).json();
check('a failed read is an error, not a snapshot of zeros', down.status === 500 && kept.series.length === 3 && kept.latest.today.summary.businesses === 4, down.status + ' ' + kept.series.length);

relay.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
