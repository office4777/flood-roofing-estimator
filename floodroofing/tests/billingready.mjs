// Is billing actually wired up, or does it only look like it?
//
// Eight environment variables, six of them opaque ids, and a webhook whose
// failure mode is silence. The Stripe dashboard cannot tell you what was
// pasted into Railway; Railway cannot tell you whether Stripe recognises it.
// Every one of these mistakes passes an "is the variable set" check and then
// fails on the first real customer:
//
//   - a product id (prod_…) pasted where the price id belongs
//   - the monthly and yearly ids swapped
//   - a test price under a live key, or the other way round
//   - a price in USD
//   - a signing secret from a different endpoint, so every delivery is
//     rejected and nothing is ever heard about a cancellation
//
// So the check asks Stripe, not the environment. STRIPE_API_BASE already
// points at a stand-in for exactly this reason.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// A stand-in Stripe that knows about four prices and nothing else.
const PRICES = {
  price_solo_m: { id:'price_solo_m', unit_amount:14900, currency:'nzd', active:true, livemode:false, recurring:{ interval:'month' } },
  price_team_m: { id:'price_team_m', unit_amount:29900, currency:'nzd', active:true, livemode:false, recurring:{ interval:'month' } },
  price_biz_m:  { id:'price_biz_m',  unit_amount:54900, currency:'nzd', active:true, livemode:false, recurring:{ interval:'month' } },
  // Deliberately wrong in three different ways, to prove each is caught.
  price_solo_y: { id:'price_solo_y', unit_amount:149000, currency:'usd', active:true, livemode:false, recurring:{ interval:'year' } },
  price_team_y: { id:'price_team_y', unit_amount:299000, currency:'nzd', active:true, livemode:false, recurring:{ interval:'month' } },
  price_biz_y:  { id:'price_biz_y',  unit_amount:549000, currency:'nzd', active:true, livemode:true,  recurring:{ interval:'year' } },
};
const stripe = http.createServer((req, res) => {
  const m = (req.url || '').match(/^\/prices\/([^/?]+)/);
  const p = m && PRICES[decodeURIComponent(m[1])];
  res.setHeader('content-type', 'application/json');
  if (!p){ res.writeHead(404); return res.end(JSON.stringify({ error:{ message:'No such price' } })); }
  res.writeHead(200); res.end(JSON.stringify(p));
});
await new Promise(r => stripe.listen(0, '127.0.0.1', r));
const SPORT = stripe.address().port;

const CO = 'co-1', ME = 'user-1';
const db = {
  profiles: [{ id: ME, company_id: CO, name:'Aron' }],
  company_users: [{ company_id: CO, user_id: ME, role:'owner' }],
  companies: [{ id: CO, name:'Kauri Roofing', plan:'business', created_at:'2026-08-01' }],
  subscriptions: [], jobs: [], user_settings: [], platform_state: [],
};
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_TOKEN = 'let-me-in-please-0000';
process.env.STRIPE_API_BASE = 'http://127.0.0.1:' + SPORT;
process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_abc';
process.env.STRIPE_PRICE_SOLO = 'price_solo_m';
process.env.STRIPE_PRICE_TEAM = 'price_team_m';
process.env.STRIPE_PRICE_BUSINESS = 'prod_biz_oops';      // a product id, the usual mix-up
process.env.STRIPE_PRICE_SOLO_ANNUAL = 'price_solo_y';    // USD
process.env.STRIPE_PRICE_TEAM_ANNUAL = 'price_team_y';    // bills monthly
process.env.STRIPE_PRICE_BUSINESS_ANNUAL = 'price_biz_y'; // a live price under a test key
const PORT = process.env.TEST_PORT || '34877';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;
const TOK = 'let-me-in-please-0000';

// ── it is not for anyone who happens to find the URL ──────────────
let r = await fetch(BASE + '/admin/billing-readiness');
check('without the admin password it does not exist', r.status === 404, 'status ' + r.status);
r = await fetch(BASE + '/admin/billing-readiness?token=nope');
check('…and a wrong one is no better', r.status === 404, 'status ' + r.status);

r = await fetch(BASE + '/admin/billing-readiness?token=' + TOK);
const d = await r.json();
check('with it, the check runs', r.status === 200, 'status ' + r.status);

// ── it never hands back a secret ──────────────────────────────────
const raw = JSON.stringify(d);
check('THE RULE: the secret key is never in the answer, only which mode it is',
  raw.indexOf('sk_test_abc123') < 0 && d.secret_key.mode === 'test' && d.secret_key.set === true,
  JSON.stringify(d.secret_key));
check('…and neither is the webhook secret',
  raw.indexOf('whsec_abc') < 0 && d.webhook_secret.set === true, JSON.stringify(d.webhook_secret));

// ── the four mistakes that pass an "is it set" check ──────────────
const by = {}; d.prices.forEach(p => { by[p.env] = p; });
check('a price that is really a product id is caught',
  by.STRIPE_PRICE_BUSINESS.ok === false &&
  d.blockers.some(b => /STRIPE_PRICE_BUSINESS\b/.test(b) && /product id/i.test(b)),
  JSON.stringify(by.STRIPE_PRICE_BUSINESS));
check('a yearly slot billing monthly is caught',
  d.blockers.some(b => /STRIPE_PRICE_TEAM_ANNUAL/.test(b) && /bills month/i.test(b)),
  d.blockers.filter(b => /TEAM_ANNUAL/.test(b)).join(' | '));
check('a live price under a test key is caught',
  d.blockers.some(b => /STRIPE_PRICE_BUSINESS_ANNUAL/.test(b) && /live price/i.test(b) && /test/.test(b)),
  d.blockers.filter(b => /BUSINESS_ANNUAL/.test(b)).join(' | '));
check('a price in the wrong currency is worth knowing, not a blocker',
  d.warnings.some(w => /STRIPE_PRICE_SOLO_ANNUAL/.test(w) && /USD/.test(w)),
  d.warnings.join(' | '));
check('…and a price that is right is reported with its real amount',
  by.STRIPE_PRICE_SOLO.ok === true && by.STRIPE_PRICE_SOLO.amount === 149 &&
  by.STRIPE_PRICE_SOLO.currency === 'NZD' && by.STRIPE_PRICE_SOLO.interval === 'month',
  JSON.stringify(by.STRIPE_PRICE_SOLO));
check('so it does not claim to be ready', d.ready === false, String(d.ready));
// A checklist that ticks a price it has just listed as a blocker is worse
// than no checklist: "found" and "correct" are not the same thing.
check('a price Stripe recognises but which is WRONG is not ticked as fine',
  by.STRIPE_PRICE_TEAM_ANNUAL.found === true && by.STRIPE_PRICE_TEAM_ANNUAL.ok === false,
  JSON.stringify(by.STRIPE_PRICE_TEAM_ANNUAL));
check('…and the ones that are right are ticked',
  by.STRIPE_PRICE_SOLO.ok === true && by.STRIPE_PRICE_TEAM.ok === true,
  JSON.stringify([by.STRIPE_PRICE_SOLO.ok, by.STRIPE_PRICE_TEAM.ok]));

// ── the webhook ───────────────────────────────────────────────────
check('a webhook that has never arrived is said to have never arrived',
  !d.webhook.last_ok && d.warnings.some(w => /no webhook has ever arrived/i.test(w)),
  JSON.stringify(d.webhook.last_ok));
check('…and the events it needs are named, so they can be ticked in Stripe',
  (d.webhook.events_handled || []).length === 5 &&
  d.webhook.events_handled.indexOf('customer.subscription.deleted') >= 0,
  JSON.stringify(d.webhook.events_handled));

// A delivery that fails its signature is the diagnosis, not just a 400.
r = await fetch(BASE + '/billing/webhook', { method:'POST',
  headers: { 'Content-Type':'application/json', 'stripe-signature':'t=1,v1=deadbeef' },
  body: JSON.stringify({ type:'invoice.paid' }) });
check('a delivery with a bad signature is still refused', r.status === 400, 'status ' + r.status);
const d2 = await (await fetch(BASE + '/admin/billing-readiness?token=' + TOK)).json();
check('THE POINT: and it is remembered, because a run of them IS the diagnosis',
  !!d2.webhook.last_bad && d2.webhook.bad_since_boot >= 1, JSON.stringify(d2.webhook.last_bad));
check('…and it says the signing secret is the thing that is wrong',
  d2.blockers.some(b => /signature/i.test(b) && /different endpoint/i.test(b)),
  d2.blockers.join(' | ').slice(0, 120));

// ── who it would lock out ─────────────────────────────────────────
check('it counts the businesses that would stop working the day it goes on',
  d2.grandfather.would_be_locked_out === 1 && d2.grandfather.companies === 1,
  JSON.stringify(d2.grandfather));
check('…and points at the screen that fixes it before the key goes in',
  d2.blockers.concat(d2.warnings).some(x => /grandfather/i.test(x)),
  d2.warnings.join(' | ').slice(0, 120));

// ── readable without a JSON viewer ────────────────────────────────
const txt = await (await fetch(BASE + '/admin/billing-readiness?token=' + TOK + '&format=text')).text();
check('it reads as plain text for somebody who just wants to look',
  /BILLING READINESS/.test(txt) && /STILL TO FIX/.test(txt) && /NOT ready/.test(txt),
  txt.split('\n').slice(0, 3).join(' / '));
check('…and the plain text does not leak the secret either',
  txt.indexOf('sk_test_abc123') < 0 && txt.indexOf('whsec_abc') < 0 && /test mode/.test(txt),
  txt.slice(0, 80));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
