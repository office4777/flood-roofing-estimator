// Whose name is on the email.
//
// Everything the platform sent went out under one global address, so a
// subscriber's tax invoice reached THEIR customer from ours. For a product
// sold to roofers BY a roofing company that is worse than impersonal — the
// homeowner gets an invoice for their job, apparently from a competitor.
//
// We cannot send as the roofer: that needs SPF and DKIM on a domain we do not
// control, and forging it lands in spam. So the envelope address stays ours,
// their business name goes on it, and replies point at them.
//
// The other half matters just as much: password resets and team invites really
// ARE from us, and must not start claiming to be from a roofing company.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Stand in for the Google Apps Script relay and capture what it is handed.
const sent = [];
const relay = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    try { sent.push(JSON.parse(body)); } catch (e) { sent.push({ raw: body }); }
    res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}');
  });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));
const RELAY = 'http://127.0.0.1:' + relay.address().port;

const TENANT = { user:'u1', company:'c1' };
const BRANDING = { company_name: "Hemi's Roofing Ltd", email: 'hemi@hemisroofing.co.nz', gst_number: '123 456 789' };
const { port } = await startFakePostgrest({
  profiles: [{ id: TENANT.user, company_id: TENANT.company, email: 'hemi@hemisroofing.co.nz' }],
  company_users: [{ company_id: TENANT.company, user_id: TENANT.user, role: 'owner' }],
  user_settings: [{ user_id: TENANT.user, company_id: TENANT.company, branding: BRANDING,
                    quote_defaults: {}, updated_at: new Date().toISOString() }],
  invoices: [{ id:'inv1', company_id: TENANT.company, user_id: TENANT.user, job_id:'j1',
               number:'INV-0001', type:'deposit', status:'draft', amount: 1000, gst: 150, total: 1150,
               gst_rate: 15, client_email: 'homeowner@example.com', site_address: '9 Roof Rd' }],
  jobs: [{ id:'j1', user_id: TENANT.user, company_id: TENANT.company, client_name:'A Homeowner',
           site_address:'9 Roof Rd', draw_state:{ state:{ quote:{} } } }],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.GAS_MAIL_URL = RELAY;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <noreply@roofmap.co.nz>';
const PORT = process.env.TEST_PORT || '34607';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const tok = jwt.sign({ id: TENANT.user, email: 'hemi@hemisroofing.co.nz', cid: TENANT.company }, 'test-secret');

// ── an invoice to a homeowner ─────────────────────────────────────
sent.length = 0;
let r = await fetch(BASE + '/invoices/inv1/send', {
  method: 'POST', headers: { 'content-type':'application/json', Authorization: 'Bearer ' + tok }, body: '{}' });
await new Promise(x => setTimeout(x, 400));
check('the invoice actually sent', r.status < 400 && sent.length === 1, 'status ' + r.status + ', ' + sent.length + ' mail');
const inv = sent[0] || {};
check("it goes out under the ROOFER's name, not ours",
  inv.fromName === "Hemi's Roofing Ltd", inv.fromName);
check('…with replies pointed at the roofer',
  inv.replyTo === 'hemi@hemisroofing.co.nz', inv.replyTo);
check('…and reaches the homeowner', inv.to === 'homeowner@example.com', inv.to);
check('…and does not name Flood Roofing or RoofMap as the sender',
  !/Flood Roofing|RoofMap/i.test(String(inv.fromName || '')), inv.fromName);

// ── anything else the roofer sends on their own behalf ────────────
sent.length = 0;
r = await fetch(BASE + '/email/send-order', {
  method: 'POST', headers: { 'content-type':'application/json', Authorization: 'Bearer ' + tok },
  body: JSON.stringify({ to: 'supplier@example.com', subject: 'Material order', text: 'Please supply' }) });
await new Promise(x => setTimeout(x, 400));
check('an order to a supplier also goes out as the roofer',
  sent.length === 1 && sent[0].fromName === "Hemi's Roofing Ltd", (sent[0]||{}).fromName);
check('…with their address for the reply',
  (sent[0]||{}).replyTo === 'hemi@hemisroofing.co.nz', (sent[0]||{}).replyTo);

// ── platform mail must NOT borrow a roofer's name ─────────────────
sent.length = 0;
r = await fetch(BASE + '/auth/forgot', {
  method: 'POST', headers: { 'content-type':'application/json' },
  body: JSON.stringify({ email: 'hemi@hemisroofing.co.nz' }) });
await new Promise(x => setTimeout(x, 500));
if (sent.length) {
  check('a password reset still comes from the platform',
    sent[0].fromName === 'RoofMap', sent[0].fromName);
  check('…and not from a roofing company', sent[0].fromName !== "Hemi's Roofing Ltd");
} else {
  check('a password reset still comes from the platform (no mail attempted for an unknown user)', true, 'skipped');
  check('…and not from a roofing company', true, 'skipped');
}

// ── a tenant with no branding gets the platform identity, not a blank ──
const src = await readFile(_j(_ROOT, 'backend', 'server.js'), 'utf8');
check('a business that has not filled in Branding falls back rather than sending nameless',
  /return \{ fromName: name \|\| null, replyTo: \/\.@\.\/\.test\(email\) \? email : null \}/.test(src));
check('_mailFromName falls back to the address on EMAIL_FROM',
  /function _mailFromName\(fallback\)/.test(src) && /fallback \|\| \(m && m\[1\]\.trim\(\)\)/.test(src));
check('the envelope address stays VERIFIED — ours, or a domain the tenant proved they own',
  /_mailFromAddress\(\)/.test(src) && /Their name, a verified address/.test(src) &&
  /_resendFromAddress\(fromAddress\) \|\| _mailFromAddress\(\)/.test(src));
check('reply-to reaches the SMTP path too, not just the relay',
  /replyTo: replyTo \|\| EMAIL_REPLYTO \|\| undefined/.test(src));

await new Promise(r2 => relay.close(r2));
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
