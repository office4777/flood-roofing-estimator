// Feedback report 57: "visual edits actually moved the building to scale —
//  I changed a gutter length measure and it moved the whole drawing. In
//  visual edits mode it should only change the measurements; it should
//  never move any lines, and an entered measure should never affect
//  anything else on the drawing."
//
// The hole: tapping a measure pill on a wall line opened "Set true length"
// and went straight to the true-measure solver, which stretches the outline
// — with no look at the edit mode. The other typed-measure paths (the line
// editor, the wall double-click, the sheet pill) already stopped in visual
// mode; this one did not. Now, in visual mode, the typed number lands on
// that line only: no corner moves, the scale stays, no other line changes,
// and the map is marked off scale. In scaled mode the wall still stretches.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const GEOM = JSON.parse(readFileSync(_j(_ROOT, 'tests', 'fixtures-report57.json'), 'utf8'));
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1700,height:1200} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**',
  r => r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t');
  localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://'+DIR+'/app.html');
await pg.waitForTimeout(2800);
await pg.evaluate(() => { const w = document.getElementById('setupWizard'); if (w) w.remove(); gotoTab('roof'); });
await pg.waitForTimeout(400);

// Load the report's roof exactly as drawn, and type a new length on the
// bottom gutter by tapping its measure pill — the path the user took.
const typeOnGutter = (mode, metres) => pg.evaluate(([g, mode, metres]) => {
  DRAW.scaleMetresPerPx = g.scaleMetresPerPx; DRAW.calPitch = g.calPitch;
  DRAW.outline = g.outline.map(p => p.slice()); DRAW.outlineDone = true;
  DRAW.lines = g.lines.map(l => JSON.parse(JSON.stringify(l)));
  DRAW.roofs = []; DRAW.activeRoofIdx = -1; DRAW.roofType = 'gable';
  DRAW.offScale = null; DRAW.editMode = mode; DRAW.tool = 'select';
  redrawAll();
  const before = { outline: JSON.stringify(DRAW.outline), scale: DRAW.scaleMetresPerPx,
                   lines: DRAW.lines.map(l => l.measM) };
  const hits = (window._roofCanvasHits && window._roofCanvasHits.measures) || [];
  const gutter = DRAW.lines[0];
  const hit = hits.find(h => h.line === gutter);
  if (!hit) return { noHit: true, hits: hits.length };
  // The prompt answers at once with the typed number.
  window._styledPrompt = (opts, cb) => { window.__promptTitle = opts.title; cb(String(metres)); };
  const cv = document.getElementById('roofCanvas'), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const ev = { clientX: r.left + hit.x * dpr * r.width / cv.width, clientY: r.top + hit.y * dpr * r.height / cv.height };
  const handled = _roofCanvasHitMeasureLabel(ev);
  return { handled, title: window.__promptTitle, before,
           after: { outline: JSON.stringify(DRAW.outline), scale: DRAW.scaleMetresPerPx, lines: DRAW.lines.map(l => l.measM) },
           label: DRAW.lines[0].label, offScale: !!(DRAW.offScale && DRAW.offScale.reasons && DRAW.offScale.reasons.length),
           mode: DRAW.editMode };
}, [GEOM, mode, metres]);

// ── visual edits: the number, and only the number ────────────────
const v = await typeOnGutter('visual', 9.5);
check('the gutter pill is there to tap and the tap is handled', !v.noHit && v.handled, JSON.stringify({ noHit: v.noHit, handled: v.handled }));
check('in Visual edits the prompt says only this line changes', /this measurement/i.test(v.title || ''), v.title);
check('…the typed length lands on that gutter', v.after.lines[0] === 9.5 && v.label === '9.50m', v.after.lines[0] + ' / ' + v.label);
check('…NOT ONE corner of the outline moves', v.after.outline === v.before.outline, v.after.outline);
check('…and the scale is untouched', v.after.scale === v.before.scale, v.before.scale + ' → ' + v.after.scale);
check('…and no other line changes', v.before.lines.slice(1).every((m, i) => m === v.after.lines[i + 1]),
  JSON.stringify(v.after.lines));
check('…and the map is marked no longer to scale, still in visual mode', v.offScale && v.mode === 'visual');

// ── scaled edits: the SCALE follows the typed length (2026-09-24) ──
// The owner: "click on any measure to calibrate the scale … without moving
// any lines, because they have likely traced a satellite image perfectly".
const s = await typeOnGutter('scaled', 9.5);
check('in Scaled edits the same tap corrects the SCALE: no corner moves, the scale changes, and that gutter now reads 9.50',
  s.handled && s.after.outline === s.before.outline && s.after.scale !== s.before.scale && Math.abs(s.after.lines[0] - 9.5) < 0.011,
  JSON.stringify({ moved: s.after.outline !== s.before.outline, scale: [s.before.scale, s.after.scale], gutter: s.after.lines[0] }));
const follow = await pg.evaluate(() => DRAW.lines.filter(l => l.pts && l.pts.length === 2).map(l => {
  const px = Math.hypot(l.pts[1][0] - l.pts[0][0], l.pts[1][1] - l.pts[0][1]);
  return { m: l.measM, want: Math.round(px * DRAW.scaleMetresPerPx * slopeFactorForLineType(l.type, _activePitch()) * 100) / 100 };
}));
check('…and every other measurement is worked out afresh from the drawing at the new scale', follow.every(x => Math.abs(x.m - x.want) < 0.011), JSON.stringify(follow.slice(0, 6)));

// ── EVERY measurement corrects the scale, not just the gutter ──────
// The owner, 2026-09-28: "I clicked the barge measure and scaled it, but it
// never scaled the whole picture … at the moment it only really works when a
// gutter line is clicked. Any line should scale the whole drawing in scaled
// mode, without moving any lines."
//
// A fresh roof per line type, typed at 1.25x what it reads: the scale must
// move by exactly that, every point must stay where it was traced, and the
// line must end up reading what was typed.
const drawRoof = (kind) => pg.evaluate((kind) => {
  clearAll(true);
  setTool('outline');
  DRAW.currentPts = [[200,250],[700,250],[700,540],[200,540]];
  finishCurrent();
  DRAW.scaleMetresPerPx = 0.02; DRAW.calPitch = 25; DRAW.editMode = 'scaled';
  autoGenerateRoof(kind);
  document.querySelectorAll('[id$="Modal"],[id$="Overlay"]').forEach(m => {
    const cs = getComputedStyle(m); if (cs.display !== 'none' && cs.position === 'fixed') m.style.display = 'none';
  });
  setTool('select'); updateMeasTotals(); redrawAll();
}, kind);

// The measure label for a line of this type, tapped and answered.
const typeOnLine = (type, factor) => pg.evaluate(([type, factor]) => {
  const i = DRAW.lines.findIndex(l => l.type === type && parseFloat(l.measM) > 0);
  if (i < 0) return { noLine: true, types: DRAW.lines.map(l => l.type).join(',') };
  const l = DRAW.lines[i];
  const typed = +(parseFloat(l.measM) * factor).toFixed(2);
  const before = { scale: DRAW.scaleMetresPerPx, geom: JSON.stringify([DRAW.outline, DRAW.lines.map(x => x.pts)]) };
  const hit = ((window._roofCanvasHits && window._roofCanvasHits.measures) || []).find(h => h.line === l);
  if (!hit) return { noHit: true };
  window._styledPrompt = (opts, cb) => cb(String(typed));
  const cv = document.getElementById('roofCanvas'), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const handled = _roofCanvasHitMeasureLabel({ clientX: r.left + hit.x * dpr * r.width / cv.width,
                                               clientY: r.top + hit.y * dpr * r.height / cv.height });
  // An interior line (ridge, hip, valley) opens the line editor instead of
  // the prompt — the office types into it and confirms, same as by hand.
  if (getComputedStyle(document.getElementById('lineMeasPopup')).display !== 'none'){
    document.getElementById('lineMeasInput').value = String(typed);
    confirmLineMeas();
  }
  return { typed, handled, ratio: DRAW.scaleMetresPerPx / before.scale,
           moved: JSON.stringify([DRAW.outline, DRAW.lines.map(x => x.pts)]) !== before.geom,
           reads: parseFloat(DRAW.lines[i].measM),
           offScale: !!(DRAW.offScale && DRAW.offScale.reasons && DRAW.offScale.reasons.length) };
}, [type, factor]);

for (const [kind, type] of [['gable','gutter'], ['gable','barge'], ['gable','ridge'], ['hip','hip'], ['hip','ridge']]){
  await drawRoof(kind);
  await pg.waitForTimeout(250);
  const r = await typeOnLine(type, 1.25);
  check('a ' + type + ' measure typed on a ' + kind + ' roof scales the whole drawing, and nothing moves',
    !r.noLine && !r.noHit && Math.abs(r.ratio - 1.25) < 0.005 && !r.moved && Math.abs(r.reads - r.typed) < 0.011 && !r.offScale,
    JSON.stringify(r));
}

// The SHEET measure (the arrowed number on a face). A gable run borrows its
// barge; a HIP face has no rake at all, and used to fall through to a
// label-only override that marked the map off scale — the owner's report.
for (const kind of ['gable', 'hip']){
  await drawRoof(kind);
  await pg.waitForTimeout(250);
  const r = await pg.evaluate(() => {
    const h = ((window._roofCanvasHits && window._roofCanvasHits.sheets) || [])[0];
    if (!h) return { noHit: true };
    const typed = +(parseFloat(h.label) * 1.25).toFixed(2);
    const before = { scale: DRAW.scaleMetresPerPx, geom: JSON.stringify([DRAW.outline, DRAW.lines.map(x => x.pts)]),
                     ov: JSON.stringify(DRAW.sheetOverrides || {}) };
    _applySheetMeasureChange(h, String(typed));
    return { typed, runPx: h.runPx, ratio: DRAW.scaleMetresPerPx / before.scale,
             moved: JSON.stringify([DRAW.outline, DRAW.lines.map(x => x.pts)]) !== before.geom,
             override: JSON.stringify(DRAW.sheetOverrides || {}) !== before.ov,
             offScale: !!(DRAW.offScale && DRAW.offScale.reasons && DRAW.offScale.reasons.length) };
  });
  check('a sheet measure on a ' + kind + ' roof scales the drawing itself — no override, no off-scale mark',
    !r.noHit && Math.abs(r.ratio - 1.25) < 0.005 && !r.moved && !r.override && !r.offScale, JSON.stringify(r));
}
check('…and the run carries its own plan length, which is what makes that possible',
  await pg.evaluate(() => (((window._roofCanvasHits || {}).sheets || [])[0] || {}).runPx > 0));

// Visual edits still change the number alone, whatever was tapped.
await drawRoof('hip');
await pg.waitForTimeout(250);
const vis = await pg.evaluate(() => {
  DRAW.editMode = 'visual';
  const h = ((window._roofCanvasHits && window._roofCanvasHits.sheets) || [])[0];
  const before = { scale: DRAW.scaleMetresPerPx, geom: JSON.stringify([DRAW.outline, DRAW.lines.map(x => x.pts)]) };
  _applySheetMeasureChange(h, String(+(parseFloat(h.label) * 1.25).toFixed(2)));
  return { scaleSame: DRAW.scaleMetresPerPx === before.scale,
           moved: JSON.stringify([DRAW.outline, DRAW.lines.map(x => x.pts)]) !== before.geom,
           override: !!Object.keys(DRAW.sheetOverrides || {}).length };
});
check('in Visual edits a sheet measure still changes nothing but its own number',
  vis.scaleSame && !vis.moved && vis.override, JSON.stringify(vis));
await pg.evaluate(() => { DRAW.editMode = 'scaled'; });

// The solvers refuse outright in visual mode, whoever calls them.
const solver = await pg.evaluate(() => {
  DRAW.editMode = 'visual';
  const o = JSON.stringify(DRAW.outline);
  const a = _applyTrueEdgeMeasure(1, 7.0), b = _applySegmentTrueMeasure(1, DRAW.lines[0], 7.0);
  return { a, b, same: JSON.stringify(DRAW.outline) === o };
});
check('the true-measure solvers refuse in visual mode and move nothing', solver.a === false && solver.b === false && solver.same, JSON.stringify(solver));
check('nothing threw', errs.length === 0, errs.join(' | ') || 'clean');

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
