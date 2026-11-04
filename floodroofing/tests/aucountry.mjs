// AUSTRALIA, THE SERVER'S HALF (2026-11-04, the owner: "set up the AUD prices
// and invoice wording, also setup my domain roofmap.com ... make the user
// enter their country (New Zealand or Australia) on sign up"). Against the
// real server on the fake PostgREST, with a Stripe stand-in:
//   - a sign-up that says AU makes an Australian business; none says NZ;
//   - /subscription answers the country and the currency;
//   - an Australian checkout asks Stripe for AUD at the same price and lands
//     back on roofmap.com; a New Zealand one is unchanged;
//   - only the owner moves the business between countries;
//   - the AUD price options are added once, at the NZD numbers.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const NZ = 'cccccccc-1111-1111-1111-111111111111';
const AU = 'cccccccc-2222-2222-2222-222222222222';
const U_NZ = 'uuuuuuuu-0000-0000-0000-000000000001';
const U_AU = 'uuuuuuuu-0000-0000-0000-000000000002';
const U_MEM = 'uuuuuuuu-0000-0000-0000-000000000003';
const db = {
  __missing: [],
  companies: [{ id: NZ, name: 'Kiwi Roofing', plan: 'trial', country: 'NZ' }, { id: AU, name: 'Aussie Roofing', plan: 'trial', country: 'AU' }],
  company_users: [{ company_id: NZ, user_id: U_NZ, role: 'owner' }, { company_id: AU, user_id: U_AU, role: 'owner' }, { company_id: AU, user_id: U_MEM, role: 'member' }],
  profiles: [{ id: U_NZ, company_id: NZ, email: 'kiwi@example.co.nz' }, { id: U_AU, company_id: AU, email: 'aussie@example.com.au' }, { id: U_MEM, company_id: AU, email: 'mate@example.com.au' }],
  subscriptions: [{ user_id: U_NZ, company_id: NZ, status: 'trialing', trial_ends_at: '2020-01-01T00:00:00Z' },
                  { user_id: U_AU, company_id: AU, status: 'trialing', trial_ends_at: '2020-01-01T00:00:00Z' }],
  invoices: [], usage_events: [], company_invites: [], user_settings: [], jobs: [], waitlist: [],
};

// The Stripe stand-in: records what is sent; the prices it holds start NZD-only.
const prices = {
  price_team_299: { id: 'price_team_299', currency: 'nzd', unit_amount: 29900, tax_behavior: 'exclusive', currency_options: { nzd: {} } },
  price_solo_149: { id: 'price_solo_149', currency: 'nzd', unit_amount: 14900, tax_behavior: 'exclusive', currency_options: { nzd: {} } },
  price_team_2990: { id: 'price_team_2990', currency: 'nzd', unit_amount: 299000, tax_behavior: 'exclusive', currency_options: { nzd: {}, aud: { unit_amount: 299000 } } },
};
const calls = [];
const stripe = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d);
  req.on('end', () => {
    const p = new URLSearchParams(body); calls.push({ m: req.method, path: req.url, body: p });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const pm = req.url.match(/^\/v1\/prices\/([^?]+)/);
    if (pm){
      const pr = prices[decodeURIComponent(pm[1])];
      if (!pr){ res.writeHead(404); return res.end('{"error":{"message":"No such price"}}'); }
      if (req.method === 'POST'){
        const amt = p.get('currency_options[aud][unit_amount]');
        if (amt) pr.currency_options.aud = { unit_amount: +amt, tax_behavior: p.get('currency_options[aud][tax_behavior]') || undefined };
      }
      return res.end(JSON.stringify(pr));
    }
    if (req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }));
    res.end('{}');
  });
});
await new Promise(r => stripe.listen(0, '127.0.0.1', r));

const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34671';
process.env.PORT = PORT;
process.env.STRIPE_SECRET_KEY = 'sk_test_123';
process.env.STRIPE_API_BASE = 'http://127.0.0.1:' + stripe.address().port;
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
process.env.ADMIN_TOKEN = 'admin-au';
process.env.STRIPE_PRICE_SOLO = 'price_solo_149';
process.env.STRIPE_PRICE_TEAM = 'price_team_299';
process.env.STRIPE_PRICE_TEAM_ANNUAL = 'price_team_2990';
delete process.env.STRIPE_PRICE_MEASURE; delete process.env.STRIPE_PRICE_BUSINESS;
delete process.env.STRIPE_PRICE_SOLO_ANNUAL; delete process.env.STRIPE_PRICE_MEASURE_ANNUAL; delete process.env.STRIPE_PRICE_BUSINESS_ANNUAL;
delete process.env.STRIPE_PRICE_TEAM_AUD; delete process.env.AUD_PRICES_BOOT;
process.env.PLAN_CACHE_MS = '0';
process.env.OPEN_REGISTRATION = 'true';
process.env.VERIFY_EMAIL = 'false';
delete process.env.DATABASE_URL;
const jwtLib = require('jsonwebtoken');
const tok = (id, cid, email) => jwtLib.sign({ id, email: email || 'x@example.com', cid }, 'test-secret', { expiresIn: '1h' });
const log = console.log, cerr = console.error, cwarn = console.warn;
console.log = () => {}; console.error = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr; console.warn = cwarn;
await new Promise(r => setTimeout(r, 700));
const B = 'http://127.0.0.1:' + PORT;
const call = async (m, path, body, token, ip) => {
  const r = await fetch(B + path, { method: m,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, ip ? { 'X-Forwarded-For': ip } : {}),
    body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch(e){}
  return { status: r.status, body: j };
};

// ── sign-up ──
let r = await call('POST', '/auth/register', { email: 'new.au@example.com.au', password: 'password123', phone: '0412 345 678', name: 'Bruce', company: 'Bruce Roofing Pty Ltd', interests: ['quotes'], country: 'AU' }, null, '198.51.100.7');
const auProf = db.profiles.find(p => p.email === 'new.au@example.com.au');
const auCo = auProf && db.companies.find(c => c.id === auProf.company_id);
check('a sign-up that says Australia makes an Australian business', r.status < 300 && auCo && auCo.country === 'AU', JSON.stringify([r.status, r.body && (r.body.error || r.body.code), auCo]));
r = await call('POST', '/auth/register', { email: 'new.nz@example.co.nz', password: 'password123', phone: '021 555 0100', name: 'Kiri', company: 'Kiri Roofing', interests: ['quotes'] }, null, '198.51.100.8');
const nzProf = db.profiles.find(p => p.email === 'new.nz@example.co.nz');
const nzCo = nzProf && db.companies.find(c => c.id === nzProf.company_id);
check('…and one that says nothing is a New Zealand business, as every sign-up was', r.status < 300 && nzCo && nzCo.country === 'NZ', JSON.stringify(nzCo));

// ── /subscription ──
r = await call('GET', '/subscription', undefined, tok(U_AU, AU));
check('/subscription tells an Australian business it is AU and pays in AUD', r.status === 200 && r.body.country === 'AU' && r.body.currency === 'aud', JSON.stringify({ c: r.body && r.body.country, cur: r.body && r.body.currency }));
r = await call('GET', '/subscription', undefined, tok(U_NZ, NZ));
check('…and a New Zealand one NZ and NZD', r.status === 200 && r.body.country === 'NZ' && r.body.currency === 'nzd', JSON.stringify({ c: r.body && r.body.country, cur: r.body && r.body.currency }));

// ── checkout ──
let n0 = calls.length;
r = await call('POST', '/billing/checkout', { plan: 'team' }, tok(U_AU, AU, 'aussie@example.com.au'));
let cs = calls.slice(n0).find(c => c.path === '/v1/checkout/sessions');
check('an Australian checkout is Stripe Checkout at the same price, in AUD', r.status === 200 && cs && cs.body.get('line_items[0][price]') === 'price_team_299' && cs.body.get('currency') === 'aud' && r.body.currency === 'aud',
  JSON.stringify([r.status, r.body, cs && cs.body.toString().slice(0, 160)]));
check('…marked as an Australian business and coming back to roofmap.com', cs && cs.body.get('metadata[country]') === 'AU' && /^https:\/\/roofmap\.com\//.test(cs.body.get('success_url') || ''), cs && cs.body.get('success_url'));
n0 = calls.length;
r = await call('POST', '/billing/checkout', { plan: 'team' }, tok(U_NZ, NZ, 'kiwi@example.co.nz'));
cs = calls.slice(n0).find(c => c.path === '/v1/checkout/sessions');
check('a New Zealand checkout is unchanged — no currency asked for, back to roofmap.co.nz',
  r.status === 200 && cs && !cs.body.get('currency') && !cs.body.get('metadata[country]') && /roofmap\.co\.nz/.test(cs.body.get('success_url') || ''), cs && cs.body.toString().slice(0, 160));

// ── moving country ──
r = await call('PUT', '/company/country', { country: 'NZ' }, tok(U_MEM, AU, 'mate@example.com.au'));
check('a member cannot move the business to another country', r.status === 403 && db.companies.find(c => c.id === AU).country === 'AU', JSON.stringify([r.status, r.body]));
r = await call('PUT', '/company/country', { country: 'Mars' }, tok(U_AU, AU, 'aussie@example.com.au'));
check('…the owner can only pick NZ or AU', r.status === 400, String(r.status));
r = await call('PUT', '/company/country', { country: 'NZ' }, tok(U_AU, AU, 'aussie@example.com.au'));
check('…and the owner moving it is written to the business', r.status === 200 && r.body.country === 'NZ' && db.companies.find(c => c.id === AU).country === 'NZ', JSON.stringify(r.body));
await call('PUT', '/company/country', { country: 'AU' }, tok(U_AU, AU, 'aussie@example.com.au'));

// ── AUD price options ──
r = await call('POST', '/admin/aud-prices/run?token=admin-au', {}, null);
if (r.status === 401 || r.status === 403) r = await fetch(B + '/admin/aud-prices/run', { method: 'POST', headers: { 'x-admin-token': 'admin-au', Authorization: 'Bearer admin-au' } }).then(async x => ({ status: x.status, body: await x.json().catch(() => null) }));
check('the AUD options are added to each NZD price at the same numbers', r.status === 200 && prices.price_team_299.currency_options.aud && prices.price_team_299.currency_options.aud.unit_amount === 29900 &&
  prices.price_solo_149.currency_options.aud.unit_amount === 14900 && prices.price_team_299.currency_options.aud.tax_behavior === 'exclusive', JSON.stringify([r.status, r.body]));
check('…and a price that already has one is left alone', r.body && r.body.already === 1 && r.body.added === 2, JSON.stringify(r.body));
const n1 = calls.filter(c => c.m === 'POST' && /^\/v1\/prices\//.test(c.path)).length;
r = await call('POST', '/admin/aud-prices/run?token=admin-au', {}, null);
const n2 = calls.filter(c => c.m === 'POST' && /^\/v1\/prices\//.test(c.path)).length;
check('…so running it again changes nothing', n2 === n1, n1 + ' → ' + n2);

stripe.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
