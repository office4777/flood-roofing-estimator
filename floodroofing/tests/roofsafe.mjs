// A roof map is the most expensive thing in a job: an hour on a ladder, and
// unlike a price it cannot be retyped from memory. Everything that persists
// a job funnels through snapshotCurrentJob, so the guard sits there — the
// one place a save can be checked before it goes anywhere, online or off.
//
// The rule this suite holds: a job that HAS a drawing never saves an empty
// one. Only an explicit clear is allowed to empty it, and a clear says so.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1400,height:950} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2400);

const drawRoof = () => pg.evaluate(() => {
  gotoTab('roof');
  S.currentJobId = 'job-A';
  DRAW.outline = [[0,0],[2000,0],[2000,1000],[0,1000]]; DRAW.outlineDone = true;
  DRAW.lines = [['gutter',[0,0],[2000,0]],['ridge',[500,500],[1500,500]]]
    .map(l => ({type:l[0], pts:[l[1],l[2]], label:'', lengthM:'', measM:null, sheetLengthM:null}));
  DRAW.roofs = []; DRAW.activeRoofIdx = -1;
  DRAW.scaleMetresPerPx = 0.01;
  return snapshotCurrentJob().draw.lines.length;   // a normal save, which arms the guard
});
const wipeDraw = () => pg.evaluate(() => { DRAW.outline = []; DRAW.lines = []; DRAW.roofs = []; });
const savedDraw = () => pg.evaluate(() => {
  const d = snapshotCurrentJob().draw;
  return { outline:(d.outline||[]).length, lines:(d.lines||[]).length };
});

// ── the normal case ───────────────────────────────────────────────
let n = await drawRoof();
check('a normal save carries the drawing', n === 2, n + ' lines');

// ── the case that cost a roof ─────────────────────────────────────
await wipeDraw();
let v = await savedDraw();
check('a drawing that goes blank on its own is NOT what gets saved',
  v.outline === 4 && v.lines === 2, v.outline + ' outline pts, ' + v.lines + ' lines');
v = await pg.evaluate(() => {
  const el = document.getElementById('saveJobMsg') || document.getElementById('globalJobBarSaveMsg');
  return el ? el.textContent : '';
});
check('…and it says so rather than fixing it silently', /blank|last good/i.test(v), v.slice(0, 70) || '(no message)');

// ── an explicit clear still clears ────────────────────────────────
await drawRoof();
await pg.evaluate(() => clearAll(true));
v = await savedDraw();
check('Clear really does clear — the guard does not fight the user',
  v.outline === 0 && v.lines === 0, v.outline + ' outline pts, ' + v.lines + ' lines');

// ── it survives a reload, which is where offline bites ────────────
await drawRoof();
await pg.evaluate(() => { LKG.byJob = {}; });          // as if the tab had been reopened
await wipeDraw();
v = await savedDraw();
check('the guard works from disk too, so a reload or a flat battery is covered',
  v.outline === 4 && v.lines === 2, v.outline + ' outline pts, ' + v.lines + ' lines');

// ── one job's roof never lands on another ─────────────────────────
await drawRoof();
v = await pg.evaluate(() => {
  S.currentJobId = 'job-B';        // a different job, no drawing of its own
  DRAW.outline = []; DRAW.lines = []; DRAW.roofs = [];
  const d = snapshotCurrentJob().draw;
  return { outline:(d.outline||[]).length, lines:(d.lines||[]).length };
});
check('a different job with no roof saves empty — no roof is resurrected onto it',
  v.outline === 0 && v.lines === 0, v.outline + ' outline pts, ' + v.lines + ' lines');

v = await pg.evaluate(() => {
  S.currentJobId = 'job-A';        // back to the one that does have a roof
  const d = snapshotCurrentJob().draw;
  return { outline:(d.outline||[]).length, lines:(d.lines||[]).length };
});
check('…while the job that does have one still gets it back',
  v.outline === 4 && v.lines === 2, v.outline + ' outline pts, ' + v.lines + ' lines');

// ── multi-roof jobs count as having a drawing ─────────────────────
v = await pg.evaluate(() => {
  S.currentJobId = 'job-C';
  // A real two-roof job: the active roof's geometry lives in DRAW, the rest
  // in the archive. (snapshotCurrentJob syncs DRAW back onto the active
  // entry, so the archive alone is never the whole picture.)
  DRAW.outline = [[0,0],[100,0],[100,100],[0,100]]; DRAW.outlineDone = true;
  DRAW.lines = [{type:'ridge',pts:[[10,50],[90,50]],label:'',lengthM:'',measM:null,sheetLengthM:null}];
  DRAW.roofs = [
    { name:'Roof 1', outline:DRAW.outline, lines:DRAW.lines },
    { name:'Roof 2', outline:[[200,0],[300,0],[300,100],[200,100]], lines:[{type:'ridge',pts:[[210,50],[290,50]]}] }
  ];
  DRAW.activeRoofIdx = 0;
  snapshotCurrentJob();                       // arms the guard on the whole job
  DRAW.outline = []; DRAW.lines = []; DRAW.roofs = [];   // now all of it vanishes
  const d = snapshotCurrentJob().draw;
  return { roofs:(d.roofs||[]).length, lines:(d.lines||[]).length };
});
check('a multi-roof job is protected the same way — the whole archive comes back',
  v.roofs === 2 && v.lines === 1, v.roofs + ' roof(s), ' + v.lines + ' line(s) saved');

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await ctx.close(); await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
