// A SECOND GO AT THE TRIAL (2026-11-03, the owner: an email "to all the
// expired trial users that haven't signed up in a plan in the early days ...
// offer them to restart their trial ... with the new trial terms ... from
// aron@roofmap.co.nz ... one email with all the recipients as BCC").
//
// Against the real server on the fake PostgREST and a fake Resend:
//   - a trial that ran out before the offer, never paid, restarts ONCE on
//     today's terms (3 roofs / 30 days), its old roof ledger cleared;
//   - a running trial, a payer, a business that has paid, a trial that ended
//     after the offer and a blocked signup are refused, each with its reason;
//   - /subscription says restart_ok;
//   - /admin/winback lists exactly the businesses the restart would take,
//     flags a test-looking account and shows why somebody left;
//   - the send is ONE email per 45 from "Aron at RoofMap" <aron@roofmap.co.nz>,
//     everyone in BCC, the owner's own copy the To, the restart link and the
//     video in it; a second send is refused; a test goes to one address only.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { startFakePostgrest } from './fakepgrst.mjs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const posted = [];
const resend = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    if (req.method === 'POST' && /\/emails/.test(req.url)){
      try { posted.push(JSON.parse(body)); } catch (e) { posted.push({ raw: body }); }
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"id":"re_' + posted.length + '"}');
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}');
  });
});
await new Promise(r => resend.listen(0, '127.0.0.1', r));

const days = (n) => new Date(Date.now() + n * 864e5).toISOString();
const cid = (k) => 'cccccccc-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
const uid = (k) => 'uuuuuuuu-0000-0000-0000-0000000000' + String(k).padStart(2, '0');
// 1 early trial ended   2 trial running   3 paying   4 paid then cancelled
// 5 ended after the offer   6 blocked signup   7 a test account (ended early)
// 8 ended early, told us why   9 company with a paying row AND an old trial row
const BIZ = {
  1: { name: 'Kauri Roofing', email: 'kim@kauri.nz', sub: { status: 'trialing', trial_ends_at: days(-40), trial_roof_limit: null, created_at: days(-54) } },
  2: { name: 'Totara Roofing', email: 'tim@totara.nz', sub: { status: 'trialing', trial_ends_at: days(10), trial_roof_limit: 3, created_at: days(-20) } },
  3: { name: 'Rimu Roofing', email: 'rob@rimu.nz', sub: { status: 'active', paid_since: days(-10), trial_ends_at: null, created_at: days(-50) } },
  4: { name: 'Matai Roofing', email: 'mat@matai.nz', sub: { status: 'canceled', paid_since: days(-30), trial_ends_at: days(-45), created_at: days(-60) } },
  5: { name: 'Miro Roofing', email: 'mia@miro.nz', sub: { status: 'trialing', trial_ends_at: days(-1), trial_roof_limit: 3, created_at: days(-31) } },
  6: { name: 'membrane roofing', email: 'trinity.ai.group@gmail.com', sub: { status: 'trialing', trial_ends_at: days(-30), created_at: days(-44) } },
  7: { name: 'Stripe test', email: 'billy@test.nz', sub: { status: 'trialing', trial_ends_at: days(-30), created_at: days(-44) } },
  8: { name: 'Kahikatea Roofing', email: 'kat@kahika.nz', sub: { status: 'canceled', trial_ends_at: days(-20), created_at: days(-34) } },
  9: { name: 'Puriri Roofing', email: 'pat@puriri.nz', sub: { status: 'trialing', trial_ends_at: days(-60), created_at: days(-80) } },
};
// Fifty more early trials, so the send has to split into batches.
for (let k = 20; k < 70; k++) BIZ[k] = { name: 'Bulk Roofing ' + k, email: 'b' + k + '@bulk' + k + '.nz', sub: { status: 'trialing', trial_ends_at: days(-35), created_at: days(-49) } };
const keys = Object.keys(BIZ).map(Number);
const db = { __missing: [], __fail500: '',
  companies: keys.map(k => ({ id: cid(k), name: BIZ[k].name, slug: null, plan: k === 3 ? 'measure' : 'trial' })),
  company_users: keys.map(k => ({ company_id: cid(k), user_id: uid(k), role: 'owner' })),
  profiles: keys.map(k => ({ id: uid(k), company_id: cid(k), name: 'Person ' + k, email: BIZ[k].email, company: BIZ[k].name })),
  subscriptions: keys.map(k => Object.assign({ id: 's' + k, company_id: cid(k), user_id: uid(k), paid_since: null, trial_restarted_at: null,
    trial_drip: { d1: 'x' }, trial_ended_mail_at: days(-30), quiet_alert_at: null, stripe_customer_id: null, cancel_at: null }, BIZ[k].sub))
    .concat([{ id: 's9b', company_id: cid(9), user_id: uid(9), status: 'active', paid_since: days(-5), trial_ends_at: null, created_at: days(-4), trial_restarted_at: null }]),
  trial_roofs: [{ company_id: cid(1), user_id: uid(1), job_id: 'jold' }],
  cancel_feedback: [{ id: 'f1', company_id: cid(8), user_id: uid(8), reasons: ['mapping'], detail: 'could not line the photo up', keep: '' }],
  platform_state: [], company_invites: [], company_domains: [], user_settings: [], usage_events: [], plan_roofs: [], jobs: [],
};
const { port } = await startFakePostgrest(db);
const PORT = process.env.TEST_PORT || '34681';
process.env.PORT = PORT;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'true';
process.env.ADMIN_TOKEN = 'admintok-0123456789';
process.env.TRIAL_RESTART_BEFORE = days(-2);
process.env.RESEND_API_KEY = 're_test_key';
process.env.RESEND_API_BASE = 'http://127.0.0.1:' + resend.address().port;
process.env.EMAIL_FROM = 'RoofMap <support@roofmap.co.nz>';
process.env.SIGNUP_ALERT_TO = '';
process.env.TRIAL_DRIP_ENABLED = 'false';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.DATABASE_URL;
delete process.env.GAS_MAIL_URL;
const jwtLib = require('jsonwebtoken');
const log = console.log, cerr = console.error, cwarn = console.warn;
console.log = () => {}; console.error = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr; console.warn = cwarn;
await new Promise(r => setTimeout(r, 700));
posted.length = 0;
const BASE = 'http://127.0.0.1:' + PORT;
const tok = (k) => jwtLib.sign({ id: uid(k), email: BIZ[k].email, cid: cid(k) }, 'test-secret', { expiresIn: '1h' });
const api = async (m, path, body, k, admin) => {
  const h = { 'Content-Type': 'application/json' };
  if (k) h.Authorization = 'Bearer ' + tok(k);
  if (admin) h['x-admin-token'] = 'admintok-0123456789';
  const r = await fetch(BASE + path, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const sub = (k) => db.subscriptions.find(s => s.id === 's' + k);

// ── who may restart ────────────────────────────────────────────────
let r = await api('GET', '/billing/trial-restart', null, 1);
check('an early trial that ran out, never paid, may restart', r.status === 200 && r.body.ok === true && r.body.roofs === 3 && r.body.days === 30, JSON.stringify(r.body));
r = await api('GET', '/subscription', null, 1);
check('/subscription says so (restart_ok)', r.body && r.body.restart_ok === true, JSON.stringify(r.body && r.body.restart_ok));
const refusals = [[2, 'trial-running'], [3, 'paying'], [4, 'has-paid'], [5, 'ended-after-offer']];
for (const [k, why] of refusals){
  r = await api('GET', '/billing/trial-restart', null, k);
  check(BIZ[k].name + ' may not (' + why + ')', r.status === 200 && r.body.ok === false && r.body.why === why, JSON.stringify(r.body));
}
r = await api('GET', '/subscription', null, 2);
check('/subscription on a running trial says restart_ok false', r.body && r.body.restart_ok === false, JSON.stringify(r.body && r.body.restart_ok));

// ── the restart ────────────────────────────────────────────────────
r = await api('POST', '/billing/trial-restart', {}, 1);
const s1 = sub(1);
const left = Date.parse(s1.trial_ends_at) - Date.now();
check('the restart answers ok with today\'s terms', r.status === 200 && r.body.ok === true && r.body.roofs === 3 && r.body.days === 30, r.status + ' ' + JSON.stringify(r.body));
check('…the subscription is a 3-roof, 30-day trial again', s1.status === 'trialing' && s1.trial_roof_limit === 3 && left > 29.9 * 864e5 && left < 30.1 * 864e5, JSON.stringify([s1.status, s1.trial_roof_limit, left / 864e5]));
check('…stamped, with the drip and the trial-ended email starting over', !!s1.trial_restarted_at && s1.trial_drip == null && s1.trial_ended_mail_at == null, JSON.stringify([s1.trial_restarted_at, s1.trial_drip, s1.trial_ended_mail_at]));
check('…and the old trial\'s roofs no longer count', db.trial_roofs.filter(x => x.company_id === cid(1)).length === 0, String(db.trial_roofs.length));
r = await api('GET', '/subscription', null, 1);
check('/subscription now reads a live roof trial, nothing to restart', r.body.live === true && r.body.trial && r.body.trial.roofs_limit === 3 && r.body.trial.roofs_left === 3 && r.body.restart_ok === false, JSON.stringify([r.body.live, r.body.trial, r.body.restart_ok]));
r = await api('POST', '/billing/trial-restart', {}, 1);
check('a second restart is refused', r.status === 409 && /^TRIAL_RESTART_/.test(r.body.code), r.status + ' ' + JSON.stringify(r.body));
sub(1).trial_ends_at = days(-1);
r = await api('POST', '/billing/trial-restart', {}, 1);
check('…even once the restarted trial has run out too', r.status === 409 && r.body.code === 'TRIAL_RESTART_ALREADY_RESTARTED', r.status + ' ' + JSON.stringify(r.body));
r = await api('POST', '/billing/trial-restart', {}, 3);
check('a payer is refused', r.status === 409 && r.body.code === 'TRIAL_RESTART_PAYING', r.status + ' ' + JSON.stringify(r.body));
r = await api('POST', '/billing/trial-restart', {}, 6);
check('a blocked signup is refused (shut out before it is even asked)', r.status === 403 && r.body.code === 'ACCOUNT_BLOCKED' && sub(6).trial_restarted_at == null, r.status + ' ' + JSON.stringify(r.body));

// ── the list ───────────────────────────────────────────────────────
r = await api('GET', '/admin/winback', null, 1);
check('the list is not for an ordinary login', r.status === 404, String(r.status));
r = await api('GET', '/admin/winback', null, null, true);
const L = (r.body && r.body.list) || [];
const has = (k) => L.find(x => x.email === BIZ[k].email);
check('the list loads for the owner', r.status === 200 && Array.isArray(L), r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
check('it holds the early trials that never paid', !!has(8) && !!has(7) && !!has(20) && !!has(69), L.length + ' ' + L.slice(0, 5).map(x => x.email).join(','));
check('…and not one already restarted, a running trial, a payer, one that has paid, a blocked signup, or a company with a paying row',
  !has(1) && !has(2) && !has(3) && !has(4) && !has(5) && !has(6) && !has(9), L.map(x => x.email).filter(e => /kauri|totara|rimu|matai|miro|trinity|puriri/.test(e)).join(','));
check('a test-looking account is flagged, and listed last', has(7) && has(7).test === true && L[L.length - 1].email === BIZ[7].email, JSON.stringify(has(7)));
check('someone who told us why they left carries the reason', has(8) && /Mapping the roof is too hard/.test(has(8).left_why) && /line the photo up/.test(has(8).left_why), JSON.stringify(has(8)));
check('it sends from Aron at RoofMap <aron@roofmap.co.nz>, and can', r.body.from === 'Aron at RoofMap <aron@roofmap.co.nz>' && r.body.sendable === true, JSON.stringify([r.body.from, r.body.sendable]));
check('the email carries the restart button, the video and the new terms', /\/app\?restart=trial/.test(r.body.html) && /roofmap-demo-email\.jpg/.test(r.body.html) &&
  /roofmap-demo\.mp4/.test(r.body.html) && /3 real roofs or 30 days/.test(r.body.html) && /Restart my free trial/.test(r.body.html) && /Reply .stop./.test(r.body.html), '');

// ── a test, then the send ──────────────────────────────────────────
r = await api('POST', '/admin/winback/test', { to: 'aron@roofmap.co.nz' }, null, true);
const t = posted[posted.length - 1] || {};
check('a test goes to one address, no BCC', r.status === 200 && posted.length === 1 && JSON.stringify(t.to) === '["aron@roofmap.co.nz"]' && !t.bcc, r.status + ' ' + JSON.stringify([t.to, t.bcc]));
check('…from "Aron at RoofMap" <aron@roofmap.co.nz>, replies to him', /"Aron at RoofMap" <aron@roofmap\.co\.nz>/.test(t.from || '') && JSON.stringify(t.reply_to) === '["aron@roofmap.co.nz"]', JSON.stringify([t.from, t.reply_to]));
check('…with a text version carrying the link too', /\/app\?restart=trial/.test(t.text || '') && /<img[^>]+roofmap-demo-email\.jpg/.test(t.html || ''), '');
posted.length = 0;
r = await api('POST', '/admin/winback/send', { subs: [] }, null, true);
check('nothing ticked is refused', r.status === 400, String(r.status));
const ticked = L.filter(x => !x.test).map(x => x.sub_id).concat(['s3', 's1', 'nonsense']);
r = await api('POST', '/admin/winback/send', { subs: ticked }, null, true);
const bccAll = posted.flatMap(p => p.bcc || []);
const want = L.filter(x => !x.test).map(x => x.email).sort();
check('the send goes out in batches of 45 at most', r.status === 200 && r.body.ok === true && posted.length === Math.ceil(want.length / 45) && posted.every(p => (p.bcc || []).length <= 45),
  r.status + ' ' + JSON.stringify(r.body) + ' ' + posted.map(p => (p.bcc || []).length).join(','));
check('everyone ticked is in BCC exactly once, nobody else (a payer ticked by hand is dropped)', JSON.stringify(bccAll.slice().sort()) === JSON.stringify(want) && !bccAll.includes(BIZ[3].email) && !bccAll.includes(BIZ[1].email) && !bccAll.includes(BIZ[7].email),
  bccAll.length + ' vs ' + want.length);
check('each copy is To Aron\'s own address, from Aron at RoofMap, same subject', posted.every(p => JSON.stringify(p.to) === '["aron@roofmap.co.nz"]' && /aron@roofmap\.co\.nz/.test(p.from) && /have another go, free/.test(p.subject)), JSON.stringify(posted.map(p => [p.to, p.from, p.subject])[0]));
const st = db.platform_state.find(x => x.key === 'winback_2026_11');
check('the send is recorded', st && st.value && st.value.count === want.length && st.value.batches.length === posted.length && st.value.batches.every(b => b.ok), JSON.stringify(st && st.value && st.value.batches));
const n = posted.length;
r = await api('POST', '/admin/winback/send', { subs: ticked }, null, true);
check('a second send is refused and sends nothing', r.status === 409 && r.body.code === 'WINBACK_SENT' && posted.length === n, r.status + ' ' + posted.length);
r = await api('GET', '/admin/winback', null, null, true);
check('the list then says when it went', r.body.sent && r.body.sent.count === want.length, JSON.stringify(r.body.sent && r.body.sent.count));
const page = await fetch(BASE + '/admin/winback/page');
const ph = await page.text();
check('the page is served and signs in with a RoofMap login', page.status === 200 && /Second-go email/.test(ph) && /\/auth\/login/.test(ph) && /Send me a test/.test(ph), String(page.status));

const failed = results.filter(x => !x).length;
console.log((results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
