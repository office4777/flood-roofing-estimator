// "Run a complete workflow. Make sure all information and quantities are the
//  same in the canvas, the job pack, the quote, the customer selections, then
//  the job pack to suit the customer selections for the order. Make sure
//  everything relates and works."
//
// Every surface in this app measures the same building, and each one had
// grown its own way of counting it. This suite walks one job end to end and
// holds the surfaces to each other:
//
//   drawing → job pack → priced material → quote → customer selections → order
//
// Four things it found, each of which cost real money or real material:
//
//   1. Loading a roof that carried no penetrations array left the PREVIOUS
//      roof's in DRAW, and the next sync wrote it on for good. Visit the main
//      roof on the way past and it adopted the lean-to's flues — priced twice,
//      and wrong on disk, not just on screen.
//   2. The base material charged the drawn gutter metres whatever the job pack
//      said. A pack reading "No Gutter required" still carried a gutter's worth
//      of steel, and a customer who then chose a gutter on page 4 paid for it
//      twice — once buried in the base, once as the add-on.
//   3. Where a lean-to abuts the house they share one barge. The cut list has
//      always known that and drops the duplicate; the pricing summed each roof
//      separately and charged it twice.
//   4. The customer could buy 5-Rib in Zincalume 0.55 with a box gutter, be
//      charged for all four, and the order still went to the merchant as
//      Corrugate Colorsteel 0.40 with no spouting.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-flashlm.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const r2 = v => Math.round(v * 100) / 100;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1600,height:1100} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2800);
await pg.evaluate((g) => {
  S.settings = S.settings || {};
  S.settings.price_book = { list_prices:false,
    sheets:[{product:'0.40g Colorsteel Maxam',unit:'m2',price:26.84},
            {product:'0.55g Colorsteel Maxam',unit:'m2',price:32.74},
            {product:'0.40g Zincalume',unit:'m2',price:18.06}],
    ridge_lm:21.97, valley_lm:19.70, gutter_lm:16.37, barge_lm:17.87, apron_lm:16.10,
    changepitch_lm:21.48, screws_each:0.26, rivets_each:0.08, downpipe_ea:150,
    underlay:{'50':256.75,'75':385.13,'100':513.50}, aquaseal:{no1:13.36},
    gutter:{ box125_lm:19.89, ext_bracket_box125_lm:6 }, extras:[] };
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.penetrations = (g.penetrations||[]).map(p => Object.assign({}, p,
    { type:'penetration', sizeLabel:p.size }));
  // Roofs restored WITHOUT a penetrations array — an older save, which is
  // exactly the shape that used to leak.
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.roofs[0].name = 'Main Roof';
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  S.quote = S.quote || {}; S.quote.gstRate = 15; S.quote.scaffoldBase = 4000;
  try { redrawAll(); } catch(e){}
  gotoTab('roof');
}, GEOM);
await pg.waitForTimeout(1800);

// ── 1. one drawing, counted once ───────────────────────────────────
const pens = await pg.evaluate(() => {
  const owned = _penAllOwned();
  // Walk every roof the way the pricing tab does, twice, then re-read.
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < DRAW.roofs.length; i++) _roofMeasForIdx(i);
  return { drawn: owned.length,
           perRoof: DRAW.roofs.map((r, i) => _roofMeasForIdx(i).penetrations || 0),
           stored: DRAW.roofs.map(r => (r.penetrations||[]).length),
           afterWalk: _penAllOwned().length };
});
check('the job has exactly the penetrations that were drawn on it',
  pens.drawn === 2, pens.drawn + ' found');
check('…and walking every roof does not multiply them',
  pens.afterWalk === 2, pens.afterWalk + ' after two passes');
check('…each one counted on exactly one roof',
  pens.perRoof.reduce((a,c) => a+c, 0) === 2, JSON.stringify(pens.perRoof));
check('…and no roof has quietly adopted another roof’s',
  pens.stored.reduce((a,c) => a+c, 0) === 2, JSON.stringify(pens.stored));

// ── 2. the drawing and the cut lists agree ─────────────────────────
await pg.evaluate(() => { gotoTab('materials'); });
await pg.waitForTimeout(2600);
const geom = await pg.evaluate(() => {
  const d = _matDrawTotals();
  const cuts = {};
  _MAT_FLASHING_SPECS.forEach(s => {
    const c = _matBuildCutList(s.key, s.waste);
    if (c.pieceCount) cuts[s.key] = { pcs:c.pieceCount, lm:c.totalLm };
  });
  const bargeCut = Object.keys(cuts).filter(k => /^barge/.test(k))
    .reduce((t,k) => t + cuts[k].lm, 0);
  return { drawnBarge:d.totals.barge, bargeCut, roofArea:d.roofArea,
           ridgeDrawn:d.totals.ridge, ridgeCut:(cuts.ridgehip||{}).lm || 0 };
});
check('a barge shared by two roofs is one flashing, not two',
  Math.abs(geom.drawnBarge - 47.99) < 0.05, r2(geom.drawnBarge) + ' lm');
check('…so the priced metres and the ordered metres are within a stick',
  Math.abs(geom.drawnBarge - geom.bargeCut) < 8,
  r2(geom.drawnBarge) + ' lm counted vs ' + r2(geom.bargeCut) + ' lm on the cut list');
check('…and the ordered length is never SHORT of what is drawn',
  geom.bargeCut >= geom.drawnBarge,
  r2(geom.bargeCut) + ' ordered vs ' + r2(geom.drawnBarge) + ' drawn');
check('the ridge cut list likewise covers the drawn ridge',
  geom.ridgeCut >= geom.ridgeDrawn,
  r2(geom.ridgeCut) + ' ordered vs ' + r2(geom.ridgeDrawn) + ' drawn');

// ── 3. nothing is priced that nobody orders ────────────────────────
const noGutter = await pg.evaluate(() => {
  localStorage.setItem('fr_jp_gutter_include', '0');
  const sel = document.getElementById('matGutter'); if (sel) sel.value = 'none';
  renderMaterialsCutLists();
  const rows = _buildMaterialPriceRows();
  return { onJob:_gutterOnJob(), priced:!!rows.find(r => r.key === 'gutter'),
           drawnGutterLm:_matDrawTotals().totals.gutter,
           ordered:_matBuildCutList('gutter', 0).pieceCount };
});
check('with no gutter on the job, the drawing still has gutter lines',
  noGutter.drawnGutterLm > 40, r2(noGutter.drawnGutterLm) + ' lm drawn');
check('…the job pack orders none of it', noGutter.ordered === 0,
  noGutter.ordered + ' pieces');
check('…and the material price charges for none of it', !noGutter.priced,
  noGutter.priced ? 'still charged' : 'not charged');

// ── 4. the customer's selections become the order ──────────────────
await pg.evaluate(() => { gotoTab('pricing'); });
await pg.waitForTimeout(1600);
await pg.evaluate(() => { try { _setPricingRoof(0); calcLabour(); _syncQuoteBaseLineItems(); } catch(e){} });
await pg.waitForTimeout(900);
await pg.evaluate(() => {
  gotoTab('quote');
  S.quote.proposalOptions = { profile:'5rib', steelGrade:'zincalume',
    steelThickness:'55', gutterType:'box125', gutterBracket:'external', downpipes:'yes' };
  try { calcLabour(); _syncQuoteBaseLineItems(); refreshQuoteProposal(); } catch(e){}
});
await pg.waitForTimeout(2000);
const sold = await pg.evaluate(() => ({
  changes:_qpSelectionChanges().map(c => c.label),
  base:_selMaterialBase(),
}));
check('the customer is charged for the 5-Rib upgrade',
  sold.changes.some(l => /5-Rib/.test(l)), sold.changes.join(' | '));
check('…and for the gutter they chose',
  sold.changes.some(l => /Box Gutter/i.test(l)), sold.changes.join(' | '));

await pg.evaluate(() => { gotoTab('materials'); });
await pg.waitForTimeout(2600);
const order = await pg.evaluate(() => ({
  profile:(document.getElementById('matProfile')||{}).value,
  grade:(document.getElementById('matGrade')||{}).value,
  thickness:(document.getElementById('matThickness')||{}).value,
  gutter:(document.getElementById('matGutter')||{}).value,
  gutterOn:_gutterOnJob(),
  gutterPriced:!!_buildMaterialPriceRows().find(r => r.key === 'gutter'),
  gutterOrdered:_matBuildCutList('gutter', 0).pieceCount,
}));
check('the merchant is sent the profile the customer bought',
  order.profile === '5-Rib', order.profile);
check('…the grade they bought', /zincalume/i.test(order.grade), order.grade);
check('…the gauge that profile is supplied in', order.thickness === '0.55g', order.thickness);
check('…and the gutter they bought', /box/i.test(order.gutter), order.gutter);
check('…with the gutter section switched on for the pack', order.gutterOn);
check('…the gutter actually on the cut list', order.gutterOrdered > 0,
  order.gutterOrdered + ' pieces');
check('…and now charged in the material, since it is being bought',
  order.gutterPriced);

// Choosing "no gutter" again takes it back off both.
const undone = await pg.evaluate(() => {
  S.quote.proposalOptions.gutterType = 'none';
  renderMaterialsCutLists();
  return { sel:(document.getElementById('matGutter')||{}).value,
           on:_gutterOnJob(),
           priced:!!_buildMaterialPriceRows().find(r => r.key === 'gutter'),
           ordered:_matBuildCutList('gutter', 0).pieceCount };
});
check('changing back to no gutter takes it off the order',
  undone.sel === 'none' && !undone.on && undone.ordered === 0, JSON.stringify(undone));
check('…and off the price too', !undone.priced, JSON.stringify(undone));

// A grade a company added itself must still reach the merchant.
const custom = await pg.evaluate(() => {
  S.settings.selectables = {
    grades:[{id:'maxam',name:'Colorsteel® MAXAM',pct:0,base:true},
            {id:'endura',name:'ColorCote AlumiGard',pct:0.11}],
    profiles:_defaultSelectables().profiles, gutters:_defaultSelectables().gutters };
  S.quote.proposalOptions.steelGrade = 'endura';
  renderMaterialsCutLists();
  const v = (document.getElementById('matGrade')||{}).value;
  delete S.settings.selectables;
  return v;
});
check('a grade the company added itself still reaches the order',
  /alumigard/i.test(custom), custom);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
