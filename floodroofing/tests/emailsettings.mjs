// SETTINGS → EMAIL, THE SERVER'S HALF (the owner, 2026-10-02):
//   "setup a quote accepted email that goes from the system to the customer
//    ... so that the customer can see confirmation of their accepted quote and
//    their selection, also add ... if they would like to make any last minute
//    change please ring the office (give business contact details) as an
//    email may not be seen in time"
//   "make sure the user ... gets to edit the templates of all different types
//    of emails and who receives a copy of each email and who the customer
//    replies go to" — and a master "copy of all sent RoofMap emails".
// Pinned against the real server on the fake PostgREST, with the mail relay
// captured:
//   • a customer's accept sends THEM a confirmation — once — with the total,
//     every selection (the office's own Paint Roof included), the link, the
//     ring-the-office line with the phone; from the business's name, replies
//     to the reply-to set, copied to that email's CC and the master copy;
//   • switched off, it is not sent;
//   • the office's acceptance email and the question email take the office's
//     wording, the master copy, and reply straight to the customer;
//   • the follow-up and a send from the app carry the master copy;
//   • the app's standard wording and the server's are the same words.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const sent = [];
const relay = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => { try { sent.push(JSON.parse(body)); } catch (e) { sent.push({ raw: body }); } res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const PAINT = { id: 'qxp', title: 'Paint Roof', custom: true, rows: [ { id: 'r1', name: 'Exclude', price: 0 }, { id: 'r2', name: 'Include', price: 3680 } ] };
const quote = (over) => Object.assign({
  ref: '3288', client: 'Miria Henry', email: 'miria@example.com', addr: '72 Fairlie Crescent, Opononi', validUntil: '30 days',
  proposalOptions: { steelGrade: 'maxam', steelThickness: '40', colour: 'Ironsand', extras: { qxp: 'r2' } },
  customExtras: [PAINT],
  share: { token: 'tok-a', status: 'sent', sentAt: ago(1), sentTo: 'miria@example.com', events: [],
           priced: { extras: { qxp: { title: 'Paint Roof', first: 'r1', rows: { r1: { name: 'Exclude', price: 0 }, r2: { name: 'Include', price: 3680 } } } } } },
}, over || {});
const job = (id, co, user, q) => ({ id, user_id: user, company_id: co, client_name: q.client, site_address: q.addr,
  created_at: ago(7), updated_at: ago(0), draw_state: { state: { quote: q }, form: {} } });

const { db, port } = await startFakePostgrest({
  companies: [ { id: 'c1', name: 'Kauri Roofing', plan: 'team' }, { id: 'c2', name: 'Quiet Co', plan: 'team' } ],
  profiles: [ { id: 'u1', company_id: 'c1', email: 'owner@kauri.nz' }, { id: 'u2', company_id: 'c2', email: 'owner@quiet.nz' } ],
  company_users: [ { company_id: 'c1', user_id: 'u1', role: 'owner' }, { company_id: 'c2', user_id: 'u2', role: 'owner' } ],
  user_settings: [
    { user_id: 'u1', company_id: 'c1', updated_at: ago(1),
      branding: { company_name: 'Kauri Roofing Ltd', email: 'office@kauri.nz', phone: '09 407 0000', address: '494C Kerikeri Road' },
      quote_defaults: { email: { copy_all: 'boss@kauri.nz', accept_to: 'office@kauri.nz', accept_cust_cc: 'sales@kauri.nz',
        reply_to: 'replies@kauri.nz', quote_cc: 'office@kauri.nz', reminder_enabled: true, reminder_days: 3,
        question_cc: 'ethan@kauri.nz', accept_office_subject: 'SOLD — {ref} — {client} — {total}' } } },
    { user_id: 'u2', company_id: 'c2', updated_at: ago(1),
      branding: { company_name: 'Quiet Co', email: 'office@quiet.nz', phone: '09 111 1111' },
      quote_defaults: { email: { accept_cust_on: false, accept_to: 'office@quiet.nz' } } },
  ],
  jobs: [
    job('j-a', 'c1', 'u1', quote()),
    job('j-off', 'c2', 'u2', quote({ ref: '4000', share: { token: 'tok-off', status: 'sent', sentAt: ago(1), sentTo: 'cust@quiet.example', events: [] } })),
    job('j-q', 'c1', 'u1', quote({ ref: '5000', client: 'Asker', email: 'asker@example.com', share: { token: 'tok-q', status: 'sent', sentAt: ago(1), sentTo: 'asker@example.com', events: [] } })),
    job('j-r', 'c1', 'u1', quote({ ref: '6000', client: 'Quiet One', email: 'quiet@example.com', share: { token: 'tok-r', status: 'sent', sentAt: ago(5), sentTo: 'quiet@example.com', events: [] } })),
  ],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <support@roofmap.co.nz>';
process.env.ADMIN_TOKEN = 'em-test-token';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
const PORT = process.env.TEST_PORT || '34963';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) });
const settle = (ms) => new Promise(r => setTimeout(r, ms || 600));
const to = (addr) => sent.filter(m => String(m.to || '').split(/,\s*/).includes(addr));

// ── the customer's confirmation ───────────────────────────────────
sent.length = 0;
let r = await post('/q/tok-a/event?job=j-a', { type: 'accepted', name: 'Miria Henry', total: 7044.45 });
await settle();
check('the accept is recorded', r.status === 200, 'status ' + r.status);
let m = to('miria@example.com')[0] || {};
check('the CUSTOMER gets a confirmation of their accepted quote', !!m.subject && /Quote accepted/.test(m.subject) && /3288/.test(m.subject), m.subject);
check('…with the accepted total and every selection, the office’s own Paint Roof included',
  /\$7,044\.45/.test(m.text || '') && /Steel grade: Colorsteel MAXAM/.test(m.text || '') && /Colour: Ironsand/.test(m.text || '') && /Paint Roof: Include/.test(m.text || ''), (m.text || '').slice(0, 600));
check('…the link back to their accepted quote', /\?q=tok-a/.test(m.text || '') && /View your accepted quote/.test(m.html || ''), '');
check('…and "Need a last-minute change? Please ring us on 09 407 0000" — in a box in the HTML',
  /Need a last-minute change\? Please ring us on 09 407 0000/.test(m.text || '') && /fff7d6/.test(m.html || ''), '');
check('…with the business’s contact details at the foot', /Kauri Roofing Ltd\n09 407 0000\noffice@kauri\.nz\n494C Kerikeri Road/.test(m.text || ''), '');
check('…from the business’s name, replies to the reply-to set in Settings → Email', /Kauri Roofing/.test(m.fromName || '') && m.replyTo === 'replies@kauri.nz', m.fromName + ' / ' + m.replyTo);
check('…copied to that email’s CC AND the master copy', /sales@kauri\.nz/.test(m.cc || '') && /boss@kauri\.nz/.test(m.cc || ''), m.cc);
r = await post('/q/tok-a/event?job=j-a', { type: 'accepted', name: 'Miria Henry', total: 7044.45 });
await settle();
check('a second accept does not send it again', to('miria@example.com').length === 1, String(to('miria@example.com').length));

// switched off
sent.length = 0;
await post('/q/tok-off/event?job=j-off', { type: 'accepted', name: 'Cust', total: 100 });
await settle();
check('switched off in Settings → Email, the customer gets no confirmation', to('cust@quiet.example').length === 0, JSON.stringify(sent.map(x => x.to)));

// ── the office's acceptance email ─────────────────────────────────
sent.length = 0;
r = await post('/q/tok-a/accept-email?job=j-a', {});
await settle();
m = to('office@kauri.nz')[0] || {};
check('the office acceptance email takes the office’s own subject (with the total)', m.subject === 'SOLD — 3288 — Miria Henry — $7,044.45', m.subject);
check('…lists the selections, Paint Roof included', /The customer's selections:/.test(m.text || '') && /Paint Roof: Include/.test(m.text || ''), (m.text || '').slice(0, 400));
check('…copied to the master copy, and a reply goes straight to the customer', /boss@kauri\.nz/.test(m.cc || '') && m.replyTo === 'miria@example.com', m.cc + ' / ' + m.replyTo);

// ── a question ───────────────────────────────────────────────────
sent.length = 0;
await post('/q/tok-q/event?job=j-q', { type: 'queried', message: 'Can you start before Christmas?' });
await settle();
m = to('office@kauri.nz')[0] || {};
check('a customer’s question reaches the office, copied to its CC and the master copy, replies to the customer',
  /Can you start before Christmas/.test(m.text || '') && /ethan@kauri\.nz/.test(m.cc || '') && /boss@kauri\.nz/.test(m.cc || '') && m.replyTo === 'asker@example.com', JSON.stringify({ cc: m.cc, rt: m.replyTo }));

// ── the follow-up carries the master copy and the reply-to ───────
sent.length = 0;
await fetch(BASE + '/admin/reminders/run', { method: 'POST', headers: { 'x-admin-token': 'em-test-token' } });
await settle();
m = to('quiet@example.com')[0] || {};
check('the quote follow-up is copied to the quote CC and the master copy, replies to the reply-to',
  /office@kauri\.nz/.test(m.cc || '') && /boss@kauri\.nz/.test(m.cc || '') && m.replyTo === 'replies@kauri.nz', JSON.stringify({ cc: m.cc, rt: m.replyTo }));

// ── the app's standard wording is the server's ───────────────────
const app = readFileSync(_j(_ROOT, 'frontend', 'app.html'), 'utf8');
const srv = readFileSync(_j(_ROOT, 'backend', 'server.js'), 'utf8');
const feDef = (k) => { const i = app.indexOf('var EMX_DEFAULTS = {'); const seg = app.slice(i, app.indexOf('};', i) + 2); const f = new Function(seg + '; return EMX_DEFAULTS;'); return f()[k]; };
const beDef = (name) => { const i = srv.indexOf('const ' + name + ' = {'); const seg = srv.slice(i, srv.indexOf('};', i) + 2).replace('const ' + name, 'var X'); return new Function(seg + '; return X;')(); };
const pairs = [['accept_cust', 'ACCEPT_CUST_EMAIL_DEFAULT'], ['accept_office', 'ACCEPT_OFFICE_EMAIL_DEFAULT'], ['question', 'QUESTION_EMAIL_DEFAULT'], ['invoice', 'INVOICE_EMAIL_DEFAULT'], ['reminder', 'REMINDER_EMAIL_DEFAULT']];
const diff = pairs.filter(([k, n]) => { const a = feDef(k), b = beDef(n); return !a || !b || a.subject !== b.subject || a.body !== b.body; }).map(p => p[0]);
check('the app’s standard wording and the server’s are the same words', diff.length === 0, diff.join(', '));

await new Promise(r2 => relay.close(r2));
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
