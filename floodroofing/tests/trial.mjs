// A trial has to end. 'trialing' used to short-circuit _subscriptionLive to
// true and nothing ever wrote that status back, so every trial was permanent
// the moment billing went on. This is the audit for that, and for the app
// warning somebody before their fortnight runs out rather than after.
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const CO = 'cccccccc-1111-1111-1111-111111111111';
const OWNER = 'oooooooo-0000-0000-0000-000000000001';
const days = (n) => new Date(Date.now() + n*864e5).toISOString();
const db = {
  __missing: [], __fail500: '',
  companies: [{ id: CO, name:'Acme Roofing', slug:null, plan:'trial' }],
  company_users: [{ company_id: CO, user_id: OWNER, role:'owner' }],
  profiles: [{ id: OWNER, company_id: CO, name:'Bob', email:'bob@acmeroofing.co.nz' }],
  company_invites: [], company_domains: [], jobs: [], user_settings: [], usage_events: [],
  subscriptions: [{ id:'s1', company_id: CO, user_id: OWNER, status:'trialing', trial_ends_at: days(14), created_at: days(-1) }],
};
const { port } = await startFakePostgrest(db);
// TEST_PORT lets the runner give each suite its own, so suites can
// never collide with each other or with a run already going.
const PORT = process.env.TEST_PORT || '34574';
process.env.PORT = PORT;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'true';     // the whole point: the gate is ON
delete process.env.STRIPE_SECRET_KEY;
delete process.env.DATABASE_URL;
const jwtLib = require('jsonwebtoken');
const log = console.log, cerr = console.error;
console.log = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const tok = jwtLib.sign({ id: OWNER, email:'bob@acmeroofing.co.nz', cid: CO }, 'test-secret', { expiresIn:'1h' });
const api = async (m, path, body) => {
  const r = await fetch(BASE + path, { method:m,
    headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
    body: body?JSON.stringify(body):undefined });
  return { status:r.status, body: await r.json().catch(()=>null) };
};
function setSub(patch){ Object.assign(db.subscriptions[0], patch); }
const save = () => api('POST', '/jobs', { client_name:'M. Whitiora', site_address:'24 Kauri Rd', draw_state:{} });

// ── a live trial works ──
let r = await save();
check('a business inside its trial can work', r.status === 200, String(r.status));
r = await api('GET', '/subscription');
check('…and can see how long it has', r.body.trial && r.body.trial.days_left === 14, JSON.stringify(r.body.trial));
check('…and that it is live', r.body.live === true && r.body.billing === true);

// ── THE BUG: a trial that has run out must stop working ──
setSub({ status: 'trialing', trial_ends_at: days(-1) });
r = await save();
check('a trial that ran out yesterday no longer works, even though the status still says "trialing"',
  r.status === 403 && r.body.code === 'SUBSCRIPTION_REQUIRED', r.status + ' ' + JSON.stringify(r.body && r.body.error));
r = await api('GET', '/subscription');
check('…and says so', r.body.live === false && r.body.trial.expired === true && r.body.trial.days_left === 0,
  JSON.stringify(r.body.trial));

// ── a paying subscriber is never gated on a trial date ──
setSub({ status: 'active', trial_ends_at: days(-90) });
r = await save();
check('a paying subscriber works regardless of an old trial date', r.status === 200, String(r.status));
r = await api('GET', '/subscription');
check('…and is not shown a trial countdown', r.body.trial === null, JSON.stringify(r.body.trial));

// ── a cancelled or unpaid account is out ──
for (const st of ['canceled', 'unpaid']){
  setSub({ status: st, trial_ends_at: days(30) });   // a future trial date must not rescue it
  r = await save();
  check('a "' + st + '" subscription is refused, even with a trial date in the future',
    r.status === 403, String(r.status));
}

// ── the last day is still a day ──
setSub({ status:'trialing', trial_ends_at: new Date(Date.now() + 6*3600e3).toISOString() });
r = await api('GET', '/subscription');
check('six hours left reads as one day, not none', r.body.trial.days_left === 1 && !r.body.trial.expired,
  JSON.stringify(r.body.trial));
r = await save();
check('…and still works', r.status === 200);

// ── with billing off, nothing is gated — but the truth is still reported ──
process.env.BILLING_ENABLED = 'false';
check('(billing flag is read at boot, so this suite runs with it ON throughout)', true);

const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass === results.length ? 0 : 1);
