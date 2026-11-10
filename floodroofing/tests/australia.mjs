// AUSTRALIA (2026-11-04). RoofMap is sold to Australian roofers on
// roofmap.net, from the same Stripe account, in AUD at the same numbers as
// NZD (A$79 / A$149 / A$299 a month). A business carries a country (NZ or AU,
// null = NZ); a sign-up names it; the app is told it; the owner may change
// it; an Australian checkout asks Stripe for AUD and comes back to
// roofmap.net; every price is given an AUD currency option; an AUD invoice
// says "No GST charged"; emailed links go to the business's own site; and a
// New Zealand business reads exactly as it did before any of this.
// Stripe and the mail relay are local stand-ins; signatures are real HMACs.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const NOW = Date.now(), days = n => new Date(NOW + n * 864e5).toISOString();
const NZ = 'cccccccc-a000-0000-0000-000000000001', AU = 'cccccccc-a000-0000-0000-000000000002',
      AU2 = 'cccccccc-a000-0000-0000-000000000003', AU3 = 'cccccccc-a000-0000-0000-000000000004';
const UNZ = 'uuuuuuuu-a000-0000-0000-000000000001', UAU = 'uuuuuuuu-a000-0000-0000-000000000002',
      UAUM = 'uuuuuuuu-a000-0000-0000-000000000003', UAU2 = 'uuuuuuuu-a000-0000-0000-000000000004',
      UAU3 = 'uuuuuuuu-a000-0000-0000-000000000005';
const db = {
  __missing: [],
  companies: [
    { id: NZ, name: 'Kauri Roofing', plan: 'trial', country: null, created_at: days(-20) },
    { id: AU, name: 'Bondi Roofing', plan: 'trial', country: 'AU', created_at: days(-20) },
    { id: AU2, name: 'Perth Roofing', plan: 'trial', country: 'AU', created_at: days(-20) },
    { id: AU3, name: 'Darwin Roofing', plan: 'trial', country: 'AU', created_at: days(-90) },
  ],
  company_users: [
    { company_id: NZ, user_id: UNZ, role: 'owner', created_at: days(-20) },
    { company_id: AU, user_id: UAU, role: 'owner', created_at: days(-20) },
    { company_id: AU, user_id: UAUM, role: 'member', created_at: days(-19) },
    { company_id: AU2, user_id: UAU2, role: 'owner', created_at: days(-20) },
    { company_id: AU3, user_id: UAU3, role: 'owner', created_at: days(-90) },
  ],
  profiles: [
    { id: UNZ, email: 'sam@kauri.co.nz', name: 'Sam Kauri', company: 'Kauri Roofing', phone: '027 555', company_id: NZ, verify_pending: false },
    { id: UAU, email: 'bruce@bondiroofing.com.au', name: 'Bruce Bondi', company: 'Bondi Roofing', phone: '0412 345 678', company_id: AU, verify_pending: false },
    { id: UAUM, email: 'sheila@bondiroofing.com.au', name: 'Sheila', company: 'Bondi Roofing', phone: '0412 000 000', company_id: AU, verify_pending: false },
    { id: UAU2, email: 'kylie@perthroofing.com.au', name: 'Kylie Perth', company: 'Perth Roofing', phone: '0413 111 222', company_id: AU2, verify_pending: false },
    { id: UAU3, email: 'dazza@darwinroofing.com.au', name: 'Dazza', company: 'Darwin Roofing', phone: '0413 999 000', company_id: AU3, verify_pending: false },
  ],
  subscriptions: [
    { id: 's1', user_id: UNZ, company_id: NZ, status: 'trialing', plan: null, trial_ends_at: days(-0.5), stripe_customer_id: null, stripe_subscription_id: null, trial_ended_mail_at: null, paid_since: null, paid_alert_at: null, created_at: days(-15) },
    { id: 's2', user_id: UAU, company_id: AU, status: 'trialing', plan: null, trial_ends_at: days(-0.5), stripe_customer_id: null, stripe_subscription_id: null, trial_ended_mail_at: null, paid_since: null, paid_alert_at: null, created_at: days(-15) },
    { id: 's3', user_id: UAU2, company_id: AU2, status: 'trialing', plan: null, trial_ends_at: days(10), stripe_customer_id: null, stripe_subscription_id: null, trial_ended_mail_at: null, paid_since: null, paid_alert_at: null, created_at: days(-1) },
    // A trial that ran out two months ago: one the win-back email is for.
    { id: 's4', user_id: UAU3, company_id: AU3, status: 'trialing', plan: null, trial_ends_at: days(-60), stripe_customer_id: null, stripe_subscription_id: null, trial_ended_mail_at: days(-59), paid_since: null, paid_alert_at: null, trial_restarted_at: null, created_at: days(-74) },
  ],
  user_settings: [], usage_events: [], invoices: [], jobs: [], waitlist: [], company_invites: [], company_domains: [],
  platform_state: [], cancel_feedback: [], trial_roofs: [],
};

// ── Stripe, standing in ──────────────────────────────────────────
// Prices remember the currency options they are given, so the second run of
// the AUD job finds them. `refuseAud` makes an AUD checkout fail the way
// Stripe does when a price has no AUD option.
const prices = {
  price_measure_79:    { id: 'price_measure_79',    currency: 'nzd', unit_amount: 7900,   tax_behavior: 'exclusive' },
  price_solo_149:      { id: 'price_solo_149',      currency: 'nzd', unit_amount: 14900,  tax_behavior: 'exclusive', currency_options: { nzd: {}, aud: { unit_amount: 14900 } } },
  price_team_299:      { id: 'price_team_299',      currency: 'nzd', unit_amount: 29900,  tax_behavior: 'exclusive' },
  price_team_2990:     { id: 'price_team_2990',     currency: 'nzd', unit_amount: 299000, tax_behavior: 'unspecified' },
  price_solo_1490:     { id: 'price_solo_1490',     currency: 'nzd', unit_amount: 149000, tax_behavior: 'exclusive' },
};
const stripeCalls = [];
let refuseAud = false;
const stripeSrv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d);
  req.on('end', () => {
    const params = new URLSearchParams(body);
    stripeCalls.push({ method: req.method, path: req.url, body: params });
    const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const pm = /^\/v1\/prices\/([^?]+)/.exec(req.url);
    if (pm){
      const p = prices[decodeURIComponent(pm[1])];
      if (!p) return send(404, { error: { message: 'No such price' } });
      if (req.method === 'POST'){
        p.currency_options = p.currency_options || { [p.currency]: {} };
        p.currency_options.aud = { unit_amount: Number(params.get('currency_options[aud][unit_amount]')),
          tax_behavior: params.get('currency_options[aud][tax_behavior]') || 'unspecified' };
      }
      return send(200, p);
    }
    if (req.url === '/v1/checkout/sessions'){
      if (refuseAud && params.get('currency') === 'aud')
        return send(400, { error: { message: 'The price specified does not support currency aud.', param: 'currency' } });
      return send(200, { id: 'cs_' + stripeCalls.length, url: 'https://checkout.stripe.com/c/pay/cs_' + stripeCalls.length });
    }
    if (req.url === '/v1/billing_portal/sessions') return send(200, { id: 'bps_1', url: 'https://billing.stripe.com/p/session/bps_1' });
    send(200, {});
  });
});
await new Promise(r => stripeSrv.listen(0, '127.0.0.1', r));
const mails = [];
const mailSrv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d);
  req.on('end', () => { try { mails.push(JSON.parse(body)); } catch(e){ mails.push({ raw: body }); }
    res.writeHead(200, {'Content-Type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r => mailSrv.listen(0, '127.0.0.1', r));
const errs = [];
globalThis.__TEST_RECORD_ERROR = (kind, err) => errs.push({ kind, message: String(err && err.message || err) });

const WH = 'whsec_australia';
const ADMIN = 'admin-au-0000';
const { port } = await startFakePostgrest(db);
Object.assign(process.env, {
  SUPABASE_URL: 'http://127.0.0.1:' + port, SUPABASE_SERVICE_KEY: 'k', JWT_SECRET: 'test-secret',
  PORT: process.env.TEST_PORT || '34997', STRIPE_SECRET_KEY: 'sk_test_au', STRIPE_API_BASE: 'http://127.0.0.1:' + stripeSrv.address().port,
  STRIPE_WEBHOOK_SECRET: WH, ADMIN_TOKEN: ADMIN, GAS_MAIL_URL: 'http://127.0.0.1:' + mailSrv.address().port,
  GAS_MAIL_TOKEN: 't', GAS_RELAY_IS_PLATFORM: 'true', NEW_PAYER_ALERT_TO: 'owner@roofmap.test', SIGNUP_ALERT_TO: 'signups@roofmap.test',
  PLAN_CACHE_MS: '0', PUBLIC_APP_URL: 'https://roofmap.co.nz',
  STRIPE_PRICE_MEASURE: 'price_measure_79', STRIPE_PRICE_SOLO: 'price_solo_149', STRIPE_PRICE_TEAM: 'price_team_299',
  STRIPE_PRICE_SOLO_ANNUAL: 'price_solo_1490', STRIPE_PRICE_TEAM_ANNUAL: 'price_team_2990',
  // A separate AUD price named for one plan and cycle: that one is used as it is.
  STRIPE_PRICE_SOLO_ANNUAL_AUD: 'price_solo_1490_aud',
  // The boot job, against this stand-in, quickly.
  AUD_PRICES_BOOT: 'true', AUD_PRICES_BOOT_MS: '200',
});
delete process.env.PUBLIC_APP_URL_AU;
delete process.env.DATABASE_URL;
delete process.env.VERIFY_EMAIL;
delete process.env.OPEN_REGISTRATION;
delete process.env.STRIPE_PRICE_MEASURE_ANNUAL;
const jwtLib = require('jsonwebtoken');
const tok = (id, cid, email) => jwtLib.sign({ id, email: email || 'x@example.com', cid }, 'test-secret', { expiresIn: '1h' });
const log = console.log, cerr = console.error, cwarn = console.warn;
console.log = () => {}; console.error = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
await new Promise(r => setTimeout(r, 900));
console.log = log; console.error = cerr; console.warn = cwarn;
const B = 'http://127.0.0.1:' + process.env.PORT;
const call = async (method, path, body, token, headers) => {
  const r = await fetch(B + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch(e){}
  return { status: r.status, body: j, headers: r.headers };
};
const TAU2 = tok(UAU2, AU2, 'kylie@perthroofing.com.au');
const TNZ = tok(UNZ, NZ, 'sam@kauri.co.nz'), TAU = tok(UAU, AU, 'bruce@bondiroofing.com.au'), TAUM = tok(UAUM, AU, 'sheila@bondiroofing.com.au');
const settle = (ms) => new Promise(r => setTimeout(r, ms || 250));
const mailTo = (re) => mails.filter(m => re.test(String(m.to || '')));
const all = (m) => JSON.stringify(m || {});
// What the reader sees: the words and the links, not the envelope (whose From
// is support@roofmap.co.nz whichever site the links point at).
const body = (m) => String((m && (m.text || m.body)) || '') + '\n' + String((m && m.html) || '');

// ── the boot job gave every price its AUD option ──────────────────
{
  const posts = stripeCalls.filter(c => c.method === 'POST' && /^\/v1\/prices\//.test(c.path));
  const by = id => posts.find(c => c.path === '/v1/prices/' + id);
  check('a minute after boot (here 200 ms), each configured price without an AUD option gets one', !!by('price_measure_79') && !!by('price_team_299') && !!by('price_team_2990') && !!by('price_solo_1490'),
    posts.map(c => c.path).join(' '));
  check('…at its own NZD numbers (A$79, A$299, the yearly A$2,990)', by('price_measure_79') && by('price_measure_79').body.get('currency_options[aud][unit_amount]') === '7900' &&
    by('price_team_299').body.get('currency_options[aud][unit_amount]') === '29900' && by('price_team_2990').body.get('currency_options[aud][unit_amount]') === '299000');
  check('…with the price\'s own tax behaviour (and none copied from an unspecified one)', by('price_measure_79').body.get('currency_options[aud][tax_behavior]') === 'exclusive' &&
    by('price_team_2990').body.get('currency_options[aud][tax_behavior]') === null);
  check('…a price that already has an AUD option is only read, never written', !by('price_solo_149') && stripeCalls.some(c => c.method === 'GET' && /^\/v1\/prices\/price_solo_149\?expand/.test(c.path)));
  check('…and it reads each price with its currency options expanded', stripeCalls.filter(c => c.method === 'GET').every(c => /expand%5B%5D=currency_options/.test(c.path)));
  let r = await call('POST', '/admin/aud-prices/run', {});
  check('POST /admin/aud-prices/run without the admin token is a 404', r.status === 404);
  const before = stripeCalls.length;
  r = await call('POST', '/admin/aud-prices/run', {}, null, { 'x-admin-token': ADMIN });
  check('…with it, run again it adds nothing: every price already has AUD', r.status === 200 && r.body.added === 0 && r.body.already === 5 && r.body.errors === 0, JSON.stringify(r.body));
  check('…and writes nothing to Stripe', stripeCalls.slice(before).every(c => c.method === 'GET'));
  prices.price_measure_79.currency_options = null; prices.price_measure_79.unit_amount = null;
  r = await call('POST', '/admin/aud-prices/run', {}, null, { 'x-admin-token': ADMIN });
  check('a price with no flat amount (tiered) is reported and left alone', r.body.skipped === 1 && r.body.prices.some(p => p.id === 'price_measure_79' && /no unit_amount/.test(p.state)), JSON.stringify(r.body.prices));
  prices.price_measure_79.unit_amount = 7900; prices.price_measure_79.currency_options = { nzd: {}, aud: { unit_amount: 7900 } };
}

// ── CORS: roofmap.net and www.roofmap.net ─────────────────────────
for (const o of ['https://roofmap.net', 'https://www.roofmap.net', 'https://roofmap.co.nz']){
  const r = await fetch(B + '/health', { headers: { Origin: o } });
  check('CORS lets ' + o + ' call the API', r.headers.get('access-control-allow-origin') === o, String(r.headers.get('access-control-allow-origin')));
}
{
  const r = await fetch(B + '/health', { headers: { Origin: 'https://roofmap.net.evil.example' } });
  check('…and not a look-alike host', r.headers.get('access-control-allow-origin') !== 'https://roofmap.net.evil.example');
}

// ── what the app is told ─────────────────────────────────────────
{
  let r = await call('GET', '/auth/me', undefined, TAU);
  check('/auth/me carries the company\'s country (AU)', r.status === 200 && r.body.company && r.body.company.country === 'AU', JSON.stringify(r.body && r.body.company));
  r = await call('GET', '/auth/me', undefined, TNZ);
  check('…a business with no country is NZ', r.body.company && r.body.company.country === 'NZ', JSON.stringify(r.body && r.body.company));
  r = await call('GET', '/subscription', undefined, TAU);
  check('/subscription says AU and aud', r.body.country === 'AU' && r.body.currency === 'aud', JSON.stringify({ c: r.body.country, cur: r.body.currency }));
  r = await call('GET', '/subscription', undefined, TNZ);
  check('…and NZ and nzd for a New Zealand business', r.body.country === 'NZ' && r.body.currency === 'nzd');
  r = await call('GET', '/team', undefined, TAU);
  check('/team\'s company carries the country too', r.body.company && r.body.company.country === 'AU', JSON.stringify(r.body && r.body.company));
}

// ── changing it: the owner, their own business, NZ or AU ─────────
{
  let r = await call('PUT', '/company/country', { country: 'AU' }, TAUM);
  check('PUT /company/country by a member (not the owner) is refused', r.status === 403 && r.body.code === 'OWNER_ONLY', JSON.stringify(r.body));
  r = await call('PUT', '/company/country', { country: 'US' }, TNZ);
  check('…anything but NZ or AU is a 400', r.status === 400);
  r = await call('PUT', '/company/country', { country: 'au' }, TNZ);
  check('the owner sets it (case-blind) and is told what it now is', r.status === 200 && r.body.country === 'AU' && db.companies.find(c => c.id === NZ).country === 'AU', JSON.stringify(r.body));
  check('…only their own business moved', db.companies.find(c => c.id === AU).country === 'AU' && db.companies.find(c => c.id === AU2).country === 'AU');
  r = await call('GET', '/auth/me', undefined, TNZ);
  check('…and the next read sees it', r.body.company.country === 'AU');
  r = await call('PUT', '/company/country', { country: 'NZ' }, TNZ);
  check('…and back to NZ', r.status === 200 && r.body.country === 'NZ' && db.companies.find(c => c.id === NZ).country === 'NZ');
  r = await call('PUT', '/company/country', { country: 'AU' });
  check('…signed out is a 401', r.status === 401);
}

// ── the checkout ─────────────────────────────────────────────────
const lastCheckout = () => stripeCalls.filter(c => c.path === '/v1/checkout/sessions').pop();
{
  let r = await call('POST', '/billing/checkout', { plan: 'solo' }, TNZ);
  let c = lastCheckout();
  check('a New Zealand checkout is as it was: NZ price, no currency, back to roofmap.co.nz', r.status === 200 && c.body.get('line_items[0][price]') === 'price_solo_149' &&
    !c.body.has('currency') && c.body.get('success_url') === 'https://roofmap.co.nz/index.html?billing=success' &&
    c.body.get('cancel_url') === 'https://roofmap.co.nz/index.html?billing=cancelled' && !c.body.has('metadata[country]'), [...c.body.keys()].join(','));
  check('…the same fields it always sent, and the same answer', JSON.stringify([...c.body.keys()].sort()) === JSON.stringify(['allow_promotion_codes', 'automatic_tax[enabled]', 'cancel_url', 'client_reference_id',
    'customer_email', 'line_items[0][price]', 'line_items[0][quantity]', 'metadata[company_id]', 'metadata[plan]', 'metadata[user_id]', 'mode',
    'subscription_data[metadata][company_id]', 'subscription_data[metadata][plan]', 'success_url', 'tax_id_collection[enabled]'].sort()) &&
    JSON.stringify(Object.keys(r.body)) === '["url"]', [...c.body.keys()].sort().join(','));
  r = await call('POST', '/billing/checkout', { plan: 'team' }, TAU);
  c = lastCheckout();
  check('an Australian checkout asks for AUD on the same price, and comes back to roofmap.net', r.status === 200 && c.body.get('currency') === 'aud' &&
    c.body.get('line_items[0][price]') === 'price_team_299' && c.body.get('success_url') === 'https://roofmap.net/index.html?billing=success' &&
    c.body.get('cancel_url') === 'https://roofmap.net/index.html?billing=cancelled' && r.body.currency === 'aud', JSON.stringify(Object.fromEntries(c.body)));
  check('…with Stripe Tax and the tax-id collection still on, and the country in the metadata', c.body.get('automatic_tax[enabled]') === 'true' &&
    c.body.get('tax_id_collection[enabled]') === 'true' && c.body.get('metadata[country]') === 'AU');
  // (Trade is one person, so the one-person Australian business buys it.)
  r = await call('POST', '/billing/checkout', { plan: 'solo', billing: 'annual' }, TAU2);
  c = lastCheckout();
  check('an AUD price named on its own (STRIPE_PRICE_SOLO_ANNUAL_AUD) is used as it is, with no currency asked for', r.status === 200 &&
    c.body.get('line_items[0][price]') === 'price_solo_1490_aud' && !c.body.has('currency'), JSON.stringify(Object.fromEntries(c.body)));
  r = await call('POST', '/billing/checkout', { plan: 'team', billing: 'annual' }, TAU);
  c = lastCheckout();
  check('…and a yearly plan without one is the NZD yearly price in AUD', c.body.get('line_items[0][price]') === 'price_team_2990' && c.body.get('currency') === 'aud');

  // Stripe refuses AUD: sold in NZD, and said so.
  refuseAud = true; errs.length = 0;
  const n0 = stripeCalls.filter(x => x.path === '/v1/checkout/sessions').length;
  r = await call('POST', '/billing/checkout', { plan: 'team' }, TAU);
  const tries = stripeCalls.filter(x => x.path === '/v1/checkout/sessions').slice(n0);
  check('when Stripe refuses the AUD checkout over the currency, it is tried once more in NZD', r.status === 200 && tries.length === 2 &&
    tries[0].body.get('currency') === 'aud' && !tries[1].body.has('currency') && tries[1].body.get('line_items[0][price]') === 'price_team_299' && r.body.currency === 'nzd',
    tries.map(t => t.body.get('currency')).join(','));
  check('…never silently: the fallback is reported', errs.some(e => e.kind === 'aud-checkout' && /sold in NZD/.test(e.message)), JSON.stringify(errs));
  refuseAud = false;

  // A failed read of the country must not quietly bill in NZD.
  const n1 = stripeCalls.filter(x => x.path === '/v1/checkout/sessions').length;
  db.__fail500 = 'companies';
  r = await call('POST', '/billing/checkout', { plan: 'team' }, TAU);
  db.__fail500 = null;
  check('a checkout whose country read fails is a 503, and Stripe is never asked', r.status === 503 && stripeCalls.filter(x => x.path === '/v1/checkout/sessions').length === n1, String(r.status));

  // An old database without the column: everybody is NZ, and nothing breaks.
  db.__missing = ['country'];
  r = await call('POST', '/billing/checkout', { plan: 'team' }, TAU);
  c = lastCheckout();
  check('on a database without companies.country the checkout is NZ', r.status === 200 && !c.body.has('currency') && /roofmap\.co\.nz/.test(c.body.get('success_url')));
  r = await call('GET', '/subscription', undefined, TAU);
  check('…/subscription says NZ', r.status === 200 && r.body.country === 'NZ' && r.body.currency === 'nzd');
  r = await call('GET', '/auth/me', undefined, TAU);
  check('…and the sign-in brief still carries the name and the slug, with NZ', r.status === 200 && r.body.company.name === 'Bondi Roofing' && r.body.company.country === 'NZ', JSON.stringify(r.body.company));
  r = await call('PUT', '/company/country', { country: 'AU' }, TAU);
  check('…and a change of country says the server is still being updated', r.status === 503 && r.body.code === 'NOT_MIGRATED', JSON.stringify(r.body));
  db.__missing = [];

  r = await call('POST', '/billing/portal', {}, TAU);
  check('(the portal needs a billing account first, as before)', r.status === 400);
}

// ── the sign-up ──────────────────────────────────────────────────
let ipN = 0;
const register = (body) => fetch(B + '/auth/register', { method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Forwarded-For': '203.0.113.' + (++ipN) },
  body: JSON.stringify(Object.assign({ interests: ['satellite'], password: 'password123', phone: '0412 555 010' }, body)) });
{
  mails.length = 0;
  let r = await register({ email: 'mick@sydneyroofs.com.au', name: 'Mick Sydney', company: 'Sydney Roofs', country: 'AU' });
  let j = await r.json();
  await settle(400);
  const prof = db.profiles.find(p => p.email === 'mick@sydneyroofs.com.au');
  const co = prof && db.companies.find(c => c.id === prof.company_id);
  check('a sign-up naming AU makes an Australian business', r.status === 200 && co && co.country === 'AU', JSON.stringify({ s: r.status, j, co }));
  const v = mailTo(/mick@sydneyroofs/).find(m => /Confirm your email/.test(m.subject || ''));
  check('…and its confirmation link opens roofmap.net', v && /https:\/\/roofmap\.net\/app\?verify=/.test(all(v)) && !/roofmap\.co\.nz\/app\?verify/.test(all(v)), v ? '' : JSON.stringify(mails.map(m => m.subject)));
  const al = mailTo(/signups@roofmap\.test/).find(m => /Sydney Roofs/.test(m.subject || ''));
  check('…and the owner\'s signup alert names the country', al && /\(Australia\)/.test(al.subject) && /Country: Australia/.test(all(al)), al ? al.subject : 'no alert');

  r = await register({ email: 'tama@nelsonroofs.co.nz', name: 'Tama', company: 'Nelson Roofs' });
  await settle(400);
  const p2 = db.profiles.find(p => p.email === 'tama@nelsonroofs.co.nz');
  const c2 = p2 && db.companies.find(c => c.id === p2.company_id);
  check('a sign-up that names no country is a New Zealand business', r.status === 200 && c2 && c2.country === 'NZ', JSON.stringify(c2));
  const v2 = mailTo(/tama@nelsonroofs/).find(m => /Confirm your email/.test(m.subject || ''));
  check('…its link is roofmap.co.nz, as before', v2 && /https:\/\/roofmap\.co\.nz\/app\?verify=/.test(all(v2)));
  const al2 = mailTo(/signups@roofmap\.test/).find(m => /Nelson Roofs/.test(m.subject || ''));
  check('…and its alert says New Zealand, with no "(Australia)"', al2 && !/Australia/.test(al2.subject) && /Country: New Zealand/.test(all(al2)), al2 ? al2.subject : 'none');

  r = await register({ email: 'odd@oddroofs.com', name: 'Odd', company: 'Odd Roofs', country: 'United States' });
  await settle(200);
  const p3 = db.profiles.find(p => p.email === 'odd@oddroofs.com');
  check('any other country is NZ', r.status === 200 && db.companies.find(c => c.id === p3.company_id).country === 'NZ');

  db.__missing = ['country'];
  r = await register({ email: 'old@olddb.com.au', name: 'Old', company: 'Old DB Roofs', country: 'AU' });
  db.__missing = [];
  const p4 = db.profiles.find(p => p.email === 'old@olddb.com.au');
  check('on a database without the column an Australian sign-up still makes the business (as NZ), and says so', r.status === 200 && p4 && p4.company_id &&
    errs.some(e => e.kind === 'company-country'), String(r.status));

  // The confirmation resent reads the country back off the business.
  const before = mails.length;
  await call('POST', '/auth/verify/resend', { email: 'mick@sydneyroofs.com.au' }, null, { 'X-Forwarded-For': '203.0.113.200' });
  await settle(400);
  const rs = mails.slice(before).find(m => /mick@sydneyroofs/.test(m.to || ''));
  check('a resent confirmation for an Australian business opens roofmap.net', rs && /https:\/\/roofmap\.net\/app\?verify=/.test(all(rs)), rs ? '' : 'not sent');
}

// ── emailed links ────────────────────────────────────────────────
{
  let before = mails.length;
  await call('POST', '/auth/forgot', { email: 'bruce@bondiroofing.com.au' }, null, { 'X-Forwarded-For': '203.0.113.210' });
  await call('POST', '/auth/forgot', { email: 'sam@kauri.co.nz' }, null, { 'X-Forwarded-For': '203.0.113.211' });
  await settle(400);
  const au = mails.slice(before).find(m => /bruce@/.test(m.to || '')), nz = mails.slice(before).find(m => /sam@kauri/.test(m.to || ''));
  check('a password reset for an Australian business links to roofmap.net', au && /https:\/\/roofmap\.net\/app\?reset=/.test(all(au)), au ? '' : 'none');
  check('…a New Zealand one to roofmap.co.nz', nz && /https:\/\/roofmap\.co\.nz\/app\?reset=/.test(all(nz)) && !/roofmap\.net\//.test(all(nz)));

  before = mails.length;
  let r = await call('POST', '/team/invites', { email: 'newbie@bondiroofing.com.au' }, TAU);
  await settle(200);
  const inv = mails.slice(before).find(m => /newbie@/.test(m.to || ''));
  check('a team invite from an Australian business links to roofmap.net', r.status === 200 && inv && /https:\/\/roofmap\.net\/app\?invite=/.test(all(inv)), JSON.stringify(r.body).slice(0, 200));
  before = mails.length;
  r = await call('POST', '/team/invites', { email: 'newbie@kauri.co.nz' }, TNZ);
  await settle(200);
  const inv2 = mails.slice(before).find(m => /newbie@kauri/.test(m.to || ''));
  check('…a New Zealand one to roofmap.co.nz', inv2 && /https:\/\/roofmap\.co\.nz\/app\?invite=/.test(all(inv2)));

  // The trial-ended email.
  before = mails.length;
  r = await call('POST', '/admin/trial-ended/run', {}, null, { 'x-admin-token': ADMIN });
  await settle(200);
  const te = mails.slice(before);
  const teAu = te.find(m => /bruce@/.test(m.to || '')), teNz = te.find(m => /sam@kauri/.test(m.to || ''));
  check('the trial-ended email to an Australian business points at roofmap.net', teAu && /https:\/\/roofmap\.net\/app\?billing=plans/.test(all(teAu)) &&
    /https:\/\/roofmap\.net\/trial-ended\?t=/.test(all(teAu)) && !/roofmap\.co\.nz/.test(body(teAu)), JSON.stringify(r.body));
  check('…and to a New Zealand one at roofmap.co.nz', teNz && /https:\/\/roofmap\.co\.nz\/app\?billing=plans/.test(all(teNz)) && !/roofmap\.net\//.test(body(teNz)));

  // The trial drip's first day.
  db.subscriptions.find(s => s.id === 's3').trial_drip = null;
  before = mails.length;
  r = await call('POST', '/admin/trial-drip/run', {}, null, { 'x-admin-token': ADMIN });
  await settle(200);
  const d1 = mails.slice(before).find(m => /kylie@/.test(m.to || ''));
  check('the trial drip to an Australian business links to roofmap.net/app', d1 && /https:\/\/roofmap\.net\/app/.test(all(d1)) && !/roofmap\.co\.nz/.test(body(d1)), JSON.stringify(r.body));
}

// ── the win-back email ───────────────────────────────────────────
{
  let r = await call('GET', '/admin/winback', undefined, null, { 'x-admin-token': ADMIN });
  const rowAu = (r.body.list || []).find(x => /dazza@/.test(x.email));
  check('the win-back list names each business\'s country', r.status === 200 && rowAu && rowAu.country === 'AU', JSON.stringify((r.body.list || []).map(x => [x.email, x.country])));
  check('…the New Zealand copy is the one it always was (Whangarei, roofmap.co.nz)', /Whangarei, New Zealand/.test(r.body.html) && !/roofmap\.net\//.test(r.body.html));
  check('…and the Australian copy points at roofmap.net and never says New Zealand', /https:\/\/roofmap\.net\/app\?restart=trial/.test(r.body.html_au) && !/New Zealand|roofmap\.co\.nz/.test(r.body.html_au));
  const before = mails.length;
  r = await call('POST', '/admin/winback/test', { to: 'aron@roofmap.test', country: 'AU' }, null, { 'x-admin-token': ADMIN });
  await settle(200);
  const t = mails.slice(before)[0];
  check('a test of the Australian copy can be sent', r.status === 200 && t && /roofmap\.net\/app\?restart=trial/.test(all(t)) && !/New Zealand/.test(body(t)), JSON.stringify(r.body));
  const b2 = mails.length;
  r = await call('POST', '/admin/winback/send', { subs: ['s4'] }, null, { 'x-admin-token': ADMIN });
  await settle(200);
  const w = mails.slice(b2);
  // (The relay stand-in does not carry BCC; the batch record says who it was for.)
  check('the win-back send gives an Australian business its own copy, in a batch of its own', r.status === 200 && r.body.ok && w.length === 1 &&
    /roofmap\.net\/app\?restart=trial/.test(body(w[0])) && !/New Zealand/.test(body(w[0])) &&
    r.body.batches.length === 1 && r.body.batches[0].country === 'AU', JSON.stringify(r.body) + ' ' + JSON.stringify(w.map(m => ({ to: m.to, bcc: m.bcc, k: Object.keys(m) }))));
}

// ── the invoice and the new payer ────────────────────────────────
const sign = p => { const t = Math.floor(Date.now() / 1000); return 't=' + t + ',v1=' + crypto.createHmac('sha256', WH).update(t + '.' + p).digest('hex'); };
const hook = async (obj) => { const p = JSON.stringify(obj); const r = await fetch(B + '/billing/webhook', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'stripe-signature': sign(p) }, body: p }); await settle(300); return r.status; };
{
  const sec = Math.floor(Date.UTC(2026, 10, 4, 0, 0, 0) / 1000);
  let before = mails.length;
  let st = await hook({ type: 'checkout.session.completed', data: { object: {
    id: 'cs_au1', customer: 'cus_bondi', subscription: 'sub_bondi', client_reference_id: AU, payment_status: 'paid',
    amount_total: 14900, currency: 'aud', created: sec, metadata: { company_id: AU, user_id: UAU, plan: 'solo' } } } });
  const alert = mails.slice(before).find(m => /new paying subscriber/i.test(m.subject || ''));
  const at = String((alert && (alert.text || alert.body)) || '');
  check('a new Australian payer: the owner\'s email prices the plan in A$ with no GST', st === 200 && /Plan: Trade \(A\$149 a month\)/.test(at) && /\$149\.00 AUD — no GST charged/.test(at) && /Country: Australia/.test(at) && !/incl\. GST/.test(at), at.slice(0, 500));

  before = mails.length;
  st = await hook({ type: 'invoice.paid', data: { object: { id: 'in_au1', number: 'RM-AU-0001', customer: 'cus_bondi', subscription: 'sub_bondi', customer_email: 'bruce@bondiroofing.com.au',
    amount_paid: 14900, tax: 0, currency: 'aud', created: sec, status_transitions: { paid_at: sec },
    lines: { data: [{ description: '1 × RoofMap Trade (at A$149.00 / month)', period: { start: sec, end: sec + 30 * 86400 } }] } } } });
  const inv = mails.slice(before).find(m => /invoice/i.test(m.subject || '') && /bruce@/.test(m.to || ''));
  const it = String((inv && (inv.text || inv.body)) || '');
  check('an AUD invoice reads AUD, says "No GST charged" and is not called a tax invoice', inv && /^RoofMap invoice RM-AU-0001 — \$149\.00 AUD$/.test(inv.subject) &&
    /Total paid: \$149\.00 AUD/.test(it) && /No GST charged/.test(it) && !/GST \(/.test(it) && !/Subtotal/.test(it) && !/tax invoice/i.test(it), (inv && inv.subject) + ' | ' + it);
  check('…its HTML says so too', inv && /No GST charged/.test(String(inv.html || '')) && !/GST \(15%\)/.test(String(inv.html || '')));

  // A New Zealand invoice, line for line as it always read.
  before = mails.length;
  await hook({ type: 'invoice.paid', data: { object: { id: 'in_nz1', number: 'RM-0042', customer: 'cus_kauri', subscription: 'sub_kauri', customer_email: 'sam@kauri.co.nz',
    amount_paid: 17135, currency: 'nzd', created: sec, status_transitions: { paid_at: sec },
    lines: { data: [{ description: '1 × RoofMap Trade (at $149.00 / month)' }] } } } });
  const nzi = mails.slice(before).find(m => /sam@kauri/.test(m.to || ''));
  const paid = new Date(sec * 1000).toLocaleDateString('en-NZ');
  const want = ['RoofMap — subscription tax invoice', '', '1 × RoofMap Trade (at $149.00 / month)', 'Invoice: RM-0042', 'Paid: ' + paid, '',
    'Subtotal: $149.00 NZD', 'GST (15%): $22.35 NZD', 'Total paid: $171.35 NZD', '', '', 'Questions about this invoice — just reply to this email.']
    .filter(x => x !== '').join('\n');
  check('a New Zealand invoice reads exactly as before', nzi && nzi.subject === 'RoofMap tax invoice RM-0042 — $171.35 NZD' && String(nzi.text || nzi.body) === want,
    nzi ? JSON.stringify(String(nzi.text || nzi.body)) : 'none');
}

await new Promise(r => setTimeout(r, 100));
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
