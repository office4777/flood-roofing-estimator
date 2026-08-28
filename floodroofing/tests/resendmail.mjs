// Which pipe carries the platform's mail when both are configured.
//
// The Google relay is ONE Gmail account with a ~1,500-message day shared by
// every tenant — a single-company pipe. Resend is the platform pipe: verified
// domain, per-tenant display name, no shared quota. With both configured,
// Resend must win, and the message must still wear the ROOFER's name with
// replies pointing at them — the identity rules don't change with the
// transport.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Two stand-ins: the Google relay, and Resend's API.
const gasSeen = [];
const gas = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => { gasSeen.push(b); res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r => gas.listen(0, '127.0.0.1', r));
const resendSeen = [];
let resendBroken = false;   // flips the stub into "stale key / unverified domain" mode
const resend = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    try { resendSeen.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(b || '{}') }); }
    catch (e) { resendSeen.push({ path: req.url, raw: b }); }
    if (resendBroken){
      res.writeHead(403, {'content-type':'application/json'});
      return res.end('{"name":"validation_error","message":"Domain is not verified"}');
    }
    res.writeHead(200, {'content-type':'application/json'}); res.end('{"id":"re_msg_1"}');
  });
});
await new Promise(r => resend.listen(0, '127.0.0.1', r));

const TENANT = { user: 'u1', company: 'c1' };
const { port } = await startFakePostgrest({
  profiles: [{ id: TENANT.user, company_id: TENANT.company, email: 'hemi@hemisroofing.co.nz' }],
  company_users: [{ company_id: TENANT.company, user_id: TENANT.user, role: 'owner' }],
  user_settings: [{ user_id: TENANT.user, company_id: TENANT.company,
    branding: { company_name: "Hemi's Roofing Ltd", email: 'hemi@hemisroofing.co.nz' },
    quote_defaults: {}, updated_at: new Date().toISOString() }],
  invoices: [{ id: 'inv1', company_id: TENANT.company, user_id: TENANT.user, job_id: 'j1',
    number: 'INV-0001', type: 'deposit', status: 'draft', amount: 1000, gst: 150, total: 1150,
    gst_rate: 15, client_email: 'homeowner@example.com', site_address: '9 Roof Rd' }],
  jobs: [{ id: 'j1', user_id: TENANT.user, company_id: TENANT.company, client_name: 'A Homeowner',
    site_address: '9 Roof Rd', draw_state: { state: { quote: {} } } }],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
// BOTH pipes configured — the whole point.
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + gas.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.RESEND_API_KEY = 're_test_123';
process.env.RESEND_API_BASE = 'http://127.0.0.1:' + resend.address().port;
process.env.EMAIL_FROM = 'RoofMap <noreply@roofmap.co.nz>';
const PORT = process.env.TEST_PORT || '34633';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const tok = jwt.sign({ id: TENANT.user, email: 'hemi@hemisroofing.co.nz', cid: TENANT.company }, 'test-secret');

// ── a tenant's invoice to their homeowner ─────────────────────────
let r = await fetch(BASE + '/invoices/inv1/send', {
  method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok }, body: '{}' });
await new Promise(x => setTimeout(x, 400));
check('the send succeeded', r.status < 400, 'status ' + r.status);
check('it went down the Resend pipe, not the Google relay',
  resendSeen.length === 1 && gasSeen.length === 0,
  'resend ' + resendSeen.length + ', relay ' + gasSeen.length);
const m = resendSeen[0] || {};
check('…to Resend\'s send endpoint with the key', m.path === '/emails' && m.auth === 'Bearer re_test_123',
  m.path + ' ' + m.auth);
check('…wearing the ROOFER\'s name on the platform\'s verified address',
  /Hemi's Roofing Ltd/.test((m.body || {}).from || '') && /noreply@roofmap\.co\.nz/.test((m.body || {}).from || ''),
  (m.body || {}).from);
check('…with replies pointing at the roofer, not us',
  JSON.stringify((m.body || {}).reply_to || []).includes('hemi@hemisroofing.co.nz'),
  JSON.stringify((m.body || {}).reply_to));
check('…addressed to the homeowner', JSON.stringify((m.body || {}).to || []).includes('homeowner@example.com'),
  JSON.stringify((m.body || {}).to));

// ── the office's order email carries CC and the PDF ───────────────
resendSeen.length = 0; gasSeen.length = 0;
r = await fetch(BASE + '/email/send-order', {
  method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok },
  body: JSON.stringify({ to: 'supplier@steel.nz', cc: 'office@hemisroofing.co.nz',
    subject: 'Order FR-1', text: 'The order.',
    attachment: { filename: 'order.pdf', base64: Buffer.from('%PDF-1.4 test').toString('base64') } }) });
await new Promise(x => setTimeout(x, 400));
const o = resendSeen[0] || {};
check('the order email also rides Resend', r.status < 400 && resendSeen.length === 1 && gasSeen.length === 0,
  'status ' + r.status + ', resend ' + resendSeen.length + ', relay ' + gasSeen.length);
check('…CC intact', JSON.stringify((o.body || {}).cc || []).includes('office@hemisroofing.co.nz'),
  JSON.stringify((o.body || {}).cc));
check('…PDF attachment intact', !!((o.body || {}).attachments || [])[0] &&
  (o.body.attachments[0].filename === 'order.pdf') && !!o.body.attachments[0].content, '');

// ── a stale key must not take the mail down ───────────────────────
// The exact production hazard: a RESEND_API_KEY from an old account, domain
// never verified there. The send must degrade to the Google relay — same
// message, same recipient — not fail.
resendBroken = true;
resendSeen.length = 0; gasSeen.length = 0;
r = await fetch(BASE + '/invoices/inv1/send', {
  method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok }, body: '{}' });
await new Promise(x => setTimeout(x, 400));
check('with Resend refusing, the send still succeeds', r.status < 400, 'status ' + r.status);
check('…because it fell back to the Google relay',
  resendSeen.length === 1 && gasSeen.length === 1,
  'resend tried ' + resendSeen.length + ', relay carried ' + gasSeen.length);
const fb = JSON.parse(gasSeen[0] || '{}');
check('…with the homeowner and the roofer\'s name intact on the fallback',
  fb.to === 'homeowner@example.com' && /Hemi's Roofing/.test(fb.fromName || ''),
  fb.to + ' / ' + fb.fromName);

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
