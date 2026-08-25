// The job pack ordered 88 sheets for a roof the roofer counts at 59.
//
// A lean-to is a single slope: one gutter along the bottom, an apron against
// the wall at the top, no ridge. The tiler counted three of them as gables —
// and a gable splits its depth into two slopes and lays a column of sheets on
// each, so each lean-to came out at double the count and half the length.
// Half-length sheets are the worse half of that: 88 sheets that don't reach
// the gutter is a re-order and a lost day, not just an over-spend.
//
// The tiler DOES know about mono roofs. What it did not know was that these
// were mono, because the roofer only gets asked for a roof type when they
// pick one off the shape sheet — draw a three-metre laundry roof by hand, as
// most people do, and the type is simply never set. Empty fell through to the
// gable arithmetic.
//
// So when the roofer has not said, the lines say: gutter but no ridge, hip or
// valley is one slope, and there is no other shape those lines describe.
import { fileURLToPath as _f } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
// The real six-roof job from the feedback: a gable main roof, a small gable,
// three lean-tos and a nine-sided bay. None of them carries a roof type.
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
  gotoTab('materials');
}, GEOM);
await pg.waitForTimeout(2800);

// None of these roofs was ever given a type — that is the whole point.
const untyped = await pg.evaluate(() =>
  (DRAW.roofs||[]).every(r => !r.roofType));
check('this job is the one that was reported: not one roof carries a type', untyped);

// Take each roof off on its own, so a wrong count can be pinned to a roof
// rather than lost in a total.
const per = await pg.evaluate(() => {
  const all = DRAW.roofs.slice(), saveIdx = DRAW.activeRoofIdx, saveAll = DRAW.showAllRoofs;
  const out = [];
  all.forEach((r) => {
    DRAW.roofs = [r]; DRAW.activeRoofIdx = 0; DRAW.showAllRoofs = false;
    _loadRoofToCurrent(0);
    try { renderRoofSheetPlan(); } catch(e){}
    const sc = window._lastSheetCounts || {};
    const secs = window._lastSheetSections || [];
    const types = {};
    (r.lines||[]).forEach(l => { types[l.type] = (types[l.type]||0) + 1; });
    out.push({ name: r.name, lines: types,
               sheets: (sc.groups||[]).reduce((a,x) => a + x.count, 0),
               lenMm: (sc.groups||[])[0] ? (sc.groups||[])[0].orderedMm : 0,
               mono: secs.length ? secs.every(s => !!s.mono) : null,
               secs: secs.length });
  });
  DRAW.roofs = all; DRAW.activeRoofIdx = saveIdx; DRAW.showAllRoofs = saveAll;
  _loadRoofToCurrent(saveIdx);
  try { renderRoofSheetPlan(); } catch(e){}
  return out;
});
const byName = {}; per.forEach(p => byName[p.name] = p);

// The two roofs with a ridge were always right; they must stay right.
['MainRoof','Roof2'].forEach(n => {
  check('  ' + n + ' has a ridge, so it is still counted as a gable',
    byName[n] && byName[n].mono === false, JSON.stringify(byName[n]));
});
check('the main gable still orders 34 sheets', byName.MainRoof.sheets === 34,
  byName.MainRoof.sheets + '');
check('…at their full length, not half of it', byName.MainRoof.lenMm > 6000,
  byName.MainRoof.lenMm + 'mm');
check('the small gable still orders 8', byName.Roof2.sheets === 8, byName.Roof2.sheets + '');

// The three lean-tos: gutter + apron + two barges and nothing else.
['Roof3','Roof4','Roof5'].forEach(n => {
  const r = byName[n];
  check('  ' + n + ' is a gutter and an apron with no ridge — one slope',
    r && r.lines.gutter === 1 && r.lines.apron === 1 && !r.lines.ridge,
    JSON.stringify(r && r.lines));
  check('    …so it is counted as a mono, not a gable', r && r.mono === true,
    JSON.stringify(r));
});
check('the 6m lean-to orders 8 sheets, one column per bay', byName.Roof3.sheets === 8,
  byName.Roof3.sheets + '');
check('…the 3.2m one orders 5', byName.Roof4.sheets === 5, byName.Roof4.sheets + '');
check('…and the 3.1m one orders 4', byName.Roof5.sheets === 4, byName.Roof5.sheets + '');

// The lengths are the other half of the bug. A lean-to's sheet runs the full
// depth of the roof; halved, none of them reaches the gutter.
const lens = await pg.evaluate(() => {
  const out = {};
  (DRAW.roofs||[]).forEach((r) => {
    const barges = (r.lines||[]).filter(l => l.type === 'barge')
      .map(l => parseFloat(l.measM)).filter(x => x > 0);
    out[r.name] = barges.length ? Math.max.apply(null, barges) : 0;
  });
  return out;
});
['Roof3','Roof4','Roof5'].forEach(n => {
  check('  ' + n + ' orders its sheets at the full rake, not half of it',
    Math.abs(byName[n].lenMm / 1000 - lens[n]) < 0.2,
    (byName[n].lenMm/1000).toFixed(2) + 'm against a ' + lens[n] + 'm barge');
});

// And the job as a whole.
const total = await pg.evaluate(() => {
  const sc = window._lastSheetCounts;
  return { raw: (sc.groups||[]).reduce((a,x) => a + x.count, 0),
           rows: _jpBuildSheetRows(sc).reduce((s,r) => s + r.qty, 0) };
});
const fiveRoofs = ['MainRoof','Roof2','Roof3','Roof4','Roof5']
  .reduce((s,n) => s + byName[n].sheets, 0);
check('the five roofs the take-off covers now order 59, the roofer’s own number',
  fiveRoofs === 59, fiveRoofs + ' sheets');
check('…and the whole job is 63, not the 88 that was reported',
  total.raw === 63 && total.rows === 63, JSON.stringify(total));
check('…the sixth roof being the little nine-sided bay, which needs sheets too',
  byName.Roof6.sheets === total.raw - fiveRoofs && byName.Roof6.sheets > 0,
  byName.Roof6.sheets + ' for ' + byName.Roof6.name);

// ── an explicit type always wins over the inference ────────────────
const explicit = await pg.evaluate(() => {
  const all = DRAW.roofs.slice(), saveIdx = DRAW.activeRoofIdx, saveAll = DRAW.showAllRoofs;
  const lean = Object.assign({}, all[2], { lines: (all[2].lines||[]).map(l => Object.assign({}, l)) });
  function count(type){
    lean.roofType = type;
    DRAW.roofs = [lean]; DRAW.activeRoofIdx = 0; DRAW.showAllRoofs = false;
    _loadRoofToCurrent(0);
    try { renderRoofSheetPlan(); } catch(e){}
    const sc = window._lastSheetCounts || {};
    return (sc.groups||[]).reduce((a,x) => a + x.count, 0);
  }
  const asMono = count('mono');
  const inferred = count('');
  DRAW.roofs = all; DRAW.activeRoofIdx = saveIdx; DRAW.showAllRoofs = saveAll;
  _loadRoofToCurrent(saveIdx);
  try { renderRoofSheetPlan(); } catch(e){}
  return { asMono, inferred };
});
check('a roof the roofer explicitly called mono counts the same as an inferred one',
  explicit.asMono === explicit.inferred && explicit.asMono === 8,
  JSON.stringify(explicit));

check('and none of this threw', errs.length === 0, errs.join(' | ') || 'no page errors');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
