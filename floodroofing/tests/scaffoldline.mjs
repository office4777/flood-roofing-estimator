// THE SCAFFOLD IS ITS OWN LINE ON EVERY SUMMARY.
//
// The owner, 2026-09-29: "Every quote summary, can you always separate the
// scaffolding price on top of the re-roof price so the customer can clearly see
// that scaffold is included and what the price is for that scaffold? We just
// had a job sent and the customer clicked to include gutter and previously it
// didn't show the scaffold line item. But then all of a sudden it showed a
// small scaffold line item, and the customer was confused at how cheap our
// scaffold was, when in reality the scaffold was priced into the job, but it
// just wasn't showing as a line item. … This shouldn't affect any of the quote
// totals."
//
// So the base price is shown in two parts — the re-roof and the scaffold — and
// the two still add up to exactly what the one line used to read. The scaffold
// figure is taken from the LINES THE BASE IS MADE OF, never from
// _selScaffoldBasePrice(), which answers 0 on a platform job and under the
// office's "no platform upgrade needed" tick because it exists to price the
// +25%.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const money = s => parseFloat(String(s).replace(/[^0-9.\-]/g, '')) || 0;

const b = await chromium.launch();

// ── the office's own preview: the shared row builder ────────────────
const pg = await (await b.newContext({ viewport:{ width:1500, height:1000 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
  localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_site_mode','off');
});
await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2500);
await pg.evaluate(() => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  window.__QFIX = function(sc){
    S.labour = 9000; S.materials = 12000;
    S.quote = defaultQuote();
    S.quote.gstRate = 15;
    // Without this _pricingState() puts the Settings default back over a
    // per-job scaffold price every time the Pricing panel is read.
    S.quote.scaffoldCustom = true;
    S.quote.options = [];
    S.quote.extraRoofs = [];
    S.quote.proposalOptions = {};
    S.quote.scaffold = sc || { price: 2800, cost: 2200, type: 'edge' };
    S.quote.scaffoldBase = (S.quote.scaffold.type === 'platform') ? 0 : S.quote.scaffold.price;
    S.quote.lineItems = [
      { desc:'Labour',      qty:1, unit:9000 },
      { desc:'Materials',   qty:1, unit:12000 },
      { desc:'Scaffolding', qty:1, unit:S.quote.scaffold.price },
    ];
  };
});

// ── the split itself ───────────────────────────────────────────────
const one = await pg.evaluate(() => {
  __QFIX();
  const rows = _custBarRows();
  return { kinds: rows.map(r => r.kind), labels: rows.map(r => r.label), values: rows.map(r => r.value),
           shorts: rows.map(r => r.short || ''),
           base: _qpBaseSub(), scaff: _qpBaseScaffold(), total: _custBarTotalValue() };
});
check('the summary has a re-roof row and a scaffolding row of its own',
  one.kinds[0] === 'base' && one.kinds[1] === 'scaffold' && /Re-roof/.test(one.labels[0]) && /Scaffolding/.test(one.labels[1]),
  JSON.stringify(one.kinds) + ' ' + JSON.stringify(one.labels));
check('…the re-roof figure EXCLUDES the scaffold',
  Math.abs(money(one.values[0]) - (one.base - one.scaff) * 1.15) < 0.02,
  one.values[0] + ' vs ' + ((one.base - one.scaff) * 1.15).toFixed(2));
check('…the scaffolding row carries the scaffold’s own price',
  Math.abs(money(one.values[1]) - one.scaff * 1.15) < 0.02 && one.scaff === 2800,
  one.values[1] + ' / base ' + one.scaff);
check('…and the two still add up to the price the one line used to read',
  Math.abs(money(one.values[0]) + money(one.values[1]) - one.base * 1.15) < 0.02,
  (money(one.values[0]) + money(one.values[1])).toFixed(2) + ' vs ' + (one.base * 1.15).toFixed(2));
check('THE TOTAL IS UNTOUCHED by the split',
  Math.abs(one.total - one.base * 1.15) < 0.02 && Math.abs(money(one.values[2]) - one.total) < 0.02,
  one.total.toFixed(2) + ' / row ' + one.values[2]);
check('an edge-protection scaffold says so on the line', /edge protection/i.test(one.labels[1]), one.labels[1]);
// The narrow places (the phone's bottom bar, the computer's rail) get a short
// label, so the pair reads "Re-roof / Scaffolding" and the split base is never
// still called "main scope of work".
check('the narrow summaries call the split pair Re-roof and Scaffolding',
  one.shorts[0] === 'Re-roof' && one.shorts[1] === 'Scaffolding', JSON.stringify(one.shorts));

// ── the gutter: the scaffold price is already on the page, so the +25%
//    upgrade reads as an increase on it rather than as the whole scaffold ──
const gut = await pg.evaluate(() => {
  __QFIX();
  S.quote.gutterPriceOverride = 1500;
  S.quote.proposalOptions.gutterType = 'box125';
  const rows = _custBarRows();
  return { labels: rows.map(r => r.label), kinds: rows.map(r => r.kind), values: rows.map(r => r.value),
           base: _qpBaseSub(), scaff: _qpBaseScaffold(), deltas: _qpSelectionDeltaSum(),
           total: _custBarTotalValue(), uplift: 0.25 * _selScaffoldBasePrice() };
});
const gScaffRow = gut.kinds.indexOf('scaffold');
check('with guttering added the scaffolding row is still there, at the same price',
  gScaffRow === 1 && Math.abs(money(gut.values[1]) - 2800 * 1.15) < 0.02, gut.values[gScaffRow]);
check('…the platform upgrade is its own row beside it, and reads as an increase',
  gut.labels.some(l => /Platform scaffolding upgrade/.test(l)) &&
  gut.values.some(v => /^\+/.test(v) && Math.abs(money(v) - gut.uplift * 1.15) < 0.02),
  JSON.stringify(gut.labels));
const gUpIdx = gut.labels.findIndex(l => /Platform scaffolding upgrade/.test(l));
check('…so the customer can see $2,800 of scaffold and a $' + Math.round(gut.uplift) + ' upgrade, not just the upgrade',
  gut.uplift === 700 && gUpIdx > 0 && money(gut.values[1]) > money(gut.values[gUpIdx]) * 3,
  'scaffold ' + gut.values[1] + ', upgrade row ' + gut.values[gUpIdx]);
check('…and the total is still base + the customer’s picks, unchanged',
  Math.abs(gut.total - (gut.base + gut.deltas) * 1.15) < 0.02,
  gut.total.toFixed(2));

// ── a platform job: _selScaffoldBasePrice() is 0 there, so the old
//    "of which scaffolding" line showed nothing at all ──
const plat = await pg.evaluate(() => {
  __QFIX({ price: 4200, cost: 3400, type: 'platform' });
  const rows = _custBarRows();
  return { kinds: rows.map(r => r.kind), labels: rows.map(r => r.label), values: rows.map(r => r.value),
           uplift: _selScaffoldBasePrice(), base: _qpBaseSub(), total: _custBarTotalValue() };
});
check('a PLATFORM scaffold still gets its line, at its own price',
  plat.kinds[1] === 'scaffold' && Math.abs(money(plat.values[1]) - 4200 * 1.15) < 0.02 && plat.uplift === 0,
  JSON.stringify(plat.values));
check('…and says it is a full working platform', /platform/i.test(plat.labels[1]), plat.labels[1]);
check('…with the total still untouched', Math.abs(plat.total - plat.base * 1.15) < 0.02, plat.total.toFixed(2));

// ── the office's "no platform upgrade needed" tick (a low roof) ──
const low = await pg.evaluate(() => {
  __QFIX();
  S.quote.gutterNoPlatform = true;
  S.quote.proposalOptions.gutterType = 'box125';
  S.quote.gutterPriceOverride = 1500;
  const rows = _custBarRows();
  return { kinds: rows.map(r => r.kind), values: rows.map(r => r.value),
           upliftRow: rows.some(r => /Platform scaffolding upgrade/.test(r.label)) };
});
check('the low-roof tick keeps the scaffolding line and adds no upgrade',
  low.kinds[1] === 'scaffold' && Math.abs(money(low.values[1]) - 2800 * 1.15) < 0.02 && !low.upliftRow,
  JSON.stringify(low.kinds));

// ── a quote with no scaffolding in it reads exactly as before ──
const none = await pg.evaluate(() => {
  __QFIX();
  S.quote.scaffold = { price: 0, cost: 0, type: 'edge' };
  S.quote.lineItems = [{ desc:'Labour', qty:1, unit:9000 }, { desc:'Materials', qty:1, unit:12000 }];
  const rows = _custBarRows();
  return { kinds: rows.map(r => r.kind), labels: rows.map(r => r.label), values: rows.map(r => r.value),
           base: _qpBaseSub(), scaff: _qpBaseScaffold() };
});
check('a quote with no scaffolding priced in it keeps ONE base row, as before',
  none.scaff === 0 && none.kinds.filter(k => k === 'scaffold').length === 0 &&
  /Original quote/.test(none.labels[0]) && Math.abs(money(none.values[0]) - none.base * 1.15) < 0.02,
  JSON.stringify(none.labels));

// A custom scaffold line the office typed on the Pricing tab counts too.
const custom = await pg.evaluate(() => {
  __QFIX();
  S.quote.lineItems.push({ desc:'Extra tower to the chimney', qty:1, unit:450, _custom:true, _area:'scaffold' });
  const rows = _custBarRows();
  return { scaff: _qpBaseScaffold(), values: rows.map(r => r.value), base: _qpBaseSub() };
});
check('a custom scaffold line on the Pricing tab is part of the scaffolding figure',
  custom.scaff === 3250 && Math.abs(money(custom.values[1]) - 3250 * 1.15) < 0.02 &&
  Math.abs(money(custom.values[0]) + money(custom.values[1]) - custom.base * 1.15) < 0.02,
  'scaffold ' + custom.scaff + ' rows ' + JSON.stringify(custom.values));

// ── the A4's acceptance summary splits the same way and still adds up ──
const a4 = await pg.evaluate(() => {
  __QFIX();
  const html = buildAcceptSummaryRows();
  const box = document.createElement('div'); box.innerHTML = html;
  const rows = [...box.children].map(d => d.textContent.trim());
  return { rows, base: _qpBaseSub() };
});
const a4Nums = a4.rows.map(t => parseFloat((t.match(/\$[\d,]+(\.\d+)?/) || ['0'])[0].replace(/[^0-9.]/g, '')) || 0);
check('the A4 acceptance summary splits the scaffold out too',
  a4.rows.some(t => /Re-roof — main scope of work/.test(t)) && a4.rows.some(t => /Scaffolding/.test(t)),
  a4.rows.join(' | ').slice(0, 200));
check('…the scaffold line carries a price, not a grey "already in the figure above"',
  !a4.rows.some(t => /already in the figure above/.test(t)) &&
  a4.rows.some(t => /Scaffolding/.test(t) && /\$3,220/.test(t)),
  a4.rows.filter(t => /Scaffold/.test(t)).join(' | '));
check('…and the two rows still add to the original quote figure',
  Math.abs(a4Nums.slice(0, 2).reduce((s, n) => s + n, 0) - a4.base * 1.15) < 0.02,
  a4Nums.slice(0, 2).join(' + ') + ' vs ' + (a4.base * 1.15).toFixed(2));

// ── the office's Computer and Phone previews carry the row ──
// A real roof, so the live line baker (_syncQuoteBaseLineItems, which runs
// inside every proposal render) puts real labour and materials beside the
// scaffold instead of leaving the scaffold as the whole base.
await pg.evaluate(() => {
  S.settings.price_book = Object.assign(S.settings.price_book || {}, {
    sheets: [{ product: '0.40g Colorsteel Maxam', unit: 'm2', price: 34 }],
    ridge_lm: 22, barge_lm: 20, screws_each: 0.35, rivets_each: 0.15,
    underlay: { '50': 150, '75': 210, '100': 270 } });
  S.settings.labour_pricing = Object.assign(S.settings.labour_pricing || {}, { scaffold_price: 2800, scaffold_cost: 2200 });
  gotoTab('roof'); clearAll(true);
  setTool('outline'); DRAW.currentPts = [[200,300],[800,300],[800,600],[200,600]]; finishCurrent();
  DRAW.scaleMetresPerPx = 0.02; DRAW.calPitch = 20;
  autoGenerateRoof('gable'); autoCalcLineMeasurements();
});
await pg.waitForTimeout(400);
{ const skip = pg.getByRole('button', { name: 'Skip for now' }); if (await skip.count()) await skip.first().click(); }
const shown = await pg.evaluate(async () => {
  S.currentJobId = 'job1'; S.jobLocked = false;
  S.quote.gstRate = 15; S.quote.style = 'modern';
  S.quote.options = []; S.quote.extraRoofs = []; S.quote.proposalOptions = {};
  delete S.quote.gutterNoPlatform; delete S.quote.gutterPriceOverride;
  S.quote.scaffoldCustom = true;
  S.quote.scaffold = { price: 2800, cost: 2200, type: 'edge' };
  calcLabour();
  gotoTab('quote');
  await new Promise(r => setTimeout(r, 400));
  const parts = { base: 0, scaff: 0, labour: S.labour, mats: S.materials };
  _setQuotePreviewMode('desk');
  await new Promise(r => setTimeout(r, 500));
  const rail = [...document.querySelectorAll('.qd-rail-row')].map(e => e.textContent.trim());
  parts.base = _qpBaseSub(); parts.scaff = _qpBaseScaffold();
  _setQuotePreviewMode('phone');
  await new Promise(r => setTimeout(r, 500));
  let bookRows = [];
  try { const keys = _qbPages().map(p => p.key); _qbGo(keys.length - 1); } catch(e){}
  await new Promise(r => setTimeout(r, 400));
  bookRows = [...document.querySelectorAll('.qb-sum-row')].map(e => e.textContent.trim());
  return { rail, bookRows, parts };
});
check('the live line baker still leaves the scaffold its own line',
  shown.parts.scaff === 2800 && shown.parts.base > 2800 && shown.parts.labour > 0 && shown.parts.mats > 0,
  JSON.stringify(shown.parts));
check('the computer layout’s summary rail shows the scaffolding row',
  shown.rail.some(t => /^Scaffolding\$?3,220/.test(t.replace(/\s/g, ''))) &&
  shown.rail.some(t => /^Re-roof/.test(t)), shown.rail.join(' | ').slice(0, 200));
check('the phone book’s summary page shows it too',
  shown.bookRows.some(t => /Scaffolding/i.test(t) && /3,220/.test(t)), shown.bookRows.join(' | ').slice(0, 200));
check('no page errors in the office', errs.length === 0, errs.join(' | '));
await pg.close();

// ── the CUSTOMER'S share link: the same two rows, from the sent quote ──
const sent = () => ({
  ref:'FR-30099', client:'Mrs Tui', accepted:false, gstRate:15, style:'modern',
  scaffold:{ price:2800, cost:2200, type:'edge' }, scaffoldBase:2800,
  lineItems:[{desc:'Labour',qty:1,unit:9000},{desc:'Materials',qty:1,unit:12000},{desc:'Scaffolding',qty:1,unit:2800}],
  options:[], extraRoofs:[], baseGrade:'maxam',
  proposalOptions:{ extraRoofsSel:{}, steelGrade:'maxam', profile:'corrugate' },
  share:{ priced:{ v:1, gstRate:15, base:23800, grade:{}, gradeLabel:{}, gaugeUpgrade:0,
    profileLocks:{}, profileLabel:{}, gutter:{ box125:1500 }, gutterLabel:{ box125:'125mm Colorsteel Box Gutter' },
    gutterUplift:{ box125:true }, gutterOverride:null, bracketExt:{ box125:0 },
    scaffoldUplift:700, downpipes:0, extraRoof:[], extraRoofLabel:[], extraRoofSplit:[],
    gutterExcluded:false, extras:{} } },
});
const ctx2 = await b.newContext({ viewport:{ width:1500, height:950 } });
const cp = await ctx2.newPage();
const cerrs = []; cp.on('pageerror', e => cerrs.push(e.message));
await cp.route('**/api.mapbox.com/**', r => r.abort());
await cp.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const u = r.request().url();
  if (/\/q\/[^/]+\/event/.test(u)) return r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
  if (/\/q\//.test(u)) return r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ quote: sent(), branding:{} }) });
  return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
});
await cp.goto('file://' + DIR + '/app.html?q=tok&j=FR-30099');
await cp.waitForTimeout(3000);
const cust = await cp.evaluate(() => {
  const rows = _custBarRows();
  return { mode: !!window.__CUSTOMER_MODE, kinds: rows.map(r => r.kind), labels: rows.map(r => r.label),
           values: rows.map(r => r.value), total: _custBarTotalValue(), base: _qpBaseSub(),
           rail: [...document.querySelectorAll('.qd-rail-row')].map(e => e.textContent.trim()) };
});
check('the customer opened their sent quote', cust.mode, '');
check('…and sees the re-roof and the scaffolding as two rows',
  cust.kinds[0] === 'base' && cust.kinds[1] === 'scaffold' &&
  Math.abs(money(cust.values[1]) - 2800 * 1.15) < 0.02, JSON.stringify(cust.labels));
check('…adding up to the price they were sent, with the total unchanged',
  Math.abs(money(cust.values[0]) + money(cust.values[1]) - cust.base * 1.15) < 0.02 &&
  Math.abs(cust.total - 23800 * 1.15) < 0.02, cust.total.toFixed(2));
check('…on the rail they actually read, as Re-roof and Scaffolding',
  cust.rail.some(t => /^Re-roof/.test(t)) && cust.rail.some(t => /^Scaffolding/.test(t)),
  cust.rail.join(' | ').slice(0, 200));

// The customer adds guttering: the scaffold stays visible at its own price and
// the upgrade is an increase on it — the confusion this was built to end.
const custGut = await cp.evaluate(async () => {
  _setProposalOption('gutterType', 'box125');
  await new Promise(r => setTimeout(r, 500));
  const rows = _custBarRows();
  return { labels: rows.map(r => r.label), kinds: rows.map(r => r.kind), values: rows.map(r => r.value),
           total: _custBarTotalValue(),
           rail: [...document.querySelectorAll('.qd-rail-row')].map(e => e.textContent.trim()) };
});
check('the customer ticks guttering and the scaffolding row is STILL $3,220',
  custGut.kinds[1] === 'scaffold' && Math.abs(money(custGut.values[1]) - 2800 * 1.15) < 0.02,
  JSON.stringify(custGut.values));
check('…with the platform upgrade listed under their choices, as an increase',
  custGut.labels.some(l => /Platform scaffolding upgrade/.test(l)) &&
  custGut.values.some(v => /^\+/.test(v) && Math.abs(money(v) - 700 * 1.15) < 0.02),
  JSON.stringify(custGut.labels));
check('…and their total is base + gutter + uplift, to the cent',
  Math.abs(custGut.total - (23800 + 1500 + 700) * 1.15) < 0.02, custGut.total.toFixed(2));
check('nothing threw on the customer’s page', cerrs.length === 0, cerrs.join(' | '));

await b.close();
const bad = results.filter(r => !r).length;
console.log(bad ? ('FAILED ' + bad + '/' + results.length) : ('All ' + results.length + ' passed'));
process.exit(bad ? 1 : 0);
