// The support desk (the owner, 2026-09-30): a question the Help bubble
// cannot answer can go to a real person, and "we need to build some sort of
// way that I can message back". Pinned here, against the fake PostgREST:
//   • a message is stored under the sender's company AND user, and support@
//     is emailed with Reply-To set to them (from the token, never the body);
//   • each person reads only their own conversation;
//   • the desk (/admin/support) answers the admin token or a platform owner's
//     login, and nobody else — not even a signed-in subscriber;
//   • a reply is stored for their Help bubble, emailed to them from the
//     platform's address, shows as unread until they open it, then read;
//   • the desk page is served and carries no data of its own.
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

const sent = [];
const relay = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => { try { sent.push(JSON.parse(body)); } catch (e) { sent.push({ raw: body }); } res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));

const CO = 'cccccccc-3333-3333-3333-333333333333', CO2 = 'dddddddd-3333-3333-3333-333333333333';
const U  = 'aaaaaaaa-3333-3333-3333-333333333333', U2 = 'bbbbbbbb-3333-3333-3333-333333333333';
const OWNER = 'eeeeeeee-3333-3333-3333-333333333333';
const { port, db } = await startFakePostgrest({
  __missing: [],
  companies: [{ id: CO, name: 'Hemi Roofing', plan: 'business' }, { id: CO2, name: 'Other Co', plan: 'business' }],
  company_users: [{ company_id: CO, user_id: U, role: 'owner' }, { company_id: CO2, user_id: U2, role: 'owner' }],
  profiles: [{ id: U, company_id: CO, email: 'sales@hemi.co.nz' }, { id: U2, company_id: CO2, email: 'me@other.co.nz' }],
  user_settings: [{ user_id: U, company_id: CO, updated_at: new Date().toISOString(), branding: { company_name: 'Hemi Roofing' }, quote_defaults: {} }],
  subscriptions: [{ user_id: U, company_id: CO, status: 'active', plan: 'business' }, { user_id: U2, company_id: CO2, status: 'active', plan: 'business' }],
  jobs: [], invoices: [], usage_events: [], company_invites: [], support_messages: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <noreply@roofmap.co.nz>';
process.env.ADMIN_TOKEN = 'admin-token-for-the-support-test-0123456789';
const PORT = process.env.TEST_PORT || '34671';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const TOK  = jwt.sign({ id: U,  email: 'sales@hemi.co.nz', cid: CO,  name: 'Hemi Walker' }, 'test-secret', { expiresIn: '1h' });
const TOK2 = jwt.sign({ id: U2, email: 'me@other.co.nz',  cid: CO2 }, 'test-secret', { expiresIn: '1h' });
const OWN  = jwt.sign({ id: OWNER, email: 'office@floodroofing.co.nz' }, 'test-secret', { expiresIn: '1h' });
const call = (method, path, body, hdrs) => fetch(BASE + path, { method,
  headers: Object.assign({ 'content-type': 'application/json' }, hdrs || {}), body: body ? JSON.stringify(body) : undefined });
const bearer = t => ({ Authorization: 'Bearer ' + t });
const ADMIN = { 'x-admin-token': process.env.ADMIN_TOKEN };
const settle = () => new Promise(r => setTimeout(r, 400));

// ── the subscriber asks ───────────────────────────────────────────
let r = await call('POST', '/support/messages', { body: '   ' }, bearer(TOK));
check('an empty message is refused', r.status === 400, String(r.status));
check('…and a message needs a login', (await call('POST', '/support/messages', { body: 'hi' })).status === 401);
sent.length = 0;
r = await call('POST', '/support/messages', { body: 'How do I add a skylight to the quote?', context: 'Quote tab', email: 'spoof@evil.test', transcript: 'They asked: skylight?\nAssistant: Try the Pricing tab.' }, bearer(TOK));
let j = await r.json();
check('a question is accepted', r.status === 200 && j.ok && j.message && j.message.sender === 'user', JSON.stringify(j));
const row = (db.support_messages || [])[0] || {};
check('…stored under their company AND user, with who they are from the token (not the body)',
  row.company_id === CO && row.user_id === U && row.email === 'sales@hemi.co.nz' && row.company === 'Hemi Roofing' && !row.read_at && row.id && row.created_at, JSON.stringify(row));
await settle();
const m1 = sent.find(x => /skylight/.test(JSON.stringify(x)));
check('…and support@ is emailed, Reply-To them, with the question and the desk link',
  !!m1 && /support@roofmap\.co\.nz/.test(JSON.stringify(m1.to || m1)) && /sales@hemi\.co\.nz/.test(JSON.stringify(m1.replyTo || m1.reply_to || m1)) &&
  /skylight/.test(m1.body || m1.text || '') && /admin\/support\/page/.test(m1.body || m1.text || '') && !/spoof@evil/.test(JSON.stringify(m1)), JSON.stringify(m1).slice(0, 300));
check('…with their chat with the assistant before it, for context', /Assistant: Try the Pricing tab/.test(m1.body || m1.text || ''), (m1 && (m1.text || '')).slice(0, 300));

r = await call('GET', '/support/messages', null, bearer(TOK)); j = await r.json();
check('they read their own conversation back', r.status === 200 && j.messages.length === 1 && j.unread === 0, JSON.stringify(j));
r = await call('GET', '/support/messages', null, bearer(TOK2)); j = await r.json();
check('…and another subscriber sees none of it', r.status === 200 && j.messages.length === 0, JSON.stringify(j));

// ── the desk ──────────────────────────────────────────────────────
check('the desk is hidden from the public', (await call('GET', '/admin/support')).status === 404);
check('…and from a signed-in subscriber', (await call('GET', '/admin/support', null, bearer(TOK))).status === 404);
r = await call('GET', '/admin/support', null, ADMIN); j = await r.json();
const conv = (j.conversations || [])[0] || {};
check('the admin token reads it: one conversation, waiting for an answer, named',
  r.status === 200 && j.waiting === 1 && conv.waiting && conv.user_id === U && conv.email === 'sales@hemi.co.nz' && conv.company === 'Hemi Roofing' && conv.messages.length === 1, JSON.stringify(j).slice(0, 300));
r = await call('GET', '/admin/support', null, bearer(OWN));
check('…so does the owner’s ordinary RoofMap login (for the phone)', r.status === 200);

check('a reply needs the desk’s gate too', (await call('POST', '/admin/support/reply', { user_id: U, body: 'x' }, bearer(TOK))).status === 404);
check('…and someone to reply to', (await call('POST', '/admin/support/reply', { user_id: U2, body: 'x' }, ADMIN)).status === 404);
sent.length = 0;
r = await call('POST', '/admin/support/reply', { user_id: U, body: 'Add it as a custom line on the Pricing tab — Materials, + Add custom line.' }, bearer(OWN));
j = await r.json();
check('the owner replies', r.status === 200 && j.ok && j.message.sender === 'support', JSON.stringify(j));
const rep = (db.support_messages || []).find(x => x.sender === 'support') || {};
check('…stored in THEIR conversation, under their company, unread', rep.user_id === U && rep.company_id === CO && !rep.read_at, JSON.stringify(rep));
await settle();
const m2 = sent.find(x => /custom line/.test(JSON.stringify(x)));
check('…and emailed to them — a reply they asked for always goes out — with the whole conversation in it',
  !!m2 && /sales@hemi\.co\.nz/.test(JSON.stringify(m2.to || m2)) && /Your conversation so far/.test(m2.body || m2.text || '') &&
  /You: How do I add a skylight/.test(m2.body || m2.text || '') && /RoofMap support: Add it as a custom line/.test(m2.body || m2.text || '') &&
  /Help bubble/.test(m2.body || m2.text || '') && /Your conversation/.test(m2.html || '') && j.emailed === true,
  JSON.stringify(m2 || {}).slice(0, 300));
r = await call('GET', '/admin/support', null, ADMIN); j = await r.json();
check('the conversation is no longer waiting', j.waiting === 0 && j.conversations[0].messages.length === 2, JSON.stringify(j).slice(0, 200));

// ── the answer reaches their bubble ───────────────────────────────
r = await call('GET', '/support/messages', null, bearer(TOK)); j = await r.json();
check('their bubble has the reply, unread', j.messages.length === 2 && j.unread === 1 && j.messages[1].sender === 'support' && /custom line/.test(j.messages[1].body), JSON.stringify(j));
r = await call('POST', '/support/messages/read', {}, bearer(TOK));
r = await call('GET', '/support/messages', null, bearer(TOK)); j = await r.json();
check('…opening it marks it read', j.unread === 0 && !!j.messages[1].read_at, JSON.stringify(j));
r = await call('GET', '/admin/support', null, ADMIN); j = await r.json();
check('…which the desk can see', !!j.conversations[0].messages[1].read_at);

// ── the page ──────────────────────────────────────────────────────
r = await fetch(BASE + '/admin/support/page'); const html = await r.text();
check('the desk page is served, with a sign-in, and no data in it',
  r.status === 200 && /Support desk/.test(html) && /auth\/login/.test(html) && !/skylight/.test(html) && /frame-ancestors 'none'/.test(r.headers.get('content-security-policy') || ''), String(r.status));

relay.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
