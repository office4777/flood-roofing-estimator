// Which of OUR mailboxes a message comes out of.
//
// Two different jobs were being done by one anonymous address. A subscription
// invoice is the accounts desk writing to a customer; a bug report is the
// support desk being written TO. Sent from one shared noreply@, a subscriber
// who hits Reply on their invoice reaches nobody, and a support reply arrives
// from the wrong mailbox.
//
// The other half is the reply path on feedback: support has to be able to hit
// Reply and land with the person who pressed the button — which means the
// signed-in user's address, taken from the token, never from the request body.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import crypto from 'node:crypto';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Stand in for the Google Apps Script relay and keep what it was handed.
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

const CO = 'cccccccc-2222-2222-2222-222222222222';
const U  = 'uuuuuuuu-2222-2222-2222-222222222222';
const USER_EMAIL = 'hemi@hemisroofing.co.nz';
const { port } = await startFakePostgrest({
  __missing: [],
  companies: [{ id: CO, name: "Hemi's Roofing Ltd", plan: 'business' }],
  company_users: [{ company_id: CO, user_id: U, role: 'owner' }],
  profiles: [{ id: U, company_id: CO, email: USER_EMAIL }],
  user_settings: [{ user_id: U, company_id: CO, updated_at: new Date().toISOString(),
                    branding: { company_name: "Hemi's Roofing Ltd", email: 'office@hemisroofing.co.nz' },
                    quote_defaults: {} }],
  subscriptions: [{ user_id: U, company_id: CO, status: 'active', plan: 'business' }],
  jobs: [], invoices: [], usage_events: [], company_invites: [],
});
const WH_SECRET = 'whsec_platformmail';
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.GAS_MAIL_URL = RELAY;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <noreply@roofmap.co.nz>';
process.env.STRIPE_WEBHOOK_SECRET = WH_SECRET;
process.env.STRIPE_SECRET_KEY = 'sk_test_platformmail';
const PORT = process.env.TEST_PORT || '34611';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const TOK = jwt.sign({ id: U, email: USER_EMAIL, cid: CO }, 'test-secret', { expiresIn: '1h' });
const post = (path, body, tok, hdrs) => fetch(BASE + path, { method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}, hdrs || {}),
  body: typeof body === 'string' ? body : JSON.stringify(body) });
const settle = () => new Promise(r => setTimeout(r, 400));

// ── a bug report ──────────────────────────────────────────────────
sent.length = 0;
let r = await post('/feedback', { kind: 'feedback', title: 'Sheet run measures to the wrong gutter',
  text: 'The 10.24m run should be 3.73m', html: '<p>x</p>' }, TOK);
await settle();
check('the feedback actually sent', r.status < 400 && sent.length === 1, 'status ' + r.status + ', ' + sent.length + ' mail');
const fb = sent[0] || {};
check('it goes to the support desk', fb.to === 'support@roofmap.co.nz', fb.to);
check('…out of the support mailbox, not a shared noreply', fb.from === 'support@roofmap.co.nz', fb.from);
check('…with the reply pointed at the person who reported it',
  fb.replyTo === USER_EMAIL, fb.replyTo);
check('…and NOT at the company branding address, which is who the tenant emails as',
  fb.replyTo !== 'office@hemisroofing.co.nz', fb.replyTo);
check('…named so support can see who it is from at a glance',
  /Hemi's Roofing Ltd/.test(String(fb.fromName || '')) && /hemi@hemisroofing/.test(String(fb.fromName || '')), fb.fromName);
check('…under a subject that says what it is',
  fb.subject === 'RoofMap Feedback: Sheet run measures to the wrong gutter', fb.subject);

// ── the reply-to is the SESSION's, not the caller's ───────────────
sent.length = 0;
r = await post('/feedback', { title: 'spoof attempt', text: 'x',
  to: 'attacker@evil.example', replyTo: 'attacker@evil.example',
  fromAddress: 'accounts@roofmap.co.nz' }, TOK);
await settle();
const sp = sent[0] || {};
check('a caller cannot redirect where feedback lands', sp.to === 'support@roofmap.co.nz', sp.to);
check('…nor choose the address the reply goes to', sp.replyTo === USER_EMAIL, sp.replyTo);
check('…nor send it as the accounts desk', sp.from === 'support@roofmap.co.nz', sp.from);

// ── the integration request rides the same pipe ───────────────────
sent.length = 0;
r = await post('/feedback', { kind: 'jms', title: 'Tradify', text: 'We run on Tradify' }, TOK);
await settle();
check('an integration request also reaches support',
  (sent[0]||{}).to === 'support@roofmap.co.nz' && /JMS request: Tradify/.test((sent[0]||{}).subject || ''),
  (sent[0]||{}).subject);

// ── it needs an account ───────────────────────────────────────────
sent.length = 0;
r = await post('/feedback', { title: 'anon', text: 'x' }, null);
await settle();
check('feedback needs a signed-in account', r.status === 401 && sent.length === 0, r.status + '');
r = await post('/feedback', { text: 'no title' }, TOK);
check('…and a title', r.status === 400, r.status + '');

// ── tenant mail is untouched: still the verified envelope ─────────
sent.length = 0;
r = await post('/email/send-order', { to: 'supplier@example.com', subject: 'Material order', text: 'Please supply' }, TOK);
await settle();
check("a roofer's own order still goes out under their name",
  (sent[0]||{}).fromName === "Hemi's Roofing Ltd", (sent[0]||{}).fromName);
check('…from the verified envelope address, NOT a platform mailbox',
  (sent[0]||{}).from === undefined, JSON.stringify((sent[0]||{}).from));

// ── the subscription invoice ──────────────────────────────────────
const sign = (payload) => {
  const t = Math.floor(Date.now() / 1000);
  return 't=' + t + ',v1=' + crypto.createHmac('sha256', WH_SECRET).update(t + '.' + payload).digest('hex');
};
const INV = {
  id: 'in_test_1', number: 'ROOFMAP-0007', customer_email: 'owner@hemisroofing.co.nz',
  amount_paid: 14900, currency: 'nzd', hosted_invoice_url: 'https://invoice.stripe.com/i/x',
  status_transitions: { paid_at: Math.floor(Date.parse('2026-08-01T00:00:00Z') / 1000) },
  lines: { data: [{ description: 'RoofMap Business — monthly',
                    period: { start: Math.floor(Date.parse('2026-08-01T00:00:00Z')/1000),
                              end: Math.floor(Date.parse('2026-09-01T00:00:00Z')/1000) } }] },
};
sent.length = 0;
let payload = JSON.stringify({ id: 'evt_1', type: 'invoice.payment_succeeded', data: { object: INV } });
r = await post('/billing/webhook', payload, null, { 'stripe-signature': sign(payload) });
await settle();
check('a paid subscription raises a RoofMap invoice email', r.status === 200 && sent.length === 1,
  'status ' + r.status + ', ' + sent.length + ' mail');
const si = sent[0] || {};
check('it comes from the accounts desk', si.from === 'accounts@roofmap.co.nz', si.from);
check('…with accounts named on it', si.fromName === 'RoofMap Accounts', si.fromName);
check('…and replies about the bill land there too', si.replyTo === 'accounts@roofmap.co.nz', si.replyTo);
check('…addressed to the subscriber who paid', si.to === 'owner@hemisroofing.co.nz', si.to);
check('…carrying the invoice number and the amount',
  /ROOFMAP-0007/.test(si.subject || '') && /\$149\.00/.test(si.subject || ''), si.subject);
check('…broken out as a NZ tax invoice, GST inclusive',
  /\$129\.57/.test(si.text || '') && /\$19\.43/.test(si.text || '') && /GST \(15%\)/.test(si.text || ''),
  String(si.text || '').split('\n').filter(l => /GST|Subtotal|Total/.test(l)).join(' | '));
check('…and names the period being billed',
  /1\/08\/2026\s*–\s*1\/09\/2026/.test(si.text || ''), String(si.text||'').split('\n').find(l => /Period/.test(l)));

// ── Stripe fires the same payment as two events ───────────────────
sent.length = 0;
payload = JSON.stringify({ id: 'evt_2', type: 'invoice.paid', data: { object: INV } });
r = await post('/billing/webhook', payload, null, { 'stripe-signature': sign(payload) });
await settle();
check('the same payment does not invoice the customer twice', sent.length === 0, sent.length + ' mail');

// ── a declined card ───────────────────────────────────────────────
sent.length = 0;
const FAILED = Object.assign({}, INV, { id: 'in_test_2', attempt_count: 1,
  next_payment_attempt: Math.floor(Date.parse('2026-08-05T00:00:00Z') / 1000) });
payload = JSON.stringify({ id: 'evt_3', type: 'invoice.payment_failed', data: { object: FAILED } });
r = await post('/billing/webhook', payload, null, { 'stripe-signature': sign(payload) });
await settle();
const sf = sent[0] || {};
check('a declined payment is told to the subscriber', sent.length === 1 && /declined/i.test(sf.subject || ''), sf.subject);
check('…from the same accounts desk', sf.from === 'accounts@roofmap.co.nz', sf.from);
check('…naming when the card will be tried again', /5\/08\/2026/.test(sf.text || ''), String(sf.text||'').slice(0,160));

// ── an invoice with no email on it must not crash the webhook ─────
sent.length = 0;
payload = JSON.stringify({ id: 'evt_4', type: 'invoice.payment_succeeded',
  data: { object: Object.assign({}, INV, { id: 'in_test_3', customer_email: '' }) } });
r = await post('/billing/webhook', payload, null, { 'stripe-signature': sign(payload) });
await settle();
check('an invoice with no email is skipped, not a 500', r.status === 200 && sent.length === 0, r.status + '');

// ── we never send as a domain we do not own ───────────────────────
const src = await readFile(_j(_ROOT, 'backend', 'server.js'), 'utf8');
check('a From address is only honoured on our own sending domain',
  /function _allowedFromAddress\(addr\)/.test(src) && /a\.endsWith\('@' \+ dom\)/.test(src));
check('…and every transport goes through that check',
  (src.match(/_allowedFromAddress\(fromAddress\)/g) || []).length >= 3);

await new Promise(r2 => relay.close(r2));
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
