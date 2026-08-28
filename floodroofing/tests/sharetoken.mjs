// The customer quote link is a bearer credential, and since invoicing went in,
// accepting one raises a deposit invoice and may auto-email it. Two things
// followed from that and this suite pins both down:
//
//   1. The link never expired. A quote forwarded on, or sitting in a mailbox
//      somebody else now reads, could still be accepted years later. It now
//      stops accepting after 90 days — but still OPENS, because a customer
//      re-reading what they accepted is legitimate.
//   2. The accepted total is whatever the customer's browser says it is. It is
//      now weighed against the figure the office actually sent, and a total
//      that cannot be a real answer never auto-sends an invoice.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const DAY = 86400000;
const ago = d => new Date(Date.now() - d * DAY).toISOString();
// Two jobs, same shape, different ages: one sent last week, one sent 200 days ago.
const mkJob = (id, token, sentAt, sentTotal) => ({
  id, user_id: 'u1', company_id: 'c1', client_name: 'C', site_address: 'A',
  created_at: sentAt, updated_at: sentAt,
  draw_state: { state: { quote: {
    client: 'C', gstRate: 15,
    share: { token, status: 'sent', sentAt, sentTotal, events: [{ type: 'opened', at: sentAt }] },
  } } },
});

const { port } = await startFakePostgrest({
  profiles: [], company_users: [], invoices: [], platform_state: [],
  user_settings: [{ user_id: 'u1', company_id: 'c1', branding: { company_name: 'Kauri Roofing Ltd', email: 'office@kauri.nz' },
                    quote_defaults: {}, jms_keys: {}, price_book: {}, labour_pricing: {}, updated_at: new Date().toISOString() }],
  jobs: [ mkJob('j-fresh', 'qfresh', ago(7), 20000), mkJob('j-old', 'qold', ago(200), 20000),
          // Never opened, never saved through this process — the durable
          // token map is the only way to find it without the 8-second-fated
          // token scan. Its map row is seeded below, as a save would have.
          mkJob('j-mapped', 'qmapped', ago(2), 15000),
          // Made by the TEAMMATE (u2), same company. The customer link must
          // still carry the company's branding, not placeholders.
          Object.assign(mkJob('j-team', 'qteam', ago(1), 9000), { user_id: 'u2' }) ],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34601';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const view  = t => fetch(BASE + '/q/' + t);
const event = (t, body) => fetch(BASE + '/q/' + t + '/event', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// ── a link inside its window works exactly as before ──────────────
let r = await view('qfresh'); let d = await r.json();
check('a recent link opens', r.status === 200 && !!d.quote, 'status ' + r.status);
check('…and does not report itself expired', d.expired === false, JSON.stringify(d.expired));
check('…and says when it will stop accepting', !!d.expiresAt, d.expiresAt);
r = await event('qfresh', { type: 'accepted', name: 'Bob', total: 20000 });
check('…and can still be accepted', r.status === 200, 'status ' + r.status);

// ── a 200-day-old link still opens, but cannot be acted on ────────
r = await view('qold'); d = await r.json();
check('a 200-day-old link STILL OPENS — the customer can re-read it',
  r.status === 200 && !!d.quote, 'status ' + r.status);
check('…but reports itself expired so the page can hide Accept', d.expired === true);

for (const type of ['accepted', 'declined', 'queried']) {
  const rr = await event('qold', { type, name: 'Someone', total: 20000, message: 'hi' });
  const body = await rr.json().catch(() => ({}));
  check('…and refuses "' + type + '" with a message that tells them what to do',
    rr.status === 410 && body.code === 'QUOTE_LINK_EXPIRED' && /get in touch/i.test(body.error || ''),
    rr.status + ' ' + (body.code || ''));
}
r = await event('qold', { type: 'opened' });
check('…while plain analytics still go through', r.status === 200, 'status ' + r.status);
// accept-email checks EMAIL_ENABLED before anything else, and mail is off in
// tests — so a runtime 503 here would prove nothing. Assert the block is in
// that handler, and ahead of the work it guards, from the source instead.
{
  const src0 = await (await import('node:fs/promises')).readFile(_j(_ROOT, 'backend', 'server.js'), 'utf8');
  const h = src0.slice(src0.indexOf("app.post('/q/:token/accept-email'"));
  const body = h.slice(0, h.indexOf('\napp.'));
  check('…and the accept-email route is shut too',
    body.indexOf('QUOTE_LINK_EXPIRED') > 0 && body.indexOf('QUOTE_LINK_EXPIRED') < body.indexOf('_dispatchMail'),
    'guard sits ahead of the send');
}

// ── the browser's total is weighed against what the office sent ───
// Straight from the source, so the band is asserted rather than guessed at
// through the invoice machinery.
const { readFile } = await import('node:fs/promises');
const src = await readFile(_j(_ROOT, 'backend', 'server.js'), 'utf8');
check('a total is judged against the office figure, not taken on trust',
  /function _acceptedTotalPlausible/.test(src) && /\.share\) \|\| \{\}\)\.sentTotal/.test(src));
check('…with no anchor stored, nothing is rejected on a guess',
  /if \(!isFinite\(sent\) \|\| sent <= 0\) return true/.test(src));
check('…and an implausible total never auto-sends an invoice',
  /if \(trustworthy && inv\.auto_send_deposit/.test(src));
check('…though the invoice is still raised, so nothing is silently lost',
  /deposit left as a draft/.test(src) && src.indexOf('const trustworthy') < src.indexOf('if (trustworthy &&'));
check('an accept records BOTH numbers, so a disagreement is visible',
  /sentTotal: Number\(\(share \|\| \{\}\)\.sentTotal\)/.test(src) && /totalVerified: _acceptedTotalPlausible/.test(src));
check('an ancient link is never handed a fresh window by falling back to now()',
  !/sh\.sentAt \|\| first \|\| Date\.now\(\)/.test(src) &&
  /sh\.sentAt \|\| first \|\| \(job \|\| \{\}\)\.created_at/.test(src));

// ── the office stamps the anchor when it makes the link ───────────
const app = await readFile(_j(_ROOT, 'frontend', 'app.html'), 'utf8');
check('the office stamps sentAt and sentTotal as it makes the link',
  /S\.quote\.share\.sentAt = new Date\(\)\.toISOString\(\)/.test(app) &&
  /S\.quote\.share\.sentTotal = Math\.round\(_sentTot \* 100\) \/ 100/.test(app));

// ── the durable token→job map (the 60-second "Loading your quote") ──
// Without DATABASE_URL there is no share-token index, and the token scan
// dies on Supabase's 8-second PostgREST statement timeout — the customer
// stared at the splash for a minute of retries. Every save now persists
// token → job id into platform_state, and the lookup reads it back before
// ever considering the scan.
const _req2 = (await import('node:module')).createRequire(_j(_ROOT, 'backend') + '/');
const tok2 = _req2('jsonwebtoken').sign({ id: 'u1', email: 'a@b.c', cid: 'c1' }, 'test-secret', { expiresIn: '1h' });
const pstate = async (key) => {
  const rr = await fetch('http://127.0.0.1:' + port + '/rest/v1/platform_state?key=eq.' + encodeURIComponent(key),
    { headers: { apikey: 'k' } });
  const rows = await rr.json().catch(() => []);
  return rows[0] || null;
};
let r2 = await fetch(BASE + '/jobs/j-fresh/quote', { method: 'PUT',
  headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok2 },
  body: JSON.stringify({ quote: { client: 'C', gstRate: 15,
    share: { token: 'qfresh', status: 'sent', sentAt: ago(7), sentTotal: 20000, events: [] } } }) });
check('saving a quote records its token in the durable map', r2.status === 200, 'status ' + r2.status);
await new Promise(res2 => setTimeout(res2, 300));   // the persist is fire-and-forget
let row = await pstate('qtok:qfresh');
check('…as platform_state qtok:<token> → job id',
  !!row && row.value && row.value.jobId === 'j-fresh', JSON.stringify(row));

// A whole-job save (the autosave path) carries the quote inside draw_state —
// it maintains the map too.
r2 = await fetch(BASE + '/jobs/j-old', { method: 'PUT',
  headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok2 },
  body: JSON.stringify({ draw_state: { state: { quote: { client: 'C', gstRate: 15,
    share: { token: 'qold', status: 'sent', sentAt: ago(200), sentTotal: 20000, events: [] } } } } }) });
check('a whole-job autosave maintains the map as well', r2.status === 200, 'status ' + r2.status);
await new Promise(res2 => setTimeout(res2, 300));
row = await pstate('qtok:qold');
check('…same row shape', !!row && row.value && row.value.jobId === 'j-old', JSON.stringify(row));

// A link whose mapping already exists resolves without the scan: the map row
// for a job this process has never touched, opened cold.
await fetch('http://127.0.0.1:' + port + '/rest/v1/platform_state', { method: 'POST',
  headers: { 'content-type': 'application/json', apikey: 'k', Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify({ key: 'qtok:qmapped', value: { jobId: 'j-mapped' }, updated_at: new Date().toISOString() }) });
r2 = await view('qmapped'); const d2 = await r2.json();
check('a cold open with a mapped token resolves — no hint, no scan needed',
  r2.status === 200 && !!d2.quote, 'status ' + r2.status);

// ── the office's own opens are not the customer's ──────────────────
// The app's Open button and link-verify probe pass preview=1: the quote is
// served in full, and NOTHING is recorded — no status flip, no open count,
// no event, so no notification reaches the office's bell for its own look.
const beforePrev = await (await view('qmapped')).json();   // a real open first
await new Promise(res2 => setTimeout(res2, 200));
const countBefore = async () => {
  const rr = await fetch('http://127.0.0.1:' + port + '/rest/v1/jobs?id=eq.j-mapped', { headers: { apikey: 'k' } });
  const rows = await rr.json();
  const sh = rows[0].draw_state.state.quote.share;
  return { status: sh.status, openCount: sh.openCount || 0, events: (sh.events || []).length };
};
let snap1 = await countBefore();
r2 = await fetch(BASE + '/q/qmapped?preview=1');
check('a preview open serves the quote in full', r2.status === 200 && !!(await r2.json()).quote);
await new Promise(res2 => setTimeout(res2, 300));
let snap2 = await countBefore();
check('…and records NOTHING — no count, no status, no event',
  snap2.status === snap1.status && snap2.openCount === snap1.openCount && snap2.events === snap1.events,
  JSON.stringify({ before: snap1, after: snap2 }));
check('…while the real customer open before it was counted and stamped',
  snap1.status === 'opened' && snap1.openCount >= 1, JSON.stringify(snap1));

// ── the activity feed carries the stamped history the bell reads ───
r2 = await fetch(BASE + '/quote-activity', { headers: { Authorization: 'Bearer ' + tok2 } });
const feed2 = await r2.json();
const fm = (feed2 || []).find(x => x.jobId === 'j-mapped') || {};
check('quote-activity rows carry the events, each with its timestamp',
  Array.isArray(fm.events) && fm.events.length >= 1 &&
  fm.events.every(e => e.type && isFinite(Date.parse(e.at))),
  JSON.stringify(fm.events || []).slice(0, 120));

// ── a teammate's quote is still the company's quote ────────────────
// The job carries the teammate's user_id; the company settings row lives
// under whoever set the business up. Looking branding up by the job owner
// sent this quote to the customer as "Your company" placeholders while the
// office preview looked perfectly branded.
r2 = await view('qteam'); const dTeam = await r2.json();
check('a quote made by a teammate opens', r2.status === 200 && !!dTeam.quote, 'status ' + r2.status);
check('…with the COMPANY\'s branding, not "Your company" placeholders',
  dTeam.branding && dTeam.branding.company_name === 'Kauri Roofing Ltd',
  JSON.stringify(dTeam.branding));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
