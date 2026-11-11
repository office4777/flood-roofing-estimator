// COMPLIMENTARY ACCOUNTS (2026-11-11, the RANZ pilot: four testers named by
// Luke Boustridge after the demo, free Team access to 31 March 2027).
//
// What this pins, against the real server on the fake PostgREST:
//   - an address on COMP_SIGNUPS that registers starts on Team, to the date,
//     with NO roof cap and every trial drip step already stamped;
//   - such an account saves a 4th, 5th real roof (the trial's cap is gone);
//   - /subscription answers `comp` so the app says "Complimentary" instead
//     of counting a trial down;
//   - an address NOT on the list is still an ordinary 3-roof trial;
//   - an account on the list that ALREADY existed is comped by the sweep,
//     once (a second sweep writes nothing), and a PAYING one is left alone;
//   - COMP_SIGNUPS on the environment adds to the built-in list;
//   - the drip sends nothing to a comped account.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const days = (n) => new Date(Date.now() + n*864e5).toISOString();
const CO_LUKE = 'cccccccc-1111-1111-1111-111111111111', LUKE = 'oooooooo-0000-0000-0000-000000000001';
const CO_PAY = 'cccccccc-2222-2222-2222-222222222222', PAY = 'oooooooo-0000-0000-0000-000000000002';
const db = {
  __missing: [], __fail500: '',
  companies: [{ id: CO_LUKE, name:'RANZ', slug:null, plan:'trial' },
              { id: CO_PAY, name:'Paying Roofing', slug:null, plan:'solo' }],
  company_users: [{ company_id: CO_LUKE, user_id: LUKE, role:'owner' }, { company_id: CO_PAY, user_id: PAY, role:'owner' }],
  profiles: [{ id: LUKE, company_id: CO_LUKE, name:'Luke', email:'CEO@ranz.co.nz' },
             { id: PAY, company_id: CO_PAY, name:'Pat', email:'pat@paying.co.nz' }],
  company_invites: [], company_domains: [], jobs: [], user_settings: [], usage_events: [], trial_roofs: [], plan_roofs: [],
  platform_state: [],
  subscriptions: [
    { id:'s1', company_id: CO_LUKE, user_id: LUKE, status:'trialing', trial_ends_at: days(28), trial_roof_limit: 3, trial_drip: { d1: 'x' }, created_at: days(-2) },
    { id:'s2', company_id: CO_PAY, user_id: PAY, status:'active', trial_ends_at: null, trial_roof_limit: null, created_at: days(-90) },
  ],
};
const { port } = await startFakePostgrest(db);
const PORT = process.env.TEST_PORT || '34671';
process.env.PORT = PORT;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'true';
process.env.ADMIN_TOKEN = 'admintok-0123456789';
process.env.COMP_SIGNUPS = 'pat@paying.co.nz:team:2027-03-31 extra@pilot.co.nz:trade:2027-02-28 junk nope@x.co:nosuch:2027-01-01';
process.env.VERIFY_EMAIL = 'false';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.DATABASE_URL;
delete process.env.TRIAL_ROOFS;
const jwtLib = require('jsonwebtoken');
const log = console.log, cerr = console.error, cwarn = console.warn;
console.log = () => {}; console.error = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr; console.warn = cwarn;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const tokOf = (id, email, cid) => jwtLib.sign({ id, email, cid }, 'test-secret', { expiresIn:'1h' });
const api = async (m, path, body, tok, admin) => {
  const h = { 'Content-Type':'application/json' };
  if (tok) h.Authorization = 'Bearer ' + tok;
  if (admin) h['x-admin-token'] = 'admintok-0123456789';
  const r = await fetch(BASE + path, { method:m, headers:h, body: body ? JSON.stringify(body) : undefined });
  return { status:r.status, body: await r.json().catch(()=>null) };
};
const SQ = [[100,100],[400,100],[400,300],[100,300]];
const roof = () => ({ state:{ quote:{ ref:'J' + Math.random().toString(36).slice(2,8) } }, draw:{ outline: SQ, scaleMetresPerPx: 0.03 } });
const UNTIL = new Date('2027-03-31T23:59:59+13:00').toISOString();
const register = (email, company) => fetch(BASE + '/auth/register', { method:'POST', headers:{ 'Content-Type':'application/json' },
  body: JSON.stringify({ email, password:'password123', name:'Tester', company, phone:'021 555 0101', interests:['satellite'] }) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

// ── a tester on the built-in list registers ───────────────────────
let r = await register('Ben@ProtechRoofing.co.nz', 'Protech Roofing');
const benProf = db.profiles.find(p => /^ben@protechroofing/i.test(p.email));
const benCo = benProf && (db.company_users.find(m => m.user_id === benProf.id) || {}).company_id;
const benSub = db.subscriptions.find(s => benProf && s.user_id === benProf.id);
check('a listed address registers (case ignored)', r.status === 200 && benProf && benCo, r.status + ' ' + JSON.stringify(r.body));
check('…its business is on Team', (db.companies.find(c => c.id === benCo) || {}).plan === 'team',
  JSON.stringify(db.companies.find(c => c.id === benCo)));
check('…free until the end of 31 March 2027 NZ, with no roof cap',
  benSub && benSub.trial_ends_at === UNTIL && !(Number(benSub.trial_roof_limit) > 0) && benSub.status === 'trialing',
  JSON.stringify(benSub));
check('…and every trial drip step is already stamped (no "Four days left" emails)',
  benSub && benSub.trial_drip && ['d1','d3','d7','d12'].every(k => /^comped/.test(benSub.trial_drip[k])) &&
  benSub.trial_drip.comp && benSub.trial_drip.comp.plan === 'team', JSON.stringify(benSub && benSub.trial_drip));
const BEN = tokOf(benProf.id, benProf.email, benCo);
r = await api('GET', '/subscription', null, BEN);
check('/subscription says it is complimentary, Team, to the date',
  r.body && r.body.comp && r.body.comp.plan === 'team' && r.body.comp.until === UNTIL && r.body.live === true && !r.body.trial.roofs_limit,
  JSON.stringify(r.body && { comp: r.body.comp, trial: r.body.trial, live: r.body.live }));
let saved = 0;
for (let i = 0; i < 5; i++){ const j = await api('POST', '/jobs', { client_name:'C', site_address:'A' + i, draw_state: roof() }, BEN); if (j.status === 200) saved++; }
check('five real roofs all save (no 3-roof cap)', saved === 5, saved + ' saved');

// ── somebody not on the list is still an ordinary trial ───────────
r = await register('someone@else.co.nz', 'Else Roofing');
const elseProf = db.profiles.find(p => p.email === 'someone@else.co.nz');
const elseSub = db.subscriptions.find(s => elseProf && s.user_id === elseProf.id);
check('an address not on the list is a normal 3-roof / 30-day trial',
  elseSub && elseSub.trial_roof_limit === 3 && !(elseSub.trial_drip && elseSub.trial_drip.comp) &&
  (db.companies.find(c => c.id === (db.company_users.find(m => m.user_id === elseProf.id) || {}).company_id) || {}).plan !== 'team',
  JSON.stringify(elseSub));
const ELSE = tokOf(elseProf.id, elseProf.email, (db.company_users.find(m => m.user_id === elseProf.id) || {}).company_id);
r = await api('GET', '/subscription', null, ELSE);
check('…and /subscription has no comp for it', r.body && r.body.comp === null, JSON.stringify(r.body && r.body.comp));

// ── the env list adds; junk is ignored ───────────────────────────
r = await register('extra@pilot.co.nz', 'Pilot Roofing');
const exProf = db.profiles.find(p => p.email === 'extra@pilot.co.nz');
const exCo = (db.company_users.find(m => m.user_id === exProf.id) || {}).company_id;
const exSub = db.subscriptions.find(s => s.user_id === exProf.id);
check('COMP_SIGNUPS on the environment adds an address, on its own plan and date',
  (db.companies.find(c => c.id === exCo) || {}).plan === 'solo' &&
  exSub.trial_ends_at === new Date('2027-02-28T23:59:59+13:00').toISOString(), JSON.stringify(exSub));

// ── the sweep: an account that already existed ──────────────────
r = await api('POST', '/admin/comp/run', {}, null, false);
check('the sweep is admin-only', r.status === 404, String(r.status));
r = await api('POST', '/admin/comp/run', {}, null, true);
const luke = db.subscriptions.find(s => s.id === 's1');
check('Luke, who signed up before the list, is comped by the sweep',
  r.status === 200 && luke.trial_ends_at === UNTIL && !(Number(luke.trial_roof_limit) > 0) &&
  luke.trial_drip.comp && luke.trial_drip.d1 === 'x' && /^comped/.test(luke.trial_drip.d12) &&
  db.companies.find(c => c.id === CO_LUKE).plan === 'team' &&
  r.body.applied.some(a => a.email === 'ceo@ranz.co.nz'), JSON.stringify(r.body) + ' ' + JSON.stringify(luke));
check('a PAYING account on the list is left alone',
  db.subscriptions.find(s => s.id === 's2').status === 'active' && db.companies.find(c => c.id === CO_PAY).plan === 'solo' &&
  r.body.skipped.some(x => x.email === 'pat@paying.co.nz' && /paying/.test(x.why)), JSON.stringify(r.body.skipped));
check('the testers not signed up yet are reported, not created',
  r.body.skipped.some(x => x.email === 'madison.taylor@roofguard.co.nz' && /not signed up/.test(x.why)), JSON.stringify(r.body.skipped));
const before = JSON.stringify(db.subscriptions);
r = await api('POST', '/admin/comp/run', {}, null, true);
check('a second sweep writes nothing', r.status === 200 && !r.body.applied.length && JSON.stringify(db.subscriptions) === before,
  JSON.stringify(r.body.applied));

// ── the drip sends nothing to a comped account ───────────────────
const LUKE_TOK = tokOf(LUKE, 'ceo@ranz.co.nz', CO_LUKE);
r = await api('GET', '/subscription', null, LUKE_TOK);
check("Luke's /subscription reads complimentary Team", r.body && r.body.comp && r.body.comp.plan === 'team', JSON.stringify(r.body && r.body.comp));

const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
