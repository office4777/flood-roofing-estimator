// THE OFFICE HEARS EVERY ANSWER THE CUSTOMER GIVES (the owner, 2026-10-19):
//   "i didn't get an email to say job #3320 was declined, i should get an
//    email" … "when a quote gets accepted like it just was for job #3305, i
//    didn't recieve an acceptance email"
// Three separate holes in the one handler, and the same shape to all of them:
//   • DECLINED sent nothing at all. The branch set a status and stopped.
//   • ACCEPTED emailed the office only if the CUSTOMER'S BROWSER made a second
//     call to /q/:token/accept-email after rendering the quote to a PDF off a
//     CDN. On a phone, a long quote, a slow link, or a tab closed on the
//     thank-you screen that call never happens, and nothing noticed, because
//     the accept itself had already answered 200.
//   • QUERIED did send, but awaited the Terms-of-Trade lookup inside the
//     _dispatchMail arguments, so a failure there threw before the mail was
//     handed over and the function's own catch turned it into a console.warn.
// The office's notification is the SERVER's job now. Pinned here against the
// real server on the fake PostgREST with the relay captured.
// WORTH SAYING: with no DATABASE_URL these run _shareStamp's fallback (the
// whole quote through PostgREST) rather than production's jsonb_set path. What
// is pinned is the claim being WRITTEN and honoured, which is what stops a
// second email; the fast path is the same stamp through a different write.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
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

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const quote = (over) => Object.assign({
  ref: '3305', client: 'Richard Rudolph', email: 'richard@example.com',
  addr: '12 Kamo Road, Whangarei', validUntil: '30 days',
  proposalOptions: { steelGrade: 'maxam', steelThickness: '40', colour: 'Mist Green' },
  share: { token: 'tok-x', status: 'sent', sentAt: ago(1), sentTo: 'richard@example.com',
           sentTotal: 24500.5, events: [] },
}, over || {});
const job = (id, q) => ({ id, user_id: 'u1', company_id: 'c1', client_name: q.client, site_address: q.addr,
  created_at: ago(7), updated_at: ago(0), draw_state: { state: { quote: q }, form: {} } });

const { db, port } = await startFakePostgrest({
  companies: [ { id: 'c1', name: 'Flood Roofing', plan: 'team' }, { id: 'c2', name: 'Off Co', plan: 'team' } ],
  profiles: [ { id: 'u1', company_id: 'c1', email: 'owner@flood.nz' }, { id: 'u2', company_id: 'c2', email: 'owner@off.nz' } ],
  company_users: [ { company_id: 'c1', user_id: 'u1', role: 'owner' }, { company_id: 'c2', user_id: 'u2', role: 'owner' } ],
  user_settings: [
    { user_id: 'u1', company_id: 'c1', updated_at: ago(1),
      branding: { company_name: 'Flood Roofing Ltd', email: 'office@flood.nz', phone: '09 430 0000' },
      jms_keys: { fergus: 'fergus-test-key' },
      quote_defaults: { email: { accept_to: 'office@flood.nz', copy_all: 'boss@flood.nz' } } },
    { user_id: 'u2', company_id: 'c2', updated_at: ago(1),
      branding: { company_name: 'Off Co', email: 'office@off.nz' },
      quote_defaults: { email: { accept_to: 'office@off.nz', decline_on: false } } },
  ],
  comms_tasks: [], job_messages: [],
  jobs: [
    // 3305's shape: accepted, and the browser never called accept-email.
    job('j-acc', quote({ inclExtras: [ { id: 'ix1', name: 'Leaf diverters', price: 180 } ] })),
    // the same again, where the browser DOES manage the PDF call
    job('j-pdf', quote({ ref: '3306', share: { token: 'tok-pdf', status: 'sent', sentAt: ago(1),
      sentTo: 'richard@example.com', sentTotal: 24500.5, events: [] } })),
    // 3320's shape: a decline
    job('j-dec', quote({ ref: '3320', client: 'Dot Bolous', email: 'dot@example.com',
      share: { token: 'tok-dec', status: 'sent', sentAt: ago(1), sentTo: 'dot@example.com',
               sentTotal: 18250, events: [] } })),
    // a decline on a company that switched the email off
    job('j-decoff', Object.assign(quote({ ref: '3321',
      share: { token: 'tok-decoff', status: 'sent', sentAt: ago(1), sentTo: 'x@example.com', events: [] } }))),
    // a Fergus-linked job, for the accepted PDF and the job description
    job('j-fg', quote({ ref: '3310', client: 'Fergus Linked',
      proposalOptions: { steelGrade: 'maxam', profile: 'corrugate', steelThickness: '40',
                         colour: 'Mist Green', gutterType: 'box125', gutterBracket: 'external',
                         downpipes: 'yes', disposal: 'dispose' },
      share: { token: 'tok-fg', status: 'sent', sentAt: ago(1), sentTo: 'fg@example.com',
               sentTotal: 40000, events: [],
               fergus: { jobId: 'FJ-77', rev: 1, title: 'Quote 3310' },
               priced: { v: 1, gstRate: 15, inclx: [ { id: 'ix2', name: 'Coloured downpipes', price: 320 } ] } },
      // the live list moved after the send; the stamped one is what was accepted
      inclExtras: [ { id: 'ix2', name: 'Coloured downpipes', price: 999 } ] })),
    // 3303's shape: a question
    job('j-q', quote({ ref: '3303', client: 'Dot Bolous', email: 'dot@example.com',
      share: { token: 'tok-q', status: 'sent', sentAt: ago(1), sentTo: 'dot@example.com', events: [] } })),
    // An acceptance from BEFORE the floor: its email went out the old way and
    // must not be sent again. acceptOfficeAt is a new stamp, so without the
    // floor every acceptance in the window reads as "never told".
    job('j-ancient', quote({ ref: '3100', client: 'Ancient Job',
      accepted: { name: 'Ancient Job', at: ago(9), total: 9000 },
      share: { token: 'tok-anc', status: 'accepted', sentAt: ago(12), acceptedAt: ago(9),
               sentTo: 'ancient@example.com', sentTotal: 9000, events: [] } })),
    // an acceptance the office was never told about, for the hourly net
    job('j-old', quote({ ref: '3200', client: 'Older Job',
      accepted: { name: 'Older Job', at: ago(2), total: 31000 },
      share: { token: 'tok-old', status: 'accepted', sentAt: ago(9), acceptedAt: ago(2),
               sentTo: 'older@example.com', sentTotal: 31000, events: [] } })),
  ],
});
db.jobs.find(j => j.id === 'j-decoff').company_id = 'c2';
db.jobs.find(j => j.id === 'j-decoff').user_id = 'u2';

// Fergus is reached two ways and both need a seam: the job read and the
// description write go through httpsRequest (__TEST_HTTPS), and the attachment
// upload uses global fetch directly, because it is multipart.
const fergus = { desc: [], files: [], job: { id: 'FJ-77', description: 'Customer rang about a leak.' } };
globalThis.__TEST_HTTPS = (host, path, method, headers, body) => {
  if (!/fergus/.test(String(host))) return Promise.resolve({ status: 500, body: '{}' });
  if (method === 'GET' && /^\/jobs\/FJ-77$/.test(path))
    return Promise.resolve({ status: 200, body: JSON.stringify({ data: fergus.job }) });
  if (method === 'PATCH' && /^\/jobs\/FJ-77$/.test(path)){
    fergus.desc.push(String((body || {}).description || ''));
    fergus.job.description = String((body || {}).description || '');
    return Promise.resolve({ status: 200, body: '{"ok":true}' });
  }
  // the auto-version's quote create / list, which rides along on an accept
  return Promise.resolve({ status: 200, body: JSON.stringify({ data: [] }) });
};
const _realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => {
  if (String(u).indexOf('api.fergus.com') >= 0){
    fergus.files.push({ url: String(u) });
    return Promise.resolve(new Response(JSON.stringify({ data: { id: 'ATT-1' } }),
      { status: 201, headers: { 'content-type': 'application/json' } }));
  }
  return _realFetch(u, o);
};
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <support@roofmap.co.nz>';
process.env.ADMIN_TOKEN = 'ce-test-token';
process.env.ACCEPT_OFFICE_GRACE_MS = '300';     // the real wait is 90 s
// The floor sits BETWEEN the two fixtures above, so one run pins both
// directions: j-old (2 days) is owed, j-ancient (9 days) is history.
process.env.ACCEPT_OFFICE_FROM = new Date(Date.now() - 3 * 86400000).toISOString();
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
const PORT = process.env.TEST_PORT || '34971';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn, err = console.error;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn; console.error = err;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) });
const TOK = jwt.sign({ id: 'u1', email: 'owner@flood.nz', cid: 'c1' }, 'test-secret');
const auth = (m, p, b) => fetch(BASE + p, { method: m,
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOK },
  body: b === undefined ? undefined : JSON.stringify(b) });
const settle = (ms) => new Promise(r => setTimeout(r, ms || 900));
const to = (addr) => sent.filter(m => String(m.to || '').split(/,\s*/).includes(addr));
// A tripwire has to survive its own first failure, or it proves one pin and
// dies before the rest can report.
const one = (arr) => (arr && arr[0]) || {};
const shareOf = (id) => ((db.jobs.find(j => j.id === id) || {}).draw_state || {}).state.quote.share || {};

// ── AN ACCEPT THE CUSTOMER'S BROWSER NEVER FINISHES ──────────────────
sent.length = 0;
let r = await post('/q/tok-x/event?job=j-acc', { type: 'accepted', name: 'Richard Rudolph', total: 24500.50 });
check('the accept is recorded', r.status === 200, 'status ' + r.status);
let office = to('office@flood.nz');
check('…and nothing has reached the office yet, inside the grace period',
  office.length === 0, JSON.stringify(office.map(m => m.subject)));
await settle();
office = to('office@flood.nz');
check('the office is told anyway, with no help from the customer’s phone',
  office.length === 1 && /Quote accepted/.test(one(office).subject || '') && /3305/.test(one(office).subject || ''),
  JSON.stringify(office.map(m => m.subject)));
check('…with the accepted total, the selections and replies going to the customer',
  /\$24,500\.50/.test(one(office).text || '') && /Colour: Mist Green/.test(one(office).text || '') &&
  one(office).replyTo === 'richard@example.com',
  JSON.stringify({ rt: one(office).replyTo, text: (one(office).text || '').slice(0, 220) }));
check('…and it lists the quote\u2019s included extras with their prices (2026-10-30)',
  /Extra \(included\): Leaf diverters \$180\.00 \+ GST/.test(one(office).text || ''),
  (one(office).text || '').slice(0, 600));
check('…copied to the master copy, and named for the business',
  /boss@flood\.nz/.test(one(office).cc || '') && /Flood Roofing Ltd/.test(one(office).fromName || ''),
  JSON.stringify({ cc: one(office).cc, from: one(office).fromName }));
check('the customer still gets their own confirmation', to('richard@example.com').length === 1);
check('and the share records that the office was told', !!shareOf('j-acc').acceptOfficeAt,
  JSON.stringify(shareOf('j-acc')).slice(0, 200));

// A second accept (a re-tap, a refresh) must not send it all again.
sent.length = 0;
await post('/q/tok-x/event?job=j-acc', { type: 'accepted', name: 'Richard Rudolph', total: 24500.50 });
await settle();
check('a second accept tells the office nothing new', to('office@flood.nz').length === 0,
  JSON.stringify(to('office@flood.nz').map(m => m.subject)));

// ── AND WHEN THE BROWSER DOES MANAGE IT, STILL ONE EMAIL ─────────────
sent.length = 0;
await post('/q/tok-pdf/event?job=j-pdf', { type: 'accepted', name: 'Richard Rudolph', total: 24500.50 });
await post('/q/tok-pdf/accept-email?job=j-pdf', { pdfBase64: Buffer.from('%PDF-1.4 test').toString('base64'), filename: 'Quote 3306.pdf' });
await settle();
office = to('office@flood.nz');
check('the browser’s PDF call and the server’s net are ONE email, not two',
  office.length === 1, office.length + ': ' + JSON.stringify(office.map(m => m.subject)));
check('…and it is the one carrying the PDF',
  !!(one(office).attachment || (one(office).attachments || []).length),
  JSON.stringify(Object.keys(one(office))));

// ── A DECLINE REACHES SOMEBODY ───────────────────────────────────────
sent.length = 0;
r = await post('/q/tok-dec/event?job=j-dec', { type: 'declined' });
await settle();
check('the decline is recorded', r.status === 200 && shareOf('j-dec').status === 'declined',
  'status ' + r.status + ' / ' + shareOf('j-dec').status);
office = to('office@flood.nz');
check('the office is emailed that the quote was declined',
  office.length === 1 && /declined/i.test(one(office).subject || '') && /3320/.test(one(office).subject || ''),
  JSON.stringify(office.map(m => m.subject)));
check('…naming the customer and what the quote was worth',
  /Dot Bolous/.test(one(office).text || '') && /\$18,250\.00/.test(one(office).text || ''),
  (one(office).text || '').slice(0, 300));
check('…and a reply goes straight to them', one(office).replyTo === 'dot@example.com', one(office).replyTo);
check('it also lands on today’s task list, so an unread inbox is not the end of it',
  (db.comms_tasks || []).some(t => t.job_id === 'j-dec' && /Dot Bolous/.test(t.title || '')),
  JSON.stringify((db.comms_tasks || []).map(t => t.title)));
check('and the share records that the office was told', !!shareOf('j-dec').declineOfficeAt);

sent.length = 0;
await post('/q/tok-decoff/event?job=j-decoff', { type: 'declined' });
await settle();
check('an office that switched the decline email off gets no email',
  to('office@off.nz').length === 0, JSON.stringify(to('office@off.nz').map(m => m.subject)));
check('…but the task is still raised — switching an email off is not switching the job off',
  (db.comms_tasks || []).some(t => t.job_id === 'j-decoff'),
  JSON.stringify((db.comms_tasks || []).map(t => t.job_id)));

// ── A QUESTION, AND THE STAMP THAT PROVES IT WENT ────────────────────
sent.length = 0;
r = await post('/q/tok-q/event?job=j-q', { type: 'queried', message: 'Can you start before Christmas?' });
await settle();
office = to('office@flood.nz');
check('a question still reaches the office, and says what was asked',
  office.length === 1 && /Question on quote/.test(one(office).subject || '') &&
  /Can you start before Christmas\?/.test(one(office).text || ''),
  JSON.stringify(office.map(m => m.subject)));
check('…with the reply going to the customer, so the office can answer from its own inbox',
  one(office).replyTo === 'dot@example.com', one(office).replyTo);
check('and the share records it', !!shareOf('j-q').queryOfficeAt);

// ── THE HOURLY NET, for a restart inside the grace period ────────────
sent.length = 0;
let sw = await (await post('/admin/office-owed/run?token=ce-test-token', {})).json().catch(() => ({}));
await settle();
check('the sweep finds an acceptance the office was never told about',
  to('office@flood.nz').length === 1 && /3200/.test(to('office@flood.nz')[0].subject || ''),
  JSON.stringify({ sw, subjects: to('office@flood.nz').map(m => m.subject) }));
// THE ONE THAT WOULD HAVE EMBARRASSED US: every acceptance already in the
// window has no stamp either, so the first sweep would have sent a fortnight
// of duplicates. Anything older than the floor is history, not news.
check('…and leaves every acceptance from before the fix alone',
  !to('office@flood.nz').some(m => /3100/.test(m.subject || '')) && (sw.floored || 0) >= 1,
  JSON.stringify({ floored: sw.floored, subjects: to('office@flood.nz').map(m => m.subject) }));
sent.length = 0;
await (await post('/admin/office-owed/run?token=ce-test-token', {})).json().catch(() => ({}));
await settle();
check('…and a second pass sends nothing, because the first claimed it',
  to('office@flood.nz').length === 0, JSON.stringify(to('office@flood.nz').map(m => m.subject)));

// ── THE CORRESPONDENCE ON A JOB ──────────────────────────────────────
// "i should get an email saying that on job #3303 that dot bolous asked a
// question, show the question and let me reply to them directly ... also keep
// history of that reply inside roofmap so i can see the correspondence".
let conv = await (await auth('GET', '/jobs/j-q/messages')).json();
check('the customer\u2019s question is the first line of the job\u2019s correspondence',
  (conv.messages || []).length === 1 && conv.messages[0].who === 'customer' &&
  /Can you start before Christmas\?/.test(conv.messages[0].body || ''),
  JSON.stringify(conv));
check('\u2026and a Message-ID was chosen for it, which is what a Gmail reply threads onto',
  (db.job_messages || []).some(m => m.job_id === 'j-q' && /^<rm-q.*@roofmap\.co\.nz>$/.test(m.msg_id || '')),
  JSON.stringify((db.job_messages || []).map(m => m.msg_id)));

sent.length = 0;
let rep1 = await (await auth('POST', '/jobs/j-q/messages',
  { body: 'Yes — we have a gap the week of the 8th.' })).json();
await settle();
check('a reply typed in RoofMap is emailed to the customer',
  rep1.ok && rep1.sent === true && to('dot@example.com').length === 1 &&
  /week of the 8th/.test((to('dot@example.com')[0] || {}).text || ''),
  JSON.stringify({ r: rep1, subj: (to('dot@example.com')[0] || {}).subject }));
check('\u2026quoting the question\u2019s Message-ID, so it lands in the same thread in their inbox',
  (db.job_messages || []).some(m => m.who === 'office' && /^<rm-q/.test(m.in_reply_to || '')),
  JSON.stringify((db.job_messages || []).map(m => ({ w: m.who, irt: m.in_reply_to }))));
// THE REPLY COPIES IN WHOEVER WROTE IT AND SHOWS WHAT IT ANSWERS (2026-10-23,
// the owner on job 3303: "it should CC the users email in to the question
// reply and send the reply as an email to the customer showing the customers
// question and the users answer").
{
  const m = to('dot@example.com')[0] || {};
  const ccs = String(m.cc || '').toLowerCase();
  check('\u2026copying in the person who wrote it (owner@flood.nz), beside the Settings \u2192 Email copy to everything',
    /owner@flood\.nz/.test(ccs) && /boss@flood\.nz/.test(ccs) && !/dot@example\.com/.test(ccs), JSON.stringify(m.cc));
  check('\u2026and the email shows the customer\u2019s own question above the answer, in the text and the HTML',
    /Your question[\s\S]*Can you start before Christmas\?[\s\S]*Our answer:[\s\S]*week of the 8th/.test(m.text || '') &&
    /Can you start before Christmas\?/.test(m.html || '') && /Our answer/.test(m.html || '') &&
    (m.html || '').indexOf('Christmas') < (m.html || '').indexOf('week of the 8th'),
    JSON.stringify({ text: (m.text || '').slice(0, 200), html: !!m.html }));
  check('\u2026and the reply says where it went: the customer, and who was copied in',
    rep1.to === 'dot@example.com' && /owner@flood\.nz/.test(rep1.cc || ''), JSON.stringify({ to: rep1.to, cc: rep1.cc }));
}
conv = await (await auth('GET', '/jobs/j-q/messages')).json();
check('\u2026and the thread keeps who it was emailed to and copied to, so the window can say so',
  !!(conv.messages || []).find(m => m.who === 'office' && m.mail_to === 'dot@example.com' && /owner@flood\.nz/.test(m.mail_cc || '')),
  JSON.stringify((conv.messages || []).map(m => [m.who, m.mail_to, m.mail_cc])));
check('\u2026and it is kept, so the office can see the correspondence',
  (conv.messages || []).length === 2 && conv.messages[1].who === 'office' &&
  /week of the 8th/.test(conv.messages[1].body || ''),
  JSON.stringify((conv.messages || []).map(m => m.who)));

// A job in another company is not readable, and an empty reply is refused.
const TOK2 = jwt.sign({ id: 'u2', email: 'owner@off.nz', cid: 'c2' }, 'test-secret');
const other = await fetch(BASE + '/jobs/j-q/messages', { headers: { authorization: 'Bearer ' + TOK2 } });
check('another company cannot read the thread \u2014 it names a customer and quotes their words',
  other.status === 404, 'status ' + other.status);
check('an empty reply is refused rather than emailed',
  (await auth('POST', '/jobs/j-q/messages', { body: '   ' })).status === 400);

// ── THE FERGUS JOB LEARNS WHAT THEY CHOSE ────────────────────────────
// "can it auto automatically upload the accepted quote as it's pdf to the job
// in fergus, can it also add the customers choices ... as the job description
// in fergus automatically". Both halves existed as routes only the OFFICE's
// browser could call, and a customer accepting has no login.
sent.length = 0; fergus.desc.length = 0; fergus.files.length = 0;
await post('/q/tok-fg/event?job=j-fg', { type: 'accepted', name: 'Fergus Linked', total: 40000 });
await post('/q/tok-fg/accept-email?job=j-fg', {
  pdfBase64: Buffer.from('%PDF-1.4 accepted').toString('base64'),
  filename: 'Quote 3310 - Roofing - Fergus Linked.pdf' });
await settle(1200);
check('the accepted quote PDF is uploaded to the Fergus job',
  fergus.files.length === 1 && /attachments/.test(fergus.files[0].url),
  JSON.stringify(fergus.files));
check('…and the share records it, so it cannot be uploaded twice',
  !!shareOf('j-fg').fergusAcceptFileAt, JSON.stringify(shareOf('j-fg').fergusAccept || {}));
const desc = fergus.desc[fergus.desc.length - 1] || '';
check('the job description carries every choice the customer made',
  /Steel grade: Colorsteel MAXAM/.test(desc) && /Roof profile: Corrugate/.test(desc) &&
  /Steel gauge: 0\.40 gauge/.test(desc) && /Colour: Mist Green/.test(desc) &&
  /Guttering: 125mm Colorsteel box gutter/.test(desc) && /Gutter brackets: External/.test(desc) &&
  /Downpipes: Included/.test(desc) && /Existing material: We dispose of it/.test(desc),
  desc.slice(0, 500));
check('…and the included extras, at the price stamped at send',
  /Extra \(included\): Coloured downpipes \$320\.00/.test(desc) && !/999/.test(desc), desc.slice(0, 700));
check('…with the total and who accepted it, above RoofMap\u2019s own marked block',
  /\$40,000\.00/.test(desc) && /Accepted by Fergus Linked/.test(desc) &&
  /Customer rang about a leak\./.test(desc),
  desc.slice(0, 220));
check('and the customer\u2019s own words are kept, not overwritten',
  desc.indexOf('Customer rang about a leak.') < desc.indexOf('Steel grade'),
  desc.slice(0, 120));

// Done once. A second pass must not write it again or attach a second copy.
fergus.files.length = 0; const _descWas = fergus.desc.length;
await post('/q/tok-fg/accept-email?job=j-fg', {
  pdfBase64: Buffer.from('%PDF-1.4 accepted').toString('base64'), filename: 'again.pdf' });
await settle(1200);
check('a second call attaches nothing more and rewrites nothing',
  fergus.files.length === 0 && fergus.desc.length === _descWas,
  JSON.stringify({ files: fergus.files.length, desc: fergus.desc.length, was: _descWas }));

// A job with no Fergus link is simply left alone.
check('a job that is not linked to Fergus is untouched',
  !shareOf('j-acc').fergusAcceptDescAt && !shareOf('j-acc').fergusAcceptFileAt,
  JSON.stringify({ d: shareOf('j-acc').fergusAcceptDescAt, f: shareOf('j-acc').fergusAcceptFileAt }));

await new Promise(r2 => relay.close(r2));
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
