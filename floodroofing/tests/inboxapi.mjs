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
  mail_accounts: [], mail_threads: [], mail_messages: [], comms_tasks: [], chat_channels: [], chat_messages: [],
  user_settings: [],
  schedule_rows: [{ id: 'sr-modspace', company_id: A.company, user_id: A.user, job_id: null,
    client_name: 'Modspace Ltd', site_address: '7 Rust Ave, Whangarei', email: 'sam@modspace.co.nz',
    length_days: 5, notes: '', archived: false, handover_done: false, created_at: '2026-08-20T00:00:00Z' }],
  schedule_blocks: [],
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
  if (/office assistant/.test(opts.system || '')){
    const P = String(opts.prompt || '');
    const idFor = (re) => { const ln = P.split('\n').find(l => re.test(l)) || ''; const m = ln.match(/\[([^\]]+)\]/); return m ? m[1] : ''; };
    const idsFor = (re) => P.split('\n').filter(l => re.test(l)).map(l => (l.match(/\[([^\]]+)\]/) || [])[1]).filter(Boolean);
    const schedIdFor = (re) => { const seg = P.slice(P.indexOf('Schedule (')); const ln = seg.split('\n').find(l => re.test(l)) || ''; const m = ln.match(/\[([^\]]+)\]/); return m ? m[1] : ''; };
    if (/add to my list/i.test(P)) return '{"action":"my_todo","title":"Pick up screws from CARTERS"}';
    if (/mark the .*3099.* done/i.test(P)) return JSON.stringify({ action: 'task_update', task_id: idFor(/3099/), done: true });
    if (/archive everything from the supplier/i.test(P)) return JSON.stringify({ action: 'threads', op: 'archive', thread_ids: idsFor(/Price list/) });
    if (/find the email/i.test(P)) return JSON.stringify({ action: 'open_thread', thread_id: idFor(/Horeke/) });
    if (/note on the lewis job/i.test(P)) return JSON.stringify({ action: 'note', thread_id: idFor(/Horeke/), body: 'He rang — wants us before the rain.' });
    if (/tell the team/i.test(P)) return '{"action":"chat","body":"Yard closes early on Friday."}';
    if (/open the schedule/i.test(P)) return '{"action":"goto","tab":"schedule"}';
    if (/pencil the modspace/i.test(P)) return JSON.stringify({ action: 'schedule', op: 'book', row_id: schedIdFor(/Modspace/), start_date: '2026-09-14', work_days: 5, crew_name: '' });
    if (/push the modspace/i.test(P)) return JSON.stringify({ action: 'schedule', op: 'shift', row_id: schedIdFor(/Modspace/), start_date: '2026-09-28' });
    if (/confirm start email/i.test(P)) return JSON.stringify({ action: 'sched_mail', row_id: schedIdFor(/Modspace/), kind: 'confirm' });
    if (/start a new job/i.test(P)) return '{"action":"new_job","client":"Sarah Mills","address":"12 Kamo Road"}';
    if (/rundown/i.test(P)) return '{"action":"answer","text":"Two open tasks, one hot lead waiting, Modspace starts the 14th."}';
    if (/draft a reply|reply to this/i.test(P)){
      const cm = P.match(/Currently open on screen: \[([^\]]+)\]/);
      return JSON.stringify({ action: 'reply', thread_id: cm ? cm[1] : '',
        body: 'No worries — thanks for the update.\n\nFlood Roofing' });
    }
    if (/set task|task for/i.test(P))
      return '{"action":"task","title":"Check over job #3099","assignee_name":"user-a2","urgency":45}';
    if (/email/i.test(P))
      return '{"action":"email","to":"Steel Supplier <sales@supplier.co.nz>","subject":"Colour selection — job 3342","body":"Hi Suzie,\\n\\nCould you send through your colour selection for job 3342?\\n\\nFlood Roofing"}';
    return '{"action":"unknown","note":"I can set tasks and draft emails so far."}';
  }
  if (/You draft whole emails/.test(opts.system || ''))
    return '{"to":"Steel Supplier <sales@supplier.co.nz>","subject":"Delivery update — job 3057","body":"Hi,\\n\\nCould you give us an update on the delivery for job 3057?\\n\\nFlood Roofing"}';
  if (/You spot tasks/.test(opts.system || ''))
    return /order|chase|book/i.test(opts.prompt)
      ? '{"is_task":true,"title":"Order the Modspace flashings","urgency":65}'
      : '{"is_task":false}';
  if (/You assign/.test(opts.system || '')) return '{"assignee_id":"user-a2","urgency":77}';
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

// ── tasks: the AI hands them to the right person ──────────────────
r = await as(A, '/inbox/tasks', { method: 'POST', body: JSON.stringify({ title: 'Chase the Modspace deposit' }) });
body = await j(r);
check('a bare task gets an AI assignee and urgency',
  r.status === 200 && body.assignee_user_id === A2.user && body.urgency === 77, JSON.stringify(body).slice(0, 90));
const taskId = body.id;

r = await as(A, '/inbox/threads/' + paid.id + '/task', { method: 'POST', body: JSON.stringify({}) });
body = await j(r);
check('an email becomes a task carrying its thread and job',
  r.status === 200 && body.thread_id === paid.id && body.job_id === 'job-x' && /FR-2996/.test(body.title),
  JSON.stringify({ th: body.thread_id, j: body.job_id }));
check("…keeping the thread's urgency", body.urgency === 80, String(body.urgency));

body = await j(await as(A, '/inbox/tasks'));
check('the board lists tasks urgency-first with the team beside them',
  (body.tasks || [])[0].urgency === 80 && (body.members || []).length === 2,
  JSON.stringify({ n: (body.tasks || []).length, m: (body.members || []).length }));

r = await as(A2, '/inbox/tasks/' + taskId, { method: 'PATCH', body: JSON.stringify({ assignee_user_id: A.user, done: true }) });
body = await j(r);
check('anyone on the team can re-assign and finish a task',
  r.status === 200 && body.assignee_user_id === A.user && body.done === true && !!body.done_at,
  JSON.stringify(body).slice(0, 80));

r = await as(B, '/inbox/tasks/' + taskId, { method: 'PATCH', body: JSON.stringify({ done: false }) });
check("B cannot touch A's tasks", r.status === 404, 'status ' + r.status);
body = await j(await as(B, '/inbox/tasks'));
check("…and B's task board is empty", (body.tasks || []).length === 0);

// ── chat: channels + internal notes on threads ────────────────────
body = await j(await as(A, '/inbox/chat/channels'));
check('#general exists from the first look, with the team beside it',
  (body.channels || []).length === 1 && body.channels[0].name === 'general' && (body.members || []).length === 2,
  JSON.stringify(body.channels));
const general = body.channels[0];

r = await as(A, '/inbox/chat/messages', { method: 'POST', body: JSON.stringify({
  channel_id: general.id, body: 'Morning all — @Lizzie the Horeke job is booked for Monday.' }) });
check('a channel message posts', r.status === 200, 'status ' + r.status);
r = await as(A2, '/inbox/chat/messages', { method: 'POST', body: JSON.stringify({
  channel_id: general.id, body: 'On it.' }) });
check('…and a teammate answers in the same room', r.status === 200);
body = await j(await as(A2, '/inbox/chat/messages?channel_id=' + general.id));
check('the room reads back in order, oldest first',
  (body.messages || []).length === 2 && /Morning all/.test(body.messages[0].body) && body.messages[1].user_id === A2.user,
  (body.messages || []).length + ' messages');

r = await as(A, '/inbox/chat/channels', { method: 'POST', body: JSON.stringify({ name: '#jobs' }) });
body = await j(r);
check('new channels strip the # and stick', r.status === 200 && body.name === 'jobs');
r = await as(A, '/inbox/chat/channels/' + body.id, { method: 'PATCH', body: JSON.stringify({ name: 'site-crew' }) });
check('…and rename', r.status === 200 && (await j(r)).name === 'site-crew');

// The AI reads the room: a message that IS a task comes back with a
// suggestion the sender can accept — never an auto-created task.
r = await as(A, '/inbox/chat/messages', { method: 'POST', body: JSON.stringify({
  channel_id: general.id, body: 'Can someone order the Modspace flashings before Thursday?' }) });
body = await j(r);
check('a task-shaped chat message carries a task suggestion',
  r.status === 200 && body.task_suggest && /Modspace/.test(body.task_suggest.title) && body.task_suggest.urgency === 65,
  JSON.stringify(body.task_suggest || null));
body = await j(await as(A, '/inbox/tasks'));
check('…but no task exists until a person says so',
  !(body.tasks || []).some(t => /Modspace flashings/.test(t.title)), (body.tasks || []).length + ' tasks');
r = await as(A, '/inbox/tasks', { method: 'POST', body: JSON.stringify({
  title: 'Order the Modspace flashings', urgency: 65, notes: 'From internal chat' }) });
body = await j(r);
check('accepting the suggestion creates the task with its urgency',
  r.status === 200 && body.urgency === 65 && /Modspace/.test(body.title), JSON.stringify(body).slice(0, 90));
r = await as(A, '/inbox/chat/messages', { method: 'POST', body: JSON.stringify({
  channel_id: general.id, body: 'Sweet as, see everyone at smoko.' }) });
body = await j(r);
check('small talk stays small talk — no suggestion', r.status === 200 && body.task_suggest === undefined,
  JSON.stringify(body).slice(0, 80));

// Internal notes on an email thread — invisible to the customer.
const mailCountBefore = (await j(await as(A, '/inbox/threads/' + lewis.id))).messages.length;
r = await as(A2, '/inbox/chat/messages', { method: 'POST', body: JSON.stringify({
  thread_id: lewis.id, body: 'He rang too — wants us before the rain. @Aron can Troy start early?' }) });
check('a thread note posts', r.status === 200);
body = await j(await as(A, '/inbox/chat/messages?thread_id=' + lewis.id));
check('…and reads back on the thread', (body.messages || []).length === 1 && /before the rain/.test(body.messages[0].body));
check('…while the EMAIL conversation is untouched — the customer can never see it',
  (await j(await as(A, '/inbox/threads/' + lewis.id))).messages.length === mailCountBefore);

// Chat walls.
body = await j(await as(B, '/inbox/chat/channels'));
check("B gets its own #general, not A's", (body.channels || []).length === 1 && body.channels[0].id !== general.id);
r = await as(B, '/inbox/chat/messages?channel_id=' + general.id);
check("B cannot read A's room", r.status === 404, 'status ' + r.status);
r = await as(B, '/inbox/chat/messages', { method: 'POST', body: JSON.stringify({ thread_id: lewis.id, body: 'hi' }) });
check("…nor note on A's threads", r.status === 404, 'status ' + r.status);

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

// ── a host that blocks outbound SMTP (container platforms do) ─────
// IMAP verifies fine, every SMTP connect is refused. That's the host's
// doing, not the user's app password — the connect must still succeed,
// receive-only, and a send attempt must say what's actually wrong.
globalThis.__TEST_SMTP_FAIL = true;
r = await as(A, '/inbox/accounts', { method: 'POST', body: JSON.stringify({
  email: 'sales@floodroofing.co.nz', label: 'Sales', provider: 'gmail',
  imap_host: 'imap.gmail.com', imap_port: 993, smtp_host: 'smtp.gmail.com', smtp_port: 465,
  password: 'app-pass-123', shared: true }) });
const rxonly = await j(r);
check('SMTP blocked by the host: the account still connects', r.status === 200 && !!rxonly.id,
  'status ' + r.status + ' ' + JSON.stringify(rxonly).slice(0, 90));
check('…flagged receive-only with the SMTP leg named',
  rxonly.smtp_ok === false && /SMTP smtp\.gmail\.com:465/.test(rxonly.last_error || ''),
  JSON.stringify({ smtp_ok: rxonly.smtp_ok, err: rxonly.last_error }).slice(0, 130));

r = await as(A, '/inbox/compose', { method: 'POST', body: JSON.stringify({
  account_id: rxonly.id, to: 'x@y.co.nz', subject: 'Hello', body_text: 'Hi' }) });
body = await j(r);
check('a send from it fails with the real reason, not a password hint',
  r.status >= 400 && /blocking outbound SMTP/.test(JSON.stringify(body)),
  'status ' + r.status + ' ' + JSON.stringify(body).slice(0, 130));

// The moment the host unblocks SMTP, the very next send just works.
delete globalThis.__TEST_SMTP_FAIL;
r = await as(A, '/inbox/compose', { method: 'POST', body: JSON.stringify({
  account_id: rxonly.id, to: 'x@y.co.nz', subject: 'Hello again', body_text: 'Hi' }) });
body = await j(r);
check('…and the first send after the unblock heals the account',
  r.status === 200 && body.ok, 'status ' + r.status + ' ' + JSON.stringify(body).slice(0, 80));
body = await j(await as(A, '/inbox/accounts'));
const healed = (body || []).find(a => a.id === rxonly.id);
check('…which now reports sending OK', !!healed && healed.smtp_ok !== false,
  JSON.stringify(healed || {}).slice(0, 90));

// ── personal to-dos: yours, and only yours ────────────────────────
r = await as(A, '/inbox/tasks', { method: 'POST', body: JSON.stringify({
  title: 'Ring the bank about the ute', personal: true }) });
body = await j(r);
check('a personal to-do saves as your own — the AI never picks its owner',
  r.status === 200 && body.personal === true && body.assignee_user_id === A.user,
  JSON.stringify({ p: body.personal, a: body.assignee_user_id }));
body = await j(await as(A, '/inbox/tasks'));
check('…the writer sees it in their list',
  (body.tasks || []).some(t => /Ring the bank/.test(t.title)), (body.tasks || []).length + ' tasks');
body = await j(await as(A2, '/inbox/tasks'));
check('…and a teammate never does',
  !(body.tasks || []).some(t => /Ring the bank/.test(t.title)), (body.tasks || []).length + ' tasks');

// ── tell the AI what to send: instruction → ready-to-check draft ──
r = await as(A, '/inbox/ai-compose', { method: 'POST', body: JSON.stringify({
  instruction: 'email steve from roofing industries asking for an update on the delivery for job 3057' }) });
body = await j(r);
check('an instruction drafts the whole email — recipient resolved to a bare address',
  r.status === 200 && body.to === 'sales@supplier.co.nz' && /3057/.test(body.subject) && /3057/.test(body.body),
  JSON.stringify(body).slice(0, 120));
r = await as(A, '/inbox/ai-compose', { method: 'POST', body: JSON.stringify({ instruction: '' }) });
check('an empty instruction is refused, not sent to the AI', r.status === 400);

// ── the AI Assistant: one instruction becomes an action ───────────
r = await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'set task for user-a2 to check over job #3099' }) });
body = await j(r);
check('"set task for…" creates the task, assigned to the named teammate',
  r.status === 200 && body.action === 'task' && body.task &&
  body.task.assignee_user_id === A2.user && /3099/.test(body.task.title) && body.task.urgency === 45,
  JSON.stringify(body.task || {}).slice(0, 110));
body = await j(await as(A2, '/inbox/tasks'));
check('…and it lands on the real board', (body.tasks || []).some(t => /3099/.test(t.title)));
r = await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'email suzie from job number #3342 and ask for her colour selection' }) });
body = await j(r);
check('"email…" hands back a draft — never a send',
  r.status === 200 && body.action === 'email' && body.to === 'sales@supplier.co.nz' &&
  /3342/.test(body.subject) && /colour selection/i.test(body.body), JSON.stringify(body).slice(0, 120));
r = await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'what is the weather like' }) });
body = await j(r);
check('anything else gets an honest note about what it can do',
  r.status === 200 && body.action === 'unknown' && /tasks and draft emails/i.test(body.note), JSON.stringify(body));

// ── the full command set ──────────────────────────────────────────
body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'add to my list pick up screws from CARTERS' }) }));
check('"add to my list" lands on the private list',
  body.action === 'my_todo' && body.task.personal === true && body.task.assignee_user_id === A.user,
  JSON.stringify(body.task || {}).slice(0, 90));

body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'mark the 3099 task done' }) }));
check('"mark it done" completes the real task', body.action === 'task_update' && body.task.done === true &&
  /3099/.test(body.task.title), JSON.stringify(body.task || {}).slice(0, 90));
body = await j(await as(A, '/inbox/tasks'));
check('…and the board agrees', (body.tasks || []).some(t => /3099/.test(t.title) && t.done === true));

body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'archive everything from the supplier' }) }));
check('"archive everything from…" files the matching conversations',
  body.action === 'threads' && body.op === 'archive' && body.count >= 1, JSON.stringify(body));
body = await j(await as(A, '/inbox/threads?status=archived'));
check('…which really are archived', (body.threads || []).some(t => /Price list/.test(t.subject)));

body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'find the email about the horeke job' }) }));
check('"find the email about…" points at the right conversation',
  body.action === 'open_thread' && body.thread_id === lewis.id, JSON.stringify(body));

const notesBefore = ((await j(await as(A, '/inbox/chat/messages?thread_id=' + lewis.id))).messages || []).length;
body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'note on the lewis job he rang and wants us before the rain' }) }));
check('"note on the job" saves an internal note', body.action === 'note' && body.thread_id === lewis.id, JSON.stringify(body));
body = await j(await as(A, '/inbox/chat/messages?thread_id=' + lewis.id));
check('…that sits on the thread, invisible to the customer',
  (body.messages || []).length === notesBefore + 1 && /before the rain/.test((body.messages || []).map(m => m.body).join(' ')));

body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'tell the team the yard closes early friday' }) }));
check('"tell the team…" only PREPARES the chat message — a person posts it',
  body.action === 'chat' && /Yard closes early/.test(body.body), JSON.stringify(body));

body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'open the schedule' }) }));
check('"open the schedule" navigates', body.action === 'goto' && body.tab === 'schedule', JSON.stringify(body));

body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'pencil the modspace job in for the week of the 14th' }) }));
check('"pencil the job in…" books the calendar',
  body.action === 'schedule' && body.op === 'book' && /Modspace/.test(body.client) && body.start_date === '2026-09-14',
  JSON.stringify(body));
body = await j(await as(A, '/schedule'));
let blk = (body.blocks || []).find(b2 => b2.row_id === 'sr-modspace');
check('…with a real pencil block on the row', !!blk && blk.start_date === '2026-09-14' && blk.kind === 'pencil',
  JSON.stringify(blk || body).slice(0, 140));

body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'push the modspace job out two weeks' }) }));
check('"push it out two weeks" moves the booking', body.action === 'schedule' && body.op === 'shift' &&
  body.start_date === '2026-09-28', JSON.stringify(body));
body = await j(await as(A, '/schedule'));
const blks = (body.blocks || []).filter(b2 => b2.row_id === 'sr-modspace');
check('…moving the SAME block, not stacking a second one',
  blks.length === 1 && blks[0].start_date === '2026-09-28', JSON.stringify(blks));

body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'send modspace their confirm start email' }) }));
check('"send the confirm start email" hands the modal straight to the person',
  body.action === 'sched_mail' && body.row_id === 'sr-modspace' && body.kind === 'confirm', JSON.stringify(body));

body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'start a new job at 12 kamo road for sarah mills' }) }));
check('"start a new job" hands back the prefill', body.action === 'new_job' &&
  body.client === 'Sarah Mills' && /Kamo/.test(body.address), JSON.stringify(body));

body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'give me my rundown' }) }));
check('"give me my rundown" answers from the real data',
  body.action === 'answer' && /Modspace/.test(body.text), JSON.stringify(body));

body = await j(await as(A, '/inbox/assistant', { method: 'POST', body: JSON.stringify({
  instruction: 'draft a reply to this email to say no worries thanks for the update', thread_id: lewis.id }) }));
check('"reply to THIS email" knows which conversation is on screen',
  body.action === 'reply' && body.thread_id === lewis.id && /No worries/.test(body.body), JSON.stringify(body).slice(0, 110));

const pass = results.filter(Boolean).length;
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
