// The shared tenant subdomain: with TENANT_MAIL_DOMAIN=quotes.roofmap.co.nz
// (a subdomain WE own, verified once in Resend), every business — on every
// plan, with zero setup — sends as its own name on that subdomain:
// "Hemi's Roofing Ltd" <hemisroofing@quotes.roofmap.co.nz>. A company's OWN
// verified domain still beats it, a business with no branding name keeps the
// platform default, and nobody can claim the shared subdomain as theirs.
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

const CA = 'aaaaaaaa-1111-1111-1111-111111111111';   // Business, branded
const CS = 'ssssssss-1111-1111-1111-111111111111';   // Solo, branded
const CN = 'nnnnnnnn-1111-1111-1111-111111111111';   // no branding at all
const CB = 'bbbbbbbb-1111-1111-1111-111111111111';   // a name but NO reply-to email
const CO = 'oooooooo-1111-1111-1111-111111111111';   // own verified domain
const UA = 'aaaaaaaa-0000-0000-0000-000000000001';
const US = 'ssssssss-0000-0000-0000-000000000002';
const UN = 'nnnnnnnn-0000-0000-0000-000000000003';
const UB = 'bbbbbbbb-0000-0000-0000-000000000005';
const UO = 'oooooooo-0000-0000-0000-000000000004';

const resendSeen = [];
const resend = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    if (req.method === 'POST' && new URL(req.url, 'http://x').pathname === '/emails'){
      try { resendSeen.push(JSON.parse(b || '{}')); } catch (e) { resendSeen.push({}); }
      res.writeHead(200, {'content-type':'application/json'}); return res.end('{"id":"re_1"}');
    }
    res.writeHead(200, {'content-type':'application/json'}); res.end('{}');
  });
});
await new Promise(r => resend.listen(0, '127.0.0.1', r));

const inv = (id, co, user) => ({ id, company_id: co, user_id: user, job_id: 'j' + id,
  number: 'INV-' + id, type: 'deposit', status: 'draft', amount: 1000, gst: 150, total: 1150,
  gst_rate: 15, client_email: 'homeowner@example.com', site_address: '9 Roof Rd' });
const { port } = await startFakePostgrest({
  companies: [
    { id: CA, name: "Hemi's Roofing", plan: 'business' },
    { id: CS, name: 'Solo Roofing', plan: 'solo' },
    { id: CN, name: 'Nameless', plan: 'solo' },
    { id: CB, name: 'Bounce Roofing', plan: 'solo' },
    { id: CO, name: 'Own Roofing', plan: 'business' },
  ],
  company_users: [
    { company_id: CA, user_id: UA, role: 'owner' }, { company_id: CS, user_id: US, role: 'owner' },
    { company_id: CN, user_id: UN, role: 'owner' }, { company_id: CB, user_id: UB, role: 'owner' },
    { company_id: CO, user_id: UO, role: 'owner' },
  ],
  profiles: [
    { id: UA, company_id: CA, email: 'hemi@x.nz' }, { id: US, company_id: CS, email: 'sol@x.nz' },
    { id: UN, company_id: CN, email: 'nn@x.nz' },   { id: UB, company_id: CB, email: 'bb@x.nz' },
    { id: UO, company_id: CO, email: 'own@x.nz' },
  ],
  user_settings: [
    { user_id: UA, company_id: CA, branding: { company_name: "Hemi's Roofing Ltd", email: 'hemi@hemisroofing.co.nz' },
      quote_defaults: {}, updated_at: new Date().toISOString() },
    { user_id: US, company_id: CS, branding: { company_name: 'Solo Roofing', email: 'sol@example.com' },
      quote_defaults: {}, updated_at: new Date().toISOString() },
    { user_id: UB, company_id: CB, branding: { company_name: 'Bounce Roofing' },
      quote_defaults: {}, updated_at: new Date().toISOString() },
    { user_id: UO, company_id: CO, branding: { company_name: 'Own Roofing Ltd', email: 'own@ownroofing.co.nz' },
      quote_defaults: {}, updated_at: new Date().toISOString() },
  ],
  invoices: [inv('a1', CA, UA), inv('s1', CS, US), inv('n1', CN, UN), inv('b1', CB, UB), inv('o1', CO, UO)],
  jobs: [],
  company_mail_domains: [{ id: 'md1', company_id: CO, domain: 'ownroofing.co.nz',
    from_email: 'office@ownroofing.co.nz', resend_id: 'rdom-9', status: 'verified',
    created_at: new Date().toISOString(), verified_at: new Date().toISOString() }],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.RESEND_API_KEY = 're_test_sub';
process.env.RESEND_API_BASE = 'http://127.0.0.1:' + resend.address().port;
process.env.EMAIL_FROM = 'RoofMap <quotes@roofmap.co.nz>';
process.env.TENANT_MAIL_DOMAIN = 'quotes.roofmap.co.nz';
const PORT = process.env.TEST_PORT || '34635';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
delete process.env.GAS_MAIL_URL;
delete process.env.GAS_MAIL_TOKEN;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const tokFor = (uid, cid) => jwt.sign({ id: uid, email: uid + '@x.nz', cid }, 'test-secret', { expiresIn: '1h' });
const send = async (invId, uid, cid) => {
  resendSeen.length = 0;
  const r = await fetch(BASE + '/invoices/' + invId + '/send', {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tokFor(uid, cid) },
    body: '{}' });
  await new Promise(x => setTimeout(x, 300));
  const m = resendSeen[0] || {};
  return { status: r.status, from: m.from || '', reply: JSON.stringify(m.reply_to || []) };
};

// ── a branded business, zero setup, gets its name on the subdomain ─
let s = await send('a1', UA, CA);
check('the branded business sends as its own name on the shared subdomain',
  s.status < 400 && /<hemisroofing@quotes\.roofmap\.co\.nz>/.test(s.from), s.from);
check('…the mailbox name is the company name flattened — apostrophe and Ltd dropped',
  /hemisroofing@/.test(s.from) && !/ltd/.test(s.from.split('<')[1] || ''), s.from);
check('…still wearing the full business name for the customer', /Hemi's Roofing Ltd/.test(s.from), s.from);
check('…with replies pointed at the roofer', /hemi@hemisroofing\.co\.nz/.test(s.reply), s.reply);

// ── every plan — Solo gets exactly the same treatment ─────────────
s = await send('s1', US, CS);
check('a Solo business gets its subdomain address too — no plan gate on identity',
  /<soloroofing@quotes\.roofmap\.co\.nz>/.test(s.from), s.from);

// ── no branding name = platform default, not a junk address ───────
s = await send('n1', UN, CN);
check('a business with no branding keeps the platform identity untouched',
  s.from === 'RoofMap <quotes@roofmap.co.nz>', s.from);

// ── a name but no reply-to = the platform address, never a dead one ──
// The subdomain address is not a real mailbox. Without a Reply-To to catch
// a customer who writes to it directly, wearing it would bounce their reply
// into nowhere — so the business keeps the monitored platform address until
// it fills in its branding email.
s = await send('b1', UB, CB);
check('a business with a name but no reply-to email stays on the platform address',
  /"Bounce Roofing" <quotes@roofmap\.co\.nz>/.test(s.from) && !/bounceroofing@/.test(s.from), s.from);

// ── a company's OWN verified domain still beats the shared one ────
s = await send('o1', UO, CO);
check('a verified own domain outranks the shared subdomain',
  /<office@ownroofing\.co\.nz>/.test(s.from), s.from);

// ── the shared subdomain cannot be claimed as somebody's own ──────
const r = await fetch(BASE + '/email/domain', {
  method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tokFor(UA, CA) },
  body: JSON.stringify({ email: 'hemi@quotes.roofmap.co.nz' }) });
check('nobody can register the shared subdomain as their own domain', r.status === 400,
  String(r.status));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
