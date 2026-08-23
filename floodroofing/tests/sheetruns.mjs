// Every ridge slopes two ways, so every ridge earns a sheet measure on BOTH
// sides — perpendicular to the ridge, straight down to the gutter line.
//
// On a hip-and-valley roof most of them went missing. The cause was one line:
// the run's source point was the gutter's own midpoint clamped onto the ridge.
// A gutter that runs past both ridge ends — every hip end, and any ridge
// sitting off-centre over a long eave — has its midpoint outside the ridge
// span, so the clamp parked the source exactly ON a ridge end. That is where
// the hips converge, so the drop grazed a hip and the run was thrown away.
//
// The fix is the centre of the ridge/gutter OVERLAP. The suite holds both
// halves of that: the runs that should now appear, and the phantom run across
// a valley that must still not.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2500);

// Roofs are built in image pixels at 1 px = 1 cm, flat pitch, so a label
// reads back as plain metres and the arithmetic stays checkable by eye.
await pg.evaluate(() => {
  window.__buildRoof = function(outline, lines){
    DRAW.outline = outline;
    DRAW.lines = lines.map(function(l){
      return { type:l[0], pts:[l[1].slice(), l[2].slice()],
               label:'', lengthM:'', measM:null, sheetLengthM:null };
    });
    DRAW.scaleMetresPerPx = 0.01;
    DRAW.calPitch = 0;
    DRAW.roofs = []; DRAW.activeRoofIdx = 0;
    DRAW.sheetOverrides = {}; DRAW.sheetLabelOffsets = {}; DRAW.manualSheetMeasures = [];
    redrawAll();
    return (window._lastSheetDims || []).map(function(d){
      return { label:d.label, x:Math.round(d.lblImgX), y:Math.round(d.lblImgY) };
    });
  };
});
const build = (outline, lines) => pg.evaluate(a => window.__buildRoof(a[0], a[1]), [outline, lines]);
const labels = rs => rs.map(r => r.label).sort();

// The four eaves of a rectangle, as gutters.
const box = (w,h) => [['gutter',[0,0],[w,0]], ['gutter',[w,0],[w,h]],
                      ['gutter',[w,h],[0,h]], ['gutter',[0,h],[0,0]]];

// ── A. Plain hipped rectangle, 20 × 10 m ──────────────────────────
let r = await build([[0,0],[2000,0],[2000,1000],[0,1000]],
  box(2000,1000).concat([
    ['hip',[0,0],[500,500]], ['hip',[2000,0],[1500,500]],
    ['hip',[0,1000],[500,500]], ['hip',[2000,1000],[1500,500]],
    ['ridge',[500,500],[1500,500]]]));
check('a hipped rectangle measures both sides of its ridge',
  labels(r).join(',') === '5.00m,5.00m', labels(r).join(', ') || '(none)');
check('…one label above the ridge, one below',
  r.length === 2 && r.some(d => d.y < 500) && r.some(d => d.y > 500),
  r.map(d => d.label+'@y'+d.y).join(', '));

// ── B. Same roof, ridge pushed off-centre along its own axis ──────
// The gutters still run the full 20 m, so their midpoints now sit outside
// the ridge span. This is the case that produced nothing at all.
r = await build([[0,0],[2000,0],[2000,1000],[0,1000]],
  box(2000,1000).concat([
    ['hip',[0,0],[300,500]], ['hip',[2000,0],[800,500]],
    ['hip',[0,1000],[300,500]], ['hip',[2000,1000],[800,500]],
    ['ridge',[300,500],[800,500]]]));
check('an off-centre ridge still gets both its runs',
  labels(r).join(',') === '5.00m,5.00m', labels(r).join(', ') || '(none)');
check('…and they are drawn over the ridge, not off its end',
  r.length === 2 && r.every(d => d.x >= 300 && d.x <= 800),
  r.map(d => 'x'+d.x).join(', '));

// ── C. L-shape: two ridges at right angles, meeting at a valley ───
const ELL = [[0,0],[2000,0],[2000,1000],[1200,1000],[1200,1800],[0,1800]];
const ELL_LINES = [
  ['gutter',[0,0],[2000,0]], ['gutter',[2000,0],[2000,1000]],
  ['gutter',[2000,1000],[1200,1000]], ['gutter',[1200,1000],[1200,1800]],
  ['gutter',[1200,1800],[0,1800]], ['gutter',[0,1800],[0,0]],
  ['ridge',[500,500],[1500,500]], ['ridge',[600,500],[600,1300]],
  ['valley',[1200,1000],[600,500]],
  ['hip',[0,0],[500,500]], ['hip',[2000,0],[1500,500]], ['hip',[2000,1000],[1500,500]],
  ['hip',[0,1800],[600,1300]], ['hip',[1200,1800],[600,1300]]];
r = await build(ELL, ELL_LINES);
check('both ridges of an L get both their sides — four runs',
  r.length === 4, r.length + ': ' + labels(r).join(', '));
check('…the main ridge drops 5m each way, the wing 6m',
  labels(r).join(',') === '5.00m,5.00m,6.00m,6.00m', labels(r).join(', '));
// The main ridge's south side also faces the wing's far eave 13 m away.
// A sheet does not run there — it would cross the valley onto a plane that
// slopes the other way — so the valley must still veto that one.
check('no phantom run across the valley to the wing eave',
  !labels(r).includes('13.00m'), labels(r).join(', '));

// ── D. A traced eave is never exactly parallel to the ridge ───────
// North eave falls 60 px over its 2000 px run. The source point sits at
// x=550, where the eave is at y=16.5, so the true drop is 483.5 px. Measuring
// ridge-midpoint to gutter-midpoint instead would read 470.
r = await build([[0,0],[2000,60],[2000,1000],[0,1000]],
  [['gutter',[0,0],[2000,60]], ['gutter',[2000,60],[2000,1000]],
   ['gutter',[2000,1000],[0,1000]], ['gutter',[0,1000],[0,0]],
   ['hip',[0,0],[300,500]], ['hip',[2000,60],[800,500]],
   ['hip',[0,1000],[300,500]], ['hip',[2000,1000],[800,500]],
   ['ridge',[300,500],[800,500]]]);
const north = r.filter(d => d.y < 500).map(d => d.label);
check('a skewed eave is measured where the arrow actually sits',
  north.length === 1 && north[0] === '4.84m', north.join(', ') || '(none)');

// ── E. Stepped eave — one side drops to two gutters at two depths ──
r = await build([[0,0],[2000,0],[2000,1400],[1000,1400],[1000,1000],[0,1000]],
  [['gutter',[0,0],[2000,0]], ['gutter',[2000,0],[2000,1400]],
   ['gutter',[2000,1400],[1000,1400]], ['gutter',[1000,1400],[1000,1000]],
   ['gutter',[1000,1000],[0,1000]], ['gutter',[0,1000],[0,0]],
   ['ridge',[200,500],[1800,500]],
   ['hip',[0,0],[200,500]], ['hip',[0,1000],[200,500]],
   ['hip',[2000,0],[1800,500]], ['hip',[2000,1400],[1800,500]]]);
const south = labels(r.filter(d => d.y > 500));
check('a stepped eave gets a run per depth, not one averaged run',
  south.length === 2 && south.join(',') === '5.00m,9.00m', south.join(', ') || '(none)');
check('…and the shallow side still reads once', 
  labels(r.filter(d => d.y < 500)).join(',') === '5.00m',
  labels(r.filter(d => d.y < 500)).join(', ') || '(none)');

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');

await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
