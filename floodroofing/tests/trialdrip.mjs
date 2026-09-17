// The trial, day by day, and the trial that has gone quiet.
//
// Four emails across the fortnight (day 1, 3, 7, 12), each once, from
// support@ and signed Aron; the day-3 one only to a business that has not
// yet drawn a roof of its own. A step whose day passed more than two days
// ago is marked over, not sent late, so the first deploy mails nobody four
// times. Paying accounts and lapsed trials get nothing.
//
// Once per trial, when nobody on it has done anything for three days (or
// never signed in), support@ gets one email with their phone and how far
// they got — the list to ring.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFileSync } from 'node:fs';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const days = n => new Date(Date.now() + n * 864e5).toISOString();
// A trial that started `n` days ago (14-day trial).
const started = n => ({ trial_ends_at: days(14 - n), created_at: days(-n) });

const C = i => 'cccccccc-0000-0000-0000-00000000000' + i;
const U = i => 'bbbbbbbb-0000-0000-0000-00000000000' + i;
const co = (i, name) => ({ id: C(i), name, slug: null, plan: null });
const cu = i => ({ company_id: C(i), user_id: U(i), role: 'owner' });
const prof = (i, name, company, phone) => ({ id: U(i), company_id: C(i), name, email: name.toLowerCase().split(' ')[0] + '@' + company.toLowerCase().replace(/ /g, '') + '.co.nz', company, phone: phone || '' });
const sub = (i, n, extra) => Object.assign({ id: 's' + i, company_id: C(i), user_id: U(i), status: 'trialing', stripe_customer_id: null, trial_drip: null, quiet_alert_at: null, trial_ended_mail_at: null }, started(n), extra || {});
const db = {
  __missing: [], __fail500: '',
  companies: [co(1, 'Day One Roofing'), co(2, 'Day Three Roofing'), co(3, 'Roofed Already'), co(4, 'Day Nine Roofing'), co(5, 'Twelve Roofing'), co(6, 'Paid Roofing'), co(7, 'Fresh Roofing'), co(8, 'Quiet Roofing'), co(9, 'Busy Roofing')],
  company_users: [1,2,3,4,5,6,7,8,9].map(cu),
  profiles: [prof(1, 'Ann Tui', 'Day One Roofing', '021 111'), prof(2, 'Ben Rewi', 'Day Three Roofing'), prof(3, 'Cal Hemi', 'Roofed Already'), prof(4, 'Dee Wiremu', 'Day Nine Roofing'),
             prof(5, 'Eli Tane', 'Twelve Roofing'), prof(6, 'Pat Paid', 'Paid Roofing'), prof(7, 'Flo New', 'Fresh Roofing'), prof(8, 'Gus Quiet', 'Quiet Roofing', '027 888'), prof(9, 'Hal Busy', 'Busy Roofing')],
  subscriptions: [
    sub(1, 1.5),                       // day 1 due
    sub(2, 3.5),                       // day 3 due, no roof of their own
    sub(3, 3.5),                       // day 3 due, but they drew a real roof
    sub(4, 8.5),                       // never mailed: 1 and 3 are over, 7 is due (a day and a half late, still inside the window)
    sub(5, 12.5),                      // day 12 due
    sub(6, 12.5, { stripe_customer_id: 'cus_1' }),   // paying: nothing
    sub(7, 0.3),                       // brand new: nothing yet
    sub(8, 5),                         // quiet since day 1
    sub(9, 5),                         // active yesterday
  ],
  usage_events: [
    { id: 1, name: 'roof_drawn', company_id: C(3), user_id: U(3), at: days(-1), props: {} },
    { id: 2, name: 'roof_drawn', company_id: C(2), user_id: U(2), at: days(-1), props: { example: true } },   // the practice roof does not count
    { id: 3, name: 'login', company_id: C(8), user_id: U(8), at: days(-4.2), props: {} },
    { id: 4, name: 'roof_drawn', company_id: C(8), user_id: U(8), at: days(-4.1), props: { example: true } },
    { id: 5, name: 'app_time', company_id: C(8), user_id: U(8), at: days(-4.1), props: { minutes: 6, screen: 'roof' } },
    { id: 6, name: 'app_time', company_id: C(8), user_id: U(8), at: days(-4.05), props: { minutes: 2, screen: 'jobpack' } },
    { id: 7, name: 'screen_left', company_id: C(8), user_id: U(8), at: days(-4.0), props: { screen: 'jobpack', seconds: 40 } },
    { id: 8, name: 'walkthrough', company_id: C(8), user_id: U(8), at: days(-4.05), props: { step: 'pitch', action: 'stopped' } },
    { id: 9, name: 'login', company_id: C(9), user_id: U(9), at: days(-1), props: {} },
    { id: 10, name: 'login', company_id: C(1), user_id: U(1), at: days(-1), props: {} },
    { id: 11, name: 'login', company_id: C(2), user_id: U(2), at: days(-1), props: {} },
    { id: 12, name: 'login', company_id: C(3), user_id: U(3), at: days(-1), props: {} },
    { id: 13, name: 'login', company_id: C(4), user_id: U(4), at: days(-1), props: {} },
    { id: 14, name: 'login', company_id: C(5), user_id: U(5), at: days(-1), props: {} },
    { id: 15, name: 'login', company_id: C(7), user_id: U(7), at: days(-0.1), props: {} },
  ],
  platform_state: [], cancel_feedback: [], user_settings: [], company_invites: [], company_domains: [],
};
const { port } = await startFakePostgrest(db);
const sent = [];
const relay = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => { try { sent.push(JSON.parse(body)); } catch (e) { sent.push({ raw: body }); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.BILLING_ENABLED = 'true';
process.env.PLAN_CACHE_MS = '0';
process.env.ADMIN_TOKEN = 'let-me-in-please-0000';
process.env.PUBLIC_APP_URL = 'https://roofmap.co.nz';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.DATABASE_URL;
const PORT = process.env.TEST_PORT || '34643';
process.env.PORT = PORT;
const log = console.log, cerr = console.error;
console.log = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const H = { 'x-admin-token': 'let-me-in-please-0000' };
const wait = ms => new Promise(r => setTimeout(r, ms));
const to = addr => sent.filter(m => String(m.to || '').toLowerCase() === addr);

// ── the drip ─────────────────────────────────────────────────────
check('the sweep is behind the admin token', (await fetch(BASE + '/admin/trial-drip/run', { method: 'POST' })).status === 404);
let r = await (await fetch(BASE + '/admin/trial-drip/run', { method: 'POST', headers: H })).json();
await wait(300);
check('one pass: checked every live trial', r.checked === 9, JSON.stringify(r));
check('…and sent four — day 1, day 3, day 7 and day 12', r.sent === 4, JSON.stringify(r) + ' → ' + sent.map(m => m.to + ': ' + m.subject).join(' | '));
const d1 = to('ann@dayoneroofing.co.nz')[0];
check('day 1 points at the practice roof', d1 && /first roof/i.test(d1.subject) && /practice roof/.test(d1.text) && /roofmap\.co\.nz\/app/.test(d1.text), d1 && d1.subject);
check('…from support@, signed Aron, replies to support@',
  d1 && /support@roofmap\.co\.nz/.test(String(d1.fromAddress || d1.from || '')) && /Aron/.test(String(d1.fromName || d1.from || '')) && /support@roofmap\.co\.nz/.test(String(d1.replyTo || '')) && /\nAron\n/.test(d1.text),
  JSON.stringify({ from: d1 && (d1.fromAddress || d1.from), name: d1 && d1.fromName, reply: d1 && d1.replyTo }));
check('…addressed by first name', d1 && /^Hi Ann,/.test(d1.text), d1 && d1.text.slice(0, 12));
check('…as HTML too, with the link clickable', d1 && /<a href="https:\/\/roofmap\.co\.nz\/app"/.test(d1.html), d1 && (d1.html || '').slice(0, 80));
const d3 = to('ben@daythreeroofing.co.nz')[0];
check('day 3 asks the business that has drawn no roof of its own', d3 && /traced your own roof/i.test(d3.subject) && /New job/.test(d3.text), d3 && d3.subject);
check('…the practice roof did not count as theirs', !!d3);
check('…and is skipped for the business that has', to('cal@roofedalready.co.nz').length === 0 && /has-roof/.test(String((db.subscriptions[2].trial_drip || {}).d3)), JSON.stringify(db.subscriptions[2].trial_drip));
const d7 = to('dee@daynineroofing.co.nz')[0];
check('a trial first seen on day 8.5 gets day 7 (the newest due step) and nothing older', d7 && /call/i.test(d7.subject) && to('dee@daynineroofing.co.nz').length === 1, JSON.stringify(sent.filter(m => /dee@/.test(m.to)).map(m => m.subject)));
check('…with days 1 and 3 marked over, not sent', /missed/.test(String(db.subscriptions[3].trial_drip.d1)) && /missed/.test(String(db.subscriptions[3].trial_drip.d3)) && !/missed|late/.test(String(db.subscriptions[3].trial_drip.d7)), JSON.stringify(db.subscriptions[3].trial_drip));
const d12 = to('eli@twelveroofing.co.nz')[0];
check('day 12 says two days left and points at the plans', d12 && /two days left/i.test(d12.subject) && /\/app\?billing=plans/.test(d12.text), d12 && d12.subject);
check('a paying account gets nothing', to('pat@paidroofing.co.nz').length === 0 && db.subscriptions[5].trial_drip == null);
check('a brand-new trial gets nothing yet', to('flo@freshroofing.co.nz').length === 0 && db.subscriptions[6].trial_drip == null);
check('the record of what went is on the subscription', typeof db.subscriptions[0].trial_drip.d1 === 'string' && /^\d{4}-/.test(db.subscriptions[0].trial_drip.d1), JSON.stringify(db.subscriptions[0].trial_drip));
const before = sent.length;
r = await (await fetch(BASE + '/admin/trial-drip/run', { method: 'POST', headers: H })).json();
await wait(200);
check('a second pass an hour later sends nothing again', r.sent === 0 && sent.length === before, JSON.stringify(r));
// Time moves on: the day-1 trial reaches day 3 having drawn nothing.
db.subscriptions[0].trial_ends_at = days(14 - 3.2); db.subscriptions[0].created_at = days(-3.2);
r = await (await fetch(BASE + '/admin/trial-drip/run', { method: 'POST', headers: H })).json();
await wait(200);
check('…and the next step goes when its day comes', r.sent === 1 && to('ann@dayoneroofing.co.nz').length === 2 && /traced your own roof/i.test(to('ann@dayoneroofing.co.nz')[1].subject), JSON.stringify(r));
// A step more than two days late is marked over.
db.subscriptions[0].trial_ends_at = days(14 - 10); db.subscriptions[0].created_at = days(-10);
r = await (await fetch(BASE + '/admin/trial-drip/run', { method: 'POST', headers: H })).json();
await wait(200);
check('a step whose day passed more than two days ago is marked late, not sent', r.sent === 0 && /late/.test(String(db.subscriptions[0].trial_drip.d7)), JSON.stringify(db.subscriptions[0].trial_drip));
// The drip has an off switch, and the hourly tick honours the watermark.
check('the columns are in the boot migration',
  /alter table public\.subscriptions add column if not exists trial_drip jsonb/.test(readFileSync(_j(_ROOT, 'backend', 'server.js'), 'utf8')) &&
  /alter table public\.subscriptions add column if not exists quiet_alert_at timestamptz/.test(readFileSync(_j(_ROOT, 'backend', 'server.js'), 'utf8')));

// ── gone quiet ───────────────────────────────────────────────────
sent.length = 0;
check('the quiet sweep is behind the admin token', (await fetch(BASE + '/admin/quiet-trials/run', { method: 'POST' })).status === 404);
r = await (await fetch(BASE + '/admin/quiet-trials/run', { method: 'POST', headers: H })).json();
await wait(300);
const q = sent.filter(m => /^Gone quiet/.test(m.subject || ''));
check('one business has gone quiet: the one silent for four days', r.sent === 1 && q.length === 1 && /Quiet Roofing/.test(q[0].subject), JSON.stringify(r) + ' ' + q.map(m => m.subject).join(' | '));
const qm = q[0] || { text: '' };
check('…the alert goes to support@, replies go to them', qm.to === 'support@roofmap.co.nz' && qm.replyTo === 'gus@quietroofing.co.nz', JSON.stringify({ to: qm.to, reply: qm.replyTo }));
check('…and names them, their phone and the days left', /Gus Quiet/.test(qm.text) && /027 888/.test(qm.text) && /9 days left/.test(qm.subject), qm.subject);
check('…and how far they got', /drew the practice roof/.test(qm.text) && /Logins 1/.test(qm.text) && /8 min in the app/.test(qm.text), qm.text.split('\n').find(l => /How far/.test(l)));
check('…where the minutes went and where they stopped', /Map Roof 6, Job Pack 2/.test(qm.text) && /Last screen before they closed it: Job Pack/.test(qm.text) && /Walkthrough: stopped at pitch/.test(qm.text), qm.text);
check('a trial active yesterday is not reported', !sent.some(m => /Busy Roofing/.test(m.subject || '')));
check('a trial under three days old is not reported, even silent', !sent.some(m => /Fresh Roofing/.test(m.subject || '')));
check('a paying account is not reported', !sent.some(m => /Paid Roofing/.test(m.subject || '')));
check('the alert is recorded on the subscription', typeof db.subscriptions[7].quiet_alert_at === 'string', String(db.subscriptions[7].quiet_alert_at));
const b2 = sent.length;
r = await (await fetch(BASE + '/admin/quiet-trials/run', { method: 'POST', headers: H })).json();
await wait(200);
check('…so the next day does not report them again', r.sent === 0 && sent.length === b2, JSON.stringify(r));
// Never signed in at all: quiet since the day they signed up.
db.subscriptions.push(sub(10, 4));
db.companies.push(co(10, 'Never Roofing')); db.company_users.push(cu(10)); db.profiles.push(prof(10, 'Ian Never', 'Never Roofing', '022 000'));
r = await (await fetch(BASE + '/admin/quiet-trials/run', { method: 'POST', headers: H })).json();
await wait(300);
const nv = sent.find(m => /Never Roofing/.test(m.subject || ''));
check('a business that never signed in is reported four days after signing up', r.sent === 1 && nv && /never signed in/.test(nv.text) && /How far they got: never signed in/.test(nv.text), nv && nv.text.slice(0, 120));

relay.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
