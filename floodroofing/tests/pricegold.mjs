// PRICING GOLDEN MASTER.
//
// The customer's browser is handed the roofer's cost basis and markup —
// materialBase, roofMaterialMarkup, labourRatesCustom — because it recomputes
// the price locally every time the customer toggles an option. Closing that
// leak means the office precomputes the sell prices and the customer page adds
// them up instead.
//
// A refactor of a pricing engine is only safe if it cannot change a price. So
// this captures what all 1024 selection combinations cost BEFORE the change,
// and holds the code to those numbers to the cent afterwards. Regenerate
// deliberately with REGEN=1 when a price is MEANT to move; a diff you did not
// intend is the whole point of the file.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const DIR = _j(_ROOT, 'frontend');
const GOLD = _j(_ROOT, 'tests', 'pricegold.json');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({viewport:{width:1400,height:900}});
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2500);
const demo = JSON.parse(await readFile(_j(DIR, 'demo-job.json'), 'utf8'));

// One fixture, used to generate the baseline and to check against it, so the
// two can never drift apart.
// Installed once, applied before each matrix. The office run mutates quote
// state as it goes, and an async render can repopulate lineItems from the
// restored job afterwards — so the second matrix has to start from the same
// place as the first, not from wherever the first left off.
await pg.evaluate((job) => {
  window.__applyPriceFixture = function(){
  S.settings = S.settings || {};
  S.settings.price_book = {
    list_prices:false,
    sheets:[{product:'0.40g Colorsteel Maxam',unit:'m2',price:34}],
    ridge_lm:22, valley_lm:26, gutter_lm:28, barge_lm:20, apron_lm:22, changepitch_lm:24,
    screws_each:0.35, rivets_each:0.15, downpipe_ea:150,
    underlay:{'50':150,'75':210,'100':270},
    gutter:{ typhoon_spouting_lm:19.27, typhoon_bracket_ea:5.56, typhoon_outlet_ea:24.21,
      typhoon_joiner_ea:3.82, typhoon_corner_ea:19.74, typhoon_stopend_ea:5.16,
      typhoon_expjoiner_ea:21.92, typhoon_weldsolvent_ea:20.87,
      box125_lm:30, marley_classic_lm:35, marley_typhoon_lm:40,
      ext_bracket_box125_lm:6, ext_bracket_marley_lm:3 },
    extras:[]
  };
  try { restoreFromJob(job); } catch(e){}
  S.quote = S.quote || {};
  S.quote.gstRate = 15;
  S.quote.scaffoldBase = 4200;
  S.quote.materialBase = 9600;
  S.quote.baseGrade = 'maxam';
  S.quote.gutterLm = 42;
  S.quote.gutterLines = 3;
  S.quote.extraRoofs = [{ name:'Garage', price: 4800 }, { name:'Veranda', price: 2150 }];
  S.quote.share = S.quote.share || {};
  S.quote.share.priced = null;
  // quoteSubtotal() multiplies qty by UNIT, not price — a fixture using
  // `price` gave a base of 0 and made every combination differ only by its
  // add-ons, which is a much weaker test than it looks.
  S.quote.lineItems = [{ desc:'Main scope', qty:1, unit: 28500 }];

  };
  window.__applyPriceFixture();
}, demo);
await pg.waitForTimeout(600);   // let any deferred render settle BEFORE capturing

const matrix = await pg.evaluate(() => {
  window.__applyPriceFixture();
  const GRADES  = ['maxam','colorzen','colourcote','zincalume'];
  const PROFS   = ['corrugate','5rib'];
  const THICKS  = ['40','55'];
  const GUTTERS = ['none','box125','marley_typhoon','marley_classic'];
  const BRACK   = ['internal','external'];
  const EXTRAS  = [{}, {0:true}, {1:true}, {0:true,1:true}];
  const OVERRIDE = [null, 3900];
  const out = [];
  OVERRIDE.forEach(function(ov){
    S.quote.gutterPriceOverride = ov;
    GRADES.forEach(function(g){ PROFS.forEach(function(pr){ THICKS.forEach(function(th){
      GUTTERS.forEach(function(gt){ BRACK.forEach(function(br){ EXTRAS.forEach(function(ex, exi){
        S.quote.proposalOptions = { steelGrade:g, profile:pr, steelThickness:th,
                                    gutterType:gt, gutterBracket:br, extraRoofsSel: ex };
        const money = _quoteMoney();
        out.push({
          k: [ov||0,g,pr,th,gt,br,exi].join('|'),
          sub: Math.round(money.sub * 100) / 100,
          tot: Math.round(money.tot * 100) / 100,
          d: _qpSelectionChanges().map(function(c){
               return c.label + '=' + (Math.round(c.delta * 100) / 100); }).join(';'),
        });
      }); }); }); }); }); });
  });
  return out;
});

// The same 1024 combinations again, but priced the way a CUSTOMER's browser
// prices them: from the sell prices the office stored at send, with no access
// to materialBase, the mark-ups or scaffoldBase. If these disagree with the
// office numbers by a cent, the leak has been closed by changing someone's
// quote, which is not closing it.
const priced = await pg.evaluate(() => {
  window.__applyPriceFixture();
  const GRADES  = ['maxam','colorzen','colourcote','zincalume'];
  const PROFS   = ['corrugate','5rib'];
  const THICKS  = ['40','55'];
  const GUTTERS = ['none','box125','marley_typhoon','marley_classic'];
  const BRACK   = ['internal','external'];
  const EXTRAS  = [{}, {0:true}, {1:true}, {0:true,1:true}];
  const OVERRIDE = [null, 3900];
  const out = [];
  OVERRIDE.forEach(function(ov){
    S.quote.gutterPriceOverride = ov;
    // Rebuild as the office would at THAT moment — the override is part of what
    // is sent, not something the customer's copy can change.
    S.quote.share.priced = null;
    S.quote.share.priced = _qpBuildPriced();
    GRADES.forEach(function(g){ PROFS.forEach(function(pr){ THICKS.forEach(function(th){
      GUTTERS.forEach(function(gt){ BRACK.forEach(function(br){ EXTRAS.forEach(function(ex, exi){
        S.quote.proposalOptions = { steelGrade:g, profile:pr, steelThickness:th,
                                    gutterType:gt, gutterBracket:br, extraRoofsSel: ex };
        const money = _quoteMoney();
        out.push({
          k: [ov||0,g,pr,th,gt,br,exi].join('|'),
          sub: Math.round(money.sub * 100) / 100,
          tot: Math.round(money.tot * 100) / 100,
          d: _qpSelectionChanges().map(function(c){
               return c.label + '=' + (Math.round(c.delta * 100) / 100); }).join(';'),
        });
      }); }); }); }); }); });
  });
  return out;
});

if (process.env.REGEN === '1') {
  await writeFile(GOLD, JSON.stringify(matrix, null, 0));
  console.log('REGEN — baseline rewritten with ' + matrix.length + ' combinations.');
  console.log('Check the diff: every changed number is a price that moved.');
} else {
  const gold = JSON.parse(await readFile(GOLD, 'utf8'));
  check('the combination set itself has not changed',
    matrix.length === gold.length, matrix.length + ' vs ' + gold.length + ' expected');
  const byKey = new Map(gold.map(g => [g.k, g]));
  const totalDiffs = [], deltaDiffs = [], missing = [];
  for (const m of matrix) {
    const g = byKey.get(m.k);
    if (!g) { missing.push(m.k); continue; }
    if (g.tot !== m.tot || g.sub !== m.sub) totalDiffs.push(m.k + ': $' + g.tot + ' → $' + m.tot);
    else if (g.d !== m.d) deltaDiffs.push(m.k);
  }
  check('every combination still exists', missing.length === 0,
    missing.length ? missing.slice(0,3).join(' | ') : 'none dropped');
  check('every one of the ' + matrix.length + ' combinations still costs the same to the cent',
    totalDiffs.length === 0,
    totalDiffs.length ? (totalDiffs.length + ' moved: ' + totalDiffs.slice(0,4).join(' | ')) : 'no price moved');
  check('…and the line-by-line breakdown behind each is unchanged',
    deltaDiffs.length === 0,
    deltaDiffs.length ? (deltaDiffs.length + ' differ: ' + deltaDiffs.slice(0,3).join(', ')) : 'identical');
  // The whole point of the exercise.
  const pByKey = new Map(priced.map(p => [p.k, p]));
  const pDiffs = [], pDelta = [];
  for (const g of gold) {
    const p = pByKey.get(g.k);
    if (!p) { pDiffs.push(g.k + ': missing'); continue; }
    if (p.tot !== g.tot || p.sub !== g.sub) pDiffs.push(g.k + ': $' + g.tot + ' → $' + p.tot);
    else if (p.d !== g.d) pDelta.push(g.k);
  }
  check('a customer pricing from stored sell prices gets the SAME number, all ' + priced.length + ' ways',
    pDiffs.length === 0,
    pDiffs.length ? (pDiffs.length + ' differ: ' + pDiffs.slice(0,4).join(' | ')) : 'identical to the office');
  check('…line for line, including the labels on each',
    pDelta.length === 0,
    pDelta.length ? (pDelta.length + ' differ: ' + pDelta.slice(0,3).join(', ')) : 'identical');

  check('the baseline is broad enough to be worth trusting',
    new Set(gold.map(g => g.tot)).size > 200, new Set(gold.map(g => g.tot)).size + ' distinct totals');
}
check('and nothing threw while pricing', errs.length === 0, errs.join(' | ') || 'no page errors');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
