// TERMS OF TRADE (the owner, 2026-10-06): "build a Terms of Trade function in
// Roofmap settings that the user can upload their own terms of trade pdf file
// that gets attached to all quotes sent ... and select whether or not they
// want to add it automatically to quotes being sent, also add it in the email
// settings as a toggle on or off to attch to various emails".
//
// Pinned against the real server on the fake PostgREST, with the mail relay
// captured:
//   • only a PDF goes in, checked on the BYTES not the file name, and 8MB is
//     the ceiling;
//   • the settings read gives the name and size and never the file itself —
//     the whole reason it is not kept on the settings row;
//   • a quote email carries it only when that email's switch is on;
//   • the tick in the send window wins over the saved default, both ways;
//   • the practice job never sends it to anybody;
//   • a second attachment does not displace the first — the quote PDF and the
//     terms both go, under their own names;
//   • removing it leaves the switches harmless rather than sending nothing.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import { createRequire } from 'node:module';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
// jsonwebtoken lives with the backend, not with the suites.
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwtLib = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const sent = [];
const relay = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => { try { sent.push(JSON.parse(body)); } catch (e) { sent.push({ raw: body }); }
    res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
const NOT_PDF = Buffer.from('PK\u0003\u0004 this is a word document, renamed', 'latin1');

const { db, port } = await startFakePostgrest({
  companies: [{ id: 'c1', name: 'Kauri Roofing', plan: 'team' }],
  profiles: [{ id: 'u1', company_id: 'c1', email: 'owner@kauri.nz' }],
  company_users: [{ company_id: 'c1', user_id: 'u1', role: 'owner' }],
  user_settings: [{ user_id: 'u1', company_id: 'c1', updated_at: ago(1),
    branding: { company_name: 'Kauri Roofing Ltd', email: 'office@kauri.nz' },
    quote_defaults: { email: {} } }],
  company_terms: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <support@roofmap.co.nz>';
process.env.ADMIN_TOKEN = 'tot-test-token';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
const PORT = process.env.TEST_PORT || '34971';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const T = jwtLib.sign({ id: 'u1', email: 'owner@kauri.nz', cid: 'c1' }, 'test-secret', { expiresIn: '1h' });
const call = async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m,
    headers: Object.assign({ Authorization: 'Bearer ' + T }, b ? { 'content-type': 'application/json' } : {}),
    body: b ? JSON.stringify(b) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: /json/.test(ct) ? await r.json().catch(() => ({})) : await r.text() };
};
const settle = (ms) => new Promise(r => setTimeout(r, ms || 400));
// The switches live on the settings row, where the Email screen writes them.
const setFlag = (k, on) => {
  const row = db.user_settings[0];
  const em = row.quote_defaults.email;
  if (on) em[k + '_terms'] = true; else delete em[k + '_terms'];
};
const sendQuote = async (extra) => {
  sent.length = 0;
  const r = await call('POST', '/email/send-order', Object.assign(
    { to: 'customer@example.com', subject: 'Your quote', text: 'Here it is', kind: 'quote' }, extra || {}));
  await settle();
  return r;
};
const files = () => {
  const m = sent[0] || {};
  return [].concat(m.attachments || (m.attachment ? [m.attachment] : [])).map(a => a.filename);
};

// ── what may be uploaded ──────────────────────────────────────────
let r = await call('PUT', '/settings/terms', { filename: 'terms.pdf', base64: NOT_PDF.toString('base64') });
check('a file that is not a PDF is refused however it is named',
  r.status === 400 && /not a PDF/i.test(r.body.error || ''), r.status + ' ' + (r.body.error || ''));

r = await call('PUT', '/settings/terms', { filename: 'huge.pdf',
  base64: Buffer.concat([PDF, Buffer.alloc(9 * 1024 * 1024, 0x20)]).toString('base64') });
check('…and one over 8MB is refused with its size named',
  r.status === 413 && /8MB/.test(r.body.error || ''), r.status + ' ' + (r.body.error || ''));

r = await call('PUT', '/settings/terms', { filename: '../../Terms of Trade<>.pdf', base64: PDF.toString('base64') });
check('a real PDF is accepted, and its name is cleaned up',
  r.status === 200 && r.body.terms && !/[<>/]/.test(r.body.terms.filename) && /\.pdf$/i.test(r.body.terms.filename),
  JSON.stringify(r.body.terms));
const STORED = r.body.terms.filename;

r = await call('GET', '/settings/terms');
check('the settings read gives the name and size and NOT the file',
  r.status === 200 && r.body.terms && r.body.terms.bytes === PDF.length && !('data' in r.body.terms),
  JSON.stringify(r.body.terms));

r = await call('GET', '/settings/terms/file');
check('…and the file itself comes back as a PDF when asked for',
  r.status === 200 && String(r.body).slice(0, 5) === '%PDF-', r.status + ' ' + String(r.body).slice(0, 8));

// ── which emails carry it ─────────────────────────────────────────
setFlag('quote', false);
await sendQuote();
check('a quote goes without the terms while that switch is off', files().length === 0, JSON.stringify(files()));

setFlag('quote', true);
await sendQuote();
check('…and carries them once it is on', files().includes(STORED), JSON.stringify(files()));

// The tick in the send window is the office's last word, both ways.
await sendQuote({ attachTerms: false });
check('the send window’s tick can leave them off for one quote', files().length === 0, JSON.stringify(files()));

setFlag('quote', false);
await sendQuote({ attachTerms: true });
check('…and can put them on one quote when the default is off', files().includes(STORED), JSON.stringify(files()));

// An order is a different email with its own switch — the whole point of
// setting them per email rather than once.
setFlag('quote', true);
sent.length = 0;
await call('POST', '/email/send-order', { to: 'merchant@example.com', subject: 'Order', text: 'x', kind: 'order' });
await settle();
check('a material order does not carry them just because quotes do', files().length === 0, JSON.stringify(files()));
setFlag('order', true);
sent.length = 0;
await call('POST', '/email/send-order', { to: 'merchant@example.com', subject: 'Order', text: 'x', kind: 'order' });
await settle();
check('…and does once the order switch is on too', files().includes(STORED), JSON.stringify(files()));

// ── the quote PDF and the terms are two files, not one ────────────
setFlag('quote', true);
sent.length = 0;
await call('POST', '/email/send-order', { to: 'customer@example.com', subject: 'Your quote', text: 'x', kind: 'quote',
  attachment: { base64: PDF.toString('base64'), filename: 'Quote 3301.pdf' } });
await settle();
const two = (sent[0] && sent[0].attachments) || [];
check('a quote PDF and the terms both go, each under its own name',
  two.length === 2 && two.some(a => /Quote 3301/.test(a.filename)) && two.some(a => a.filename === STORED),
  JSON.stringify(two.map(a => a.filename)));
check('…and the single-attachment relay still gets one, with the rest counted',
  sent[0] && sent[0].attachment && sent[0].attachmentsDropped === 1,
  JSON.stringify({ one: sent[0] && sent[0].attachment && sent[0].attachment.filename, dropped: sent[0] && sent[0].attachmentsDropped }));

// ── the practice job sends nobody anything ────────────────────────
sent.length = 0;
await call('POST', '/email/send-order', { to: 'owner@kauri.nz', subject: 'TEST', text: 'x', kind: 'quote', test: true });
await settle();
check('the practice job never attaches the terms', files().length === 0, JSON.stringify(files()));

// ── removing it ───────────────────────────────────────────────────
r = await call('DELETE', '/settings/terms');
check('the terms can be removed', r.status === 200, String(r.status));
r = await call('GET', '/settings/terms');
check('…and the settings read then says there are none', r.status === 200 && r.body.terms === null, JSON.stringify(r.body));
await sendQuote();
check('…and an email whose switch is still on simply goes without them',
  files().length === 0 && sent.length === 1, JSON.stringify({ files: files(), sent: sent.length }));

relay.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
