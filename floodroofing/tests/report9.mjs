// Feedback reports 9 and 10 (2026-10-08, info@wellingtonroof.co.nz) — one
// roof, two reports four minutes apart. The second carried the Sheet
// calculation check for the first.
//
//   "In addition to the job pack view what other detail is available to
//    confirm profiles assigned to the flashing schedule. Is there option to
//    set up labour value based on SQM rate? When applying / using change in
//    pitch how / where can you enter 2nd pitch? Related the job pack sheet
//    lengths don't appear to reflect different sheets for change in pitch."
//   "Additional Job Lot Image re sheets list, also not sure re orange main
//    sheet counts."
//
// Two faults, both reproduced here on their exact roof (a 25.53 x 11.12 m
// dutch gable at 25 deg, two change-of-pitch lines):
//
//  1. THE ORANGE SHEETS. The dutch path counted each hip END TWICE — once
//     correctly as its own short-sheet face, and again through the
//     uncovered-gutter rule, which sheets a stretch of gutter no ridge spans
//     from that gutter to the far edge. On a dutch gable the ridge stops
//     short of both ends BECAUSE there are hips there, so every end was
//     counted a second time as a 12.27 m sheet spanning the whole building
//     eave-to-eave over the ridge. 92 sheets and 397 m2 of steel for a
//     313 m2 roof.
//  2. THE CHANGE OF PITCH DID NOTHING. Deleting both change-of-pitch lines
//     left the count byte-identical, though the tool's own hint says "Each
//     change-of-pitch line starts a new set of sheets above it" — and there
//     was nowhere to enter a second pitch, because a roof carried one.
//
// The owner, 2026-10-08: "a change of pitch should always break a roof and
// split the sheets and then make two different roof pitches by default
// always show the roof pitch on the roof on the canvas and add another roof
// pitch to edit separate to the main roof pitch whenever there is a change
// of pitch line or another roof outline."
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// Their roof, exactly as the report printed it.
const OUTLINE = [[769,444],[1694,444],[1694,847],[769,847]];
const SCALE = 0.027590208286726543, PITCH = 25;
const CP = [{ type:'changepitch', pts:[[1629,509],[834,509]], measM:21.94 },
            { type:'changepitch', pts:[[834,782],[1629,782]], measM:21.94 }];
// 25.53 x 11.12 m on plan; the roof itself, at 25 deg, is 313 m2.
const PLAN_M2 = (925 * SCALE) * (403 * SCALE);
const ROOF_M2 = PLAN_M2 / Math.cos(PITCH * Math.PI / 180);

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1400, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_site_mode','off'); });
await pg.goto('file://' + DIR + '/app.html'); await pg.waitForTimeout(2600);

// Build the roof the way the app builds it, add the change-of-pitch lines by
// hand (there is no auto path that draws them), and read the order back.
const build = (type, cp, low) => pg.evaluate(([OUTLINE, SCALE, PITCH, CP, type, cp, low]) => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = OUTLINE.map(p => p.slice()); finishCurrent();
  DRAW.scaleMetresPerPx = SCALE; DRAW.calPitch = PITCH; DRAW.lowPitch = low || 0;
  DRAW.roofBaseHoriz = true; DRAW.rotation = 0; DRAW.roofType = type;
  autoGenerateRoof(type, 0);
  if (cp) CP.forEach(l => DRAW.lines.push({ type:l.type, pts:[l.pts[0].slice(), l.pts[1].slice()], measM:l.measM }));
  autoCalcLineMeasurements();
  renderRoofSheetPlan(); redrawAll();
  const gg = (window._lastSheetCounts || {}).groups || {};
  const groups = {}; let total = 0, lm = 0;
  Object.keys(gg).forEach(k => { groups[gg[k].orderedMm] = (groups[gg[k].orderedMm]||0) + gg[k].count;
    total += gg[k].count; lm += gg[k].orderedMm/1000 * gg[k].count; });
  const row = document.getElementById('roofLowPitchWrap');
  return { groups, total, m2: lm * 0.762,
    lens: Object.keys(groups).map(Number).sort((x,y) => x-y),
    lowRowShown: !!(row && row.style.display !== 'none'),
    lowRowValue: (document.getElementById('roofLowPitchInput')||{}).value || '',
    pitchPlates: ((window._roofCanvasHits||{}).pitch || []).length };
}, [OUTLINE, SCALE, PITCH, CP, type, cp, low]);

// ── 1. the orange sheets ──────────────────────────────────────────
const dutch = await build('dutch', false, 0);
check('a dutch gable no longer counts its hip ends twice — no sheet spans the building eave-to-eave',
  !dutch.lens.some(mm => mm > 7000), JSON.stringify(dutch.groups));
check('…so it orders the steel the roof needs, not a quarter more (was 397 m² for a 313 m² roof)',
  dutch.m2 > ROOF_M2 && dutch.m2 < ROOF_M2 * 1.10,
  dutch.m2.toFixed(0) + ' m² ordered vs ' + ROOF_M2.toFixed(0) + ' m² of roof');
const hip = await build('hip', false, 0), gable = await build('gable', false, 0);
check('…and the shapes that were already right have not moved: hip and gable still 68 sheets',
  hip.total === 68 && gable.total === 68, JSON.stringify({ hip: hip.total, gable: gable.total }));
check('…both of them within a sheet or two of the roof’s own area',
  hip.m2 > ROOF_M2 && hip.m2 < ROOF_M2 * 1.06 && gable.m2 > ROOF_M2 && gable.m2 < ROOF_M2 * 1.06,
  JSON.stringify({ hip: +hip.m2.toFixed(0), gable: +gable.m2.toFixed(0), roof: +ROOF_M2.toFixed(0) }));

// ── 2. a change of pitch breaks the roof ──────────────────────────
const same = await build('dutch', true, 0);
check('a change-of-pitch line BREAKS the sheets — the count changes where it used to be identical',
  same.total !== dutch.total, JSON.stringify({ without: dutch.total, with: same.total }));
check('…into a shorter upper face and a band below the line, with the line’s own run between them',
  same.lens.length >= 2 && Math.max(...same.lens) < Math.max(...dutch.lens),
  JSON.stringify({ with: same.lens, without: dutch.lens }));
check('…and breaking a roof orders no extra steel: more sheets, the same square metres',
  Math.abs(same.m2 - dutch.m2) < ROOF_M2 * 0.02,
  JSON.stringify({ broken: +same.m2.toFixed(0), whole: +dutch.m2.toFixed(0) }));

// The second pitch is what the band is measured at — a shallower lower roof
// covers the same ground with less steel.
const low10 = await build('dutch', true, 10), low5 = await build('dutch', true, 5);
check('the second pitch measures the band below the line: a shallower one is shorter',
  Math.max(...low10.lens.filter(mm => mm < 3000)) < Math.max(...same.lens.filter(mm => mm < 3000)) &&
  Math.max(...low5.lens.filter(mm => mm < 3000)) < Math.max(...low10.lens.filter(mm => mm < 3000)),
  JSON.stringify({ at25: same.lens, at10: low10.lens, at5: low5.lens }));
check('…and it never touches the main roof above the line, which keeps its own pitch',
  low5.lens.includes(Math.max(...same.lens)), JSON.stringify({ at5: low5.lens, at25: same.lens }));

// WHAT IS NOT DONE YET — pinned so it can never quietly become an UNDER-order.
// The break lives in the gable / mono / dutch enumerator, which has a band
// pass for what lies below the line. The hip-and-valley path has none, so it
// still measures straight through a change of pitch: no break, and no missing
// band either. Ordering less steel than the roof needs is a worse fault than
// the one this suite was opened for, so that is the half to hold.
const hipCp = await build('hip', true, 5);
check('a change of pitch on a hip roof does not break its sheets yet — but never orders less than the roof',
  hipCp.m2 > ROOF_M2 && hipCp.total === hip.total,
  JSON.stringify({ ordered: +hipCp.m2.toFixed(0), roof: +ROOF_M2.toFixed(0), sheets: hipCp.total }));

// ── 3. somewhere to type it ───────────────────────────────────────
check('a roof with no change of pitch is not asked for a second one',
  dutch.lowRowShown === false);
check('a roof with a change-of-pitch line gets its own Lower pitch box',
  same.lowRowShown === true);
check('…which reads the roof’s own pitch until one is typed, so the box never claims an angle nobody gave',
  same.lowRowValue === String(PITCH), same.lowRowValue);
check('…and shows what was typed once it is', low5.lowRowValue === '5', low5.lowRowValue);

// ── 4. the pitch is on the drawing ────────────────────────────────
check('the pitch is on the roof on the canvas without being asked for', dutch.pitchPlates === 1, String(dutch.pitchPlates));
check('a roof with two change-of-pitch lines says BOTH pitches, one in each band below a line',
  same.pitchPlates === 3, String(same.pitchPlates));
const off = await pg.evaluate(() => { togglePitchLabel(); redrawAll();
  const n = ((window._roofCanvasHits||{}).pitch || []).length;
  togglePitchLabel(); redrawAll();
  return { off: n, back: ((window._roofCanvasHits||{}).pitch || []).length }; });
check('…and "Show on roof" still takes every one of them off, and puts them back',
  off.off === 0 && off.back === 3, JSON.stringify(off));

// ── 5. the second pitch is the roof's own ─────────────────────────
// "...whenever there is a change of pitch line OR ANOTHER ROOF OUTLINE": a
// second roof is a second pitch by definition, so neither pitch may leak
// across. Both are ROOF_FIELDS and ride on the roof record.
const kept = await pg.evaluate(async () => {
  setRoofLowPitch(8);
  const typed = DRAW.lowPitch;
  _addAndSwitchToNewRoof();                       // a second roof outline
  setTool('outline');
  DRAW.currentPts = [[200,200],[600,200],[600,500],[200,500]]; finishCurrent();
  DRAW.calPitch = 12;
  const freshRoofLow = DRAW.lowPitch;             // must NOT inherit roof 1's 8
  _syncCurrentToRoof();
  const stored = (DRAW.roofs || []).map(r => ({ pitch: r.calPitch, low: r.lowPitch }));
  switchToRoof(0);
  return { typed, freshRoofLow, stored, backOnFirst: DRAW.lowPitch,
           inFields: ROOF_FIELDS.indexOf('lowPitch') >= 0 };
});
check('the second pitch is a ROOF_FIELD, so it belongs to the roof and is stored on its record',
  kept.inFields && kept.stored.length === 2 && kept.stored[0].low === 8, JSON.stringify(kept));
check('…a NEW roof outline starts with its own pair of pitches and inherits neither',
  !kept.freshRoofLow && kept.stored[1].low !== 8, JSON.stringify(kept));
check('…and going back to the first roof brings its lower pitch with it',
  kept.backOnFirst === 8, JSON.stringify(kept));
const undone = await pg.evaluate(async () => {
  saveSnapshot(); setRoofLowPitch(30); undoLast();
  await new Promise(r => setTimeout(r, 200));
  return DRAW.lowPitch;
});
check('…and undo brings back the one it replaced', undone === 8, String(undone));

check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
