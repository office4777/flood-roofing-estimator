// Taking money: Checkout starts on our side, Stripe hosts the card page, and
// the signed webhook writes the outcome into the subscriptions row that the
// gate, the plans and the seat limits already key off. Stripe itself is a
// local stand-in (STRIPE_API_BASE), signatures are real HMACs.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import crypto from 'node:crypto';

import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const CO = 'cccccccc-1111-1111-1111-111111111111';
const U  = 'uuuuuuuu-0000-0000-0000-000000000001';   // owner
const U2 = 'uuuuuuuu-0000-0000-0000-000000000002';   // member
const db = {
  __missing: [],
  companies: [{ id: CO, name: 'Flood Roofing', plan: 'trial' }],
  company_users: [{ company_id: CO, user_id: U, role: 'owner' }, { company_id: CO, user_id: U2, role: 'member' }],
  profiles: [], invoices: [], usage_events: [], company_invites: [],
  subscriptions: [{ user_id: U, company_id: CO, status: 'trialing', trial_ends_at: '2020-01-01T00:00:00Z' }],
  user_settings: [], jobs: [],
};

// The Stripe stand-in: records what we send, answers like the real thing.
const stripeCalls = [];
const stripeSrv = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    stripeCalls.push({ path: req.url, body: new URLSearchParams(body), auth: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }));
    if (req.url === '/v1/billing_portal/sessions') return res.end(JSON.stringify({ id: 'bps_1', url: 'https://billing.stripe.com/p/session/bps_1' }));
    res.end('{}');
  });
});
await new Promise(r => stripeSrv.listen(0, '127.0.0.1', r));

const WH_SECRET = 'whsec_testsecret';
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34592';
process.env.PORT = PORT;
process.env.STRIPE_SECRET_KEY = 'sk_test_123';        // flips BILLING_ENABLED on — the real deployment shape
process.env.STRIPE_API_BASE = 'http://127.0.0.1:' + stripeSrv.address().port;
process.env.STRIPE_WEBHOOK_SECRET = WH_SECRET;
process.env.STRIPE_PRICE_SOLO = 'price_solo_149';
process.env.STRIPE_PRICE_TEAM = 'price_team_299';
process.env.STRIPE_PRICE_BUSINESS = 'price_biz_549';
process.env.PLAN_CACHE_MS = '0';
delete process.env.DATABASE_URL;
const jwtLib = require('jsonwebtoken');
const tok = (id, cid) => jwtLib.sign({ id, email: 'aron@floodroofing.co.nz', cid }, 'test-secret', { expiresIn: '1h' });
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const B = 'http://127.0.0.1:' + PORT;
const call = async (method, path, body, token, rawHeaders) => {
  const r = await fetch(B + path, { method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, rawHeaders || {}),
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  let j = null; try { j = await r.json(); } catch(e){}
  return { status: r.status, body: j };
};
const T = tok(U, CO), T2 = tok(U2, CO);
const sign = (payload, t) => {
  t = t || Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', WH_SECRET).update(t + '.' + payload).digest('hex');
  return 't=' + t + ',v1=' + v1;
};

// ── the gate is real in this configuration ────────────────────────
let r = await call('GET', '/subscription', undefined, T);
check('with a Stripe key present the expired trial is really expired',
  r.status === 200 && r.body.billing === true && r.body.live === false, JSON.stringify(r.body).slice(0,100));

// ── checkout ──────────────────────────────────────────────────────
r = await call('POST', '/billing/checkout', { plan: 'business' }, T);
check('the owner gets a Stripe Checkout URL', r.status === 200 && /checkout\.stripe\.com/.test(r.body.url), JSON.stringify(r.body));
const cc = stripeCalls[stripeCalls.length - 1];
check('…for the right price, stamped with the company',
  cc && cc.path === '/v1/checkout/sessions' && cc.body.get('line_items[0][price]') === 'price_biz_549' &&
  cc.body.get('metadata[company_id]') === CO && cc.body.get('metadata[plan]') === 'business' &&
  cc.body.get('mode') === 'subscription' && cc.auth === 'Bearer sk_test_123',
  cc && cc.body.toString().slice(0, 140));
check('…landing back on roofmap.co.nz either way',
  /roofmap\.co\.nz.*billing=success/.test(cc.body.get('success_url')) && /billing=cancelled/.test(cc.body.get('cancel_url')),
  cc.body.get('success_url'));

r = await call('POST', '/billing/checkout', { plan: 'business' }, T2);
check('a member cannot touch billing', r.status === 403 && r.body.code === 'OWNER_ONLY', r.status + '');
r = await call('POST', '/billing/checkout', { plan: 'gold' }, T);
check('an unknown plan is refused', r.status === 400, r.status + '');
r = await call('POST', '/billing/checkout', { plan: 'trial' }, T);
check('…and you cannot buy the trial', r.status === 400, r.status + '');
r = await call('POST', '/billing/checkout', { plan: 'solo' }, T);
check('a plan the team does not fit in is refused with the reason',
  r.status === 400 && /2 people/.test(r.body.error), (r.body||{}).error);

// ── the webhook writes the result ─────────────────────────────────
const completed = JSON.stringify({ type: 'checkout.session.completed', data: { object: {
  id: 'cs_test_1', customer: 'cus_9', subscription: 'sub_9',
  client_reference_id: CO, metadata: { company_id: CO, user_id: U, plan: 'business' } } } });
r = await call('POST', '/billing/webhook', completed, null, { 'stripe-signature': sign(completed) });
check('a signed checkout.session.completed is accepted', r.status === 200 && r.body.received === true, JSON.stringify(r.body));
const sub = db.subscriptions.find(x => x.user_id === U);
check('…the subscription row becomes active on the plan',
  sub.status === 'active' && sub.plan === 'business' && sub.stripe_customer_id === 'cus_9' && sub.stripe_subscription_id === 'sub_9' && sub.trial_ends_at === null,
  JSON.stringify(sub).slice(0, 140));
check('…and the company itself moves onto the plan', db.companies[0].plan === 'business', db.companies[0].plan);
r = await call('GET', '/subscription', undefined, T);
check('…so the app is live again the moment Stripe says paid',
  r.body.live === true && r.body.status === 'active' && r.body.plan === 'business', JSON.stringify(r.body).slice(0,110));

r = await call('POST', '/billing/webhook', completed, null, { 'stripe-signature': 't=1,v1=deadbeef' });
check('a bad signature is refused', r.status === 400, r.status + '');
r = await call('POST', '/billing/webhook', completed, null, { 'stripe-signature': sign(completed, Math.floor(Date.now()/1000) - 3600) });
check('…and so is an hour-old replay', r.status === 400, r.status + '');

// ── portal + cancellation ─────────────────────────────────────────
r = await call('POST', '/billing/portal', {}, T);
check('the owner can open the Stripe portal for card/cancel',
  r.status === 200 && /billing\.stripe\.com/.test(r.body.url), JSON.stringify(r.body));

const deleted = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_9', status: 'canceled' } } });
r = await call('POST', '/billing/webhook', deleted, null, { 'stripe-signature': sign(deleted) });
check('a cancellation webhook lands', r.status === 200, r.status + '');
r = await call('GET', '/subscription', undefined, T);
check('…and the gate closes again', r.body.live === false && r.body.status === 'canceled', JSON.stringify(r.body).slice(0,90));

stripeSrv.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
