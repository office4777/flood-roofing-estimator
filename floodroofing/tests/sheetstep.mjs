// "Wrong calculation for step down should be 4.1m only showing 1m."
//
// The roof is a rectangle whose left wall steps out for a metre and a half of
// its length. Over that step the sheet runs further than anywhere else on the
// face — ridge to the stepped-out gutter, 127px of a drawing scaled at
// 0.0364 m/px, so 4.62m on the plan and 4.79m up the 15° slope. It was
// labelled 1.15m: the length of the little return at the step itself.
//
// The cause is a rule that is right nearly everywhere. A sheet and the barge
// beside it are the same slope, and on a drawing a few percent out of square
// the geometry comes out slightly SHORT — a 3.73m barge measuring 3.50m — so
// the barge's own measured length wins outright. A step's two returns run the
// same way a rake does and sit inside the run's span, so they were taken for
// its rake and a 4.79m sheet was ordered at 1.15m.
//
// A rake runs ridge to gutter. Anything much shorter than the run it is meant
// to bound is a return, and there the geometry is the better answer. That is
// the whole fix, and this is the roof it was reported on, verbatim.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Straight off the report.
const G = {
  scaleMetresPerPx: 0.0364, calPitch: 15,
  outline: [[370,245],[370,405],[339,405],[339,445],[370,445],[370,495],[561,495],[561,245]],
  lines: [
    { type:'ridge',  pts:[[466,245],[466,495]], measM:9.1 },
    { type:'gutter', pts:[[370,245],[370,405]], measM:5.82 },
    { type:'gutter', pts:[[339,405],[339,445]], measM:1.46 },
    { type:'gutter', pts:[[370,445],[370,495]], measM:1.82 },
    { type:'gutter', pts:[[561,495],[561,245]], measM:9.1 },
    { type:'barge',  pts:[[370,405],[339,405]], measM:1.15 },
    { type:'barge',  pts:[[339,445],[370,445]], measM:1.15 },
    { type:'barge',  pts:[[370,495],[466,495]], measM:3.63, subtype:'starter' },
    { type:'barge',  pts:[[466,495],[561,495]], measM:3.56, subtype:'starter' },
    { type:'barge',  pts:[[561,245],[466,245]], measM:3.56, subtype:'finish' },
    { type:'barge',  pts:[[466,245],[370,245]], measM:3.63, subtype:'finish' },
  ],
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);

const runs = await pg.evaluate((g) => {
  const w = document.getElementById('setupWizard'); if (w) w.remove();
  try { document.getElementById('selectJobOverlay').style.display = 'none';
        document.getElementById('selectJobModal').style.display = 'none'; } catch(e){}
  gotoTab('roof');
  DRAW.outline = g.outline.map(p => p.slice());
  DRAW.outlineDone = true;
  DRAW.lines = JSON.parse(JSON.stringify(g.lines));
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx;
  DRAW.calPitch = g.calPitch;
  DRAW.scaleAuto = false;
  redrawAll();
  return (window._lastSheetDims || []).map(d => ({
    m: parseFloat(d.label), runPx: Math.round(d.runPx || 0), into: [d.ndx, d.ndy] }));
}, G);

check('the roof gets a sheet run for each stretch of gutter', runs.length === 4,
  runs.map(r => r.m + 'm').join(', '));

// The three runs that were never in doubt.
const left  = runs.filter(r => r.runPx === 96).map(r => r.m);
const right = runs.filter(r => r.runPx === 95).map(r => r.m);
check('the plain part of the stepped face still reads 3.63m',
  left.length === 2 && left.every(m => Math.abs(m - 3.63) < 0.03), left.join(', '));
check('and the far face still reads 3.56m',
  right.length === 1 && Math.abs(right[0] - 3.56) < 0.03, right.join(', '));

// The one that was reported.
const step = runs.filter(r => r.runPx === 127);
check('the run over the step is measured, not skipped', step.length === 1, step.length + ' of them');
check('THE REPORT: it is no longer the 1.15m of the step return',
  step.length === 1 && step[0].m > 2, step.length ? step[0].m + 'm' : '(missing)');
// 127px × 0.0364 = 4.6228m on the plan; up a 15° slope, ÷cos15° = 4.786m.
check('…it is the run from the ridge to the stepped gutter, up the slope',
  step.length === 1 && Math.abs(step[0].m - 4.79) < 0.02,
  step.length ? step[0].m + 'm, wanted 4.79m' : '(missing)');
check('…and it is the longest sheet on the roof, which is what a step means',
  step.length === 1 && step[0].m === Math.max.apply(null, runs.map(r => r.m)),
  runs.map(r => r.m).join(', '));

// The rule this fix narrows must still do its job: where a barge really does
// bound the run, its own measured length still wins over the geometry.
const drift = await pg.evaluate(() => {
  DRAW.lines.forEach(function(l){
    if (l.type === 'barge' && Math.abs(l.pts[1][0] - l.pts[0][0]) > 50) { l.measM = 3.90; l.label = '3.90m'; }
  });
  redrawAll();
  return (window._lastSheetDims || []).map(d => ({ m: parseFloat(d.label), runPx: Math.round(d.runPx || 0) }));
});
check('a rake that really does bound its run still overrides the geometry',
  drift.filter(r => r.runPx === 96).every(r => Math.abs(r.m - 3.90) < 0.02),
  drift.filter(r => r.runPx === 96).map(r => r.m).join(', '));
check('…while the stepped run keeps its own, longer length',
  drift.filter(r => r.runPx === 127).every(r => Math.abs(r.m - 4.79) < 0.02),
  drift.filter(r => r.runPx === 127).map(r => r.m).join(', '));

check('the page threw no errors', errs.length === 0, errs.join(' | ') || 'clean');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
