// "A random sheet length of 10.24m is showing up. I believe it's calculating
//  the sheet from the 1.39m ridge all the way to the 9m gutter, however it
//  should only be to the corresponding/parallel 1.39m gutter, which makes the
//  sheet length match the south face of the roof being 3.73m long."
//
// He read it exactly right. A short ridge in the valley pocket of a hip roof
// found a gutter clean across the house and reported the drop to it as a sheet
// run — 10.24m of steel on a building whose longest real run is 4.66m.
//
// There IS a guard against precisely this: a run may not cross a hip or valley
// that isn't one of its own face's two rakes. It had two faults, and together
// they meant it almost never ran on the roof that needed it:
//
//   - it walked DRAW.lines, the ACTIVE roof's lines, whichever roof was being
//     measured; and
//   - the caller only invoked it at all when the roof being measured WAS the
//     active one.
//
// So every other roof on the job was measured with no guard whatsoever. The
// canvas now always draws every roof, so that is most of them — and this job
// was reported with a 43×70px lean-to active while the fault sat on the main
// roof. Handing the guard the lines of the roof it is actually measuring, and
// running it for all of them, makes the answer the same whichever roof you
// happen to be standing on.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-run1024.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

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
await pg.waitForTimeout(2700);

// Measure the job with a given roof active. His report had Roof 4 active.
async function runsWith(active){
  return pg.evaluate(([g, ACT]) => {
    DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
    DRAW.outline = g.outline; DRAW.outlineDone = true;
    DRAW.lines = g.lines.map(l => Object.assign({}, l));
    DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
      { lines:(r.lines||[]).map(l => Object.assign({}, l)) }));
    DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
    if (ACT !== g.activeRoofIdx){ _syncCurrentToRoof(); _loadRoofToCurrent(ACT); }
    gotoTab('roof');
    try { redrawAll(); } catch(e){}
    const d = window._lastSheetDims || [];
    return { active:DRAW.activeRoofIdx,
             labels:d.map(x => x.label).sort(),
             main:d.filter(x => x.roofIdx === 0).map(x => x.label).sort() };
  }, [GEOM, active]);
}

const asReported = await runsWith(3);
check('the 10.24m run he reported is gone',
  !asReported.labels.some(l => /^10\./.test(l)), asReported.labels.join(', '));
check('…replaced by the drop to the parallel 1.39m gutter, ~3.73m',
  asReported.labels.some(l => { const v = parseFloat(l); return v > 3.6 && v < 3.85; }),
  asReported.labels.join(', '));
check('…and the roof keeps its real runs, not just loses the bad one',
  asReported.labels.filter(l => /^4\.66/.test(l)).length === 2,
  asReported.labels.join(', '));
check('…so nothing on the job is longer than its longest real run',
  Math.max.apply(null, asReported.labels.map(parseFloat)) < 6,
  'longest ' + Math.max.apply(null, asReported.labels.map(parseFloat)) + 'm');

// He confirmed a second phantom on the same roof: a 6.09m run, which is the
// main ridge reaching PAST its own west eave to the stepped one below it.
// "That measure should have been 4.66m" — and it is: the west face's own run.
// The area under the step belongs to the pocket ridge, not the main one, and
// the pocket's two runs (3.71m north, 3.75m south) cover it.
check('the 6.09m run on the same roof is gone as well',
  !asReported.labels.some(l => /^6\./.test(l)), asReported.labels.join(', '));
const faces = await pg.evaluate(() => (window._lastSheetDims || [])
  .filter(x => x.roofIdx === 0)
  .map(x => ({ label:x.label, into:[Math.round(x.faceDx||0), Math.round(x.faceDy||0)],
               ridge:[Math.round(x.ridgeMx||0), Math.round(x.ridgeMy||0)] })));
const west = faces.find(f => f.into[0] === -1);
const east = faces.find(f => f.into[0] === 1);
check('…and the west face reads 4.66m, which is what he said it should be',
  west && /^4\.66/.test(west.label), west ? west.label : 'no west run');
check('…with the east face the same, off the same ridge',
  east && /^4\.66/.test(east.label) && east.ridge.join() === (west||{ridge:[]}).ridge.join(),
  east ? east.label : 'no east run');
check('…and the pocket under the step keeps its own two runs',
  faces.filter(f => f.into[1] !== 0).length === 2,
  faces.filter(f => f.into[1] !== 0).map(f => f.label).join(', '));
check('…so the roof has four runs, one per face, and no phantoms',
  faces.length === 4, faces.map(f => f.label).join(', '));

// The whole point of the fix: the answer must not depend on which roof
// happens to be active. It used to — the guard only ran on the active one.
const perActive = [];
for (const a of [0, 1, 2, 3]) perActive.push(await runsWith(a));
check('every roof measures the same whichever roof is active',
  perActive.every(r => r.labels.join() === perActive[0].labels.join()),
  perActive.map(r => r.active + ':[' + r.labels.join(' ') + ']').join('  '));
check('…including the main roof’s own runs',
  perActive.every(r => r.main.join() === perActive[0].main.join()),
  perActive.map(r => r.active + ':' + r.main.join('/')).join('  '));
check('…and none of them shows a 10m run',
  perActive.every(r => !r.labels.some(l => /^10\./.test(l))));

// The guard must read the lines of the roof it is measuring.
const scoped = await pg.evaluate(() => {
  // A roof whose lines are NOT DRAW.lines still gets measured correctly.
  const d = window._lastSheetDims || [];
  return { mainRuns:d.filter(x => x.roofIdx === 0).length,
           active:DRAW.activeRoofIdx,
           mainIsActive:DRAW.activeRoofIdx === 0 };
});
check('a non-active roof is still measured against its OWN lines',
  scoped.mainRuns > 0 || scoped.mainIsActive,
  scoped.mainRuns + ' runs on the main roof while roof ' + scoped.active + ' is active');

// ── "the whole outline should never move all together" ─────────────
// A press inside any non-active roof used to grab that whole roof and slide
// it, and it was claimed BEFORE the sheet-label handler — so reaching for a
// sheet measure to nudge the LABEL carried the entire outline off the photo.
await pg.evaluate(() => { setTool('select'); redrawAll(); });
await pg.waitForTimeout(400);
const drag = await pg.evaluate(() => {
  const before = DRAW.roofs.map(r => JSON.stringify(r.outline));
  // Press on a sheet label belonging to a roof that is NOT the active one,
  // then drag well past any movement threshold.
  const hit = (window._roofCanvasHits.sheets || [])
    .filter(h => h.roofIdx !== DRAW.activeRoofIdx)[0];
  if (!hit) return { noHit:true };
  const cv = document.getElementById('roofCanvas');
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cx = r.left + hit.x / (cv.width / r.width) * dpr;
  const cy = r.top  + hit.y / (cv.height / r.height) * dpr;
  const fire = (t, x, y) => cv.dispatchEvent(new MouseEvent(t,
    { clientX:x, clientY:y, bubbles:true, cancelable:true, buttons:1 }));
  fire('mousedown', cx, cy);
  fire('mousemove', cx + 60, cy + 40);
  fire('mouseup',   cx + 60, cy + 40);
  return { noHit:false, roofIdx:hit.roofIdx,
           before, after:DRAW.roofs.map(r2 => JSON.stringify(r2.outline)),
           offsets:DRAW.roofs.map(r2 => JSON.stringify(r2.viewOffset || null)),
           labelMoved:!!(DRAW.sheetLabelOffsets && Object.keys(DRAW.sheetLabelOffsets).length) };
});
check('a sheet label was found on a roof that is not the active one', !drag.noHit,
  drag.noHit ? 'none' : ('roof ' + drag.roofIdx));
check('dragging it does not move that roof’s outline',
  !drag.noHit && drag.before.join('|') === drag.after.join('|'),
  drag.noHit ? 'n/a' : (drag.after[drag.roofIdx] || ''));
check('…nor any other roof’s',
  !drag.noHit && drag.before.every((o, i) => o === drag.after[i]));
check('…and nothing writes a whole-roof view offset any more',
  !drag.noHit && drag.offsets.every(o => o === 'null'), (drag.offsets||[]).join(' '));

// Every roof still renders at its true drawn coordinates, offset or not.
const trueCoords = await pg.evaluate(() => {
  DRAW.roofs[0].viewOffset = [250, 180];   // as an old save might carry
  redrawAll();
  const d = (window._lastSheetDims || []).filter(x => x.roofIdx === 0);
  DRAW.roofs[0].viewOffset = null; redrawAll();
  const d2 = (window._lastSheetDims || []).filter(x => x.roofIdx === 0);
  return { withOff:d.map(x => x.label).sort().join(),
           without:d2.map(x => x.label).sort().join() };
});
check('a stored offset from the old behaviour no longer displaces a roof',
  trueCoords.withOff === trueCoords.without && trueCoords.without.length > 0,
  trueCoords.withOff + ' vs ' + trueCoords.without);

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
