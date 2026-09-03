// When a subscriber hits a bug, somebody has to find out. This is the audit
// for the recorder that makes that true — for server crashes, for escaped
// promises, and for the half that was completely invisible: a JavaScript
// error on somebody else's laptop.
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { pathToFileURL } from 'node:url';

import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const CO = 'cccccccc-1111-1111-1111-111111111111';
const OWNER = 'oooooooo-0000-0000-0000-000000000001';
const db = {
  __missing: [], __fail500: '',
  companies: [{ id: CO, name:'Acme Roofing', slug:null, plan:'business' }],
  company_users: [{ company_id: CO, user_id: OWNER, role:'owner' }],
  profiles: [{ id: OWNER, company_id: CO, name:'Bob', email:'bob@acmeroofing.co.nz' }],
  company_invites: [], company_domains: [], subscriptions: [], jobs: [], user_settings: [],
};
const { port } = await startFakePostgrest(db);

// A webhook that just records what it was told.
const alerts = [];
const hook = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => { try { alerts.push(JSON.parse(b)); } catch(e){ alerts.push({raw:b}); } res.writeHead(200); res.end('{}'); });
});
await new Promise(r => hook.listen(0, '127.0.0.1', r));

process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
// TEST_PORT lets the runner give each suite its own, so suites can
// never collide with each other or with a run already going.
const PORT = process.env.TEST_PORT || '34599';
process.env.PORT = PORT;
process.env.BILLING_ENABLED = 'false';
process.env.PLAN_CACHE_MS = '0';
process.env.ADMIN_TOKEN = 'let-me-in-please-0000';
process.env.ERROR_WEBHOOK_URL = 'http://127.0.0.1:' + hook.address().port + '/hook';
delete process.env.DATABASE_URL;
const jwtLib = require('jsonwebtoken');
const errs = [];
const log = console.log, cerr = console.error;
console.log = () => {}; console.error = (...a) => { errs.push(a.join(' ')); };
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT + '';
const tok = jwtLib.sign({ id: OWNER, email:'bob@acmeroofing.co.nz', cid: CO }, 'test-secret', { expiresIn:'1h' });
const api = async (m, path, body, hdr) => {
  const r = await fetch(BASE + path, { method:m,
    headers: Object.assign({ 'Content-Type':'application/json', Authorization:'Bearer '+tok }, hdr||{}),
    body: body?JSON.stringify(body):undefined });
  return { status:r.status, body: await r.json().catch(()=>null) };
};
const settle = (ms) => new Promise(r => setTimeout(r, ms || 250));

// ── the admin view is shut without a token ──
let r = await fetch(BASE + '/admin/errors');
check('the error log is not readable without the admin token', r.status === 404, String(r.status));
r = await fetch(BASE + '/admin/errors', { headers: { 'x-admin-token': 'wrong-length' } });
check('…nor with the wrong one', r.status === 404, String(r.status));
r = await api('GET', '/admin/errors?token=let-me-in-please-0000');
check('…and open with the right one', r.status === 200 && r.body.build != null, JSON.stringify(r.body && r.body.alerting));
// This suite deliberately boots without DATABASE_URL — and a server booted
// that way now pages the monitor ONCE about it, because in production that
// exact hole was felt as customers waiting a minute for a quote link while
// the config problem sat unread in a console log. So the log starts with
// that one config alert and nothing else.
check('…starting with only the missing-DATABASE_URL config alert',
  r.body.total === 1 && r.body.distinct === 1 &&
  /DATABASE_URL/.test((r.body.recent[0] || {}).message || ''),
  r.body.total + ' recorded: ' + ((r.body.recent[0] || {}).message || '').slice(0, 60));
const alertsAtStart = alerts.length;
check('…which was announced through the alert channel',
  alertsAtStart === 1 && /DATABASE_URL/.test((alerts[0] || {}).message || ''),
  JSON.stringify(alerts.map(a => (a.message || '').slice(0, 40))));

// ── a route that blows up ──
// Force the database to fail so a real route throws for a real reason.
db.__fail500 = 'jobs';
r = await api('GET', '/jobs');
db.__fail500 = '';
await settle();
let adm = (await api('GET', '/admin/errors?token=let-me-in-please-0000')).body;
check('a failing route is recorded', adm.total >= 2, adm.total + ' recorded, ' + adm.distinct + ' distinct');
const first = adm.recent[0] || {};
check('…with where it happened and who hit it',
  /jobs/.test(first.route || first.url || '') && first.company === CO && /bob@/.test(first.user || ''),
  JSON.stringify({ route:first.route, url:first.url, co:!!first.company, user:first.user }));
check('…and the build it happened on', first.build != null && first.build !== '');
check('…and it was announced, once', alerts.length === alertsAtStart + 1,
  JSON.stringify(alerts.map(a => (a.message||'').slice(0,40))));
check('…in a form Slack or Discord would print', typeof (alerts[alerts.length-1]||{}).text === 'string' && /RoofMap/.test(alerts[alerts.length-1].text),
  ((alerts[alerts.length-1]||{}).text||'').split('\n')[0]);

// ── the same failure again is not a second alert ──
const before = alerts.length;
for (let i = 0; i < 4; i++){ db.__fail500 = 'jobs'; await api('GET','/jobs'); db.__fail500 = ''; }
await settle();
adm = (await api('GET','/admin/errors?token=let-me-in-please-0000')).body;
check('the same failure repeating is counted, not re-announced',
  alerts.length === before && adm.groups[0].count >= 5, 'alerts ' + alerts.length + ', count ' + adm.groups[0].count);

// ── a 500 tells the caller nothing useful and everything traceable ──
db.__fail500 = 'jobs';
r = await api('GET', '/jobs');
db.__fail500 = '';
check('a caller gets an incident id, not a stack trace',
  r.status === 500 && !!r.body.incident && !/at \w+ \(/.test(JSON.stringify(r.body)),
  JSON.stringify(r.body));

// ── a frontend crash ──
alerts.length = 0;
r = await fetch(BASE + '/client-error', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ message:"Cannot read properties of null (reading 'getContext')",
    stack:"TypeError: ...\n    at drawRoof (index.html:14002:9)", url:'https://roofmap.co.nz/app',
    where:'roof', company:'Acme Roofing', user:'bob@acmeroofing.co.nz' }) });
check('a browser can report a crash without being signed in', r.status === 200);
await settle();
adm = (await api('GET','/admin/errors?token=let-me-in-please-0000')).body;
const cli = adm.recent.find(x => x.kind === 'client');
check('…and it lands in the same place as a server crash', !!cli, cli && cli.message.slice(0,50));
check('…naming the tab, the company and the person',
  cli && cli.route === 'roof' && /Acme/.test(cli.company) && /bob@/.test(cli.user),
  JSON.stringify({ where: cli && cli.route, co: cli && cli.company }));
check('…and it was announced too', alerts.length === 1);

// ── secrets never reach a log line or a Slack channel ──
alerts.length = 0;
await fetch(BASE + '/client-error', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ message:'save failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.SECRET.sig password=hunter2',
    stack:'at save (index.html:1:1)' }) });
await settle();
adm = (await api('GET','/admin/errors?token=let-me-in-please-0000')).body;
const red = adm.recent[0];
check('a token or password in an error is redacted before it is stored',
  !/eyJhbGciOiJIUzI1NiJ9/.test(red.message) && !/hunter2/.test(red.message) && /redacted/.test(red.message),
  red.message);
check('…and before it is sent anywhere',
  alerts.length === 1 && !/eyJhbGciOiJIUzI1NiJ9|hunter2/.test(JSON.stringify(alerts[0])));

// ── errors of the same shape group together ──
alerts.length = 0;
for (const n of [41, 92, 3099]){
  await fetch(BASE + '/client-error', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ message: 'job ' + n + ' not found', stack: 'at openJob (index.html:9:9)' }) });
}
await settle();
adm = (await api('GET','/admin/errors?token=let-me-in-please-0000')).body;
const grp = adm.groups.find(g => /job <n> not found|job \d+ not found/.test(g.message));
check('the same bug with different job numbers is one problem, not three',
  grp && grp.count === 3, grp && (grp.count + '× ' + grp.message));
check('…and is announced once', alerts.length === 1, String(alerts.length));

// ── a flood of reports from one machine is capped ──
let blocked = 0;
for (let i = 0; i < 45; i++){
  const rr = await fetch(BASE + '/client-error', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ message: 'noise ' + i, stack: 'at x' }) });
  if (rr.status === 429) blocked++;
}
check('one machine cannot flood the log', blocked > 0, blocked + ' of 45 refused');

// ── an escaped promise rejection in a route does not hang the request ──
// (the registration wrapper is what makes this true)
check('a route that answers its own 500 is recorded too, not just a thrown one',
  errs.some(e => /\[error:server-5xx\]/.test(e)), errs.filter(e => /\[error:/.test(e)).length + ' error lines logged');

console.error = cerr;
// ── the database truth endpoint ────────────────────────────────────
// /health's pg flag only says the VARIABLE exists. This one answers what
// matters when a customer link is slow: does the connection work, is the
// share-token index really there, and does a token probe come back in index
// time. (No DATABASE_URL here, so it reports that plainly.)
r = await fetch(BASE + '/admin/db-health');
check('db-health is shut without the admin token', r.status === 404, String(r.status));
r = await api('GET', '/admin/db-health?token=let-me-in-please-0000');
check('…and answers with it', r.status === 200 && r.body && r.body.pg === false, JSON.stringify(r.body).slice(0, 80));
check('…probing the real token-lookup path', r.body.tokenScanProbe && typeof r.body.tokenScanProbe.ms === 'number',
  JSON.stringify(r.body.tokenScanProbe));
r = await api('GET', '/admin/db-health?token=let-me-in-please-0000&migrate=1');
check('…and ?migrate=1 reports why the migration cannot run here',
  r.body.migrate && /DATABASE_URL/.test(r.body.migrate.skipped || ''), JSON.stringify(r.body.migrate));

// ── mail is the one road out, so it is counted ────────────────────
// Quote links, invites, order emails and our own alerts all leave the same
// way. When that closes, quotes stop reaching customers — and before this
// nothing said so: failures were logged at the call site, and nobody reads
// logs on a Tuesday morning. /health now answers "is mail getting out".
{
  const hr = await fetch(BASE + '/health');
  const h = await hr.json();
  check('health says whether mail is getting out at all', !!h.mail, JSON.stringify(h.mail));
  check('…counting what was sent and what failed',
    typeof h.mail.sent === 'number' && typeof h.mail.failed === 'number', JSON.stringify(h.mail));
  check('…and when the last failure was, so it can be acted on',
    'lastErrorAt' in h.mail, JSON.stringify(h.mail));
  // This endpoint is public — no token, and the keep-warm workflow prints it
  // into a build log every five minutes. A bounce message reads "550 5.1.1
  // <someone@theirdomain.co.nz> user unknown", so the reason must NOT be
  // here. Whether mail is getting out is the operational question; why goes
  // to the error monitor, which is addressed to the owner.
  check('…but never WHY, because a bounce carries a customer\'s address and this endpoint is public',
    !('lastError' in h.mail), JSON.stringify(h.mail));
  // An alert about mail being down cannot itself be an email. This says
  // whether another channel is configured to carry it.
  check('…and whether alerts have a way out that is not mail itself',
    typeof h.mail.alertsGoElsewhere === 'boolean', String(h.mail.alertsGoElsewhere));
}

const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass === results.length ? 0 : 1);
