// Signing out has to actually end the session.
//
// From the reliability audit: a token is good for thirty days, and clearing
// the browser does not touch it. So a phone left in a ute, or somebody taken
// off the team, kept working access for up to a month and there was nothing
// anyone could do about it. "We cut their access" was not true.
//
// Every session token now carries the number its owner's sessions were issued
// under. Bump the number and every token signed before it stops being
// accepted — on every device at once. Three things bump it: signing out,
// resetting a password, and being removed from a company.
//
// The reset LINK is deliberately not a session token and never was; it is
// checked here too, because a leaked reset email granting API access would be
// the same class of mistake.
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

const CO = 'cccccccc-1111-1111-1111-111111111111';
const OWNER = 'uuuuuuuu-1111-1111-1111-111111111111';
const MATE  = 'uuuuuuuu-2222-2222-2222-222222222222';
const db = {
  companies: [{ id: CO, name: 'Kauri Roofing', plan: 'team' }],
  profiles: [
    { id: OWNER, company_id: CO, name: 'Bob',  email: 'bob@kauri.co.nz',  token_version: 0 },
    { id: MATE,  company_id: CO, name: 'Sam',  email: 'sam@kauri.co.nz',  token_version: 0 },
  ],
  company_users: [{ company_id: CO, user_id: OWNER, role: 'owner' },
                  { company_id: CO, user_id: MATE,  role: 'member' }],
  user_settings: [], subscriptions: [], jobs: [],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.BILLING_ENABLED = 'false';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34712';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;

// A token as the app holds it: signed with the version current at the time.
const tokenFor = (id, email, tv) =>
  jwt.sign({ id, email, cid: CO, tv }, 'test-secret', { expiresIn: '30d' });
const get = (path, tok) => fetch(BASE + path, { headers: { Authorization: 'Bearer ' + tok } });
const post = (path, tok, body) => fetch(BASE + path, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
  body: JSON.stringify(body || {}) });
// The cache holds a version for a minute; these tests move faster than that,
// so give the server a moment where a revocation has to be seen.
const settle = () => new Promise(r => setTimeout(r, 60));

// ── an ordinary session works ─────────────────────────────────────
let bob = tokenFor(OWNER, 'bob@kauri.co.nz', 0);
let r = await get('/jobs', bob);
check('a signed-in roofer can use the app', r.status === 200, 'status ' + r.status);

// ── an OLD token, from before this shipped, still works ───────────
// Every token already in a browser was signed without the number at all.
// Those people must not all be thrown out the moment this deploys.
const legacy = jwt.sign({ id: OWNER, email: 'bob@kauri.co.nz', cid: CO }, 'test-secret', { expiresIn: '30d' });
r = await get('/jobs', legacy);
check('a token issued before this existed is still accepted, so nobody is thrown out on deploy',
  r.status === 200, 'status ' + r.status);

// ── signing out ends it, everywhere ───────────────────────────────
const phone = tokenFor(OWNER, 'bob@kauri.co.nz', 0);   // the same session on a second device
r = await post('/auth/logout', bob);
check('signing out is accepted', r.status === 200, 'status ' + r.status);
check('…and the change is recorded against the person, not the device',
  db.profiles[0].token_version === 1, 'version ' + db.profiles[0].token_version);
await settle();
r = await get('/jobs', bob);
check('THE FIX: the token that signed out stops working', r.status === 401, 'status ' + r.status);
r = await get('/jobs', phone);
check('…and so does the same session on the other device — the phone in the ute',
  r.status === 401, 'status ' + r.status);
const body = await r.json();
check('…saying which of the two 401s this is, so the app can tell them apart',
  body.code === 'SESSION_ENDED', JSON.stringify(body));

// ── and signing back in works ─────────────────────────────────────
bob = tokenFor(OWNER, 'bob@kauri.co.nz', 1);
r = await get('/jobs', bob);
check('signing in again gets a token that works', r.status === 200, 'status ' + r.status);

// ── one person signing out does not touch anyone else ─────────────
const sam = tokenFor(MATE, 'sam@kauri.co.nz', 0);
r = await get('/jobs', sam);
check('a teammate is unaffected by someone else signing out', r.status === 200, 'status ' + r.status);

// ── taking someone off the team takes their access ────────────────
r = await fetch(BASE + '/team/members/' + MATE, { method: 'DELETE',
  headers: { Authorization: 'Bearer ' + bob } });
check('the owner can remove a teammate', r.status === 200, 'status ' + r.status);
check('…and that ends their sessions', db.profiles[1].token_version === 1,
  'version ' + db.profiles[1].token_version);
await settle();
r = await get('/jobs', sam);
check('THE FIX: a removed teammate stops working immediately, not in thirty days',
  r.status === 401, 'status ' + r.status);

// ── the reset link is not a session ───────────────────────────────
const resetLink = jwt.sign({ id: OWNER, email: 'bob@kauri.co.nz', purpose: 'pwreset' },
  'test-secret', { expiresIn: '30m' });
r = await get('/jobs', resetLink);
check('a password-reset link is not an API key', r.status === 401, 'status ' + r.status);

// ── signing out needs to be you ───────────────────────────────────
r = await fetch(BASE + '/auth/logout', { method: 'POST' });
check('signing out without a token is refused rather than doing something to somebody',
  r.status === 401, 'status ' + r.status);

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
