// THE PLAN TERMS OF 2026-11-03 (the owner: "Measure ... 30 roofs a month,
// Trade 100 and Team unlimited ... move Merchant Orders to Team ... A.I.
// Tendering on Team ... don't change it for the existing paying customers").
//
// Against the real server on the fake PostgREST:
//   - a business paying since before the terms began keeps its old plan:
//     no monthly cap, merchant orders on Measure and Trade;
//   - on the new terms Measure stops at 30 roofs a month (MONTH_ROOFS_USED,
//     naming Trade) and Trade's cap is 100; Team has none;
//   - a roof counts once per job, re-saving it costs nothing, a sketch and
//     a job from before the terms never count;
//   - the merchant order is Team's (Measure / Trade refused, naming Team),
//     a quote email is still Trade's;
//   - AI Tendering is open to Team and to a trial, not to Trade;
//   - /subscription says which terms and how many roofs are left.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const days = (n) => new Date(Date.now() + n*864e5).toISOString();
const id = (k) => 'cccccccc-0000-0000-0000-00000000000' + k;
const uid = (k) => 'uuuuuuuu-0000-0000-0000-00000000000' + k;
// A = Measure on the new terms, B = Measure paying since before them,
// C = Trade new, D = Team new, E = a trial.
const CO = { A: id(1), B: id(2), C: id(3), D: id(4), E: id(5) };
const US = { A: uid(1), B: uid(2), C: uid(3), D: uid(4), E: uid(5) };
const plan = { A:'measure', B:'measure', C:'solo', D:'team', E:'trial' };
const db = { __missing: [], __fail500: '',
  companies: Object.keys(CO).map(k => ({ id: CO[k], name: 'Co ' + k, slug: null, plan: plan[k] })),
  company_users: Object.keys(CO).map(k => ({ company_id: CO[k], user_id: US[k], role: 'owner' })),
  profiles: Object.keys(CO).map(k => ({ id: US[k], company_id: CO[k], name: k, email: k.toLowerCase() + '@co.nz' })),
  company_invites: [], company_domains: [], user_settings: [], usage_events: [], trial_roofs: [], plan_roofs: [],
  jobs: [
    // B's... no: A's job from before the terms began.
    { id: 'aaaaaaaa-0000-0000-0000-000000000099', user_id: US.A, company_id: CO.A, client_name: 'Old', site_address: 'Old', draw_state: {}, settings: {}, status: 'draft', created_at: days(-40), updated_at: days(-40), version_of: null },
  ],
  subscriptions: [
    { id:'sA', company_id: CO.A, user_id: US.A, status:'active', paid_since: days(-1),  created_at: days(-20) },
    { id:'sB', company_id: CO.B, user_id: US.B, status:'active', paid_since: days(-30), created_at: days(-60) },
    { id:'sC', company_id: CO.C, user_id: US.C, status:'active', paid_since: days(-1),  created_at: days(-2) },
    { id:'sD', company_id: CO.D, user_id: US.D, status:'active', paid_since: days(-1),  created_at: days(-2) },
    { id:'sE', company_id: CO.E, user_id: US.E, status:'trialing', trial_ends_at: days(20), trial_roof_limit: null, created_at: days(-1) },
  ],
};
const { port } = await startFakePostgrest(db);
const PORT = process.env.TEST_PORT || '34671';
process.env.PORT = PORT;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'true';
process.env.PLAN_TERMS_FROM = days(-10);
process.env.TENDERING_USERS = 'nobody@nowhere.nz';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.DATABASE_URL;
delete process.env.EMAIL_ENABLED;
const jwtLib = require('jsonwebtoken');
const log = console.log, cerr = console.error, cwarn = console.warn;
console.log = () => {}; console.error = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr; console.warn = cwarn;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const TOK = {}; Object.keys(CO).forEach(k => { TOK[k] = jwtLib.sign({ id: US[k], email: k.toLowerCase() + '@co.nz', cid: CO[k] }, 'test-secret', { expiresIn: '1h' }); });
const api = async (m, path, body, k) => {
  const r = await fetch(BASE + path, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK[k] },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const SQ = [[100,100],[400,100],[400,300],[100,300]];
const roof = () => ({ state: { quote: { ref: 'J' + Math.random().toString(36).slice(2, 8) } }, draw: { outline: SQ, scaleMetresPerPx: 0.03 } });
const sketch = () => ({ state: {}, draw: { outline: SQ, scaleMetresPerPx: 0 } });
const newJob = (k, ds) => api('POST', '/jobs', { client_name: 'C', site_address: 'A', draw_state: ds }, k);
const putJob = (k, jid, ds) => api('PUT', '/jobs/' + jid, { draw_state: ds }, k);
const rows = (k) => db.plan_roofs.filter(r => r.company_id === CO[k]).length;

// ── the terms each business is on ──────────────────────────────────
let r = await api('GET', '/subscription', null, 'A');
check('a Measure business paying since after the change is on the new terms, 30 roofs a month',
  r.body.terms === 'current' && r.body.roofs_month && r.body.roofs_month.limit === 30 && r.body.roofs_month.used === 0, JSON.stringify([r.body.terms, r.body.roofs_month]));
r = await api('GET', '/subscription', null, 'B');
check('a Measure business paying since BEFORE it keeps its old plan: no monthly cap', r.body.terms === 'legacy' && r.body.roofs_month == null, JSON.stringify([r.body.terms, r.body.roofs_month]));
r = await api('GET', '/subscription', null, 'C');
check('Trade is 100 roofs a month', r.body.roofs_month && r.body.roofs_month.limit === 100, JSON.stringify(r.body.roofs_month));
r = await api('GET', '/subscription', null, 'D');
check('Team has no cap', r.body.roofs_month == null, JSON.stringify(r.body.roofs_month));

// ── Measure stops at 30 ────────────────────────────────────────────
r = await newJob('A', sketch());
check('a sketch with no scale is not a measured roof', r.status === 200 && rows('A') === 0, r.status + ' ' + rows('A'));
const sketchId = r.body.id;
let firstId = null, ok = true;
for (let i = 0; i < 30; i++){ const x = await newJob('A', roof()); if (x.status !== 200) { ok = false; break; } if (!firstId) firstId = x.body.id; }
check('thirty measured roofs save', ok && rows('A') === 30, String(rows('A')));
r = await newJob('A', roof());
check('the 31st is refused, naming Trade, the roofs counted and the cap',
  r.status === 403 && r.body.code === 'MONTH_ROOFS_USED' && r.body.needs === 'Trade' && r.body.roofs_limit === 30 && r.body.roofs_used === 30 &&
  /30 roofs this month on Measure/.test(r.body.error || ''), r.status + ' ' + JSON.stringify(r.body));
r = await putJob('A', firstId, roof());
check('…while a roof already counted keeps saving', r.status === 200 && rows('A') === 30, r.status + ' ' + rows('A'));
r = await putJob('A', sketchId, roof());
check('…and scaling that old sketch now is a 31st roof, refused', r.status === 403 && r.body.code === 'MONTH_ROOFS_USED', String(r.status));
r = await putJob('A', 'aaaaaaaa-0000-0000-0000-000000000099', roof());
check('a job made before the terms began is never counted, even at the cap', r.status === 200 && rows('A') === 30, r.status + ' ' + rows('A'));
r = await api('GET', '/subscription', null, 'A');
check('/subscription says 30 of 30 used', r.body.roofs_month && r.body.roofs_month.used === 30 && r.body.roofs_month.left === 0, JSON.stringify(r.body.roofs_month));

// ── the old terms are kept ─────────────────────────────────────────
ok = true;
for (let i = 0; i < 31; i++){ const x = await newJob('B', roof()); if (x.status !== 200) { ok = false; break; } }
check('the business paying before keeps measuring past 30 a month', ok && rows('B') === 0, String(rows('B')));

// ── the merchant order is Team's ───────────────────────────────────
const order = (k) => api('POST', '/email/send-order', { to: 'yard@merchant.co.nz', subject: 'Order', text: 'x', kind: 'order' }, k);
const quote = (k) => api('POST', '/email/send-order', { to: 'c@cust.co.nz', subject: 'Quote', text: 'x', kind: 'quote' }, k);
r = await order('A');
check('a merchant order on new-terms Measure is refused, naming Team', r.status === 403 && r.body.code === 'PLAN_LIMIT' && r.body.needs === 'Team', r.status + ' ' + JSON.stringify(r.body));
r = await order('C');
check('…and on new-terms Trade', r.status === 403 && r.body.needs === 'Team', r.status + ' ' + JSON.stringify(r.body));
r = await quote('C');
check('…while Trade still emails a quote', r.body.code !== 'PLAN_LIMIT', r.status + ' ' + JSON.stringify(r.body));
r = await order('B');
check('the Measure business paying before still sends its orders', r.body.code !== 'PLAN_LIMIT', r.status + ' ' + JSON.stringify(r.body));
r = await order('D');
check('Team sends them', r.body.code !== 'PLAN_LIMIT', r.status + ' ' + JSON.stringify(r.body));

// ── AI Tendering is Team's ─────────────────────────────────────────
r = await api('GET', '/tender/enabled', null, 'D');
check('AI Tendering is on for a Team business', r.status === 200 && r.body.enabled === true, r.status + ' ' + JSON.stringify(r.body));
r = await api('GET', '/tender/enabled', null, 'E');
check('…and for a trial (which is Team)', r.status === 200 && r.body.enabled === true, r.status + ' ' + JSON.stringify(r.body));
r = await api('GET', '/tender/enabled', null, 'C');
check('…but not for Trade', r.status === 200 && r.body.enabled === false, r.status + ' ' + JSON.stringify(r.body));
r = await api('GET', '/tender', null, 'C');
check('…and Trade is refused at the door, naming Team', r.status === 403 && r.body.code === 'TENDERING_OFF' && r.body.needs === 'Team', r.status + ' ' + JSON.stringify(r.body));

const failed = results.filter(x => !x).length;
console.log((results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
