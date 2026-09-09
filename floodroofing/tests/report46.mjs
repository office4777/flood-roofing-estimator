// Report 46: "the combined roof area is actually 267 m² but the material for
// those combined roofs only says 120 m²" — the Pricing tab's material rows
// were built from the main roof ALONE while its labour, its area tile and the
// quote all covered the group (main + every roof folded in). And, in the same
// batch: a quantity typed on Roof 1 turned up on every other roof's tab (one
// job-wide override bucket); a custom material line was left out of the green
// material total; and a plain mouse wheel over another roof shrank THAT roof
// instead of scrolling the page.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const r1 = v => Math.round(v * 10) / 10;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1100} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate((g) => {
  S.settings = S.settings || {};
  S.settings.price_book = {
    list_prices:false,
    sheets:[{product:'0.40g Colorsteel Maxam',unit:'m2',price:34}],
    ridge_lm:22, valley_lm:26, gutter_lm:28, barge_lm:20, apron_lm:22, changepitch_lm:24,
    screws_each:0.35, rivets_each:0.15, downpipe_ea:150,
    underlay:{'50':150,'75':210,'100':270},
    gutter:{ box125_lm:30, marley_classic_lm:35, marley_typhoon_lm:40,
             ext_bracket_box125_lm:6, ext_bracket_marley_lm:3 },
    extras:[]
  };
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  S.quote = S.quote || {};
  S.quote.gstRate = 15;
  S.quote.roofSeparate = {1:true,2:true,3:true,4:true,5:true};
  S.quote.roofExcluded = {};
  try { redrawAll(); } catch(e){}
  gotoTab('pricing');
}, GEOM);
await pg.waitForTimeout(2200);

// Sheet quantity shown on the main tab, and the areas behind it.
const sheetQty = () => pg.evaluate(() => {
  const inp = document.querySelector('#materialPriceTableWrap input[data-qty-key="sheets"]');
  return inp ? parseFloat(inp.value) : -1;
});
const areaOf = (idxs) => pg.evaluate((ix) => ix.reduce((s, i) => s + (_roofMeasForIdx(i).roofArea || 0), 0), idxs);

// ── 1. the material rows cover the group ─────────────────────────
await pg.evaluate(() => { _setPricingRoof(0); renderMaterialPriceTable(); });
await pg.waitForTimeout(400);
const aloneQty = await sheetQty();
const aloneArea = await areaOf([0]);
check('with nothing folded, the main tab sheets the main roof alone',
  aloneQty > 0 && Math.abs(aloneQty - aloneArea) <= Math.max(2, aloneArea * 0.03),
  aloneQty + ' m² of sheet vs ' + r1(aloneArea) + ' m² of roof');

await pg.evaluate(() => { _setRoofMode(1, 'folded'); _setRoofMode(2, 'folded'); _setRoofMode(5, 'folded'); });
await pg.waitForTimeout(900);
await pg.evaluate(() => { _setPricingRoof(0); renderMaterialPriceTable(); });
await pg.waitForTimeout(400);
const groupIdx = await pg.evaluate(() => _pricingRoofGroup(0));
const groupQty = await sheetQty();
const groupArea = await areaOf(groupIdx);
check('folding three roofs in puts them in the main group', groupIdx.length === 4, JSON.stringify(groupIdx));
check('THE FIX: the main tab now sheets the whole group, not the main roof alone',
  groupQty > aloneQty + 10 && Math.abs(groupQty - groupArea) <= Math.max(2, groupArea * 0.03),
  groupQty + ' m² of sheet vs ' + r1(groupArea) + ' m² across the group (was ' + aloneQty + ')');
const tileTxt = await pg.evaluate(() => {
  const bar = document.getElementById('pricingRoofSwitchBar');
  return bar ? bar.innerText.replace(/\s+/g, ' ') : '';
});
check('…and agrees with the area on the roof tile',
  new RegExp(String(Math.round(groupArea)).slice(0, 2)).test(tileTxt), tileTxt.slice(0, 80));
const lmGroup = await pg.evaluate(() => {
  const inp = document.querySelector('#materialPriceTableWrap input[data-qty-key="barge"]');
  return inp ? parseFloat(inp.value) : -1;
});
check('…and the flashings come from the group too', lmGroup > 0, lmGroup + ' lm of barge');

// ── 2. a quantity typed on one tab stays on that tab ─────────────
const sepIdx = await pg.evaluate(() => _pricingRoofTabIdxs().find(i => i !== 0));
const sepAuto = await pg.evaluate((i) => { _setPricingRoof(i); renderMaterialPriceTable(); return null; }, sepIdx)
  .then(sheetQty);
await pg.evaluate(() => { _setPricingRoof(0); renderMaterialPriceTable(); });
await pg.evaluate(() => _onMatOverride(_matOvKey('sheets', 0), 'qty', '999'));
await pg.waitForTimeout(300);
const mainAfter = await sheetQty();
check('typing a sheet quantity on the main tab is honoured there', mainAfter === 999, String(mainAfter));
await pg.evaluate((i) => { _setPricingRoof(i); renderMaterialPriceTable(); }, sepIdx);
await pg.waitForTimeout(300);
const sepAfter = await sheetQty();
check('THE FIX: the other roof’s tab keeps its own figure', sepAfter === sepAuto && sepAfter !== 999,
  'roof ' + (sepIdx + 1) + ' shows ' + sepAfter + ' (its own is ' + sepAuto + ')');
await pg.evaluate((i) => _onMatOverride(_matOvKey('sheets', i), 'qty', '55'), sepIdx);
await pg.waitForTimeout(300);
await pg.evaluate(() => { _setPricingRoof(0); renderMaterialPriceTable(); });
await pg.waitForTimeout(300);
check('…and a figure typed there does not write back over the main tab', (await sheetQty()) === 999,
  String(await sheetQty()));
const delSplit = await pg.evaluate((i) => {
  _deleteMatRow(_matOvKey('screws', 0));
  const mainHas = !!document.querySelector('#materialPriceTableWrap input[data-qty-key="screws"]');
  _setPricingRoof(i); renderMaterialPriceTable();
  const sepHas = !!document.querySelector('#materialPriceTableWrap input[data-qty-key="screws"]');
  _setPricingRoof(0); restoreDeletedMatRows();
  return { mainHas, sepHas };
}, sepIdx);
check('deleting a line on one tab leaves it on the other', !delSplit.mainHas && delSplit.sepHas, JSON.stringify(delSplit));
await pg.evaluate((i) => { _resetMatOverride(_matOvKey('sheets', 0)); _resetMatOverride(_matOvKey('sheets', i)); }, sepIdx);

// ── 3. a custom material line shows in the material total ────────
const totalShown = () => pg.evaluate(() => {
  const el = Array.from(document.querySelectorAll('#materialPriceTableWrap strong'))
    .find(s => /Materials|Total materials/.test(s.textContent));
  const box = el && el.parentElement; const span = box && box.querySelector('span[style*="font-size:18px"]');
  return span ? parseFloat(span.textContent.replace(/[^0-9.]/g, '')) : -1;
});
await pg.evaluate(() => { _setPricingRoof(0); renderMaterialPriceTable(); });
await pg.waitForTimeout(300);
const beforeCustom = await totalShown();
const matBefore = await pg.evaluate(() => S.materials);
await pg.evaluate(() => { _qAddCustom('material'); const rows = _qCustom('material'); rows[rows.length-1].desc = 'Material'; rows[rows.length-1].amount = 12000; renderMaterialPriceTable(); });
await pg.waitForTimeout(400);
const afterCustom = await totalShown();
const matAfter = await pg.evaluate(() => S.materials);
check('THE FIX: a $12,000 custom material line shows in the material total',
  Math.abs(afterCustom - beforeCustom - 12000) < 1, '$' + beforeCustom + ' → $' + afterCustom);
check('…without counting twice: the quote’s base material figure is unchanged (the line is its own item)',
  Math.abs(matAfter - matBefore) < 0.01, '$' + matBefore + ' vs $' + matAfter);
const inQuote = await pg.evaluate(() => { _syncQuoteBaseLineItems(); return (S.quote.lineItems||[]).some(x => x._custom && +x.unit === 12000); });
check('…and it reaches the quote as its own line', inQuote);

// ── 4. a plain wheel over another roof scrolls, it does not resize ─
await pg.evaluate(() => { gotoTab('roof'); DRAW.tool = 'select'; if (!DRAW.bgImg){ const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; DRAW.bgImg = c; } try { redrawAll(); } catch(e){} });
await pg.waitForTimeout(600);
const wheel = await pg.evaluate(() => {
  const other = DRAW.roofs.findIndex((r, i) => i !== DRAW.activeRoofIdx && r._displayedPoly && r._displayedPoly.length > 2);
  if (other < 0) return { other };
  const poly = DRAW.roofs[other]._displayedPoly;
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  const cv = document.getElementById('roofCanvas'), rect = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const t = getImgTransform();
  const sx = t ? cx * t.s + t.ix : cx, sy = t ? cy * t.s + t.iy : cy;
  const clientX = rect.left + sx * dpr * rect.width / cv.width, clientY = rect.top + sy * dpr * rect.height / cv.height;
  const before = DRAW.roofs[other].viewZoom, z0 = DRAW.zoom || 1;
  let prevented = false;
  onCanvasWheel({ deltaY: 100, ctrlKey: false, shiftKey: false, clientX, clientY, preventDefault(){ prevented = true; } });
  const after = DRAW.roofs[other].viewZoom, z1 = DRAW.zoom || 1;
  let preventedCtrl = false;
  onCanvasWheel({ deltaY: -100, ctrlKey: true, shiftKey: false, clientX, clientY, preventDefault(){ preventedCtrl = true; } });
  return { other, before, after, prevented, z0, z1, z2: DRAW.zoom, preventedCtrl };
});
check('the test found another roof under the pointer', wheel.other >= 0, JSON.stringify(wheel));
check('THE FIX: a plain wheel over it leaves that roof’s size alone and lets the page scroll',
  wheel.before === wheel.after && !wheel.prevented && wheel.z0 === wheel.z1, JSON.stringify(wheel));
check('…while Ctrl + wheel still zooms the whole drawing', wheel.preventedCtrl && wheel.z2 > wheel.z1, wheel.z1 + ' → ' + wheel.z2);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
