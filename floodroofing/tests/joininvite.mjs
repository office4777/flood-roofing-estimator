// AN INVITATION THAT WAS NEVER CLICKED, and a session stuck in the wrong
// business (2026-10-08).
//
// The owner invited his roofer; the roofer's account opened onto nothing — no
// jobs, and the Fergus connection apparently gone. It was read as "Fergus has
// disconnected on his account". It cannot be: the Fergus key belongs to the
// BUSINESS (`user_settings` is read by company_id), so an account in the
// right business shares the office's key and an account in the wrong one has
// nothing at all. Every symptom was one cause — the account was not in the
// business it was meant to be in.
//
// Two things let that happen and stay happened:
//
//   1. A SESSION TOKEN CARRIES THE COMPANY AND LASTS THIRTY DAYS, and the
//      server took it on trust. A token signed while the account was in the
//      wrong business kept it there for a month, whatever the database said.
//      Signing out and in was the only cure and nobody knew to try it.
//   2. AN INVITATION NOBODY CLICKS IS INVISIBLE. Miss the email, sign up on
//      the sign-up page instead — the obvious thing to do — and you get a
//      business of your own and a blank screen, while the invitation sits
//      unaccepted and unmentioned.
//
// Both are pinned here, against the real server.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwtLib = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const soon = (d) => new Date(Date.now() + d * 86400000).toISOString();
const ago  = (d) => new Date(Date.now() - d * 86400000).toISOString();

// Two businesses: the roofing company that sent the invitation, and the empty
// one the invited roofer made for himself by signing up instead.
const { db, port } = await startFakePostgrest({
  companies: [
    { id: 'co-flood', name: 'Flood Roofing', plan: 'team', slug: null },
    { id: 'co-his',   name: 'Ethan',         plan: 'trial', slug: null },
  ],
  profiles: [
    { id: 'u-aron',  email: 'aron@floodroofing.co.nz',  name: 'Aron',  company: 'Flood Roofing', company_id: 'co-flood', token_version: 0 },
    { id: 'u-ethan', email: 'ethan@floodroofing.co.nz', name: 'Ethan', company: 'Ethan',         company_id: 'co-his',   token_version: 0 },
  ],
  company_users: [
    { company_id: 'co-flood', user_id: 'u-aron',  role: 'owner',  created_at: ago(90) },
    { company_id: 'co-his',   user_id: 'u-ethan', role: 'owner',  created_at: ago(2) },
  ],
  company_invites: [],
  user_settings: [
    { user_id: 'u-aron', company_id: 'co-flood', updated_at: ago(1),
      branding: { company_name: 'Flood Roofing' }, quote_defaults: {},
      jms_keys: { fergus: 'the-companys-fergus-key' } },
  ],
  jobs: [
    { id: 'job-1', company_id: 'co-flood', user_id: 'u-aron', client_name: 'Linda Wessling',
      site_address: '1 Kauri Rd', created_at: ago(3), updated_at: ago(1), status: '', draw_state: {} },
  ],
  subscriptions: [
    { user_id: 'u-aron', company_id: 'co-flood', status: 'active', trial_ends_at: null },
  ],
  usage_events: [], companies_domains: [], company_domains: [],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.BILLING_ENABLED = 'false';
process.env.PLAN_CACHE_MS = '0';
const PORT = process.env.TEST_PORT || '34981';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn, err = console.error;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn; console.error = err;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const tokenFor = (id, email, cid) => jwtLib.sign({ id, email, cid, tv: 0 }, 'test-secret', { expiresIn: '30d' });
const call = async (m, p, tok, body) => {
  const r = await fetch(BASE + p, { method: m,
    headers: Object.assign({ Authorization: 'Bearer ' + tok }, body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: /json/.test(ct) ? await r.json().catch(() => ({})) : await r.text() };
};
// The company cache inside the server holds an answer for a minute, which is
// the point of it — these checks are about what a FRESH look gives, so each
// one uses its own user id where it matters.
const settle = () => new Promise(r => setTimeout(r, 120));

// ── 1. a token that names the wrong business ──────────────────────
// This is the one that strands somebody for a month. Ethan's membership is of
// his own company; a token claiming Flood Roofing must not be taken at its
// word — and the reverse, the shape he was actually in, must heal.
{
  // The real shape: he IS in his own company, and the token says so.
  let r = await call('GET', '/jobs', tokenFor('u-ethan', 'ethan@floodroofing.co.nz', 'co-his'));
  check('an account in a business of its own sees none of the roofing company’s jobs — the symptom',
    r.status === 200 && Array.isArray(r.body) && r.body.length === 0, JSON.stringify(r.body).slice(0, 120));

  // Now put him where he belongs in the DATABASE, leaving the old token alone.
  db.company_users.length = 0;
  db.company_users.push({ company_id: 'co-flood', user_id: 'u-aron',  role: 'owner',  created_at: ago(90) });
  db.company_users.push({ company_id: 'co-flood', user_id: 'u-ethan', role: 'member', created_at: ago(1) });
  await new Promise(r2 => setTimeout(r2, 1100));   // past the minute? no — see below
}
// The server caches memberships for a minute, so a check that waited would be
// a slow test. A DIFFERENT user id has no cached answer, which is the same
// thing from the server's point of view and takes no time at all.
db.profiles.push({ id: 'u-sam', email: 'sam@floodroofing.co.nz', name: 'Sam', company: 'Flood Roofing', company_id: 'co-flood', token_version: 0 });
db.company_users.push({ company_id: 'co-flood', user_id: 'u-sam', role: 'member', created_at: ago(1) });
{
  // A token naming a business Sam is NOT in. Before this fix it was believed.
  const r = await call('GET', '/jobs', tokenFor('u-sam', 'sam@floodroofing.co.nz', 'co-his'));
  check('a session token naming a business the account is not in is corrected, not believed',
    r.status === 200 && Array.isArray(r.body) && r.body.length === 1 && r.body[0].client_name === 'Linda Wessling',
    JSON.stringify(r.body).slice(0, 160));
}
db.profiles.push({ id: 'u-kim', email: 'kim@floodroofing.co.nz', name: 'Kim', company: 'Flood Roofing', company_id: 'co-flood', token_version: 0 });
db.company_users.push({ company_id: 'co-flood', user_id: 'u-kim', role: 'member', created_at: ago(1) });
{
  const r = await call('GET', '/jobs', tokenFor('u-kim', 'kim@floodroofing.co.nz', 'co-flood'));
  check('…and a token that names the right one is left exactly as it is',
    r.status === 200 && Array.isArray(r.body) && r.body.length === 1, JSON.stringify(r.body).slice(0, 120));
}
{
  // The lesson already written into this file in another place: a lookup that
  // FAILED must never be read as "you are in no company". It leaves the token
  // alone, which is where they were a moment ago.
  db.profiles.push({ id: 'u-pat', email: 'pat@floodroofing.co.nz', name: 'Pat', company: '', company_id: 'co-flood', token_version: 0 });
  db.company_users.push({ company_id: 'co-flood', user_id: 'u-pat', role: 'member', created_at: ago(1) });
  db.__fail500 = 'company_users';
  const r = await call('GET', '/jobs', tokenFor('u-pat', 'pat@floodroofing.co.nz', 'co-flood'));
  delete db.__fail500;
  check('…and when the membership cannot be read at all, the token stands — auth never breaks on a lookup',
    r.status === 200 && Array.isArray(r.body) && r.body.length === 1, r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
}

// ── 2. the invitation nobody clicked ──────────────────────────────
// Back to the real situation: Ethan in his own business, invited to Flood
// Roofing, the invitation never taken.
db.company_users.length = 0;
db.company_users.push({ company_id: 'co-flood', user_id: 'u-aron',  role: 'owner',  created_at: ago(90) });
db.company_users.push({ company_id: 'co-his',   user_id: 'u-ethan', role: 'owner',  created_at: ago(2) });
const E = () => tokenFor('u-ethan', 'ethan@floodroofing.co.nz', 'co-his');

{
  const r = await call('GET', '/auth/pending-invite', E());
  check('with nothing waiting, nothing is offered', r.status === 200 && r.body.invite === null, JSON.stringify(r.body));
}
db.company_invites.push({ id: 'inv-1', company_id: 'co-flood', email: 'ethan@floodroofing.co.nz',
  role: 'member', token_hash: 'h1', created_by: 'u-aron', created_at: ago(5),
  expires_at: soon(9), accepted_at: null, accepted_by: null });
{
  const r = await call('GET', '/auth/pending-invite', E());
  check('an invitation waiting for this address is offered, named',
    r.status === 200 && r.body.invite && r.body.invite.company === 'Flood Roofing' && r.body.invite.id === 'inv-1',
    JSON.stringify(r.body));
}
{
  // Somebody already in the business is not nagged about an old invitation to it.
  const r = await call('GET', '/auth/pending-invite', tokenFor('u-aron', 'aron@floodroofing.co.nz', 'co-flood'));
  check('…but not to somebody already in that business', r.status === 200 && r.body.invite === null, JSON.stringify(r.body));
}
{
  db.company_invites.push({ id: 'inv-old', company_id: 'co-flood', email: 'ethan@floodroofing.co.nz',
    role: 'member', token_hash: 'h2', created_by: 'u-aron', created_at: ago(40),
    expires_at: ago(26), accepted_at: null, accepted_by: null });
  const r = await call('GET', '/auth/pending-invite', E());
  check('…and an expired one is not offered', r.status === 200 && r.body.invite && r.body.invite.id === 'inv-1', JSON.stringify(r.body));
}

// ── 3. taking it, from inside the app ─────────────────────────────
// No emailed link and no new password: the invitation is addressed to an
// email and they have signed in as it, which is the same proof.
{
  const r = await call('POST', '/auth/join-invite', E(), { id: 'inv-1' });
  const ok = r.status === 200 && r.body.token;
  const claims = ok ? jwtLib.decode(r.body.token) : null;
  check('joining moves the account into the business and hands back a session for it',
    ok && claims && claims.cid === 'co-flood', r.status + ' ' + JSON.stringify(claims || r.body).slice(0, 140));
  const mem = db.company_users.filter(m => m.user_id === 'u-ethan');
  check('…with exactly one membership afterwards, of the right business',
    mem.length === 1 && mem[0].company_id === 'co-flood', JSON.stringify(mem));
  const prof = db.profiles.find(p => p.id === 'u-ethan');
  check('…the profile moved with it', prof && prof.company_id === 'co-flood', prof && prof.company_id);
  const inv = db.company_invites.find(i => i.id === 'inv-1');
  check('…and the invitation is used up, so the emailed link cannot be used twice',
    inv && !!inv.accepted_at && inv.accepted_by === 'u-ethan', JSON.stringify(inv && { a: inv.accepted_at, b: inv.accepted_by }));
}
{
  // The whole point: the jobs, and the company's Fergus key, are his now.
  const tok = tokenFor('u-ethan', 'ethan@floodroofing.co.nz', 'co-flood');
  const jobs = await call('GET', '/jobs', tok);
  check('the roofing company’s jobs open on his account now', jobs.status === 200 && jobs.body.length === 1 &&
    jobs.body[0].client_name === 'Linda Wessling', JSON.stringify(jobs.body).slice(0, 140));
  const set = await call('GET', '/settings', tok);
  const keys = set.body && (set.body.jms_keys || (set.body[0] && set.body[0].jms_keys));
  check('…and the Fergus connection with them — it was always the business’s, never his own',
    !!(keys && keys.fergus), JSON.stringify(set.body && set.body.jms_keys));
}
{
  const r = await call('GET', '/auth/pending-invite', tokenFor('u-ethan', 'ethan@floodroofing.co.nz', 'co-flood'));
  check('…and nothing is offered a second time', r.status === 200 && r.body.invite === null, JSON.stringify(r.body));
}

// ── 4. the seat limit still counts ────────────────────────────────
// An invitation is good for a fortnight and a plan can shrink inside it, so
// the check is made when it is taken, not only when it was sent.
{
  db.companies.find(c => c.id === 'co-flood').plan = 'solo';   // one seat
  db.profiles.push({ id: 'u-jo', email: 'jo@floodroofing.co.nz', name: 'Jo', company: '', company_id: null, token_version: 0 });
  db.company_users.push({ company_id: 'co-jo', user_id: 'u-jo', role: 'owner', created_at: ago(1) });
  db.companies.push({ id: 'co-jo', name: 'Jo', plan: 'trial', slug: null });
  db.company_invites.push({ id: 'inv-2', company_id: 'co-flood', email: 'jo@floodroofing.co.nz',
    role: 'member', token_hash: 'h3', created_by: 'u-aron', created_at: ago(1),
    expires_at: soon(13), accepted_at: null, accepted_by: null });
  const r = await call('POST', '/auth/join-invite', tokenFor('u-jo', 'jo@floodroofing.co.nz', 'co-jo'), { id: 'inv-2' });
  check('a business with no seat left says so instead of letting somebody in over the plan',
    r.status === 403 && r.body.code === 'PLAN_SEATS', r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
  const inv = db.company_invites.find(i => i.id === 'inv-2');
  check('…and the invitation is still there to use once they upgrade', inv && !inv.accepted_at);
}
{
  // An invitation addressed to somebody else is not theirs to take, however
  // the request is shaped.
  db.company_invites.push({ id: 'inv-3', company_id: 'co-flood', email: 'someone@else.co.nz',
    role: 'member', token_hash: 'h4', created_by: 'u-aron', created_at: ago(1),
    expires_at: soon(13), accepted_at: null, accepted_by: null });
  const r = await call('POST', '/auth/join-invite', tokenFor('u-jo', 'jo@floodroofing.co.nz', 'co-jo'), { id: 'inv-3' });
  check('an invitation addressed to somebody else cannot be taken by naming its id',
    r.status === 404, r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
  const inv = db.company_invites.find(i => i.id === 'inv-3');
  check('…and is left untouched', inv && !inv.accepted_at);
}

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
