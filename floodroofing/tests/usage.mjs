// Before this there was no way to tell a trialist who drew a roof and sent a
// quote from one who signed up, saw an empty screen and closed the tab. Both
// looked identical. This is the audit for the funnel that separates them —
// and for the rule that it stays a funnel and never becomes page tracking.
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
const CO2 = 'cccccccc-2222-2222-2222-222222222222';
const OWNER = 'oooooooo-0000-0000-0000-000000000001';
const db = {
  __missing: [], __fail500: '',
  companies: [{ id: CO, name:'Acme Roofing', slug:null, plan:'business' },
              { id: CO2, name:'Second Roofing', slug:null, plan:'business' }],
  company_users: [{ company_id: CO, user_id: OWNER, role:'owner' }],
  profiles: [{ id: OWNER, company_id: CO, name:'Bob', email:'bob@acmeroofing.co.nz' }],
  company_invites: [], company_domains: [], subscriptions: [], jobs: [], user_settings: [],
  usage_events: [],
};
const { port } = await startFakePostgrest(db);
// TEST_PORT lets the runner give each suite its own, so suites can
// never collide with each other or with a run already going.
const PORT = process.env.TEST_PORT || '34573';
process.env.PORT = PORT;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.BILLING_ENABLED = 'false';
process.env.PLAN_CACHE_MS = '0';
process.env.ADMIN_TOKEN = 'let-me-in-please-0000';
delete process.env.DATABASE_URL;
const jwtLib = require('jsonwebtoken');
const log = console.log, cerr = console.error;
console.log = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const tok = jwtLib.sign({ id: OWNER, email:'bob@acmeroofing.co.nz', cid: CO }, 'test-secret', { expiresIn:'1h' });
const api = async (m, path, body, t) => {
  const r = await fetch(BASE + path, { method:m,
    headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + (t === undefined ? tok : t) },
    body: body?JSON.stringify(body):undefined });
  return { status:r.status, body: await r.json().catch(()=>null) };
};
const settle = () => new Promise(r => setTimeout(r, 250));
const names = () => db.usage_events.map(e => e.name);

// ── the funnel view is shut without a token ──
let r = await fetch(BASE + '/admin/usage');
check('the funnel is not readable without the admin token', r.status === 404, String(r.status));
r = await api('GET', '/admin/usage?token=let-me-in-please-0000');
check('…and readable with it', r.status === 200 && Array.isArray(r.body.funnel), JSON.stringify(r.body && r.body.signups));

// ── the milestones a business actually passes ──
await api('POST', '/jobs', { client_name:'M. Whitiora', site_address:'24 Kauri Rd', draw_state:{} });
await settle();
check('saving a job is recorded', names().indexOf('job_saved') >= 0, JSON.stringify(names()));

await api('PUT', '/settings', { branding:{ company_name:'Acme Roofing Ltd', phone:'09 123 4567' },
  quote_defaults:{}, jms_keys:{}, price_book:{ list_prices:false }, labour_pricing:{} });
await settle();
check('putting their own name and number on their quotes is a milestone',
  names().indexOf('setup_done') >= 0, JSON.stringify(names()));
check('…and so is replacing our sample prices with their own',
  names().indexOf('price_book_saved') >= 0);

// still on the sample figures = not a milestone
const before = names().filter(n => n === 'price_book_saved').length;
await api('PUT', '/settings', { branding:{ company_name:'Acme Roofing Ltd', phone:'09 123 4567' },
  quote_defaults:{}, jms_keys:{}, price_book:{ list_prices:true }, labour_pricing:{} });
await settle();
check('…but a price book still on the samples is not',
  names().filter(n => n === 'price_book_saved').length === before);

// ── the two the browser reports ──
r = await api('POST', '/usage', { name: 'sample_opened' });
await settle();
check('the browser can report opening the sample', r.status === 200 && names().indexOf('sample_opened') >= 0);
r = await api('POST', '/usage', { name: 'roof_drawn' });
await settle();
check('…and finishing a roof', r.status === 200 && names().indexOf('roof_drawn') >= 0);

// ── and nothing else ──
r = await api('POST', '/usage', { name: 'clicked_button' });
check('an event name nobody allowed is refused', r.status === 400, JSON.stringify(r.body));
r = await api('POST', '/usage', { name: 'page_view' });
check('…so this can never quietly become page tracking', r.status === 400);
r = await api('POST', '/usage', { name: 'quote_sent' });
check('…and a server-side milestone cannot be faked from a browser', r.status === 400);
r = await fetch(BASE + '/usage', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ name:'roof_drawn' }) });
check('…and a stranger cannot post one at all', r.status === 401 || r.status === 403, String(r.status));

// ── what is stored is a milestone, not a customer ──
const stored = JSON.stringify(db.usage_events);
check('no customer name, address or price is ever stored',
  !/Whitiora/.test(stored) && !/Kauri/.test(stored),
  db.usage_events.length + ' events, ' + stored.length + ' bytes');
check('…only the milestone, the business and the time',
  db.usage_events.every(e => e.name && e.company_id && Object.keys(e).every(
    k => ['id','at','name','company_id','user_id','props'].indexOf(k) >= 0)),
  JSON.stringify(Object.keys(db.usage_events[0] || {})));

// ── the funnel counts businesses, not clicks ──
for (let i = 0; i < 5; i++){ await api('POST', '/usage', { name:'roof_drawn' }); }
db.usage_events.push({ id: 9001, at: new Date().toISOString(), company_id: CO, name:'signed_up', props:{} });
db.usage_events.push({ id: 9002, at: new Date().toISOString(), company_id: CO2, name:'signed_up', props:{} });
await settle();
r = await api('GET', '/admin/usage?token=let-me-in-please-0000');
const f = Object.fromEntries((r.body.funnel||[]).map(x => [x.milestone, x.businesses]));
check('one busy business counts once, not six times',
  f.roof_drawn === 1, JSON.stringify(f));
check('…so a business that signed up and did nothing is visible',
  r.body.signups === 2 && f.job_saved === 1, r.body.signups + ' signed up, ' + f.job_saved + ' saved a job');
const pct = (r.body.funnel||[]).find(x => x.milestone === 'roof_drawn');
check('…and the funnel says what share got there', pct && pct.of_signups === '50%', pct && pct.of_signups);

const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass === results.length ? 0 : 1);
