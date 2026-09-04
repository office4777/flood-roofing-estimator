// A sandbox Stripe key on the live service must NOT lock real customers out.
//
// BILLING_ENABLED used to be `=== 'true' || !!STRIPE_SECRET_KEY`, so the
// moment a key was added to Railway — even a test one, added only to check
// the wiring — the subscription gate switched on for every account, and
// setting BILLING_ENABLED=false could not switch it back off. This suite
// pins the explicit OFF switch: key present, flag false, gate open.
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
  // Deliberately empty: this company has no subscription row at all, which
  // is exactly the shape that got 403'd.
  subscriptions: [], jobs: [], user_settings: [], company_invites: [], company_domains: [],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34611';
process.env.PORT = PORT;
process.env.STRIPE_SECRET_KEY = 'sk_test_sandbox';   // the key IS present
process.env.BILLING_ENABLED = 'false';               // …and explicitly overridden
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

let r = await api('GET', '/jms/debug');
check('with BILLING_ENABLED=false the gate reports itself bypassed',
  r.body && r.body.billing_enabled === false, JSON.stringify(r.body && r.body.subscription_gate));

r = await api('GET', '/subscription');
check('…and /subscription tells the app it is live regardless',
  r.status === 200 && r.body.billing === false && r.body.live === true, JSON.stringify(r.body));

r = await api('POST', '/jobs', { name:'Test job', address:'1 Kauri Rd' });
check('…so saving a job is not 403 SUBSCRIPTION_REQUIRED with no subscription row',
  r.status !== 403, r.status + ' ' + JSON.stringify(r.body && r.body.code));

r = await api('POST', '/claude/quote', { prompt:'hi' });
check('…and neither is an AI call',
  !(r.status === 403 && r.body && r.body.code === 'SUBSCRIPTION_REQUIRED'),
  r.status + ' ' + JSON.stringify(r.body && r.body.code));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
