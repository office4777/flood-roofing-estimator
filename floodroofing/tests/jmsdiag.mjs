// The self-service integration diagnostic.
//
// A subscriber whose Fergus link misbehaves should not have to read numbers
// off a settings page to open a ticket. They describe the problem, RoofMap
// runs the requests support would have run by hand, and the findings go to
// the desk. Three things this suite exists to hold:
//
//   1. The caller is answered BEFORE the probing starts. Fergus can take as
//      long as it likes; the roofer is back at work either way.
//   2. The API key never leaves the server. The report says whether one is
//      set and how long it is, and nothing else — a support inbox is not a
//      place to keep somebody's credential.
//   3. It is a paid feature on the same plan as the link it diagnoses.
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

const KEY = 'fergus-secret-key-do-not-leak-0123456789';

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

// Stand in for Fergus, through the outbound-HTTPS seam. Deliberately mixed
// answers, because a report that only ever said "all good" would tell support
// nothing: /jobs is fine, /quotes is forbidden, and the sales-account paths
// are not offered at all — which is the real shape of the Partner API today.
let fergusSawAuth = null, fergusHits = 0, fergusHost = null;
globalThis.__TEST_HTTPS = async (host, path, method, headers) => {
  fergusHits++;
  fergusHost = host;
  fergusSawAuth = (headers || {}).Authorization || null;
  const j = (status, obj) => ({ status, body: JSON.stringify(obj), headers: {} });
  if (path.startsWith('/jobs'))      return j(200, { data: [{ id: 1, title: 'A job' }] });
  if (path.startsWith('/customers')) return j(200, { data: [] });
  if (path.startsWith('/sites'))     return j(200, { data: [{ id: 9 }] });
  if (path.startsWith('/users'))     return j(200, { data: [{ id: 3 }] });
  if (path.startsWith('/quotes'))    return j(403, { message: 'Not permitted for this key' });
  return j(404, { message: 'Not found' });
};

const CO = 'cccccccc-1111-1111-1111-111111111111';   // Team — has the link
const CS = 'ssssssss-1111-1111-1111-111111111111';   // Trade — does not
const U  = 'uuuuuuuu-1111-1111-1111-111111111111';
const US = 'uuuuuuuu-2222-2222-2222-222222222222';

const db = {
  companies: [
    { id: CO, name: 'Kauri Roofing', plan: 'team' },
    { id: CS, name: 'One Man Band',  plan: 'solo' },
  ],
  profiles: [{ id: U, company_id: CO, email: 'bob@kauri.co.nz' },
             { id: US, company_id: CS, email: 'sam@oneman.co.nz' }],
  company_users: [{ company_id: CO, user_id: U, role: 'owner' },
                  { company_id: CS, user_id: US, role: 'owner' }],
  user_settings: [
    { user_id: U, company_id: CO, branding: { company_name: 'Kauri Roofing Ltd' },
      jms_keys: { fergus: KEY, fergusMaterialsAccountId: '12345678', fergusLabourAccountId: '87654321' } },
  ],
  subscriptions: [], jobs: [],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.EMAIL_FROM = 'RoofMap <noreply@roofmap.co.nz>';
process.env.SUPPORT_EMAIL = 'support@roofmap.co.nz';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'false';
const PORT = process.env.TEST_PORT || '34655';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;

const tokFor = (u, c) => jwt.sign({ id: u, email: u === U ? 'bob@kauri.co.nz' : 'sam@oneman.co.nz', cid: c },
  'test-secret', { expiresIn: '1h' });
const post = (body, u, c) => fetch(BASE + '/jms/diagnose', {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tokFor(u, c) },
  body: JSON.stringify(body || {}),
});

// ── it will not send an empty ticket ──────────────────────────────
let r = await post({ problem: '   ' }, U, CO);
check('an empty description is refused, not sent as a blank ticket', r.status === 400, 'status ' + r.status);
check('…and nothing was emailed', sent.length === 0, sent.length + ' mails');

// ── the plan gate ─────────────────────────────────────────────────
r = await post({ problem: 'anything' }, US, CS);
check('a plan without the job-system link cannot use its diagnostic',
  r.status === 403, 'status ' + r.status);

// ── the real thing ────────────────────────────────────────────────
const started = Date.now();
r = await post({ problem: 'Pushed a quote this morning and the materials did not come across, only the labour.' }, U, CO);
const body = await r.json();
check('the check is accepted', r.status === 202, 'status ' + r.status + ' ' + JSON.stringify(body));
check('…and says so straight away, so the app stays usable',
  Date.now() - started < 1500, (Date.now() - started) + 'ms to answer');
check('…naming where the report is going', body.queued === true && /support@roofmap\.co\.nz/.test(body.to || ''),
  JSON.stringify(body));

// The probing happens after the answer — wait for the mail to land.
for (let i = 0; i < 60 && !sent.length; i++) await new Promise(x => setTimeout(x, 100));
check('the probing ran after the caller was let go', sent.length === 1, sent.length + ' mails');
check('…and it really asked Fergus, more than once', fergusHits >= 6, fergusHits + ' requests');
check('…with the business\'s own key', fergusSawAuth === 'Bearer ' + KEY, String(fergusSawAuth).slice(0, 20));
check('…against Fergus, not somewhere else', /fergus/i.test(String(fergusHost)), String(fergusHost));

const mail = sent[0] || {};
const blob = JSON.stringify(mail);
check('the report goes to the support desk', /support@roofmap\.co\.nz/.test(String(mail.to || '')), String(mail.to));
check('…with the business named in the subject, so the inbox is sortable',
  /Kauri Roofing/.test(String(mail.subject || '')), String(mail.subject));
check('…and replying to it reaches the person who asked',
  /bob@kauri\.co\.nz/.test(String(mail.replyTo || mail.reply_to || blob)), String(mail.replyTo || '(none)'));

// ── the one that matters: no credential in the report ─────────────
check('THE KEY IS NOT IN THE REPORT — anywhere in it',
  blob.indexOf(KEY) === -1, blob.indexOf(KEY) === -1 ? 'clean' : 'LEAKED at index ' + blob.indexOf(KEY));
check('…while still saying a key is set, and how long it is, which is what support needs',
  /set, 40 characters/.test(blob), (blob.match(/set, \d+ characters/) || ['(not stated)'])[0]);

// ── the findings are worth reading ────────────────────────────────
check('the roofer\'s own words are in it', /materials did not come across/.test(blob));
check('a working endpoint is reported as working', /Jobs/.test(blob) && /OK/.test(blob));
check('…a refusal is reported in words, not just a number',
  /not permitted/i.test(blob), 'looked for the 403 verdict');
check('…and a missing endpoint says it is not offered rather than looking broken',
  /Not offered by this API/.test(blob));
check('the account ids support would otherwise have to ask for are included',
  /12345678/.test(blob) && /87654321/.test(blob));

// ── a business with no key gets a useful report, not a crash ──────
db.user_settings[0].jms_keys = {};
sent.length = 0;
r = await post({ problem: 'Nothing pushes at all.' }, U, CO);
check('a business that never connected Fergus is still accepted', r.status === 202, 'status ' + r.status);
for (let i = 0; i < 60 && !sent.length; i++) await new Promise(x => setTimeout(x, 100));
check('…and support is told the key is missing rather than getting an empty probe',
  sent.length === 1 && /NOT SET/.test(JSON.stringify(sent[0])), sent.length + ' mails');

await new Promise(x => relay.close(x));
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
