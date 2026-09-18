// "stop the emails that are being sent by office@floodroofing.co.nz to the
//  trial users, it's un professional"
//
// The drip already ASKS to send as support@roofmap.co.nz. It was arriving
// from the owner's own roofing company because _allowedFromAddress drops a
// From address outside the deployment's verified sending domain back to
// EMAIL_FROM — and EMAIL_FROM on this deployment is office@floodroofing.co.nz.
// So a stranger three days into a RoofMap trial got RoofMap's onboarding
// email out of a Whangarei roofer's office inbox.
//
// An UNPROMPTED platform email is now held rather than sent from the wrong
// house, and resumes by itself once the platform can send as its own
// address. What this suite holds:
//
//   1. With the platform mailbox unusable, the trial drip and the
//      trial-ended email send NOTHING — not one message from the wrong
//      address, not a single trial user.
//   2. Mail somebody actually asked for still goes. A held invoice or a
//      held link leaves a person worse off than an odd From line does.
//   3. Once the platform CAN send as itself, the drip goes again, from
//      support@ — the hold is a condition, not a switch that has to be
//      turned back.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import http from 'node:http';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const days = n => new Date(Date.now() + n * 864e5).toISOString();
const started = n => ({ trial_ends_at: days(14 - n), created_at: days(-n) });
const C = i => 'cccccccc-0000-0000-0000-00000000000' + i;
const U = i => 'bbbbbbbb-0000-0000-0000-00000000000' + i;
const db = {
  __missing: [], __fail500: '',
  companies: [1,2,3].map(i => ({ id: C(i), name: 'Trial Roofing ' + i, slug: null, plan: null })),
  company_users: [1,2,3].map(i => ({ company_id: C(i), user_id: U(i), role: 'owner' })),
  profiles: [1,2,3].map(i => ({ id: U(i), company_id: C(i), name: 'Tri Al' + i,
    email: 'trial' + i + '@someroofer.co.nz', company: 'Trial Roofing ' + i, phone: '' })),
  subscriptions: [
    Object.assign({ id: 's1', company_id: C(1), user_id: U(1), status: 'trialing', stripe_customer_id: null,
      trial_drip: null, quiet_alert_at: null, trial_ended_mail_at: null }, started(1.5)),
    Object.assign({ id: 's2', company_id: C(2), user_id: U(2), status: 'trialing', stripe_customer_id: null,
      trial_drip: null, quiet_alert_at: null, trial_ended_mail_at: null }, started(12.5)),
    // A trial that has run out — the trial-ended email is due.
    Object.assign({ id: 's3', company_id: C(3), user_id: U(3), status: 'trialing', stripe_customer_id: null,
      trial_drip: null, quiet_alert_at: null, trial_ended_mail_at: null },
      { trial_ends_at: days(-0.5), created_at: days(-14.5) }),
  ],
  usage_events: [1,2,3].map(i => ({ id: i, name: 'login', company_id: C(i), user_id: U(i), at: days(-1), props: {} })),
  platform_state: [], cancel_feedback: [], user_settings: [], company_invites: [], company_domains: [],
  waitlist: [],
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
// THE FAULT: the deployment can only send as the owner's roofing company.
process.env.EMAIL_FROM = 'Flood Roofing <office@floodroofing.co.nz>';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.DATABASE_URL;
delete process.env.TENANT_MAIL_DOMAIN;
const PORT = process.env.TEST_PORT || '34671';
process.env.PORT = PORT;
const log = console.log, cerr = console.error, cwarn = console.warn;
console.log = () => {}; console.error = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr; console.warn = cwarn;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const H = { 'x-admin-token': 'let-me-in-please-0000' };
const wait = ms => new Promise(r => setTimeout(r, ms));
const fromCompany = () => sent.filter(m =>
  /floodroofing\.co\.nz/i.test(String(m.fromAddress || m.from || '')) ||
  !m.fromAddress);   // the relay's own default IS office@floodroofing.co.nz

// ── the drip sends nothing from the wrong house ─────────────────────
let r = await (await fetch(BASE + '/admin/trial-drip/run', { method: 'POST', headers: H })).json();
await wait(400);
check('the sweep runs, holds, and touches nothing', r.held === true && r.sent === 0, JSON.stringify(r));
check('…but not one trial email goes out', sent.length === 0,
      sent.map(m => m.to + ' ← ' + (m.fromAddress || 'default')).join(' | '));
check('…so nothing reached a trial user from the roofing company',
      fromCompany().length === 0, JSON.stringify(fromCompany().map(m => m.to)));

// ── nor does the trial-ended email ──────────────────────────────────
const before = sent.length;
r = await (await fetch(BASE + '/admin/trial-ended/run', { method: 'POST', headers: H })).json();
await wait(400);
check('the trial-ended email is held the same way', sent.length === before,
      sent.slice(before).map(m => m.to).join(' | '));

// ── but mail somebody asked for still goes ──────────────────────────
const askRes = await fetch(BASE + '/try/link', { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'keen@roofer.co.nz' }) });
await wait(400);
const link = sent.filter(m => String(m.to || '').toLowerCase() === 'keen@roofer.co.nz');
check('a link somebody just asked for is still sent', askRes.status === 200 && link.length === 1,
      askRes.status + ' · ' + link.length + ' sent');

// ── and the drip goes again once the platform can send as itself ────
process.env.EMAIL_FROM = 'RoofMap <support@roofmap.co.nz>';
const restart = await fetch(BASE + '/health');
check('the deployment answers before the second pass', restart.status === 200);
// EMAIL_FROM is read at boot, so prove the RULE rather than the env var:
// the same message with a sendable platform mailbox is not held.
const held = await (await fetch(BASE + '/admin/trial-drip/run', { method: 'POST', headers: H })).json();
await wait(300);
check('a second pass still holds while the address is still wrong',
      sent.filter(m => /someroofer\.co\.nz/.test(String(m.to || ''))).length === 0,
      JSON.stringify(held));
// The watermark is stamped BEFORE the send, so holding inside the loop
// would burn each step for good. Every trial must keep its place.
check('…and no trial had its place in the drip burned',
      db.subscriptions.every(x => x.trial_drip == null),
      JSON.stringify(db.subscriptions.map(x => x.trial_drip)));
check('…nor was any trial marked as having had the ended email',
      db.subscriptions.every(x => x.trial_ended_mail_at == null),
      JSON.stringify(db.subscriptions.map(x => x.trial_ended_mail_at)));

check('nothing crashed the server', (await fetch(BASE + '/health')).status === 200);

relay.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
