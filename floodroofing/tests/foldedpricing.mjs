// "I've got Roof 2 as a compulsory part of the main roof, so I want to combine
//  the main roof and Roof 2 in the pricing tab to price them together, not
//  separately, to speed up the pricing time."
//
// A roof marked "Part of main" was never a separate price — it always folded
// into the base. But the Pricing tab still gave it its own tab, its own
// material table and its own labour hours, so the office priced one building
// two or three times over. That is the slow part of quoting a house with a
// lean-to on it.
//
// A tab now covers a GROUP: the main roof plus everything folded into it. The
// danger in that is arithmetic, not layout — the base line items used to add
// each folded roof's materials and labour on top of the main roof's, so if the
// main tab now takes off the whole group and the base still adds each roof
// again, the lean-to is billed twice. This suite is mostly about that.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const r2 = v => Math.round(v * 100) / 100;

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
  // Every extra roof its own optional extra — the shipped default.
  S.quote.roofSeparate = {1:true,2:true,3:true,4:true,5:true};
  S.quote.roofExcluded = {};
  try { redrawAll(); } catch(e){}
  gotoTab('pricing');
}, GEOM);
await pg.waitForTimeout(2200);

// ── with nothing folded, every roof keeps its tab ──────────────────
let v = await pg.evaluate(() => ({
  tabs: _pricingRoofTabIdxs(), group0: _pricingRoofGroup(0),
  extras: _pricingRoofGroupExtras(0), n: _pricingRoofCount(),
}));
check('with every extra roof a separate price, every roof keeps its own tab',
  v.tabs.length === v.n, JSON.stringify(v.tabs));
check('…and the main roof’s group is just itself', v.group0.length === 1 &&
  v.extras.length === 0, JSON.stringify(v));

// ── fold Roof 2 in ─────────────────────────────────────────────────
// Let the pricing panel seed itself first — scaffold defaults and labour
// hours only exist once it has run. Snapshotting before that made the "after"
// look like an increase that was really just initialisation.
await pg.evaluate(() => { _setPricingRoof(0); calcLabour(); _syncQuoteBaseLineItems(); });
await pg.waitForTimeout(900);
const before = await pg.evaluate(() => {
  _syncQuoteBaseLineItems();
  const li = (S.quote.lineItems||[]).reduce((m,x) => (m[x.desc] = +x.unit, m), {});
  return { mat: li.Materials || 0, lab: li.Labour || 0, scaff: li.Scaffolding || 0,
           sub: quoteSubtotal(),
           mainAlone: _materialsCostForRoofIdx(0), roof1Alone: _materialsCostForRoofIdx(1) };
});
await pg.evaluate(() => { _setRoofMode(1, 'folded'); });
await pg.waitForTimeout(1200);

v = await pg.evaluate(() => ({
  tabs: _pricingRoofTabIdxs(), group0: _pricingRoofGroup(0),
  extras: _pricingRoofGroupExtras(0), name1: _pricingRoofName(1),
}));
check('folding Roof 2 into the main roof takes away its tab',
  v.tabs.indexOf(1) < 0, JSON.stringify(v.tabs));
check('…and puts it in the main roof’s group', v.group0.indexOf(1) >= 0,
  JSON.stringify(v.group0));
check('…so the main tab says what it now covers',
  v.extras.indexOf(v.name1) >= 0, v.extras.join(', '));

// Standing on the folded roof's tab when it folds must not strand you.
const stranded = await pg.evaluate(() => {
  _setPricingRoof(1);
  return { idx: _pricingRoofIdx(), tabs: _pricingRoofTabIdxs() };
});
check('…and asking for the folded roof’s tab lands on the one that covers it',
  stranded.idx === 0, JSON.stringify(stranded));

// ── the arithmetic: priced once, not twice ─────────────────────────
const after = await pg.evaluate(() => {
  _syncQuoteBaseLineItems();
  const li = (S.quote.lineItems||[]).reduce((m,x) => (m[x.desc] = +x.unit, m), {});
  return { mat: li.Materials || 0, lab: li.Labour || 0, scaff: li.Scaffolding || 0,
           sub: quoteSubtotal(),
           // What the main tab's own material take-off now covers.
           groupMat: _materialsCostForRoofIdx(0),
           roof1Mat: _materialsCostForRoofIdx(1) };
});
check('the main roof’s material take-off now covers the group',
  after.groupMat > before.mat * 0.99, '$' + r2(after.groupMat) + ' vs $' + r2(before.mat));
check('…and the base bills materials once, not the group plus Roof 2 again',
  Math.abs(after.mat - after.groupMat) < 0.02,
  '$' + r2(after.mat) + ' billed vs $' + r2(after.groupMat) + ' taken off');

// The base necessarily GROWS when a roof folds in — that money moves out of
// the roof's optional-extra price and into the main one. What must not happen
// is it landing in both. So the test is that the group costs what the two
// roofs cost, and no more.
//
// Taken off together it can come to slightly LESS than the two apart: lineal
// metres round up to a full length per take-off, so two roofs priced
// separately each buy their own part-length of the same flashing.
const apart = before.mainAlone + before.roof1Alone;
check('…the group costs what the two roofs cost, priced together',
  after.groupMat <= apart + 0.02 && after.groupMat > apart * 0.9,
  '$' + r2(after.groupMat) + ' together vs $' + r2(apart) + ' apart');
check('…and it is never the two roofs plus the group on top',
  after.mat < apart + after.groupMat - 0.02,
  '$' + r2(after.mat) + ' billed; double would be $' + r2(apart + after.groupMat));

// Scaffolding is per BUILDING, and deliberately still counted per roof — a
// lean-to that needs its own edge protection needs it either way. Folding
// moves it from the roof's optional-extra price onto the base, but it must
// still be charged.
check('scaffolding for the folded roof is still charged, on the base now',
  after.scaff >= before.scaff && after.scaff > 0,
  '$' + r2(after.scaff) + ' after vs $' + r2(before.scaff) + ' before');
const scEdit = await pg.evaluate(() => {
  const wrap = document.getElementById('scaffoldWrap');
  const has = !!(wrap && wrap.querySelector('[onchange*="_updateFoldedScaffold"]'));
  const was = _roofScaffold(1).price;
  _updateFoldedScaffold(1, 'price', was + 500);
  _syncQuoteBaseLineItems();
  const li = (S.quote.lineItems||[]).reduce((m,x) => (m[x.desc] = +x.unit, m), {});
  _updateFoldedScaffold(1, 'price', was);
  return { has, was, after: li.Scaffolding || 0 };
});
check('…and it is editable on the main tab, since Roof 2 has no tab any more',
  scEdit.has, JSON.stringify(scEdit));
check('…with the edit reaching the price', scEdit.after > after.scaff + 400,
  '$' + r2(scEdit.after) + ' after +500');

// ── labour covers the group ────────────────────────────────────────
const lab = await pg.evaluate(() => {
  const g = _labourCalcAutoQty(0);
  _setRoofMode(1, 'separate');
  const alone = _labourCalcAutoQty(0);
  const r1 = _labourCalcAutoQty(1);
  _setRoofMode(1, 'folded');
  return { group: g, alone, r1 };
});
check('the main roof’s labour drivers now include the folded roof’s area',
  lab.group.roof > lab.alone.roof + 1,
  lab.group.roof + ' m² grouped vs ' + lab.alone.roof + ' alone (+' + lab.r1.roof + ')');
check('…adding up to the two roofs together',
  Math.abs(lab.group.roof - (lab.alone.roof + lab.r1.roof)) < 0.2,
  lab.group.roof + ' vs ' + r2(lab.alone.roof + lab.r1.roof));

// ── the map lights up the whole group ──────────────────────────────
await pg.evaluate(() => { _setPricingRoof(0); });
await pg.waitForTimeout(800);
const mapv = await pg.evaluate(() => {
  const svg = document.querySelector('#pricingRoofMap svg');
  if (!svg) return { missing: true };
  const fills = [...svg.querySelectorAll('polygon')].map(p => p.getAttribute('fill'));
  return { bright: fills.filter(f => f === '#fde68a').length,
           banner: (document.getElementById('pricingRoofMap').innerText||'').split('\n')[0] };
});
check('both roofs in the group light up on the pricing map',
  mapv.bright === 2, JSON.stringify(mapv));
check('…and the banner names them both',
  /\+/.test(mapv.banner || ''), mapv.banner);

// ── unfolding puts everything back ─────────────────────────────────
const undo = await pg.evaluate(() => {
  _setRoofMode(1, 'separate');
  _syncQuoteBaseLineItems();
  const li = (S.quote.lineItems||[]).reduce((m,x) => (m[x.desc] = +x.unit, m), {});
  return { tabs: _pricingRoofTabIdxs(), group0: _pricingRoofGroup(0),
           mat: li.Materials || 0, sub: quoteSubtotal() };
});
check('setting it back to a separate extra restores its own tab',
  undo.tabs.indexOf(1) >= 0 && undo.group0.length === 1, JSON.stringify(undo.tabs));
check('…and the base goes back to the main roof alone',
  Math.abs(undo.mat - before.mat) < 0.02, '$' + r2(undo.mat) + ' vs $' + r2(before.mat));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
