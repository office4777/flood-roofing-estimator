// THE ROOF TRIAL (2026-10-23, the owner: "swap the 14-day clock for '3 real
// roofs or 30 days, whichever comes first' ... only new trial users not
// existing trial users").
//
// What this pins, against the real server on the fake PostgREST:
//   - a new signup's row is 3 roofs / 30 days; an old row is untouched;
//   - a real roof (outline of 3+ corners WITH a scale) counts once per job,
//     and a version of that job shares its roof;
//   - the practice job, the sample and an unscaled sketch never count;
//   - the 4th real roof is refused (TRIAL_ROOFS_USED) while the 3 counted
//     jobs keep saving;
//   - a 14-day trial from before is never counted against;
//   - /subscription says how many are left and which jobs used them.
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
const CO_OLD = 'cccccccc-2222-2222-2222-222222222222';
const OLD = 'oooooooo-0000-0000-0000-000000000002';
const days = (n) => new Date(Date.now() + n*864e5).toISOString();
const db = {
  __missing: [], __fail500: '',
  companies: [{ id: CO, name:'Acme Roofing', slug:null, plan:'trial' },
              { id: CO_OLD, name:'Old Trial Roofing', slug:null, plan:'trial' }],
  company_users: [{ company_id: CO, user_id: OWNER, role:'owner' }, { company_id: CO_OLD, user_id: OLD, role:'owner' }],
  profiles: [{ id: OWNER, company_id: CO, name:'Bob', email:'bob@acmeroofing.co.nz' },
             { id: OLD, company_id: CO_OLD, name:'Olly', email:'olly@oldtrial.co.nz' }],
  company_invites: [], company_domains: [], jobs: [], user_settings: [], usage_events: [], trial_roofs: [],
  subscriptions: [
    { id:'s1', company_id: CO, user_id: OWNER, status:'trialing', trial_ends_at: days(30), trial_roof_limit: 3, created_at: days(0) },
    { id:'s2', company_id: CO_OLD, user_id: OLD, status:'trialing', trial_ends_at: days(10), trial_roof_limit: null, created_at: days(-4) },
  ],
};
const { port } = await startFakePostgrest(db);
const PORT = process.env.TEST_PORT || '34611';
process.env.PORT = PORT;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'true';
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
const TOK = tokOf(OWNER, 'bob@acmeroofing.co.nz', CO);
const TOK_OLD = tokOf(OLD, 'olly@oldtrial.co.nz', CO_OLD);
const api = async (m, path, body, tok) => {
  const r = await fetch(BASE + path, { method:m,
    headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + (tok || TOK) },
    body: body ? JSON.stringify(body) : undefined });
  return { status:r.status, body: await r.json().catch(()=>null) };
};
const SQ = [[100,100],[400,100],[400,300],[100,300]];
const roof = (extra) => Object.assign({ state:{ quote:{ ref:'J' + Math.random().toString(36).slice(2,7) } },
  draw:{ outline: SQ, scaleMetresPerPx: 0.03 } }, extra || {});
const sketch = () => ({ state:{}, draw:{ outline: SQ, scaleMetresPerPx: 0 } });
const blank = () => ({ state:{}, draw:{ outline: [] } });
const newJob = (ds, tok) => api('POST', '/jobs', { client_name:'C', site_address:'A', draw_state: ds }, tok);
const putJob = (id, ds, tok) => api('PUT', '/jobs/' + id, { draw_state: ds }, tok);
const sub = (tok) => api('GET', '/subscription', null, tok);

// ── a new signup is a roof trial ───────────────────────────────────
const reg = await fetch(BASE + '/auth/register', { method:'POST', headers:{ 'Content-Type':'application/json' },
  body: JSON.stringify({ email:'new@roofer.co.nz', password:'password123', name:'New Roofer', company:'New Roofing',
    phone:'021 555 0101', interests:['satellite'] }) });
const regRow = db.subscriptions.find(s => s.id !== 's1' && s.id !== 's2');
check('a new signup starts on 3 roofs / 30 days',
  reg.status === 200 && regRow && regRow.trial_roof_limit === 3 &&
  Math.abs(Date.parse(regRow.trial_ends_at) - Date.now() - 30*864e5) < 60e3, reg.status + ' ' + JSON.stringify(regRow));
check('…and the existing 14-day trial was not touched', db.subscriptions[1].trial_roof_limit === null);

// ── the counter starts full ────────────────────────────────────────
let r = await sub();
check('/subscription reports 3 of 3 roofs left on a roof trial',
  r.body.trial && r.body.trial.roofs_limit === 3 && r.body.trial.roofs_used === 0 && r.body.trial.roofs_left === 3 &&
  r.body.trial.days === 30 && r.body.trial.days_left === 30, JSON.stringify(r.body.trial));

// ── what is NOT a roof ─────────────────────────────────────────────
r = await newJob(blank());
check('a job with nothing drawn saves and counts nothing', r.status === 200 && db.trial_roofs.length === 0, r.status + ' ' + db.trial_roofs.length);
const blankId = r.body.id;
r = await putJob(blankId, sketch());
check('an outline with no scale is a sketch, not a measured roof', r.status === 200 && db.trial_roofs.length === 0, r.status + ' ' + db.trial_roofs.length);
r = await newJob({ state:{ quote:{ ref:'TEST-1' } }, draw:{ outline: SQ, scaleMetresPerPx: 0.03 } });
check('the practice job (TEST-1) never costs a roof', r.status === 200 && db.trial_roofs.length === 0, String(db.trial_roofs.length));
r = await newJob({ state:{ isSampleJob: true }, draw:{ outline: SQ, scaleMetresPerPx: 0.03 } });
check('…nor does the sample', r.status === 200 && db.trial_roofs.length === 0, String(db.trial_roofs.length));

// ── real roofs count once each ─────────────────────────────────────
r = await putJob(blankId, roof());
check('scaling that sketch makes it roof 1', r.status === 200 && db.trial_roofs.length === 1 && r.body.trialRoofCounted === true,
  r.status + ' ' + JSON.stringify(db.trial_roofs));
const job1 = blankId;
r = await putJob(job1, roof());
r = await putJob(job1, roof());
check('…and saving it again (autosave) does not count it twice', r.status === 200 && db.trial_roofs.length === 1, String(db.trial_roofs.length));
r = await newJob(roof());
check('a new job saved with a measured roof is roof 2', r.status === 200 && db.trial_roofs.length === 2 && r.body.trialRoofCounted === true, String(db.trial_roofs.length));
const job2 = r.body.id;
// A version of job 1 shares job 1's roof.
db.jobs.push({ id:'ver-of-1', user_id: OWNER, company_id: CO, client_name:'C', site_address:'A', draw_state:{}, settings:{}, status:'draft', version_of: job1 });
r = await putJob('ver-of-1', roof());
check('a version of a counted job shares its roof', r.status === 200 && db.trial_roofs.length === 2, r.status + ' ' + db.trial_roofs.length);
r = await newJob(roof({ draw:{ outline: [], roofs:[{ outline: SQ }], scaleMetresPerPx: 0.02 } }));
check('a roof drawn on a second roof tab counts too — roof 3', r.status === 200 && db.trial_roofs.length === 3, String(db.trial_roofs.length) + ' ' + JSON.stringify(r.body));
const job3 = r.body.id;
r = await sub();
check('/subscription: 0 left, and names the three jobs',
  r.body.trial.roofs_used === 3 && r.body.trial.roofs_left === 0 &&
  [job1, job2, job3].every(id => r.body.trial.roof_jobs.indexOf(String(id)) >= 0), JSON.stringify(r.body.trial));
check('…and the trial is still live — 30 days are not up', r.body.live === true);

// ── the 4th is refused, the 3 keep working ─────────────────────────
r = await newJob(roof());
check('a 4th measured roof on a new job is refused, by name',
  r.status === 403 && r.body.code === 'TRIAL_ROOFS_USED' && r.body.roofs_limit === 3 && /3 free roofs/.test(r.body.error),
  r.status + ' ' + JSON.stringify(r.body));
const jobsBefore = db.jobs.length;
check('…and no job row was written for it', db.jobs.length === jobsBefore);
r = await newJob(blank());
check('…but a job with nothing measured on it still saves', r.status === 200, String(r.status));
r = await putJob(r.body.id, roof());
check('…and measuring a roof on it is the refusal', r.status === 403 && r.body.code === 'TRIAL_ROOFS_USED', String(r.status));
r = await putJob(job2, roof());
check('a counted job keeps saving after the three are used', r.status === 200, String(r.status));
r = await putJob('ver-of-1', roof());
check('…and so does a version of one', r.status === 200, String(r.status));
check('nothing beyond three was ever recorded', db.trial_roofs.length === 3, String(db.trial_roofs.length));

// ── an old 14-day trial is never counted against ───────────────────
for (let i = 0; i < 5; i++){
  r = await newJob(roof(), TOK_OLD);
  if (r.status !== 200) break;
}
check('a 14-day trial from before saves five measured roofs without a word', r.status === 200, r.status + ' ' + JSON.stringify(r.body));
check('…and none of them were counted', db.trial_roofs.filter(t => t.company_id === CO_OLD).length === 0);
r = await sub(TOK_OLD);
check('…and /subscription shows it as a plain 14-day clock, no roofs',
  r.body.trial && r.body.trial.roofs_limit === undefined && r.body.trial.days === 14, JSON.stringify(r.body.trial));

// ── a paying business is never counted ─────────────────────────────
db.subscriptions[0].status = 'active';
await sub();   // refreshes the server's minute-long memo
r = await newJob(roof());
check('once they pay, the next roof just saves', r.status === 200 && db.trial_roofs.length === 3, r.status + ' ' + db.trial_roofs.length);
r = await sub();
check('…and /subscription has no trial at all', r.body.trial === null, JSON.stringify(r.body.trial));

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
