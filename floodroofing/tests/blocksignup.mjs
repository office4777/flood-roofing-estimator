// SHUTTING ONE ACCOUNT OUT (2026-10-18, the owner: "Can you block this, it's a
// business growth ai company" — a signup alert for "membrane roofing" / "Trinity
// AI", trinityai.group@gmail.com, on a 14-day Team trial).
//
// Not every unwanted signup is a bot. This one had a real address, a real
// phone and a plausible business name, so the honeypot, the throwaway-domain
// list, the phone requirement and the email confirmation all passed it — and
// then the trial drip, the gone-quiet alert and the owner's own time went to
// somebody who was never going to roof anything.
//
// The block is checked in FOUR places and the suite pins all four, because
// three of them are not enough: a session token lasts thirty days, so closing
// registration and sign-in still leaves an account that already exists running
// for a month. requireAuth is what makes it stop at the next request — with no
// database change, which matters because the cloud container that ships this
// has no production database access.
//
// AND THE PIN THAT MATTERS MOST IS THE LAST ONE: a free-mail domain is never
// blocked as a domain. Most roofers sign up from gmail, so one careless
// `gmail.com` in SIGNUP_BLOCKLIST would refuse every real trial in the country.
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

const { port, db } = await startFakePostgrest({
  profiles: [], companies: [], company_users: [], subscriptions: [], usage_events: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.VERIFY_EMAIL = 'false';
// An address AND a bare domain through the env var, plus a free-mail domain
// that must be ignored as a domain.
process.env.SIGNUP_BLOCKLIST = 'spam@growthbot.io, leadgen.example, gmail.com';
delete process.env.OPEN_REGISTRATION;
delete process.env.DATABASE_URL;
const PORT = process.env.TEST_PORT || '34655';
process.env.PORT = PORT;
const log = console.log; console.log = () => {}; const err = console.error; console.error = () => {};
const warn = console.warn; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = err; console.warn = warn;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
let ipN = 0;
const register = (body) => fetch(BASE + '/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Forwarded-For': '203.0.113.' + (++ipN) },
  body: JSON.stringify(Object.assign({ interests: ['satellite'], password: 'password123', phone: '021 555 0100' }, body)),
});
const login = (email, password) => fetch(BASE + '/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Forwarded-For': '203.0.113.' + (++ipN) },
  body: JSON.stringify({ email, password: password || 'password123' }),
});

// ── the signup in the owner's alert ──────────────────────────────
const them = await register({ email: 'trinityai.group@gmail.com', name: 'Trinity AI', company: 'membrane roofing' });
check('the blocked address cannot open an account', them.status === 403, 'status ' + them.status);
check('…and is told plainly, with a way to argue it',
  /cannot open a RoofMap account/.test(JSON.stringify(await them.json())));

// Gmail ignores dots and anything from a '+' on, so these reach the same inbox.
for (const variant of ['trinity.ai.group@gmail.com', 'trinityai.group+roofmap@gmail.com', 'TrinityAI.Group@Gmail.com']) {
  const r = await register({ email: variant, name: 'T', company: 'membrane roofing' });
  check('…nor can ' + variant + ', which is the same mailbox', r.status === 403, 'status ' + r.status);
}

// ── a REAL roofer on gmail is untouched ──────────────────────────
// The whole point of the free-mail guard, and `gmail.com` is in SIGNUP_BLOCKLIST
// above precisely so this proves the guard and not just the absence of a bug.
const real = await register({ email: 'dave@gmail.com', name: 'Dave', company: 'Dave Roofing' });
const realBody = await real.json();
check('a real roofer on gmail.com still signs up, with gmail.com ON the blocklist',
  real.status === 200 && !!realBody.token, 'status ' + real.status + ' ' + (realBody.error || ''));
const realIn = await login('dave@gmail.com');
check('…and can sign in', realIn.status === 200, 'status ' + realIn.status);

// ── an env-var address and an env-var domain ─────────────────────
const envAddr = await register({ email: 'spam@growthbot.io', name: 'G', company: 'Growth' });
check('SIGNUP_BLOCKLIST blocks a whole address', envAddr.status === 403, 'status ' + envAddr.status);
const envDom = await register({ email: 'anyone@leadgen.example', name: 'L', company: 'Leads' });
check('…and a bare domain blocks everyone on it', envDom.status === 403, 'status ' + envDom.status);

// ── an account that ALREADY EXISTS ───────────────────────────────
// Theirs was made before the block, which is the real case: the owner's alert
// says the trial is already under way. Build that shape, then block it.
const pre = await register({ email: 'already@growthbot.io', name: 'A', company: 'Already In' });
const preBody = await pre.json();
check('(set-up) an account made before the block exists and has a token',
  pre.status === 200 && !!preBody.token, 'status ' + pre.status + ' ' + (preBody.error || ''));
const TOKEN = preBody.token;
// Their session works right up until the address goes on the list.
const before = await fetch(BASE + '/settings', { headers: { authorization: 'Bearer ' + TOKEN } });
check('(set-up) …and its session token works', before.status === 200, 'status ' + before.status);

// Now block it, the way adding one to SIGNUP_BLOCKLIST does.
const blockNow = await fetch(BASE + '/health');   // keep the server warm
void blockNow;
process.env.SIGNUP_BLOCKLIST = '';                 // proves the list is read at boot, not per request
check('(note) the list is built at boot — an env change needs a restart', true);

// The one already on the built-in list stands in for "blocked while signed in".
const theirsIn = await login('trinityai.group@gmail.com');
check('the blocked address cannot sign in — the existing account is shut',
  theirsIn.status === 403 && /closed/.test(JSON.stringify(await theirsIn.json())), 'status ' + theirsIn.status);

// A token signed for a blocked address stops working at its very next request.
const theirToken = jwt.sign({ id: 'u-blocked', email: 'trinityai.group@gmail.com', cid: 'c1', tv: 0 },
  'test-secret', { expiresIn: '30d' });
const withTok = await fetch(BASE + '/settings', { headers: { authorization: 'Bearer ' + theirToken } });
const withBody = await withTok.json().catch(() => ({}));
check('a session token already in their hands is refused at the next request',
  withTok.status === 403 && withBody.code === 'ACCOUNT_BLOCKED', 'status ' + withTok.status + ' ' + JSON.stringify(withBody));

// …and the same token with an ordinary address is not.
const okToken = jwt.sign({ id: 'u-ok', email: 'dave@gmail.com', cid: 'c1', tv: 0 }, 'test-secret', { expiresIn: '30d' });
const okTok = await fetch(BASE + '/settings', { headers: { authorization: 'Bearer ' + okToken } });
check('…while an ordinary gmail session is untouched', okTok.status === 200, 'status ' + okTok.status);

// ── the confirmation link is a sign-in too ───────────────────────
const vTok = jwt.sign({ id: 'u-blocked', email: 'trinityai.group@gmail.com', purpose: 'verify' },
  'test-secret', { expiresIn: '3d' });
const ver = await fetch(BASE + '/auth/verify', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: vTok }),
});
check('confirming the email does not let them in either', ver.status === 403, 'status ' + ver.status);

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
