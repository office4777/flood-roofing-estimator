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
  profiles: [], user_settings: [], company_users: [], invoices: [],
  jobs: [ mkJob('j-fresh', 'qfresh', ago(7), 20000), mkJob('j-old', 'qold', ago(200), 20000) ],
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
const app = await readFile(_j(_ROOT, 'frontend', 'index.html'), 'utf8');
check('the office stamps sentAt and sentTotal as it makes the link',
  /S\.quote\.share\.sentAt = new Date\(\)\.toISOString\(\)/.test(app) &&
  /S\.quote\.share\.sentTotal = Math\.round\(_sentTot \* 100\) \/ 100/.test(app));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
