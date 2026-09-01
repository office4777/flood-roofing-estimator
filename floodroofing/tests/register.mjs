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

// ── the invite gate ──────────────────────────────────────────────
const wrong = await register({ email: 'nope@example.com', password: 'password123', invite: 'WRONG' });
check('a wrong code is still refused', wrong.status === 403, 'status ' + wrong.status);

const padded = await register({
  email: 'team1@example.com', password: 'password123', name: 'Sam',
  company: 'Sam Roofing', invite: '  ROOFMAP-2026\n',
});
const pd = await padded.json();
check('a code pasted out of an email, whitespace and all, gets in',
  padded.status === 200 && !!pd.token, 'status ' + padded.status + ' ' + (pd.error || ''));

// ── what a successful signup leaves behind ───────────────────────
check('…and it has its own company', !!pd.user && !!pd.user.company_id, JSON.stringify(pd.user || {}));
check('…named after the business, in `companies`',
  db.companies.length === 1 && db.companies[0].name === 'Sam Roofing',
  JSON.stringify(db.companies));
check('…with the owner attached to it',
  db.company_users.length === 1 && db.company_users[0].company_id === pd.user.company_id &&
  db.company_users[0].role === 'owner', JSON.stringify(db.company_users));

// ── each signup gets its OWN business ────────────────────────────
const second = await register({
  email: 'team2@example.com', password: 'password123', name: 'Alex',
  company: 'Alex Roofing', invite: 'ROOFMAP-2026',
});
const sd = await second.json();
check('the next person to use the same code gets a separate business',
  second.status === 200 && sd.user.company_id && sd.user.company_id !== pd.user.company_id,
  JSON.stringify(sd.user || {}));

// ── the rollback ─────────────────────────────────────────────────
db.__failInsert = 'companies';
const broken = await register({
  email: 'orphan@example.com', password: 'password123', name: 'Jo',
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
  email: 'orphan@example.com', password: 'password123', name: 'Jo',
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
    body: JSON.stringify({ email: 'staff' + i + '@example.com', password: 'password123',
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

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
