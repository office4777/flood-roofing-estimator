// Early access: the list, and getting people off it.
//
// RoofMap is invite-gated, so this is the front door to the gate. Three things
// have to hold or the funnel is worse than not having one:
//
//   1. A lead that is captured has to actually reach somebody. A form that
//      stores a row and sends no alert is a list nobody works.
//   2. The person has to get a receipt, from the right mailbox, with something
//      in it — that is the one moment they are definitely paying attention.
//   3. Nothing a caller sends can redirect where any of it goes.
//
// Plus the unglamorous half: a repeat submission must improve the row rather
// than duplicate it, because the list is worked by hand.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { readFile } from 'node:fs/promises';
import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Stand in for the Google Apps Script relay and keep what it was handed.
const sent = [];
const relay = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    try { sent.push(JSON.parse(body)); } catch (e) { sent.push({ raw: body }); }
    res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}');
  });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));
const RELAY = 'http://127.0.0.1:' + relay.address().port;

const db = { __missing: [], waitlist: [], usage_events: [], profiles: [], companies: [],
             company_users: [], subscriptions: [], user_settings: [], jobs: [], invoices: [],
             company_invites: [] };
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.GAS_MAIL_URL = RELAY;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <noreply@roofmap.co.nz>';
process.env.ADMIN_TOKEN = 'admin-token-for-tests';
process.env.REGISTRATION_INVITE_CODE = 'ROOFMAP-2026';
process.env.PUBLIC_APP_URL = 'https://roofmap.co.nz';
const PORT = process.env.TEST_PORT || '34613';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;

const post = (path, body, hdrs) => fetch(BASE + path, { method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, hdrs || {}),
  body: typeof body === 'string' ? body : JSON.stringify(body) });
const get = (path, hdrs) => fetch(BASE + path, { headers: hdrs || {} });
const settle = () => new Promise(r => setTimeout(r, 450));
const LEAD = {
  email: 'sam@acmeroofing.co.nz', name: 'Sam', business: 'Acme Roofing Ltd',
  phone: '021 555 0100', region: 'Waikato', volume: '6-10',
  current_software: 'spreadsheet', headache: 'Flashings always come up short on the order.',
  source: 'google / roofing estimating software nz',
};

// ── a roofer asks for access ──────────────────────────────────────
sent.length = 0;
let r = await post('/waitlist', LEAD);
let body = await r.json();
await settle();
check('the request is accepted', r.status === 200 && body.ok === true, 'status ' + r.status);
check('…and stored', db.waitlist.length === 1, db.waitlist.length + ' rows');
const row = db.waitlist[0] || {};
check('…with the qualifying answers, which are the whole point',
  row.business === 'Acme Roofing Ltd' && row.region === 'Waikato' &&
  row.volume === '6-10' && row.current_software === 'spreadsheet',
  [row.business, row.region, row.volume, row.current_software].join(' / '));
check('…and what they came for', /come up short/.test(row.headache || ''), row.headache);
// The fake PostgREST fills `id` and nothing else, so a column DEFAULT never
// materialises here the way it would in Postgres. Check the schema declares
// it, and test the behaviour that carries the real risk further down.
const schema = await readFile(_j(_ROOT, 'backend', 'server.js'), 'utf8');
check('a new row defaults to status new',
  /status text not null default 'new'/.test(schema));
check('…and the email is unique, so the list cannot hold duplicates',
  /create unique index if not exists idx_waitlist_email on public\.waitlist \(lower\(email\)\)/.test(schema));

// ── two emails go out, from the right desks ───────────────────────
check('two emails go out — one to us, one to them', sent.length === 2, sent.length + ' sent');
const alert = sent.find(m => m.to === 'sales@roofmap.co.nz') || {};
const receipt = sent.find(m => m.to === 'sam@acmeroofing.co.nz') || {};
check('the lead alert reaches sales, not support',
  alert.to === 'sales@roofmap.co.nz' && alert.from === 'sales@roofmap.co.nz', alert.to + ' / ' + alert.from);
check('…with Reply pointed at the roofer', alert.replyTo === 'sam@acmeroofing.co.nz', alert.replyTo);
check('…carrying the answers, so it can be triaged from the inbox',
  /Acme Roofing/.test(alert.text || '') && /6-10/.test(alert.text || '') && /spreadsheet/.test(alert.text || ''));
check('…and the command to invite them', /\/admin\/waitlist\/[\w-]+\/invite/.test(alert.text || ''),
  (alert.text || '').split('\n').find(l => /invite/.test(l)));
check('their receipt comes from support', receipt.from === 'support@roofmap.co.nz', receipt.from);
check('…addressed to them by name', /Sam/.test(receipt.html || ''), (receipt.subject || ''));
check('…and gives them something now, not just a promise',
  /roofmap\.co\.nz/.test(receipt.text || '') && /batch/i.test(receipt.text || ''));

// ── the funnel is counted, without a third party ──────────────────
check('the submission is counted as a milestone',
  db.usage_events.some(e => e.name === 'waitlist_submit'),
  db.usage_events.map(e => e.name).join(',') || 'none');
check('…recording the shape of the demand, not the person',
  (function(){
    const e = db.usage_events.find(x => x.name === 'waitlist_submit') || {};
    const p = JSON.stringify(e.props || {});
    return /Waikato/.test(p) && !/sam@/.test(p);
  })());

// ── filling it in twice improves the row, it does not duplicate it ─
sent.length = 0;
r = await post('/waitlist', Object.assign({}, LEAD, { volume: '10+', headache: 'Now I quote five a week.' }));
await settle();
check('a second submission is accepted', r.status === 200, r.status + '');
check('…and updates rather than duplicating', db.waitlist.length === 1, db.waitlist.length + ' rows');
check('…with the newer answer', db.waitlist[0].volume === '10+', db.waitlist[0].volume);

// ── a caller cannot steer any of it ───────────────────────────────
sent.length = 0;
await post('/waitlist', { email: 'other@example.com', name: 'Other', business: 'B',
                          status: 'joined', id: 999, notes: 'injected' });
await settle();
const other = db.waitlist.find(x => x.email === 'other@example.com') || {};
check('a caller cannot set their own status', other.status !== 'joined', String(other.status));
check('…nor write the private notes field', !other.notes, JSON.stringify(other.notes));
check('…and the alert still goes only to sales',
  sent.every(m => m.to === 'sales@roofmap.co.nz' || m.to === 'other@example.com'),
  sent.map(m => m.to).join(','));

// ── bots ──────────────────────────────────────────────────────────
sent.length = 0;
const before = db.waitlist.length;
r = await post('/waitlist', { email: 'bot@spam.example', website: 'http://buy-links.example' });
body = await r.json();
await settle();
check('a filled honeypot is accepted, so the bot learns nothing', r.status === 200 && body.ok === true);
check('…but nothing is stored', db.waitlist.length === before, db.waitlist.length + ' rows');
check('…and nobody is emailed', sent.length === 0, sent.length + ' sent');

r = await post('/waitlist', { email: 'not-an-email', name: 'X' });
check('a bad address is refused', r.status === 400, r.status + '');

// ── the list, for working it ──────────────────────────────────────
r = await get('/admin/waitlist');
check('the list is shut without a token', r.status === 404, r.status + '');
r = await get('/admin/waitlist', { 'x-admin-token': 'wrong-token-entirely' });
check('…and to a wrong one', r.status === 404, r.status + '');
r = await get('/admin/waitlist', { 'x-admin-token': 'admin-token-for-tests' });
body = await r.json();
check('…and open to the right one', r.status === 200 && body.total === 2, 'total ' + (body||{}).total);
check('…with a count per status', body.counts && Object.keys(body.counts).length >= 1,
  JSON.stringify((body||{}).counts));
check('…returning everyone on it', (body.rows||[]).length === 2,
  (body.rows||[]).map(r => r.email).join(' , '));
// created_at is a Postgres default the fake never fills, so the ordering can
// only be checked where it is expressed.
check('…newest first, so the list opens on who just asked',
  /from\('waitlist'\)[\s\S]{0,80}\.order\('created_at', \{ ascending: false \}\)/.test(schema));

r = await get('/admin/waitlist?format=csv', { 'x-admin-token': 'admin-token-for-tests' });
const csv = await r.text();
check('…and exports as CSV so it can actually be worked',
  /text\/csv/.test(r.headers.get('content-type') || '') && /^id,created_at,status,email/.test(csv),
  csv.split('\n')[0].slice(0, 60));
// A roofer writing about a 6" spouting, or using a comma, must not break the
// file open in Excel.
await post('/waitlist', { email: 'quote@example.co.nz', name: 'Quinn',
  business: 'The 6" Spouting Co, Ltd', headache: 'He said "it is fine", it was not.' });
await settle();
r = await get('/admin/waitlist?format=csv', { 'x-admin-token': 'admin-token-for-tests' });
const csv2 = await r.text();
const qline = csv2.split('\r\n').find(l => /quote@example/.test(l)) || '';
check('…doubling any quote inside a field, so one answer cannot break the file',
  qline.includes('""6"" Spouting Co, Ltd""') || qline.includes('"The 6"" Spouting Co, Ltd"'),
  qline.slice(0, 90));
check('…and keeping a comma inside its field rather than splitting the row',
  qline.split('","').length === 14, qline.split('","').length + ' fields');

// ── inviting one of them in ───────────────────────────────────────
const id = db.waitlist.find(x => x.email === 'sam@acmeroofing.co.nz').id;
sent.length = 0;
r = await post('/admin/waitlist/' + id + '/invite', {});
check('inviting is shut without a token', r.status === 404, r.status + '');
r = await post('/admin/waitlist/' + id + '/invite', {}, { 'x-admin-token': 'admin-token-for-tests' });
await settle();
check('…and works with one', r.status === 200, r.status + '');
const inv = sent[0] || {};
check('the invite reaches the roofer', inv.to === 'sam@acmeroofing.co.nz', inv.to);
check('…from sales, where the conversation started', inv.from === 'sales@roofmap.co.nz', inv.from);
check('…carrying the code the signup gate actually checks',
  /ROOFMAP-2026/.test(inv.text || ''), (inv.text || '').split('\n').find(l => /code/i.test(l)));
check('…and the link to use it', /roofmap\.co\.nz\/signup/.test(inv.text || ''));
check('the row is marked invited, with a date',
  db.waitlist.find(x => x.id === id).status === 'invited' && !!db.waitlist.find(x => x.id === id).invited_at,
  db.waitlist.find(x => x.id === id).status);
r = await post('/admin/waitlist/999999/invite', {}, { 'x-admin-token': 'admin-token-for-tests' });
check('inviting somebody who is not on the list is a 404', r.status === 404, r.status + '');

await new Promise(r2 => relay.close(r2));
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
