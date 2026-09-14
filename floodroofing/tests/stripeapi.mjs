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
  // The owner came in through early access; the member did not. That is what
  // decides whether the founding discount is applied at checkout.
  waitlist: [{ id: 1, email: 'aron@floodroofing.co.nz', status: 'invited' },
             { id: 2, email: 'nobody@example.com', status: 'new' }],
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
    if (/^\/v1\/subscriptions\//.test(req.url)) return res.end(JSON.stringify({
      id: req.url.split('/').pop(), status: 'active', cancel_at_period_end: true,
      // Stripe moved the period onto the item; the cancel date rides on the
      // subscription itself once cancel_at_period_end is set.
      cancel_at: 1792108800, items: { data: [{ current_period_end: 1792108800 }] } }));
    res.end('{}');
  });
});
await new Promise(r => stripeSrv.listen(0, '127.0.0.1', r));

// A stand-in for the Apps Script mail relay, so who the tax invoice went to
// is observable rather than inferred.
const mails = [];
const mailSrv = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => { try { mails.push(JSON.parse(body)); } catch(e){ mails.push({ raw: body }); }
    res.writeHead(200, {'Content-Type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(r => mailSrv.listen(0, '127.0.0.1', r));
process.env.GAS_MAIL_URL = 'http://127.0.0.1:' + mailSrv.address().port;
process.env.GAS_MAIL_TOKEN = 'test-mail-token';

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
process.env.STRIPE_PRICE_SOLO_ANNUAL = 'price_solo_1490';
process.env.STRIPE_PRICE_TEAM_ANNUAL = 'price_team_2990';
delete process.env.STRIPE_PRICE_BUSINESS_ANNUAL;
process.env.EARLY_ACCESS_COUPON = 'coupon_founding30';
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

// ── the founding discount ─────────────────────────────────────────
// Stripe refuses a session carrying both allow_promotion_codes and discounts:
// "You may only specify one of these parameters". The stand-in above answers
// any request, so it cannot catch that — which is exactly why this is asserted
// here rather than left to be discovered by a roofer whose checkout 500s.
check('an early-access business gets the founding coupon applied for them',
  cc.body.get('discounts[0][coupon]') === 'coupon_founding30', cc.body.get('discounts[0][coupon]'));
check('…and NOT the promotion-code box, which Stripe refuses alongside it',
  cc.body.get('allow_promotion_codes') === null,
  'allow_promotion_codes=' + cc.body.get('allow_promotion_codes'));
// Founding pricing for everyone who signs up before a date, off the plain
// signup link — no waitlist, no invite, no code. And off again after it.
// The owner here IS on the waitlist, so that route is set aside to prove
// the date rule on its own.
const _wl = db.waitlist[0].status; db.waitlist[0].status = 'declined';
process.env.EARLY_ACCESS_UNTIL = '2099-12-31';
r = await call('POST', '/billing/checkout', { plan: 'business' }, T);
const ccOpen = stripeCalls[stripeCalls.length - 1];
check('with EARLY_ACCESS_UNTIL in the future, a plain signup gets the founding coupon',
  r.status === 200 && ccOpen.body.get('discounts[0][coupon]') === 'coupon_founding30' && ccOpen.body.get('allow_promotion_codes') === null,
  'coupon=' + ccOpen.body.get('discounts[0][coupon]'));
process.env.EARLY_ACCESS_UNTIL = '2000-01-01';
r = await call('POST', '/billing/checkout', { plan: 'business' }, T);
const ccShut = stripeCalls[stripeCalls.length - 1];
check('…and once the date has passed, the promotion-code box comes back instead',
  r.status === 200 && ccShut.body.get('discounts[0][coupon]') === null && ccShut.body.get('allow_promotion_codes') === 'true',
  'coupon=' + ccShut.body.get('discounts[0][coupon]'));
delete process.env.EARLY_ACCESS_UNTIL; db.waitlist[0].status = _wl;
// GST on top, worked out by Stripe Tax — the live checkout page showed $299
// flat and no GST line until the session asked for it.
check('checkout asks Stripe to add GST and to collect the customer\'s GST number',
  cc.body.get('automatic_tax[enabled]') === 'true' && cc.body.get('tax_id_collection[enabled]') === 'true',
  'automatic_tax=' + cc.body.get('automatic_tax[enabled]'));

// Somebody who found the pricing page on their own is the other way round.
// Their own company, not this one — adding a third seat to CO would push it
// past Solo's limit and the request would be refused before it ever reached
// Stripe, leaving the previous call as the one under inspection.
const CO2 = 'cccccccc-2222-2222-2222-222222222222';
const OUTSIDER = 'uuuuuuuu-0000-0000-0000-000000000009';
db.companies.push({ id: CO2, name: 'Found Us Ourselves Ltd', plan: 'trial' });
db.company_users.push({ company_id: CO2, user_id: OUTSIDER, role: 'owner' });
const TO = jwtLib.sign({ id: OUTSIDER, email: 'nobody@example.com', cid: CO2 }, 'test-secret', { expiresIn: '1h' });
const before = stripeCalls.length;
r = await call('POST', '/billing/checkout', { plan: 'solo' }, TO);
check('…and their checkout actually reached Stripe',
  stripeCalls.length === before + 1, r.status + ' ' + JSON.stringify(r.body).slice(0, 80));
const oc = stripeCalls[stripeCalls.length - 1];
check('somebody who was not invited is not discounted',
  r.status === 200 && oc.body.get('discounts[0][coupon]') === null, oc.body.get('discounts[0][coupon]'));
check('…but can still type a promotion code by hand',
  oc.body.get('allow_promotion_codes') === 'true', oc.body.get('allow_promotion_codes'));
check('exactly one of the two is ever sent',
  [cc, oc].every(c => (c.body.get('discounts[0][coupon]') === null) !== (c.body.get('allow_promotion_codes') === null)));

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

// ── paid yearly: two months free ──────────────────────────────────
// Team, not Solo — this business has several members, and the seat guard
// (rightly) refuses to sell it a one-seat plan.
r = await call('POST', '/billing/checkout', { plan: 'team', billing: 'annual' }, T);
let ac = stripeCalls[stripeCalls.length - 1];
check('yearly checkout buys the yearly price, same plan metadata',
  r.status === 200 && ac.body.get('line_items[0][price]') === 'price_team_2990' &&
  ac.body.get('metadata[plan]') === 'team',
  r.status + ' ' + (ac && ac.body.get('line_items[0][price]')));
// Yearly is two months free INSTEAD of the founding 30% — the site says one
// or the other, and stacking both was never the offer.
check('…and yearly never carries the founding coupon on top of its two free months',
  ac.body.get('discounts[0][coupon]') === null && ac.body.get('allow_promotion_codes') === 'true',
  'coupon=' + ac.body.get('discounts[0][coupon]') + ' promo=' + ac.body.get('allow_promotion_codes'));
r = await call('POST', '/billing/checkout', { plan: 'team' }, T);
ac = stripeCalls[stripeCalls.length - 1];
check('no billing field still means monthly — old clients change nothing',
  ac.body.get('line_items[0][price]') === 'price_team_299', ac.body.get('line_items[0][price]'));
r = await call('POST', '/billing/checkout', { plan: 'team', billing: 'fortnightly' }, T);
ac = stripeCalls[stripeCalls.length - 1];
check('a junk billing value falls back to monthly',
  ac.body.get('line_items[0][price]') === 'price_team_299', ac.body.get('line_items[0][price]'));
r = await call('POST', '/billing/checkout', { plan: 'business', billing: 'annual' }, T);
check('yearly on a plan with no yearly price is refused, naming the missing variable',
  r.status === 400 && /STRIPE_PRICE_BUSINESS_ANNUAL/.test(r.body.error || ''), JSON.stringify(r.body));
r = await call('GET', '/subscription', undefined, T);
check('the billing screen is told which plans can be bought yearly',
  r.body.annual && r.body.annual.solo === true && r.body.annual.team === true && r.body.annual.business === false,
  JSON.stringify(r.body.annual));
// A portal switch to the YEARLY price must land on the same plan.
const swapped = JSON.stringify({ type: 'customer.subscription.updated', data: { object: {
  id: 'sub_9', status: 'active', items: { data: [{ price: { id: 'price_team_2990' } }] } } } });
r = await call('POST', '/billing/webhook', swapped, null, { 'stripe-signature': sign(swapped) });
check('a portal change onto the yearly price still resolves the plan',
  r.status === 200 && db.companies[0].plan === 'team', db.companies[0].plan);
// Stripe's 2025+ API versions carry the period on the subscription ITEM, not
// the subscription; the live webhook is on 2026-08-26. The renewal date must
// still be recorded from there.
const onItem = JSON.stringify({ type: 'customer.subscription.updated', data: { object: {
  id: 'sub_9', status: 'active', items: { data: [{ price: { id: 'price_team_2990' }, current_period_end: 1790000000 }] } } } });
r = await call('POST', '/billing/webhook', onItem, null, { 'stripe-signature': sign(onItem) });
check('the renewal date is read from the subscription item on the new API versions',
  r.status === 200 && String(((db.subscriptions || []).find(x => x.stripe_subscription_id === 'sub_9') || {}).current_period_end || '').startsWith('2026-09-21'),
  String(((db.subscriptions || []).find(x => x.stripe_subscription_id === 'sub_9') || {}).current_period_end));

const deleted = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_9', status: 'canceled' } } });
r = await call('POST', '/billing/webhook', deleted, null, { 'stripe-signature': sign(deleted) });
check('a cancellation webhook lands', r.status === 200, r.status + '');
r = await call('GET', '/subscription', undefined, T);
check('…and the gate closes again', r.body.live === false && r.body.status === 'canceled', JSON.stringify(r.body).slice(0,90));

// ── where the receipts go ─────────────────────────────────────────
// The person paying is often not the person who signed up. A business that
// nominates a billing address in Settings gets Stripe's checkout prefilled
// with it, and RoofMap's own tax invoice addressed to it.
db.user_settings.push({ user_id: U, company_id: CO, branding: {}, quote_defaults: {}, jms_keys: {},
  price_book: {}, labour_pricing: {}, ui_flags: {}, selectables: {}, schedule_cfg: {},
  billing_email: 'accounts@floodroofing.co.nz', updated_at: new Date().toISOString() });

// A business subscribing for the FIRST time — no Stripe customer yet, which
// is the only moment customer_email applies (an existing customer takes the
// `customer` branch instead, and Stripe would refuse both).
const CO3 = 'cccccccc-0000-0000-0000-000000000003';
const U3 = 'uuuuuuuu-0000-0000-0000-000000000003';
db.companies.push({ id: CO3, name: 'Kauri Roofing', plan: 'trial' });
db.company_users.push({ company_id: CO3, user_id: U3, role: 'owner' });
db.user_settings.push({ user_id: U3, company_id: CO3, branding: {}, quote_defaults: {}, jms_keys: {},
  price_book: {}, labour_pricing: {}, ui_flags: {}, selectables: {}, schedule_cfg: {},
  billing_email: 'bills@kauri.co.nz', updated_at: new Date().toISOString() });
const T3 = jwtLib.sign({ id: U3, email: 'sam@kauri.co.nz', cid: CO3 }, 'test-secret', { expiresIn: '1h' });
const _before = stripeCalls.length;
r = await call('POST', '/billing/checkout', { plan: 'team' }, T3);
const cc2 = stripeCalls[stripeCalls.length - 1];
check('checkout prefills the nominated billing address, not the login',
  r.status === 200 && stripeCalls.length > _before &&
  cc2.body.get('customer_email') === 'bills@kauri.co.nz',
  'customer_email=' + (cc2 && cc2.body.get('customer_email')));

// The tax invoice RoofMap sends itself. Stripe's own customer_email on the
// invoice is the fallback, NOT the winner: an office that put bills@ in
// Settings expects it there, whoever happened to click Subscribe.
db.subscriptions.push({ user_id: U, company_id: CO, status: 'active',
  stripe_customer_id: 'cus_bill1', stripe_subscription_id: 'sub_bill1' });
const paid = JSON.stringify({ type: 'invoice.payment_succeeded', data: { object: {
  id: 'in_bill1', customer: 'cus_bill1', customer_email: 'whoever@clicked.co.nz',
  amount_paid: 44195, currency: 'nzd', number: 'RM-001',
} } });
r = await call('POST', '/billing/webhook', paid, null, { 'stripe-signature': sign(paid) });
check('a paid invoice webhook is accepted', r.status === 200, String(r.status));
await new Promise(r => setTimeout(r, 400));
const _inv = mails.find(m => /tax invoice/i.test(String(m.subject || '')));
check('…and the settings row decides who the tax invoice is addressed to',
  !!_inv && _inv.to === 'accounts@floodroofing.co.nz',
  JSON.stringify(mails.map(m => ({ to: m.to, subject: m.subject }))));

// ── cancelling ────────────────────────────────────────────────────
// The question is asked in the browser, and asked AGAIN here: a client that
// skips the box must not be able to skip the question.
db.subscriptions.push({ user_id: U3, company_id: CO3, status: 'active', plan: 'team',
  stripe_customer_id: 'cus_k1', stripe_subscription_id: 'sub_k1' });
const _mailsBefore = mails.length;
r = await call('POST', '/billing/cancel', { reason: '' }, T3);
check('cancelling with no reason is refused, in the words the screen uses',
  r.status === 400 && r.body.error === 'Please leave an explanation to help us improve', JSON.stringify(r.body));
r = await call('POST', '/billing/cancel', { reason: 'too expensive' }, T3);
check('…and under four words gets the longer-answer wording',
  r.status === 400 && r.body.error === 'Please leave a slightly longer explanation to help us improve', JSON.stringify(r.body));
check('…and neither reached Stripe',
  !stripeCalls.some(c => /^\/v1\/subscriptions\//.test(c.path)), 'stripe calls: ' +
  JSON.stringify(stripeCalls.filter(c => /subscriptions/.test(c.path)).map(c => c.path)));

r = await call('POST', '/billing/cancel', { reason: 'we went back to spreadsheets' }, T3);
const _cancelCall = stripeCalls.filter(c => /^\/v1\/subscriptions\//.test(c.path)).pop();
check('a real answer cancels', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
check('…at the END of the paid month, never on the spot',
  _cancelCall && _cancelCall.path === '/v1/subscriptions/sub_k1' &&
  _cancelCall.body.get('cancel_at_period_end') === 'true', _cancelCall && _cancelCall.path);
check('…and hands back the date they keep working until, and how long the work is kept',
  /^2026-\d\d-\d\dT/.test(String(r.body.ends_at)) && r.body.data_kept_days === 90, JSON.stringify(r.body));
check('…the row carries the date, so the app can show it',
  !!(db.subscriptions.find(x => x.stripe_subscription_id === 'sub_k1') || {}).cancel_at,
  String((db.subscriptions.find(x => x.stripe_subscription_id === 'sub_k1') || {}).cancel_at));
check('…the reason is kept — it is the only honest feedback there is',
  (db.cancellations || []).some(c => c.reason === 'we went back to spreadsheets'),
  JSON.stringify((db.cancellations || []).map(c => c.reason)));
await new Promise(r2 => setTimeout(r2, 500));
const _conf = mails.slice(_mailsBefore).find(m => /cancelled/i.test(String(m.subject || '')));
check('…and a confirmation goes out saying when access ends',
  !!_conf && /already paid for/i.test(String(_conf.text || '')) && /90 days/.test(String(_conf.text || '')),
  _conf ? String(_conf.subject) : JSON.stringify(mails.slice(_mailsBefore).map(m => m.subject)));

// A member cannot cancel the business's subscription.
const T3M = jwtLib.sign({ id: 'uuuuuuuu-0000-0000-0000-000000000009', email: 'hand@kauri.co.nz', cid: CO3 },
  'test-secret', { expiresIn: '1h' });
db.company_users.push({ company_id: CO3, user_id: 'uuuuuuuu-0000-0000-0000-000000000009', role: 'member' });
r = await call('POST', '/billing/cancel', { reason: 'I am not the boss here' }, T3M);
check('only the owner can cancel', r.status === 403 && r.body.code === 'OWNER_ONLY', JSON.stringify(r.body));

stripeSrv.close();
mailSrv.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
