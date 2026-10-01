// THE CUSTOMER'S COPY IS PRICED FROM THE PRODUCTS AS THEY STAND (2026-10-02).
// Job 3288: "Paint Roof" was added in Settings two minutes before the send, on
// another screen; the screen that sent still held the product list from before
// it, so the customer's copy carried no Paint Roof and they accepted a quote
// without it. Pinned:
//   • the send reads the products from the server first; when that moves the
//     total from what this screen showed, nothing is sent and both figures are
//     named;
//   • sent again, the customer's copy carries the option — the products
//     snapshot has it, the frozen prices have it, the total includes it;
//   • a change saved in another tab reaches this one (the storage event);
//   • the server keeping a customer's acceptance over this screen's copy is
//     said on screen, with a way to reopen the job.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1400, height:950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const dialogs = []; pg.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
const PAINT = { id:'paint', title:'Paint Roof', rows:[ { id:'no', name:'Exclude', price:0 }, { id:'yes', name:'Include', desc:'Airless spray', price:3200 } ] };
let serverSettings = null;
await ctx.route('**/api.mapbox.com/**', r => r.abort());
await ctx.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url(), m = r.request().method();
  if (/\/settings(\?|$)/.test(u) && m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(serverSettings || {}) });
  return r.fulfill({ status: 200, contentType: 'application/json', body: m === 'GET' ? '[]' : '{"ok":true,"id":"job-3288"}' });
});
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_first_roof','never'); });
await pg.goto('file://' + DIR + '/app.html');
await sleep(2600);

// This screen: products WITHOUT Paint Roof. The server: products WITH it, picked.
serverSettings = await pg.evaluate((g) => {
  S.settings.selectables = _defaultSelectables();
  S.quote = S.quote || defaultQuote();
  S.quote.style = 'modern'; S.quote.gstRate = 15; S.quote.share = null; S.quote.selectablesSnapshot = null;
  S.quote.proposalOptions = { steelGrade: 'maxam', extras: { paint: 'yes' } };
  S.quote.lineItems = [{ desc: 'Re-screw', qty: 1, price: 2925.61 }];
  S.quote.client = 'Miria'; S.quote.ref = '3288';
  try { recalcQuoteTotals(); } catch(e){}
  const sel = JSON.parse(JSON.stringify(_defaultSelectables())); sel.extras = [g];
  return { branding: {}, quote_defaults: {}, jms_keys: {}, selectables: sel };
}, PAINT);
let v = await pg.evaluate(async () => {
  const before = _custBarTotalValue();
  const got = await _ensureCustomerLink(null, { quiet: true, deferHeavySave: true, deferSentAt: true });
  return { before, got: !!got, after: _custBarTotalValue(), snap: !!(S.quote.selectablesSnapshot) };
});
const said = dialogs.join(' | ');
check('the send reads the products from the server; the total moved, so NOTHING is sent — and it says both figures',
  !v.got && v.after > v.before + 3000 && /Nothing has been sent/.test(said) && /another screen/.test(said), JSON.stringify(v) + ' ' + said.slice(0, 200));
v = await pg.evaluate(async () => {
  const got = await _ensureCustomerLink(null, { quiet: true, deferHeavySave: true, deferSentAt: true });
  const q = S.quote;
  return { got: !!got, snapExtras: ((q.selectablesSnapshot || {}).extras || []).map(g => g.id), priced: Object.keys(((q.share || {}).priced || {}).extras || {}),
           sentTotal: (q.share || {}).sentTotal, live: _custBarTotalValue() };
});
check('sent again, the customer’s copy carries Paint Roof: the products snapshot and the frozen prices both have it',
  v.snapExtras.includes('paint') && v.priced.includes('paint') && dialogs.length === 1, JSON.stringify(v));
check('…and the total they are sent includes it — the figure this screen shows', Math.abs(v.sentTotal - v.live) < 0.01 && v.sentTotal > 3500, JSON.stringify(v));

// another tab saves Settings: this one follows
v = await pg.evaluate(() => {
  const o = JSON.parse(JSON.stringify(S.settings)); o.selectables.extras[0].title = 'Paint Roof (2 coats)';
  window.dispatchEvent(new StorageEvent('storage', { key: 'fr_settings', newValue: JSON.stringify(o) }));
  return S.settings.selectables.extras[0].title;
});
check('a products change saved in another tab reaches this one', v === 'Paint Roof (2 coats)', v);

// the server kept a customer's acceptance over this screen's copy
v = await pg.evaluate(() => { _keptAcceptanceNotice(); const b = document.getElementById('keptAccBar'); return b ? b.textContent : ''; });
check('when the server keeps a customer’s acceptance, the office is told, with Reopen the job', /customer has accepted this quote/.test(v) && /Reopen the job/.test(v), v);
check('nothing threw', errs.length === 0, errs.join(' | ').slice(0, 300));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
