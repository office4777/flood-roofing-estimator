// The owner, 2026-09-28, on the Map Roof tab:
//   "Move the roof square meter size of the roof that's just been drawn to
//    just below the canvas in a box called roof area … next to that a box
//    called flashings, the combined linear meter of all flashings — ridge,
//    hip, valley, barge, change of pitch, basically every line except for
//    gutter lines … another box called gutter … if there are multiple roofs
//    a toggle to change the view of the different roofs, by default view all
//    roofs … a clean single row so the user doesn't need to scroll down."
//
// So this suite pins: where the row sits (under the canvas, one line), what
// each box counts (and that the gutter is in exactly one of them), the roof
// picker's default and its filtering, and that picking a roof changes the
// FIGURES only — never which roof is being drawn.
//
// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1400, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => {
  localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1');
  localStorage.setItem('fr_settings','null');
  localStorage.setItem('fr_user', JSON.stringify({ email:'sam@acmeroofing.co.nz', name:'Sam' }));
  localStorage.setItem('fr_company', JSON.stringify({ id:'c1', name:'Acme Roofing Ltd', role:'owner' }));
});
await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2600);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); gotoTab('roof'); });

// Nothing drawn yet: no row, and the canvas keeps its full height.
const empty = await pg.evaluate(() => ({
  shown: getComputedStyle(document.getElementById('roofStatsBar')).display !== 'none',
  h: getComputedStyle(document.documentElement).getPropertyValue('--roofstats-h').trim(),
}));
check('with nothing drawn there is no figures row, and the canvas gives up no height',
  !empty.shown && (empty.h === '' || empty.h === '0px'), JSON.stringify(empty));

// One roof: 600 × 300 image px at 0.02 m/px = 12 m × 6 m. Flat, so the area
// along the pitch is the plan area — 72 m² exactly, nothing to round.
await pg.evaluate(() => {
  clearAll(true);
  setTool('outline');
  DRAW.currentPts = [[200,300],[800,300],[800,600],[200,600]];
  finishCurrent();
  DRAW.scaleMetresPerPx = 0.02;
  DRAW.calPitch = 0.0001;              // flat: pitch factor 1
  autoGenerateRoof('gable');
  updateMeasTotals();
});
await pg.waitForTimeout(400);
{ const skip = pg.getByRole('button', { name: 'Skip for now' }); if (await skip.count()) await skip.first().click(); }

const one = await pg.evaluate(() => {
  const bar = document.getElementById('roofStatsBar');
  const boxes = [...bar.querySelectorAll('.rs-box')];
  const lines = DRAW.lines.filter(l => parseFloat(l.measM) > 0);
  const sum = (f) => lines.filter(f).reduce((s,l) => s + parseFloat(l.measM), 0);
  return {
    labels: boxes.map(x => x.querySelector('.rs-lbl').textContent.trim()),
    vals:   boxes.map(x => x.querySelector('.rs-val').textContent.replace(/\s+/g,' ').trim()),
    flashWant:  sum(l => l.type !== 'gutter').toFixed(1),
    gutterWant: sum(l => l.type === 'gutter').toFixed(1),
    types: [...new Set(lines.map(l => l.type))].sort(),
    oldBox: !!document.getElementById('roofAreaBox'),
    chips: bar.querySelectorAll('.rs-chip').length,
  };
});
check('the three boxes are Roof area, Flashings and Gutter, in that order',
  one.labels.join('|') === 'Roof area|Flashings|Gutter', one.labels.join('|'));
check('Roof area is the area along the pitch, in m²', one.vals[0] === '72.0 m²', one.vals[0]);
check('Flashings is every measured line except the gutter, in lineal metres',
  one.vals[1] === one.flashWant + ' m' && parseFloat(one.flashWant) > 0,
  one.vals[1] + ' want ' + one.flashWant);
check('Gutter is the gutter runs on their own', one.vals[2] === one.gutterWant + ' m' && parseFloat(one.gutterWant) > 0,
  one.vals[2] + ' want ' + one.gutterWant);
check('…so the gutter is counted in exactly one box',
  Math.abs(parseFloat(one.vals[1]) + parseFloat(one.vals[2]) - (parseFloat(one.flashWant) + parseFloat(one.gutterWant))) < 0.05 &&
  parseFloat(one.vals[1]) !== parseFloat(one.flashWant) + parseFloat(one.gutterWant),
  JSON.stringify(one.vals));
check('a gable really did draw both kinds of line', one.types.includes('gutter') && one.types.length > 1, one.types.join(','));
check('the roof area no longer sits in the card head', !one.oldBox);
check('one roof shows no picker', one.chips === 0, String(one.chips));

// Where it sits: under the canvas, on one line, and the canvas gave back
// exactly what the row takes.
const place = await pg.evaluate(() => {
  // The app puts the roof card at the top of the screen once a picture
  // lands (_afterAerialPlaced), which is how a roofer works: canvas filling
  // the window. The row has to be in view from there without scrolling.
  document.getElementById('roofPlanCard').scrollIntoView({ block:'start' });
  const bar = document.getElementById('roofStatsBar').getBoundingClientRect();
  const cv = document.getElementById('canvasWrap').getBoundingClientRect();
  const tops = [...document.querySelectorAll('#roofStatsBar .rs-box')].map(x => Math.round(x.getBoundingClientRect().top));
  return { barTop: Math.round(bar.top), barH: Math.round(bar.height), cvBottom: Math.round(cv.bottom), wrapH: Math.round(cv.height),
           bottomOfRow: Math.round(bar.bottom), viewport: window.innerHeight,
           sameRow: new Set(tops).size === 1,
           gaveUp: getComputedStyle(document.documentElement).getPropertyValue('--roofstats-h').trim() };
});
check('the row is directly under the canvas', place.barTop >= place.cvBottom - 1 && place.barTop - place.cvBottom < 24,
  JSON.stringify({ barTop: place.barTop, cvBottom: place.cvBottom }));
check('the boxes are one clean row, not stacked', place.sameRow && place.barH < 90, JSON.stringify(place));
// The row must cost the page NOTHING: the canvas gives back what the row
// takes, so the row ends where the canvas used to and nobody scrolls further
// than they did before. (100vh - 190px is the canvas's own allowance.)
check('the row costs no extra height — canvas + row fit where the canvas alone used to',
  place.wrapH + place.barH <= place.viewport - 190 + 2,
  JSON.stringify({ canvas: place.wrapH, row: place.barH, budget: place.viewport - 190 }));
check('the canvas gave up exactly the row’s height', /^\d+px$/.test(place.gaveUp) && parseInt(place.gaveUp, 10) === place.barH,
  place.gaveUp + ' for a ' + place.barH + 'px row');

// A resized window writes an inline height on the canvas wrap, which beats
// the stylesheet — the row's space has to come off there too, or the canvas
// takes it and the row lands on top of whatever is below.
await pg.setViewportSize({ width: 1280, height: 820 });
await pg.waitForTimeout(400);
const resized = await pg.evaluate(() => {
  const wrap = document.getElementById('canvasWrap');
  const bar = document.getElementById('roofStatsBar');
  return { wrapH: Math.round(wrap.getBoundingClientRect().height),
           barH: Math.round(bar.getBoundingClientRect().height),
           flexH: Math.round(wrap.parentElement.getBoundingClientRect().height),
           viewport: window.innerHeight };
});
check('after a window resize the canvas still gives the row its space',
  resized.wrapH + resized.barH <= resized.flexH + 2 && resized.barH > 0,
  JSON.stringify(resized));
await pg.setViewportSize({ width: 1400, height: 950 });
await pg.waitForTimeout(300);

// A second roof: the picker appears, starts on All roofs, and adds up.
await pg.evaluate(() => {
  _addAndSwitchToNewRoof();
  setTool('outline');
  DRAW.currentPts = [[900,300],[1200,300],[1200,500],[900,500]];
  finishCurrent();
  DRAW.calPitch = 0.0001;
  autoGenerateRoof('gable');
  updateMeasTotals();
});
await pg.waitForTimeout(400);
const two = await pg.evaluate(() => {
  const bar = document.getElementById('roofStatsBar');
  const chips = [...bar.querySelectorAll('.rs-chip')];
  const roofs = _matBasicCollectRoofs();
  return {
    roofs: roofs.length,
    chipText: chips.map(c => c.textContent.trim()),
    on: chips.filter(c => c.classList.contains('on')).map(c => c.textContent.trim()),
    area: bar.querySelectorAll('.rs-val')[0].textContent.trim(),
    areaWant: roofs.reduce((s,r) => s + r.areaM2, 0).toFixed(1),
    firstArea: roofs[0].areaM2.toFixed(1),
    activeBefore: DRAW.activeRoofIdx,
  };
});
check('a second roof brings the picker, All roofs first', two.roofs === 2 && two.chipText[0] === 'All roofs' && two.chipText.length === 3,
  two.chipText.join('|'));
check('…and it starts on All roofs', two.on.join('|') === 'All roofs', two.on.join('|'));
check('All roofs adds every roof up', two.area === two.areaWant + ' m²', two.area + ' want ' + two.areaWant);

await pg.evaluate(() => _roofStatsPick(0));
await pg.waitForTimeout(150);
const picked = await pg.evaluate(() => ({
  area: document.querySelectorAll('#roofStatsBar .rs-val')[0].textContent.trim(),
  on: [...document.querySelectorAll('#roofStatsBar .rs-chip.on')].map(c => c.textContent.trim()).join('|'),
  active: DRAW.activeRoofIdx,
  roofsStillThere: (DRAW.roofs || []).length,
}));
check('picking one roof shows that roof’s own area', picked.area === two.firstArea + ' m²', picked.area + ' want ' + two.firstArea);
check('…and the picked chip is the lit one', picked.on !== 'All roofs' && picked.on.length > 0, picked.on);
check('…while the drawing is untouched: same roof active, both roofs still on the canvas',
  picked.active === two.activeBefore && picked.roofsStillThere === 2, JSON.stringify(picked));

// Clearing the job takes the row away again.
await pg.evaluate(() => { clearAll(true); updateMeasTotals(); });
await pg.waitForTimeout(250);
const cleared = await pg.evaluate(() => getComputedStyle(document.getElementById('roofStatsBar')).display);
check('clearing the drawing hides the row', cleared === 'none', cleared);

check('nothing threw along the way', errs.length === 0, errs.join(' | '));

await b.close();
const bad = results.filter(r => !r).length;
console.log(bad ? ('FAILED ' + bad + '/' + results.length) : ('All ' + results.length + ' passed'));
process.exit(bad ? 1 : 0);
