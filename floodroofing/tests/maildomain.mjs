// A business sending its quotes from its OWN address, end to end: the owner
// types office@theircompany.co.nz, we register the domain with Resend, they
// add the DNS records, and once verified their mail's From line genuinely
// carries their address — DKIM-signed by their own domain. Business plan.
// What this cannot prove is that Resend's REAL responses match the shapes
// stubbed here.
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

const CB = 'bbbbbbbb-1111-1111-1111-111111111111';   // Business plan
const CS = 'ssssssss-1111-1111-1111-111111111111';   // Solo plan
const CT = 'tttttttt-1111-1111-1111-111111111111';   // no plan row content → trial
const OWNER = 'oooooooo-0000-0000-0000-000000000001';
const MEMBER = 'mmmmmmmm-0000-0000-0000-000000000002';
const SOLO = 'ssssssss-0000-0000-0000-000000000003';
const TRIAL = 'tttttttt-0000-0000-0000-000000000004';

// ── stand-in Resend: domains AND sends on one server ──────────────
const RECORDS = (d) => ([
  { record: 'SPF', name: 'send.' + d, type: 'MX', ttl: 'Auto', status: 'not_started',
    value: 'feedback-smtp.ap-northeast-1.amazonses.com', priority: 10 },
  { record: 'SPF', name: 'send.' + d, type: 'TXT', ttl: 'Auto', status: 'not_started',
    value: 'v=spf1 include:amazonses.com ~all' },
  { record: 'DKIM', name: 'resend._domainkey.' + d, type: 'TXT', ttl: 'Auto', status: 'not_started',
    value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7' },
]);
const resend = { domains: new Map(), verifies: [], deletes: [], emails: [], restricted: false, status: 'not_started', n: 0 };
const rsrv = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const j = (code, x) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(x)); };
    let m;
    if (req.method === 'POST' && u.pathname === '/emails'){
      resend.emails.push({ auth: req.headers.authorization, body: JSON.parse(body || '{}') });
      return j(200, { id: 're_msg_' + resend.emails.length });
    }
    // Every domain-management call under a sending-only key answers the same way.
    if (resend.restricted) return j(401, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails' });
    if (req.method === 'POST' && u.pathname === '/domains'){
      const name = JSON.parse(body || '{}').name;
      const id = 'rdom-' + (++resend.n);
      resend.domains.set(id, name);
      return j(201, { object: 'domain', id, name, status: 'not_started', records: RECORDS(name) });
    }
    if (req.method === 'POST' && (m = u.pathname.match(/^\/domains\/([^/]+)\/verify$/))){
      resend.verifies.push(m[1]); return j(200, { object: 'domain', id: m[1] });
    }
    if (req.method === 'GET' && (m = u.pathname.match(/^\/domains\/([^/]+)$/))){
      const name = resend.domains.get(m[1]);
      if (!name) return j(404, { name: 'not_found', message: 'Domain not found' });
      return j(200, { object: 'domain', id: m[1], name, status: resend.status,
        records: RECORDS(name).map(r => Object.assign({}, r, { status: resend.status === 'verified' ? 'verified' : 'not_started' })) });
    }
    if (req.method === 'DELETE' && (m = u.pathname.match(/^\/domains\/([^/]+)$/))){
      resend.deletes.push(m[1]); resend.domains.delete(m[1]);
      return j(200, { object: 'domain', id: m[1], deleted: true });
    }
    j(404, { name: 'not_found', message: 'no stub for ' + req.method + ' ' + u.pathname });
  });
});
await new Promise(r => rsrv.listen(0, '127.0.0.1', r));

const db = {
  companies: [
    { id: CB, name: "Hemi's Roofing", plan: 'business' },
    { id: CS, name: 'Solo Roofing', plan: 'solo' },
    { id: CT, name: 'Trial Roofing' },
  ],
  company_users: [
    { company_id: CB, user_id: OWNER, role: 'owner' },
    { company_id: CB, user_id: MEMBER, role: 'member' },
    { company_id: CS, user_id: SOLO, role: 'owner' },
    { company_id: CT, user_id: TRIAL, role: 'owner' },
  ],
  profiles: [
    { id: OWNER, company_id: CB, name: 'Hemi', email: 'hemi@hemisroofing.co.nz' },
    { id: MEMBER, company_id: CB, name: 'Sue', email: 'sue@hemisroofing.co.nz' },
    { id: SOLO, company_id: CS, name: 'Sol', email: 'sol@example.com' },
    { id: TRIAL, company_id: CT, name: 'Trev', email: 'trev@example.com' },
  ],
  user_settings: [{ user_id: OWNER, company_id: CB,
    branding: { company_name: "Hemi's Roofing Ltd", email: 'hemi@hemisroofing.co.nz' },
    quote_defaults: {}, updated_at: new Date().toISOString() }],
  invoices: [{ id: 'inv1', company_id: CB, user_id: OWNER, job_id: 'j1',
    number: 'INV-0001', type: 'deposit', status: 'draft', amount: 1000, gst: 150, total: 1150,
    gst_rate: 15, client_email: 'homeowner@example.com', site_address: '9 Roof Rd' }],
  jobs: [{ id: 'j1', user_id: OWNER, company_id: CB, client_name: 'A Homeowner',
    site_address: '9 Roof Rd', draw_state: { state: { quote: {} } } }],
  company_mail_domains: [],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.RESEND_API_KEY = 're_test_dom';
process.env.RESEND_API_BASE = 'http://127.0.0.1:' + rsrv.address().port;
process.env.EMAIL_FROM = 'RoofMap <quotes@roofmap.co.nz>';
const PORT = process.env.TEST_PORT || '34634';
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
const api = async (method, path, body, uid, cid) => {
  const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokFor(uid, cid) };
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const sendInvoice = async () => {
  resend.emails.length = 0;
  const r = await api('POST', '/invoices/inv1/send', {}, OWNER, CB);
  await new Promise(x => setTimeout(x, 300));
  return { status: r.status, from: ((resend.emails[0] || {}).body || {}).from || '' };
};

// ── who may even start ────────────────────────────────────────────
let r = await api('GET', '/email/domain', null, OWNER, CB);
check('Business is told the feature is open to it',
  r.body && r.body.enabled === true && r.body.allowed === true && r.body.domain === null, JSON.stringify(r.body));
r = await api('GET', '/email/domain', null, SOLO, CS);
check('Solo is told it is not on its plan', r.body && r.body.enabled === true && r.body.allowed === false,
  JSON.stringify(r.body));
r = await api('POST', '/email/domain', { email: 'sol@soloroofing.co.nz' }, SOLO, CS);
check('…and a Solo attempt is refused with the plan code',
  r.status === 403 && r.body.code === 'PLAN_LIMIT' && /Business/.test(r.body.error || ''), JSON.stringify(r.body));
r = await api('POST', '/email/domain', { email: 'sue@hemisroofing.co.nz' }, MEMBER, CB);
check('a member cannot set up the sending domain', r.status === 403, String(r.status));

// ── addresses that can never verify are refused up front ──────────
r = await api('POST', '/email/domain', { email: 'not-an-email' }, OWNER, CB);
check('a non-address is refused', r.status === 400, JSON.stringify(r.body));
r = await api('POST', '/email/domain', { email: 'hemi@gmail.com' }, OWNER, CB);
check('a gmail.com mailbox is refused with an explanation, not DNS records',
  r.status === 400 && /gmail\.com/.test(r.body.error || ''), JSON.stringify(r.body));
r = await api('POST', '/email/domain', { email: 'hemi@roofmap.co.nz' }, OWNER, CB);
check('the platform\'s own domain is refused', r.status === 400, JSON.stringify(r.body));

// ── the real thing ────────────────────────────────────────────────
r = await api('POST', '/email/domain', { email: 'Office@HemisRoofing.co.nz' }, OWNER, CB);
check('the owner sets it up, however the address was typed',
  r.status === 200 && r.body.domain && r.body.domain.domain === 'hemisroofing.co.nz' &&
  r.body.domain.from_email === 'office@hemisroofing.co.nz', JSON.stringify(r.body));
check('…the domain was registered with Resend under our key',
  Array.from(resend.domains.values()).includes('hemisroofing.co.nz'), JSON.stringify([...resend.domains]));
check('…it starts pending, with Resend\'s DNS records passed through verbatim',
  r.body.domain.status === 'pending' && (r.body.domain.records || []).length === 3 &&
  /resend\._domainkey\.hemisroofing\.co\.nz/.test(JSON.stringify(r.body.domain.records)),
  JSON.stringify((r.body.domain.records || []).length));
const rdomId = resend.n ? 'rdom-' + resend.n : '';

r = await api('POST', '/email/domain', { email: 'office@hemisroofing.co.nz' }, OWNER, CB);
check('adding it twice is refused', r.status === 400, JSON.stringify(r.body));
r = await api('POST', '/email/domain', { email: 'boss@adifferentdomain.co.nz' }, OWNER, CB);
check('a second domain for the same business is refused', r.status === 400, JSON.stringify(r.body));
r = await api('POST', '/email/domain', { email: 'trev@hemisroofing.co.nz' }, TRIAL, CT);
check('a domain another business already claimed is refused', r.status === 409, JSON.stringify(r.body));

// ── an UNVERIFIED domain must never reach a From line ─────────────
let s = await sendInvoice();
check('before verification the invoice still sends from the platform address',
  s.status < 400 && /quotes@roofmap\.co\.nz/.test(s.from) && !/hemisroofing/.test(s.from.split('<')[1] || ''), s.from);

// ── verification ──────────────────────────────────────────────────
r = await api('POST', '/email/domain/verify', null, MEMBER, CB);
check('a member cannot trigger verification', r.status === 403, String(r.status));
r = await api('POST', '/email/domain/verify', null, OWNER, CB);
check('checking before the DNS exists reports it is not ready',
  r.status === 200 && r.body.domain.status === 'pending' && /aren.t all visible|24 hours/i.test(r.body.domain.error || ''),
  JSON.stringify(r.body));
check('…and Resend was actually asked to re-check', resend.verifies.includes(rdomId), JSON.stringify(resend.verifies));
resend.status = 'verified';
r = await api('POST', '/email/domain/verify', null, OWNER, CB);
check('once the records are in place it verifies',
  r.body.domain.status === 'verified' && !!r.body.domain.verified_at, JSON.stringify(r.body.domain));

// ── and the mail now wears THEIR address ──────────────────────────
s = await sendInvoice();
check('the invoice now sends genuinely from the roofer\'s own address',
  /office@hemisroofing\.co\.nz/.test(s.from), s.from);
check('…still wearing the business name', /Hemi's Roofing/.test(s.from), s.from);

// ── removal puts everything back ──────────────────────────────────
r = await api('DELETE', '/email/domain', null, MEMBER, CB);
check('a member cannot remove it', r.status === 403, String(r.status));
r = await api('DELETE', '/email/domain', null, OWNER, CB);
check('the owner can remove it', r.status === 200, JSON.stringify(r.body));
check('…and it is removed from Resend too, not just from us', resend.deletes.includes(rdomId),
  JSON.stringify(resend.deletes));
s = await sendInvoice();
check('after removal the mail is back on the platform address',
  /quotes@roofmap\.co\.nz/.test(s.from) && !/hemisroofing/.test(s.from.split('<')[1] || ''), s.from);

// ── a sending-only key names the real fix ─────────────────────────
resend.restricted = true;
r = await api('POST', '/email/domain', { email: 'office@hemisroofing.co.nz' }, OWNER, CB);
check('a key without domain access answers 503 naming the fix, not a cryptic 401',
  r.status === 503 && /Full access/.test(r.body.error || ''), JSON.stringify(r.body));
resend.restricted = false;

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
