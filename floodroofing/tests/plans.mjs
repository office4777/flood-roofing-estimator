// What you're sold is what you get — and, just as importantly, what you're NOT
// sold is refused by the server rather than by a hidden button.
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

const CO = 'cccccccc-1111-1111-1111-111111111111';
const OWNER = 'oooooooo-0000-0000-0000-000000000001';
const db = {
  __missing: [],
  companies: [{ id: CO, name:'Acme Roofing', slug:null, plan:'trial' }],
  company_users: [{ company_id: CO, user_id: OWNER, role:'owner' }],
  profiles: [{ id: OWNER, company_id: CO, name:'Bob', email:'bob@acmeroofing.co.nz' }],
  company_invites: [], company_domains: [], subscriptions: [], jobs: [], user_settings: [],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
// TEST_PORT lets the runner give each suite its own, so suites can
// never collide with each other or with a run already going.
const PORT = process.env.TEST_PORT || '34572';
process.env.PORT = PORT;
process.env.BILLING_ENABLED = 'false';
process.env.PLAN_CACHE_MS = '0';   // see the plan straight away when it changes
process.env.VERCEL_TOKEN = '';          // domains off, so a 403 is the PLAN check
delete process.env.DATABASE_URL;
const jwtLib = require('jsonwebtoken');
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const tok = jwtLib.sign({ id: OWNER, email:'bob@acmeroofing.co.nz', cid: CO }, 'test-secret', { expiresIn:'1h' });
const api = async (m, path, body) => {
  const r = await fetch('http://127.0.0.1:' + PORT + path, { method:m,
    headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
    body: body?JSON.stringify(body):undefined });
  return { status:r.status, body: await r.json().catch(()=>null) };
};
// The plan is cached for a minute — this test changes plans, so clear it.
function setPlan(p){ db.companies[0].plan = p; }
const settle = () => new Promise(r => setTimeout(r, 30));

// ── trial gets everything, so a business can judge the whole product ──
let r = await api('GET', '/team');
check('a trial reports itself as such, with everything unlocked',
  r.body.plan.id === 'trial' && r.body.plan.slug && r.body.plan.domain && r.body.plan.jms && r.body.plan.seats.allowed === null,
  JSON.stringify(r.body.plan));
r = await api('POST', '/team/slug', { slug:'acmeroofing' });
check('…and can set its RoofMap address', r.status === 200, String(r.status));

// ── Solo: one person, and none of the extras ──
setPlan('solo'); await settle();
r = await api('GET', '/team');
check('the one-person plan is called Trade, not Solo — nobody buys the tier that names their limit',
  r.body.plan.label === 'Trade', r.body.plan.label);
check('…while its key stays "solo", so no stored row has to be rewritten',
  r.body.plan.id === 'solo', r.body.plan.id);
check('Trade reports one seat and no extras',
  r.body.plan.seats.allowed === 1 && !r.body.plan.slug && !r.body.plan.domain && !r.body.plan.jms,
  JSON.stringify(r.body.plan));
const r0 = r;
check('…and shows the seat already in use', r.body.plan.seats.used === 1, String(r.body.plan.seats.used));
r = await api('POST', '/team/invites', { email:'sue@acmeroofing.co.nz' });
check('…so inviting a second person is refused',
  r.status === 403 && r.body.code === 'PLAN_SEATS', r.status + ' ' + JSON.stringify(r.body.error));
check('…in words that say what is wrong and what fixes it',
  /covers 1 person/.test(r.body.error) && /Upgrade/.test(r.body.error), r.body.error);
check('…and no invitation was created', db.company_invites.length === 0, db.company_invites.length + ' invites');
r = await api('POST', '/team/slug', { slug:'acme2' });
check('Solo cannot take a RoofMap address',
  r.status === 403 && r.body.code === 'PLAN_LIMIT' && r.body.needs === 'Team', JSON.stringify(r.body));
r = await api('POST', '/team/domains', { domain:'quote.acmeroofing.co.nz' });
check('…nor connect its own domain', r.status === 403 && r.body.needs === 'Business', JSON.stringify(r.body));
r = await api('GET', '/fergus/anything');
check('…nor reach the job-system link, which now starts at Team',
  r.status === 403 && r.body.needs === 'Team', JSON.stringify(r.body));
// Being told a quote was opened is the one thing a one-person business needs
// most. It used to start at Team; withholding it only ever produced churn.
check('Solo IS told when a customer opens or accepts a quote',
  r0.body.plan.activity === true, JSON.stringify(r0.body.plan));
check('…and gets the automatic chase when a quote goes quiet',
  r0.body.plan.reminders === true, JSON.stringify(r0.body.plan));
check('…but still no schedule board — a calendar for one person is nothing',
  r0.body.plan.schedule === false, JSON.stringify(r0.body.plan));

// ── Team: five seats, its own address, but not its own domain ──
setPlan('team'); await settle();
r = await api('POST', '/team/slug', { slug:'acmeroofing' });
check('Team can set its RoofMap address', r.status === 200, String(r.status));
r = await api('POST', '/team/domains', { domain:'quote.acmeroofing.co.nz' });
check('…but its own domain is still Business-only', r.status === 403 && r.body.needs === 'Business', JSON.stringify(r.body));
// The two reasons to leave Solo: a crew to schedule, and Fergus. Firms running
// Fergus are Team-shaped, not Business-shaped.
r = await api('GET', '/team');
check('Team gets the schedule board', r.body.plan.schedule === true, JSON.stringify(r.body.plan));
check('…and the Fergus link', r.body.plan.jms === true, JSON.stringify(r.body.plan));
check('…but not the team inbox, which is what Business is for',
  r.body.plan.inbox === false, JSON.stringify(r.body.plan));
for (let i = 0; i < 4; i++){
  r = await api('POST', '/team/invites', { email: 'mate' + i + '@acmeroofing.co.nz' });
  if (r.status === 200 && db.company_invites.length) db.company_invites[db.company_invites.length-1].expires_at = '2030-01-01T00:00:00Z';
}
check('…and can invite up to five people in total', db.company_invites.length === 4, db.company_invites.length + ' invites');
r = await api('POST', '/team/invites', { email:'sixth@acmeroofing.co.nz' });
check('…the sixth is refused', r.status === 403 && r.body.code === 'PLAN_SEATS', r.status + ' ' + JSON.stringify(r.body.error));
check('…counting invitations that are still outstanding, not just people who joined',
  /1 in the business, 4 invited/.test(r.body.error || ''), r.body.error);
r = await api('GET', '/team');
check('…and the screen shows 5 of 5 used', r.body.plan.seats.used === 5 && r.body.plan.seats.allowed === 5, JSON.stringify(r.body.plan.seats));

// ── an old invitation cannot sneak past a downgrade ──
const raw = require('crypto').randomBytes(8).toString('hex');
db.company_invites.push({ id:'inv-late', company_id: CO, email:'late@acmeroofing.co.nz', role:'member',
  token_hash: require('crypto').createHash('sha256').update(raw).digest('hex'),
  expires_at:'2030-01-01T00:00:00Z', accepted_at:null });
setPlan('solo'); await settle();
const acc = await fetch('http://127.0.0.1:' + PORT + '/auth/accept-invite', { method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token: raw, password:'a-good-password' }) });
const accBody = await acc.json().catch(()=>null);
check('an invitation sent before a downgrade cannot be used to exceed the new plan',
  acc.status === 403 && accBody.code === 'PLAN_SEATS', acc.status + ' ' + JSON.stringify(accBody));
check('…and says what the invitee should do about it', /upgrade/i.test(accBody.error || ''), accBody.error);

// ── Business: fifteen seats, and everything else ──
// The pricing page sells Business as "up to fifteen people" with Enterprise
// above it. That promise is only real if the server counts.
setPlan('business'); await settle();
r = await api('GET', '/team');
check('Business covers fifteen and includes the lot',
  r.body.plan.seats.allowed === 15 && r.body.plan.slug && r.body.plan.domain && r.body.plan.jms,
  JSON.stringify(r.body.plan));
r = await api('POST', '/team/invites', { email:'seventh@acmeroofing.co.nz' });
check('…so a sixth and seventh person are fine', r.status === 200, String(r.status));
if (r.status === 200 && db.company_invites.length) db.company_invites[db.company_invites.length-1].expires_at = '2030-01-01T00:00:00Z';
// Fill it to the fifteen the page promises: 1 in the business + 14 invited.
// Seeded straight into the table rather than sent — every accepted invite
// posts a real email, and an 8-second SMTP timeout each is minutes of suite.
for (let i = 0; i < 8; i++){
  db.company_invites.push({ id: 'inv-crew-' + i, company_id: CO, email: 'crew' + i + '@acmeroofing.co.nz',
    role: 'member', token_hash: 'x' + i, expires_at: '2030-01-01T00:00:00Z', accepted_at: null });
}
r = await api('GET', '/team');
check('…up to fifteen, where it stops', r.body.plan.seats.used === 15, JSON.stringify(r.body.plan.seats));
r = await api('POST', '/team/invites', { email:'sixteenth@acmeroofing.co.nz' });
check('…and the sixteenth is refused', r.status === 403 && r.body.code === 'PLAN_SEATS',
  r.status + ' ' + JSON.stringify(r.body.error));
check('…pointing at Enterprise, since there is no bigger plan to upgrade to',
  /Enterprise/.test(r.body.error || '') && !/Upgrade to add more/.test(r.body.error || ''), r.body.error);

// Grandfathering: a business that was already bigger than the cap keeps every
// one of its people. The gate only ever refuses the NEXT person — capping a
// plan must never quietly throw somebody out of their own company.
db.company_users.push({ company_id: CO, user_id:'eeeeeeee-0000-0000-0000-000000000001', role:'member' },
                      { company_id: CO, user_id:'eeeeeeee-0000-0000-0000-000000000002', role:'member' });
r = await api('GET', '/team');
check('a business already past the cap keeps everybody and still loads',
  r.status === 200 && db.company_users.filter(u => u.company_id === CO).length === 3 &&
  r.body.plan.seats.used > r.body.plan.seats.allowed, JSON.stringify(r.body.plan.seats));
r = await api('POST', '/team/invites', { email:'onemore@acmeroofing.co.nz' });
check('…it is only the next invitation that is refused',
  r.status === 403 && r.body.code === 'PLAN_SEATS', String(r.status));

// ── a company with no plan yet keeps working ──
delete db.companies[0].plan; await settle();
r = await api('GET', '/team');
check('an account that predates plans is treated as a trial, not locked out',
  r.body.plan.id === 'trial' && r.body.plan.seats.allowed === null, JSON.stringify(r.body.plan));

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.filter(x=>!x).length ? 1 : 0);
