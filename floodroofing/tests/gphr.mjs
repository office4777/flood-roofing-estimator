// "Make the GP/hr number adjustable by $1, which adjusts the labour charge-out
//  rate, round it to the nearest $1; add material cost/m² and labour price/m²,
//  make labour/m² adjustable too — each moves the other."
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1100} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate((g) => {
  S.settings = S.settings || {};
  S.settings.price_book = { list_prices:false, sheets:[{product:'0.40g Colorsteel Maxam',unit:'m2',price:34}],
    ridge_lm:22, valley_lm:26, gutter_lm:28, barge_lm:20, apron_lm:22, changepitch_lm:24, screws_each:0.35, rivets_each:0.15, downpipe_ea:150,
    underlay:{'50':150,'75':210,'100':270}, gutter:{ box125_lm:30, marley_classic_lm:35, marley_typhoon_lm:40, ext_bracket_box125_lm:6, ext_bracket_marley_lm:3 }, extras:[] };
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r, { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  S.quote = S.quote || {}; S.quote.gstRate = 15;
  S.quote.roofSeparate = {1:true,2:true,3:true,4:true,5:true}; S.quote.roofExcluded = {};
  try { redrawAll(); } catch(e){}
  gotoTab('pricing');
}, GEOM);
await pg.waitForTimeout(2200);
await pg.evaluate(() => {
  S.quote.labourHrsManual = { 0: true };
  S.quote.labour = Object.assign(S.quote.labour || {}, { leadHrs: 20, appHrs: 20, leadPrice: 180, appPrice: 90, leadCost: 45, appCost: 25, extras: [] });
  S.quote.scaffold = Object.assign(S.quote.scaffold || {}, { price: 2500, cost: 2000, type: 'edge' });
  calcLabour(); renderMaterialPriceTable(); renderProfitability();
});
await pg.waitForTimeout(400);

// ── views: Total by default, one button per priced roof ──
const views = await pg.evaluate(() => {
  renderProfitability();
  const bar = document.getElementById('profitViewBar');
  const btns = bar ? Array.from(bar.querySelectorAll('button')).map(b => b.textContent) : [];
  const total = _profitFigures('total'), main = _profitFigures(0);
  const sum = _pricingRoofTabIdxs().reduce((a, i) => a + _profitFigures(i).labourPrice + _profitFigures(i).mat + _profitFigures(i).scPrice, 0);
  const text = document.getElementById('profitWrap').innerText.replace(/\s+/g, ' ');
  return { view: _profitView(), btns, tabs: _pricingRoofTabIdxs().length, totalRev: total.labourPrice + total.mat + total.scPrice, sum, mainMat: main.mat, totalMat: total.mat,
           hasRule: !!document.querySelector('#profitWrap [style*="border-top"]'), text };
});
check('the panel opens on the Total by default', views.view === 'total');
check('…with a button for the total and one per priced roof', views.btns.length === views.tabs + 1 && /Total/.test(views.btns[0]), views.btns.join(' | '));
check('…and the total is every priced roof added up', Math.abs(views.totalRev - views.sum) < 0.02 && views.totalMat > views.mainMat, '$' + views.totalRev.toFixed(2));
check('the per-m² figures sit under their own rule, with revenue per m² first', views.hasRule && /Per square metre/.test(views.text) && /Job revenue \/ m²/.test(views.text), views.text.slice(0, 120));
check('the breakdown card is gone', await pg.evaluate(() => !document.getElementById('perRoofBreakdownCard')));
await pg.evaluate(() => _setProfitView(0));
await pg.waitForTimeout(200);
check('picking the main roof shows its own figures', await pg.evaluate(() => _profitView() === 0));

const read = () => pg.evaluate(() => {
  const w = document.getElementById('profitWrap');
  const t = w ? w.innerText.replace(/\s+/g, ' ') : '';
  const L = S.quote.labour;
  const area = _labourCalcAutoQty(0).roof;
  const gp = (S.labour + S.materials + S.quote.scaffold.price) - (S.labourCost + S.materials + S.quote.scaffold.cost);
  return { text: t, gpHrShown: (document.getElementById('profitGpHr') || {}).textContent, labM2Shown: (document.getElementById('profitLabM2') || {}).textContent,
           gpHr: gp / S.labourHours, labM2: S.labour / area, matM2: S.materials / area, area, lead: L.leadPrice, app: L.appPrice, labour: S.labour, hrs: S.labourHours, sub: quoteSubtotal() };
});
let v = await read();
check('the panel shows material cost per m² and labour price per m²', /Material cost \/ m²/.test(v.text) && /Labour price \/ m²/.test(v.text), v.text.slice(0, 200));
check('…material cost/m² is the material cost over the roof this price covers', new RegExp('\\$' + v.matM2.toFixed(2).replace('.', '\\.')).test(v.text) || new RegExp(fmt(v.matM2)).test(v.text), '$' + v.matM2.toFixed(2) + ' over ' + v.area + ' m²');
function fmt(n){ return '\\$' + Math.round(n * 100) / 100; }
check('GP/hr is shown to the nearest dollar', v.gpHrShown === '$' + Math.round(v.gpHr).toLocaleString('en-NZ'), v.gpHrShown + ' for ' + v.gpHr.toFixed(2));
check('…and so is labour/m²', v.labM2Shown === '$' + Math.round(v.labM2).toLocaleString('en-NZ'), v.labM2Shown + ' for ' + v.labM2.toFixed(2));

// ── nudge GP/hr up a dollar ──
const before = v;
const btns = await pg.evaluate(() => document.querySelectorAll('#profitWrap button[onclick*="_profitNudge"]').length);
check('there are − and + buttons on GP/hr and on labour/m²', btns === 4, btns + ' buttons');
await pg.evaluate(() => document.getElementById('profitGpHr').nextElementSibling.querySelectorAll('button')[1].click());
await pg.waitForTimeout(400);
v = await read();
check('THE FEATURE: + on GP/hr lands exactly one whole dollar up', Math.abs(v.gpHr - (Math.round(before.gpHr) + 1)) < 0.02, before.gpHr.toFixed(2) + ' → ' + v.gpHr.toFixed(2));
check('…by moving every charge-out rate by the same amount', v.lead > before.lead && Math.abs((v.lead - before.lead) - (v.app - before.app)) < 0.011, 'lead ' + before.lead + '→' + v.lead + ', apprentice ' + before.app + '→' + v.app);
check('…which raises the labour charge by hours × $1', Math.abs((v.labour - before.labour) - (Math.round(before.gpHr) + 1 - before.gpHr) * before.hrs) < 0.5, '+$' + (v.labour - before.labour).toFixed(2) + ' over ' + before.hrs + ' hrs');
check('…and the quote follows', v.sub > before.sub, '$' + before.sub.toFixed(2) + ' → $' + v.sub.toFixed(2));
check('…and labour/m² moved with it', v.labM2 > before.labM2);

// ── nudge labour/m² down a dollar ──
const mid = v;
await pg.evaluate(() => document.getElementById('profitLabM2').nextElementSibling.querySelectorAll('button')[0].click());
await pg.waitForTimeout(400);
v = await read();
check('− on labour/m² lands exactly one whole dollar down', Math.abs(v.labM2 - (Math.round(mid.labM2) - 1)) < 0.02, mid.labM2.toFixed(2) + ' → ' + v.labM2.toFixed(2));
check('…taking area × $1-ish off the labour charge and the rates with it', v.labour < mid.labour && v.lead < mid.lead, '$' + mid.labour.toFixed(2) + ' → $' + v.labour.toFixed(2));
check('…and GP/hr moved the other way', v.gpHr < mid.gpHr, mid.gpHr.toFixed(2) + ' → ' + v.gpHr.toFixed(2));
check('the rates are now this job’s own, not the settings default', await pg.evaluate(() => S.quote.labourRatesCustom === true));
check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
