// The day a trial runs out with no plan picked: one email, two buttons.
// "Select a plan" lands in the app on Billing; "Cancel RoofMap" opens a form
// whose every answer is compulsory and comes to support@, and closes the
// trial. Sent once per trial, never to a paying account, never to a trial
// that lapsed before this shipped.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const days = n => new Date(Date.now() + n * 864e5).toISOString();

const CO = 'cccccccc-1111-1111-1111-111111111111', CO2 = 'cccccccc-2222-2222-2222-222222222222', CO3 = 'cccccccc-3333-3333-3333-333333333333', CO4 = 'cccccccc-4444-4444-4444-444444444444';
const BOB = 'bbbbbbbb-0000-0000-0000-000000000001', SAM = 'bbbbbbbb-0000-0000-0000-000000000002', PAY = 'bbbbbbbb-0000-0000-0000-000000000003', OLD = 'bbbbbbbb-0000-0000-0000-000000000004';
const db = {
  __missing: [], __fail500: '',
  companies: [{ id: CO, name: 'Acme Roofing', slug: null, plan: null }, { id: CO2, name: 'Bay Roofing', slug: null, plan: null }, { id: CO3, name: 'Paid Roofing', slug: null, plan: 'team' }, { id: CO4, name: 'Old Roofing', slug: null, plan: null }],
  company_users: [{ company_id: CO, user_id: BOB, role: 'owner' }, { company_id: CO2, user_id: SAM, role: 'owner' }, { company_id: CO3, user_id: PAY, role: 'owner' }, { company_id: CO4, user_id: OLD, role: 'owner' }],
  profiles: [{ id: BOB, company_id: CO, name: 'Bob Tui', email: 'bob@acmeroofing.co.nz', company: 'Acme Roofing', phone: '021 111' },
             { id: SAM, company_id: CO2, name: 'Sam', email: 'sam@bay.co.nz', company: 'Bay Roofing' },
             { id: PAY, company_id: CO3, name: 'Pat', email: 'pat@paid.co.nz', company: 'Paid Roofing' },
             { id: OLD, company_id: CO4, name: 'Olly', email: 'olly@old.co.nz', company: 'Old Roofing' }],
  subscriptions: [
    { id: 's1', company_id: CO,  user_id: BOB, status: 'trialing', trial_ends_at: days(-0.5), stripe_customer_id: null, trial_ended_mail_at: null, created_at: days(-15) },
    { id: 's2', company_id: CO2, user_id: SAM, status: 'trialing', trial_ends_at: days(3),    stripe_customer_id: null, trial_ended_mail_at: null, created_at: days(-11) },
    { id: 's3', company_id: CO3, user_id: PAY, status: 'trialing', trial_ends_at: days(-1),   stripe_customer_id: 'cus_1', trial_ended_mail_at: null, created_at: days(-15) },
    { id: 's4', company_id: CO4, user_id: OLD, status: 'trialing', trial_ends_at: days(-40),  stripe_customer_id: null, trial_ended_mail_at: null, created_at: days(-60) },
  ],
  platform_state: [], cancel_feedback: [], usage_events: [], user_settings: [], company_invites: [], company_domains: [],
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
const PORT = process.env.TEST_PORT || '34641';
process.env.PORT = PORT;
const jwtLib = require('jsonwebtoken');
const log = console.log, cerr = console.error;
console.log = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const T = '?token=' + process.env.ADMIN_TOKEN;
const settle = () => new Promise(r => setTimeout(r, 400));
const mailText = m => JSON.stringify(m);

// ── the sweep ────────────────────────────────────────────────────
let r = await fetch(BASE + '/admin/trial-ended/run' + T, { method: 'POST' });
let out = await r.json();
await settle();
check('the sweep looks at trials that have ended and sends to the one that qualifies', r.status === 200 && out.sent === 1, JSON.stringify(out));
const m = sent.find(x => /trial has ended/i.test(mailText(x)));
check('…to the business owner, with the two buttons', !!m && /bob@acmeroofing.co.nz/.test(mailText(m)) && /Select a plan and continue/.test(mailText(m)) && /Cancel RoofMap/.test(mailText(m)), m ? '' : 'no mail');
check('…"Select a plan" lands in the app on Billing', !!m && /roofmap\.co\.nz\/app\?billing=plans/.test(mailText(m)));
const cancelUrl = (mailText(m).match(/https:\/\/roofmap\.co\.nz\/trial-ended\?t=[A-Za-z0-9._%-]+/) || [])[0];
check('…"Cancel RoofMap" carries a signed link to the form', !!cancelUrl, cancelUrl || 'no link');
check('a trial with days left is not mailed', !sent.some(x => /sam@bay/.test(mailText(x))));
check('a trial with a card on file is not mailed', !sent.some(x => /pat@paid/.test(mailText(x))));
check('a trial that lapsed weeks before this shipped is left alone', !sent.some(x => /olly@old/.test(mailText(x))));
check('…and the one that was mailed is marked, so a second sweep sends nothing', db.subscriptions.find(s => s.id === 's1').trial_ended_mail_at && (await (await fetch(BASE + '/admin/trial-ended/run' + T, { method: 'POST' })).json()).sent === 0);
check('the sweep needs the admin token', (await fetch(BASE + '/admin/trial-ended/run', { method: 'POST' })).status === 404);

// ── the cancel form ──────────────────────────────────────────────
const token = decodeURIComponent(cancelUrl.split('t=')[1]);
const post = body => fetch(BASE + '/trial/cancel-feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
let f = await post({ token, reasons: [], detail: 'x', keep: 'y' });
check('no reason ticked is refused', f.status === 400 && /at least one/.test(JSON.stringify(await f.json())));
f = await post({ token, reasons: ['mapping'], detail: '', keep: 'y' });
check('no words is refused', f.status === 400);
f = await post({ token, reasons: ['mapping'], detail: 'x', keep: '  ' });
check('no "what would make you stay" is refused', f.status === 400);
f = await post({ token: 'nonsense', reasons: ['mapping'], detail: 'x', keep: 'y' });
check('a bad link is refused', f.status === 401);
f = await post({ token: jwtLib.sign({ purpose: 'reset', id: BOB }, 'test-secret'), reasons: ['mapping'], detail: 'x', keep: 'y' });
check('…and a token minted for anything else is refused', f.status === 401);
sent.length = 0;
f = await post({ token, reasons: ['mapping', 'time', 'bogus'], detail: 'The satellite kept landing on the wrong house.', keep: 'A phone call to set it up with me.' });
await settle();
check('a full answer is accepted', f.status === 200, String(f.status));
const fb = db.cancel_feedback[0];
check('…stored with the reasons, the words and the ask', fb && fb.email === 'bob@acmeroofing.co.nz' && JSON.stringify(fb.reasons) === JSON.stringify(['mapping', 'time']) && /wrong house/.test(fb.detail) && /phone call/.test(fb.keep), JSON.stringify(fb));
const sup = sent.find(x => /Trial cancelled/.test(mailText(x)));
check('…and emailed to support with everything in it',
  !!sup && /support@roofmap.co.nz/.test(mailText(sup)) && /Acme Roofing/.test(mailText(sup)) && /Mapping the roof is too hard/.test(mailText(sup)) && /Not enough time/.test(mailText(sup)) && /wrong house/.test(mailText(sup)) && /phone call/.test(mailText(sup)) && /021 111/.test(mailText(sup)),
  sup ? '' : 'no support mail');
const s1 = db.subscriptions.find(s => s.id === 's1');
check('…and the trial is closed', s1.status === 'canceled' && !!s1.cancel_at, JSON.stringify(s1));
check('…a paying subscription is never touched by the form', db.subscriptions.find(s => s.id === 's3').status === 'trialing');

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
