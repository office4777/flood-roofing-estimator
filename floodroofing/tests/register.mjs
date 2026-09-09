// Signing up a new business, and the two ways it used to go quietly wrong.
//
//   1. The invite code arrives by email, and a copy out of an email client
//      brings a trailing space or newline with it. The gate compared the raw
//      string, so a correct code came back "Registration is invite-only" —
//      unarguable from the other end, and indistinguishable from a real
//      refusal.
//   2. If the company insert failed, registration still returned 200 with a
//      token and a null company_id. Every table is scoped by company_id, so
//      the account was empty and stayed empty; the only visible trace was a
//      missing row in `companies`. Worse, the email was now taken, so the
//      person could neither sign up again nor be helped.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j, } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const { port, db } = await startFakePostgrest({
  profiles: [], companies: [], company_users: [], subscriptions: [], usage_events: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.REGISTRATION_INVITE_CODE = 'ROOFMAP-2026';
// A stand-in for the mail relay so a signup can send its confirmation link.
import http from 'node:http';
const sent = [];
const relay = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => { try { sent.push(JSON.parse(body)); } catch (e) { sent.push({ raw: body }); }
    res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + relay.address().port;
process.env.GAS_MAIL_TOKEN = 'tok';
process.env.VERIFY_EMAIL = 'false';   // switched on further down
const ADMIN = 'admin-token-for-the-suite';
process.env.ADMIN_TOKEN = ADMIN;
delete process.env.OPEN_REGISTRATION;
const PORT = process.env.TEST_PORT || '34611';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {}; const err = console.error; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = err;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
let ipN = 0;
const register = (body) => fetch(BASE + '/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Forwarded-For': '198.51.100.' + (++ipN) },
  body: JSON.stringify(body),
});

// ── the front door is open ───────────────────────────────────────
// RoofMap is sold as "start free, 14 days, no card", and a signup form that
// answers "invite-only" is not that. The reason it was shut — a stranger
// spending the server's Anthropic credit through /claude/* — is capped per
// company per day instead.
const noCode = await register({ email: 'walkin@example.com', password: 'password123', phone: '021 555 0100',
  name: 'Walk In', company: 'Walk In Roofing' });
const nc = await noCode.json();
check('somebody with no invite code can sign themselves up',
  noCode.status === 200 && !!nc.token, 'status ' + noCode.status + ' ' + (nc.error || ''));
check('…and lands on a real 14-day trial, not a pending account with nothing on it',
  (function(){
    var sub = db.subscriptions.find(function(x){ return x.user_id === (nc.user || {}).id; });
    if (!sub) return false;
    var left = new Date(sub.trial_ends_at) - Date.now();
    return sub.status === 'trialing' && left > 13 * 864e5 && left <= 14 * 864e5;
  })(), JSON.stringify(db.subscriptions.slice(-1)));

const padded = await register({
  email: 'team1@example.com', password: 'password123', phone: '021 555 0100', name: 'Sam',
  company: 'Sam Roofing', invite: '  ROOFMAP-2026\n',
});
const pd = await padded.json();
check('a code pasted out of an email, whitespace and all, gets in',
  padded.status === 200 && !!pd.token, 'status ' + padded.status + ' ' + (pd.error || ''));

// ── what a successful signup leaves behind ───────────────────────
check('…and it has its own company', !!pd.user && !!pd.user.company_id, JSON.stringify(pd.user || {}));
// Two signups by now — the walk-in above and this one — so these look for
// THIS company rather than assuming it is the only one on the table.
const _sam = db.companies.find(function(c){ return c.name === 'Sam Roofing'; });
check('…named after the business, in `companies`', !!_sam, JSON.stringify(db.companies));
const _samOwner = db.company_users.find(function(m){ return m.company_id === (pd.user || {}).company_id; });
check('…with the owner attached to it',
  !!_samOwner && _samOwner.company_id === (_sam || {}).id && _samOwner.role === 'owner',
  JSON.stringify(db.company_users));

// ── each signup gets its OWN business ────────────────────────────
const second = await register({
  email: 'team2@example.com', password: 'password123', phone: '021 555 0100', name: 'Alex',
  company: 'Alex Roofing', invite: 'ROOFMAP-2026',
});
const sd = await second.json();
check('the next person to use the same code gets a separate business',
  second.status === 200 && sd.user.company_id && sd.user.company_id !== pd.user.company_id,
  JSON.stringify(sd.user || {}));

// ── the rollback ─────────────────────────────────────────────────
db.__failInsert = 'companies';
const broken = await register({
  email: 'orphan@example.com', password: 'password123', phone: '021 555 0100', name: 'Jo',
  company: 'Jo Roofing', invite: 'ROOFMAP-2026',
});
const bd = await broken.json();
delete db.__failInsert;
check('a signup that cannot get a company is an error, not a 200 with no company',
  broken.status >= 400 && !bd.token, 'status ' + broken.status + ' ' + JSON.stringify(bd));
check('…and says so in words the person can act on',
  /nothing was saved/i.test(bd.error || ''), bd.error);
check('…leaving no half-made login behind, so the retry can work',
  !(db.__authUsers || []).some(u => u.email === 'orphan@example.com') &&
  !db.profiles.some(p => p.email === 'orphan@example.com'),
  JSON.stringify((db.__authUsers || []).map(u => u.email)));

const retry = await register({
  email: 'orphan@example.com', password: 'password123', phone: '021 555 0100', name: 'Jo',
  company: 'Jo Roofing', invite: 'ROOFMAP-2026',
});
const rd = await retry.json();
check('…and the retry goes through', retry.status === 200 && !!rd.user.company_id,
  'status ' + retry.status + ' ' + (rd.error || ''));

// ── onboarding a team from one office ────────────────────────────
// The old cap was five registrations an hour per address, counted before the
// invite gate — so a couple of mistyped codes used up the whole office's
// allowance for the day. Three people signing up from one desk must work.
let blocked = null;
for (let i = 0; i < 3 && !blocked; i++){
  const r = await fetch(BASE + '/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Forwarded-For': '203.0.113.77' },
    body: JSON.stringify({ email: 'staff' + i + '@example.com', password: 'password123', phone: '021 555 0100',
                           company: 'Desk ' + i, invite: 'ROOFMAP-2026' }),
  });
  if (r.status === 429) blocked = i;
}
check('three people can sign up from the same office in one sitting',
  blocked === null, 'blocked at ' + blocked);

// ── "why can't this person log in?" ──────────────────────────────
// From the login screen, a missing account, a wrong password and a
// half-made account all read "Invalid email or password". This is the only
// way to tell them apart, and the only way to finish a half-made one.
const admin = (qs) => fetch(BASE + '/admin/account?token=' + ADMIN + '&' + qs);

const unknown = await (await admin('email=nobody@example.com')).json();
check('an address with no login says so, and says the sign-up never finished',
  unknown.login_exists === false && /never completed/i.test(unknown.summary || ''), unknown.summary);

const whole = await (await admin('email=team1@example.com')).json();
check('a complete account reports its business, so the password is the thing left',
  whole.login_exists === true && whole.company && whole.company.name === 'Sam Roofing' &&
  /password is wrong/i.test(whole.summary || ''), whole.summary);

// A login left with no business — what registration used to produce, and what
// still exists in production for anyone who hit it. It cannot be fixed by
// signing up again, because the email is taken.
db.__authUsers.push({ id: '00000000-0000-4000-8000-000000009999', email: 'halfmade@example.com' });
const half = await (await admin('email=halfmade@example.com')).json();
check('a login with no business is named as exactly that',
  half.login_exists === true && !half.company && /no business/i.test(half.summary || ''), half.summary);
check('…and is not reported as fine', !/complete/i.test(half.summary || ''), half.summary);

const fixed = await (await admin('email=halfmade@example.com&repair=1')).json();
check('…and repair finishes it', fixed.repaired === true && !!fixed.company_id, JSON.stringify(fixed));
check('…which is a real company row with the person attached',
  db.company_users.some(r => r.user_id === '00000000-0000-4000-8000-000000009999' && r.company_id === fixed.company_id),
  JSON.stringify(db.company_users.slice(-1)));
const after = await (await admin('email=halfmade@example.com')).json();
check('…and it now reads as a complete account', /complete/i.test(after.summary || ''), after.summary);

// It says whether an address has an account, which is not public.
const noTok = await fetch(BASE + '/admin/account?email=team1@example.com');
check('without the admin token it is not there at all', noTok.status === 404, 'status ' + noTok.status);
const wrongTok = await fetch(BASE + '/admin/account?token=nope&email=team1@example.com');
check('…and a wrong token is the same', wrongTok.status === 404, 'status ' + wrongTok.status);

// ── keeping bots and throwaways off the front door ───────────────
const nophone = await register({ email: 'nophone@example.com', password: 'password123', name: 'N', company: 'N Roofing' });
check('a signup with no phone number is refused', nophone.status === 400 && /phone/i.test((await nophone.json()).error || ''), 'status ' + nophone.status);
const shortphone = await register({ email: 'shortphone@example.com', password: 'password123', phone: '12', name: 'N', company: 'N Roofing' });
check('…and so is one with a couple of digits typed to get past it', shortphone.status === 400, 'status ' + shortphone.status);
const throwaway = await register({ email: 'x@mailinator.com', password: 'password123', phone: '021 555 0100', name: 'T', company: 'T Roofing' });
const tw = await throwaway.json();
check('a throwaway email address is refused, and told to use the business one',
  throwaway.status === 400 && /business email/i.test(tw.error || ''), 'status ' + throwaway.status + ' ' + (tw.error || ''));
const bot = await register({ email: 'bot@example.com', password: 'password123', phone: '021 555 0100', name: 'B', company: 'B Roofing', website: 'http://spam.example' });
check('a script that fills in the hidden website field is refused', bot.status === 400, 'status ' + bot.status);
check('…and none of those left an account behind',
  !db.profiles.some(p => /nophone|shortphone|mailinator|bot@/.test(p.email)), JSON.stringify(db.profiles.map(p => p.email)));
check('a real signup records the phone number', db.profiles.some(p => p.email === 'walkin@example.com' && p.phone === '021 555 0100'),
  JSON.stringify(db.profiles.find(p => p.email === 'walkin@example.com')));

// ── the email address is confirmed before the first sign-in ──────
process.env.VERIFY_EMAIL = 'true';
sent.length = 0;
const pending = await register({ email: 'kiri@kiriroofing.co.nz', password: 'password123', phone: '027 555 0199', name: 'Kiri Tane', company: 'Kiri Roofing' });
const pj = await pending.json();
await new Promise(r => setTimeout(r, 400));
check('with mail set up, a signup makes the account but hands out no session yet',
  pending.status === 200 && pj.verify === true && !pj.token, JSON.stringify(pj));
const confirmMail = sent.find(m => /Confirm/i.test(m.subject || ''));
const alertMail = sent.find(m => /^New signup:/.test(m.subject || ''));
check('…and the confirmation email goes out', !!confirmMail && confirmMail.to === 'kiri@kiriroofing.co.nz',
  JSON.stringify(sent.map(m => ({ to: m.to, subject: m.subject }))));
check('…and the owner is told a business signed up, with a way to ring them',
  !!alertMail && alertMail.to === 'support@roofmap.co.nz' && /Kiri Roofing/.test(alertMail.subject) && /027 555 0199/.test(alertMail.text || alertMail.body || '') && /not confirmed/.test(alertMail.text || alertMail.body || ''),
  JSON.stringify(alertMail && { to: alertMail.to, subject: alertMail.subject }));
const vlink = ((confirmMail && (confirmMail.text || confirmMail.body || '')) .match(/\/app\?verify=([^\s"<]+)/) || [])[1];
check('…with a link into the app', !!vlink, (confirmMail && (confirmMail.text || confirmMail.body || '')).slice(0, 200));
const login = (body) => fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Forwarded-For': '198.51.100.' + (++ipN) }, body: JSON.stringify(body) });
const early = await login({ email: 'kiri@kiriroofing.co.nz', password: 'password123' });
const ej = await early.json();
check('signing in before confirming is refused, and says why', early.status === 403 && ej.verify_pending === true && /confirm/i.test(ej.error || ''), 'status ' + early.status + ' ' + (ej.error || ''));
sent.length = 0;
const again = await fetch(BASE + '/auth/verify/resend', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'KIRI@kiriroofing.co.nz' }) });
await new Promise(r => setTimeout(r, 400));
check('the link can be sent again', again.status === 200 && sent.length === 1, 'status ' + again.status + ', ' + sent.length + ' mail');
sent.length = 0;
await fetch(BASE + '/auth/verify/resend', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'walkin@example.com' }) });
await new Promise(r => setTimeout(r, 300));
check('…but not for an address that is already confirmed', sent.length === 0, sent.length + ' mail');
const bogus = await fetch(BASE + '/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'nope' }) });
check('a made-up confirmation link is refused', bogus.status === 401, 'status ' + bogus.status);
sent.length = 0;
const ok = await fetch(BASE + '/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: decodeURIComponent(vlink || '') }) });
const oj = await ok.json();
await new Promise(r => setTimeout(r, 400));
check('…and the owner is told the trial is confirmed', sent.some(m => /^Trial confirmed:/.test(m.subject || '') && m.to === 'support@roofmap.co.nz'), JSON.stringify(sent.map(m => m.subject)));
check('the emailed link confirms the address and signs the person in',
  ok.status === 200 && !!oj.token && oj.user && oj.user.company_id, 'status ' + ok.status + ' ' + JSON.stringify(oj).slice(0, 160));
const prof = db.profiles.find(p => p.email === 'kiri@kiriroofing.co.nz');
check('…and the profile records it', prof && prof.verify_pending === false && !!prof.email_verified_at, JSON.stringify(prof));
const later = await login({ email: 'kiri@kiriroofing.co.nz', password: 'password123' });
check('…after which a normal sign-in works', later.status === 200 && !!(await later.json()).token, 'status ' + later.status);
check('…and a sign-in is counted for the daily activity report', db.usage_events.some(e => e.name === 'login' && e.user_id === (oj.user || {}).id), JSON.stringify(db.usage_events.filter(e => e.name === 'login').length));
process.env.VERIFY_EMAIL = 'false';

// ── the list of everyone, for the owner ──────────────────────────
const lst = await fetch(BASE + '/admin/accounts?token=' + ADMIN);
const lj = await lst.json();
check('the owner can list every business, newest first, with a way to ring them',
  lst.status === 200 && lj.count >= 3 && lj.accounts.some(a => a.company === 'Kiri Roofing' && a.email === 'kiri@kiriroofing.co.nz' && a.phone === '027 555 0199' && a.confirmed === 'yes' && /trial|trialing/.test(a.plan + a.status)),
  JSON.stringify((lj.accounts || []).slice(0, 2)));
const html = await fetch(BASE + '/admin/accounts?token=' + ADMIN, { headers: { accept: 'text/html' } });
check('…as a page in a browser', /text\/html/.test(html.headers.get('content-type') || '') && /Kiri Roofing/.test(await html.text()));
const csv = await fetch(BASE + '/admin/accounts?token=' + ADMIN + '&format=csv');
check('…or a spreadsheet', /text\/csv/.test(csv.headers.get('content-type') || '') && /^company,plan/.test(await csv.text()));
check('…and not without the token', (await fetch(BASE + '/admin/accounts')).status === 404);

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
