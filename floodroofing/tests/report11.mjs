// Feedback report 11 (2026-10-12, info@wellingtonroof.co.nz) — "Dutch Gable
// sheets query v2 recreated". He rebuilt the roof from reports 9 and 10 on
// the build shipped that morning, typed the lower pitch (lowPitch 10), and
// the sheets STILL did not break at the change of pitch: two main faces at
// the full 6.20 m rafter, no band.
//
// It is not the roof type — the report says `Auto roof type: dutch`, which
// is the path that DOES break. It is one repeated corner. His outline came
// through as
//     [[814,465],[1633,465],[1633,827],[814,827],[814,827]]
// — a plain rectangle with the last point stored twice, a zero-length edge.
// Everything that COUNTS corners then reads the wrong shape, and the one
// that matters is
//     if (isDutch && outline && outline.length > 4)
// in _enumSimpleGableMono: the branch for a dutch on an L or T outline. It
// builds the roof with the hip-band model and RETURNS — before
// _sgmChangePitchBands is reached — and that model has no change-of-pitch
// pass at all. So his rectangle was sheeted as an L and measured straight
// through the line, which is exactly the documented hip-path limitation
// turning up on a roof that should never have been on that path.
//
// Fixed in both places: the engine drops repeated corners as it takes its
// copy of the outline (so jobs already saved come right), and the app drops
// them when an outline is finished (so no new one carries them).
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const DIR = _j(_d(_f(import.meta.url)), '..', 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// His roof, exactly as the report printed it.
const DUP  = [[814,465],[1633,465],[1633,827],[814,827],[814,827]];
const CLEAN= [[814,465],[1633,465],[1633,827],[814,827]];
const SCALE = 0.031040597027139814, PITCH = 25, LOW = 10;
const CP = [{ pts:[[869,519],[1578,519]], measM:22.02 },
            { pts:[[869,772],[1578,772]], measM:22.02 }];
// 25.4 x 11.23 m on plan. The band below each change-of-pitch line is at
// 10 degrees, the rest at 25, so the real roof is about 307 m2.
const PLAN_M2 = (819 * SCALE) * (362 * SCALE);

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1400, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_site_mode','off'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);

const run = (outline, cp) => pg.evaluate(([outline, SCALE, PITCH, CP, cp, LOW]) => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = outline.map(p => p.slice()); finishCurrent();
  DRAW.scaleMetresPerPx = SCALE; DRAW.calPitch = PITCH; DRAW.lowPitch = LOW;
  DRAW.roofBaseHoriz = true; DRAW.rotation = 0; DRAW.roofType = 'dutch';
  autoGenerateRoof('dutch', 0);
  if (cp) CP.forEach(l => DRAW.lines.push({ type:'changepitch', pts:[l.pts[0].slice(), l.pts[1].slice()], measM:l.measM }));
  autoCalcLineMeasurements(); renderRoofSheetPlan(); redrawAll();
  const gg = (window._lastSheetCounts || {}).groups || {};
  const groups = Object.keys(gg).map(k => ({ mm: gg[k].orderedMm, n: gg[k].count }))
                       .sort((x, y) => y.mm - x.mm);
  let lm = 0, total = 0; groups.forEach(g => { lm += g.mm/1000 * g.n; total += g.n; });
  return { groups, total, m2: +(lm * 0.762).toFixed(1),
           lens: groups.map(g => g.mm).sort((x,y)=>x-y),
           storedCorners: (DRAW.outline || []).length };
}, [outline, SCALE, PITCH, CP, cp, LOW]);

// ── 1. the app never stores the repeated corner again ───────────
const dup = await run(DUP, true);
check('an outline finished with a repeated corner is stored without it',
  dup.storedCorners === 4, String(dup.storedCorners) + ' corners stored');

// ── 2. his roof breaks at the change of pitch ───────────────────
const whole = await run(DUP, false);
check('his roof, with no change of pitch, is unmoved — nothing already right has shifted',
  whole.lens.length === 2 && Math.abs(Math.max(...whole.lens) - 6197) < 60,
  JSON.stringify(whole.groups));
check('…and WITH the change of pitch the sheets now break: the count is no longer identical',
  dup.total !== whole.total, JSON.stringify({ broken: dup.total, whole: whole.total }));
check('…no sheet is the full rafter length any more — the main faces stop at the line',
  Math.max(...dup.lens) < Math.max(...whole.lens) - 500,
  JSON.stringify({ with: dup.lens, without: whole.lens }));
check('…and there are bands below it, at the lower pitch',
  dup.lens.length >= 3 && Math.min(...dup.lens) < 2200, JSON.stringify(dup.lens));

// ── 3. breaking a roof orders no extra steel ────────────────────
check('breaking his roof orders no extra steel — more sheets, the same square metres',
  Math.abs(dup.m2 - whole.m2) < whole.m2 * 0.02,
  JSON.stringify({ broken: dup.m2, whole: whole.m2 }));
check('…and the order still covers the roof, without running away with it',
  dup.m2 > PLAN_M2 && dup.m2 < PLAN_M2 * 1.20,
  dup.m2.toFixed(0) + ' m² ordered, ' + PLAN_M2.toFixed(0) + ' m² on plan');

// ── 4. the repeated corner changes NOTHING, which is the point ──
const clean = await run(CLEAN, true);
check('the doubled corner no longer changes the answer: his outline and the tidy one agree exactly',
  JSON.stringify(dup.groups) === JSON.stringify(clean.groups),
  JSON.stringify({ his: dup.groups, tidy: clean.groups }));

// ── 5. a REAL L-shaped dutch still takes the hip-band branch ────
// The fix must not turn a genuine L into a rectangle: only corners that sit
// on top of each other go.
const L = await pg.evaluate(() => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = [[800,460],[1600,460],[1600,700],[1150,700],[1150,900],[800,900]];
  finishCurrent();
  return { corners: (DRAW.outline || []).length };
});
check('a real L-shaped outline keeps every one of its corners', L.corners === 6, String(L.corners));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
