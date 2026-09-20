// "one of the marketing emails was sent from office@floodroofing.co.nz, I
//  want to test to make sure this can't happen again"
//
// How it happened: the platform's From was on a domain Resend had not
// verified, Resend refused the message, and _dispatchMail fell back to the
// Google relay — one Gmail account that can only send as the owner's
// roofing company. The trial email went to a stranger from
// office@floodroofing.co.nz.
//
// Two rules now, both pinned here with a Resend that refuses everything and
// a relay standing by:
//   1. The platform's own unprompted mail (the trial drip, the trial-ended
//      email) is HELD when Resend refuses it. It never takes the relay.
//   2. Mail a person asked for (a sign-in link) still degrades to the relay,
//      because a person who pressed a button and got nothing is worse off.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import http from 'node:http';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const days = n => new Date(Date.now() + n * 864e5).toISOString();
const C = 'cccccccc-0000-0000-0000-000000000001', U = 'bbbbbbbb-0000-0000-0000-000000000001';
const db = {
  __missing: [], __fail500: '',
  companies: [{ id: C, name: 'Trial Roofing', slug: null, plan: null }],
  company_users: [{ company_id: C, user_id: U, role: 'owner' }],
  profiles: [{ id: U, company_id: C, name: 'Tri Al', email: 'trial@someroofer.co.nz', company: 'Trial Roofing', phone: '' }],
  subscriptions: [{ id: 's1', company_id: C, user_id: U, status: 'trialing', stripe_customer_id: null,
    trial_drip: null, quiet_alert_at: null, trial_ended_mail_at: null, trial_ends_at: days(12.5), created_at: days(-1.5) }],
  usage_events: [{ id: 1, name: 'login', company_id: C, user_id: U, at: days(-1), props: {} }],
  platform_state: [], cancel_feedback: [], user_settings: [], company_invites: [], company_domains: [], waitlist: [], error_log: [],
};
const { port } = await startFakePostgrest(db);
// The relay: records everything it is handed. Its own identity is the
// owner's roofing company, so anything landing here went out as them.
const relayed = [];
const relay = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => { try { relayed.push(JSON.parse(body)); } catch (e) { relayed.push({ raw: body }); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));
// A Resend that refuses every send — an outage, a stale key, a domain it
// no longer likes. Domain listing answers so boot is quiet.
const refused = [];
const resend = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    if (req.method === 'POST' && /\/emails/.test(req.url)){ try { refused.push(JSON.parse(body)); } catch (e) {}
      res.writeHead(422, { 'content-type': 'application/json' }); return res.end('{"message":"Resend says no"}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}');
  });
});
await new Promise(r => resend.listen(0, '127.0.0.1', r));
process.env.RESEND_API_KEY = 're_test_key';
process.env.RESEND_API_BASE = 'http://127.0.0.1:' + resend.address().port;
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <support@roofmap.co.nz>';
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.BILLING_ENABLED = 'true';
process.env.PLAN_CACHE_MS = '0';
process.env.ADMIN_TOKEN = 'let-me-in-please-0000';
process.env.PUBLIC_APP_URL = 'https://roofmap.co.nz';
delete process.env.STRIPE_SECRET_KEY; delete process.env.DATABASE_URL; delete process.env.TENANT_MAIL_DOMAIN;
const PORT = process.env.TEST_PORT || '34672';
process.env.PORT = PORT;
const log = console.log, cerr = console.error, cwarn = console.warn;
console.log = () => {}; console.error = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr; console.warn = cwarn;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const H = { 'x-admin-token': 'let-me-in-please-0000' };
const wait = ms => new Promise(r => setTimeout(r, ms));

// ── the drip: Resend refuses, and the relay is NOT used ─────────────
const r = await (await fetch(BASE + '/admin/trial-drip/run', { method: 'POST', headers: H })).json();
await wait(500);
check('the platform tried Resend for the trial email', refused.length >= 1, refused.length + ' attempt(s)');
check('…Resend refused it, and NOT ONE trial email took the Google relay', relayed.length === 0,
      relayed.map(m => m.to + ' ← ' + (m.fromAddress || 'the relay’s own address')).join(' | ') || 'relay untouched');
check('…the sweep reports the failure rather than a send', (r.errors || 0) >= 1 && !(r.sent > 0), JSON.stringify(r));

// ── the trial-ended email, the same ─────────────────────────────────
db.subscriptions[0].trial_ends_at = days(-0.5);
const before = relayed.length;
await (await fetch(BASE + '/admin/trial-ended/run', { method: 'POST', headers: H })).json();
await wait(500);
check('the trial-ended email is held the same way — nothing relayed', relayed.length === before);

// ── but a link somebody asked for still degrades to the relay ───────
const ask = await fetch(BASE + '/try/link', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'keen@roofer.co.nz' }) });
await wait(500);
const link = relayed.filter(m => String(m.to || '').toLowerCase() === 'keen@roofer.co.nz');
check('mail a person asked for still goes out through the relay when Resend is down',
      ask.status === 200 && link.length === 1, ask.status + ' · ' + link.length + ' relayed');

relay.close(); resend.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
