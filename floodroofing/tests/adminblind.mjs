// The support tools must not be able to read anybody's work.
//
// RoofMap is run by Flood Roofing, a roofing company. Every roofer who signs
// up is handing their jobs, their customers, their margins and their price
// book to a competitor's software — and the first thing a careful one does is
// go and read the privacy page. The answer there is only worth printing if
// the code makes it true, so this suite is the enforcement behind the claim:
//
//   no /admin route hands back a job, a quote, a price, a drawing, or a
//   homeowner's name, address, phone or email.
//
// Accounts, plans, counts and errors: yes — that is what support is. The work
// itself: never. If someone adds a "just show me their last job" endpoint to
// chase a bug, this fails and the privacy page stops being a lie.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// One company, one job, with everything a roofer would not want a competitor
// to see. Every string here is a canary: if any of them comes back out of an
// admin route, the claim on the privacy page is false.
const CANARY = {
  client: 'Mrs Henrietta Blackwood',
  address: '221A Huaroa Road, Russell',
  phone: '021 555 0142',
  email: 'henrietta@example.co.nz',
  price: '48250.75',
  rate: '19.85',
  note: 'Margin is thin on this one, do not lose it',
};
const CO = 'co-priv-1', ME = 'user-priv-1';
const db = {
  companies: [{ id: CO, name: 'Kauri Roofing', plan: 'team', created_at: '2026-08-01' }],
  company_users: [{ company_id: CO, user_id: ME, role: 'owner' }],
  profiles: [{ id: ME, email: 'sam@kauri.co.nz', name: 'Sam', company_id: CO, phone: '09 123 4567' }],
  subscriptions: [{ user_id: ME, company_id: CO, status: 'active', stripe_customer_id: 'cus_1' }],
  jobs: [{
    id: 'job-priv-1', company_id: CO, user_id: ME,
    client_name: CANARY.client, site_address: CANARY.address,
    client_phone: CANARY.phone, client_email: CANARY.email,
    updated_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z',
    draw_state: { state: { quote: { total: CANARY.price, notes: CANARY.note,
      share: { token: 'tok-priv', events: [] } } },
      draw: { outline: [{ x: 1, y: 2 }] } },
  }],
  user_settings: [{ user_id: ME, company_id: CO, branding: {}, quote_defaults: {}, jms_keys: {},
    price_book: { steel_per_m2: CANARY.rate }, labour_pricing: {}, ui_flags: {}, selectables: {},
    schedule_cfg: {}, billing_email: '', updated_at: '2026-09-01T00:00:00Z' }],
  usage_events: [], platform_state: [], waitlist: [], invoices: [], company_invites: [],
  cancellations: [], job_revisions: [],
};

const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_TOKEN = 'admin-token-adminblind-000';
const PORT = process.env.TEST_PORT || '34955';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
delete process.env.STRIPE_SECRET_KEY;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT, TOK = process.env.ADMIN_TOKEN;

// Every admin GET that reads data, in the shapes support actually uses.
const ROUTES = [
  '/admin/accounts', '/admin/accounts?format=csv', '/admin/accounts?format=html',
  '/admin/account?email=sam@kauri.co.nz',
  '/admin/usage', '/admin/analytics', '/admin/analytics/day', '/admin/analytics/days',
  '/admin/grandfather', '/admin/db-health', '/admin/waitlist', '/admin/errors',
  '/admin/daily/preview', '/admin/metrics/preview', '/admin/billing-readiness',
];
const leaks = [];
for (const r of ROUTES){
  const sep = r.includes('?') ? '&' : '?';
  let body = '';
  try {
    const res = await fetch(BASE + r + sep + 'token=' + encodeURIComponent(TOK));
    body = await res.text();
  } catch (e) { body = ''; }
  for (const [what, needle] of Object.entries(CANARY)){
    if (body.includes(needle)) leaks.push(r + ' leaked ' + what);
  }
}
check('THE CLAIM: no admin route hands back a job, a quote, a price or a homeowner',
  leaks.length === 0, leaks.slice(0, 6).join(' | '));

// …while still being useful: support has to be able to find the ACCOUNT.
const accounts = await (await fetch(BASE + '/admin/accounts?token=' + TOK)).json();
check('…and support can still see the account it is helping',
  JSON.stringify(accounts).includes('Kauri Roofing') && JSON.stringify(accounts).includes('sam@kauri.co.nz'),
  JSON.stringify(accounts).slice(0, 120));

// The tools are not open to whoever finds the URL, either.
const noTok = await fetch(BASE + '/admin/accounts');
check('…and none of it opens without the admin token', noTok.status === 404, String(noTok.status));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
