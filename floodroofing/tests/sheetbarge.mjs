// "Force the sheet length to always be the same length as its corresponding
// barge length, never try to make the sheet measure slightly lower."
//
// A sheet runs down the slope from ridge to gutter. The barge (rake) runs
// down that same slope. They are one length, and a roofer orders one number
// for both. The auto-derived value was the perpendicular drop instead, which
// on anything not perfectly square comes out SHORT — a 3.73m barge measuring
// 3.50m, a 1.97m barge measuring 1.85m — and the cut list then ordered sheets
// that do not reach the gutter.
//
// Editing either one already mirrored onto the other. It was only the
// auto-derived number that drifted, which is why it survived so long: it
// looked deliberate.
//
// The fixture is the roof from a real feedback report — six roofs, two gables
// and three mono-pitch lean-tos.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-sixroof.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1700,height:1200} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/index.html');
await pg.waitForTimeout(2800);
await pg.evaluate((g) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline; DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => Object.assign({}, l));
  DRAW.penetrations = g.penetrations || [];
  DRAW.roofs = g.roofs.map(r => Object.assign({}, r,
    { lines: (r.lines||[]).map(l => Object.assign({}, l)) }));
  DRAW.activeRoofIdx = g.activeRoofIdx; DRAW.showAllRoofs = true;
  try { redrawAll(); } catch(e){}
}, GEOM);
await pg.waitForTimeout(700);

// Every run's label, against the barges of the roof it belongs to.
const perRoof = await pg.evaluate(() => {
  const dims = window._lastSheetDims || [];
  const out = {};
  (DRAW.roofs||[]).forEach((r, i) => {
    const barges = [...new Set((r.lines||[]).filter(l => l.type === 'barge')
      .map(l => +parseFloat(l.measM)).filter(x => x > 0))];
    const runs = [...new Set(dims.filter(d => d.roofIdx === i)
      .map(d => parseFloat(String(d.label))))].filter(x => x > 0);
    out[r.name || ('Roof' + i)] = { barges, runs };
  });
  return out;
});

check('every sheet run on a roof reads exactly its barge length',
  Object.keys(perRoof).every(k => {
    const r = perRoof[k];
    if (!r.barges.length || !r.runs.length) return true;      // no rake to match
    return r.runs.every(v => r.barges.some(bm => Math.abs(bm - v) < 0.005));
  }),
  Object.keys(perRoof).map(k => k + ' barge ' + (perRoof[k].barges.join('/')||'—') +
    ' run ' + (perRoof[k].runs.join('/')||'—')).join('  |  '));

// The four that were short in the report, named so a regression is obvious.
const named = { MainRoof:6.43, Roof2:2.23, Roof3:3.73, Roof4:1.10, Roof5:1.97 };
Object.keys(named).forEach(k => {
  const r = perRoof[k] || { runs: [] };
  check('  ' + k + ' runs at its barge ' + named[k].toFixed(2) + 'm',
    r.runs.length > 0 && r.runs.every(v => Math.abs(v - named[k]) < 0.005),
    'runs ' + (r.runs.join('/') || 'none'));
});
check('…and none of them is the old slightly-shorter number',
  !Object.keys(perRoof).some(k => (perRoof[k].runs||[]).some(v =>
    [3.50, 1.85, 2.10, 1.18].some(old => Math.abs(v - old) < 0.005))),
  Object.keys(perRoof).map(k => (perRoof[k].runs||[]).join('/')).join(' '));

// ── both directions still move together ───────────────────────────
let v = await pg.evaluate(() => {
  DRAW.activeRoofIdx = 2;                                  // Roof3, barge 3.73
  DRAW.lines = DRAW.roofs[2].lines.map(l => Object.assign({}, l));
  DRAW.outline = DRAW.roofs[2].outline;
  try { redrawAll(); } catch(e){}
  const barge = DRAW.lines.filter(l => l.type === 'barge')[0];
  _syncBargeToItsFaces(barge, 4.20);
  try { redrawAll(); } catch(e){}
  return {
    barges: DRAW.lines.filter(l => l.type==='barge').map(l => +l.measM),
    runs: [...new Set((window._lastSheetDims||[])
      .filter(d => d.roofIdx === 2).map(d => parseFloat(String(d.label))))],
  };
});
check('retyping a barge moves its sheet runs with it',
  v.runs.length > 0 && v.runs.every(x => Math.abs(x - 4.20) < 0.005),
  'barges ' + v.barges.join('/') + ' runs ' + v.runs.join('/'));

v = await pg.evaluate(() => {
  _syncSlopeGroupFromSheet(5.05, 2);
  try { redrawAll(); } catch(e){}
  return {
    barges: [...new Set(DRAW.lines.filter(l => l.type==='barge').map(l => +l.measM))],
    runs: [...new Set((window._lastSheetDims||[])
      .filter(d => d.roofIdx === 2).map(d => parseFloat(String(d.label))))],
  };
});
check('…and retyping a sheet run moves its barges with it',
  v.barges.every(x => Math.abs(x - 5.05) < 0.005) &&
  v.runs.every(x => Math.abs(x - 5.05) < 0.005),
  'barges ' + v.barges.join('/') + ' runs ' + v.runs.join('/'));

// ── a run with no rake still gets a length ────────────────────────
check('a run with no barge on it falls back to geometry rather than nothing',
  await pg.evaluate(() => _bargeLenForRun([], { faceDx:1, faceDy:0, ridgeMx:0,
    ridgeMy:0, ridgeUx:0, ridgeUy:1, runLo:0, runHi:10 }) === 0));
check('…and an unmeasured barge is not treated as a zero-length one',
  await pg.evaluate(() => _bargeLenForRun(
    [{ type:'barge', measM:null, pts:[[10,0],[10,100]] }],
    { faceDx:1, faceDy:0, ridgeMx:0, ridgeMy:0, ridgeUx:0, ridgeUy:1,
      runLo:0, runHi:100 }) === 0));

check('and none of this threw', errs.length === 0, errs.slice(0,2).join(' | ') || 'no page errors');
await ctx.close();
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
