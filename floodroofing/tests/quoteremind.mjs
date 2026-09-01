// The follow-up a busy office forgets. A quote still sitting at 'sent' or
// 'opened' N days after it went out gets ONE polite reminder — from the
// roofer's own name, with the live quote link — and never a second. Never for
// a customer who asked a question, never after accept/decline, never past the
// 90-day window, and never when the office has the switch off. The chase now
// reaches the smallest plan too — a one-person business is the one least
// likely to get round to it on a Sunday night — but the plan flag is still
// the gate, and the SERVER is where that is true.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Stand in for the mail relay and capture what it is handed.
const sent = [];
const relay = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    try { sent.push(JSON.parse(body)); } catch (e) { sent.push({ raw: body }); }
    res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}');
  });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const share = (over) => Object.assign({ token: 'tok-' + Math.random().toString(36).slice(2, 8),
  sentAt: daysAgo(5), status: 'sent', events: [] }, over || {});
// Seeded rows bypass the fake's insert path, so the now() defaults must be
// spelled out — the sweep's updated_at window filter reads them.
const job = (id, co, user, q) => ({ id, user_id: user, company_id: co, client_name: q.client || 'Client',
  site_address: '1 Roof Rd', created_at: daysAgo(7), updated_at: daysAgo(0),
  draw_state: { state: { quote: q }, form: {} } });

const Q = (over) => Object.assign({ ref: 'FR-' + Math.floor(Math.random() * 9000 + 1000),
  client: 'Mrs Rata', email: 'rata@example.com', addr: '1 Roof Rd', validUntil: '30 days' }, over || {});

const { db, port } = await startFakePostgrest({
  companies: [
    { id: 'c1', name: 'Kauri Roofing', plan: 'team' },
    { id: 'c2', name: 'One Man Band', plan: 'solo' },
    { id: 'c3', name: 'Switched Off Ltd', plan: 'team' },
  ],
  profiles: [{ id: 'u1', company_id: 'c1', email: 'kauri@x.nz' }],
  company_users: [{ company_id: 'c1', user_id: 'u1', role: 'owner' }],
  user_settings: [
    { user_id: 'u1', company_id: 'c1', updated_at: daysAgo(1),
      branding: { company_name: 'Kauri Roofing Ltd', email: 'office@kauri.nz', phone: '09 123 4567' },
      quote_defaults: { email: { reminder_enabled: true, reminder_days: 3, quote_cc: 'office@kauri.nz' } } },
    { user_id: 'u2', company_id: 'c2', updated_at: daysAgo(1),
      branding: { company_name: 'One Man Band' },
      quote_defaults: { email: { reminder_enabled: true, reminder_days: 3 } } },
    { user_id: 'u3', company_id: 'c3', updated_at: daysAgo(1),
      branding: { company_name: 'Switched Off Ltd' },
      quote_defaults: { email: { reminder_enabled: false, reminder_days: 3 } } },
  ],
  jobs: [
    // The two that SHOULD be reminded:
    job('j-unopened', 'c1', 'u1', Q({ ref: 'FR-1001', share: share({ token: 'tok-unopened' }) })),
    job('j-quiet', 'c1', 'u1', Q({ ref: 'FR-1002', email: 'ignored@example.com',
      share: share({ token: 'tok-quiet', status: 'opened', sentAt: daysAgo(6), sentTo: 'sent-to@example.com',
                     events: [{ type: 'opened', at: daysAgo(5) }] }) })),
    // Everyone who must be left alone:
    job('j-queried', 'c1', 'u1', Q({ share: share({ status: 'queried' }) })),
    job('j-accepted', 'c1', 'u1', Q({ share: share({ status: 'accepted', acceptedAt: daysAgo(2) }) })),
    job('j-declined', 'c1', 'u1', Q({ share: share({ status: 'declined' }) })),
    job('j-young', 'c1', 'u1', Q({ share: share({ sentAt: daysAgo(1) }) })),
    job('j-expired', 'c1', 'u1', Q({ share: share({ sentAt: daysAgo(100) }) })),
    job('j-already', 'c1', 'u1', Q({ share: share({ remindedAt: daysAgo(2) }) })),
    job('j-noemail', 'c1', 'u1', Q({ email: '', client: 'No Email', share: share({}) })),
    job('j-nodate', 'c1', 'u1', Q({ share: { token: 'tok-nodate', status: 'sent', events: [] } })),
    job('j-oneman', 'c2', 'u2', Q({ ref: 'FR-1003', email: 'oneman@example.com',
      client: 'One Man', share: share({ token: 'tok-oneman' }) })),
    job('j-off', 'c3', 'u3', Q({ share: share({}) })),
    job('j-noshare', 'c1', 'u1', Q({ share: undefined })),
  ],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <noreply@roofmap.co.nz>';
process.env.ADMIN_TOKEN = 'sweep-test-token';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34631';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;

const runSweep = async () => {
  const r = await fetch(BASE + '/admin/reminders/run', {
    method: 'POST', headers: { 'x-admin-token': 'sweep-test-token' } });
  return { status: r.status, body: await r.json() };
};

// ── no token, no route ────────────────────────────────────────────
let r = await fetch(BASE + '/admin/reminders/run', { method: 'POST' });
check('without the admin token the route plays dead', r.status === 404, 'status ' + r.status);

// ── the sweep ─────────────────────────────────────────────────────
sent.length = 0;
let run = await runSweep();
await new Promise(x => setTimeout(x, 400));
check('the sweep ran and reports its work', run.status === 200 && run.body && isFinite(run.body.sent),
  JSON.stringify(run.body));
check('exactly the three quiet quotes were reminded — nobody else',
  run.body.sent === 3 && sent.length === 3,
  'reported ' + run.body.sent + ', relay saw ' + sent.length);

const byTo = {}; sent.forEach(m => { byTo[m.to] = m; });
check('the never-opened quote went to the customer on the quote',
  !!byTo['rata@example.com'], Object.keys(byTo).join(', '));
check('the opened-then-quiet quote went to the address the ORIGINAL email went to',
  !!byTo['sent-to@example.com'] && !byTo['ignored@example.com'], Object.keys(byTo).join(', '));

const m1 = byTo['rata@example.com'] || {};
check('it reads as a follow-up, with the quote reference',
  /following up/i.test(m1.subject || '') && /FR-1001/.test(m1.subject || ''), m1.subject);
check('…carries the live quote link', /https:\/\/roofmap\.co\.nz\/\?q=tok-unopened/.test(m1.text || ''),
  (m1.text || '').match(/https[^\s]*/) ? (m1.text || '').match(/https[^\s]*/)[0] : '(no link)');
check('…goes out under the ROOFER\'s name', /Kauri Roofing/i.test(m1.fromName || ''), m1.fromName);
check('…with the office CC\'d so they know it went', (m1.cc || '') === 'office@kauri.nz', m1.cc);
check('…and the HTML has the View this Quote button', /View this Quote/.test(m1.html || ''), '');

// ── the claim persisted ───────────────────────────────────────────
const j1 = db.jobs.find(j => j.id === 'j-unopened');
const sh1 = (((j1 || {}).draw_state || {}).state || {}).quote.share || {};
check('remindedAt is written onto the share', !!sh1.remindedAt, JSON.stringify(sh1.remindedAt));
check('…and the reminder shows in the same event feed the bell reads',
  (sh1.events || []).some(e => e.type === 'reminded'), JSON.stringify(sh1.events));

// ── idempotence: run it again ─────────────────────────────────────
sent.length = 0;
run = await runSweep();
await new Promise(x => setTimeout(x, 300));
check('a second sweep sends NOTHING — one reminder per quote, ever',
  run.body.sent === 0 && sent.length === 0, 'sent ' + run.body.sent + ', relay ' + sent.length);

// ── the ones left alone stayed untouched ──────────────────────────
const untouched = ['j-queried', 'j-accepted', 'j-declined', 'j-young', 'j-expired', 'j-noemail', 'j-nodate', 'j-off']
  .filter(id => {
    const j = db.jobs.find(x => x.id === id);
    const sh = ((((j || {}).draw_state || {}).state || {}).quote || {}).share || {};
    return !sh.remindedAt && !(sh.events || []).some(e => e.type === 'reminded');
  });
check('queried, accepted, declined, young, expired, no-email, no-date and switched-off all left alone',
  untouched.length === 8, untouched.length + '/8 untouched');
// The chase moved down a tier with the notifications it belongs with.
check('…while the one-person business DID get its quiet quote chased',
  !!byTo['oneman@example.com'], Object.keys(byTo).join(', '));

await new Promise(r2 => relay.close(r2));
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
