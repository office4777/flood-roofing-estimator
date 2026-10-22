// A JOB'S EMAIL, FOLLOWED BACK INTO THE JOB (2026-10-23, the owner: "if a
// customer asks a question ... that question should be emailed to the users
// email ... the email should contain the job details, the customers
// questions, and the user should be able to reply to the question in their
// email (mine being Gmail) to the customers email address ... if the customer
// wishes to reply it'll reply as an email, those email communications should
// also appear in RoofMap inside the jobs communications").
//
// The whole round trip against the real server: the customer asks on their
// quote link, the office is emailed the job and the question with the
// customer as Reply-To, the office answers from Gmail (found in the mailbox's
// SENT folder), the customer writes back (found in the INBOX), and every one
// of those lands on the job's thread — while unrelated mail, another
// company's mail and a repeat sync do not.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const sent = [];
const relay = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => { try { sent.push(JSON.parse(body)); } catch (e) { sent.push({ raw: body }); }
    res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));

// The credential the account row carries, encrypted the way the server does
// with no MAIL_CRED_KEY set (derived from JWT_SECRET).
function enc(plain){
  const key = crypto.createHash('sha256').update('derived:test-secret').digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const quote = { ref: '3303', client: 'Dot Bolous', email: 'dot@example.com', phone: '021 555 0303',
  addr: '23 Gilbert Mair Rise, Russell',
  share: { token: 'tok-q', status: 'sent', sentAt: ago(1), sentTo: 'dot@example.com', sentTotal: 31415.5, events: [] } };
const { db, port } = await startFakePostgrest({
  companies: [ { id: 'c1', name: 'Flood Roofing', plan: 'business' }, { id: 'c2', name: 'Rival Roofing', plan: 'business' } ],
  profiles: [ { id: 'u1', company_id: 'c1', email: 'office@floodroofing.co.nz' }, { id: 'u2', company_id: 'c2', email: 'office@rival.nz' } ],
  company_users: [ { company_id: 'c1', user_id: 'u1', role: 'owner' }, { company_id: 'c2', user_id: 'u2', role: 'owner' } ],
  user_settings: [
    { user_id: 'u1', company_id: 'c1', updated_at: ago(1),
      branding: { company_name: 'Flood Roofing', email: 'office@floodroofing.co.nz', phone: '09 430 0000' },
      quote_defaults: { email: { question_to: 'office@floodroofing.co.nz' } } },
    { user_id: 'u2', company_id: 'c2', updated_at: ago(1), branding: { company_name: 'Rival Roofing' }, quote_defaults: { email: {} } },
  ],
  jobs: [
    { id: 'j-q', user_id: 'u1', company_id: 'c1', client_name: 'Dot Bolous', site_address: '23 Gilbert Mair Rise, Russell',
      created_at: ago(7), updated_at: ago(0), draw_state: { state: { quote: quote }, form: {} } },
    // another company's job, for the same customer — never written to by c1's mailbox
    { id: 'j-rival', user_id: 'u2', company_id: 'c2', client_name: 'Dot Bolous', site_address: 'Elsewhere',
      created_at: ago(7), updated_at: ago(0), draw_state: { state: { quote: Object.assign({}, quote, { ref: '9001' }) }, form: {} } },
  ],
  comms_tasks: [], job_messages: [], mail_threads: [], mail_messages: [],
  mail_accounts: [
    { id: 'acct-1', company_id: 'c1', user_id: 'u1', label: 'Office', email: 'office@floodroofing.co.nz', provider: 'gmail',
      imap_host: 'imap.gmail.com', imap_port: 993, smtp_host: 'smtp.gmail.com', smtp_port: 465,
      username: 'office@floodroofing.co.nz', cred_enc: enc('app-pass'), shared: true, status: 'ok', last_error: '',
      last_uid: {}, last_sync: null, created_at: ago(30), smtp_ok: true },
  ],
});

// The mailbox: INBOX and SENT, scriptable, the seam the Inbox suite uses.
const BOX = { INBOX: [], SENT: [] };
globalThis.__TEST_MAIL_FETCHER = {
  async verify(){},
  async fetchNew(conn, pass, lastUid, box){
    const list = BOX[box === 'SENT' ? 'SENT' : 'INBOX'].filter(m => m.uid > (lastUid || 0));
    return { messages: list, lastUid: list.length ? Math.max(...list.map(m => m.uid)) : (lastUid || 0) };
  },
  async appendSent(){},
};
globalThis.__TEST_MAIL_JSON = true;

process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <support@roofmap.co.nz>';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
const PORT = process.env.TEST_PORT || '34985';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn, err = console.error;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn; console.error = err;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const TOK = jwt.sign({ id: 'u1', email: 'office@floodroofing.co.nz', cid: 'c1' }, 'test-secret');
const auth = (m, p, b) => fetch(BASE + p, { method: m,
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOK },
  body: b === undefined ? undefined : JSON.stringify(b) });
const settle = (ms) => new Promise(r => setTimeout(r, ms || 700));
const thread = () => (db.job_messages || []).filter(m => m.job_id === 'j-q').sort((a, b) => String(a.at).localeCompare(String(b.at)));

// ── 1. The customer asks; the office is emailed the job and the question ──
await fetch(BASE + '/q/tok-q/event?job=j-q', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'queried', message: 'Please clarify. Is the reroof quote for the entire house?' }) });
await settle(900);
const note = sent.find(m => /office@floodroofing\.co\.nz/.test(String(m.to || ''))) || {};
check('the question is emailed to the address Settings → Email names',
  /office@floodroofing\.co\.nz/.test(String(note.to || '')), JSON.stringify(sent.map(m => m.to)));
check('…with the job details: the quote, the customer and how to reach them, the address, the total',
  /3303/.test(note.text || '') && /Dot Bolous <dot@example\.com>/.test(note.text || '') && /021 555 0303/.test(note.text || '') &&
  /23 Gilbert Mair Rise/.test(note.text || '') && /31,415\.50/.test(note.text || ''), (note.text || '').slice(0, 400));
check('…and the customer’s own question, word for word',
  /Is the reroof quote for the entire house\?/.test(note.text || ''));
check('…replying to it goes to the customer: their address is the Reply-To',
  String(note.replyTo || '') === 'dot@example.com', JSON.stringify(note.replyTo));
check('…and it says so, and that the answer is kept on the job',
  /Reply to this email to answer Dot directly/.test(note.text || '') && /History & Communications/.test(note.text || ''));
const q = thread().find(m => m.who === 'customer') || {};
check('the question is the first line of the job’s thread, under an id RoofMap chose',
  /^<rm-q.*@roofmap\.co\.nz>$/.test(q.msg_id || ''), JSON.stringify(q.msg_id));

// ── 2. The office answers from Gmail; the customer writes back ──────────
const officeReplyId = '<CAGmail-office-1@mail.gmail.com>';
BOX.SENT = [
  { uid: 41, msg_id: officeReplyId, in_reply_to: q.msg_id, refs: q.msg_id,
    from_addr: 'office@floodroofing.co.nz', from_name: 'Flood Roofing', to_addrs: ['dot@example.com'], cc_addrs: [],
    subject: 'Re: Question on quote — 3303 — Dot Bolous', date: new Date(Date.now() + 60000).toISOString(),
    body_text: 'Hi Dot, yes the price is for the whole house.\n\nOn Thu, 23 Oct 2026 at 9:10 am, RoofMap <support@roofmap.co.nz> wrote:\n> Dot Bolous has asked a question',
    body_html: '', attachments: [] },
  // something else the office sent today: nothing to do with a job's thread
  { uid: 42, msg_id: '<CAGmail-other@mail.gmail.com>', in_reply_to: '', refs: '', from_addr: 'office@floodroofing.co.nz',
    from_name: 'Flood Roofing', to_addrs: ['supplier@steel.nz'], cc_addrs: [], subject: 'Order for Monday',
    date: new Date().toISOString(), body_text: 'Please send 40 sheets.', body_html: '', attachments: [] },
];
BOX.INBOX = [
  { uid: 7, msg_id: '<dot-2@example.com>', in_reply_to: officeReplyId, refs: q.msg_id + ' ' + officeReplyId,
    from_addr: 'dot@example.com', from_name: 'Dot Bolous', to_addrs: ['office@floodroofing.co.nz'], cc_addrs: [],
    subject: 'Re: Question on quote — 3303 — Dot Bolous', date: new Date(Date.now() + 120000).toISOString(),
    body_text: 'Great, thank you - when could you start?\n\n> Hi Dot, yes the price is for the whole house.',
    body_html: '', attachments: [] },
  // a customer reply whose headers lost the chain (a forward, a different client):
  // matched the plain way, by her address and the quote number in the subject
  { uid: 8, msg_id: '<dot-3@example.com>', in_reply_to: '', refs: '',
    from_addr: 'dot@example.com', from_name: 'Dot Bolous', to_addrs: ['office@floodroofing.co.nz'], cc_addrs: [],
    subject: 'RE: Your quote 3303', date: new Date(Date.now() + 180000).toISOString(),
    body_text: 'Also, is the guttering included?', body_html: '', attachments: [] },
  // unrelated inbox mail
  { uid: 9, msg_id: '<news@promo.nz>', in_reply_to: '', refs: '', from_addr: 'news@promo.nz', from_name: 'Promo',
    to_addrs: ['office@floodroofing.co.nz'], cc_addrs: [], subject: 'Big sale', date: new Date().toISOString(),
    body_text: 'Buy now', body_html: '', attachments: [] },
];
let r = await auth('POST', '/inbox/accounts/acct-1/sync');
check('the inbox sync runs', r.status === 200, 'status ' + r.status + ' ' + (await r.text()).slice(0, 120));
await settle(300);
let t = thread();
const fromGmail = t.find(m => m.msg_id === officeReplyId) || {};
check('THE OFFICE’S GMAIL REPLY APPEARS ON THE JOB, as the office’s, found in the Sent folder',
  fromGmail.who === 'office' && /whole house/.test(fromGmail.body || ''), JSON.stringify(t.map(m => [m.who, m.msg_id])));
check('…the reply alone, not the email it quotes underneath',
  !/has asked a question/.test(fromGmail.body || '') && !/wrote:/.test(fromGmail.body || ''), JSON.stringify(fromGmail.body));
check('…and says where it went: to the customer, from the office’s own mailbox',
  fromGmail.mail_to === 'dot@example.com' && /office@floodroofing\.co\.nz/.test(fromGmail.mail_from || ''),
  JSON.stringify({ to: fromGmail.mail_to, from: fromGmail.mail_from }));
const back = t.find(m => m.msg_id === '<dot-2@example.com>') || {};
check('THE CUSTOMER’S EMAIL BACK APPEARS ON THE JOB, as the customer’s',
  back.who === 'customer' && /when could you start\?/.test(back.body || '') && !/whole house/.test(back.body || ''),
  JSON.stringify(back));
check('…and one whose headers lost the chain is still found, by her address and the quote number',
  !!t.find(m => m.msg_id === '<dot-3@example.com>' && /guttering included/.test(m.body || '')),
  JSON.stringify(t.map(m => m.msg_id)));
check('nothing unrelated is put on the job — not the supplier order, not the newsletter',
  !t.some(m => /40 sheets|Buy now/.test(m.body || '')), JSON.stringify(t.map(m => m.body).slice(-3)));
check('…and another company’s job for the same customer is never touched',
  !(db.job_messages || []).some(m => m.job_id === 'j-rival'), '');
check('the thread reads in order: question, Gmail answer, her reply, her follow-up',
  t.map(m => m.who).join(',') === 'customer,office,customer,customer', t.map(m => m.who).join(','));
check('the inbox thread learns which job it belongs to',
  (db.mail_threads || []).some(th => th.job_id === 'j-q'), JSON.stringify((db.mail_threads || []).map(th => [th.subject, th.job_id])));

// ── 3. A second sync adds nothing twice ────────────────────────────────
const n = thread().length;
BOX.SENT.forEach(m => { m.uid += 100; }); BOX.INBOX.forEach(m => { m.uid += 100; });   // even if the server re-reads them
await auth('POST', '/inbox/accounts/acct-1/sync');
await settle(300);
check('a repeat sync adds nothing twice', thread().length === n, n + ' -> ' + thread().length);

// ── 4. The window is told where Gmail replies come from ───────────────
const conv = await (await auth('GET', '/jobs/j-q/messages')).json();
check('the job’s thread says a mailbox is connected, and which',
  conv.inbox && conv.inbox.connected === true && (conv.inbox.emails || []).includes('office@floodroofing.co.nz'), JSON.stringify(conv.inbox));
check('…and carries every message in it', (conv.messages || []).length === n, (conv.messages || []).length + ' of ' + n);

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
