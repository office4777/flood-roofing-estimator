// AI TENDERING'S MONTHLY ALLOWANCE AND ITS ADD-ON (2026-11-12, the owner: "I
// don't want to lose money on my team plan ... I want them to pay for it. But
// I do want to offer just some AI data").
//
// Against the real server on the fake PostgREST and a stand-in for Stripe:
//   - /tender/usage sums THIS NZ month's A.I. cost for the business (never
//     last month's, never another business's) against the plan's allowance:
//     Team US$15 (about ten plan sets), the trial US$5;
//   - once it is used, everything that spends A.I. answers 402 AI_USAGE_USED
//     with the figures — and a named RoofMap login is never stopped;
//   - deleting a tender does not hand the month's usage back;
//   - the add-on: the owner sets 0..5 packs, the server finds or makes the
//     Stripe price (NZ$49 a month, A$49 option; yearly 10 months' worth),
//     adds the item, changes its quantity, removes it, and the allowance
//     moves with it; a trial, a Trade plan, a member and a 9th pack are refused.
import { fileURLToPath as _f, pathToFileURL } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { startFakePostgrest } from './fakepgrst.mjs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const require = createRequire(_j(_ROOT, 'backend') + '/');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? ('  — ' + d) : '')); }

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
// 40 days back is always last NZ month or earlier.
const LONG_AGO = iso(now - 40 * 864e5);
const CT = 'cccccccc-0000-0000-0000-00000000000a', CY = 'cccccccc-0000-0000-0000-00000000000b',
  CTR = 'cccccccc-0000-0000-0000-00000000000c', CS = 'cccccccc-0000-0000-0000-00000000000d';
const UT = 'uuuuuuuu-0000-0000-0000-00000000000a', UM = 'uuuuuuuu-0000-0000-0000-0000000000a2', UB = 'uuuuuuuu-0000-0000-0000-0000000000a3',
  UY = 'uuuuuuuu-0000-0000-0000-00000000000b', UTR = 'uuuuuuuu-0000-0000-0000-00000000000c', US = 'uuuuuuuu-0000-0000-0000-00000000000d';
const run = (cid, usd, at, tid) => ({ id: 'r' + Math.random().toString(36).slice(2), tender_id: tid || 't-' + cid, company_id: cid, user_id: null, page_id: null,
  pass: 'draft', model: 'claude-opus-5-5', prompt_version: 'v', in_tokens: 1, out_tokens: 1, cache_read: 0, cache_write: 0, cost_usd: usd, ms: 1, ok: true, error: '', created_at: at });

const db = {
  __missing: [], __fail500: '',
  companies: [{ id: CT, name: 'Team Roofing', plan: 'team' }, { id: CY, name: 'Yearly Roofing', plan: 'team' },
              { id: CTR, name: 'Trial Roofing', plan: 'trial' }, { id: CS, name: 'Trade Roofing', plan: 'solo' }],
  company_users: [{ company_id: CT, user_id: UT, role: 'owner' }, { company_id: CT, user_id: UM, role: 'member' }, { company_id: CT, user_id: UB, role: 'member' },
                  { company_id: CY, user_id: UY, role: 'owner' }, { company_id: CTR, user_id: UTR, role: 'owner' }, { company_id: CS, user_id: US, role: 'owner' }],
  profiles: [{ id: UT, company_id: CT, email: 'owner@team.nz' }, { id: UM, company_id: CT, email: 'member@team.nz' }, { id: UB, company_id: CT, email: 'boss@roofmap.test' },
             { id: UY, company_id: CY, email: 'owner@yearly.nz' }, { id: UTR, company_id: CTR, email: 'owner@trial.nz' }, { id: US, company_id: CS, email: 'owner@trade.nz' }],
  subscriptions: [
    { id: 's1', company_id: CT, user_id: UT, status: 'active', plan: 'team', stripe_subscription_id: 'sub_T', stripe_customer_id: 'cus_T', ai_packs: 0, paid_since: iso(now - 3 * 864e5), created_at: iso(now - 3 * 864e5) },
    { id: 's2', company_id: CY, user_id: UY, status: 'active', plan: 'team', stripe_subscription_id: 'sub_Y', stripe_customer_id: 'cus_Y', ai_packs: 0, paid_since: iso(now - 3 * 864e5), created_at: iso(now - 3 * 864e5) },
    { id: 's3', company_id: CTR, user_id: UTR, status: 'trialing', trial_ends_at: iso(now + 20 * 864e5), trial_roof_limit: 3, created_at: iso(now - 864e5) },
    { id: 's4', company_id: CS, user_id: US, status: 'active', plan: 'solo', stripe_subscription_id: 'sub_S', paid_since: iso(now - 3 * 864e5), created_at: iso(now - 3 * 864e5) },
  ],
  user_settings: [], jobs: [], usage_events: [], company_invites: [],
  tender_jobs: [{ id: 'tdel', company_id: CT, user_id: UT, name: 'To delete', status: 'drafted', created_at: iso(now), updated_at: iso(now) }],
  tender_files: [], tender_pages: [], tender_tasks: [],
  tender_ai_runs: [
    run(CT, 9, iso(now - 60000)), run(CT, 4, iso(now - 120000), 'tdel'), // this month: 13
    run(CT, 50, LONG_AGO),                                              // last month: not counted
    run(CTR, 1.2, iso(now - 60000)),
  ],
};

// The Stripe stand-in: keeps each subscription's items, answers like Stripe.
const stripeCalls = [];
const SUBS = {
  sub_T: { id: 'sub_T', items: [{ id: 'si_main_T', quantity: 1, price: { id: 'price_team_299', recurring: { interval: 'month' } } }] },
  sub_Y: { id: 'sub_Y', items: [{ id: 'si_main_Y', quantity: 1, price: { id: 'price_team_2990', recurring: { interval: 'year' } } }] },
};
const PRICES = [];
const stripeSrv = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    const p = new URLSearchParams(body);
    stripeCalls.push({ method: req.method, path: req.url, body: p });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const u = req.url;
    if (req.method === 'GET' && /^\/v1\/subscriptions\//.test(u)) {
      const s = SUBS[u.split('/').pop()];
      return res.end(JSON.stringify(Object.assign({}, s, { items: { data: s.items } })));
    }
    if (req.method === 'GET' && /^\/v1\/prices/.test(u)) {
      const lk = decodeURIComponent((u.split('lookup_keys[]=')[1] || '').split('&')[0]);
      return res.end(JSON.stringify({ data: PRICES.filter(x => x.lookup_key === lk) }));
    }
    if (req.method === 'POST' && u === '/v1/prices') {
      const pr = { id: 'price_ai_' + p.get('recurring[interval]'), lookup_key: p.get('lookup_key'), unit_amount: +p.get('unit_amount'), recurring: { interval: p.get('recurring[interval]') } };
      PRICES.push(pr); return res.end(JSON.stringify(pr));
    }
    if (req.method === 'POST' && u === '/v1/subscription_items') {
      const s = SUBS[p.get('subscription')]; const pr = PRICES.find(x => x.id === p.get('price'));
      const it = { id: 'si_ai_' + s.id, quantity: +p.get('quantity'), price: pr };
      s.items.push(it); return res.end(JSON.stringify(it));
    }
    if (req.method === 'POST' && /^\/v1\/subscription_items\//.test(u)) {
      const id = u.split('/').pop(); let it = null;
      Object.values(SUBS).forEach(s => s.items.forEach(x => { if (x.id === id) it = x; }));
      it.quantity = +p.get('quantity'); return res.end(JSON.stringify(it));
    }
    if (req.method === 'DELETE' && /^\/v1\/subscription_items\//.test(u)) {
      const id = u.split('/').pop().split('?')[0];
      Object.values(SUBS).forEach(s => { s.items = s.items.filter(x => x.id !== id); });
      return res.end(JSON.stringify({ id, deleted: true }));
    }
    res.end('{}');
  });
});
await new Promise(r => stripeSrv.listen(0, '127.0.0.1', r));

const { port } = await startFakePostgrest(db);
const PORT = process.env.TEST_PORT || '34713';
process.env.PORT = PORT;
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_123';
process.env.STRIPE_API_BASE = 'http://127.0.0.1:' + stripeSrv.address().port;
process.env.STRIPE_PRICE_TEAM = 'price_team_299';
process.env.STRIPE_PRICE_TEAM_ANNUAL = 'price_team_2990';
process.env.PLAN_CACHE_MS = '0';
process.env.TENDERING_USERS = 'boss@roofmap.test';
process.env.TENDER_WORKER = 'off';
delete process.env.STRIPE_PRICE_AI_PACK; delete process.env.STRIPE_PRICE_AI_PACK_ANNUAL;
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;
const jwtLib = require('jsonwebtoken');
const tok = (id, email, cid) => jwtLib.sign({ id, email, cid }, 'test-secret', { expiresIn: '1h' });
const log = console.log, cerr = console.error, cwarn = console.warn;
console.log = () => {}; console.error = () => {}; console.warn = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.error = cerr; console.warn = cwarn;
await new Promise(r => setTimeout(r, 700));
const B = 'http://127.0.0.1:' + PORT;
const call = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
};
const T_OWNER = tok(UT, 'owner@team.nz', CT), T_MEMBER = tok(UM, 'member@team.nz', CT), T_BOSS = tok(UB, 'boss@roofmap.test', CT);
const T_YEAR = tok(UY, 'owner@yearly.nz', CY), T_TRIAL = tok(UTR, 'owner@trial.nz', CTR), T_TRADE = tok(US, 'owner@trade.nz', CS);

// ── the month's figures ───────────────────────────────────────────
let r = await call('GET', '/tender/usage', undefined, T_OWNER);
check('Team: US$15 a month, this month only (13 used, last month\'s 50 left out)',
  r.status === 200 && r.body.allowanceUsd === 15 && Math.abs(r.body.usedUsd - 13) < 0.001 && r.body.includedTenders === 10 && r.body.blocked === false, JSON.stringify(r.body));
check('…shown as plan sets: about 8.7 used, 1 left, and the days for the graph',
  r.body.usedTenders === 8.7 && r.body.tendersLeft === 1 && Array.isArray(r.body.days) && r.body.days.length >= 1 && r.body.canBuy === true && r.body.maxPacks === 5 && r.body.packTenders === 10 && r.body.packPrice === 49,
  JSON.stringify({ u: r.body.usedTenders, l: r.body.tendersLeft, d: r.body.days }));
r = await call('GET', '/tender/usage', undefined, T_TRIAL);
check('the trial: US$5 (about 3 plan sets), and no add-on without a paid plan',
  r.body.allowanceUsd === 5 && r.body.includedTenders === 3 && r.body.canBuy === false && Math.abs(r.body.usedUsd - 1.2) < 0.001, JSON.stringify(r.body));

// ── using it up stops the A.I. ────────────────────────────────────
db.tender_ai_runs.push(run(CT, 2.5, iso(now - 30000)));
r = await call('POST', '/tender/any-id/run', {}, T_OWNER);
check('used up: reading a set again answers 402 AI_USAGE_USED with the figures',
  r.status === 402 && r.body.code === 'AI_USAGE_USED' && r.body.usage && r.body.usage.blocked === true && /used up/.test(r.body.error), JSON.stringify(r.body));
for (const path of ['/tender/any-id/draft', '/tender/any-id/amend', '/tender/any-id/section', '/tender/any-id/files/f1/landed']) {
  r = await call('POST', path, { section: 'scope', instruction: 'x' }, T_OWNER);
  check('…and so does ' + path.replace('/tender/any-id', ''), r.status === 402 && r.body.code === 'AI_USAGE_USED', r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
}
r = await call('POST', '/tender/any-id/files/f1/landed', { run: false }, T_OWNER);
check('…but a file landing WITHOUT a read is let through (no A.I. spent)', r.status !== 402, String(r.status));
r = await call('POST', '/tender/any-id/run', {}, T_BOSS);
check('a named RoofMap login is never stopped', r.status === 404, r.status + ' ' + JSON.stringify(r.body));
r = await call('GET', '/tender/usage', undefined, T_BOSS);
check('…and its usage says unlimited', r.body.unlimited === true && r.body.blocked === false, JSON.stringify(r.body));

// ── deleting a tender does not hand the usage back ────────────────
r = await call('DELETE', '/tender/tdel', undefined, T_OWNER);
const kept = db.tender_ai_runs.filter(x => x.tender_id === 'tdel').length;
r = await call('GET', '/tender/usage', undefined, T_OWNER);
check('deleting a tender keeps its A.I. runs, so the month\'s usage stays', kept === 1 && Math.abs(r.body.usedUsd - 15.5) < 0.001, kept + ' ' + r.body.usedUsd);

// ── the add-on ────────────────────────────────────────────────────
r = await call('POST', '/billing/ai-addon', { packs: 2 }, T_MEMBER);
check('only the owner changes the add-on', r.status === 403 && r.body.code === 'OWNER_ONLY', JSON.stringify(r.body));
r = await call('POST', '/billing/ai-addon', { packs: 9 }, T_OWNER);
check('…and never past five packs', r.status === 400, JSON.stringify(r.body));
r = await call('POST', '/billing/ai-addon', { packs: 2 }, T_TRIAL);
check('a trial is told to choose its plan first', r.status === 400 && r.body.code === 'NO_SUBSCRIPTION', JSON.stringify(r.body));
r = await call('POST', '/billing/ai-addon', { packs: 1 }, T_TRADE);
check('a Trade plan (no AI Tendering) is told so', r.status === 400 && r.body.code === 'TENDERING_OFF', JSON.stringify(r.body));

stripeCalls.length = 0;
r = await call('POST', '/billing/ai-addon', { packs: 2 }, T_OWNER);
const made = stripeCalls.find(c => c.method === 'POST' && c.path === '/v1/prices');
const added = stripeCalls.find(c => c.method === 'POST' && c.path === '/v1/subscription_items');
check('two packs: the price is made once — NZ$49 a month, an A$49 option, its lookup key',
  made && made.body.get('unit_amount') === '4900' && made.body.get('currency') === 'nzd' && made.body.get('currency_options[aud][unit_amount]') === '4900' &&
  made.body.get('recurring[interval]') === 'month' && made.body.get('lookup_key') === 'roofmap_ai_pack_month_v1', made && made.body.toString());
check('…added to the subscription, two of them, prorated', added && added.body.get('subscription') === 'sub_T' && added.body.get('quantity') === '2' &&
  added.body.get('proration_behavior') === 'create_prorations', added && added.body.toString());
check('…and the allowance is US$45 (30 plan sets), no longer used up, ai_packs 2',
  r.status === 200 && r.body.allowanceUsd === 45 && r.body.allowanceTenders === 30 && r.body.blocked === false && db.subscriptions.find(s => s.id === 's1').ai_packs === 2, JSON.stringify(r.body));
r = await call('POST', '/tender/any-id/run', {}, T_OWNER);
check('…so reading a set is allowed again', r.status === 404, String(r.status));

stripeCalls.length = 0;
r = await call('POST', '/billing/ai-addon', { packs: 3 }, T_OWNER);
const upd = stripeCalls.find(c => c.method === 'POST' && /^\/v1\/subscription_items\/si_ai_sub_T/.test(c.path));
check('three: the same item\'s quantity changes, no second price or item',
  upd && upd.body.get('quantity') === '3' && !stripeCalls.some(c => c.path === '/v1/prices' && c.method === 'POST') && SUBS.sub_T.items.length === 2 && r.body.allowanceUsd === 60, JSON.stringify(SUBS.sub_T.items));
r = await call('POST', '/billing/ai-addon', { packs: 0 }, T_OWNER);
check('none: the item comes off and the allowance is Team\'s own again',
  SUBS.sub_T.items.length === 1 && r.body.allowanceUsd === 15 && r.body.blocked === true && db.subscriptions.find(s => s.id === 's1').ai_packs === 0, JSON.stringify(SUBS.sub_T.items));

stripeCalls.length = 0;
r = await call('POST', '/billing/ai-addon', { packs: 1 }, T_YEAR);
const ymade = stripeCalls.find(c => c.method === 'POST' && c.path === '/v1/prices');
check('a yearly plan gets a yearly pack: ten months\' price, its own lookup key',
  ymade && ymade.body.get('recurring[interval]') === 'year' && ymade.body.get('unit_amount') === '49000' && ymade.body.get('lookup_key') === 'roofmap_ai_pack_year_v1' && r.body.allowanceUsd === 30,
  ymade && ymade.body.toString());

await new Promise(r2 => stripeSrv.close(r2));
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
