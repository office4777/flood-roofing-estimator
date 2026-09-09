// The daily activity report: who started a trial yesterday, who is on one,
// who pays for which plan and what that adds up to, and a line per person
// with what they did yesterday. Sent at 6am New Zealand time to support@,
// once, whatever the container has been doing.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const { nzMidnightUtc, shiftDate } = require('./daily.js');
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
const PORT = process.env.TEST_PORT || '34613';
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

// ── the numbers ──────────────────────────────────────────────────
const r = await fetch(BASE + '/admin/daily' + T); const rep = await r.json();
check('the report is for yesterday, New Zealand time', r.status === 200 && rep.date === Y, rep.date + ' vs ' + Y);
check('it names who started a trial yesterday', rep.new_trials.length === 1 && rep.new_trials[0].name === 'Kaipara Roofing' && rep.new_trials[0].owner.phone === '027 222', JSON.stringify(rep.new_trials.map(c => c.name)));
check('…and who is on a trial now, with days left', rep.trials.length === 2 && rep.trials.every(c => c.trial_days_left > 0) && rep.trials.map(c => c.name).sort().join() === 'Bay Roofing,Kaipara Roofing', JSON.stringify(rep.trials.map(c => [c.name, c.trial_days_left])));
check('…who pays for which plan', rep.paid.team.length === 1 && rep.paid.team[0].name === 'Northland Roofing' && rep.paid.business.length === 1 && rep.paid.solo.length === 0, JSON.stringify(Object.keys(rep.paid).map(k => k + ':' + rep.paid[k].length)));
check('…and the MRR of the paying businesses combined', rep.mrr === 299 + 549, 'mrr ' + rep.mrr);
const sam = rep.users.find(u => u.email === 'sam@northland.co.nz');
check('a line per person: plan, logins, canvas, quotes, orders, feedback, minutes',
  sam && sam.company_status === 'paying' && sam.plan === 'team' && sam.logins === 2 && sam.canvas === 1 && sam.quotes === 1 && sam.orders === 1 && sam.feedback === 1 && sam.minutes === 13, JSON.stringify(sam));
const jo = rep.users.find(u => u.email === 'jo@bay.co.nz'), ana = rep.users.find(u => u.email === 'ana@hokianga.co.nz'), ben = rep.users.find(u => u.email === 'ben@northland.co.nz');
check('…counting only yesterday: the day before and today do not show', jo && jo.logins === 0 && ana && ana.logins === 0, JSON.stringify([jo && jo.logins, ana && ana.logins]));
check('…every member of a business is listed, quiet ones included', !!ben && ben.company === 'Northland Roofing' && ben.minutes === 0);
check('…and the busiest person is first', rep.users[0].email === 'sam@northland.co.nz', rep.users[0].email);
const aron = rep.users.find(u => u.email === 'aron@northland.co.nz');
check('THE FIX: an owner on the business by profile alone is listed with his activity',
  !!aron && aron.company === 'Northland Roofing' && aron.canvas === 1 && aron.minutes === 5, JSON.stringify(aron));
const stray = rep.users.find(u => u.email === 'u-stray');
check('…and somebody who did something but is on no business still shows, saying so',
  !!stray && stray.logins === 1 && /not on any business/.test(stray.company), JSON.stringify(stray));
check('a day can be asked for by date', (await (await fetch(BASE + '/admin/daily' + T + '&date=' + shiftDate(Y, -1))).json()).date === shiftDate(Y, -1));
check('…and not without the token', (await fetch(BASE + '/admin/daily')).status === 404);

// ── the email ────────────────────────────────────────────────────
const prev = await fetch(BASE + '/admin/daily/preview' + T);
check('the preview is the email as a page', /text\/html/.test(prev.headers.get('content-type') || '') && /Northland Roofing/.test(await prev.text()));
const s = await fetch(BASE + '/admin/daily/send' + T, { method: 'POST' }); const sj = await s.json();
await new Promise(x => setTimeout(x, 400));
const mail = sent[sent.length - 1] || {};
check('"send now" emails it to support@ with the asked-for subject', s.status === 200 && sj.to === 'support@roofmap.co.nz' && mail.to === 'support@roofmap.co.nz' && mail.subject === 'Activity daily report', JSON.stringify({ to: mail.to, subject: mail.subject }));
const text = mail.text || mail.body || '';
check('…and the email carries every section', /NEW TRIALS YESTERDAY: 1/.test(text) && /Kaipara Roofing/.test(text) && /ON A TRIAL NOW: 2/.test(text) && /TEAM \(\$299\/mo\): 1/.test(text) && /MRR, paying businesses combined: \$848/.test(text) && /Sam Tane \| Northland Roofing \| paying Team \| 2 \| 1 \| 1 \| 1 \| 1 \| 13/.test(text), text.slice(0, 400));

// ── the clock ────────────────────────────────────────────────────
const DAILY = { due: null };
// the watermark was written by the send: today's report has gone
const st = db.platform_state.find(x => x.key === 'daily_report');
check('the send is recorded, with the day it was for', !!st && st.value.for_date === Y, JSON.stringify(st && st.value));
const { createDaily } = require('./daily.js');
const relayHits = sent.length;
const D2 = createDaily({ supabase: require('@supabase/supabase-js').createClient(process.env.SUPABASE_URL, 'k'), dispatchMail: async () => { sent.push({ fake: true }); }, defaultTo: 'support@roofmap.co.nz' });
const sixAm = nzMidnightUtc(today) + 3 * 3600e3 + 60e3, fiveAm = nzMidnightUtc(today) + 2 * 3600e3;
check('not due before 3am New Zealand time', (await D2.due(fiveAm)) === false);
check('…and not due again today once sent', (await D2.due(sixAm)) === false);
db.platform_state.length = 0;
check('…but due after 3am when today\'s has not gone', (await D2.due(sixAm)) === true);
const ticked = await D2.tick();
check('tick sends it exactly once', ticked === true && sent.length === relayHits + 1 && (await D2.tick()) === false && sent.length === relayHits + 1);
// The 6:44 of the 10th: the watermark write was lost in a database outage,
// the next tick found no watermark, and every read came back empty — so a
// second report went out reading "0 of 0 people did something".
db.platform_state.length = 0;                     // the watermark is gone
check('…and a lost watermark does not make the same process send again', (await D2.due(sixAm)) === false && (await D2.tick()) === false && sent.length === relayHits + 1);
const D3 = createDaily({ supabase: require('@supabase/supabase-js').createClient(process.env.SUPABASE_URL, 'k'), dispatchMail: async () => { sent.push({ fake: true }); }, defaultTo: 'support@roofmap.co.nz' });
db.__fail500 = 'companies';
const t3 = await D3.tick();
db.__fail500 = '';
check('…and a fresh process with the database down sends nothing rather than an empty report', t3 === false && sent.length === relayHits + 1, sent.length + ' sent');
db.__fail500 = 'platform_state';
const t4 = await D3.tick();
db.__fail500 = '';
check('…nor when it cannot read the watermark to know whether today has gone', t4 === false && sent.length === relayHits + 1);

await new Promise(x => setTimeout(x, 200));
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
