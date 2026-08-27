// "Can you please add the roof m2 (area) inside each of the roof buttons."
//
// The Pricing tab's roof buttons said which roof and whether it was the base or
// an optional extra, but not how big it is — which is the first thing you want
// when you are deciding what to charge for it.
//
// Two things here are worth guarding beyond "a number appears". The area has to
// come from the same collector the Materials tab uses, or the two screens quote
// different sizes for one building. And a tab that covers more than one roof —
// the main roof plus anything folded into it — has to total them, because the
// price on that tab covers all of them.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const G = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report20.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2600);

await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx;
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r, {
    outline: r.outline.map(p => p.slice()),
    lines: r.lines.map(l => Object.assign({}, l, { pts: l.pts.map(p => p.slice()) })),
    outlineDone: true,
  }));
  DRAW.activeRoofIdx = -1; DRAW.showAllRoofs = true;
  _loadRoofToCurrent(0);
  try { gotoTab('quote'); } catch(e){}
  try { _renderPricingRoofSwitchBar(); } catch(e){}
}, G);
await pg.waitForTimeout(400);

const read = () => pg.evaluate(() => {
  var bar = document.getElementById('pricingRoofSwitchBar');
  return Array.from(bar ? bar.querySelectorAll('.pr-roof-btn') : []).map(function(b){
    var a = b.querySelector('.pr-roof-area');
    return { name: (b.querySelector('.pr-roof-nm')||{}).textContent,
             area: a ? a.textContent : null };
  });
});
let btns = await read();
check('every roof button is drawn', btns.length === 4, JSON.stringify(btns.map(b => b.name)));
check('every one of them carries an area', btns.every(b => b.area && /m²$/.test(b.area)),
  JSON.stringify(btns));

// It must be the SAME number the Materials tab shows, not a second calculation.
const fromCollector = await pg.evaluate(() =>
  _matBasicCollectRoofs().map(r => ({ idx: r.idx, a: +(+r.areaM2).toFixed(1) })));
check('the areas match the collector the Materials tab uses',
  btns.every((b, i) => b.area === fromCollector[i].a.toFixed(1) + ' m²'),
  JSON.stringify(btns.map(b => b.area)) + ' vs ' + JSON.stringify(fromCollector.map(r => r.a)));

// The reported job is 4 roofs at 0/0/0/20 — with the 15° default in play, none
// of these is a plan area, and a real one is well clear of zero.
check('the main roof reads a believable size',
  parseFloat(btns[0].area) > 80 && parseFloat(btns[0].area) < 400, btns[0].area);
check('the small roofs read smaller than the main one',
  parseFloat(btns[1].area) < parseFloat(btns[0].area) &&
  parseFloat(btns[2].area) < parseFloat(btns[0].area),
  JSON.stringify(btns.map(b => b.area)));

// ── a tab that covers more than one roof totals them ───────────────
const folded = await pg.evaluate(() => {
  // Fold Roof 2 into the main roof: its own tab goes, and the main tab now
  // covers both — so the area on it has to cover both too.
  S.quote = S.quote || {};
  _setRoofMode(1, 'folded');          // roofSeparate[1] = false — the real switch
  _renderPricingRoofSwitchBar();
  var bar = document.getElementById('pricingRoofSwitchBar');
  var btn = bar.querySelector('.pr-roof-btn');
  var areas = _matBasicCollectRoofs().reduce(function(m, r){ m[r.idx] = +r.areaM2 || 0; return m; }, {});
  return { shown: (btn.querySelector('.pr-roof-area')||{}).textContent,
           tabs: bar.querySelectorAll('.pr-roof-btn').length,
           want: (areas[0] + areas[1]).toFixed(1) + ' m²',
           mainAlone: areas[0].toFixed(1) + ' m²' };
});
check('folding a roof removes its own tab', folded.tabs === 3, folded.tabs + ' tabs');
check('…and the tab it folded into totals both roofs',
  folded.shown === folded.want && folded.shown !== folded.mainAlone,
  folded.shown + ' shown, wanted ' + folded.want + ' (main alone would be ' + folded.mainAlone + ')');

// ── an uncalibrated job has no area, and must not claim 0.0 ────────
const uncal = await pg.evaluate(() => {
  DRAW.scaleMetresPerPx = 0;
  _renderPricingRoofSwitchBar();
  var bar = document.getElementById('pricingRoofSwitchBar');
  return Array.from(bar.querySelectorAll('.pr-roof-btn'))
    .map(function(b){ return !!b.querySelector('.pr-roof-area'); });
});
check('with no scale set, no area is shown at all',
  uncal.every(x => x === false), JSON.stringify(uncal) + ' — "0.0 m²" reads as a broken drawing');

check('no page errors', errs.length === 0, errs.join(' | '));

const fails = results.filter(x => !x).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
await b.close();
process.exit(fails ? 1 : 0);
