// WHAT ADDRESS A QUOTE LEAVES FROM (2026-10-21).
//
// The owner, with two emails side by side: quote 3320 on 18 Oct went out as
// `Flood Roofing <floodroofing@quotes.roofmap.co.nz>` and quote 3305 the next
// day went out as `RoofMap <support@roofmap.co.nz>`, with no commit between
// them touching that path. Both the NAME and the ADDRESS failed together,
// which is the signature of one thing: the settings read behind them.
//
// /email/send-order read `select('*')` on user_settings to find a company
// name — a row carrying the logo, the cover hero, the accreditation logos,
// every profile picture and the whole custom price book — and wrapped it in
// a catch that swallowed. A slow or failed read therefore sent the quote
// from the platform address with no business name and no reply-to, and said
// nothing. This suite is the tripwire for that, and for the office's own
// choice of mailbox on the shared subdomain.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// A Resend that takes everything and records the envelope.
const posted = [];
const resend = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    if (req.method === 'POST' && /\/emails/.test(req.url)){
      try { posted.push(JSON.parse(body)); } catch (e) { posted.push({ raw: body }); }
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"id":"re_1"}');
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}');
  });
});
await new Promise(r => resend.listen(0, '127.0.0.1', r));

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const { db, port } = await startFakePostgrest({
  companies: [ { id: 'c1', name: 'Flood Roofing Ltd', plan: 'team' },
               { id: 'c2', name: 'Kauri Roofing Ltd', plan: 'team' } ],
  profiles: [ { id: 'u1', company_id: 'c1', email: 'office@floodroofing.co.nz' },
              { id: 'u2', company_id: 'c2', email: 'office@kauri.nz' } ],
  company_users: [ { company_id: 'c1', user_id: 'u1', role: 'owner' },
                   { company_id: 'c2', user_id: 'u2', role: 'owner' } ],
  user_settings: [
    { user_id: 'u1', company_id: 'c1', updated_at: ago(1),
      branding: { company_name: 'Flood Roofing', email: 'office@floodroofing.co.nz', phone: '09 430 0000' },
      quote_defaults: { email: {} } },
    { user_id: 'u2', company_id: 'c2', updated_at: ago(1),
      branding: { company_name: 'Kauri Roofing Ltd', email: 'office@kauri.nz' },
      quote_defaults: { email: { sender_local: 'Kauri Roofing!!' } } },
  ],
  jobs: [], company_mail_domains: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.RESEND_API_KEY = 're_test_key';
process.env.RESEND_API_BASE = 'http://127.0.0.1:' + resend.address().port;
process.env.EMAIL_FROM = 'RoofMap <support@roofmap.co.nz>';
process.env.TENANT_MAIL_DOMAIN = 'quotes.roofmap.co.nz';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
const PORT = process.env.TEST_PORT || '34971';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
delete process.env.GAS_MAIL_URL;
const errs = [];
globalThis.__TEST_RECORD_ERROR = (kind, err) => errs.push(kind + ': ' + ((err && err.message) || err));
const log = console.log, warn = console.warn, err = console.error;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn; console.error = err;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const jwt = (await import('node:crypto')).default;
function token(uid, cid){
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ sub: uid, cid: cid, exp: Math.floor(Date.now()/1000) + 3600 });
  const s = jwt.createHmac('sha256', 'test-secret').update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + s;
}
const send = (uid, cid, body) => fetch(BASE + '/email/send-order', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token(uid, cid) },
  body: JSON.stringify(Object.assign({ to: 'customer@example.com', subject: 'Your roofing quote 3320', text: 'hi', kind: 'quote' }, body || {})) });
const get = (p, uid, cid) => fetch(BASE + p, { headers: { authorization: 'Bearer ' + token(uid, cid) } });
const settle = (ms) => new Promise(r => setTimeout(r, ms || 350));

// ── THE ASK: the business's own name, on the shared subdomain ──────
posted.length = 0;
let r = await send('u1', 'c1');
await settle();
check('the send is accepted', r.status === 200, 'status ' + r.status);
let m = posted[0] || {};
check('THE REGRESSION: a quote leaves as the BUSINESS, not as RoofMap',
  /^"Flood Roofing"/.test(m.from || ''), m.from);
check('…from its own mailbox on the shared subdomain, not the platform address',
  /<floodroofing@quotes\.roofmap\.co\.nz>$/.test(m.from || ''), m.from);
check('…with replies coming back to the roofer',
  (m.reply_to || []).join(',') === 'office@floodroofing.co.nz', JSON.stringify(m.reply_to));
check('…and nothing was reported about the identity, because nothing went wrong',
  !errs.some(e => /mail-identity/.test(e)), errs.join(' | '));

// ── THE ASK: the office may name its own mailbox ───────────────────
posted.length = 0;
r = await send('u2', 'c2');
await settle();
m = posted[0] || {};
check('an office that typed its own mailbox name gets it',
  /<kauriroofing@quotes\.roofmap\.co\.nz>$/.test(m.from || ''), m.from);
check('…cleaned, never shortened — a typed name is taken literally',
  !/kauri@/.test(m.from || ''), m.from);

// A typed name is read literally where the DERIVED one drops the legal
// suffix: "Kauri Roofing Ltd" defaults to kauriroofing, but somebody who
// types kauriroofingltd means it.
db.user_settings[1].quote_defaults.email.sender_local = 'kauriroofingltd';
posted.length = 0;
await send('u2', 'c2'); await settle();
check('…and "ltd" typed on purpose survives, where the default drops it',
  /<kauriroofingltd@quotes\.roofmap\.co\.nz>$/.test((posted[0] || {}).from || ''), (posted[0] || {}).from);

// Blank is not empty: it is the business's own trading name.
db.user_settings[1].quote_defaults.email.sender_local = '   ';
posted.length = 0;
await send('u2', 'c2'); await settle();
check('a BLANK box is the business name, never an empty mailbox',
  /<kauriroofing@quotes\.roofmap\.co\.nz>$/.test((posted[0] || {}).from || ''), (posted[0] || {}).from);

// ── A READ THAT FAILS IS NEVER SILENT, AND NEVER NAMELESS ──────────
db.__fail500 = 'user_settings';
errs.length = 0; posted.length = 0;
r = await send('u1', 'c1');
await settle();
m = posted[0] || {};
check('a failed settings read still SENDS the quote — the office pressed Send',
  r.status === 200 && posted.length === 1, 'status ' + r.status + ' posted ' + posted.length);
check('THE FAULT: …wearing the company record’s name, not RoofMap’s',
  /^"Flood Roofing Ltd"/.test(m.from || ''), m.from);
check('…and it is REPORTED rather than swallowed',
  errs.some(e => /mail-identity/.test(e)), errs.join(' | ') || 'nothing reported');
delete db.__fail500;

// ── the office can read its own From line off the page ─────────────
r = await get('/email/domain', 'u1', 'c1');
const dom = await r.json();
check('Settings → Email is told the address its mail actually wears',
  dom.tenant && dom.tenant.address === 'floodroofing@quotes.roofmap.co.nz' &&
  dom.tenant.domain === 'quotes.roofmap.co.nz' && dom.tenant.derived === 'floodroofing',
  JSON.stringify(dom.tenant));
check('…and that an untouched box is showing a default, not a stored value',
  dom.tenant && dom.tenant.typed === '', JSON.stringify(dom.tenant && dom.tenant.typed));

// ── the narrowing itself: no pictures on the hot path ──────────────
const src = (await import('node:fs')).readFileSync(_j(_ROOT, 'backend', 'server.js'), 'utf8');
const route = src.slice(src.indexOf("app.post('/email/send-order'"), src.indexOf("app.post('/email/send-order'") + 4000);
check('the send route no longer drags the whole settings row across the wire',
  !/_companySettingsRow\(req\)/.test(route) && /_mailIdentityOf\(/.test(route),
  route.match(/_companySettingsRow\([^)]*\)/g) ? route.match(/_companySettingsRow\([^)]*\)/g).join(',') : 'narrow');
check('…and the columns it does read carry no picture',
  /branding->>company_name/.test(src) && !/_MAIL_ID_COLS[^;]*logo/.test(src), '');

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
