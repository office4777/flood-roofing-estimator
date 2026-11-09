// NEW BUILD — AI YOUR PLANS (2026-11-09, the owner: "this AI Your Plans
// should only be offered in the team tier ... Not the measure, not the
// trade, but the team"). POST /newbuild/specs over the real server and the
// fake database: no login is a 401; Measure and Trade are a 403
// PLAN_TEAM_ONLY; Team, a trial and an older payer on legacy terms are let
// through; the page text and the company's own products reach the AI; the
// answer comes back as the specs; nothing read is a 400.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { createRequire } from 'node:module';
import { startFakePostgrest } from './fakepgrst.mjs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const days = (n) => new Date(Date.now() + n*864e5).toISOString();
const id = (k) => 'cccccccc-0000-0000-0000-00000000000' + k;
const uid = (k) => 'uuuuuuuu-0000-0000-0000-00000000000' + k;
// M = Measure, T = Trade, D = Team, E = a trial.
const CO = { M: id(1), T: id(2), D: id(3), E: id(4) };
const US = { M: uid(1), T: uid(2), D: uid(3), E: uid(4) };
const plan = { M:'measure', T:'solo', D:'team', E:'trial' };
const db = { __missing: [], __fail500: '',
  companies: Object.keys(CO).map(k => ({ id: CO[k], name: 'Co ' + k, slug: null, plan: plan[k] })),
  company_users: Object.keys(CO).map(k => ({ company_id: CO[k], user_id: US[k], role: 'owner' })),
  profiles: Object.keys(CO).map(k => ({ id: US[k], company_id: CO[k], name: k, email: k.toLowerCase() + '@co.nz' })),
  company_invites: [], company_domains: [], user_settings: [], usage_events: [], trial_roofs: [], plan_roofs: [], jobs: [],
  subscriptions: [
    { id:'sM', company_id: CO.M, user_id: US.M, status:'active', paid_since: days(-1), created_at: days(-20) },
    { id:'sT', company_id: CO.T, user_id: US.T, status:'active', paid_since: days(-1), created_at: days(-2) },
    { id:'sD', company_id: CO.D, user_id: US.D, status:'active', paid_since: days(-1), created_at: days(-2) },
    { id:'sE', company_id: CO.E, user_id: US.E, status:'trialing', trial_ends_at: days(20), trial_roof_limit: null, created_at: days(-1) },
  ],
};
const { port } = await startFakePostgrest(db);
const PORT = process.env.TEST_PORT || '34681';
process.env.PORT = PORT;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PLAN_CACHE_MS = '0';
process.env.BILLING_ENABLED = 'true';
process.env.PLAN_TERMS_FROM = days(-10);
process.env.TENDERING_USERS = 'nobody@nowhere.nz';
delete process.env.TENDERING_ALL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.DATABASE_URL;
delete process.env.EMAIL_ENABLED;
delete process.env.ANTHROPIC_API_KEY;

const CALLS = [];
globalThis.__TEST_TENDER_AI = async (req) => {
  CALLS.push(req);
  if (req.tool !== 'record_specs') return {};
  return { profile: { spec: '0.55 Maxam Trimline', match_id: '', pages: [3] }, steel_thickness: { spec: '0.55', pages: [3] },
    steel_grade: { spec: 'Colorsteel Maxam', match_id: 'maxam', pages: [3] }, gutter: { spec: 'Marley Typhoon', match_id: 'marley_typhoon', pages: [4] },
    pitch_deg: 25, conflicts: [], notes: [] };
};

const jwtLib = require('jsonwebtoken');
const log = console.log, cerr = console.error, cwarn = console.warn;
console.log = () => {}; console.error = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr; console.warn = cwarn;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const TOK = {}; Object.keys(CO).forEach(k => { TOK[k] = jwtLib.sign({ id: US[k], email: k.toLowerCase() + '@co.nz', cid: CO[k] }, 'test-secret', { expiresIn: '1h' }); });
async function post(tok, body){
  const r = await fetch(BASE + '/newbuild/specs', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}), body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
const BODY = { pages: [ { page: 3, text: 'ROOF PLAN  SCALE 1:100 @ A3  Roofing: 0.55 Maxam Trimline' }, { page: 4, text: 'Spouting: Marley Typhoon' } ],
  products: { grades: [ { id: 'colorsteel', name: 'Colorsteel Endura' }, { id: 'maxam', name: 'Colorsteel Maxam' } ], profiles: [ { id: 'corrugate', name: 'Corrugate' } ], gutters: [ { id: 'marley_typhoon', name: 'Marley Typhoon' } ] } };

let r = await post(null, BODY);
check('no login is refused', r.status === 401, r.status);
r = await post(TOK.M, BODY);
check('a Measure business is refused: Team only', r.status === 403 && r.body && r.body.code === 'PLAN_TEAM_ONLY' && r.body.needs === 'Team', JSON.stringify([r.status, r.body]));
r = await post(TOK.T, BODY);
check('a Trade business is refused: Team only', r.status === 403 && r.body && r.body.code === 'PLAN_TEAM_ONLY', JSON.stringify([r.status, r.body && r.body.code]));
check('a refused call never reaches the AI', CALLS.length === 0, CALLS.length);

r = await post(TOK.D, BODY);
check('a Team business gets the specs', r.status === 200 && r.body && r.body.specs && r.body.specs.profile && r.body.specs.profile.spec === '0.55 Maxam Trimline', JSON.stringify([r.status, r.body && r.body.specs && r.body.specs.profile]));
const c = CALLS[CALLS.length - 1] || {};
check('the AI is asked with the record_specs tool', c.tool === 'record_specs', c.tool);
check('the page text reaches the AI, page by page', /=== PAGE 3 ===/.test(c.text || '') && /0\.55 Maxam Trimline/.test(c.text || '') && /=== PAGE 4 ===/.test(c.text || ''));
check('the company\'s own products reach the AI', /maxam \| Colorsteel Maxam/.test(c.text || '') && /marley_typhoon \| Marley Typhoon/.test(c.text || ''));
check('the answer says which model and prompt', !!(r.body && r.body.model && r.body.prompt), JSON.stringify([r.body && r.body.model, r.body && r.body.prompt]));

r = await post(TOK.E, BODY);
check('a trial (which is Team) gets the specs', r.status === 200 && r.body && r.body.specs, r.status);

r = await post(TOK.D, { pages: [], products: {} });
check('nothing read off the plans is a 400', r.status === 400 && r.body && r.body.code === 'NO_PAGES', JSON.stringify([r.status, r.body && r.body.code]));

globalThis.__TEST_TENDER_AI = async () => { throw new Error('model down'); };
r = await post(TOK.D, BODY);
check('an AI failure is a 502 that says so', r.status === 502 && /could not read the plans/.test((r.body && r.body.error) || ''), JSON.stringify([r.status, r.body]));

const ok = results.filter(Boolean).length;
console.log('\n' + ok + '/' + results.length + ' passed');
process.exit(ok === results.length ? 0 : 1);
