// The inbox backend: a company's real email, mirrored for the whole
// team. This suite holds the Business-tier gate, credential hygiene
// (verified before storing, encrypted at rest, never in a response),
// shared-vs-private account visibility, threading and dedupe, HTML
// sanitisation, reply/compose envelopes, and the tenancy walls.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const A  = { user: 'user-a',  company: 'company-a' };   // Business — owner
const A2 = { user: 'user-a2', company: 'company-a' };   // Business — teammate
const B  = { user: 'user-b',  company: 'company-b' };   // Business — the rival
const T  = { user: 'user-t',  company: 'company-t' };   // Team — priced out

const { port } = await startFakePostgrest({
  profiles: [{ id: A.user, company_id: A.company }, { id: A2.user, company_id: A.company },
             { id: B.user, company_id: B.company }, { id: T.user, company_id: T.company }],
  company_users: [{ company_id: A.company, user_id: A.user, role: 'owner' },
                  { company_id: A.company, user_id: A2.user, role: 'member' },
                  { company_id: B.company, user_id: B.user, role: 'owner' },
                  { company_id: T.company, user_id: T.user, role: 'owner' }],
  companies: [{ id: A.company, name: 'Flood Roofing', plan: 'business' },
              { id: B.company, name: 'Rival Roofing', plan: 'business' },
              { id: T.company, name: 'Small Roofing', plan: 'team' }],
  jobs: [{ id: 'job-x', user_id: A.user, company_id: A.company, client_name: 'Brian Lewis',
    site_address: '148 Horeke Road', draw_state: { state: { quote: { ref: 'FR-2996' } } } }],
  mail_accounts: [], mail_threads: [], mail_messages: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34761';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;

// The IMAP seam: a scriptable "mail server" and a JSON SMTP transport,
// so the suite can pin exactly what would have gone over the wire.
const FAKE = {
  inbox: [],
  async verify(conn, pass){ if (pass !== 'app-pass-123') throw new Error('IMAP LOGIN failed'); },
  async fetchNew(conn, pass, lastUid){
    const msgs = FAKE.inbox.filter(m => m.uid > (lastUid || 0));
    return { messages: msgs, lastUid: msgs.length ? Math.max(...msgs.map(m => m.uid)) : (lastUid || 0) };
  },
  async appendSent(){},
};
globalThis.__TEST_MAIL_FETCHER = FAKE;
globalThis.__TEST_MAIL_JSON = true;

// The AI seam: a scripted triage/draft "model", so the suite pins what the
// server DOES with the answers, not the answers themselves.
const AI = { calls: [] };
globalThis.__TEST_AI = async (opts) => {
  AI.calls.push(opts.model);
  if (/You triage/.test(opts.system || '')){
    if (/FR-2996/.test(opts.prompt)) return '{"category":"quote_reply","urgency":80,"job_ref":"FR-2996"}';
    if (/quote|leaks/i.test(opts.prompt)) return '{"category":"lead","urgency":92,"job_ref":""}';
    if (/Price list/i.test(opts.prompt)) return '{"category":"supplier","urgency":25,"job_ref":""}';
    return '{"category":"other","urgency":10,"job_ref":""}';
  }
  return 'Hi there,\n\nThanks for getting in touch — we can take a look this week.\n\nFlood Roofing';
};

const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const tok = w => jwt.sign({ id: w.user, email: w.user + '@x.co.nz', cid: w.company }, 'test-secret');
const as = (w, path, opts) => fetch(BASE + path, {
  ...(opts || {}),
  headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok(w), ...((opts || {}).headers || {}) },
});
const j = r => r.json();

// ── the tier gate ─────────────────────────────────────────────────
let r = await as(T, '/inbox/threads');
let body = await j(r);
check('a Team-plan business is told the inbox is Business tier',
  r.status === 402 || r.status === 403, 'status ' + r.status);
check('…and the refusal names Business', /Business/i.test(JSON.stringify(body)));

// ── connecting accounts ───────────────────────────────────────────
r = await as(A, '/inbox/accounts', { method: 'POST', body: JSON.stringify({
  email: 'office@floodroofing.co.nz', label: 'Flood Roofing office', provider: 'gmail',
  imap_host: 'imap.gmail.com', imap_port: 993, smtp_host: 'smtp.gmail.com', smtp_port: 465,
  password: 'WRONG', shared: true }) });
check('a bad app password is refused before anything is stored', r.status === 400,
  'status ' + r.status + ' ' + JSON.stringify(await j(r)).slice(0, 80));

r = await as(A, '/inbox/accounts', { method: 'POST', body: JSON.stringify({
  email: 'office@floodroofing.co.nz', label: 'Flood Roofing office', provider: 'gmail',
  imap_host: 'imap.gmail.com', imap_port: 993, smtp_host: 'smtp.gmail.com', smtp_port: 465,
  password: 'app-pass-123', shared: true }) });
const office = await j(r);
check('a verified account connects', r.status === 200 && office.id, JSON.stringify(office).slice(0, 90));
check('…and the password never comes back',
  !JSON.stringify(office).includes('app-pass') && office.cred_enc === undefined, Object.keys(office).join(','));

r = await as(A, '/inbox/accounts', { method: 'POST', body: JSON.stringify({
  email: 'aron@floodroofing.co.nz', label: 'Aron private', provider: 'gmail',
  imap_host: 'imap.gmail.com', imap_port: 993, smtp_host: 'smtp.gmail.com', smtp_port: 465,
  password: 'app-pass-123', shared: false }) });
const priv = await j(r);
check('a private account connects too', r.status === 200 && priv.id);

body = await j(await as(A, '/inbox/accounts'));
check('the connector sees both accounts', body.length === 2, body.length + ' accounts');
body = await j(await as(A2, '/inbox/accounts'));
check('a teammate sees only the shared office@ account',
  body.length === 1 && body[0].email === 'office@floodroofing.co.nz', body.length + ' accounts');
check('…with no credentials anywhere in the payload', !JSON.stringify(body).match(/cred_enc|app-pass/));

// ── sync, threading, dedupe, sanitisation ─────────────────────────
FAKE.inbox = [
  { uid: 11, msg_id: '<m1@lewis.nz>', in_reply_to: '', refs: '', from_addr: 'brian@lewis.co.nz',
    from_name: 'Brian Lewis', to_addrs: ['office@floodroofing.co.nz'], cc_addrs: [],
    subject: 'Re-roof quote for 148 Horeke Road', date: '2026-08-27T01:00:00.000Z',
    body_text: 'Hi, keen on a quote for our roof.', body_html: '', attachments: [] },
  { uid: 12, msg_id: '<m2@lewis.nz>', in_reply_to: '<m1@lewis.nz>', refs: '<m1@lewis.nz>',
    from_addr: 'brian@lewis.co.nz', from_name: 'Brian Lewis', to_addrs: ['office@floodroofing.co.nz'],
    cc_addrs: [], subject: 'Re: Re-roof quote for 148 Horeke Road', date: '2026-08-28T02:00:00.000Z',
    body_text: 'Forgot to say — it leaks over the kitchen.', body_html: '', attachments: [] },
  { uid: 13, msg_id: '<m3@supplier.nz>', in_reply_to: '', refs: '', from_addr: 'sales@supplier.co.nz',
    from_name: 'Steel Supplier', to_addrs: ['office@floodroofing.co.nz'], cc_addrs: [],
    subject: 'Price list update', date: '2026-08-28T03:00:00.000Z',
    body_text: '', body_html: '<script>alert(1)</script><img src="https://evil.example/pix.png"><b onclick="x()">New prices</b>',
    attachments: [{ name: 'prices.pdf', size: 1000, type: 'application/pdf' }] },
];
r = await as(A, '/inbox/accounts/' + office.id + '/sync', { method: 'POST' });
body = await j(r);
check('a sync pulls the new mail in', r.status === 200 && body.added === 3, JSON.stringify(body));
r = await as(A, '/inbox/accounts/' + office.id + '/sync', { method: 'POST' });
body = await j(r);
check('…and a second sync adds nothing (deduped by Message-ID)', body.added === 0, JSON.stringify(body));

body = await j(await as(A, '/inbox/threads'));
check('replies fold into one thread — two threads, not three',
  (body.threads || []).length === 2, (body.threads || []).length + ' threads');
const lewis = body.threads.find(t => /Horeke/.test(t.subject)) || {};
const suppl = body.threads.find(t => /Price list/.test(t.subject)) || {};
check('the conversation carries its count, snippet and account',
  lewis.msg_count === 2 && /kitchen/.test(lewis.snippet) && lewis.account_email === 'office@floodroofing.co.nz',
  JSON.stringify({ c: lewis.msg_count, s: lewis.snippet }).slice(0, 90));

// ── the AI sorted it on arrival ───────────────────────────────────
check('the AI triages on arrival: the lead runs hot, the supplier cool',
  lewis.category === 'lead' && lewis.urgency === 92 && suppl.category === 'supplier' && suppl.urgency === 25,
  JSON.stringify({ l: [lewis.category, lewis.urgency], s: [suppl.category, suppl.urgency] }));
check('the hottest conversation stacks on top', (body.threads[0] || {}).id === lewis.id,
  (body.threads[0] || {}).subject);
check('…with a suggested reply already waiting — and NOT sent',
  /Flood Roofing/.test(lewis.ai_draft || '') && lewis.msg_count === 2, String(lewis.ai_draft).slice(0, 60));
check('the payload says AI is on', body.ai_enabled === true);
body = await j(await as(A, '/inbox/threads?sort=date'));
check('?sort=date restores plain newest-first', (body.threads[0] || {}).id === suppl.id);

// A payment email naming the job number links itself to the job.
FAKE.inbox.push({ uid: 31, msg_id: '<m4@lewis.nz>', in_reply_to: '', refs: '',
  from_addr: 'brian@lewis.co.nz', from_name: 'Brian Lewis', to_addrs: ['office@floodroofing.co.nz'],
  cc_addrs: [], subject: 'Deposit for FR-2996 paid', date: '2026-08-28T05:00:00.000Z',
  body_text: 'Paid the deposit for FR-2996 today.', body_html: '', attachments: [] });
await as(A, '/inbox/accounts/' + office.id + '/sync', { method: 'POST' });
body = await j(await as(A, '/inbox/threads'));
const paid = (body.threads || []).find(t => /Deposit for FR-2996/.test(t.subject)) || {};
check('a job number in the email links the thread to the RoofMap job',
  paid.job_id === 'job-x' && paid.category === 'quote_reply', JSON.stringify({ j: paid.job_id, c: paid.category }));

// On-demand drafting for anything else.
r = await as(A, '/inbox/threads/' + suppl.id + '/draft', { method: 'POST' });
body = await j(r);
check('"Draft a reply" works on any thread', r.status === 200 && /Flood Roofing/.test(body.draft || ''),
  String(body.draft).slice(0, 60));
check('…on the cheap model for triage, the good one for drafts',
  AI.calls.includes('claude-haiku-4-5-20251001') && AI.calls.includes('claude-sonnet-5'),
  [...new Set(AI.calls)].join(','));

body = await j(await as(A, '/inbox/threads/' + suppl.id));
const m3 = (body.messages || [])[0] || {};
check('stored HTML is sanitised — no scripts, no live event handlers',
  !/script|onclick/i.test(m3.body_html) && /New prices/.test(m3.body_html), String(m3.body_html).slice(0, 90));
check('…and remote images are blocked until asked for',
  /data-rsrc="https:\/\/evil\.example\/pix\.png"/.test(m3.body_html) && !/ src="https:/.test(m3.body_html),
  String(m3.body_html).slice(0, 120));
check('attachment names ride along', ((m3.attachments || [])[0] || {}).name === 'prices.pdf');

// ── reply & compose ───────────────────────────────────────────────
r = await as(A2, '/inbox/threads/' + lewis.id + '/reply', { method: 'POST',
  body: JSON.stringify({ body_text: 'Hi Brian — we can look at it Tuesday.' }) });
body = await j(r);
check('a teammate can reply from the shared account', r.status === 200 && body.ok, JSON.stringify(body).slice(0, 80));
const env = body._test_envelope || {};
check('…addressed to the customer, from office@, threading intact',
  (env.to && env.to[0] && env.to[0].address) === 'brian@lewis.co.nz' &&
  (env.from && env.from.address) === 'office@floodroofing.co.nz' &&
  /^Re:/i.test(env.subject) && env.inReplyTo === '<m2@lewis.nz>',
  JSON.stringify({ to: env.to, irt: env.inReplyTo }).slice(0, 110));
body = await j(await as(A, '/inbox/threads/' + lewis.id));
check('…and the sent reply lands in the conversation',
  body.messages.length === 3 && body.messages[2].folder === 'Sent' && /Tuesday/.test(body.messages[2].body_text));

r = await as(A, '/inbox/compose', { method: 'POST', body: JSON.stringify({
  account_id: office.id, to: 'new@customer.co.nz', subject: 'Your roofing quote',
  body_text: 'Hi — quote attached shortly.' }) });
body = await j(r);
check('compose starts a fresh thread', r.status === 200 && body.ok);
body = await j(await as(A, '/inbox/threads?status=all'));
check('…visible on the board', (body.threads || []).some(t => t.subject === 'Your roofing quote'));

// ── triage actions ────────────────────────────────────────────────
r = await as(A, '/inbox/threads/' + suppl.id, { method: 'PATCH', body: JSON.stringify({
  status: 'snoozed', snoozed_until: '2026-09-07T20:00:00Z', assignee_user_id: A2.user, unread: false }) });
body = await j(r);
check('snooze + assign round-trips', r.status === 200 && body.status === 'snoozed' &&
  body.assignee_user_id === A2.user, JSON.stringify(body).slice(0, 90));
body = await j(await as(A, '/inbox/threads'));
check('…and a snoozed thread leaves the inbox view',
  !(body.threads || []).some(t => t.id === suppl.id), (body.threads || []).length + ' in inbox');

// ── the walls ─────────────────────────────────────────────────────
body = await j(await as(B, '/inbox/threads'));
check("the rival's inbox is empty — no accounts, no threads",
  (body.threads || []).length === 0 && (body.accounts || []).length === 0);
r = await as(B, '/inbox/threads/' + lewis.id, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
check("B cannot touch A's thread", r.status === 404, 'status ' + r.status);
r = await as(B, '/inbox/accounts/' + office.id + '/sync', { method: 'POST' });
check("B cannot sync A's account", r.status === 404, 'status ' + r.status);

// A private account's mail is invisible to teammates.
FAKE.inbox = [{ uid: 21, msg_id: '<p1@x.nz>', in_reply_to: '', refs: '', from_addr: 'mate@x.nz',
  from_name: 'Mate', to_addrs: ['aron@floodroofing.co.nz'], cc_addrs: [],
  subject: 'Fishing Saturday?', date: '2026-08-29T04:00:00.000Z', body_text: 'Tides look good.',
  body_html: '', attachments: [] }];
await as(A, '/inbox/accounts/' + priv.id + '/sync', { method: 'POST' });
body = await j(await as(A2, '/inbox/threads?status=all'));
check("a teammate never sees the private account's mail",
  !(body.threads || []).some(t => /Fishing/.test(t.subject)), (body.threads || []).length + ' threads');
r = await as(A2, '/inbox/accounts/' + priv.id + '/sync', { method: 'POST' });
check('…nor sync it', r.status === 404, 'status ' + r.status);
body = await j(await as(A, '/inbox/threads?status=all'));
check('while the owner sees it fine', (body.threads || []).some(t => /Fishing/.test(t.subject)));

// Only the connector can delete an account; threads go with it.
r = await as(A2, '/inbox/accounts/' + priv.id, { method: 'DELETE' });
check('a teammate cannot delete an account they did not connect', r.status === 404, 'status ' + r.status);
r = await as(A, '/inbox/accounts/' + priv.id, { method: 'DELETE' });
check('the connector can', r.status === 200);
body = await j(await as(A, '/inbox/threads?status=all'));
check('…and its threads leave with it', !(body.threads || []).some(t => /Fishing/.test(t.subject)));

const pass = results.filter(Boolean).length;
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
