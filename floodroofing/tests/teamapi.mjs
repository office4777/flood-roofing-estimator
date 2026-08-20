// Can a roofing company onboard itself? Sign up → own business → invite staff
// → they join THAT business, on the one subscription, and see its jobs.
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { pathToFileURL } from 'node:url';

import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const FLOOD = 'ffffffff-1111-1111-1111-111111111111';
const ACME  = 'aaaa0000-1111-1111-1111-111111111111';
const AARON = 'aaaaaaaa-0000-0000-0000-000000000001';
const ETHAN = 'eeeeeeee-0000-0000-0000-000000000002';
const BOB   = 'bbbbbbbb-0000-0000-0000-000000000003';

const db = {
  __missing: [],
  companies: [
    { id: FLOOD, name: 'Flood Roofing', slug: null },
    { id: ACME,  name: 'Acme Roofing',  slug: 'acmeroofing' },
  ],
  company_users: [
    { company_id: FLOOD, user_id: AARON, role: 'owner' },
    { company_id: FLOOD, user_id: ETHAN, role: 'member' },
    { company_id: ACME,  user_id: BOB,   role: 'owner' },
  ],
  profiles: [
    { id: AARON, company_id: FLOOD, name: 'Aaron', email: 'aaron@floodroofing.co.nz' },
    { id: ETHAN, company_id: FLOOD, name: 'Ethan', email: 'ethan@floodroofing.co.nz' },
    { id: BOB,   company_id: ACME,  name: 'Bob',   email: 'bob@acmeroofing.co.nz' },
  ],
  company_invites: [],
  subscriptions: [
    { user_id: AARON, company_id: FLOOD, status: 'trialing', trial_ends_at: '2030-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' },
  ],
  jobs: [], user_settings: [],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
// TEST_PORT lets the runner give each suite its own, so suites can
// never collide with each other or with a run already going.
const PORT = process.env.TEST_PORT || '34569';
process.env.PORT = PORT;
process.env.BILLING_ENABLED = 'true';        // exercise the real gate
delete process.env.DATABASE_URL;
const jwtLib = require('jsonwebtoken');
const tok = (id, email, cid) => jwtLib.sign({ id, email, cid }, 'test-secret', { expiresIn: '1h' });
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));

const api = async (method, path, body, who) => {
  const h = { 'Content-Type': 'application/json' };
  if (who) h.Authorization = 'Bearer ' + tok(who.id, who.email, who.cid);
  const r = await fetch('http://127.0.0.1:' + PORT + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const aaron = { id: AARON, email: 'aaron@floodroofing.co.nz', cid: FLOOD };
const ethan = { id: ETHAN, email: 'ethan@floodroofing.co.nz', cid: FLOOD };
const bob   = { id: BOB,   email: 'bob@acmeroofing.co.nz',    cid: ACME  };

// ── the team screen ──
let r = await api('GET', '/team', null, aaron);
check('the owner sees everyone in their business',
  r.status === 200 && r.body.members.length === 2 && r.body.me.role === 'owner',
  JSON.stringify(r.body.members.map(m => m.email + ':' + m.role)));
check('…and only their business — not another company\'s staff',
  !r.body.members.some(m => m.email === 'bob@acmeroofing.co.nz'));

// ── only an owner may change who is in the business ──
r = await api('POST', '/team/invites', { email: 'matt@floodroofing.co.nz' }, ethan);
check('a member cannot invite people', r.status === 403 && r.body.code === 'OWNER_ONLY', r.status + ' ' + JSON.stringify(r.body));
r = await api('DELETE', '/team/members/' + AARON, null, ethan);
check('…nor remove anyone', r.status === 403, String(r.status));

// ── invite ──
r = await api('POST', '/team/invites', { email: 'Matt@FloodRoofing.co.NZ' }, aaron);
check('the owner can invite by email', r.status === 200 && !!r.body.link, JSON.stringify(r.body && r.body.invite));
check('…and gets the link back even when email is not configured', /\/\?invite=/.test(r.body.link || ''), r.body.link);
check('…with only a HASH of the token stored, never the token itself',
  db.company_invites.length === 1 && !!db.company_invites[0].token_hash &&
  !(r.body.link || '').includes(db.company_invites[0].token_hash), db.company_invites[0].token_hash.slice(0, 16) + '…');
check('…and the email is normalised', db.company_invites[0].email === 'matt@floodroofing.co.nz', db.company_invites[0].email);
const inviteToken = decodeURIComponent(r.body.link.split('invite=')[1]);
const inviteId = db.company_invites[0].id || 'inv-1';
if (!db.company_invites[0].id) db.company_invites[0].id = inviteId;
db.company_invites[0].expires_at = '2030-01-01T00:00:00Z';
db.company_invites[0].accepted_at = null;

r = await api('POST', '/team/invites', { email: 'nope' }, aaron);
check('a junk email address is refused', r.status === 400, String(r.status));

// ── what the invitee sees before committing ──
r = await api('GET', '/auth/invite/' + inviteToken, null, null);
check('the invite link says which business it is for, with no login needed',
  r.status === 200 && r.body.company === 'Flood Roofing' && r.body.email === 'matt@floodroofing.co.nz', JSON.stringify(r.body));
r = await api('GET', '/auth/invite/deadbeef', null, null);
check('a made-up invite token gets nothing', r.status === 404, String(r.status));

// ── accept ──
r = await api('POST', '/auth/accept-invite', { token: inviteToken, password: 'short' }, null);
check('a too-short password is refused', r.status === 400, String(r.status));
r = await api('POST', '/auth/accept-invite', { token: inviteToken, password: 'a-good-password', name: 'Matt' }, null);
check('accepting the invite signs them straight in', r.status === 200 && !!r.body.token, JSON.stringify(r.body && r.body.user));
const mattId = (r.body.user || {}).id;
check('…into the company that invited them, NOT one of their own',
  db.company_users.some(l => l.user_id === mattId && String(l.company_id) === FLOOD),
  JSON.stringify(db.company_users.filter(l => l.user_id === mattId)));
check('…as a member', (db.company_users.find(l => l.user_id === mattId) || {}).role === 'member');
check('…without being given a second subscription',
  db.subscriptions.length === 1, db.subscriptions.length + ' subscription rows');
check('…and the invite is burnt so the link cannot be reused',
  !!db.company_invites[0].accepted_at, String(db.company_invites[0].accepted_at));
r = await api('POST', '/auth/accept-invite', { token: inviteToken, password: 'a-good-password' }, null);
check('…reusing it fails', r.status === 401, String(r.status));

// ── the business's one subscription covers the new person ──
const matt = { id: mattId, email: 'matt@floodroofing.co.nz', cid: FLOOD };
r = await api('POST', '/jobs', { client_name: 'Test' }, matt);
check('the invited teammate works on the business\'s subscription', r.status === 200, r.status + ' ' + JSON.stringify(r.body));
db.subscriptions[0].status = 'canceled'; db.subscriptions[0].trial_ends_at = '2020-01-01T00:00:00Z';
r = await api('POST', '/jobs', { client_name: 'Test' }, matt);
check('…and when the BUSINESS lapses, everyone in it is gated',
  r.status === 403 && r.body.code === 'SUBSCRIPTION_REQUIRED', r.status + ' ' + JSON.stringify(r.body));
db.subscriptions[0].status = 'trialing'; db.subscriptions[0].trial_ends_at = '2030-01-01T00:00:00Z';

// ── removing someone ──
r = await api('DELETE', '/team/members/' + AARON, null, aaron);
check('an owner cannot remove themselves', r.status === 400, JSON.stringify(r.body));
r = await api('DELETE', '/team/members/' + mattId, null, aaron);
check('the owner can remove a teammate', r.status === 200, JSON.stringify(r.body));
check('…and their JOBS stay with the business', db.jobs.length === 1 && String(db.jobs[0].company_id) === FLOOD,
  JSON.stringify(db.jobs.map(j => j.company_id)));
r = await api('POST', '/team/members/' + ETHAN + '/role', { role: 'member' }, aaron);
db.company_users.find(l => l.user_id === AARON).role = 'member';
r = await api('DELETE', '/team/members/' + ETHAN, null, aaron);
check('a business is never left without an owner', r.status === 403 || r.status === 400, String(r.status));
db.company_users.find(l => l.user_id === AARON).role = 'owner';

// ── the RoofMap address ──
r = await api('GET', '/team/slug-available?slug=floodroofing', null, aaron);
check('a free address is offered', r.body.ok === true, JSON.stringify(r.body));
r = await api('GET', '/team/slug-available?slug=acmeroofing', null, aaron);
check('one another business already has is not', r.body.ok === false && r.body.reason === 'taken', JSON.stringify(r.body));
for (const bad of ['www', 'api', 'roofmap', 'ab', 'has space', 'UPPER!', 'a--b', '-lead'])
  check('"' + bad + '" is refused as an address', (await api('GET', '/team/slug-available?slug=' + encodeURIComponent(bad), null, aaron)).body.ok === false);
r = await api('POST', '/team/slug', { slug: 'FloodRoofing' }, aaron);
check('setting the address lowercases it', r.status === 200 && r.body.slug === 'floodroofing', JSON.stringify(r.body));
check('…and stores it on the company', (db.companies.find(c => c.id === FLOOD) || {}).slug === 'floodroofing');
r = await api('POST', '/team/slug', { slug: 'acmeroofing' }, aaron);
check('…and you cannot take one that is already someone else\'s', r.status === 409, String(r.status));
r = await api('POST', '/team/slug', { slug: 'whatever' }, ethan);
check('…only an owner can change it', r.status === 403, String(r.status));

// ── separation between businesses ──
r = await api('GET', '/team', null, bob);
check('another business sees only its own team',
  r.body.members.length === 1 && r.body.members[0].email === 'bob@acmeroofing.co.nz', JSON.stringify(r.body.members));

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.filter(x=>!x).length ? 1 : 0);
